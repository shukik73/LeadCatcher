-- RepairDesk Integration Schema Changes
-- Adds support for RepairDesk API integration and lead source tracking

-- Add RepairDesk API key to businesses table
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS repairdesk_api_key text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS repairdesk_store_url text;

-- Add source tracking to leads table
-- 'phone' = Twilio missed call, 'repairdesk' = synced from RepairDesk, 'manual' = manually added
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source text DEFAULT 'phone'
  CHECK (source IN ('phone', 'repairdesk', 'manual'));

-- Add external ID for deduplication when syncing from RepairDesk
ALTER TABLE leads ADD COLUMN IF NOT EXISTS external_id text;

-- Prevent duplicate imports from RepairDesk
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_external_source
  ON leads(business_id, source, external_id)
  WHERE external_id IS NOT NULL;

-- Index for filtering by source
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
