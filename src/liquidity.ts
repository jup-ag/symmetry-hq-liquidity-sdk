import { BN, Program } from "@project-serum/anchor";
import { PriceData } from "@pythnetwork/client";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { FundsIDL } from "./fundsIDL";
import { Token, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { calculateOutputAmountForBuyingAsset, calculateOutputValueForSellingAsset } from "./helpers";
import { FundStateChainData, FUNDS_PROGRAM_ID, FUNDS_PROGRAM_PDA, CurveChainData, CURVE_DATA_ADDRESS, RouteData, SWAP_FEE_ACCOUNT, TokenInfoData, TOKEN_INFO_ADDRESS } from "./types";

export function availableRoutes(
    tokenInfoData: TokenInfoData[],
    fund: FundStateChainData,
    pythPrices: PriceData[],
): {
    tokenMint: string,
    coingeckoId: string,
    userCanSellToFund: number,
    userCanBuyFromFund: number,
}[] {
    let fundWorth: number = 0;
    let numTokens = fund.numOfTokens.toNumber();

    for(let i=0; i<numTokens; i++) {
        let token = fund.currentCompToken[i].toNumber();
        let amount = fund.currentCompAmount[i].toNumber();
        let priceData = pythPrices[token];
        let price = priceData.aggregate.price;
        let tokenAmount = amount / 10 ** tokenInfoData[token].decimals;
        let tokenValue = price * tokenAmount;
        fundWorth += tokenValue;
    }

    let result: {
        tokenMint: string
        userCanSellToFund: number,
        userCanBuyFromFund: number,
        coingeckoId: string,
    }[] = [];

    for(let i=0; i<numTokens; i++) {
        let token = fund.currentCompToken[i].toNumber();
        let amount = fund.currentCompAmount[i].toNumber();
        let priceData = pythPrices[token];
        let price = priceData.aggregate.price;
        let tokenAmount = amount / 10 ** tokenInfoData[token].decimals;
        let tokenValue = price * tokenAmount;
        let offset = (fund.rebalanceThreshold.toNumber() / 10000) * (fund.lpOffsetThreshold.toNumber() / 10000);
        let maxWorth = fundWorth * fund.targetWeight[i].toNumber()
            / fund.weightSum.toNumber() * (1 + offset);
        let minWorth = fundWorth * fund.targetWeight[i].toNumber()
            / fund.weightSum.toNumber() * (1 - offset);
        result.push({
            tokenMint: tokenInfoData[token].mint,
            coingeckoId: tokenInfoData[token].coingeckoId,
            userCanSellToFund: Math.max(0, (maxWorth - tokenValue) / price),
            userCanBuyFromFund: Math.max(0, (tokenValue - minWorth) / price),
        })
    }

    return result;
}

export function checkForLiquidity(
    tokenInfoData: TokenInfoData[],
    curveChainData: CurveChainData,
    fundAddress: PublicKey,
    fund: FundStateChainData,
    pythPrices: PriceData[],
    tokenFrom: number,
    tokenTo: number,
    fromAmount: number,
): RouteData|undefined {
    let initialAmount = fromAmount;
    let fundWorth: number = 0;
    let numTokens = fund.numOfTokens.toNumber();
    let fromTokenIndex = -1;
    let toTokenIndex = -1;
    for(let i=0; i<numTokens; i++) {
        let token = fund.currentCompToken[i].toNumber();
        let amount = fund.currentCompAmount[i].toNumber();
        let priceData = pythPrices[token];
        let price = priceData.aggregate.price;
        let tokenAmount = amount / 10 ** tokenInfoData[token].decimals;
        let tokenValue = price * tokenAmount;
        fundWorth += tokenValue;
        if (token == tokenFrom)
            fromTokenIndex = i;
        if (token == tokenTo)
            toTokenIndex = i;
    }
    if (fromTokenIndex == -1 || toTokenIndex == -1 || fundWorth == 0)
        return undefined;
    
    let weightSum = fund.weightSum.toNumber();

    let fromDecimals = 10 ** tokenInfoData[tokenFrom].decimals;
    let fromTokenPythPrice = pythPrices[tokenFrom].aggregate.price;

    let toDecimals = 10 ** tokenInfoData[tokenTo].decimals;
    let toTokenPythPrice = pythPrices[tokenTo].aggregate.price;
    
    let fromTokenValue = fromAmount * fromTokenPythPrice / fromDecimals;

    let fromTokenTargetAmount: number = 
        (fund.targetWeight[fromTokenIndex].toNumber() * fundWorth / fund.weightSum.toNumber())
        * fromDecimals
        / fromTokenPythPrice;
    let toTokenTargetAmount: number =
        (fund.targetWeight[toTokenIndex].toNumber() * fundWorth / fund.weightSum.toNumber())
        * toDecimals
        / toTokenPythPrice;
    let value: number = fromTokenValue;
    if(tokenFrom != 0) {
        value = calculateOutputValueForSellingAsset(
            fund.currentCompAmount[fromTokenIndex].toNumber(),
            Math.floor(fromTokenTargetAmount),
            Math.floor(fromTokenPythPrice * 1000000),
            fromAmount,
            curveChainData.sell[tokenFrom],
            tokenInfoData[tokenFrom].decimals,
        ) / 1000000;
    }
    let toAmount: number = value * toDecimals / toTokenPythPrice;
    if(tokenTo != 0) {
        toAmount = calculateOutputAmountForBuyingAsset(
            fund.currentCompAmount[toTokenIndex].toNumber(),
            Math.floor(toTokenTargetAmount),
            Math.floor(toTokenPythPrice * 1000000),
            Math.floor(value * 1000000),
            curveChainData.buy[tokenTo],
            tokenInfoData[tokenTo].decimals
        );
    }

    let valueWithoutCurve = fromTokenValue;
    if(tokenFrom != 0)
        valueWithoutCurve = fromTokenValue * (1000000 - 5) / 1000000;
    let amountWithoutCurve = valueWithoutCurve * toDecimals / toTokenPythPrice;
    if(tokenTo != 0)
        amountWithoutCurve = amountWithoutCurve * (1000000 - 5) / 1000000;

    if(amountWithoutCurve > fund.currentCompAmount[toTokenIndex].toNumber()){
        amountWithoutCurve = fund.currentCompAmount[toTokenIndex].toNumber();
    }

    if(toAmount > amountWithoutCurve){
        toAmount = amountWithoutCurve;
    }
    let fee = amountWithoutCurve - toAmount;

    let fromTokenTargetPercentage = fund.targetWeight[fromTokenIndex].toNumber() / weightSum;
    let fromTokenAvailableAmount = fund.currentCompAmount[fromTokenIndex].toNumber();
    
    let toTokenTargetPercentage = fund.targetWeight[toTokenIndex].toNumber() / weightSum;
    let toTokenAvailableAmount = fund.currentCompAmount[toTokenIndex].toNumber();

    let toAmountAfter = (toTokenAvailableAmount - toAmount) / toDecimals;
    let toOffset = (fund.rebalanceThreshold.toNumber() / 10000) * (fund.lpOffsetThreshold.toNumber() / 10000);
    if ( toAmountAfter * toTokenPythPrice / fundWorth < toTokenTargetPercentage * (1 - toOffset))
        return undefined;

    let fromAmountAfter = (fromTokenAvailableAmount + fromAmount) / fromDecimals;
    let fromOffset = (fund.rebalanceThreshold.toNumber() / 10000) * (fund.lpOffsetThreshold.toNumber() / 10000);
    if ((fromAmountAfter * fromTokenPythPrice / fundWorth > fromTokenTargetPercentage * (1 + fromOffset)) &&
        tokenFrom != 0
    ) return undefined;
    let pythAccounts = [];
    for (let i = 0; i < fund.numOfTokens.toNumber(); i++)
        pythAccounts.push({
            pubkey: new PublicKey(
                tokenInfoData[fund.currentCompToken[i].toNumber()].pyth
            ),
            isSigner: false,
            isWritable: false,
        })
    return {
        fromAmount: initialAmount / fromDecimals,
        toAmount: toAmount / toDecimals,
        fromTokenId: tokenFrom,
        toTokenId: tokenTo,
        swapAccounts: {
            program: FUNDS_PROGRAM_ID,
            fundState: fundAddress,
            authority: FUNDS_PROGRAM_PDA,
            source: new PublicKey(tokenInfoData[tokenFrom].pdaAccount),
            destination:  new PublicKey(tokenInfoData[tokenTo].pdaAccount),
            fees: {
                smfWallet: SWAP_FEE_ACCOUNT,
                hostWallet: fund.hostPubkey,
                managerWallet: fund.manager,
                feeTokenMint: new PublicKey(tokenInfoData[tokenTo].mint)
            },
            tokenInfo: TOKEN_INFO_ADDRESS,
            curveData: CURVE_DATA_ADDRESS,
            remainingAccounts: pythAccounts,
        }
    }
}

export function loadRouteData(
    tokenInfoData: TokenInfoData[],
    curveChainData: CurveChainData,
    funds: {pubkey: PublicKey, fund: FundStateChainData}[],
    pythPrices: PriceData[],
    tokenFrom: number|undefined,
    tokenTo: number|undefined,
    fromAmount: number,
): RouteData {
    if (tokenFrom == undefined || tokenTo == undefined)
        throw new Error("From or To tokens are not defined");

    let fromTokenAmount = fromAmount * 10 ** tokenInfoData[tokenFrom].decimals;
    let bestRouteData: RouteData = {
        fromAmount: 0,
        toAmount: 0,
        fromTokenId: 0,
        toTokenId: 0,
        swapAccounts: {
            program: FUNDS_PROGRAM_ID,
            fundState: PublicKey.default,
            authority: FUNDS_PROGRAM_PDA,
            source: PublicKey.default,
            destination:  PublicKey.default,
            fees: {
                smfWallet: SWAP_FEE_ACCOUNT,
                hostWallet: PublicKey.default,
                managerWallet: PublicKey.default,
                feeTokenMint: PublicKey.default
            },
            tokenInfo: TOKEN_INFO_ADDRESS,
            curveData: CURVE_DATA_ADDRESS,
            remainingAccounts: [],
        }
    };
    for (let i = 0; i < funds.length; i++) {
        let routeData = checkForLiquidity(
            tokenInfoData,
            curveChainData,
            funds[i].pubkey,
            funds[i].fund,
            pythPrices,
            tokenFrom,
            tokenTo,
            fromTokenAmount,
        );
        if(!routeData) continue;
        if (routeData.toAmount > bestRouteData.toAmount)
            bestRouteData = routeData;
    }
    return bestRouteData;
    
}

export async function generateSwapInstruction(
    program: Program<FundsIDL>,
    user: PublicKey,
    tokenInfoData: TokenInfoData[],
    routeData: RouteData,
    userFromTokenAccount: PublicKey,
    userToTokenAccount: PublicKey,
    slippage: number = 0.5,
): Promise<TransactionInstruction> {
    let { fromTokenId, toTokenId, fromAmount, toAmount } = routeData;
    let minimumReceived = toAmount * (1 - slippage / 100);
    return await program.methods
        .swapFundTokens(
            new BN(fromTokenId),
            new BN(toTokenId),
            new BN(
                Math.floor(
                    fromAmount * 10 ** tokenInfoData[fromTokenId].decimals
                )
            ),
            new BN(
                Math.floor(
                    minimumReceived * 10 ** tokenInfoData[toTokenId].decimals
                )
            ),
        )
        .accounts({
            buyer: user,
            fundState: routeData.swapAccounts.fundState,
            pdaAccount: routeData.swapAccounts.authority,
            pdaFromTokenAccount: routeData.swapAccounts.source,
            buyerFromTokenAccount: userFromTokenAccount,
            pdaToTokenAccount: routeData.swapAccounts.destination,
            buyerToTokenAccount: userToTokenAccount,
            swapFeeAccount: await Token.getAssociatedTokenAddress(
                ASSOCIATED_TOKEN_PROGRAM_ID,
                TOKEN_PROGRAM_ID,
                routeData.swapAccounts.fees.feeTokenMint,
                routeData.swapAccounts.fees.smfWallet
            ),
            hostFeeAccount: await Token.getAssociatedTokenAddress(
                ASSOCIATED_TOKEN_PROGRAM_ID,
                TOKEN_PROGRAM_ID,
                routeData.swapAccounts.fees.feeTokenMint,
                routeData.swapAccounts.fees.hostWallet
            ),
            managerFeeAccount: await Token.getAssociatedTokenAddress(
                ASSOCIATED_TOKEN_PROGRAM_ID,
                TOKEN_PROGRAM_ID,
                routeData.swapAccounts.fees.feeTokenMint,
                routeData.swapAccounts.fees.managerWallet
            ),
            tokenInfo: routeData.swapAccounts.tokenInfo,
            prismData: routeData.swapAccounts.curveData,
            tokenProgram: TOKEN_PROGRAM_ID
        })
        .remainingAccounts(routeData.swapAccounts.remainingAccounts)
        .instruction();
}
