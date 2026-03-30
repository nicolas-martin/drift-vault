import {
	getDriftClient,
	getSwapClient,
	getVaultUsdcBalance,
	getVaultSolSpotPosition,
	getVaultSolPerpPosition,
	getCurrentFundingRate,
	getSolPrice,
	getAccountHealth,
	BN,
	PositionDirection,
	OrderType,
	MarketType,
	getMarketOrderParams,
	convertToNumber,
	PRICE_PRECISION,
	BASE_PRECISION,
} from './driftClient';
import { config, MarketIndexes, StrategyParams, DEPLOY_FRACTION, MAX_SLIPPAGE_BPS } from './config';
import { logger } from './logger';
import type { Connection, TransactionSignature } from '@solana/web3.js';

// =============================================================================
// Helpers
// =============================================================================

/** Confirm a transaction using the non-deprecated blockhash-based strategy */
async function confirmTx(connection: Connection, signature: TransactionSignature): Promise<void> {
	const latestBlockhash = await connection.getLatestBlockhash('confirmed');
	await connection.confirmTransaction({ signature, ...latestBlockhash }, 'confirmed');
}

// =============================================================================
// Constants
// =============================================================================

const USDC_PRECISION = new BN(10).pow(new BN(6)); // USDC has 6 decimals
const SOL_PRECISION = new BN(10).pow(new BN(9)); // SOL has 9 decimals
const { MIN_POSITION_SIZE_USD } = StrategyParams;
const MIN_SOL_DUST = 0.001; // Minimum SOL to consider for swapping back

// =============================================================================
// openDeltaNeutralPosition
// =============================================================================

/**
 * Opens a delta-neutral position by buying spot SOL and shorting equivalent SOL-PERP.
 *
 * Strategy: Buy spot SOL + Short equal amount of SOL-PERP = delta neutral
 *
 * This captures the funding rate on the short perp while being hedged against
 * SOL price movements via the long spot position.
 */
export async function openDeltaNeutralPosition(): Promise<void> {
	logger.info('Opening delta-neutral position...');

	try {
		const driftClient = getDriftClient();
		const swapClient = getSwapClient();

		// Get current USDC balance and SOL price
		const usdcBalanceNum = getVaultUsdcBalance();
		const solPriceNum = getSolPrice();

		logger.info(`USDC Balance: $${usdcBalanceNum.toFixed(2)}`);
		logger.info(`SOL Price: $${solPriceNum.toFixed(2)}`);

		// Calculate deployable USDC (apply safety fraction)
		const deployableUsdc = usdcBalanceNum * DEPLOY_FRACTION;

		// Split in half: one half for spot SOL purchase, one half for perp margin
		let positionSizeUsd = deployableUsdc / 2;

		// Cap at MAX_POSITION_SIZE_USD
		if (positionSizeUsd > StrategyParams.MAX_POSITION_SIZE_USD) {
			positionSizeUsd = StrategyParams.MAX_POSITION_SIZE_USD;
			logger.info(`Position size capped at $${positionSizeUsd}`);
		}

		// Check minimum position size
		if (positionSizeUsd < MIN_POSITION_SIZE_USD) {
			logger.warn(`Position size $${positionSizeUsd.toFixed(2)} below minimum $${MIN_POSITION_SIZE_USD}. Skipping.`);
			return;
		}

		// Calculate SOL amount to buy
		const solAmount = positionSizeUsd / solPriceNum;
		const usdcAmountIn = new BN(Math.floor(positionSizeUsd * 10 ** 6)); // USDC precision
		const solAmountBase = new BN(Math.floor(solAmount * 10 ** 9)); // SOL precision for perps

		logger.info(`Deploying $${positionSizeUsd.toFixed(2)} per side (${solAmount.toFixed(4)} SOL)`);

		// -------------------------------------------------------------------------
		// STEP 1: Buy spot SOL via Jupiter swap through Drift
		// -------------------------------------------------------------------------
		logger.info('STEP 1: Buying spot SOL via swap...');

		const swapTx = await driftClient.swap({
			swapClient,
			inMarketIndex: MarketIndexes.USDC_SPOT,
			outMarketIndex: MarketIndexes.SOL_SPOT,
			amount: usdcAmountIn,
			slippageBps: MAX_SLIPPAGE_BPS,
		});
		await confirmTx(driftClient.connection, swapTx);
		logger.info(`Spot SOL purchase confirmed. Tx: ${swapTx}`);

		// -------------------------------------------------------------------------
		// STEP 2: Open SHORT SOL-PERP position
		// -------------------------------------------------------------------------
		logger.info('STEP 2: Opening short SOL-PERP position...');

		const perpOrderParams = getMarketOrderParams({
			marketIndex: MarketIndexes.SOL_PERP,
			direction: PositionDirection.SHORT,
			baseAssetAmount: solAmountBase,
			marketType: MarketType.PERP,
		});

		const perpTx = await driftClient.placePerpOrder(perpOrderParams);
		await confirmTx(driftClient.connection, perpTx);
		logger.info(`Short SOL-PERP position confirmed. Tx: ${perpTx}`);

		// Log final summary
		const newHealth = getAccountHealth();
		logger.info(
			`Delta-neutral position opened successfully. ` +
			`Spot: +${solAmount.toFixed(4)} SOL, Perp: -${solAmount.toFixed(4)} SOL. ` +
			`Account health: ${newHealth}%`
		);
	} catch (error) {
		logger.error('Failed to open delta-neutral position', { error });
		throw error;
	}
}

