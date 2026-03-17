"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JupiterClient = exports.getMarketOrderParams = exports.MarketType = exports.OrderType = exports.PositionDirection = exports.convertToNumber = exports.QUOTE_PRECISION = exports.BASE_PRECISION = exports.PRICE_PRECISION = exports.BN = exports.User = exports.BulkAccountLoader = exports.Wallet = exports.DriftClient = void 0;
exports.initializeDriftClient = initializeDriftClient;
exports.getVaultUsdcBalance = getVaultUsdcBalance;
exports.getVaultSolSpotPosition = getVaultSolSpotPosition;
exports.getVaultSolPerpPosition = getVaultSolPerpPosition;
exports.getCurrentFundingRate = getCurrentFundingRate;
exports.getSolPrice = getSolPrice;
exports.getAccountHealth = getAccountHealth;
exports.getUnrealizedFundingPnl = getUnrealizedFundingPnl;
exports.getVaultTotalEquity = getVaultTotalEquity;
exports.getDriftClient = getDriftClient;
exports.getJupiterClient = getJupiterClient;
const web3_js_1 = require("@solana/web3.js");
const sdk_1 = require("@drift-labs/sdk");
Object.defineProperty(exports, "DriftClient", { enumerable: true, get: function () { return sdk_1.DriftClient; } });
Object.defineProperty(exports, "Wallet", { enumerable: true, get: function () { return sdk_1.Wallet; } });
Object.defineProperty(exports, "BulkAccountLoader", { enumerable: true, get: function () { return sdk_1.BulkAccountLoader; } });
Object.defineProperty(exports, "User", { enumerable: true, get: function () { return sdk_1.User; } });
Object.defineProperty(exports, "BN", { enumerable: true, get: function () { return sdk_1.BN; } });
Object.defineProperty(exports, "PRICE_PRECISION", { enumerable: true, get: function () { return sdk_1.PRICE_PRECISION; } });
Object.defineProperty(exports, "BASE_PRECISION", { enumerable: true, get: function () { return sdk_1.BASE_PRECISION; } });
Object.defineProperty(exports, "QUOTE_PRECISION", { enumerable: true, get: function () { return sdk_1.QUOTE_PRECISION; } });
Object.defineProperty(exports, "convertToNumber", { enumerable: true, get: function () { return sdk_1.convertToNumber; } });
Object.defineProperty(exports, "PositionDirection", { enumerable: true, get: function () { return sdk_1.PositionDirection; } });
Object.defineProperty(exports, "OrderType", { enumerable: true, get: function () { return sdk_1.OrderType; } });
Object.defineProperty(exports, "MarketType", { enumerable: true, get: function () { return sdk_1.MarketType; } });
Object.defineProperty(exports, "getMarketOrderParams", { enumerable: true, get: function () { return sdk_1.getMarketOrderParams; } });
Object.defineProperty(exports, "JupiterClient", { enumerable: true, get: function () { return sdk_1.JupiterClient; } });
const fs = __importStar(require("fs"));
const config_1 = require("./config");
// Derive WSS URL from RPC URL
function getWssUrl(rpcUrl) {
    return rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://');
}
// Create config object for backward compatibility
const CONFIG = {
    RPC_URL: config_1.RPC_URL,
    WSS_URL: getWssUrl(config_1.RPC_URL),
    DELEGATE_KEYPAIR_PATH: config_1.DELEGATE_KEYPAIR_PATH,
    VAULT_ADDRESS: config_1.VAULT_ADDRESS,
    DRIFT_ENV: config_1.DRIFT_ENV,
};
// Module-level client instances
let driftClient = null;
let jupiterClient = null;
let vaultUser = null;
// Market indices
const SOL_PERP_MARKET_INDEX = 0;
const SOL_SPOT_MARKET_INDEX = 1;
const USDC_SPOT_MARKET_INDEX = 0;
// Decimals for token conversions
const SOL_DECIMALS = 9;
const USDC_DECIMALS = 6;
/**
 * Initialize the Drift client and Jupiter client
 * @returns Object containing driftClient and jupiterClient instances
 */
