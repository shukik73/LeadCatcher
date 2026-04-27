import { supabaseAdmin } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';
import { timingSafeEqual } from 'crypto';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

const TAG = '[End-of-Day Report]';

function verifyCronSecret(header: string | null): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret || !header) return false;
    const expected = `Bearer ${secret}`;
    if (header.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

/**
 * GET /api/cron/end-of-day
 *
 * Runs hourly, sends at ~6 PM in each business timezone.
 * Sends owner a detailed report of all pending action items:
 *
 * "End of day report:
 *  - iPhone 14 Pro Max screen — John Smith. Quoted $89, needs follow-up.
 *  - Laptop repair status — Maria Lopez. Verify parts were ordered.
 *  - Samsung Galaxy battery — pending callback.
 *  3 items need attention tomorrow."
 */
export async function GET(request: Request) {
    if (!verifyCronSecret(request.headers.get('authorization'))) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { data: businesses } = await supabaseAdmin
            .from('businesses')
            .select('id, name, owner_phone, forwarding_number, timezone, daily_digest_enabled')
            .eq('daily_digest_enabled', true)
            .not('owner_phone', 'is', null)
            .not('forwarding_number', 'is', null);

        if (!businesses || businesses.length === 0) {
            return Response.json({ message: 'No businesses with digest enabled' });
        }

        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const results = [];

        for (const biz of businesses) {
            try {
                // Check if it's ~6 PM in business timezone
                const tz = biz.timezone || 'America/New_York';
                const now = new Date();
                let hour: number;
                try {
                    const formatter = new Intl.DateTimeFormat('en-US', {
                        hour: 'numeric', hour12: false, timeZone: tz,
                    });
                    hour = parseInt(formatter.format(now), 10);
                } catch {
                    hour = now.getUTCHours();
                }

                if (hour !== 19) {
                    results.push({ businessId: biz.id, skipped: true });
                    continue;
                }

                // Get today's date range
                const startOfDay = new Date(now);
                startOfDay.setHours(0, 0, 0, 0);

                // Fetch pending action items (all pending, not just today)
                const { data: pendingActions } = await supabaseAdmin
                    .from('action_items')
                    .select('title, description, customer_name, customer_phone, priority, action_type')
                    .eq('business_id', biz.id)
                    .eq('status', 'pending')
                    .order('priority', { ascending: true })
                    .limit(15);

                // Fetch today's calls summary
                const { count: todayCalls } = await supabaseAdmin
                    .from('call_analyses')
                    .select('id', { count: 'exact', head: true })
                    .eq('business_id', biz.id)
                    .gte('created_at', startOfDay.toISOString());

                const { count: todayMissed } = await supabaseAdmin
                    .from('call_analyses')
                    .select('id', { count: 'exact', head: true })
                    .eq('business_id', biz.id)
                    .eq('call_status', 'missed')
                    .gte('created_at', startOfDay.toISOString());

                const actions = pendingActions || [];
                const totalCalls = todayCalls || 0;
                const missedCalls = todayMissed || 0;

                if (actions.length === 0 && totalCalls === 0) {
                    results.push({ businessId: biz.id, skipped: true, reason: 'Nothing to report' });
                    continue;
                }

                // Build the report
                const lines: string[] = [];
                lines.push(`${biz.name} End of Day Report:`);
                lines.push(`Today: ${totalCalls} calls, ${missedCalls} missed`);

                if (actions.length > 0) {
                    lines.push('');
                    lines.push(`${actions.length} pending items:`);

                    for (const item of actions.slice(0, 10)) {
                        const flag = item.priority === 'high' ? '!' : '-';
                        const customer = item.customer_name || item.customer_phone || '';
                        const desc = item.title;
                        lines.push(`${flag} ${desc}${customer ? ` — ${customer}` : ''}`);
                    }

                    if (actions.length > 10) {
                        lines.push(`... and ${actions.length - 10} more`);
                    }
                } else {
                    lines.push('');
                    lines.push('No pending items. All caught up!');
                }

                const message = lines.join('\n');

                // Send SMS (might need to split if > 1600 chars)
                const maxLen = 1550;
                const smsBody = message.length > maxLen
                    ? message.substring(0, maxLen) + '\n... Open LeadCatcher for full list.'
                    : message;

                await twilioClient.messages.create({
                    to: biz.owner_phone,
                    from: biz.forwarding_number,
                    body: smsBody,
                });

                logger.info(`${TAG} Report sent`, {
                    businessId: biz.id,
                    pendingItems: actions.length.toString(),
                });

                results.push({
                    businessId: biz.id,
                    sent: true,
                    pendingItems: actions.length,
                    todayCalls: totalCalls,
                });
            } catch (error) {
                logger.error(`${TAG} Error for business`, error, { businessId: biz.id });
                results.push({ businessId: biz.id, error: 'Failed' });
            }
        }

        return Response.json({ success: true, results });
    } catch (error) {
        logger.error(`${TAG} Fatal error`, error);
        return Response.json({ error: 'Failed' }, { status: 500 });
    }
}
