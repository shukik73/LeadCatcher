-- =============================================================
-- Migration 010: Internal accounts + owner no-reply alert
-- 1. billing_exempt: internal/comped businesses (e.g. our own shop
--    dogfooding) bypass the subscription gate without being counted
--    as paying customers in revenue metrics.
-- 2. owner_alerted_at: dedupe column for the "we texted them, no reply
--    — call them" owner alert. One alert per lead.
-- Idempotent.
-- =============================================================

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS billing_exempt boolean NOT NULL DEFAULT false;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS owner_alerted_at timestamptz;

-- Partial index: the owner-no-reply cron scans Contacted leads not yet alerted.
CREATE INDEX IF NOT EXISTS idx_leads_owner_alert_pending
  ON leads (business_id)
  WHERE status = 'Contacted' AND owner_alerted_at IS NULL;
