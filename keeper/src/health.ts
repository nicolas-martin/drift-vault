import { getAccountHealth, getVaultTotalEquity, getDriftClient } from './driftClient';
import { StrategyParams } from './config';
import { logger, logHealth } from './logger';
import { QUOTE_PRECISION, convertToNumber } from '@drift-labs/sdk';

// =============================================================================
// Types
// =============================================================================

export interface HealthStatus {
	/** Account health as percentage (0-100) */
	health: number;
	/** Total collateral value in USD */
	totalCollateral: number;
	/** Maintenance margin requirement in USD */
	maintenanceMargin: number;
	/** Free collateral available for new positions in USD */
	freeCollateral: number;
	/** Whether health is above minimum threshold */
	isHealthy: boolean;
	/** Whether health is critically low (<20) */
	isCritical: boolean;
}

// =============================================================================
// Health Monitoring
// =============================================================================

/**
 * Get current account health status
 * @returns HealthStatus with all relevant health metrics
 */
export function getHealthStatus(): HealthStatus {
	try {
		const health = getAccountHealth();
		const totalCollateral = getVaultTotalEquity();

		// Get maintenance margin and free collateral from Drift user
		const driftClient = getDriftClient();
		const user = driftClient.getUser();
		const maintenanceMargin = convertToNumber(
			user.getMaintenanceMarginRequirement(),
			QUOTE_PRECISION
		);
		const freeCollateral = convertToNumber(
			user.getFreeCollateral(),
			QUOTE_PRECISION
		);

		const isHealthy = health > StrategyParams.HEALTH_MIN_THRESHOLD;
		// Critical = below the configured minimum threshold (triggers emergency close)
		const isCritical = health < StrategyParams.HEALTH_MIN_THRESHOLD;

		const status: HealthStatus = {
			health,
			totalCollateral,
			maintenanceMargin,
			freeCollateral,
			isHealthy,
			isCritical,
		};

		logger.debug('Health status retrieved', {
			health,
			totalCollateral: totalCollateral.toFixed(2),
			maintenanceMargin: maintenanceMargin.toFixed(2),
			freeCollateral: freeCollateral.toFixed(2),
			isHealthy,
			isCritical,
		});

		return status;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to get health status', { error: message });
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
export function checkHealthAndAlert(status: HealthStatus): void {
	if (status.isCritical) {
		logHealth('error', 'CRITICAL: Account health is critically low!', {
			health: status.health,
			totalCollateral: status.totalCollateral,
			maintenanceMargin: status.maintenanceMargin,
			action: 'Immediate position reduction recommended',
		});
		return;
	}

	if (!status.isHealthy) {
		logHealth('warn', 'Account health below minimum threshold', {
			health: status.health,
			threshold: StrategyParams.HEALTH_MIN_THRESHOLD,
			totalCollateral: status.totalCollateral,
			maintenanceMargin: status.maintenanceMargin,
			action: 'Consider reducing position size',
		});
		return;
	}

	logHealth('debug', 'Account health OK', {
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
export function formatHealthInfo(status: HealthStatus): string {
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

export const healthMonitor = {
	getHealthStatus,
	checkHealthAndAlert,
	formatHealthInfo,
};

export default healthMonitor;
