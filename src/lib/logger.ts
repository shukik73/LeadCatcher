/**
 * Structured logger utility for Lead Catcher
 * Replaces console.log/error with structured output
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

type LogMeta = Record<string, unknown>;

const formatLog = (level: LogLevel, message: string, meta?: LogMeta): string => {
  const timestamp = new Date().toISOString();

  // Redact Phone Numbers (E.164 or Standard US)
  // Mask all but last 4 digits
  const redactPII = (str: string) => {
    if (!str) return str;
    // Regex for roughly matching phone numbers (simplified)
    return str.replace(/(\+?\d{1,4}[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?(\d{3})[-.\s]?(\d{4})/g, (_match, _p1, _p2, _p3, p4) => {
      // Keep only p4 (last 4), replace rest with *
      return '***-***-' + p4;
    });
  };

  const safeMessage = redactPII(message);
  // Deep clone and redact meta if necessary (simplified for MVP: just stringify and redact)
  let safeMeta = meta;
  if (meta) {
    try {
      const metaStr = JSON.stringify(meta);
      safeMeta = JSON.parse(redactPII(metaStr)) as LogMeta;
    } catch {
      // ignore serialization error
    }
  }

  const payload = {
    timestamp,
    level,
    message: safeMessage,
    ...safeMeta,
  };
  return JSON.stringify(payload);
};

export const logger = {
  info: (message: string, meta?: LogMeta) => {
    console.log(formatLog('info', message, meta));
  },

  warn: (message: string, meta?: LogMeta) => {
    console.warn(formatLog('warn', message, meta));
  },

  error: (message: string, error?: unknown, meta?: LogMeta) => {
    console.error(formatLog('error', message, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      ...meta
    }));
  },

  debug: (message: string, meta?: LogMeta) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(formatLog('debug', message, meta));
    }
  }
};
