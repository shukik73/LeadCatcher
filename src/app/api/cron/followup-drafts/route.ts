import { supabaseAdmin } from '@/lib/supabase-server';
import { findFollowUpCandidates, draftFollowUpSms } from '@/lib/followup-drafts';
import { checkSmsRateLimit } from '@/lib/sms-rate-limit';
import { checkBillingStatus } from '@/lib/billing-guard';
import { logger } from '@/lib/logger';
import { timingSafeEqual } from 'crypto';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

const TAG = '[FollowUpDrafts Cron]';

// Owner review slots, business-local time: morning sweep, post-lunch, end of day.
const DIGEST_HOURS = [9, 13, 18];

function verifyCronSecret(header: string | null): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret || !header) return false;
    const expected = `Bearer ${secret}`;
    if (header.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

function localHour(timezone: string): number {
    try {
        return parseInt(
            new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone })
                .format(new Date()),
            10,
        ) % 24;
    } catch {
        return new Date().getUTCHours();
    }
}

/**
 * GET /api/cron/followup-drafts  (Vercel Cron, hourly)
 *
 * At 9am / 1pm / 6pm business-local time: find calls that showed intent but
 * never converted to a ticket or visit, AI-draft a personalized follow-up SMS
 * for each, store them as pending, and ping the owner to review. NOTHING is
 * sent to a customer here — sends happen only via the owner-approval endpoint.
 */
export async function GET(request: Request) {
    if (!verifyCronSecret(request.headers.get('authorization'))) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { data: businesses, error } = await supabaseAdmin
            .from('businesses')
            .select('id, name, timezone, owner_phone, forwarding_number')
            .not('repairdesk_api_key', 'is', null);

        if (error) {
            logger.error(`${TAG} Failed to fetch businesses`, error);
            return Response.json({ error: 'Database error' }, { status: 500 });
        }

        const results = [];
        for (const business of businesses || []) {
            const tz = business.timezone || 'America/New_York';
            if (!DIGEST_HOURS.includes(localHour(tz))) {
                results.push({ businessId: business.id, skipped: 'outside digest slot' });
                continue;
            }

            try {
                // Expire stale drafts so the review list never fills with cold leads
                await supabaseAdmin
                    .from('pending_followups')
                    .update({ status: 'expired' })
                    .eq('business_id', business.id)
                    .eq('status', 'pending')
                    .lt('created_at', new Date(Date.now() - 48 * 3600_000).toISOString());

                const candidates = await findFollowUpCandidates(business.id);
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
                        if (insertError.code === '23505') continue; // raced with another run
                        logger.error(`${TAG} Insert failed`, insertError, { callAnalysisId: candidate.id });
                        continue;
                    }
                    created++;
                }

                // Ping the owner when there's anything pending (new or carried over)
                const { count: pendingCount } = await supabaseAdmin
                    .from('pending_followups')
                    .select('id', { count: 'exact', head: true })
                    .eq('business_id', business.id)
                    .eq('status', 'pending');

                let pinged = false;
                if ((pendingCount || 0) > 0 && business.owner_phone && business.forwarding_number) {
                    pinged = await pingOwner(business, pendingCount || 0);
                }

                results.push({ businessId: business.id, created, pending: pendingCount || 0, pinged });
            } catch (bizError) {
                logger.error(`${TAG} Business failed`, bizError, { businessId: business.id });
                results.push({ businessId: business.id, error: 'failed' });
            }
        }

        return Response.json({ success: true, results });
    } catch (error) {
        logger.error(`${TAG} Fatal error`, error);
        return Response.json({ error: 'Cron failed' }, { status: 500 });
    }
}

async function pingOwner(
    business: { id: string; owner_phone: string | null; forwarding_number: string | null },
    pendingCount: number,
): Promise<boolean> {
    const billing = await checkBillingStatus(business.id);
    if (!billing.allowed) return false;

    const rateLimit = await checkSmsRateLimit(business.id, business.owner_phone!);
    if (!rateLimit.allowed) return false;

    try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || '';
        const link = baseUrl ? `\nReview: ${baseUrl}/dashboard/followups` : '';
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await client.messages.create({
            to: business.owner_phone!,
            from: business.forwarding_number!,
            body: `[FOLLOW-UPS] ${pendingCount} draft message${pendingCount === 1 ? '' : 's'} waiting for your approval.${link}`,
        });
        return true;
    } catch (error) {
        logger.error(`${TAG} Owner ping failed`, error, { businessId: business.id });
        return false;
    }
}
