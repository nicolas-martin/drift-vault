/**
 * Opens a delta-neutral position by buying spot SOL and shorting equivalent SOL-PERP.
 *
 * Strategy: Buy spot SOL + Short equal amount of SOL-PERP = delta neutral
 *
 * This captures the funding rate on the short perp while being hedged against
 * SOL price movements via the long spot position.
 */
export declare function openDeltaNeutralPosition(): Promise<void>;
/**
 * Closes all positions - both the short perp and long spot.
 *
 * Called when:
 * - Funding rate turns negative beyond threshold
 * - Account health becomes critical
 * - Manual wind-down requested
 */
export declare function closeAllPositions(): Promise<void>;
/**
 * Rebalances positions if the spot/perp imbalance exceeds threshold.
 *
 * Positions can drift apart due to:
 * - Partial fills
 * - Price movements affecting margin
 * - Manual adjustments
 *
 * If imbalance > REBALANCE_THRESHOLD_PCT, adjust the smaller side.
 */
export declare function rebalanceIfNeeded(): Promise<void>;
/**
 * Settles accrued funding payments to realize PnL.
 *
 * Funding payments accumulate over time on perpetual positions.
 * This function settles them to convert unrealized PnL to realized PnL.
 */
export declare function settleFunding(): Promise<void>;
//# sourceMappingURL=strategy.d.ts.map