// =============================================================================
// closeAllPositions
// =============================================================================

/**
 * Closes all positions - both the short perp and long spot.
 *
 * Called when:
 * - Funding rate turns negative beyond threshold
 * - Account health becomes critical
 * - Manual wind-down requested
 */
export async function closeAllPositions(): Promise<void> {
	logger.info('Closing all positions...');

	try {
		const driftClient = getDriftClient();
		const swapClient = getSwapClient();

		// Get current positions (in SOL units already)
		const perpSizeNum = getVaultSolPerpPosition(); // negative = short
		const spotSizeNum = getVaultSolSpotPosition();

		logger.info(`Current positions - Spot: ${spotSizeNum.toFixed(4)} SOL, Perp: ${perpSizeNum.toFixed(4)} SOL`);

		// -------------------------------------------------------------------------
		// STEP 1: Sell spot SOL first — reduces directional risk immediately
		// -------------------------------------------------------------------------
		if (spotSizeNum > MIN_SOL_DUST) {
			logger.info('STEP 1: Swapping SOL back to USDC...');

			const solAmountIn = new BN(Math.floor(spotSizeNum * 10 ** 9));
			const swapTx = await driftClient.swap({
				swapClient,
				inMarketIndex: MarketIndexes.SOL_SPOT,
				outMarketIndex: MarketIndexes.USDC_SPOT,
				amount: solAmountIn,
				slippageBps: MAX_SLIPPAGE_BPS,
			});
			await confirmTx(driftClient.connection, swapTx);
			logger.info(`SOL swapped to USDC and confirmed. Tx: ${swapTx}`);
		} else {
			logger.info('No significant SOL balance to swap.');
		}

		// -------------------------------------------------------------------------
		// STEP 2: Close short perp position
		// -------------------------------------------------------------------------
		if (Math.abs(perpSizeNum) > MIN_SOL_DUST) {
			logger.info('STEP 2: Closing short perp position...');

			// To close a short, we go LONG with reduceOnly
			const perpAmountBn = new BN(Math.floor(Math.abs(perpSizeNum) * 10 ** 9));
			const closeOrderParams = getMarketOrderParams({
				marketIndex: MarketIndexes.SOL_PERP,
				direction: PositionDirection.LONG,
				baseAssetAmount: perpAmountBn,
				marketType: MarketType.PERP,
				reduceOnly: true,
			});

			const closePerpTx = await driftClient.placePerpOrder(closeOrderParams);
			await confirmTx(driftClient.connection, closePerpTx);
			logger.info(`Perp position closed and confirmed. Tx: ${closePerpTx}`);
		} else {
			logger.info('No perp position to close.');
		}

		// Log final state
		const finalUsdcNum = getVaultUsdcBalance();
		logger.info(`All positions closed. Final USDC balance: $${finalUsdcNum.toFixed(2)}`);
	} catch (error) {
		logger.error('Failed to close all positions', { error });
		throw error;
	}
}

