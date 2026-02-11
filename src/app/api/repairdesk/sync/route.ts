import { supabaseAdmin } from '@/lib/supabase-server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { RepairDeskClient } from '@/lib/repairdesk';
import { logger } from '@/lib/logger';
import { normalizePhoneNumber } from '@/lib/phone-utils';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request) {
    try {
        // Auth: verify the user owns this business
        const supabase = await createSupabaseServerClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get business with RepairDesk credentials
        const { data: business } = await supabase
            .from('businesses')
            .select('id, repairdesk_api_key, repairdesk_store_url')
            .eq('user_id', user.id)
            .single();

        if (!business?.repairdesk_api_key) {
            return Response.json(
                { error: 'RepairDesk API key not configured. Go to Settings to add it.' },
                { status: 400 }
            );
        }

        const client = new RepairDeskClient(
            business.repairdesk_api_key,
            business.repairdesk_store_url
        );

        // Fetch customers from RepairDesk
        let totalSynced = 0;
        let totalSkipped = 0;
        let page = 1;
        const maxPages = 10; // Safety limit

        while (page <= maxPages) {
            const response = await client.getCustomers(page);
            const customers = response.data;

            if (!customers || customers.length === 0) break;

            for (const customer of customers) {
                // Skip customers without a phone number
                if (!customer.phone) {
                    totalSkipped++;
                    continue;
                }

                let normalizedPhone: string;
                try {
                    normalizedPhone = normalizePhoneNumber(customer.phone);
                } catch {
                    logger.warn('[RepairDesk Sync] Skipping customer with invalid phone', {
                        customerId: customer.id.toString(),
                        phone: customer.phone,
                    });
                    totalSkipped++;
                    continue;
                }

                const externalId = `rd-customer-${customer.id}`;
                const callerName = [customer.first_name, customer.last_name]
                    .filter(Boolean)
                    .join(' ') || null;

                // Upsert lead — skip if already imported (external_id is unique per business+source)
                const { error } = await supabaseAdmin
                    .from('leads')
                    .upsert(
                        {
                            business_id: business.id,
                            caller_phone: normalizedPhone,
                            caller_name: callerName,
                            source: 'repairdesk',
                            external_id: externalId,
                            status: 'New',
                        },
                        {
                            onConflict: 'business_id,source,external_id',
                            ignoreDuplicates: true,
                        }
                    );

                if (error) {
                    logger.error('[RepairDesk Sync] Failed to upsert lead', error, {
                        customerId: customer.id.toString(),
                    });
                    totalSkipped++;
                } else {
                    totalSynced++;
                }
            }

            // Check if there are more pages
            if (response.meta && page >= response.meta.last_page) break;
            page++;
        }

        logger.info('[RepairDesk Sync] Completed', {
            businessId: business.id,
            totalSynced: totalSynced.toString(),
            totalSkipped: totalSkipped.toString(),
            pagesProcessed: page.toString(),
        });

        return Response.json({
            success: true,
            synced: totalSynced,
            skipped: totalSkipped,
        });
    } catch (error) {
        logger.error('[RepairDesk Sync] Error', error);
        return Response.json(
            { error: 'Sync failed. Check your API key and try again.' },
            { status: 500 }
        );
    }
}
