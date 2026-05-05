-- =============================================================
-- Migration 007: Missed-Call Recovery Workflow
--   - Booking link on businesses
--   - AI lead qualification fields
--   - Hot lead alert deduplication
--   - Recent outbound message index for SMS rate limiting
--   - Backfill review_requests / google_review_link if migration 003b
--     wasn't applied (idempotent)
-- =============================================================

-- 1) booking_url for businesses (Feature A)
ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS booking_url text;

-- 2) AI qualification on leads (Feature B)
ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS qualification_status text NOT NULL DEFAULT 'none'
        CHECK (qualification_status IN ('none', 'in_progress', 'qualified')),
    ADD COLUMN IF NOT EXISTS qualification_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS qualification_step integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS qualification_summary_sent_at timestamptz;

-- 3) Hot lead alert dedupe (Feature D)
ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS hot_alert_sent_at timestamptz;

-- 4) Recent outbound messages index used by sms-rate-limit count queries.
--    Partial index on direction='outbound' keeps it small.
CREATE INDEX IF NOT EXISTS idx_messages_outbound_recent
    ON messages (created_at DESC, lead_id)
    WHERE direction = 'outbound';

-- 5) review_requests + google_review_link safety net (Feature C).
--    Migration 003b already creates these; the IF NOT EXISTS guards make this
--    cheap to re-run on environments that skipped 003b.
ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS google_review_link text;

CREATE TABLE IF NOT EXISTS review_requests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    customer_phone  text NOT NULL,
    customer_name   text,
    ticket_id       text,
    sent_at         timestamptz NOT NULL DEFAULT now(),
    review_link     text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_requests_business
    ON review_requests (business_id, customer_phone);

-- One review request per business+ticket (when ticket_id present)
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_requests_business_ticket
    ON review_requests (business_id, ticket_id)
    WHERE ticket_id IS NOT NULL;

ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "Users can view own review requests"
        ON review_requests FOR SELECT
        USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