// =============================================================================
// rebalanceIfNeeded
// =============================================================================

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
export async function rebalanceIfNeeded(): Promise<void> {
	logger.debug('Checking if rebalance is needed...');

	try {
		const driftClient = getDriftClient();

		// Get current positions (already in SOL units)
		const spotSizeNum = getVaultSolSpotPosition();
		const perpSizeNum = Math.abs(getVaultSolPerpPosition()); // abs value of short

		// If no positions, nothing to rebalance
		if (spotSizeNum <= 0 && perpSizeNum <= 0) {
			logger.debug('No positions to rebalance.');
			return;
		}

		// Calculate imbalance percentage
		const avgSize = (spotSizeNum + perpSizeNum) / 2;
		if (avgSize === 0) {
			logger.debug('Average position size is zero. Skipping rebalance check.');
			return;
		}

		const imbalance = Math.abs(spotSizeNum - perpSizeNum);
		const imbalancePct = (imbalance / avgSize) * 100;

		logger.debug(
			`Spot: ${spotSizeNum.toFixed(4)} SOL, Perp: ${perpSizeNum.toFixed(4)} SOL, ` +
			`Imbalance: ${imbalancePct.toFixed(2)}%`
		);

		// Check if within tolerance
		if (imbalancePct <= StrategyParams.REBALANCE_THRESHOLD_PCT) {
			logger.debug('Positions within tolerance. No rebalance needed.');
			return;
		}

		logger.info(
			`Rebalance triggered. Imbalance: ${imbalancePct.toFixed(2)}% > ${StrategyParams.REBALANCE_THRESHOLD_PCT}%`
		);

		// Determine which side needs adjustment
		if (spotSizeNum > perpSizeNum) {
			// Spot is larger - increase short perp by the deficit
			const deficit = spotSizeNum - perpSizeNum;
			const deficitBn = new BN(Math.floor(deficit * 10 ** 9));

			logger.info(`Increasing short perp by ${deficit.toFixed(4)} SOL to match spot...`);

			const rebalanceOrderParams = getMarketOrderParams({
				marketIndex: MarketIndexes.SOL_PERP,
				direction: PositionDirection.SHORT,
				baseAssetAmount: deficitBn,
				marketType: MarketType.PERP,
			});

			const rebalanceTx = await driftClient.placePerpOrder(rebalanceOrderParams);
			await confirmTx(driftClient.connection, rebalanceTx);
			logger.info(`Rebalance confirmed. Tx: ${rebalanceTx}`);
		} else {
			// Perp is larger - reduce short perp by the surplus
			const surplus = perpSizeNum - spotSizeNum;
			const surplusBn = new BN(Math.floor(surplus * 10 ** 9));

			logger.info(`Reducing short perp by ${surplus.toFixed(4)} SOL to match spot...`);

			const rebalanceOrderParams = getMarketOrderParams({
				marketIndex: MarketIndexes.SOL_PERP,
				direction: PositionDirection.LONG,
				baseAssetAmount: surplusBn,
				marketType: MarketType.PERP,
				reduceOnly: true,
			});

			const rebalanceTx = await driftClient.placePerpOrder(rebalanceOrderParams);
			await confirmTx(driftClient.connection, rebalanceTx);
			logger.info(`Rebalance confirmed. Tx: ${rebalanceTx}`);
		}

		// Log final state
		const newSpotNum = getVaultSolSpotPosition();
		const newPerpNum = Math.abs(getVaultSolPerpPosition());

		logger.info(`Post-rebalance positions - Spot: ${newSpotNum.toFixed(4)} SOL, Perp: ${newPerpNum.toFixed(4)} SOL`);
	} catch (error) {
		logger.error('Failed to rebalance positions', { error });
		throw error;
	}
}

// =============================================================================
// settleFunding
// =============================================================================

/**
 * Settles accrued funding payments to realize PnL.
 *
 * Funding payments accumulate over time on perpetual positions.
 * This function settles them to convert unrealized PnL to realized PnL.
 */
export async function settleFunding(): Promise<void> {
	logger.debug('Settling funding payments...');

	try {
		const driftClient = getDriftClient();
		const user = driftClient.getUser();
		const userAccountPublicKey = await driftClient.getUserAccountPublicKey();
		const userAccount = user.getUserAccount();

		// Settle PnL for SOL-PERP market
		await driftClient.settlePNL(
			userAccountPublicKey,
			userAccount,
			MarketIndexes.SOL_PERP
		);

		logger.info('Funding payments settled successfully.');
	} catch (error: unknown) {
		// Ignore "Nothing to settle" errors - this is expected when there's no accumulated funding
		const errorMessage = error instanceof Error ? error.message : String(error);

		if (errorMessage.includes('Nothing to settle') || errorMessage.includes('NothingToSettle')) {
			logger.debug('No funding to settle at this time.');
			return;
		}

		// Log other errors but don't throw - settling is non-critical
		logger.error('Failed to settle funding', { error });
	}
}
