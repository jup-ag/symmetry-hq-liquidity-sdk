import { Program, AnchorProvider, BN } from "@project-serum/anchor";
import { Wallet } from "@project-serum/anchor/dist/cjs/provider";
import { AccountInfo, Connection, Keypair, PublicKey, Transaction, TransactionInstruction, TransactionSignature } from "@solana/web3.js";
import { FundStateChainData, FUNDS_PROGRAM_ID, CurveChainData, CURVE_DATA_ADDRESS, RouteData, TokenInfoData, TOKEN_INFO_ADDRESS } from "./types";
import { FundsIDL, IDL } from "./fundsIDL";
import { decodeCurveData, decodeTokenInfo, findTokenId } from "./helpers";
import { availableRoutes, generateSwapInstruction, loadRouteData } from "./liquidity";
import { parsePriceData, PriceData } from "@pythnetwork/client";
import NodeWallet from "@project-serum/anchor/dist/cjs/nodewallet";

export * from "./types";

export class TokenSwap {

    private connection: Connection;
    private program: Program<FundsIDL>;
    private tokenInfoData: TokenInfoData[];
    private curveChainData: CurveChainData;
    private funds: {pubkey: PublicKey, fund: FundStateChainData}[];
    private pythPrices: PriceData[];
    private wallet?: Wallet;

    constructor(
        accountInfos: {
            tokenInfoAccountInfo: AccountInfo<Buffer>,
            curveDataAccountInfo: AccountInfo<Buffer>,
            pythDataAccountInfos: Array<AccountInfo<Buffer>>,
            fundStateAccountInfos: Array<{
                pubkey: PublicKey;
                account: AccountInfo<Buffer>;
            }>,
        },
        connection?: Connection,
        wallet?: Wallet,
    ) {
        let {
            tokenInfoAccountInfo,
            curveDataAccountInfo,
            pythDataAccountInfos,
            fundStateAccountInfos,
        } = accountInfos;
        if (!connection) connection = new Connection("https://solana-api.projectserum.com");
        if (!wallet) wallet = new NodeWallet(Keypair.generate());
        let provider = new AnchorProvider(connection, wallet, {
            skipPreflight: true,
            preflightCommitment: "recent",
            commitment: "recent",
        });
        this.connection = connection;
        this.wallet = wallet;
        this.program = new Program(IDL, FUNDS_PROGRAM_ID, provider);
        this.tokenInfoData = decodeTokenInfo(this.program, tokenInfoAccountInfo);
        this.curveChainData = decodeCurveData(this.program, curveDataAccountInfo);
        this.pythPrices = pythDataAccountInfos.map(account => parsePriceData(account.data));
        this.funds = fundStateAccountInfos.map(account => { return {
            pubkey: account.pubkey,
            fund: this.program.coder.accounts.decode("fundState", account.account.data)
        }});
    }

    static async getAccountInfosForTokenSwap(
        connection: Connection
    ): Promise<{
        tokenInfoAccountInfo: AccountInfo<Buffer>;
        curveDataAccountInfo: AccountInfo<Buffer>;
        pythDataAccountInfos: Array<AccountInfo<Buffer>>;
        fundStateAccountInfos: Array<{
            pubkey: PublicKey;
            account: AccountInfo<Buffer>;
        }>
    }> {
        //@ts-ignore
        let [tokenInfoAccountInfo, curveDataAccountInfo]:
            [AccountInfo<Buffer>, AccountInfo<Buffer>] = await connection
                .getMultipleAccountsInfo([TOKEN_INFO_ADDRESS, CURVE_DATA_ADDRESS]);
        
        let pythDataPubkeys: Array<PublicKey> = [];
        let numTokens = new BN(tokenInfoAccountInfo.data.slice(8, 16), 10, "le").toNumber();
        for (let i = 0; i < numTokens; i++) {
            let start = 18816 + i * 32;
            let end = 18816 + i * 32 + 32;
            pythDataPubkeys.push(
                new PublicKey(tokenInfoAccountInfo.data.slice(start, end))
            );
        }

        //@ts-ignore
        let pythDataAccountInfos: Array<AccountInfo<Buffer>> = await connection
            .getMultipleAccountsInfo(pythDataPubkeys);

        let fundStateAccountInfos = await connection.getProgramAccounts(FUNDS_PROGRAM_ID, {
            commitment: connection.commitment,
            filters: [
                { dataSize: 10208 },
                { memcmp: { offset: 112, bytes: "11111111" } }
            ],
            encoding: 'base64'
        });

        return {
            tokenInfoAccountInfo: tokenInfoAccountInfo,
            curveDataAccountInfo: curveDataAccountInfo,
            pythDataAccountInfos: pythDataAccountInfos,
            fundStateAccountInfos: fundStateAccountInfos,
        }
    }

