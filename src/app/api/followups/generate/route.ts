import { createSupabaseServerClient, supabaseAdmin } from '@/lib/supabase-server';
import { validateCsrfOrigin } from '@/lib/csrf';
import { findFollowUpCandidates, draftFollowUpSms } from '@/lib/followup-drafts';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const TAG = '[FollowUpGenerate]';

/**
 * POST /api/followups/generate
 *
 * Owner-triggered "find follow-ups now" — runs the same candidate detection +
 * AI drafting as the digest cron, but for the authenticated owner's business
 * only and without the 9am/1pm/6pm gate or the 3h cool-off. Still never sends:
 * it only creates pending drafts for the owner to approve.
 */
export async function POST(request: Request) {
    if (!validateCsrfOrigin(request)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
        const supabase = await createSupabaseServerClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (!user || authError) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id, name')
            .eq('user_id', user.id)
            .single();
        if (!business) {
            return Response.json({ error: 'Business not found' }, { status: 404 });
        }

        // On-demand: no cool-off grace (minAgeHours = 0) so the owner sees
        // results from calls that just came in.
        const candidates = await findFollowUpCandidates(business.id, 0);
        let created = 0;

        for (const candidate of candidates) {
            const draft = await draftFollowUpSms(candidate, business.name || 'our store');
            if (!draft.shouldSend) continue;

            const { error: insertError } = await supabaseAdmin
                .from('pending_followups')
                .insert({
                    business_id: business.id,
                    call_analysis_id: candidate.id,
                    customer_name: candidate.customer_name,
                    customer_phone: candidate.customer_phone,
                    reason: draft.reason,
                    draft_sms: draft.sms,
                    ai_generated: draft.aiGenerated,
                });
            if (insertError) {
                if (insertError.code === '23505') continue; // already drafted
                logger.error(`${TAG} Insert failed`, insertError, { callAnalysisId: candidate.id });
                continue;
            }
            created++;
        }

        logger.info(`${TAG} On-demand generation`, { businessId: business.id, created });
        return Response.json({ success: true, created, candidates: candidates.length });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
