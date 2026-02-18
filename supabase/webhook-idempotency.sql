-- Webhook Idempotency: Prevent duplicate processing of Twilio webhooks
-- Twilio retries on 5xx or timeout. Without dedup, this can cause
-- duplicate SMS sends, duplicate leads, and duplicate costs.

CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,          -- CallSid, MessageSid, or RecordingSid
  event_type text NOT NULL,               -- 'voice', 'sms', 'transcription'
  processed_at timestamptz DEFAULT now(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE
);

-- Index for fast lookups during webhook processing
CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id ON webhook_events(event_id);

-- TTL cleanup: auto-delete events older than 7 days to keep table small
-- Run via pg_cron or application-level cleanup
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_at ON webhook_events(processed_at);
