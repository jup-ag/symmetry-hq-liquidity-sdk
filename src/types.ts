import { AccountMeta, PublicKey } from "@solana/web3.js";
import { BN } from "@project-serum/anchor";

export const FUNDS_PROGRAM_ID = new PublicKey("2KehYt3KsEQR53jYcxjbQp2d2kCp4AkuQW68atufRwSr");
export const FUNDS_PROGRAM_PDA = new PublicKey("BLBYiq48WcLQ5SxiftyKmPtmsZPUBEnDEjqEnKGAR4zx");
export const TOKEN_INFO_ADDRESS = new PublicKey("4Rn7pKKyiSNKZXKCoLqEpRznX1rhveV4dW1DCg6hRoVH");
export const CURVE_DATA_ADDRESS = new PublicKey("4QMjSHuM3iS7Fdfi8kZJfHRKoEJSDHEtEwqbChsTcUVK");
export const SWAP_FEE_ACCOUNT = new PublicKey("AWfpfzA6FYbqx4JLz75PDgsjH7jtBnnmJ6MXW5zNY2Ei");

export type FundStateChainData = {
    version: BN,
    manager: PublicKey,
    fundToken: PublicKey,
    managerFee: BN,
    supplyOutsanding: BN,
    activelyManaged: BN,
    activeBuyStates: BN,

    sellState: BN,
    rebalanceSellState: BN,

    hostPubkey: PublicKey,
    hostFee: BN,

    numOfTokens: BN,     
    currentCompToken: BN[],
    currentCompAmount: BN[],
    lastRebalanceTime: BN[],
    targetWeight: BN[],
    weightSum: BN,

    currentWeight: BN[],
    fundWorth: BN,
    lastUpdateTime: BN,

    refilterInterval: BN,
    reweightInterval: BN,
    rebalanceInterval: BN,
    rebalanceThreshold: BN,
    rebalanceSlippage: BN,
    lpOffsetThreshold: BN,
    lastRefilterTime: BN,
    lastReweightTime: BN,

    rulesReady: BN,
    assetPool: BN[],
    numOfRules: BN,      
    rules: {
        filterBy: BN,
        filterDays: BN,
        sortBy: BN,
        totalWeight: BN,
        fixedAsset: BN,
        numAssets: BN,
        weightBy: BN,  
        weightDays: BN,
        weightExpo: BN,
        excludeNum: BN,
        excludeAssets: BN[],
        ruleAssets: BN[],
    }[],

    numRuleTokens: BN,   
    ruleTokens: BN[],
    ruleTokenWeights: BN[],

    messageDigestFive: BN[],

    fundLpFee: BN,
    symmetryLpFee: BN,
    extraBytes: BN[],
}

export type TokenInfoData = {
    id: number,
    symbol: string,
    name: string,
    mint: string,
    pdaAccount: string,
    pyth: string,
    decimals: number,
    coingeckoId: string,
}

export type RouteData = {
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

export type CurveChainData = {
    buy: TokenPriceData[],
    sell: TokenPriceData[],
}

export type TokenPriceData = {
    amount: BN[],
    price: BN[],
}