async function initializeDriftClient() {
    // Create connection with confirmed commitment and WSS endpoint
    const connection = new web3_js_1.Connection(CONFIG.RPC_URL, {
        commitment: 'confirmed',
        wsEndpoint: CONFIG.WSS_URL,
    });
    // Load delegate keypair from file
    const keypairData = JSON.parse(fs.readFileSync(CONFIG.DELEGATE_KEYPAIR_PATH, 'utf-8'));
    const delegateKeypair = web3_js_1.Keypair.fromSecretKey(Uint8Array.from(keypairData));
    const wallet = new sdk_1.Wallet(delegateKeypair);
    // Initialize SDK config for the environment
    const sdkConfig = (0, sdk_1.initialize)({ env: CONFIG.DRIFT_ENV });
    // Create bulk account loader with 1000ms polling interval
    const bulkAccountLoader = new sdk_1.BulkAccountLoader(connection, 'confirmed', 1000);
    // Get markets and oracles for subscription
    const { perpMarketIndexes, spotMarketIndexes, oracleInfos } = (0, sdk_1.getMarketsAndOraclesForSubscription)(CONFIG.DRIFT_ENV);
    // Create vault authority public key
    const vaultAuthority = new web3_js_1.PublicKey(CONFIG.VAULT_ADDRESS);
    // Create DriftClient instance
    driftClient = new sdk_1.DriftClient({
        connection,
        wallet,
        programID: new web3_js_1.PublicKey(sdkConfig.DRIFT_PROGRAM_ID),
        accountSubscription: {
            type: 'polling',
            accountLoader: bulkAccountLoader,
        },
        perpMarketIndexes,
        spotMarketIndexes,
        oracleInfos,
        authority: vaultAuthority,
        includeDelegates: true,
        env: CONFIG.DRIFT_ENV,
    });
    // Subscribe to account updates
    await driftClient.subscribe();
    // Initialize Jupiter client
    jupiterClient = new sdk_1.JupiterClient({
        connection,
    });
    return { driftClient, jupiterClient };
}
/**
 * Get the vault's USDC balance
 * @returns USDC balance in human-readable units
 */
function getVaultUsdcBalance() {
    if (!driftClient) {
        throw new Error('DriftClient not initialized');
    }
    const user = driftClient.getUser();
    const spotPosition = user.getSpotPosition(USDC_SPOT_MARKET_INDEX);
    if (!spotPosition) {
        return 0;
    }
    // Get scaled balance and convert to human-readable units
    const tokenAmount = user.getTokenAmount(USDC_SPOT_MARKET_INDEX);
    return (0, sdk_1.convertToNumber)(tokenAmount, sdk_1.QUOTE_PRECISION);
}
/**
 * Get the vault's SOL spot position
 * @returns SOL spot position in SOL units
 */
function getVaultSolSpotPosition() {
    if (!driftClient) {
        throw new Error('DriftClient not initialized');
    }
    const user = driftClient.getUser();
    const spotPosition = user.getSpotPosition(SOL_SPOT_MARKET_INDEX);
    if (!spotPosition) {
        return 0;
    }
    // Get token amount and convert to SOL units
    const tokenAmount = user.getTokenAmount(SOL_SPOT_MARKET_INDEX);
    const solPrecision = new sdk_1.BN(10).pow(new sdk_1.BN(SOL_DECIMALS));
    return (0, sdk_1.convertToNumber)(tokenAmount, solPrecision);
}
/**
 * Get the vault's SOL perpetual position
 * @returns SOL perp position in SOL units (negative = short)
 */
function getVaultSolPerpPosition() {
    if (!driftClient) {
        throw new Error('DriftClient not initialized');
    }
    const user = driftClient.getUser();
    const perpPosition = user.getPerpPosition(SOL_PERP_MARKET_INDEX);
    if (!perpPosition) {
        return 0;
    }
    // Base asset amount is in BASE_PRECISION
    const baseAssetAmount = perpPosition.baseAssetAmount;
    return (0, sdk_1.convertToNumber)(baseAssetAmount, sdk_1.BASE_PRECISION);
}
/**
 * Get the current funding rate for SOL perp
 * @returns Funding rate as decimal fraction per hour
 */
