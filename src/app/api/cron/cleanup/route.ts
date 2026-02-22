import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/cleanup
 *
 * Purges webhook_events older than 7 days to keep the table small.
 * Triggered by Vercel Cron (daily at 3 AM UTC).
 */
export async function GET(request: Request) {
    // Authenticate via CRON_SECRET
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { supabaseAdmin } = await import('@/lib/supabase-server');
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const { error } = await supabaseAdmin
            .from('webhook_events')
            .delete()
            .lt('created_at', cutoff);

        if (error) {
            logger.error('[Cleanup] Failed to purge webhook events', error);
            return Response.json({ error: 'Cleanup failed' }, { status: 500 });
        }

        logger.info('[Cleanup] Purged old webhook events', { cutoff });
        return Response.json({ success: true, cutoff });
    } catch (error) {
        logger.error('[Cleanup] Unexpected error', error);
        return Response.json({ error: 'Internal error' }, { status: 500 });
    }
}
