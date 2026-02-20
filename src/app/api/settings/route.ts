import { createSupabaseServerClient, supabaseAdmin } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/settings
 *
 * Server-side settings save. Uses supabaseAdmin to bypass the
 * protect_stripe_columns trigger that can interfere with client-side updates.
 *
 * Accepts partial updates — only saves fields that are present in the body.
 */
export async function POST(request: Request) {
    try {
        const supabase = await createSupabaseServerClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get the user's business
        const { data: business } = await supabaseAdmin
            .from('businesses')
            .select('id')
            .eq('user_id', user.id)
            .single();

        if (!business) {
            return Response.json({ error: 'Business not found' }, { status: 404 });
        }

        const body = await request.json();

        // Whitelist of allowed fields — never allow stripe_* columns
        const allowedFields = [
            'sms_template',
            'sms_template_closed',
            'timezone',
            'business_hours',
            'repairdesk_api_key',
            'repairdesk_store_url',
        ];

        const updateData: Record<string, unknown> = {};
        for (const field of allowedFields) {
            if (field in body) {
                updateData[field] = body[field];
            }
        }

        if (Object.keys(updateData).length === 0) {
            return Response.json({ error: 'No valid fields to update' }, { status: 400 });
        }

        const { error } = await supabaseAdmin
            .from('businesses')
            .update(updateData)
            .eq('id', business.id);

        if (error) {
            logger.error('[Settings] Save failed', error, { businessId: business.id });
            return Response.json({ error: 'Failed to save settings' }, { status: 500 });
        }

        return Response.json({ success: true });
    } catch (error) {
        logger.error('[Settings] Unexpected error', error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
