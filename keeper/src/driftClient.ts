import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
	DriftClient,
	Wallet,
	initialize,
	User,
	getMarketsAndOraclesForSubscription,
	BN,
	PRICE_PRECISION,
	BASE_PRECISION,
	QUOTE_PRECISION,
	convertToNumber,
	PositionDirection,
	OrderType,
	MarketType,
	getMarketOrderParams,
	UnifiedSwapClient,
	PerpMarkets,
	SpotMarkets,
} from '@drift-labs/sdk';
import * as fs from 'fs';

import { RPC_URL, DELEGATE_KEYPAIR_PATH, VAULT_ADDRESS, DRIFT_ENV, JUPITER_API_KEY } from './config';

// Derive WSS URL from RPC URL
function getWssUrl(rpcUrl: string): string {
	return rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://');
}

// Create config object for backward compatibility
const CONFIG = {
	RPC_URL,
	WSS_URL: getWssUrl(RPC_URL),
	DELEGATE_KEYPAIR_PATH,
	VAULT_ADDRESS,
	DRIFT_ENV,
};

// Re-export SDK types for use by other modules
export {
	DriftClient,
	Wallet,
	User,
	BN,
	PRICE_PRECISION,
	BASE_PRECISION,
	QUOTE_PRECISION,
	convertToNumber,
	PositionDirection,
	OrderType,
	MarketType,
	getMarketOrderParams,
	UnifiedSwapClient,
};

// Module-level client instances
let driftClient: DriftClient | null = null;
let swapClient: UnifiedSwapClient | null = null;
let vaultUser: User | null = null;

// Market indices
const SOL_PERP_MARKET_INDEX = 0;
const SOL_SPOT_MARKET_INDEX = 1;
const USDC_SPOT_MARKET_INDEX = 0;

// Decimals for token conversions
const SOL_DECIMALS = 9;
const USDC_DECIMALS = 6;

/**
 * Initialize the Drift client and swap client
 * @returns Object containing driftClient and swapClient instances
 */
export async function initializeDriftClient(): Promise<{
	driftClient: DriftClient;
	swapClient: UnifiedSwapClient;
}> {
	// Create connection with confirmed commitment and WSS endpoint
	const connection = new Connection(CONFIG.RPC_URL, {
		commitment: 'confirmed',
		wsEndpoint: CONFIG.WSS_URL,
	});

	// Load delegate keypair from file
	const keypairData = JSON.parse(
		fs.readFileSync(CONFIG.DELEGATE_KEYPAIR_PATH, 'utf-8')
	);
	const delegateKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
	const wallet = new Wallet(delegateKeypair);

	// Initialize SDK config for the environment
	const sdkConfig = initialize({ env: CONFIG.DRIFT_ENV });

	// Get markets and oracles for subscription
	const { perpMarketIndexes, spotMarketIndexes, oracleInfos } =
		getMarketsAndOraclesForSubscription(CONFIG.DRIFT_ENV);

	// Create vault authority public key
	const vaultAuthority = new PublicKey(CONFIG.VAULT_ADDRESS);

	// Create DriftClient instance (websocket subscription — no batch RPC needed)
	driftClient = new DriftClient({
		connection,
		wallet,
		programID: new PublicKey(sdkConfig.DRIFT_PROGRAM_ID),
		accountSubscription: { type: 'websocket' },
		perpMarketIndexes,
		spotMarketIndexes,
		oracleInfos,
		authority: vaultAuthority,
		includeDelegates: true,
		env: CONFIG.DRIFT_ENV,
	});

	// Subscribe to account updates
	await driftClient.subscribe();

	// Initialize unified swap client (Jupiter-backed)
	swapClient = new UnifiedSwapClient({
		clientType: 'jupiter',
		connection,
		authToken: JUPITER_API_KEY,
	});

	return { driftClient, swapClient };
}

/**
 * Get the vault's USDC balance
 * @returns USDC balance in human-readable units
 */
export function getVaultUsdcBalance(): number {
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
	return convertToNumber(tokenAmount, QUOTE_PRECISION);
}

/**
 * Get the vault's SOL spot position
 * @returns SOL spot position in SOL units
 */
export function getVaultSolSpotPosition(): number {
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
	const solPrecision = new BN(10).pow(new BN(SOL_DECIMALS));
	return convertToNumber(tokenAmount, solPrecision);
}

/**
 * Get the vault's SOL perpetual position
 * @returns SOL perp position in SOL units (negative = short)
 */
export function getVaultSolPerpPosition(): number {
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
	return convertToNumber(baseAssetAmount, BASE_PRECISION);
}

/**
 * Get the current funding rate for SOL perp
 * @returns Funding rate as decimal fraction per hour
 */
export function getCurrentFundingRate(): number {
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
	const fundingRateNum = convertToNumber(lastFundingRate, PRICE_PRECISION);
	const oraclePriceNum = convertToNumber(oraclePrice, PRICE_PRECISION);

	// Funding rate is per oracle price, normalize to get decimal rate
	return fundingRateNum / oraclePriceNum;
}

/**
 * Get the current SOL price from oracle
 * @returns SOL price in USD
 */
export function getSolPrice(): number {
	if (!driftClient) {
		throw new Error('DriftClient not initialized');
	}

	const oracleData = driftClient.getOracleDataForPerpMarket(
		SOL_PERP_MARKET_INDEX
	);

	if (!oracleData) {
		throw new Error('Oracle data not available for SOL');
	}

	return convertToNumber(oracleData.price, PRICE_PRECISION);
}

/**
 * Get account health as percentage
 * @returns Health 0-100 (100 = fully safe, 0 = liquidation threshold)
 */
export function getAccountHealth(): number {
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
	const totalCollateralNum = convertToNumber(totalCollateral, QUOTE_PRECISION);
	const maintenanceMarginNum = convertToNumber(
		maintenanceMarginReq,
		QUOTE_PRECISION
	);

	if (totalCollateralNum <= 0) {
		return 0;
	}

	// Calculate health percentage
	const healthRatio =
		(totalCollateralNum - maintenanceMarginNum) / totalCollateralNum;
	const health = Math.max(0, Math.min(100, healthRatio * 100));

	return health;
}

/**
 * Get unrealized funding PnL
 * @returns Unrealized funding PnL in USD
 */
export function getUnrealizedFundingPnl(): number {
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
	return convertToNumber(unrealizedFundingPnl, QUOTE_PRECISION);
}

/**
 * Get vault total equity
 * @returns Total collateral/equity in USD
 */
export function getVaultTotalEquity(): number {
	if (!driftClient) {
		throw new Error('DriftClient not initialized');
	}

	const user = driftClient.getUser();
	const totalCollateral = user.getTotalCollateral();

	return convertToNumber(totalCollateral, QUOTE_PRECISION);
}

/**
 * Get the DriftClient instance
 * @returns DriftClient instance
 * @throws Error if not initialized
 */
export function getDriftClient(): DriftClient {
	if (!driftClient) {
		throw new Error('DriftClient not initialized. Call initializeDriftClient first.');
	}
	return driftClient;
}

/**
 * Get the UnifiedSwapClient instance
 * @returns UnifiedSwapClient instance
 * @throws Error if not initialized
 */
export function getSwapClient(): UnifiedSwapClient {
	if (!swapClient) {
		throw new Error('SwapClient not initialized. Call initializeDriftClient first.');
	}
	return swapClient;
}
