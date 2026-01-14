-- Indexes for Performance
-- Businesses
create index if not exists businesses_user_id_idx on businesses(user_id);
create index if not exists businesses_forwarding_number_idx on businesses(forwarding_number);
create index if not exists businesses_owner_phone_idx on businesses(owner_phone);

-- Leads
create index if not exists leads_business_id_idx on leads(business_id);
create index if not exists leads_caller_phone_idx on leads(caller_phone);
create index if not exists leads_status_idx on leads(status);
create index if not exists leads_created_at_idx on leads(created_at desc);

-- Messages
create index if not exists messages_lead_id_idx on messages(lead_id);
create index if not exists messages_created_at_idx on messages(created_at);

-- Opt Outs (TCPA)
create index if not exists opt_outs_business_id_idx on opt_outs(business_id);
create index if not exists opt_outs_phone_number_idx on opt_outs(phone_number);
