-- =============================================================
-- Migration 003: Call Review Workflow
-- Adds tracking fields for follow-up, RepairDesk write-back,
-- and coaching aggregation.
-- =============================================================

-- -----------------------------------------------
-- 1) Add tracking columns to call_analyses
-- -----------------------------------------------
ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS last_contacted_at timestamptz;
ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS contact_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS internal_notes text;
ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS rd_ticket_id text;
ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS rd_ticket_status text;
ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS rd_synced_at timestamptz;
ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS outcome_notes text;

-- -----------------------------------------------
-- 2) Indexes for new columns
-- -----------------------------------------------

-- RepairDesk ticket lookups
CREATE INDEX IF NOT EXISTS idx_call_analyses_rd_ticket
    ON call_analyses (business_id, rd_ticket_id) WHERE rd_ticket_id IS NOT NULL;

-- Owner-based coaching queries
CREATE INDEX IF NOT EXISTS idx_call_analyses_owner
    ON call_analyses (business_id, owner, created_at);

-- Callback status + last_contacted_at for follow-up queue
CREATE INDEX IF NOT EXISTS idx_call_analyses_contact_tracking
    ON call_analyses (business_id, callback_status, last_contacted_at)
    WHERE follow_up_needed = true;

-- -----------------------------------------------
-- 3) coaching_summaries table (for future use)
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS coaching_summaries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    owner           text NOT NULL,
    period_start    date NOT NULL,
    period_end      date NOT NULL,
    total_calls     integer NOT NULL DEFAULT 0,
    calls_booked    integer NOT NULL DEFAULT 0,
    calls_lost      integer NOT NULL DEFAULT 0,
    avg_response_minutes numeric,
    common_issues   jsonb DEFAULT '[]',
    coaching_highlights jsonb DEFAULT '[]',
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(business_id, owner, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_coaching_summaries_business
    ON coaching_summaries (business_id, period_start, period_end);

-- -----------------------------------------------
-- 4) RLS for coaching_summaries
-- -----------------------------------------------
ALTER TABLE coaching_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own coaching summaries" ON coaching_summaries;
CREATE POLICY "Users can view own coaching summaries"
    ON coaching_summaries FOR SELECT
    USING (business_id IN (
        SELECT id FROM businesses WHERE user_id = auth.uid()
    ));
