import { DriftClient, Wallet, BulkAccountLoader, User, BN, PRICE_PRECISION, BASE_PRECISION, QUOTE_PRECISION, convertToNumber, PositionDirection, OrderType, MarketType, getMarketOrderParams, JupiterClient } from '@drift-labs/sdk';
export { DriftClient, Wallet, BulkAccountLoader, User, BN, PRICE_PRECISION, BASE_PRECISION, QUOTE_PRECISION, convertToNumber, PositionDirection, OrderType, MarketType, getMarketOrderParams, JupiterClient, };
/**
 * Initialize the Drift client and Jupiter client
 * @returns Object containing driftClient and jupiterClient instances
 */
export declare function initializeDriftClient(): Promise<{
    driftClient: DriftClient;
    jupiterClient: JupiterClient;
}>;
/**
 * Get the vault's USDC balance
 * @returns USDC balance in human-readable units
 */
export declare function getVaultUsdcBalance(): number;
/**
 * Get the vault's SOL spot position
 * @returns SOL spot position in SOL units
 */
export declare function getVaultSolSpotPosition(): number;
/**
 * Get the vault's SOL perpetual position
 * @returns SOL perp position in SOL units (negative = short)
 */
export declare function getVaultSolPerpPosition(): number;
/**
 * Get the current funding rate for SOL perp
 * @returns Funding rate as decimal fraction per hour
 */
export declare function getCurrentFundingRate(): number;
/**
 * Get the current SOL price from oracle
 * @returns SOL price in USD
 */
export declare function getSolPrice(): number;
/**
 * Get account health as percentage
 * @returns Health 0-100 (100 = fully safe, 0 = liquidation threshold)
 */
export declare function getAccountHealth(): number;
/**
 * Get unrealized funding PnL
 * @returns Unrealized funding PnL in USD
 */
export declare function getUnrealizedFundingPnl(): number;
/**
 * Get vault total equity
 * @returns Total collateral/equity in USD
 */
export declare function getVaultTotalEquity(): number;
/**
 * Get the DriftClient instance
 * @returns DriftClient instance
 * @throws Error if not initialized
 */
export declare function getDriftClient(): DriftClient;
/**
 * Get the JupiterClient instance
 * @returns JupiterClient instance
 * @throws Error if not initialized
 */
export declare function getJupiterClient(): JupiterClient;
//# sourceMappingURL=driftClient.d.ts.map