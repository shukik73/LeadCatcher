/**
 * Structured logger utility for Lead Catcher
 * Replaces console.log/error with structured output
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

type LogMeta = Record<string, unknown>;

// Redact Phone Numbers (E.164 or Standard US) — mask all but last 4 digits.
const redactPII = (str: string) => {
  if (!str) return str;
  // Regex for roughly matching phone numbers (simplified)
  return str.replace(/(\+?\d{1,4}[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?(\d{3})[-.\s]?(\d{4})/g, (_match, _p1, _p2, _p3, p4) => {
    // Keep only p4 (last 4), replace rest with *
    return '***-***-' + p4;
  });
};

const formatLog = (level: LogLevel, message: string, meta?: LogMeta): string => {
  const timestamp = new Date().toISOString();

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

/**
 * Fire-and-forget alert to an external channel (Slack-compatible incoming webhook).
 * Only active when ALERT_WEBHOOK_URL is set and NODE_ENV is production, so local/
 * test runs stay quiet. Never throws and never blocks the caller — a failed alert
 * must not turn into a second error, and logging must stay synchronous-feeling.
 */
const sendAlert = (message: string, detail: string): void => {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url || process.env.NODE_ENV !== 'production') return;

  const text = `:rotating_light: *LeadCatcher error*\n${message}\n\`\`\`${detail.slice(0, 1500)}\`\`\``;
  // Intentionally not awaited; swallow all failures.
  void fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => { /* alerting is best-effort */ });
};

export const logger = {
  info: (message: string, meta?: LogMeta) => {
    console.log(formatLog('info', message, meta));
  },

  warn: (message: string, meta?: LogMeta) => {
    console.warn(formatLog('warn', message, meta));
  },

  error: (message: string, error?: unknown, meta?: LogMeta) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(formatLog('error', message, {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      ...meta
    }));
    sendAlert(redactPII(message), redactPII(errorMessage));
  },

  debug: (message: string, meta?: LogMeta) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(formatLog('debug', message, meta));
    }
  }
};
