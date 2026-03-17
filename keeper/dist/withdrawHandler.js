"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withdrawHandler = void 0;
exports.checkPendingWithdrawals = checkPendingWithdrawals;
exports.ensureWithdrawalLiquidity = ensureWithdrawalLiquidity;
exports.closePartialPosition = closePartialPosition;
const driftClient_1 = require("./driftClient");
const logger_1 = require("./logger");
// =============================================================================
// Withdrawal Monitoring
// =============================================================================
/**
 * Check for pending user withdrawals from the vault
 * Note: This is a placeholder - actual implementation requires vault SDK integration
 *
 * @returns Promise with pending withdrawal status
 */
async function checkPendingWithdrawals() {
    try {
        // TODO: Integrate with Drift Vault SDK to query pending withdrawals
        // This would involve:
        // 1. Getting the vault account
        // 2. Querying VaultDepositor accounts with pending withdrawals
        // 3. Summing up the total pending amount
        const result = {
            hasPending: false,
            totalPending: 0,
        };
        logger_1.logger.info('Checked pending withdrawals', {
            hasPending: result.hasPending,
            totalPending: result.totalPending,
        });
        return result;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('Failed to check pending withdrawals', { error: message });
        throw error;
    }
}
// =============================================================================
// Liquidity Management
// =============================================================================
/**
 * Ensure sufficient liquidity is available to fulfill pending withdrawals
 * If pending amount exceeds available USDC buffer, unwind part of the position
 *
 * @param pendingAmount - Total pending withdrawal amount in USD
 */
async function ensureWithdrawalLiquidity(pendingAmount) {
    try {
        const availableUsdc = (0, driftClient_1.getVaultUsdcBalance)();
        logger_1.logger.debug('Checking withdrawal liquidity', {
            pendingAmount,
            availableUsdc,
        });
        if (pendingAmount <= availableUsdc) {
            logger_1.logger.info('Sufficient liquidity for pending withdrawals', {
                pendingAmount,
                availableUsdc,
                surplus: availableUsdc - pendingAmount,
            });
            return;
        }
        // Calculate shortfall and required position reduction
        const shortfall = pendingAmount - availableUsdc;
        logger_1.logger.warn('Insufficient liquidity for withdrawals, need to unwind position', {
            pendingAmount,
            availableUsdc,
            shortfall,
        });
        // Get actual SOL price from oracle
        const solPrice = (0, driftClient_1.getSolPrice)();
        const solAmountToClose = shortfall / solPrice;
        await closePartialPosition(solAmountToClose);
        logger_1.logger.info('Position unwinding initiated for withdrawal liquidity', {
            shortfall,
            solAmountToClose,
            solPrice,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('Failed to ensure withdrawal liquidity', { error: message });
        throw error;
    }
}
// =============================================================================
// Position Management
// =============================================================================
/**
 * Close a partial position to free up liquidity
 * This is a stub implementation - actual implementation requires trading logic
 *
 * @param solAmountToClose - Amount of SOL to close from the delta-neutral position
 */
async function closePartialPosition(solAmountToClose) {
    try {
        // TODO: Implement actual position closing logic
        // This would involve:
        // 1. Calculate exact amounts to close on both spot and perp sides
        // 2. Close the perp short position for the given amount
        // 3. Sell the spot SOL position for the given amount
        // 4. Ensure the position remains delta-neutral
        // 5. Handle any slippage or partial fills
        logger_1.logger.info('STUB: Would close partial position', {
            solAmountToClose,
            action: 'Close perp short + sell spot SOL',
            note: 'Implementation pending - requires trading module integration',
        });
        // Simulate async operation
        await Promise.resolve();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('Failed to close partial position', { error: message });
        throw error;
    }
}
// =============================================================================
// Export
// =============================================================================
exports.withdrawHandler = {
    checkPendingWithdrawals,
    ensureWithdrawalLiquidity,
    closePartialPosition,
};
exports.default = exports.withdrawHandler;
//# sourceMappingURL=withdrawHandler.js.map