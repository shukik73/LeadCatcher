import { createSupabaseServerClient } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const TAG = '[FollowUpDrafts List]';

/**
 * GET /api/followups/drafts
 * Pending follow-up drafts for the authenticated owner's business.
 */
export async function GET() {
    try {
        const supabase = await createSupabaseServerClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (!user || authError) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id')
            .eq('user_id', user.id)
            .single();
        if (!business) {
            return Response.json({ error: 'Business not found' }, { status: 404 });
        }

        const { data, error } = await supabase
            .from('pending_followups')
            .select('id, customer_name, customer_phone, reason, draft_sms, ai_generated, status, created_at, call_analysis_id')
            .eq('business_id', business.id)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            logger.error(`${TAG} Query failed`, error);
            return Response.json({ error: 'Failed to fetch drafts' }, { status: 500 });
        }

        return Response.json({ success: true, drafts: data || [] });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
