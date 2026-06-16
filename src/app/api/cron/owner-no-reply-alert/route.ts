import { supabaseAdmin } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';
import { shouldAlertOwner, sendOwnerNoReplyAlert } from '@/lib/owner-no-reply-alert';
import { timingSafeEqual } from 'crypto';

export const dynamic = 'force-dynamic';

const TAG = '[OwnerNoReplyAlert Cron]';
// How long to wait, after texting a customer with no reply, before nudging the owner to call.
const THRESHOLD_MINUTES = 30;

function verifyCronSecret(header: string | null): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret || !header) return false;
    const expected = `Bearer ${secret}`;
    if (header.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

/**
 * GET /api/cron/owner-no-reply-alert
 *
 * Finds leads we texted after a missed call where the customer still hasn't
 * replied after THRESHOLD_MINUTES, and texts the owner to call them. One alert
 * per lead (deduped via leads.owner_alerted_at).
 */
export async function GET(request: Request) {
    if (!verifyCronSecret(request.headers.get('authorization'))) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();
    let alerted = 0;
    let considered = 0;

    // Businesses that want owner alerts (have an owner number on file).
    const { data: businesses, error: bizError } = await supabaseAdmin
        .from('businesses')
        .select('id, owner_phone, forwarding_number')
        .not('owner_phone', 'is', null);

    if (bizError) {
        logger.error(`${TAG} Failed to fetch businesses`, bizError);
        return Response.json({ error: 'DB error' }, { status: 500 });
    }

    for (const business of businesses || []) {
        // Leads we've texted (Contacted) but haven't yet alerted the owner about.
        const { data: leads, error: leadError } = await supabaseAdmin
            .from('leads')
            .select('id, caller_phone, caller_name, status, owner_alerted_at')
            .eq('business_id', business.id)
            .eq('status', 'Contacted')
            .is('owner_alerted_at', null);

        if (leadError) {
            logger.error(`${TAG} Failed to fetch leads`, leadError, { businessId: business.id });
            continue;
        }

        for (const lead of leads || []) {
            considered++;

            const { data: messages, error: msgError } = await supabaseAdmin
                .from('messages')
                .select('direction, created_at')
                .eq('lead_id', lead.id);

            if (msgError) {
                logger.error(`${TAG} Failed to fetch messages`, msgError, { leadId: lead.id });
                continue;
            }

            const inboundExists = (messages || []).some((m) => m.direction === 'inbound');
            const lastOutboundAt = (messages || [])
                .filter((m) => m.direction === 'outbound')
                .map((m) => m.created_at as string)
                .sort()
                .at(-1) ?? null;

            const decision = shouldAlertOwner({
                status: lead.status,
                ownerAlertedAt: lead.owner_alerted_at,
                ownerPhone: business.owner_phone,
                forwardingNumber: business.forwarding_number,
                lastOutboundAt,
                inboundExists,
                now,
                thresholdMinutes: THRESHOLD_MINUTES,
            });

            if (!decision) continue;

            const sent = await sendOwnerNoReplyAlert({
                leadId: lead.id,
                businessId: business.id,
                ownerPhone: business.owner_phone,
                forwardingNumber: business.forwarding_number,
                callerPhone: lead.caller_phone,
                callerName: lead.caller_name,
            });
            if (sent) alerted++;
        }
    }

    logger.info(`${TAG} Complete`, { considered, alerted });
    return Response.json({ considered, alerted });
}
