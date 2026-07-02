-- Make webhook reprocessing SMS-safe.
--
-- When a webhook throws after sending an SMS but before it is marked 'processed',
-- the finally-block marks the event 'failed'. The provider (Twilio) then retries,
-- and reclaimIfFailed() flips 'failed' -> 'processing' and reprocesses the handler
-- from the top — re-sending the same customer-facing SMS.
--
-- This ledger records which one-time side effects (e.g. the missed-call auto-reply)
-- already fired for an event. Reclaim resets status/processed_at but NOT this
-- column, so handlers can check it and skip a resend on the retry.
ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS side_effects jsonb NOT NULL DEFAULT '{}'::jsonb;
