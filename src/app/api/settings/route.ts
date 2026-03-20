import { createSupabaseServerClient } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

/** Zod schema for settings payload — validates types and constraints. */
const settingsSchema = z.object({
    sms_template: z.string().min(1).max(1600).optional(),
    sms_template_closed: z.string().min(1).max(1600).optional(),
    timezone: z.string().min(1).max(100).regex(/^[A-Za-z_/]+$/).optional(),
    business_hours: z.record(z.object({
        open: z.string().regex(/^\d{2}:\d{2}$/),
        close: z.string().regex(/^\d{2}:\d{2}$/),
        isOpen: z.boolean(),
    })).optional(),
    repairdesk_api_key: z.string().min(1).max(256).optional(),
    repairdesk_store_url: z.string().min(1).max(256).regex(/^[a-zA-Z0-9.-]+$/).optional(),
    business_phone: z.string().min(1).max(20).optional(),
    owner_phone: z.string().min(1).max(20).optional(),
    carrier: z.string().min(1).max(50).optional(),
}).strict();

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

        let rawBody: unknown;
        try {
            rawBody = await request.json();
        } catch {
            return Response.json({ error: 'Invalid JSON' }, { status: 400 });
        }

        const parsed = settingsSchema.safeParse(rawBody);
        if (!parsed.success) {
            return Response.json(
                { error: 'Invalid settings', details: parsed.error.issues.map((i: { message: string }) => i.message) },
                { status: 400 }
            );
        }

        const updateData = parsed.data;

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
            return Response.json({ error: 'Failed to save settings' }, { status: 500 });
        }

        return Response.json({ success: true });
    } catch (error) {
        logger.error('[Settings] Unexpected error', error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
