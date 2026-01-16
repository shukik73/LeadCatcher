-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Businesses Table
create table businesses (
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
create table leads (
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
create table messages (
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

-- 1. Businesses Policies
create policy "Users can view own business" on businesses
  for select using (auth.uid() = user_id);

create policy "Users can update own business" on businesses
  for update using (auth.uid() = user_id);

create policy "Users can create own business" on businesses
  for insert with check (auth.uid() = user_id);

-- 2. Leads Policies
-- View: Own leads (linked to own business)
create policy "Users can view own leads" on leads
  for select using (
    business_id in (select id from businesses where user_id = auth.uid())
  );

-- Create: Only separate service/admin can create leads technically (via webhook), 
-- but if we allow manual lead creation used this:
create policy "Users can create leads for own business" on leads
  for insert with check (
    business_id in (select id from businesses where user_id = auth.uid())
  );

-- Update: e.g. changing status
create policy "Users can update own leads" on leads
  for update using (
    business_id in (select id from businesses where user_id = auth.uid())
  );

-- Delete: (Optional, maybe soft delete preferable)
create policy "Users can delete own leads" on leads
  for delete using (
    business_id in (select id from businesses where user_id = auth.uid())
  );

-- 3. Messages Policies
create policy "Users can view own messages" on messages
  for select using (
    lead_id in (select id from leads where business_id in (select id from businesses where user_id = auth.uid()))
  );

-- Allow creating outbound messages
create policy "Users can create messages for own leads" on messages
  for insert with check (
    lead_id in (select id from leads where business_id in (select id from businesses where user_id = auth.uid()))
  );

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_businesses_forwarding_number ON businesses(forwarding_number);
CREATE INDEX IF NOT EXISTS idx_leads_business_id ON leads(business_id);
CREATE INDEX IF NOT EXISTS idx_leads_caller_phone ON leads(caller_phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_messages_lead_id ON messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);

