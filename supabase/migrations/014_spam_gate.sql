-- Spam gate: stop robocalls BEFORE any text-back or LLM fires.
--
-- Today every missed call on the store line triggers an SMS text-back and a lead
-- row (voice webhook). For a spam-heavy store cell that means: wasted SMS spend,
-- a lead list full of junk, and texts sent to numbers that never consented
-- (which erodes A2P/10DLC trust). This gate runs first and blocks the obvious ones.

-- Per-business blocklist of caller numbers. Populated automatically when a call is
-- classified spam (AI voicemail intent) and, later, manually by the owner.
CREATE TABLE IF NOT EXISTS spam_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  phone_number text NOT NULL,
  reason text,
  source text,                              -- 'auto_ai' | 'heuristic' | 'manual'
  created_at timestamptz DEFAULT now(),
  UNIQUE(business_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_spam_numbers_business_phone ON spam_numbers(business_id, phone_number);

ALTER TABLE spam_numbers ENABLE ROW LEVEL SECURITY;

-- Owners can view their own blocklist; all writes go through the service role.
DO $$ BEGIN
  CREATE POLICY "Users can view own spam numbers" ON spam_numbers
    FOR SELECT USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Spam-filter aggressiveness per business:
--   'off'        — gate disabled
--   'standard'   — block only high-confidence signals (blocklist, anonymous /
--                  invalid caller ID). These callers can't be texted back anyway,
--                  so false-positive risk to real customers is ~zero. (default)
--   'aggressive' — also weigh soft signals (non-fixed VoIP line type via Twilio
--                  Lookup, foreign country, no CNAM). Owner opt-in.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS spam_filter_mode text NOT NULL DEFAULT 'standard'
    CHECK (spam_filter_mode IN ('off', 'standard', 'aggressive'));
