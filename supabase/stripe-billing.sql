-- Stripe Billing Schema Changes
-- Adds subscription tracking to the businesses table

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS stripe_plan text DEFAULT 'starter';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS stripe_status text DEFAULT 'trialing'
  CHECK (stripe_status IN ('trialing', 'active', 'past_due', 'canceled', 'unpaid'));
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS stripe_trial_ends_at timestamptz;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS stripe_current_period_end timestamptz;

-- Index for webhook lookups by Stripe customer ID
CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_stripe_customer
  ON businesses(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- Index for subscription status checks
CREATE INDEX IF NOT EXISTS idx_businesses_stripe_status
  ON businesses(stripe_status);
