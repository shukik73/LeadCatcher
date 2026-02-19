-- Webhook Idempotency: Prevent duplicate processing of Twilio/Stripe webhooks
-- Twilio retries on 5xx or timeout. Without dedup, this can cause
-- duplicate SMS sends, duplicate leads, and duplicate costs.
--
-- Pattern: atomic claim via INSERT ... ON CONFLICT DO NOTHING.
-- Status tracks processing lifecycle: processing -> processed | failed.
-- Only the inserter (winner of the race) continues; losers get 0 rows returned.

CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,          -- CallSid, MessageSid, RecordingSid, or Stripe evt_*
  event_type text NOT NULL,               -- 'voice', 'sms', 'transcription', 'stripe'
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'processed', 'failed')),
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz,               -- set when status moves to 'processed'
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE
);

-- Index for fast lookups during webhook processing
CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id ON webhook_events(event_id);

-- TTL cleanup: auto-delete events older than 7 days to keep table small
-- Run via pg_cron or application-level cleanup
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON webhook_events(created_at);

-- RLS: webhook_events should only be accessible by the service role.
-- No authenticated user or anon role should read or write webhook metadata.
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- Deny all access for authenticated/anon roles (service role bypasses RLS)
-- No policies = no access for non-service roles when RLS is enabled.