function getCurrentFundingRate() {
    if (!driftClient) {
        throw new Error('DriftClient not initialized');
    }
    const perpMarket = driftClient.getPerpMarketAccount(SOL_PERP_MARKET_INDEX);
    if (!perpMarket) {
        throw new Error('SOL perp market not found');
    }
    const lastFundingRate = perpMarket.amm.lastFundingRate;
    const oraclePrice = perpMarket.amm.historicalOracleData.lastOraclePrice;
    if (oraclePrice.isZero()) {
        return 0;
    }
    // Funding rate is stored in PRICE_PRECISION
    // Convert to hourly rate as decimal fraction
    const fundingRateNum = (0, sdk_1.convertToNumber)(lastFundingRate, sdk_1.PRICE_PRECISION);
    const oraclePriceNum = (0, sdk_1.convertToNumber)(oraclePrice, sdk_1.PRICE_PRECISION);
    // Funding rate is per oracle price, normalize to get decimal rate
    return fundingRateNum / oraclePriceNum;
}
/**
 * Get the current SOL price from oracle
 * @returns SOL price in USD
 */
function getSolPrice() {
    if (!driftClient) {
        throw new Error('DriftClient not initialized');
    }
    const oracleData = driftClient.getOracleDataForPerpMarket(SOL_PERP_MARKET_INDEX);
    if (!oracleData) {
        throw new Error('Oracle data not available for SOL');
    }
    return (0, sdk_1.convertToNumber)(oracleData.price, sdk_1.PRICE_PRECISION);
}
/**
 * Get account health as percentage
 * @returns Health 0-100 (100 = fully safe, 0 = liquidation threshold)
 */
function getAccountHealth() {
    if (!driftClient) {
        throw new Error('DriftClient not initialized');
    }
    const user = driftClient.getUser();
    // Get total collateral and maintenance margin requirement
    const totalCollateral = user.getTotalCollateral('Maintenance');
    const maintenanceMarginReq = user.getMaintenanceMarginRequirement();
    if (maintenanceMarginReq.isZero()) {
        // No margin requirement means fully safe
        return 100;
    }
    // Health = (totalCollateral - maintenanceMargin) / totalCollateral * 100
    // When totalCollateral equals maintenanceMargin, health = 0 (liquidation)
    // When maintenanceMargin is 0, health = 100
    const totalCollateralNum = (0, sdk_1.convertToNumber)(totalCollateral, sdk_1.QUOTE_PRECISION);
    const maintenanceMarginNum = (0, sdk_1.convertToNumber)(maintenanceMarginReq, sdk_1.QUOTE_PRECISION);
    if (totalCollateralNum <= 0) {
        return 0;
    }
    // Calculate health percentage
    const healthRatio = (totalCollateralNum - maintenanceMarginNum) / totalCollateralNum;
    const health = Math.max(0, Math.min(100, healthRatio * 100));
    return health;
}
/**
 * Get unrealized funding PnL
 * @returns Unrealized funding PnL in USD
 */
function getUnrealizedFundingPnl() {
    if (!driftClient) {
        throw new Error('DriftClient not initialized');
    }
    const user = driftClient.getUser();
    const perpPosition = user.getPerpPosition(SOL_PERP_MARKET_INDEX);
    if (!perpPosition) {
        return 0;
    }
    // Get unrealized funding PnL from the user
    const unrealizedFundingPnl = user.getUnrealizedFundingPNL();
    return (0, sdk_1.convertToNumber)(unrealizedFundingPnl, sdk_1.QUOTE_PRECISION);
}
/**
 * Get vault total equity
 * @returns Total collateral/equity in USD
 */
function getVaultTotalEquity() {
    if (!driftClient) {
        throw new Error('DriftClient not initialized');
    }
    const user = driftClient.getUser();
    const totalCollateral = user.getTotalCollateral();
    return (0, sdk_1.convertToNumber)(totalCollateral, sdk_1.QUOTE_PRECISION);
}
/**
 * Get the DriftClient instance
 * @returns DriftClient instance
 * @throws Error if not initialized
 */
function getDriftClient() {
    if (!driftClient) {
        throw new Error('DriftClient not initialized. Call initializeDriftClient first.');
    }
    return driftClient;
}
/**
 * Get the JupiterClient instance
 * @returns JupiterClient instance
 * @throws Error if not initialized
 */
function getJupiterClient() {
    if (!jupiterClient) {
        throw new Error('JupiterClient not initialized. Call initializeDriftClient first.');
    }
    return jupiterClient;
}
//# sourceMappingURL=driftClient.js.map