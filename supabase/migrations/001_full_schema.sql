-- ==========================================================================
-- LeadCatcher: Authoritative Schema Migration
-- ==========================================================================
-- Run order: This single file replaces the previous multi-file setup.
-- All statements are idempotent (IF NOT EXISTS / DO $$ guards).
--
-- Previous files (kept for reference but this is the canonical source):
--   schema.sql, indexes.sql, tcpa-compliance.sql,
--   stripe-billing.sql, repairdesk-integration.sql, webhook-idempotency.sql
-- ==========================================================================

-- 0. Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================================================
-- 1. TABLES
-- ==========================================================================

-- 1a. Businesses
CREATE TABLE IF NOT EXISTS businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL UNIQUE,
  name text NOT NULL,
  business_phone text NOT NULL,
  owner_phone text NOT NULL,
  forwarding_number text,
  twilio_sid text,
  carrier text,
  verified boolean DEFAULT false,
  verification_token text,
  verification_call_sid text,
  timezone text DEFAULT 'America/New_York',
  business_hours jsonb,
  sms_template text,
  sms_template_closed text,
  -- Stripe billing
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_plan text DEFAULT 'starter',
  stripe_status text DEFAULT NULL
    CHECK (stripe_status IS NULL OR stripe_status IN ('trialing', 'active', 'past_due', 'canceled', 'unpaid')),
  stripe_trial_ends_at timestamptz,
  stripe_current_period_end timestamptz,
  -- RepairDesk integration
  repairdesk_api_key text,
  repairdesk_store_url text,
  repairdesk_last_poll_at timestamptz,
  -- Timestamps
  created_at timestamptz DEFAULT now()
);

-- 1b. Leads
CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  caller_phone text NOT NULL,
  caller_name text,
  status text DEFAULT 'New' CHECK (status IN ('New', 'Contacted', 'Booked', 'Closed', 'Processing')),
  intent text,
  ai_summary text,
  source text DEFAULT 'phone' CHECK (source IN ('phone', 'repairdesk', 'manual')),
  external_id text,
  sms_hold_until timestamptz,
  created_at timestamptz DEFAULT now()
);

-- 1c. Messages
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body text NOT NULL,
  is_ai_generated boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- 1d. Opt-outs (TCPA compliance)
CREATE TABLE IF NOT EXISTS opt_outs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  phone_number text NOT NULL,
  opted_out_at timestamptz DEFAULT now(),
  opt_out_keyword text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(business_id, phone_number)
);

-- 1e. Webhook events (idempotency)
CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'processed', 'failed')),
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz,
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE
);

-- ==========================================================================
-- 2. INDEXES
-- ==========================================================================

