-- Indexes for Performance
-- Businesses
create index if not exists businesses_user_id_idx on businesses(user_id);
create index if not exists businesses_forwarding_number_idx on businesses(forwarding_number);
create index if not exists businesses_owner_phone_idx on businesses(owner_phone);

-- UNIQUE partial index: prevent two businesses from sharing a forwarding number.
-- All webhooks look up businesses by forwarding_number using .single(); collisions break routing.
create unique index if not exists businesses_forwarding_number_unique
  on businesses(forwarding_number) where forwarding_number is not null;

-- Leads
create index if not exists leads_business_id_idx on leads(business_id);
create index if not exists leads_caller_phone_idx on leads(caller_phone);
create index if not exists leads_status_idx on leads(status);
create index if not exists leads_created_at_idx on leads(created_at desc);

-- Composite index for the hot path: voice/sms webhooks look up leads by (business_id, caller_phone)
create unique index if not exists leads_business_caller_unique
  on leads(business_id, caller_phone);

-- Composite index for RepairDesk poll: claim leads by (business_id, source, status, sms_hold_until)
create index if not exists idx_leads_business_source_status_hold
  on leads(business_id, source, status, sms_hold_until)
  where source = 'repairdesk';

-- Messages
create index if not exists messages_lead_id_idx on messages(lead_id);
create index if not exists messages_created_at_idx on messages(created_at);

-- Opt Outs (TCPA)
create index if not exists opt_outs_business_id_idx on opt_outs(business_id);
create index if not exists opt_outs_phone_number_idx on opt_outs(phone_number);
