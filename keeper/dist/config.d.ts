export declare const RPC_URL: string;
export declare const DELEGATE_KEYPAIR_PATH: string;
export declare const VAULT_ADDRESS: string;
export declare const DRIFT_ENV: "devnet" | "mainnet-beta";
export declare const MarketIndexes: {
    readonly USDC_SPOT: 0;
    readonly SOL_SPOT: 1;
    readonly SOL_PERP: 0;
    readonly BTC_PERP: 1;
    readonly ETH_PERP: 2;
};
export type SpotMarketIndex = typeof MarketIndexes.USDC_SPOT | typeof MarketIndexes.SOL_SPOT;
export type PerpMarketIndex = typeof MarketIndexes.SOL_PERP | typeof MarketIndexes.BTC_PERP | typeof MarketIndexes.ETH_PERP;
export declare const StrategyParams: {
    /**
     * Minimum annualized funding rate (%) to open a position.
     * Only enter positions when funding rate exceeds this threshold.
     */
    readonly MIN_FUNDING_RATE_THRESHOLD: number;
    /**
     * Threshold annualized funding rate (%) at which to close positions.
     * Close position if funding turns negative by more than this amount.
     */
    readonly NEGATIVE_FUNDING_CLOSE_THRESHOLD: number;
    /**
     * Maximum position size in USD for any single market.
     */
    readonly MAX_POSITION_SIZE_USD: number;
    /**
     * Rebalance threshold percentage.
     * Trigger rebalance when spot/perp ratio drifts by more than this %.
     */
    readonly REBALANCE_THRESHOLD_PCT: number;
    /**
     * Minimum health ratio to maintain (0-100).
     * Close positions if account health drops below this threshold.
     */
    readonly HEALTH_MIN_THRESHOLD: number;
    /**
     * Main loop interval in milliseconds.
     */
    readonly LOOP_INTERVAL_MS: number;
};
/**
 * Fraction of available capital to deploy (0-1).
 * Keep some buffer for fees and unexpected movements.
 */
export declare const DEPLOY_FRACTION = 0.9;
/**
 * Maximum allowed slippage in basis points (1 bps = 0.01%).
 */
export declare const MAX_SLIPPAGE_BPS = 50;
export declare function validateConfig(): void;
export declare const config: {
    readonly RPC_URL: string;
    readonly DELEGATE_KEYPAIR_PATH: string;
    readonly VAULT_ADDRESS: string;
    readonly DRIFT_ENV: "devnet" | "mainnet-beta";
    readonly MarketIndexes: {
        readonly USDC_SPOT: 0;
        readonly SOL_SPOT: 1;
        readonly SOL_PERP: 0;
        readonly BTC_PERP: 1;
        readonly ETH_PERP: 2;
    };
    readonly StrategyParams: {
        /**
         * Minimum annualized funding rate (%) to open a position.
         * Only enter positions when funding rate exceeds this threshold.
         */
        readonly MIN_FUNDING_RATE_THRESHOLD: number;
        /**
         * Threshold annualized funding rate (%) at which to close positions.
         * Close position if funding turns negative by more than this amount.
         */
        readonly NEGATIVE_FUNDING_CLOSE_THRESHOLD: number;
        /**
         * Maximum position size in USD for any single market.
         */
        readonly MAX_POSITION_SIZE_USD: number;
        /**
         * Rebalance threshold percentage.
         * Trigger rebalance when spot/perp ratio drifts by more than this %.
         */
        readonly REBALANCE_THRESHOLD_PCT: number;
        /**
         * Minimum health ratio to maintain (0-100).
         * Close positions if account health drops below this threshold.
         */
        readonly HEALTH_MIN_THRESHOLD: number;
        /**
         * Main loop interval in milliseconds.
         */
        readonly LOOP_INTERVAL_MS: number;
    };
    readonly DEPLOY_FRACTION: 0.9;
    readonly MAX_SLIPPAGE_BPS: 50;
    readonly validate: typeof validateConfig;
};
export default config;
//# sourceMappingURL=config.d.ts.map