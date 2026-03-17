import winston from 'winston';

// =============================================================================
// Log Level Configuration
// =============================================================================

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const VALID_LOG_LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug'];

function getLogLevel(): LogLevel {
  const envLevel = process.env['LOG_LEVEL']?.toLowerCase();
  if (envLevel && VALID_LOG_LEVELS.includes(envLevel as LogLevel)) {
    return envLevel as LogLevel;
  }
  return 'info';
}

// =============================================================================
// Custom Formats
// =============================================================================

const timestampFormat = winston.format.timestamp({
  format: 'YYYY-MM-DD HH:mm:ss.SSS',
});

const consoleFormat = winston.format.combine(
  timestampFormat,
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level}: ${message}${metaString}`;
  })
);

const fileFormat = winston.format.combine(
  timestampFormat,
  winston.format.json()
);

// =============================================================================
// Logger Instance
// =============================================================================

export const logger = winston.createLogger({
  level: getLogLevel(),
  defaultMeta: { service: 'delta-neutral-keeper' },
  transports: [
    // Console transport with colorized output
    new winston.transports.Console({
      format: consoleFormat,
    }),

    // File transport for errors only
    new winston.transports.File({
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
export function logStrategy(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): void {
  logger.log(level, message, { component: 'strategy', ...context });
}

/**
 * Log with additional context for trading operations
 */
export function logTrade(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): void {
  logger.log(level, message, { component: 'trade', ...context });
}

/**
 * Log with additional context for health/monitoring
 */
export function logHealth(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): void {
  logger.log(level, message, { component: 'health', ...context });
}

// =============================================================================
// Process Error Handlers
// =============================================================================

export function setupGlobalErrorHandlers(): void {
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught exception', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('Unhandled rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

export default logger;
