-- =============================================================
-- Migration 012: Make the auto-reply race guard reliable.
--
-- The receptionist claim in the SMS webhook used a PostgREST `.or()` filter
-- with a raw ISO timestamp (`last_auto_reply_at.is.null,...lt.<ts>`). That
-- filter failed in prod, the update errored, the error was swallowed, and the
-- bot went silent — never replying to a single customer.
--
-- Fix: give last_auto_reply_at a non-null sentinel default (epoch) and backfill
-- existing NULLs, so the claim can use a single, well-behaved `.lt(cutoff)`
-- filter (no `.or()`, no null-handling) that reliably matches "hasn't replied
-- in the debounce window."
-- Idempotent.
-- =============================================================

ALTER TABLE leads
  ALTER COLUMN last_auto_reply_at SET DEFAULT to_timestamp(0);

UPDATE leads
  SET last_auto_reply_at = to_timestamp(0)
  WHERE last_auto_reply_at IS NULL;
