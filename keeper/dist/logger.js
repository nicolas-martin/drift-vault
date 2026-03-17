"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.logStrategy = logStrategy;
exports.logTrade = logTrade;
exports.logHealth = logHealth;
exports.setupGlobalErrorHandlers = setupGlobalErrorHandlers;
const winston_1 = __importDefault(require("winston"));
const VALID_LOG_LEVELS = ['error', 'warn', 'info', 'debug'];
function getLogLevel() {
    const envLevel = process.env['LOG_LEVEL']?.toLowerCase();
    if (envLevel && VALID_LOG_LEVELS.includes(envLevel)) {
        return envLevel;
    }
    return 'info';
}
// =============================================================================
// Custom Formats
// =============================================================================
const timestampFormat = winston_1.default.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS',
});
const consoleFormat = winston_1.default.format.combine(timestampFormat, winston_1.default.format.colorize({ all: true }), winston_1.default.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level}: ${message}${metaString}`;
}));
const fileFormat = winston_1.default.format.combine(timestampFormat, winston_1.default.format.json());
// =============================================================================
// Logger Instance
// =============================================================================
exports.logger = winston_1.default.createLogger({
    level: getLogLevel(),
    defaultMeta: { service: 'delta-neutral-keeper' },
    transports: [
        // Console transport with colorized output
        new winston_1.default.transports.Console({
            format: consoleFormat,
        }),
        // File transport for errors only
        new winston_1.default.transports.File({
            filename: 'keeper-error.log',
            level: 'error',
            format: fileFormat,
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
            tailable: true,
        }),
    ],
});
// =============================================================================
// Convenience Methods
// =============================================================================
/**
 * Log with additional context for strategy operations
 */
function logStrategy(level, message, context) {
    exports.logger.log(level, message, { component: 'strategy', ...context });
}
/**
 * Log with additional context for trading operations
 */
function logTrade(level, message, context) {
    exports.logger.log(level, message, { component: 'trade', ...context });
}
/**
 * Log with additional context for health/monitoring
 */
function logHealth(level, message, context) {
    exports.logger.log(level, message, { component: 'health', ...context });
}
// =============================================================================
// Process Error Handlers
// =============================================================================
function setupGlobalErrorHandlers() {
    process.on('uncaughtException', (error) => {
        exports.logger.error('Uncaught exception', {
            error: error.message,
            stack: error.stack,
        });
        process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
        exports.logger.error('Unhandled rejection', {
            reason: reason instanceof Error ? reason.message : String(reason),
            stack: reason instanceof Error ? reason.stack : undefined,
        });
    });
}
exports.default = exports.logger;
//# sourceMappingURL=logger.js.map