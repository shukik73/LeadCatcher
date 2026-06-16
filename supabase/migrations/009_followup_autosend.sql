-- =============================================================
-- Migration 009: Follow-up auto-send
-- Per-business switch to auto-send high-confidence follow-up drafts
-- (vs. the owner-approval queue). Adds a 'suppressed' status so the
-- engine can dedupe calls the AI declined without re-drafting them.
-- Idempotent.
-- =============================================================

-- Per-business toggle. Default OFF — auto-send is opt-in per shop.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS followup_auto_send boolean NOT NULL DEFAULT false;

-- Allow 'suppressed' (AI judged not worth sending) alongside the existing
-- pending/sent/skipped/expired so a declined call is recorded and never
-- re-drafted on the next engine run.
ALTER TABLE pending_followups DROP CONSTRAINT IF EXISTS pending_followups_status_check;
ALTER TABLE pending_followups
  ADD CONSTRAINT pending_followups_status_check
  CHECK (status IN ('pending', 'sent', 'skipped', 'expired', 'suppressed'));

-- How the draft was delivered: 'auto' (sent without approval) vs 'manual'
-- (owner approved). Lets reporting separate the two. Null for old rows.
ALTER TABLE pending_followups
  ADD COLUMN IF NOT EXISTS sent_via text CHECK (sent_via IN ('auto', 'manual'));
