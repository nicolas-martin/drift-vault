"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthMonitor = void 0;
exports.getHealthStatus = getHealthStatus;
exports.checkHealthAndAlert = checkHealthAndAlert;
exports.formatHealthInfo = formatHealthInfo;
const driftClient_1 = require("./driftClient");
const config_1 = require("./config");
const logger_1 = require("./logger");
const sdk_1 = require("@drift-labs/sdk");
// =============================================================================
// Health Monitoring
// =============================================================================
/**
 * Get current account health status
 * @returns HealthStatus with all relevant health metrics
 */
function getHealthStatus() {
    try {
        const health = (0, driftClient_1.getAccountHealth)();
        const totalCollateral = (0, driftClient_1.getVaultTotalEquity)();
        // Get maintenance margin and free collateral from Drift user
        const driftClient = (0, driftClient_1.getDriftClient)();
        const user = driftClient.getUser();
        const maintenanceMargin = (0, sdk_1.convertToNumber)(user.getMaintenanceMarginRequirement(), sdk_1.QUOTE_PRECISION);
        const freeCollateral = (0, sdk_1.convertToNumber)(user.getFreeCollateral(), sdk_1.QUOTE_PRECISION);
        const isHealthy = health > config_1.StrategyParams.HEALTH_MIN_THRESHOLD;
        const isCritical = health < 20;
        const status = {
            health,
            totalCollateral,
            maintenanceMargin,
            freeCollateral,
            isHealthy,
            isCritical,
        };
        logger_1.logger.debug('Health status retrieved', {
            health,
            totalCollateral: totalCollateral.toFixed(2),
            maintenanceMargin: maintenanceMargin.toFixed(2),
            freeCollateral: freeCollateral.toFixed(2),
            isHealthy,
            isCritical,
        });
        return status;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('Failed to get health status', { error: message });
        throw error;
    }
}
// =============================================================================
// Alerting
// =============================================================================
/**
 * Check health status and log appropriate warnings/alerts
 * @param status - HealthStatus to evaluate
 */
function checkHealthAndAlert(status) {
    if (status.isCritical) {
        (0, logger_1.logHealth)('error', 'CRITICAL: Account health is critically low!', {
            health: status.health,
            totalCollateral: status.totalCollateral,
            maintenanceMargin: status.maintenanceMargin,
            action: 'Immediate position reduction recommended',
        });
        return;
    }
    if (!status.isHealthy) {
        (0, logger_1.logHealth)('warn', 'Account health below minimum threshold', {
            health: status.health,
            threshold: config_1.StrategyParams.HEALTH_MIN_THRESHOLD,
            totalCollateral: status.totalCollateral,
            maintenanceMargin: status.maintenanceMargin,
            action: 'Consider reducing position size',
        });
        return;
    }
    (0, logger_1.logHealth)('debug', 'Account health OK', {
        health: status.health,
        freeCollateral: status.freeCollateral,
    });
}
// =============================================================================
// Formatting
// =============================================================================
/**
 * Format health status for logging/display
 * @param status - HealthStatus to format
 * @returns Formatted string with health metrics
 */
function formatHealthInfo(status) {
    const healthStr = status.health.toFixed(1);
    const collateralStr = status.totalCollateral.toFixed(2);
    const marginStr = status.maintenanceMargin.toFixed(2);
    const freeStr = status.freeCollateral.toFixed(2);
    const statusIndicator = status.isCritical
        ? '[CRITICAL]'
        : status.isHealthy
            ? '[OK]'
            : '[WARNING]';
    return `Health: ${healthStr}% ${statusIndicator} | Collateral: $${collateralStr} | Margin: $${marginStr} | Free: $${freeStr}`;
}
// =============================================================================
// Export
// =============================================================================
exports.healthMonitor = {
    getHealthStatus,
    checkHealthAndAlert,
    formatHealthInfo,
};
exports.default = exports.healthMonitor;
//# sourceMappingURL=health.js.map