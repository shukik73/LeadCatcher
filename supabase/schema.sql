-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Businesses Table
create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null unique, -- Unique constraint for upsert
  name text not null,
  business_phone text not null,
  owner_phone text not null,
  forwarding_number text, -- The Twilio number
  twilio_sid text, -- Twilio phone number SID for API operations
  carrier text,
  verified boolean default false,
  -- Phase 1.6 Additions
  timezone text default 'America/New_York',
  business_hours jsonb, -- { "monday": { "open": "09:00", "close": "17:00" }, ... }
  sms_template text, -- "Sorry we missed you at {{business_name}}..."
  created_at timestamptz default now()
);

-- Leads Table
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) not null,
  caller_phone text not null,
  caller_name text,
  status text default 'New', -- New, Contacted, Booked, Closed
  -- Phase 2 Additions
  intent text, -- 'booking_request', 'price_inquiry', 'spam', etc.
  ai_summary text, -- Brief summary of the call/text conversation
  created_at timestamptz default now()
);

-- Messages Table
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null,
  -- Phase 2 Additions
  is_ai_generated boolean default false,
  created_at timestamptz default now()
);

-- RLS Policies
-- Enable RLS
alter table businesses enable row level security;
alter table leads enable row level security;
alter table messages enable row level security;

-- 1. Businesses Policies (idempotent with DO $$ guards)
DO $$ BEGIN
  CREATE POLICY "Users can view own business" ON businesses
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update own business" ON businesses
    FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can create own business" ON businesses
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Leads Policies
DO $$ BEGIN
  CREATE POLICY "Users can view own leads" ON leads
    FOR SELECT USING (
      business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can create leads for own business" ON leads
    FOR INSERT WITH CHECK (
      business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update own leads" ON leads
    FOR UPDATE USING (
      business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete own leads" ON leads
    FOR DELETE USING (
      business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Messages Policies
DO $$ BEGIN
  CREATE POLICY "Users can view own messages" ON messages
    FOR SELECT USING (
      lead_id IN (SELECT id FROM leads WHERE business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can create messages for own leads" ON messages
    FOR INSERT WITH CHECK (
      lead_id IN (SELECT id FROM leads WHERE business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_businesses_forwarding_number ON businesses(forwarding_number);
CREATE INDEX IF NOT EXISTS idx_leads_business_id ON leads(business_id);
CREATE INDEX IF NOT EXISTS idx_leads_caller_phone ON leads(caller_phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_messages_lead_id ON messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
