-- TCPA Compliance: Opt-Out Table
-- Required for TCPA (Telephone Consumer Protection Act) compliance
-- Users can opt-out by sending STOP, UNSUBSCRIBE, CANCEL, END, or QUIT

-- Opt-Outs Table
create table if not exists opt_outs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  phone_number text not null, -- Normalized phone number (E.164 format)
  opted_out_at timestamptz default now(),
  opt_out_keyword text, -- Which keyword was used (STOP, UNSUBSCRIBE, etc.)
  created_at timestamptz default now(),
  -- Ensure one opt-out per phone number per business
  unique(business_id, phone_number)
);

-- Enable RLS
alter table opt_outs enable row level security;

-- Users can view opt-outs for their businesses (idempotent)
DO $$ BEGIN
  create policy "Users can view own opt-outs" on opt_outs
    for select using (
      business_id in (
        select id from businesses where user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Only service/admin can insert opt-outs (via webhook)
-- Regular users cannot manually opt people out (privacy concern)
-- Service role key bypasses RLS for webhook operations

-- Index for quick lookup (critical for message sending)
create index if not exists idx_opt_outs_business_phone 
  on opt_outs(business_id, phone_number);

create index if not exists idx_opt_outs_phone 
  on opt_outs(phone_number) where phone_number is not null;
