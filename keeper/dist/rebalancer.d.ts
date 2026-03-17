export interface PositionState {
    /** SOL spot position size in SOL units */
    spotSolSize: number;
    /** SOL perp position size in SOL units (negative = short) */
    perpSolSize: number;
    /** Spot position USD value */
    spotUsdValue: number;
    /** Perp position USD value (absolute) */
    perpUsdValue: number;
    /** Imbalance percentage between spot and perp */
    imbalancePct: number;
    /** Whether positions are balanced within threshold */
    isBalanced: boolean;
}
/**
 * Get the current state of spot and perp positions
 * @returns PositionState with all position details
 */
export declare function getPositionState(): PositionState;
/**
 * Log the current position state in human-readable format
 * @param state Position state to log
 */
export declare function logPositionState(state: PositionState): void;
/**
 * Check if positions exist (either spot or perp)
 * @param state Position state
 * @returns true if there are any open positions
 */
export declare function hasOpenPositions(state: PositionState): boolean;
//# sourceMappingURL=rebalancer.d.ts.map