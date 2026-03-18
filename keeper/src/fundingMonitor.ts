import { getCurrentFundingRate, getSolPrice } from './driftClient';
import { StrategyParams } from './config';
import { logger } from './logger';

// =============================================================================
// Types
// =============================================================================

export interface FundingSnapshot {
	timestamp: number;
	fundingRate: number;
	fundingApr: number;
	oraclePrice: number;
}

// =============================================================================
// Funding Rate Analysis
// =============================================================================

/**
 * Get a snapshot of current funding rate data
 * @returns FundingSnapshot with current funding rate, APR, and oracle price
 */
export function getFundingSnapshot(): FundingSnapshot {
	try {
		const fundingRate = getCurrentFundingRate();

		// Calculate APR: rate per hour * 24 hours * 365 days * 100 for percentage
		const fundingApr = fundingRate * 24 * 365 * 100;

		const oraclePrice = getSolPrice();

		const snapshot: FundingSnapshot = {
			timestamp: Date.now(),
			fundingRate,
			fundingApr,
			oraclePrice,
		};

		logger.debug('Funding snapshot captured', {
			fundingRate: fundingRate.toFixed(6),
			fundingApr: fundingApr.toFixed(2),
			oraclePrice: oraclePrice.toFixed(2),
		});

		return snapshot;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to get funding snapshot', { error: message });
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
export function shouldOpenPosition(fundingRate: number): boolean {
	const threshold = StrategyParams.MIN_FUNDING_RATE_THRESHOLD;
	const shouldOpen = fundingRate > threshold;

	logger.debug('Evaluating position open', {
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
export function shouldClosePosition(fundingRate: number): boolean {
	const threshold = StrategyParams.NEGATIVE_FUNDING_CLOSE_THRESHOLD;
	const shouldClose = fundingRate < threshold;

	logger.debug('Evaluating position close', {
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
export function formatFundingInfo(snapshot: FundingSnapshot): string {
	const ratePerHour = (snapshot.fundingRate * 100).toFixed(4);
	const apr = snapshot.fundingApr.toFixed(2);
	const price = snapshot.oraclePrice.toFixed(2);

	return `Funding: ${ratePerHour}%/hr | APR: ${apr}% | SOL Price: $${price}`;
}

// =============================================================================
// Export
// =============================================================================

export const fundingMonitor = {
	getFundingSnapshot,
	shouldOpenPosition,
	shouldClosePosition,
	formatFundingInfo,
};

export default fundingMonitor;
