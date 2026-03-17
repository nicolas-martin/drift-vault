"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fundingMonitor = void 0;
exports.getFundingSnapshot = getFundingSnapshot;
exports.shouldOpenPosition = shouldOpenPosition;
exports.shouldClosePosition = shouldClosePosition;
exports.formatFundingInfo = formatFundingInfo;
const driftClient_1 = require("./driftClient");
const config_1 = require("./config");
const logger_1 = require("./logger");
// =============================================================================
// Funding Rate Analysis
// =============================================================================
/**
 * Get a snapshot of current funding rate data
 * @returns FundingSnapshot with current funding rate, APR, and oracle price
 */
function getFundingSnapshot() {
    try {
        const fundingRate = (0, driftClient_1.getCurrentFundingRate)();
        // Calculate APR: rate per hour * 24 hours * 365 days * 100 for percentage
        const fundingApr = fundingRate * 24 * 365 * 100;
        const oraclePrice = (0, driftClient_1.getSolPrice)();
        const snapshot = {
            timestamp: Date.now(),
            fundingRate,
            fundingApr,
            oraclePrice,
        };
        logger_1.logger.debug('Funding snapshot captured', {
            fundingRate: fundingRate.toFixed(6),
            fundingApr: fundingApr.toFixed(2),
            oraclePrice: oraclePrice.toFixed(2),
        });
        return snapshot;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('Failed to get funding snapshot', { error: message });
        throw error;
    }
}
// =============================================================================
// Position Decision Logic
// =============================================================================
/**
 * Determine if conditions are favorable to open a new position
 * @param fundingRate - Current funding rate (APR percentage)
 * @returns true if funding rate exceeds minimum threshold
 */
function shouldOpenPosition(fundingRate) {
    const threshold = config_1.StrategyParams.MIN_FUNDING_RATE_THRESHOLD;
    const shouldOpen = fundingRate > threshold;
    logger_1.logger.debug('Evaluating position open', {
        fundingRate: fundingRate.toFixed(2),
        threshold,
        shouldOpen,
    });
    return shouldOpen;
}
/**
 * Determine if position should be closed due to unfavorable funding
 * @param fundingRate - Current funding rate (APR percentage)
 * @returns true if funding rate is below negative threshold
 */
function shouldClosePosition(fundingRate) {
    const threshold = config_1.StrategyParams.NEGATIVE_FUNDING_CLOSE_THRESHOLD;
    const shouldClose = fundingRate < threshold;
    logger_1.logger.debug('Evaluating position close', {
        fundingRate: fundingRate.toFixed(2),
        threshold,
        shouldClose,
    });
    return shouldClose;
}
// =============================================================================
// Formatting
// =============================================================================
/**
 * Format funding snapshot for logging/display
 * @param snapshot - FundingSnapshot to format
 * @returns Formatted string with rate, APR, and price
 */
function formatFundingInfo(snapshot) {
    const ratePerHour = (snapshot.fundingRate * 100).toFixed(4);
    const apr = snapshot.fundingApr.toFixed(2);
    const price = snapshot.oraclePrice.toFixed(2);
    return `Funding: ${ratePerHour}%/hr | APR: ${apr}% | SOL Price: $${price}`;
}
// =============================================================================
// Export
// =============================================================================
exports.fundingMonitor = {
    getFundingSnapshot,
    shouldOpenPosition,
    shouldClosePosition,
    formatFundingInfo,
};
exports.default = exports.fundingMonitor;
//# sourceMappingURL=fundingMonitor.js.map