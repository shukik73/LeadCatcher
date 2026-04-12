-- =============================================================
-- Migration 005: Action Items + AI Auto-Audit
-- Adds action_items table for AI-generated tasks and extends
-- call_analyses with AI quality audit scores.
-- Fully idempotent — safe to re-run.
-- =============================================================

-- -----------------------------------------------
-- 1) action_items — AI-generated or manual tasks
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS action_items (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    -- Linkage (both optional — action items work standalone)
    call_analysis_id uuid REFERENCES call_analyses(id) ON DELETE SET NULL,
    lead_id         uuid REFERENCES leads(id) ON DELETE SET NULL,
    -- Core fields
    title           text NOT NULL,
    description     text,
    action_type     text NOT NULL DEFAULT 'follow_up' CHECK (action_type IN (
        'callback', 'follow_up', 'repair_update', 'quote_needed', 'escalation', 'info'
    )),
    priority        text NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
    status          text NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'in_progress', 'completed', 'cancelled'
    )),
    -- Assignment
    assigned_role   text DEFAULT 'owner' CHECK (assigned_role IN ('owner', 'tech', 'front_desk')),
    assigned_to     text,
    -- Context
    customer_name   text,
    customer_phone  text,
    source          text NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'manual', 'audit')),
    -- RepairDesk sync
    rd_synced_at    timestamptz,
    rd_ticket_id    text,
    -- Completion
    completed_at    timestamptz,
    completed_by    text,
    -- Timestamps
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------
-- 2) Indexes
-- -----------------------------------------------
CREATE INDEX IF NOT EXISTS idx_action_items_business_status
    ON action_items (business_id, status, priority, created_at DESC)
    WHERE status IN ('pending', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_action_items_business_created
    ON action_items (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_action_items_call_analysis
    ON action_items (call_analysis_id) WHERE call_analysis_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_action_items_customer_phone
    ON action_items (business_id, customer_phone) WHERE customer_phone IS NOT NULL;

-- -----------------------------------------------
-- 3) RLS policies
-- -----------------------------------------------
ALTER TABLE action_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own action items" ON action_items;
CREATE POLICY "Users can view own action items"
    ON action_items FOR SELECT
    USING (business_id IN (
        SELECT id FROM businesses WHERE user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Users can update own action items" ON action_items;
CREATE POLICY "Users can update own action items"
    ON action_items FOR UPDATE
    USING (business_id IN (
        SELECT id FROM businesses WHERE user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Users can insert own action items" ON action_items;
CREATE POLICY "Users can insert own action items"
    ON action_items FOR INSERT
    WITH CHECK (business_id IN (
        SELECT id FROM businesses WHERE user_id = auth.uid()
    ));

-- -----------------------------------------------
-- 4) Extend call_analyses for AI quality audit
-- -----------------------------------------------
-- Store the 9 quality scores from AI audit
ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS ai_quality_scores jsonb;
-- Store the AI-computed quality score total (0-100)
ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS ai_quality_total integer;
-- Track when the AI auto-audit was completed
ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS ai_audited_at timestamptz;
-- Store the RepairDesk call log ID for deduplication
ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS rd_call_log_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_call_analyses_rd_call_log
    ON call_analyses (business_id, rd_call_log_id)
    WHERE rd_call_log_id IS NOT NULL;

-- -----------------------------------------------
-- 5) Track last AI audit poll time per business
-- -----------------------------------------------
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS ai_audit_last_poll_at timestamptz;

-- -----------------------------------------------
-- 6) Auto-update trigger
-- -----------------------------------------------
DROP TRIGGER IF EXISTS set_action_items_updated_at ON action_items;
CREATE TRIGGER set_action_items_updated_at
    BEFORE UPDATE ON action_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
