-- =============================================================
-- Migration 006: Five Feature Enhancement
-- 1. AI Auto-Reply (auto_reply_enabled on businesses)
-- 2. Daily Digest (daily_digest_enabled on businesses)
-- 3. Customer Timeline (no new tables, uses existing data)
-- 4. Repair Status Auto-Updates (ticket_status_tracking table)
-- 5. Lead Conversion Dashboard (lead_conversions view helpers)
-- Fully idempotent — safe to re-run.
-- =============================================================

-- -----------------------------------------------
-- 1) Businesses: feature toggles
-- -----------------------------------------------
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS auto_reply_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS daily_digest_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS status_updates_enabled boolean NOT NULL DEFAULT false;

-- -----------------------------------------------
-- 2) Ticket status tracking (for repair status auto-updates)
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_status_tracking (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    rd_ticket_id    integer NOT NULL,
    customer_phone  text NOT NULL,
    customer_name   text,
    device          text,
    last_status     text NOT NULL,
    current_status  text NOT NULL,
    sms_sent_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_status_business_ticket
    ON ticket_status_tracking (business_id, rd_ticket_id);

CREATE INDEX IF NOT EXISTS idx_ticket_status_business
    ON ticket_status_tracking (business_id, updated_at DESC);

ALTER TABLE ticket_status_tracking ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own ticket tracking" ON ticket_status_tracking;
CREATE POLICY "Users can view own ticket tracking"
    ON ticket_status_tracking FOR SELECT
    USING (business_id IN (
        SELECT id FROM businesses WHERE user_id = auth.uid()
    ));

-- -----------------------------------------------
-- 3) Lead conversion tracking columns
-- -----------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS converted_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS conversion_value numeric;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS converted_by text;

-- Add follow_up_count if not exists (used by voice webhook)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_count integer NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_due_at timestamptz;

-- -----------------------------------------------
-- 4) Auto-update triggers
-- -----------------------------------------------
DROP TRIGGER IF EXISTS set_ticket_status_tracking_updated_at ON ticket_status_tracking;
CREATE TRIGGER set_ticket_status_tracking_updated_at
    BEFORE UPDATE ON ticket_status_tracking
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