-- Businesses
CREATE INDEX IF NOT EXISTS businesses_user_id_idx ON businesses(user_id);
CREATE INDEX IF NOT EXISTS businesses_forwarding_number_idx ON businesses(forwarding_number);
CREATE INDEX IF NOT EXISTS businesses_owner_phone_idx ON businesses(owner_phone);
CREATE UNIQUE INDEX IF NOT EXISTS businesses_forwarding_number_unique
  ON businesses(forwarding_number) WHERE forwarding_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_stripe_customer
  ON businesses(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_businesses_stripe_status ON businesses(stripe_status);

-- Leads
CREATE INDEX IF NOT EXISTS leads_business_id_idx ON leads(business_id);
CREATE INDEX IF NOT EXISTS leads_caller_phone_idx ON leads(caller_phone);
CREATE INDEX IF NOT EXISTS leads_status_idx ON leads(status);
CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS leads_business_caller_unique
  ON leads(business_id, caller_phone);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_external_source
  ON leads(business_id, source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
CREATE INDEX IF NOT EXISTS idx_leads_sms_hold ON leads(sms_hold_until) WHERE sms_hold_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_business_source_status_hold
  ON leads(business_id, source, status, sms_hold_until) WHERE source = 'repairdesk';

-- Messages
CREATE INDEX IF NOT EXISTS messages_lead_id_idx ON messages(lead_id);
CREATE INDEX IF NOT EXISTS messages_created_at_idx ON messages(created_at);

-- Opt-outs
CREATE INDEX IF NOT EXISTS idx_opt_outs_business_phone ON opt_outs(business_id, phone_number);
CREATE INDEX IF NOT EXISTS idx_opt_outs_phone ON opt_outs(phone_number) WHERE phone_number IS NOT NULL;

-- Webhook events
CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id ON webhook_events(event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON webhook_events(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_business_type_status
  ON webhook_events(business_id, event_type, status, created_at);

-- ==========================================================================
-- 3. ROW LEVEL SECURITY
-- ==========================================================================

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE opt_outs ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- Businesses policies
DO $$ BEGIN
  CREATE POLICY "Users can view own business" ON businesses
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update own business" ON businesses
    FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can create own business" ON businesses
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Leads policies
DO $$ BEGIN
  CREATE POLICY "Users can view own leads" ON leads
    FOR SELECT USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can create leads for own business" ON leads
    FOR INSERT WITH CHECK (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update own leads" ON leads
    FOR UPDATE USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete own leads" ON leads
    FOR DELETE USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Messages policies
DO $$ BEGIN
  CREATE POLICY "Users can view own messages" ON messages
    FOR SELECT USING (lead_id IN (SELECT id FROM leads WHERE business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can create messages for own leads" ON messages
    FOR INSERT WITH CHECK (lead_id IN (SELECT id FROM leads WHERE business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Opt-outs: read-only for authenticated users
DO $$ BEGIN
  CREATE POLICY "Users can view own opt-outs" ON opt_outs
    FOR SELECT USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- webhook_events: RLS enabled with no policies = service-role only access

-- ==========================================================================
-- 4. TRIGGERS: Protect sensitive columns from client-side tampering
-- ==========================================================================

CREATE OR REPLACE FUNCTION protect_stripe_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Protect stripe_* columns
  IF NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
     OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
     OR NEW.stripe_plan IS DISTINCT FROM OLD.stripe_plan
     OR NEW.stripe_status IS DISTINCT FROM OLD.stripe_status
     OR NEW.stripe_trial_ends_at IS DISTINCT FROM OLD.stripe_trial_ends_at
     OR NEW.stripe_current_period_end IS DISTINCT FROM OLD.stripe_current_period_end
  THEN
    RAISE EXCEPTION 'Updating billing fields is not allowed from client';
  END IF;

  -- Protect telephony fields
  IF NEW.forwarding_number IS DISTINCT FROM OLD.forwarding_number
     OR NEW.twilio_sid IS DISTINCT FROM OLD.twilio_sid
     OR NEW.verified IS DISTINCT FROM OLD.verified
     OR NEW.verification_token IS DISTINCT FROM OLD.verification_token
     OR NEW.verification_call_sid IS DISTINCT FROM OLD.verification_call_sid
  THEN
    RAISE EXCEPTION 'Updating telephony fields is not allowed from client';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protect_stripe_columns ON businesses;
CREATE TRIGGER trg_protect_stripe_columns
  BEFORE UPDATE ON businesses
  FOR EACH ROW
  EXECUTE FUNCTION protect_stripe_columns();

-- Protect sensitive columns on INSERT (prevents seeding forged billing/telephony values)
CREATE OR REPLACE FUNCTION protect_stripe_columns_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Force billing fields to safe defaults on client-side inserts
  NEW.stripe_customer_id := NULL;
  NEW.stripe_subscription_id := NULL;
  NEW.stripe_plan := 'starter';
  NEW.stripe_status := NULL;
  NEW.stripe_trial_ends_at := NULL;
  NEW.stripe_current_period_end := NULL;

  -- Force telephony fields to safe defaults
  NEW.forwarding_number := NULL;
  NEW.twilio_sid := NULL;
  NEW.verified := false;
  NEW.verification_token := NULL;
  NEW.verification_call_sid := NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protect_stripe_columns_on_insert ON businesses;
CREATE TRIGGER trg_protect_stripe_columns_on_insert
  BEFORE INSERT ON businesses
  FOR EACH ROW
  EXECUTE FUNCTION protect_stripe_columns_on_insert();
