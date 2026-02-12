import { createSupabaseServerClient } from '@/lib/supabase-server';
import { RepairDeskClient } from '@/lib/repairdesk';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const supabase = await createSupabaseServerClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { apiKey, storeUrl } = await request.json() as {
            apiKey: string;
            storeUrl?: string;
        };

        if (!apiKey) {
            return Response.json({ error: 'API key is required' }, { status: 400 });
        }

        const client = new RepairDeskClient(apiKey, storeUrl);
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
