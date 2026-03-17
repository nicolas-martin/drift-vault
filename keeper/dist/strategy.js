"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openDeltaNeutralPosition = openDeltaNeutralPosition;
exports.closeAllPositions = closeAllPositions;
exports.rebalanceIfNeeded = rebalanceIfNeeded;
exports.settleFunding = settleFunding;
const driftClient_1 = require("./driftClient");
const config_1 = require("./config");
const logger_1 = require("./logger");
// =============================================================================
// Constants
// =============================================================================
const USDC_PRECISION = new driftClient_1.BN(10).pow(new driftClient_1.BN(6)); // USDC has 6 decimals
const SOL_PRECISION = new driftClient_1.BN(10).pow(new driftClient_1.BN(9)); // SOL has 9 decimals
const MIN_POSITION_USD = 10; // Minimum position size in USD
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
async function openDeltaNeutralPosition() {
    logger_1.logger.info('Opening delta-neutral position...');
    try {
        const driftClient = (0, driftClient_1.getDriftClient)();
        const jupiterClient = (0, driftClient_1.getJupiterClient)();
        // Get current USDC balance and SOL price
        const usdcBalanceNum = (0, driftClient_1.getVaultUsdcBalance)();
        const solPriceNum = (0, driftClient_1.getSolPrice)();
        logger_1.logger.info(`USDC Balance: $${usdcBalanceNum.toFixed(2)}`);
        logger_1.logger.info(`SOL Price: $${solPriceNum.toFixed(2)}`);
        // Calculate deployable USDC (apply safety fraction)
        const deployableUsdc = usdcBalanceNum * config_1.DEPLOY_FRACTION;
        // Split in half: one half for spot SOL purchase, one half for perp margin
        let positionSizeUsd = deployableUsdc / 2;
        // Cap at MAX_POSITION_SIZE_USD
        if (positionSizeUsd > config_1.StrategyParams.MAX_POSITION_SIZE_USD) {
            positionSizeUsd = config_1.StrategyParams.MAX_POSITION_SIZE_USD;
            logger_1.logger.info(`Position size capped at $${positionSizeUsd}`);
        }
        // Check minimum position size
        if (positionSizeUsd < MIN_POSITION_USD) {
            logger_1.logger.warn(`Position size $${positionSizeUsd.toFixed(2)} below minimum $${MIN_POSITION_USD}. Skipping.`);
            return;
        }
        // Calculate SOL amount to buy
        const solAmount = positionSizeUsd / solPriceNum;
        const usdcAmountIn = new driftClient_1.BN(Math.floor(positionSizeUsd * 10 ** 6)); // USDC precision
        const solAmountBase = new driftClient_1.BN(Math.floor(solAmount * 10 ** 9)); // SOL precision for perps
        logger_1.logger.info(`Deploying $${positionSizeUsd.toFixed(2)} per side (${solAmount.toFixed(4)} SOL)`);
        // -------------------------------------------------------------------------
        // STEP 1: Buy spot SOL via Jupiter swap through Drift
        // -------------------------------------------------------------------------
        logger_1.logger.info('STEP 1: Buying spot SOL via swap...');
        const swapTx = await driftClient.swap({
            inMarketIndex: config_1.MarketIndexes.USDC_SPOT,
            outMarketIndex: config_1.MarketIndexes.SOL_SPOT,
            amount: usdcAmountIn,
            slippageBps: config_1.MAX_SLIPPAGE_BPS,
        });
        logger_1.logger.info(`Spot SOL purchase complete. Tx: ${swapTx}`);
        // -------------------------------------------------------------------------
        // STEP 2: Open SHORT SOL-PERP position
        // -------------------------------------------------------------------------
        logger_1.logger.info('STEP 2: Opening short SOL-PERP position...');
        const perpOrderParams = (0, driftClient_1.getMarketOrderParams)({
            marketIndex: config_1.MarketIndexes.SOL_PERP,
            direction: driftClient_1.PositionDirection.SHORT,
            baseAssetAmount: solAmountBase,
            marketType: driftClient_1.MarketType.PERP,
        });
        const perpTx = await driftClient.placePerpOrder(perpOrderParams);
        logger_1.logger.info(`Short SOL-PERP position opened. Tx: ${perpTx}`);
        // Log final summary
        const newHealth = (0, driftClient_1.getAccountHealth)();
        logger_1.logger.info(`Delta-neutral position opened successfully. ` +
            `Spot: +${solAmount.toFixed(4)} SOL, Perp: -${solAmount.toFixed(4)} SOL. ` +
            `Account health: ${newHealth}%`);
    }
    catch (error) {
        logger_1.logger.error('Failed to open delta-neutral position', { error });
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
async function closeAllPositions() {
    logger_1.logger.info('Closing all positions...');
    try {
        const driftClient = (0, driftClient_1.getDriftClient)();
        // Get current positions (in SOL units already)
        const perpSizeNum = (0, driftClient_1.getVaultSolPerpPosition)(); // negative = short
        const spotSizeNum = (0, driftClient_1.getVaultSolSpotPosition)();
        logger_1.logger.info(`Current positions - Spot: ${spotSizeNum.toFixed(4)} SOL, Perp: ${perpSizeNum.toFixed(4)} SOL`);
        // -------------------------------------------------------------------------
        // STEP 1: Close short perp position (if exists)
        // -------------------------------------------------------------------------
        if (Math.abs(perpSizeNum) > MIN_SOL_DUST) {
            logger_1.logger.info('STEP 1: Closing short perp position...');
            // To close a short, we go LONG with reduceOnly
            const perpAmountBn = new driftClient_1.BN(Math.floor(Math.abs(perpSizeNum) * 10 ** 9));
            const closeOrderParams = (0, driftClient_1.getMarketOrderParams)({
                marketIndex: config_1.MarketIndexes.SOL_PERP,
                direction: driftClient_1.PositionDirection.LONG,
                baseAssetAmount: perpAmountBn,
                marketType: driftClient_1.MarketType.PERP,
                reduceOnly: true,
            });
            const closePerpTx = await driftClient.placePerpOrder(closeOrderParams);
            logger_1.logger.info(`Perp position closed. Tx: ${closePerpTx}`);
        }
        else {
            logger_1.logger.info('No perp position to close.');
        }
        // -------------------------------------------------------------------------
        // STEP 2: Swap SOL back to USDC (if > MIN_SOL_DUST)
        // -------------------------------------------------------------------------
        if (spotSizeNum > MIN_SOL_DUST) {
            logger_1.logger.info('STEP 2: Swapping SOL back to USDC...');
            const solAmountIn = new driftClient_1.BN(Math.floor(spotSizeNum * 10 ** 9));
            const swapTx = await driftClient.swap({
                inMarketIndex: config_1.MarketIndexes.SOL_SPOT,
                outMarketIndex: config_1.MarketIndexes.USDC_SPOT,
                amount: solAmountIn,
                slippageBps: config_1.MAX_SLIPPAGE_BPS,
            });
            logger_1.logger.info(`SOL swapped to USDC. Tx: ${swapTx}`);
        }
        else {
            logger_1.logger.info('No significant SOL balance to swap.');
        }
        // Log final state
        const finalUsdcNum = (0, driftClient_1.getVaultUsdcBalance)();
        logger_1.logger.info(`All positions closed. Final USDC balance: $${finalUsdcNum.toFixed(2)}`);
    }
    catch (error) {
        logger_1.logger.error('Failed to close all positions', { error });
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
async function rebalanceIfNeeded() {
    logger_1.logger.debug('Checking if rebalance is needed...');
    try {
        const driftClient = (0, driftClient_1.getDriftClient)();
        // Get current positions (already in SOL units)
        const spotSizeNum = (0, driftClient_1.getVaultSolSpotPosition)();
        const perpSizeNum = Math.abs((0, driftClient_1.getVaultSolPerpPosition)()); // abs value of short
        // If no positions, nothing to rebalance
        if (spotSizeNum <= 0 && perpSizeNum <= 0) {
            logger_1.logger.debug('No positions to rebalance.');
            return;
        }
        // Calculate imbalance percentage
        const avgSize = (spotSizeNum + perpSizeNum) / 2;
        if (avgSize === 0) {
            logger_1.logger.debug('Average position size is zero. Skipping rebalance check.');
            return;
        }
        const imbalance = Math.abs(spotSizeNum - perpSizeNum);
        const imbalancePct = (imbalance / avgSize) * 100;
        logger_1.logger.debug(`Spot: ${spotSizeNum.toFixed(4)} SOL, Perp: ${perpSizeNum.toFixed(4)} SOL, ` +
            `Imbalance: ${imbalancePct.toFixed(2)}%`);
        // Check if within tolerance
        if (imbalancePct <= config_1.StrategyParams.REBALANCE_THRESHOLD_PCT) {
            logger_1.logger.debug('Positions within tolerance. No rebalance needed.');
            return;
        }
        logger_1.logger.info(`Rebalance triggered. Imbalance: ${imbalancePct.toFixed(2)}% > ${config_1.StrategyParams.REBALANCE_THRESHOLD_PCT}%`);
        // Determine which side needs adjustment
        if (spotSizeNum > perpSizeNum) {
            // Spot is larger - increase short perp by the deficit
            const deficit = spotSizeNum - perpSizeNum;
            const deficitBn = new driftClient_1.BN(Math.floor(deficit * 10 ** 9));
            logger_1.logger.info(`Increasing short perp by ${deficit.toFixed(4)} SOL to match spot...`);
            const rebalanceOrderParams = (0, driftClient_1.getMarketOrderParams)({
                marketIndex: config_1.MarketIndexes.SOL_PERP,
                direction: driftClient_1.PositionDirection.SHORT,
                baseAssetAmount: deficitBn,
                marketType: driftClient_1.MarketType.PERP,
            });
            const rebalanceTx = await driftClient.placePerpOrder(rebalanceOrderParams);
            logger_1.logger.info(`Rebalance complete. Tx: ${rebalanceTx}`);
        }
        else {
            // Perp is larger - reduce short perp by the surplus
            const surplus = perpSizeNum - spotSizeNum;
            const surplusBn = new driftClient_1.BN(Math.floor(surplus * 10 ** 9));
            logger_1.logger.info(`Reducing short perp by ${surplus.toFixed(4)} SOL to match spot...`);
            const rebalanceOrderParams = (0, driftClient_1.getMarketOrderParams)({
                marketIndex: config_1.MarketIndexes.SOL_PERP,
                direction: driftClient_1.PositionDirection.LONG,
                baseAssetAmount: surplusBn,
                marketType: driftClient_1.MarketType.PERP,
                reduceOnly: true,
            });
            const rebalanceTx = await driftClient.placePerpOrder(rebalanceOrderParams);
            logger_1.logger.info(`Rebalance complete. Tx: ${rebalanceTx}`);
        }
        // Log final state
        const newSpotNum = (0, driftClient_1.getVaultSolSpotPosition)();
        const newPerpNum = Math.abs((0, driftClient_1.getVaultSolPerpPosition)());
        logger_1.logger.info(`Post-rebalance positions - Spot: ${newSpotNum.toFixed(4)} SOL, Perp: ${newPerpNum.toFixed(4)} SOL`);
    }
    catch (error) {
        logger_1.logger.error('Failed to rebalance positions', { error });
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
async function settleFunding() {
    logger_1.logger.debug('Settling funding payments...');
    try {
        const driftClient = (0, driftClient_1.getDriftClient)();
        const user = driftClient.getUser();
        const userAccountPublicKey = await driftClient.getUserAccountPublicKey();
        const userAccount = user.getUserAccount();
        // Settle PnL for SOL-PERP market
        await driftClient.settlePNL(userAccountPublicKey, userAccount, config_1.MarketIndexes.SOL_PERP);
        logger_1.logger.info('Funding payments settled successfully.');
    }
    catch (error) {
        // Ignore "Nothing to settle" errors - this is expected when there's no accumulated funding
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('Nothing to settle') || errorMessage.includes('NothingToSettle')) {
            logger_1.logger.debug('No funding to settle at this time.');
            return;
        }
        // Log other errors but don't throw - settling is non-critical
        logger_1.logger.error('Failed to settle funding', { error });
    }
}
//# sourceMappingURL=strategy.js.map