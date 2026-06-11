-- =============================================================
-- Migration 008: Owner-approved follow-up drafts
-- AI-drafted re-engagement SMS for leads that showed intent on a
-- call but never came in. Nothing sends without owner approval.
-- Fully idempotent — safe to re-run.
-- =============================================================

CREATE TABLE IF NOT EXISTS pending_followups (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id      uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    call_analysis_id uuid NOT NULL REFERENCES call_analyses(id) ON DELETE CASCADE,
    customer_name    text,
    customer_phone   text NOT NULL,
    reason           text,               -- why this lead needs chasing (shown to owner)
    draft_sms        text NOT NULL,      -- AI-drafted message, editable before send
    ai_generated     boolean NOT NULL DEFAULT false, -- false = template fallback
    status           text NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'sent', 'skipped', 'expired'
    )),
    sent_at          timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One draft per analyzed call, ever — re-runs of the digest cron never duplicate
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_followups_call
    ON pending_followups (call_analysis_id);

CREATE INDEX IF NOT EXISTS idx_pending_followups_queue
    ON pending_followups (business_id, status, created_at DESC);

ALTER TABLE pending_followups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own pending followups" ON pending_followups;
CREATE POLICY "Users can view own pending followups"
    ON pending_followups FOR SELECT
    USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

-- Inserts/updates go through the service role (cron + API routes)

DROP TRIGGER IF EXISTS set_pending_followups_updated_at ON pending_followups;
CREATE TRIGGER set_pending_followups_updated_at
    BEFORE UPDATE ON pending_followups
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
