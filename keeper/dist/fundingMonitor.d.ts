export interface FundingSnapshot {
    timestamp: number;
    fundingRate: number;
    fundingApr: number;
    oraclePrice: number;
}
/**
 * Get a snapshot of current funding rate data
 * @returns FundingSnapshot with current funding rate, APR, and oracle price
 */
export declare function getFundingSnapshot(): FundingSnapshot;
/**
 * Determine if conditions are favorable to open a new position
 * @param fundingRate - Current funding rate (APR percentage)
 * @returns true if funding rate exceeds minimum threshold
 */
export declare function shouldOpenPosition(fundingRate: number): boolean;
/**
 * Determine if position should be closed due to unfavorable funding
 * @param fundingRate - Current funding rate (APR percentage)
 * @returns true if funding rate is below negative threshold
 */
export declare function shouldClosePosition(fundingRate: number): boolean;
/**
 * Format funding snapshot for logging/display
 * @param snapshot - FundingSnapshot to format
 * @returns Formatted string with rate, APR, and price
 */
export declare function formatFundingInfo(snapshot: FundingSnapshot): string;
export declare const fundingMonitor: {
    getFundingSnapshot: typeof getFundingSnapshot;
    shouldOpenPosition: typeof shouldOpenPosition;
    shouldClosePosition: typeof shouldClosePosition;
    formatFundingInfo: typeof formatFundingInfo;
};
export default fundingMonitor;
//# sourceMappingURL=fundingMonitor.d.ts.map