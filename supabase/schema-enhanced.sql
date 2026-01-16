-- Enhanced Schema with Complete RLS Policies
-- This is an improved version of schema.sql with all necessary policies

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Businesses Table
create table businesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null unique, -- Unique constraint for upsert
  name text not null,
  business_phone text not null,
  owner_phone text not null,
  forwarding_number text, -- The Twilio number (for MVP)
  twilio_sid text, -- Twilio phone number SID for API operations
  carrier text,
  verified boolean default false,
  created_at timestamptz default now()
);

-- Leads Table
create table leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  caller_phone text not null,
  caller_name text,
  status text default 'New' check (status in ('New', 'Contacted', 'Booked', 'Closed')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Messages Table
create table messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null,
  status text default 'sent' check (status in ('sending', 'sent', 'delivered', 'failed')),
  created_at timestamptz default now()
);

-- Enable RLS on all tables
alter table businesses enable row level security;
alter table leads enable row level security;
alter table messages enable row level security;

-- ============================================
-- BUSINESSES POLICIES
-- ============================================

-- SELECT: Users can view their own business
create policy "Users can view own business" on businesses
  for select using (auth.uid() = user_id);

-- INSERT: Users can create their own business
create policy "Users can insert own business" on businesses
  for insert with check (auth.uid() = user_id);

-- UPDATE: Users can update their own business
create policy "Users can update own business" on businesses
  for update using (auth.uid() = user_id);

-- DELETE: Users can delete their own business (cascade will handle related data)
create policy "Users can delete own business" on businesses
  for delete using (auth.uid() = user_id);

-- ============================================
-- LEADS POLICIES
-- ============================================

-- SELECT: Users can view leads for their businesses
create policy "Users can view own leads" on leads
  for select using (
    business_id in (
      select id from businesses where user_id = auth.uid()
    )
  );

-- INSERT: Users can create leads for their businesses
create policy "Users can insert own leads" on leads
  for insert with check (
    business_id in (
      select id from businesses where user_id = auth.uid()
    )
  );

-- UPDATE: Users can update leads for their businesses
create policy "Users can update own leads" on leads
  for update using (
    business_id in (
      select id from businesses where user_id = auth.uid()
    )
  );

-- DELETE: Users can delete leads for their businesses
create policy "Users can delete own leads" on leads
  for delete using (
    business_id in (
      select id from businesses where user_id = auth.uid()
    )
  );

-- ============================================
-- MESSAGES POLICIES
-- ============================================

-- SELECT: Users can view messages for their leads
create policy "Users can view own messages" on messages
  for select using (
    lead_id in (
      select id from leads
      where business_id in (
        select id from businesses where user_id = auth.uid()
      )
    )
  );

-- INSERT: Users can create messages for their leads
create policy "Users can insert own messages" on messages
  for insert with check (
    lead_id in (
      select id from leads
      where business_id in (
        select id from businesses where user_id = auth.uid()
      )
    )
  );

-- UPDATE: Users can update messages for their leads
create policy "Users can update own messages" on messages
  for update using (
    lead_id in (
      select id from leads
      where business_id in (
        select id from businesses where user_id = auth.uid()
      )
    )
  );

-- DELETE: Users can delete messages for their leads
create policy "Users can delete own messages" on messages
  for delete using (
    lead_id in (
      select id from leads
      where business_id in (
        select id from businesses where user_id = auth.uid()
      )
    )
  );

-- ============================================
-- INDEXES for Performance
-- ============================================

-- Index for business lookups by user
create index idx_businesses_user_id on businesses(user_id);

-- Index for business lookups by forwarding number (for webhooks)
create index idx_businesses_forwarding_number on businesses(forwarding_number) where forwarding_number is not null;

-- Index for lead lookups by business
create index idx_leads_business_id on leads(business_id);

-- Index for lead lookups by caller phone
create index idx_leads_caller_phone on leads(caller_phone);

-- Index for message lookups by lead
create index idx_messages_lead_id on messages(lead_id);

-- Index for time-based queries
create index idx_leads_created_at on leads(created_at desc);
create index idx_messages_created_at on messages(created_at desc);

-- ============================================
-- FUTURE: Multi-Number Support (for Pro plan)
-- ============================================

-- Uncomment when ready to support multiple Twilio numbers per business
/*
create table twilio_numbers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  phone_number text not null unique,
  friendly_name text,
  is_active boolean default true,
  created_at timestamptz default now()
);

alter table twilio_numbers enable row level security;

create policy "Users can view own twilio numbers" on twilio_numbers
  for select using (
    business_id in (
      select id from businesses where user_id = auth.uid()
    )
  );

create index idx_twilio_numbers_business_id on twilio_numbers(business_id);
create index idx_twilio_numbers_phone on twilio_numbers(phone_number) where is_active = true;

-- Add twilio_number_id to leads table
alter table leads add column twilio_number_id uuid references twilio_numbers(id);
create index idx_leads_twilio_number_id on leads(twilio_number_id);
*/

-- ============================================
-- FUTURE: Team Member Support
-- ============================================

-- Uncomment when ready to support team members
/*
create table team_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  user_id uuid references auth.users not null,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz default now(),
  unique(business_id, user_id)
);

alter table team_members enable row level security;

create policy "Users can view team members of their businesses" on team_members
  for select using (
    business_id in (
      select id from businesses where user_id = auth.uid()
    ) OR
    user_id = auth.uid()
  );

create index idx_team_members_business_id on team_members(business_id);
create index idx_team_members_user_id on team_members(user_id);
*/
