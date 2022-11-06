# Symmetry Liquidity SDK
Exchange functionality using symmetry funds liquidity

Documentation:
https://docs.symmetry.fi/sdks/liquidity-sdk

## Initialization
```typescript
import { TokenSwap } from "@symmetry-hq/liquidity-sdk";

let tokenSwap = await TokenSwap.init(
    // rpc connection
    connection: Connection,
    // wallet (optional | can be provided later, using tokenSwap.setWallet
    wallet: Wallet,
);
```
OR
```typescript
import { TokenSwap } from "@symmetry-hq/liquidity-sdk";

let accountInfos = await TokenSwap.getAccountInfosForTokenSwap(connection);
let tokenSwap = new TokenSwap(accountInfos); // Synchronous

// implementation of getAccountInfosForTokenSwap() bellow:
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
```

## Update
```typescript
await tokenSwap.updateLiquiditySources();
```
OR
```typescript
let pubkeys: PublicKey[] = tokenSwap.getAccountsForUpdate(); // Synchronous
let accountInfos: AccountInfo<Buffer>[] =
    await connection.getMultipleAccountsInfo(pubkeys);
tokenSwap.update(accountInfos); // Synchronous
```

## Get output amount
```typescript
let routeData: RouteData = tokenSwap.getRouteData( // Synchronous
    tokenFrom: PublicKey, 
    tokenTo: PublicKey,
    fromAmount: number,
);
type RouteData = {
    fromAmount: number,
    toAmount: number,
    fromTokenId: number,
    toTokenId: number,
    swapAccounts: {
        program: PublicKey,
        fundState: PublicKey,
        authority: PublicKey,
        source: PublicKey,
        destination: PublicKey,
        fees: {
            smfWallet: PublicKey,
            hostWallet: PublicKey,
            managerWallet: PublicKey,
            feeTokenMint: PublicKey,
        }
        tokenInfo: PublicKey,
        curveData: PublicKey,
        remainingAccounts: AccountMeta[],
    }
}

// generate swap instruction
let instruction: TransactionInstruction = await tokenSwap
    .generateSwapInstruction(
        routeData: RouteData,
        fromTokenAccount: PublicKey,
        toTokenAccount: PublicKey,
        user?: PublicKey, // no need to provide if wallet was provided,
        slippage?: number, // slippage percentage 1 = 1%, default = 0.5%
    );

// for sol swap, wSol token accounts should be provided.
// associated accounts for user source/destination and
// host/manager/symmetry fee accounts can be created in previous transaction

let tx: TransactionSignature = await tokenSwap.sendTransaction(
    instruction: TransactionInstruction,
    wallet?: Wallet,            // if not provided on init 
    connection?: Connection,    // if not provided on init
);
```
## Helpers
```typescript
// set wallet before executing swap if it wasn't provided upon initialization
tokenSwap. setWallet(wallet: Wallet); // Synchronous

// get available tokens for swap
let tokenList: {
    tokenId: number,
    coingeckoId: string,
    tokenMint: string,
}[] = tokenSwap.getTokenList(); // Synchronous

// check liquidity in a specific fund
let liquidityInfos: {
    tokenMint: string
    coingeckoId: string,
    userCanSellToFund: number,
    userCanBuyFromFund: number,
}[] = await tokenSwap.getLiquidityInfo(fundPubkey: PublicKey);

```
# symmetry-hq-liquidity-sdk
