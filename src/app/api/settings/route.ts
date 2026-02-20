import { createSupabaseServerClient } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/settings
 *
 * Server-side settings save. Uses the authenticated user's Supabase client
 * for business lookup, then attempts update via service role (to bypass
 * the protect_stripe_columns trigger) with fallback to user's own client.
 */
export async function POST(request: Request) {
    try {
        const supabase = await createSupabaseServerClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (!user || authError) {
            logger.warn('[Settings] Auth failed', { error: authError?.message });
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Use the authenticated client to find the business (works with RLS)
        const { data: business, error: bizError } = await supabase
            .from('businesses')
            .select('id')
            .eq('user_id', user.id)
            .single();

        if (!business || bizError) {
            logger.error('[Settings] Business not found', bizError, { userId: user.id });
            return Response.json({ error: 'Business not found. Complete onboarding first.' }, { status: 404 });
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

        // Try supabaseAdmin first (bypasses protect_stripe_columns trigger),
        // fall back to authenticated client if admin isn't available.
        let saveError;
        try {
            const { supabaseAdmin } = await import('@/lib/supabase-server');
            const { error } = await supabaseAdmin
                .from('businesses')
                .update(updateData)
                .eq('id', business.id);
            saveError = error;
        } catch {
            // supabaseAdmin not available (missing SUPABASE_SERVICE_ROLE_KEY)
            // Fall back to authenticated client
            logger.warn('[Settings] supabaseAdmin unavailable, using user client');
            const { error } = await supabase
                .from('businesses')
                .update(updateData)
                .eq('id', business.id);
            saveError = error;
        }

        if (saveError) {
            logger.error('[Settings] Save failed', saveError, { businessId: business.id });
            return Response.json({ error: `Failed to save: ${saveError.message}` }, { status: 500 });
        }

        return Response.json({ success: true });
    } catch (error) {
        logger.error('[Settings] Unexpected error', error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
