import { createSupabaseServerClient } from '@/lib/supabase-server';
import { RepairDeskClient } from '@/lib/repairdesk';
import { validateCsrfOrigin } from '@/lib/csrf';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    // CSRF protection: validate Origin header
    if (!validateCsrfOrigin(request)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
        const supabase = await createSupabaseServerClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { apiKey, subdomain, useStored } = await request.json() as {
            apiKey?: string;
            subdomain?: string;
            useStored?: boolean;
        };

        let resolvedApiKey = apiKey;
        let resolvedSubdomain = subdomain;

        // If no apiKey provided, look up the stored one from the database
        if (!resolvedApiKey && useStored) {
            const { data: business } = await supabase
                .from('businesses')
                .select('repairdesk_api_key, repairdesk_store_url')
                .eq('user_id', user.id)
                .single();

            if (business?.repairdesk_api_key) {
                resolvedApiKey = business.repairdesk_api_key;
                if (!resolvedSubdomain) {
                    resolvedSubdomain = business.repairdesk_store_url || undefined;
                }
            }
        }

        if (!resolvedApiKey) {
            return Response.json({ error: 'API key is required' }, { status: 400 });
        }

        const client = new RepairDeskClient(resolvedApiKey, resolvedSubdomain);
        const result = await client.testConnection();

        if (result.success) {
            logger.info('[RepairDesk] Connection test successful', { userId: user.id });
            return Response.json({ success: true, message: 'Connected to RepairDesk' });
        } else {
            logger.warn('[RepairDesk] Connection test failed', {
                userId: user.id,
                error: result.error,
                baseUrl: result.baseUrl,
            });
            return Response.json(
                {
                    success: false,
                    message: `Connection failed: ${result.error}`,
                    baseUrl: result.baseUrl,
                },
                { status: 400 }
            );
        }
    } catch (error) {
        logger.error('[RepairDesk] Connection test error', error);
        return Response.json(
            { error: 'Failed to test connection' },
            { status: 500 }
        );
    }
}