    static async init(
        connection: Connection,
        wallet?: Wallet,
    ): Promise<TokenSwap> {
        return new TokenSwap(
            await this.getAccountInfosForTokenSwap(connection),
            connection,
            wallet,
        )
    }

    setWallet(wallet: Wallet) {
        this.wallet = wallet;
        let provider = new AnchorProvider(this.connection, wallet, {
            skipPreflight: true,
            preflightCommitment: "recent",
            commitment: "recent",
        })
        this.program = new Program(IDL, FUNDS_PROGRAM_ID, provider);
    }

    getTokenList(): {
        tokenId: number,
        coingeckoId: string,
        tokenMint: string,
    }[] {
        return this.tokenInfoData.map(x => {
            return {
                tokenId: x.id,
                coingeckoId: x.coingeckoId,
                tokenMint: x.mint,
            }
        })
    }

    getAccountsForUpdate(): PublicKey[] {
        return [
            CURVE_DATA_ADDRESS,
            ...this.tokenInfoData.map(token => new PublicKey(token.pyth)),
            ...this.funds.map(fund => fund.pubkey),
        ]
    }

    update(accountInfos: AccountInfo<Buffer>[]) {
        this.curveChainData = decodeCurveData(this.program, accountInfos[0]);
        let pythPrices = [];
        for (let i = 0; i < this.tokenInfoData.length; i++)
            pythPrices.push(parsePriceData(accountInfos[1 + i].data));
        this.pythPrices = pythPrices;
        let funds = [];
        for (let i = 0; i < this.funds.length; i++) {
            let id = 1 + this.tokenInfoData.length + i;
            funds.push({
                pubkey: this.funds[i].pubkey,
                fund: this.program.coder.accounts.decode("fundState", accountInfos[id].data)
            })
        }
        this.funds = funds;
    }

    async updateLiquiditySources() {
        //@ts-ignore
        let accountInfos: AccountInfo<Buffer>[] = await this.connection
            .getMultipleAccountsInfo(this.getAccountsForUpdate());
        this.update(accountInfos);
    }

    // for fund managers
    async getLiquidityInfo(fundPubkey: PublicKey): Promise<{
        tokenMint: string,
        userCanSellToFund: number,
        userCanBuyFromFund: number,
    }[]> {
        let fund = null;
        for (let i = 0; i < this.funds.length; i++)
            if (this.funds[i].pubkey.equals(fundPubkey))
                fund = this.funds[i];
        if (!fund)
            throw new Error("No such fund found");
        return availableRoutes(
            this.tokenInfoData,
            fund.fund,
            this.pythPrices
        );
    }

    getRouteData(
        tokenFrom: PublicKey,
        tokenTo: PublicKey,
        fromAmount: number
    ): RouteData {
        let tokenIdFrom = findTokenId(this.tokenInfoData, tokenFrom);
        let tokenIdTo = findTokenId(this.tokenInfoData, tokenTo);
        return loadRouteData(
            this.tokenInfoData,
            this.curveChainData,
            this.funds,
            this.pythPrices,
            tokenIdFrom,
            tokenIdTo,
            fromAmount,
        );
    }

    async generateSwapInstruction(
        routeData: RouteData,
        fromTokenAccount: PublicKey,
        toTokenAccount: PublicKey,
        user?: PublicKey,
        slippage?: number,
    ): Promise<TransactionInstruction> {
        if (!user && !this.wallet)
            throw new Error("Wallet not provided");
        if (!user)
            user = this.wallet?.publicKey;
        return await generateSwapInstruction(
            this.program, //@ts-ignore
            user,
            this.tokenInfoData,
            routeData,
            fromTokenAccount,
            toTokenAccount,
            slippage
        );
    }

    async sendTransaction(
        instruction: TransactionInstruction,
        wallet?: Wallet,
        connection?: Connection,
    ): Promise<TransactionSignature> {
        if (!wallet) wallet = this.wallet;
        if (!wallet)
            throw new Error("Wallet not provided");
        if (!connection)
            connection = this.connection;
        let { blockhash } = await connection.getLatestBlockhash();
        let transaction = new Transaction().add(instruction);
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = wallet.publicKey;
        transaction = await wallet.signTransaction(transaction);
        return await connection.sendRawTransaction(transaction.serialize());
    }
}
