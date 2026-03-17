"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = exports.MAX_SLIPPAGE_BPS = exports.DEPLOY_FRACTION = exports.StrategyParams = exports.MarketIndexes = exports.DRIFT_ENV = exports.VAULT_ADDRESS = exports.DELEGATE_KEYPAIR_PATH = exports.RPC_URL = void 0;
exports.validateConfig = validateConfig;
const web3_js_1 = require("@solana/web3.js");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// =============================================================================
// Environment Variable Helpers
// =============================================================================
function getEnvVar(key, defaultValue) {
    const value = process.env[key];
    if (value === undefined) {
        if (defaultValue !== undefined) {
            return defaultValue;
        }
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}
function getEnvVarAsNumber(key, defaultValue) {
    const value = process.env[key];
    if (value === undefined) {
        return defaultValue;
    }
    const parsed = Number(value);
    if (isNaN(parsed)) {
        throw new Error(`Environment variable ${key} must be a valid number, got: ${value}`);
    }
    return parsed;
}
// =============================================================================
// Core Configuration
// =============================================================================
exports.RPC_URL = getEnvVar('RPC_URL', 'https://api.devnet.solana.com');
exports.DELEGATE_KEYPAIR_PATH = getEnvVar('DELEGATE_KEYPAIR_PATH', './keypairs/delegate.json');
exports.VAULT_ADDRESS = getEnvVar('VAULT_ADDRESS', '');
exports.DRIFT_ENV = getEnvVar('DRIFT_ENV', 'devnet');
// =============================================================================
// Market Indexes
// =============================================================================
exports.MarketIndexes = {
    // Spot Markets
    USDC_SPOT: 0,
    SOL_SPOT: 1,
    // Perp Markets
    SOL_PERP: 0,
    BTC_PERP: 1,
    ETH_PERP: 2,
};
// =============================================================================
// Strategy Parameters
// =============================================================================
exports.StrategyParams = {
    /**
     * Minimum annualized funding rate (%) to open a position.
     * Only enter positions when funding rate exceeds this threshold.
     */
    MIN_FUNDING_RATE_THRESHOLD: getEnvVarAsNumber('MIN_FUNDING_RATE_THRESHOLD', 10),
    /**
     * Threshold annualized funding rate (%) at which to close positions.
     * Close position if funding turns negative by more than this amount.
     */
    NEGATIVE_FUNDING_CLOSE_THRESHOLD: getEnvVarAsNumber('NEGATIVE_FUNDING_CLOSE_THRESHOLD', -5),
    /**
     * Maximum position size in USD for any single market.
     */
    MAX_POSITION_SIZE_USD: getEnvVarAsNumber('MAX_POSITION_SIZE_USD', 100000),
    /**
     * Rebalance threshold percentage.
     * Trigger rebalance when spot/perp ratio drifts by more than this %.
     */
    REBALANCE_THRESHOLD_PCT: getEnvVarAsNumber('REBALANCE_THRESHOLD_PCT', 5),
    /**
     * Minimum health ratio to maintain (0-100).
     * Close positions if account health drops below this threshold.
     */
    HEALTH_MIN_THRESHOLD: getEnvVarAsNumber('HEALTH_MIN_THRESHOLD', 20),
    /**
     * Main loop interval in milliseconds.
     */
    LOOP_INTERVAL_MS: getEnvVarAsNumber('LOOP_INTERVAL_MS', 60000),
};
// =============================================================================
// Trading Constants
// =============================================================================
/**
 * Fraction of available capital to deploy (0-1).
 * Keep some buffer for fees and unexpected movements.
 */
exports.DEPLOY_FRACTION = 0.9;
/**
 * Maximum allowed slippage in basis points (1 bps = 0.01%).
 */
exports.MAX_SLIPPAGE_BPS = 50;
// =============================================================================
// Validation
// =============================================================================
function validateConfig() {
    // Validate VAULT_ADDRESS if provided
    if (exports.VAULT_ADDRESS) {
        try {
            new web3_js_1.PublicKey(exports.VAULT_ADDRESS);
        }
        catch {
            throw new Error(`Invalid VAULT_ADDRESS: ${exports.VAULT_ADDRESS}`);
        }
    }
    // Validate DRIFT_ENV
    if (exports.DRIFT_ENV !== 'devnet' && exports.DRIFT_ENV !== 'mainnet-beta') {
        throw new Error(`Invalid DRIFT_ENV: ${exports.DRIFT_ENV}. Must be 'devnet' or 'mainnet-beta'`);
    }
    // Validate strategy params
    if (exports.StrategyParams.MIN_FUNDING_RATE_THRESHOLD < 0) {
        throw new Error('MIN_FUNDING_RATE_THRESHOLD must be non-negative');
    }
    if (exports.StrategyParams.MAX_POSITION_SIZE_USD <= 0) {
        throw new Error('MAX_POSITION_SIZE_USD must be positive');
    }
    if (exports.StrategyParams.REBALANCE_THRESHOLD_PCT <= 0 || exports.StrategyParams.REBALANCE_THRESHOLD_PCT > 100) {
        throw new Error('REBALANCE_THRESHOLD_PCT must be between 0 and 100');
    }
    if (exports.StrategyParams.HEALTH_MIN_THRESHOLD < 0 || exports.StrategyParams.HEALTH_MIN_THRESHOLD > 100) {
        throw new Error('HEALTH_MIN_THRESHOLD must be between 0 and 100');
    }
    if (exports.StrategyParams.LOOP_INTERVAL_MS < 1000) {
        throw new Error('LOOP_INTERVAL_MS must be at least 1000ms');
    }
    if (exports.DEPLOY_FRACTION <= 0 || exports.DEPLOY_FRACTION > 1) {
        throw new Error('DEPLOY_FRACTION must be between 0 and 1');
    }
    if (exports.MAX_SLIPPAGE_BPS < 0 || exports.MAX_SLIPPAGE_BPS > 1000) {
        throw new Error('MAX_SLIPPAGE_BPS must be between 0 and 1000');
    }
}
// =============================================================================
// Config Object Export
// =============================================================================
exports.config = {
    RPC_URL: exports.RPC_URL,
    DELEGATE_KEYPAIR_PATH: exports.DELEGATE_KEYPAIR_PATH,
    VAULT_ADDRESS: exports.VAULT_ADDRESS,
    DRIFT_ENV: exports.DRIFT_ENV,
    MarketIndexes: exports.MarketIndexes,
    StrategyParams: exports.StrategyParams,
    DEPLOY_FRACTION: exports.DEPLOY_FRACTION,
    MAX_SLIPPAGE_BPS: exports.MAX_SLIPPAGE_BPS,
    validate: validateConfig,
};
exports.default = exports.config;
//# sourceMappingURL=config.js.map