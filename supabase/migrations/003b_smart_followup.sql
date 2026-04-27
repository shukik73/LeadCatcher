-- =============================================================
-- Migration 003: Smart Follow-Up & Review Requests
-- Adds follow-up scheduling to leads and review request tracking.
-- =============================================================

-- 1) Add follow-up fields to leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS follow_up_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_count integer NOT NULL DEFAULT 0;

-- Index for the follow-up cron job (find leads due for follow-up)
CREATE INDEX IF NOT EXISTS idx_leads_follow_up_due
  ON leads (business_id, follow_up_due_at)
  WHERE follow_up_due_at IS NOT NULL AND status = 'New';

-- 2) Review requests table (track sent review requests)
CREATE TABLE IF NOT EXISTS review_requests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    customer_phone  text NOT NULL,
    customer_name   text,
    ticket_id       text,              -- RepairDesk ticket ID
    sent_at         timestamptz NOT NULL DEFAULT now(),
    review_link     text,              -- Google/Yelp review link
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_requests_business
  ON review_requests (business_id, customer_phone);

-- Prevent sending duplicate review requests to same customer within 30 days
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_requests_dedup
  ON review_requests (business_id, customer_phone, (sent_at::date));

ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own review requests"
  ON review_requests FOR SELECT
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

-- 3) Add review link to businesses (Google review URL)
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS google_review_link text;
