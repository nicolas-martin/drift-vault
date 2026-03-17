import {
  initializeDriftClient,
  getVaultUsdcBalance,
  getVaultTotalEquity,
  getSolPrice,
  getUnrealizedFundingPnl,
} from './driftClient';
import {
  openDeltaNeutralPosition,
  closeAllPositions,
  rebalanceIfNeeded,
  settleFunding,
} from './strategy';
import {
  getFundingSnapshot,
  shouldOpenPosition,
  shouldClosePosition,
  FundingSnapshot,
} from './fundingMonitor';
import { getHealthStatus, checkHealthAndAlert, HealthStatus } from './health';
import { checkPendingWithdrawals } from './withdrawHandler';
import { getPositionState, logPositionState, hasOpenPositions, PositionState } from './rebalancer';
import { DRIFT_ENV, VAULT_ADDRESS, StrategyParams } from './config';
import { logger, setupGlobalErrorHandlers } from './logger';

// =============================================================================
// Constants
// =============================================================================

const MIN_USDC_TO_DEPLOY = 100;

// =============================================================================
// Startup Banner
// =============================================================================

function logStartupBanner(): void {
  logger.info('========================================');
  logger.info('Delta-Neutral Funding Rate Vault Keeper');
  logger.info('========================================');
  logger.info(`Environment: ${DRIFT_ENV}`);
  logger.info(`Vault Address: ${VAULT_ADDRESS || 'NOT SET'}`);
  logger.info(`Loop Interval: ${StrategyParams.LOOP_INTERVAL_MS}ms`);
  logger.info(`Min Funding Rate: ${StrategyParams.MIN_FUNDING_RATE_THRESHOLD}% APR`);
  logger.info(`Close Threshold: ${StrategyParams.NEGATIVE_FUNDING_CLOSE_THRESHOLD}% APR`);
  logger.info(`Rebalance Threshold: ${StrategyParams.REBALANCE_THRESHOLD_PCT}%`);
  logger.info(`Health Min Threshold: ${StrategyParams.HEALTH_MIN_THRESHOLD}%`);
  logger.info('========================================');
}

// =============================================================================
// Status Logging
// =============================================================================

function logLoopStatus(
  loopNumber: number,
  equity: number,
  usdcBalance: number,
  positionState: PositionState,
  fundingSnapshot: FundingSnapshot,
  healthStatus: HealthStatus,
  fundingPnl: number
): void {
  const timestamp = new Date().toISOString();

  // Derive health status label
  const healthLabel = healthStatus.isCritical
    ? 'critical'
    : healthStatus.isHealthy
      ? 'healthy'
      : 'warning';

  logger.info(`--- Loop #${loopNumber} | ${timestamp} ---`);
  logger.info(`Vault Equity: $${equity.toFixed(2)}`);
  logger.info(`USDC Balance: $${usdcBalance.toFixed(2)}`);
  logger.info(`SOL Spot: ${positionState.spotSolSize.toFixed(4)} ($${positionState.spotUsdValue.toFixed(2)})`);
  logger.info(`SOL Perp: ${positionState.perpSolSize.toFixed(4)} ($${positionState.perpUsdValue.toFixed(2)})`);
  logger.info(`Funding Rate: ${(fundingSnapshot.fundingRate * 100).toFixed(6)}%/hr (${fundingSnapshot.fundingApr.toFixed(2)}% APR)`);
  logger.info(`Funding PnL: $${fundingPnl.toFixed(2)}`);
  logger.info(`SOL Price: $${fundingSnapshot.oraclePrice.toFixed(2)}`);
  logger.info(`Account Health: ${healthStatus.health.toFixed(2)}% (${healthLabel})`);
}

// =============================================================================
// Main Keeper Loop
// =============================================================================

async function main(): Promise<void> {
  // Setup global error handlers
  setupGlobalErrorHandlers();

  // Log startup banner
  logStartupBanner();

  // Initialize Drift client
  logger.info('Initializing Drift client...');
  await initializeDriftClient();
  logger.info('Drift client initialized successfully');

  let loopNumber = 0;

  // Main keeper loop
  while (true) {
    loopNumber++;

    try {
      // =========================================================================
      // Gather State
      // =========================================================================
      const fundingSnapshot = getFundingSnapshot();
      const healthStatus = getHealthStatus();
      const positionState = getPositionState();
      const usdcBalance = getVaultUsdcBalance();
      const equity = getVaultTotalEquity();
      const fundingPnl = getUnrealizedFundingPnl();

      // =========================================================================
      // Log Status
      // =========================================================================
      logLoopStatus(
        loopNumber,
        equity,
        usdcBalance,
        positionState,
        fundingSnapshot,
        healthStatus,
        fundingPnl
      );

      // =========================================================================
      // Health Check
      // =========================================================================
      checkHealthAndAlert(healthStatus);

      if (healthStatus.isCritical && hasOpenPositions(positionState)) {
        logger.error('CRITICAL: Health below threshold with open positions - closing all positions');
        await closeAllPositions();
        logger.info('Positions closed due to critical health');
        await sleep(StrategyParams.LOOP_INTERVAL_MS);
        continue;
      }

      // =========================================================================
      // Settle Funding (always)
      // =========================================================================
      await settleFunding();

      // =========================================================================
      // Check Pending Withdrawals
      // =========================================================================
      const withdrawalStatus = await checkPendingWithdrawals();
      const hasPendingWithdrawals = withdrawalStatus.hasPending;

      // =========================================================================
      // Strategy Decisions
      // =========================================================================
      if (hasOpenPositions(positionState)) {
        // We have open positions
        if (shouldClosePosition(fundingSnapshot.fundingApr)) {
          logger.info('Funding rate unfavorable - closing all positions');
          await closeAllPositions();
          logger.info('Positions closed');
        } else {
          // Check if rebalancing is needed
          await rebalanceIfNeeded();
        }
      } else {
        // No open positions
        if (hasPendingWithdrawals) {
          logger.info('Pending withdrawals detected - not opening new positions');
        } else if (shouldOpenPosition(fundingSnapshot.fundingApr) && usdcBalance > MIN_USDC_TO_DEPLOY) {
          logger.info('Funding rate favorable - opening delta-neutral position');
          await openDeltaNeutralPosition();
          logger.info('Delta-neutral position opened');
        } else {
          if (usdcBalance <= MIN_USDC_TO_DEPLOY) {
            logger.info(`Waiting - insufficient USDC balance ($${usdcBalance.toFixed(2)} < $${MIN_USDC_TO_DEPLOY})`);
          } else {
            logger.info(`Waiting - funding rate ${fundingSnapshot.fundingApr.toFixed(2)}% APR below threshold ${StrategyParams.MIN_FUNDING_RATE_THRESHOLD}%`);
          }
        }
      }

      // =========================================================================
      // Sleep
      // =========================================================================
      logger.debug(`Sleeping for ${StrategyParams.LOOP_INTERVAL_MS}ms...`);
      await sleep(StrategyParams.LOOP_INTERVAL_MS);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error(`Error in keeper loop #${loopNumber}`, {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Entry Point
// =============================================================================

main().catch((error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  logger.error('Fatal error in main', {
    error: errorMessage,
    stack: errorStack,
  });

  process.exit(1);
});
