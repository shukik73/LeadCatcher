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

-- ============================================
-- SECURITY: Protect stripe_* columns from client-side tampering
-- ============================================
-- The default "Users can update own business" RLS policy allows updating
-- any column including stripe_* fields. This trigger blocks non-service-role
-- updates to billing-related columns, preventing client-side state tampering.

CREATE OR REPLACE FUNCTION protect_stripe_columns()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow service role (used by webhooks) to update anything
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- For non-service roles, prevent changes to stripe_* columns
  IF NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
     OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
     OR NEW.stripe_plan IS DISTINCT FROM OLD.stripe_plan
     OR NEW.stripe_status IS DISTINCT FROM OLD.stripe_status
     OR NEW.stripe_trial_ends_at IS DISTINCT FROM OLD.stripe_trial_ends_at
     OR NEW.stripe_current_period_end IS DISTINCT FROM OLD.stripe_current_period_end
  THEN
    RAISE EXCEPTION 'Updating billing fields is not allowed from client';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protect_stripe_columns ON businesses;
CREATE TRIGGER trg_protect_stripe_columns
  BEFORE UPDATE ON businesses
  FOR EACH ROW
  EXECUTE FUNCTION protect_stripe_columns();
