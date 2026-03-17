import winston from 'winston';
type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export declare const logger: winston.Logger;
/**
 * Log with additional context for strategy operations
 */
export declare function logStrategy(level: LogLevel, message: string, context?: Record<string, unknown>): void;
/**
 * Log with additional context for trading operations
 */
export declare function logTrade(level: LogLevel, message: string, context?: Record<string, unknown>): void;
/**
 * Log with additional context for health/monitoring
 */
export declare function logHealth(level: LogLevel, message: string, context?: Record<string, unknown>): void;
export declare function setupGlobalErrorHandlers(): void;
export default logger;
//# sourceMappingURL=logger.d.ts.map