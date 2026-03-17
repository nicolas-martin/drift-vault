export interface PendingWithdrawalsResult {
    hasPending: boolean;
    totalPending: number;
}
/**
 * Check for pending user withdrawals from the vault
 * Note: This is a placeholder - actual implementation requires vault SDK integration
 *
 * @returns Promise with pending withdrawal status
 */
export declare function checkPendingWithdrawals(): Promise<PendingWithdrawalsResult>;
/**
 * Ensure sufficient liquidity is available to fulfill pending withdrawals
 * If pending amount exceeds available USDC buffer, unwind part of the position
 *
 * @param pendingAmount - Total pending withdrawal amount in USD
 */
export declare function ensureWithdrawalLiquidity(pendingAmount: number): Promise<void>;
/**
 * Close a partial position to free up liquidity
 * This is a stub implementation - actual implementation requires trading logic
 *
 * @param solAmountToClose - Amount of SOL to close from the delta-neutral position
 */
export declare function closePartialPosition(solAmountToClose: number): Promise<void>;
export declare const withdrawHandler: {
    checkPendingWithdrawals: typeof checkPendingWithdrawals;
    ensureWithdrawalLiquidity: typeof ensureWithdrawalLiquidity;
    closePartialPosition: typeof closePartialPosition;
};
export default withdrawHandler;
//# sourceMappingURL=withdrawHandler.d.ts.map