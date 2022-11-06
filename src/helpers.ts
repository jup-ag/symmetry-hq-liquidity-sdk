import { Program } from "@project-serum/anchor";
import { AccountInfo, PublicKey } from "@solana/web3.js";
import { FundsIDL } from "./fundsIDL";
import { CurveChainData, TokenInfoData, TokenPriceData } from "./types";

export function asciiToString(
    coingeckoIdAscii: number[],
): string {
    let coingeckoId: string = "";
    for(let i=0; i<coingeckoIdAscii.length; i++)
        if(coingeckoIdAscii[i] != 0)
            coingeckoId += String.fromCharCode(coingeckoIdAscii[i]).toString();
    return coingeckoId;
}

export function decodeTokenInfo(
    program: Program<FundsIDL>,
    tokenInfoAccountInfo: AccountInfo<Buffer>,
): TokenInfoData[] {
    let state = program.coder.accounts.decode("tokenInfo", tokenInfoAccountInfo.data);
    let numTokens = state.numTokens.toNumber();
    let tokens = [];
    for (let i = 0; i < numTokens; i++) {
        tokens.push({
            id: i,
            symbol: "",
            name: "",
            mint: state.tokenMint[i].toBase58(),
            pdaAccount: state.pdaTokenAccount[i].toBase58(),
            pyth: state.pyth[i].toBase58(),
            decimals: state.decimals[i],
            coingeckoId: asciiToString(state.coingeckoIds[i]),
        });
    }
    return tokens;
}

export function decodeCurveData(
    program: Program<FundsIDL>,
    curveDataAccountInfo: AccountInfo<Buffer>,
): CurveChainData {
    let state = program.coder.accounts.decode("prismData", curveDataAccountInfo.data);
    return state;
}

export function findTokenId(
    tokenInfoData: TokenInfoData[],
    tokenMint: PublicKey,
): number|undefined {
    for (let i = 0; i < tokenInfoData.length; i++)
        if (tokenInfoData[i].mint == tokenMint.toBase58())
            return tokenInfoData[i].id;
    return undefined;
}

let NUM_OF_POINTS_IN_PRISM_DATA: number = 10;
export function calculateOutputAmountForBuyingAsset(
    currentAmount: number,
    targetAmount: number,
    pyth: number,
    amountValue: number,
    curveData: TokenPriceData,
    decimals: number,
): number {
    let curveStartAmount: number = 0;
    if(currentAmount < targetAmount)curveStartAmount = targetAmount;
    else curveStartAmount = currentAmount;
    let amountValueLeft: number = amountValue;
    let currentOutputAmount: number = 0;
    let expo = 10 ** decimals;
    let pythPrice = mulDiv(pyth, 1000000 + 5, 1000000);
    let currentPrice: number = pythPrice;
    let amountFromTargetWeight: number = 0;
    for(let step=0; step<NUM_OF_POINTS_IN_PRISM_DATA; step++){
        let priceInInterval = Math.floor((curveData.price[step].toNumber() * 9 + pythPrice) / 10);
        if(priceInInterval > currentPrice){
            currentPrice = priceInInterval;
        }
        amountFromTargetWeight += curveData.amount[step].toNumber();
        if(amountFromTargetWeight <= curveStartAmount - currentAmount)continue;
        let amountInInterval = Math.min(
            amountFromTargetWeight - (curveStartAmount - currentAmount),
            curveData.amount[step].toNumber()
        );
        let valueInInterval = mulDiv(amountInInterval, currentPrice, expo);
        if(valueInInterval > amountValueLeft){
            return mulDiv(amountValueLeft, expo, currentPrice) + currentOutputAmount;
        }
        currentOutputAmount += amountInInterval;
        amountValueLeft -= valueInInterval;
    }
    currentOutputAmount += mulDiv(amountValueLeft, expo, currentPrice);
    return currentOutputAmount;
}

export function calculateOutputValueForSellingAsset(
    currentAmount: number,
    targetAmount: number,
    pyth: number,
    amount: number,
    curveData: TokenPriceData,
    decimals: number,
): number {
    let curveStartAmount: number = 0;
    if(currentAmount > targetAmount)curveStartAmount = targetAmount;
    else curveStartAmount = currentAmount;
    let currentOutputValue: number = 0;
    let amountLeft: number = amount;
    let expo: number = 10 ** decimals;
    let pythPrice = mulDiv(pyth, 1000000 - 5, 1000000);
    let currentPrice: number = pythPrice;
    let amountFromTargetWeight: number = 0;
    for(let step = 0; step < NUM_OF_POINTS_IN_PRISM_DATA; step++){
        let priceInInterval = Math.floor((curveData.price[step].toNumber() * 9 + pythPrice) / 10);
        if(priceInInterval < currentPrice){
            currentPrice = priceInInterval;
        }
        amountFromTargetWeight += curveData.amount[step].toNumber();
        if(amountFromTargetWeight <= currentAmount - curveStartAmount)continue;
        let amountInInterval: number = Math.min(
            amountFromTargetWeight - (currentAmount - curveStartAmount),
            curveData.amount[step].toNumber()
        );
        let valueInInterval = mulDiv(amountInInterval, currentPrice, expo);
        if(amountInInterval > amountLeft){
            return mulDiv(amountLeft, currentPrice, expo) + currentOutputValue;
        }
        currentOutputValue += valueInInterval;
        amountLeft -= amountInInterval;
    }
    currentOutputValue += mulDiv(amountLeft, currentPrice, expo);
    return currentOutputValue;
}

export function mulDiv(a: number, b: number, c: number): number {
    return Math.floor(a * b / c);
}
