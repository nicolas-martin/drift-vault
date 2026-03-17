"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPositionState = getPositionState;
exports.logPositionState = logPositionState;
exports.hasOpenPositions = hasOpenPositions;
const driftClient_1 = require("./driftClient");
const config_1 = require("./config");
const logger_1 = require("./logger");
// =============================================================================
// Position State Functions
// =============================================================================
/**
 * Get the current state of spot and perp positions
 * @returns PositionState with all position details
 */
function getPositionState() {
    const spotSolSize = (0, driftClient_1.getVaultSolSpotPosition)();
    const perpSolSize = (0, driftClient_1.getVaultSolPerpPosition)();
    const solPrice = (0, driftClient_1.getSolPrice)();
    // Calculate USD values
    const spotUsdValue = spotSolSize * solPrice;
    const perpUsdValue = Math.abs(perpSolSize) * solPrice;
    // Calculate imbalance percentage
    // For delta-neutral: spot should equal |perp| (perp is negative for short)
    // Imbalance = |spotUsd - perpUsd| / max(spotUsd, perpUsd) * 100
    const maxValue = Math.max(spotUsdValue, perpUsdValue);
    const imbalancePct = maxValue > 0
        ? (Math.abs(spotUsdValue - perpUsdValue) / maxValue) * 100
        : 0;
    const isBalanced = imbalancePct < config_1.StrategyParams.REBALANCE_THRESHOLD_PCT;
    return {
        spotSolSize,
        perpSolSize,
        spotUsdValue,
        perpUsdValue,
        imbalancePct,
        isBalanced,
    };
}
/**
 * Log the current position state in human-readable format
 * @param state Position state to log
 */
function logPositionState(state) {
    const perpDirection = state.perpSolSize < 0 ? 'SHORT' : state.perpSolSize > 0 ? 'LONG' : 'NONE';
    logger_1.logger.info('Position State', {
        component: 'rebalancer',
        spotSol: state.spotSolSize.toFixed(4),
        spotUsd: `$${state.spotUsdValue.toFixed(2)}`,
        perpSol: `${state.perpSolSize.toFixed(4)} (${perpDirection})`,
        perpUsd: `$${state.perpUsdValue.toFixed(2)}`,
        imbalance: `${state.imbalancePct.toFixed(2)}%`,
        isBalanced: state.isBalanced,
    });
    if (!state.isBalanced) {
        logger_1.logger.warn('Position imbalance detected', {
            component: 'rebalancer',
            imbalancePct: state.imbalancePct.toFixed(2),
            threshold: config_1.StrategyParams.REBALANCE_THRESHOLD_PCT,
        });
    }
}
/**
 * Check if positions exist (either spot or perp)
 * @param state Position state
 * @returns true if there are any open positions
 */
function hasOpenPositions(state) {
    return Math.abs(state.spotSolSize) > 0.0001 || Math.abs(state.perpSolSize) > 0.0001;
}
//# sourceMappingURL=rebalancer.js.map