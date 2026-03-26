-- =============================================================
-- Migration 002: Call Intelligence Layer v1
-- Adds call_analyses + message_patterns tables for AI scoring,
-- callback queue, and SMS learning loop.
-- Fully idempotent — safe to re-run.
-- =============================================================

-- -----------------------------------------------
-- 1) call_analyses — one row per analyzed call
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS call_analyses (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    source_call_id  text NOT NULL,
    rd_lead_id      text,
    customer_name   text,
    customer_phone  text,
    call_status     text NOT NULL CHECK (call_status IN ('missed', 'answered', 'outbound')),
    call_duration   integer,                        -- seconds, NULL if unknown
    recording_url   text,
    transcript      text,
    summary         text,
    sentiment       text CHECK (sentiment IN ('positive', 'neutral', 'negative', 'frustrated')),
    category        text CHECK (category IN (
        'repair_quote', 'status_check', 'parts_inquiry',
        'follow_up', 'spam', 'wrong_number'
    )),
    urgency         text CHECK (urgency IN ('high', 'medium', 'low')),
    follow_up_needed boolean NOT NULL DEFAULT false,
    follow_up_notes text,
    callback_status text NOT NULL DEFAULT 'pending' CHECK (callback_status IN (
        'pending', 'called', 'no_answer', 'booked', 'lost'
    )),
    owner           text,
    due_by          timestamptz,
    coaching_note   text,
    acted_on        boolean NOT NULL DEFAULT false,
    booked_value    numeric,
    store_visit_at  timestamptz,
    ticket_created_at timestamptz,
    processed_at    timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Unique index for idempotency — same call never processed twice
CREATE UNIQUE INDEX IF NOT EXISTS idx_call_analyses_source_call_id
    ON call_analyses (source_call_id);

-- Fast lookups for callback queue (pending follow-ups, ordered by urgency + due_by)
CREATE INDEX IF NOT EXISTS idx_call_analyses_followup_queue
    ON call_analyses (business_id, follow_up_needed, callback_status, urgency, due_by)
    WHERE follow_up_needed = true;

-- Business lookup
CREATE INDEX IF NOT EXISTS idx_call_analyses_business_id
    ON call_analyses (business_id);

-- Phone lookup (for customer history)
CREATE INDEX IF NOT EXISTS idx_call_analyses_customer_phone
    ON call_analyses (business_id, customer_phone);

-- Date-based queries (daily reports)
CREATE INDEX IF NOT EXISTS idx_call_analyses_created_at
    ON call_analyses (business_id, created_at);

-- -----------------------------------------------
-- 2) message_patterns — SMS learning loop
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS message_patterns (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    pattern_text    text NOT NULL,
    pattern_type    text NOT NULL DEFAULT 'sms' CHECK (pattern_type IN ('sms', 'callback_script', 'voicemail')),
    times_used      integer NOT NULL DEFAULT 0,
    times_converted integer NOT NULL DEFAULT 0,     -- led to booked/store_visit
    conversion_rate numeric GENERATED ALWAYS AS (
        CASE WHEN times_used > 0 THEN times_converted::numeric / times_used ELSE 0 END
    ) STORED,
    last_used_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_patterns_business_id
    ON message_patterns (business_id);

CREATE INDEX IF NOT EXISTS idx_message_patterns_top
    ON message_patterns (business_id, conversion_rate DESC, times_used DESC);

-- -----------------------------------------------
-- 3) RLS policies
-- -----------------------------------------------
ALTER TABLE call_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_patterns ENABLE ROW LEVEL SECURITY;

-- Drop-and-recreate policies to be idempotent
DROP POLICY IF EXISTS "Users can view own call analyses" ON call_analyses;
CREATE POLICY "Users can view own call analyses"
    ON call_analyses FOR SELECT
    USING (business_id IN (
        SELECT id FROM businesses WHERE user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Users can update own call analyses" ON call_analyses;
CREATE POLICY "Users can update own call analyses"
    ON call_analyses FOR UPDATE
    USING (business_id IN (
        SELECT id FROM businesses WHERE user_id = auth.uid()
    ));

-- Service role handles inserts (from API routes)
-- No INSERT policy for authenticated users — only server can create analyses

DROP POLICY IF EXISTS "Users can view own message patterns" ON message_patterns;
CREATE POLICY "Users can view own message patterns"
    ON message_patterns FOR SELECT
    USING (business_id IN (
        SELECT id FROM businesses WHERE user_id = auth.uid()
    ));

-- -----------------------------------------------
-- 4) Auto-update updated_at trigger
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_call_analyses_updated_at ON call_analyses;
CREATE TRIGGER set_call_analyses_updated_at
    BEFORE UPDATE ON call_analyses
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_message_patterns_updated_at ON message_patterns;
CREATE TRIGGER set_message_patterns_updated_at
    BEFORE UPDATE ON message_patterns
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
