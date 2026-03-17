"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const driftClient_1 = require("./driftClient");
const strategy_1 = require("./strategy");
const fundingMonitor_1 = require("./fundingMonitor");
const health_1 = require("./health");
const withdrawHandler_1 = require("./withdrawHandler");
const rebalancer_1 = require("./rebalancer");
const config_1 = require("./config");
const logger_1 = require("./logger");
// =============================================================================
// Constants
// =============================================================================
const MIN_USDC_TO_DEPLOY = 100;
// =============================================================================
// Startup Banner
// =============================================================================
function logStartupBanner() {
    logger_1.logger.info('========================================');
    logger_1.logger.info('Delta-Neutral Funding Rate Vault Keeper');
    logger_1.logger.info('========================================');
    logger_1.logger.info(`Environment: ${config_1.DRIFT_ENV}`);
    logger_1.logger.info(`Vault Address: ${config_1.VAULT_ADDRESS || 'NOT SET'}`);
    logger_1.logger.info(`Loop Interval: ${config_1.StrategyParams.LOOP_INTERVAL_MS}ms`);
    logger_1.logger.info(`Min Funding Rate: ${config_1.StrategyParams.MIN_FUNDING_RATE_THRESHOLD}% APR`);
    logger_1.logger.info(`Close Threshold: ${config_1.StrategyParams.NEGATIVE_FUNDING_CLOSE_THRESHOLD}% APR`);
    logger_1.logger.info(`Rebalance Threshold: ${config_1.StrategyParams.REBALANCE_THRESHOLD_PCT}%`);
    logger_1.logger.info(`Health Min Threshold: ${config_1.StrategyParams.HEALTH_MIN_THRESHOLD}%`);
    logger_1.logger.info('========================================');
}
// =============================================================================
// Status Logging
// =============================================================================
function logLoopStatus(loopNumber, equity, usdcBalance, positionState, fundingSnapshot, healthStatus, fundingPnl) {
    const timestamp = new Date().toISOString();
    // Derive health status label
    const healthLabel = healthStatus.isCritical
        ? 'critical'
        : healthStatus.isHealthy
            ? 'healthy'
            : 'warning';
    logger_1.logger.info(`--- Loop #${loopNumber} | ${timestamp} ---`);
    logger_1.logger.info(`Vault Equity: $${equity.toFixed(2)}`);
    logger_1.logger.info(`USDC Balance: $${usdcBalance.toFixed(2)}`);
    logger_1.logger.info(`SOL Spot: ${positionState.spotSolSize.toFixed(4)} ($${positionState.spotUsdValue.toFixed(2)})`);
    logger_1.logger.info(`SOL Perp: ${positionState.perpSolSize.toFixed(4)} ($${positionState.perpUsdValue.toFixed(2)})`);
    logger_1.logger.info(`Funding Rate: ${(fundingSnapshot.fundingRate * 100).toFixed(6)}%/hr (${fundingSnapshot.fundingApr.toFixed(2)}% APR)`);
    logger_1.logger.info(`Funding PnL: $${fundingPnl.toFixed(2)}`);
    logger_1.logger.info(`SOL Price: $${fundingSnapshot.oraclePrice.toFixed(2)}`);
    logger_1.logger.info(`Account Health: ${healthStatus.health.toFixed(2)}% (${healthLabel})`);
}
// =============================================================================
// Main Keeper Loop
// =============================================================================
async function main() {
    // Setup global error handlers
    (0, logger_1.setupGlobalErrorHandlers)();
    // Log startup banner
    logStartupBanner();
    // Initialize Drift client
    logger_1.logger.info('Initializing Drift client...');
    await (0, driftClient_1.initializeDriftClient)();
    logger_1.logger.info('Drift client initialized successfully');
    let loopNumber = 0;
    // Main keeper loop
    while (true) {
        loopNumber++;
        try {
            // =========================================================================
            // Gather State
            // =========================================================================
            const fundingSnapshot = (0, fundingMonitor_1.getFundingSnapshot)();
            const healthStatus = (0, health_1.getHealthStatus)();
            const positionState = (0, rebalancer_1.getPositionState)();
            const usdcBalance = (0, driftClient_1.getVaultUsdcBalance)();
            const equity = (0, driftClient_1.getVaultTotalEquity)();
            const fundingPnl = (0, driftClient_1.getUnrealizedFundingPnl)();
            // =========================================================================
            // Log Status
            // =========================================================================
            logLoopStatus(loopNumber, equity, usdcBalance, positionState, fundingSnapshot, healthStatus, fundingPnl);
            // =========================================================================
            // Health Check
            // =========================================================================
            (0, health_1.checkHealthAndAlert)(healthStatus);
            if (healthStatus.isCritical && (0, rebalancer_1.hasOpenPositions)(positionState)) {
                logger_1.logger.error('CRITICAL: Health below threshold with open positions - closing all positions');
                await (0, strategy_1.closeAllPositions)();
                logger_1.logger.info('Positions closed due to critical health');
                await sleep(config_1.StrategyParams.LOOP_INTERVAL_MS);
                continue;
            }
            // =========================================================================
            // Settle Funding (always)
            // =========================================================================
            await (0, strategy_1.settleFunding)();
            // =========================================================================
            // Check Pending Withdrawals
            // =========================================================================
            const withdrawalStatus = await (0, withdrawHandler_1.checkPendingWithdrawals)();
            const hasPendingWithdrawals = withdrawalStatus.hasPending;
            // =========================================================================
            // Strategy Decisions
            // =========================================================================
            if ((0, rebalancer_1.hasOpenPositions)(positionState)) {
                // We have open positions
                if ((0, fundingMonitor_1.shouldClosePosition)(fundingSnapshot.fundingApr)) {
                    logger_1.logger.info('Funding rate unfavorable - closing all positions');
                    await (0, strategy_1.closeAllPositions)();
                    logger_1.logger.info('Positions closed');
                }
                else {
                    // Check if rebalancing is needed
                    await (0, strategy_1.rebalanceIfNeeded)();
                }
            }
            else {
                // No open positions
                if (hasPendingWithdrawals) {
                    logger_1.logger.info('Pending withdrawals detected - not opening new positions');
                }
                else if ((0, fundingMonitor_1.shouldOpenPosition)(fundingSnapshot.fundingApr) && usdcBalance > MIN_USDC_TO_DEPLOY) {
                    logger_1.logger.info('Funding rate favorable - opening delta-neutral position');
                    await (0, strategy_1.openDeltaNeutralPosition)();
                    logger_1.logger.info('Delta-neutral position opened');
                }
                else {
                    if (usdcBalance <= MIN_USDC_TO_DEPLOY) {
                        logger_1.logger.info(`Waiting - insufficient USDC balance ($${usdcBalance.toFixed(2)} < $${MIN_USDC_TO_DEPLOY})`);
                    }
                    else {
                        logger_1.logger.info(`Waiting - funding rate ${fundingSnapshot.fundingApr.toFixed(2)}% APR below threshold ${config_1.StrategyParams.MIN_FUNDING_RATE_THRESHOLD}%`);
                    }
                }
            }
            // =========================================================================
            // Sleep
            // =========================================================================
            logger_1.logger.debug(`Sleeping for ${config_1.StrategyParams.LOOP_INTERVAL_MS}ms...`);
            await sleep(config_1.StrategyParams.LOOP_INTERVAL_MS);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger_1.logger.error(`Error in keeper loop #${loopNumber}`, {
                error: errorMessage,
                stack: errorStack,
            });
            // Don't crash - continue loop after a brief pause
            await sleep(5000);
        }
    }
}
// =============================================================================
// Utility Functions
// =============================================================================
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// =============================================================================
// Entry Point
// =============================================================================
main().catch((error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger_1.logger.error('Fatal error in main', {
        error: errorMessage,
        stack: errorStack,
    });
    process.exit(1);
});
//# sourceMappingURL=index.js.map