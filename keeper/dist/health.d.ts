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
/**
 * Get current account health status
 * @returns HealthStatus with all relevant health metrics
 */
export declare function getHealthStatus(): HealthStatus;
/**
 * Check health status and log appropriate warnings/alerts
 * @param status - HealthStatus to evaluate
 */
export declare function checkHealthAndAlert(status: HealthStatus): void;
/**
 * Format health status for logging/display
 * @param status - HealthStatus to format
 * @returns Formatted string with health metrics
 */
export declare function formatHealthInfo(status: HealthStatus): string;
export declare const healthMonitor: {
    getHealthStatus: typeof getHealthStatus;
    checkHealthAndAlert: typeof checkHealthAndAlert;
    formatHealthInfo: typeof formatHealthInfo;
};
export default healthMonitor;
//# sourceMappingURL=health.d.ts.map