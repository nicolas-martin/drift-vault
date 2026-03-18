import { PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';

dotenv.config();

// =============================================================================
// Environment Variable Helpers
// =============================================================================

function getEnvVar(key: string, defaultValue?: string): string {
	const value = process.env[key];
	if (value === undefined) {
		if (defaultValue !== undefined) {
			return defaultValue;
		}
		throw new Error(`Missing required environment variable: ${key}`);
	}
	return value;
}

function getEnvVarAsNumber(key: string, defaultValue: number): number {
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

export const RPC_URL = getEnvVar('RPC_URL');

export const DELEGATE_KEYPAIR_PATH = getEnvVar('DELEGATE_KEYPAIR_PATH', './keypairs/delegate.json');

export const VAULT_ADDRESS = getEnvVar('VAULT_ADDRESS', '');

export const DRIFT_ENV = getEnvVar('DRIFT_ENV', 'mainnet-beta') as 'devnet' | 'mainnet-beta';

export const JUPITER_API_KEY = getEnvVar('JUPITER_API_KEY', '');

// =============================================================================
// Market Indexes
// =============================================================================

export const MarketIndexes = {
	// Spot Markets
	USDC_SPOT: 0,
	SOL_SPOT: 1,

	// Perp Markets
	SOL_PERP: 0,
	BTC_PERP: 1,
	ETH_PERP: 2,
} as const;

export type SpotMarketIndex = typeof MarketIndexes.USDC_SPOT | typeof MarketIndexes.SOL_SPOT;
export type PerpMarketIndex =
	| typeof MarketIndexes.SOL_PERP
	| typeof MarketIndexes.BTC_PERP
	| typeof MarketIndexes.ETH_PERP;

// =============================================================================
// Strategy Parameters
// =============================================================================

export const StrategyParams = {
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
	MAX_POSITION_SIZE_USD: getEnvVarAsNumber('MAX_POSITION_SIZE_USD', 100_000),

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
	LOOP_INTERVAL_MS: getEnvVarAsNumber('LOOP_INTERVAL_MS', 60_000),
} as const;

// =============================================================================
// Trading Constants
// =============================================================================

/**
 * Fraction of available capital to deploy (0-1).
 * Keep some buffer for fees and unexpected movements.
 */
export const DEPLOY_FRACTION = 0.9;

/**
 * Maximum allowed slippage in basis points (1 bps = 0.01%).
 */
export const MAX_SLIPPAGE_BPS = 50;

// =============================================================================
// Validation
// =============================================================================

export function validateConfig(): void {
	// VAULT_ADDRESS is required
	if (!VAULT_ADDRESS) {
		throw new Error('VAULT_ADDRESS is not set. Run scripts/init-vault.sh to initialize a vault and set VAULT_ADDRESS in keeper/.env');
	}
	try {
		new PublicKey(VAULT_ADDRESS);
	} catch {
		throw new Error(`Invalid VAULT_ADDRESS: "${VAULT_ADDRESS}" is not a valid Solana public key`);
	}

	// Validate DRIFT_ENV
	if (DRIFT_ENV !== 'devnet' && DRIFT_ENV !== 'mainnet-beta') {
		throw new Error(`Invalid DRIFT_ENV: ${DRIFT_ENV}. Must be 'devnet' or 'mainnet-beta'`);
	}

	// JUPITER_API_KEY is required for swaps
	if (!JUPITER_API_KEY) {
		throw new Error('JUPITER_API_KEY is not set. Get a free key at https://portal.jup.ag');
	}

	// Validate strategy params
	if (StrategyParams.MIN_FUNDING_RATE_THRESHOLD < 0) {
		throw new Error('MIN_FUNDING_RATE_THRESHOLD must be non-negative');
	}

	if (StrategyParams.MAX_POSITION_SIZE_USD <= 0) {
		throw new Error('MAX_POSITION_SIZE_USD must be positive');
	}

	if (StrategyParams.REBALANCE_THRESHOLD_PCT <= 0 || StrategyParams.REBALANCE_THRESHOLD_PCT > 100) {
		throw new Error('REBALANCE_THRESHOLD_PCT must be between 0 and 100');
	}

	if (StrategyParams.HEALTH_MIN_THRESHOLD < 0 || StrategyParams.HEALTH_MIN_THRESHOLD > 100) {
		throw new Error('HEALTH_MIN_THRESHOLD must be between 0 and 100');
	}

	if (StrategyParams.LOOP_INTERVAL_MS < 1000) {
		throw new Error('LOOP_INTERVAL_MS must be at least 1000ms');
	}

	if (DEPLOY_FRACTION <= 0 || DEPLOY_FRACTION > 1) {
		throw new Error('DEPLOY_FRACTION must be between 0 and 1');
	}

	if (MAX_SLIPPAGE_BPS < 0 || MAX_SLIPPAGE_BPS > 1000) {
		throw new Error('MAX_SLIPPAGE_BPS must be between 0 and 1000');
	}
}

// =============================================================================
// Config Object Export
// =============================================================================

export const config = {
	RPC_URL,
	DELEGATE_KEYPAIR_PATH,
	VAULT_ADDRESS,
	DRIFT_ENV,
	JUPITER_API_KEY,
	MarketIndexes,
	StrategyParams,
	DEPLOY_FRACTION,
	MAX_SLIPPAGE_BPS,
	validate: validateConfig,
} as const;

export default config;
