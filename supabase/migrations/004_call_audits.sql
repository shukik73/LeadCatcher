-- =============================================================
-- Migration 004: Phone Call Audit
-- Adds call_audits table for quality scoring phone calls,
-- plus audit linkage on call_analyses.
-- Fully idempotent — safe to re-run.
-- =============================================================

-- -----------------------------------------------
-- 1) call_audits — one row per audit submission
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS call_audits (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id             uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    call_analysis_id        uuid REFERENCES call_analyses(id) ON DELETE SET NULL,
    -- Metadata
    store_name              text NOT NULL,
    store_email             text,
    manager_email           text,
    employee_name           text NOT NULL,
    submitted_by            text NOT NULL,
    audit_date              timestamptz NOT NULL,
    rd_lead_id              text,               -- RepairDesk customer/lead ID (pasted by user)
    -- 9 Yes/No quality questions
    q_proper_greeting       boolean NOT NULL DEFAULT false,
    q_open_ended_questions  boolean NOT NULL DEFAULT false,
    q_location_info         boolean NOT NULL DEFAULT false,
    q_closing_with_name     boolean NOT NULL DEFAULT false,
    q_warranty_mention      boolean NOT NULL DEFAULT false,
    q_timely_answers        boolean NOT NULL DEFAULT false,
    q_alert_demeanor        boolean NOT NULL DEFAULT false,
    q_call_under_2_30       boolean NOT NULL DEFAULT false,
    q_effort_customer_in    boolean NOT NULL DEFAULT false,
    -- Scoring (persisted so historical scores survive weight changes)
    total_score             integer NOT NULL DEFAULT 0,
    max_possible_score      integer NOT NULL DEFAULT 100,
    -- Free text
    device_price_quoted     text,
    improvements            text,
    call_status             text,
    -- RepairDesk sync
    rd_synced_at            timestamptz,
    rd_ticket_id            text,
    -- Timestamps
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------
-- 2) Indexes
-- -----------------------------------------------
CREATE INDEX IF NOT EXISTS idx_call_audits_business
    ON call_audits (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_audits_employee
    ON call_audits (business_id, employee_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_audits_call_analysis
    ON call_audits (call_analysis_id) WHERE call_analysis_id IS NOT NULL;

-- -----------------------------------------------
-- 3) RLS policies
-- -----------------------------------------------
ALTER TABLE call_audits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own call audits" ON call_audits;
CREATE POLICY "Users can view own call audits"
    ON call_audits FOR SELECT
    USING (business_id IN (
        SELECT id FROM businesses WHERE user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Users can update own call audits" ON call_audits;
CREATE POLICY "Users can update own call audits"
    ON call_audits FOR UPDATE
    USING (business_id IN (
        SELECT id FROM businesses WHERE user_id = auth.uid()
    ));

-- Service role handles inserts (from API routes)

-- -----------------------------------------------
-- 4) Link call_analyses to audits
-- -----------------------------------------------
ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS audit_id uuid REFERENCES call_audits(id) ON DELETE SET NULL;
ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS audit_score integer;

-- -----------------------------------------------
-- 5) Auto-update updated_at trigger (reuse existing function)
-- -----------------------------------------------
DROP TRIGGER IF EXISTS set_call_audits_updated_at ON call_audits;
CREATE TRIGGER set_call_audits_updated_at
    BEFORE UPDATE ON call_audits
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
