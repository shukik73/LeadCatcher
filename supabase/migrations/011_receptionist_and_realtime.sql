-- =============================================================
-- Migration 011: Answer-first receptionist context + live dashboard
--
-- 1. businesses.address / services: the AI receptionist needs real
--    shop facts to answer "are you near X?" and "do you fix Y?" instead
--    of interrogating the customer. Free-text, owner-editable in Settings.
-- 2. leads.last_auto_reply_at: atomic race guard so two inbound texts
--    that land at the same instant can't both fire an auto-reply.
-- 3. Realtime: add `leads` and `messages` to the supabase_realtime
--    publication. The dashboard conversation thread, the "new lead"
--    toast, and live inbound/outbound messages all depend on
--    postgres_changes — the publication was EMPTY, so none of it worked.
-- Idempotent.
-- =============================================================

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS services text;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS last_auto_reply_at timestamptz;

-- Add tables to the realtime publication only if not already present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'leads'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.leads';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.messages';
  END IF;
END $$;
