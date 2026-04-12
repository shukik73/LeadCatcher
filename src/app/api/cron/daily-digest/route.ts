import { supabaseAdmin } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';
import { timingSafeEqual } from 'crypto';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

const TAG = '[Daily Digest]';

function verifyCronSecret(header: string | null): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret || !header) return false;
    const expected = `Bearer ${secret}`;
    if (header.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

/**
 * GET /api/cron/daily-digest
 *
 * Sends a morning briefing SMS to business owners at 7 AM (their timezone).
 * Summarizes yesterday's calls, pending actions, and quality scores.
 * Vercel Cron: schedule "0 * * * *" (hourly, checks timezone internally).
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
            .not('owner_phone', 'is', null);

        if (!businesses || businesses.length === 0) {
            return Response.json({ message: 'No businesses with digest enabled' });
        }

        const results = [];
        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

        for (const biz of businesses) {
            try {
                // Check if it's 7 AM in the business timezone
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

                if (hour !== 7) {
                    results.push({ businessId: biz.id, skipped: true, reason: `Not 7AM (hour=${hour})` });
                    continue;
                }

                // Get yesterday's date range in business timezone
                const yesterday = new Date(now);
                yesterday.setDate(yesterday.getDate() - 1);
                const startOfYesterday = new Date(yesterday);
                startOfYesterday.setHours(0, 0, 0, 0);
                const endOfYesterday = new Date(yesterday);
                endOfYesterday.setHours(23, 59, 59, 999);

                // Fetch yesterday's stats
                const [callsResult, missedResult, actionsResult, auditResult] = await Promise.all([
                    // Total calls
                    supabaseAdmin
                        .from('call_analyses')
                        .select('id', { count: 'exact', head: true })
                        .eq('business_id', biz.id)
                        .gte('created_at', startOfYesterday.toISOString())
                        .lte('created_at', endOfYesterday.toISOString()),
                    // Missed calls
                    supabaseAdmin
                        .from('call_analyses')
                        .select('id', { count: 'exact', head: true })
                        .eq('business_id', biz.id)
                        .eq('call_status', 'missed')
                        .gte('created_at', startOfYesterday.toISOString())
                        .lte('created_at', endOfYesterday.toISOString()),
                    // Pending action items
                    supabaseAdmin
                        .from('action_items')
                        .select('id, title, priority', { count: 'exact' })
                        .eq('business_id', biz.id)
                        .eq('status', 'pending')
                        .order('priority', { ascending: true })
                        .limit(3),
                    // Average quality score
                    supabaseAdmin
                        .from('call_analyses')
                        .select('ai_quality_total')
                        .eq('business_id', biz.id)
                        .not('ai_quality_total', 'is', null)
                        .gte('created_at', startOfYesterday.toISOString())
                        .lte('created_at', endOfYesterday.toISOString()),
                ]);

                const totalCalls = callsResult.count || 0;
                const missedCalls = missedResult.count || 0;
                const pendingActions = actionsResult.count || 0;
                const topActions = actionsResult.data || [];

                // Calculate avg quality
                const scores = (auditResult.data || [])
                    .map(r => r.ai_quality_total)
                    .filter((s): s is number => s != null);
                const avgQuality = scores.length > 0
                    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
                    : null;

                // Build digest message
                const lines = [
                    `Good morning! Here's your ${biz.name} daily briefing:`,
                    ``,
                    `Yesterday: ${totalCalls} calls, ${missedCalls} missed`,
                    pendingActions > 0 ? `${pendingActions} pending actions` : `No pending actions`,
                    avgQuality != null ? `Quality score avg: ${avgQuality}%` : null,
                ];

                if (topActions.length > 0) {
                    lines.push('');
                    lines.push('Top actions:');
                    for (const a of topActions) {
                        const flag = a.priority === 'high' ? '!' : '-';
                        lines.push(`${flag} ${a.title}`);
                    }
                }

                lines.push('');
                lines.push('Open LeadCatcher to review.');

                const message = lines.filter(l => l !== null).join('\n');

                // Send SMS
                if (biz.owner_phone && biz.forwarding_number) {
                    await twilioClient.messages.create({
                        to: biz.owner_phone,
                        from: biz.forwarding_number,
                        body: message,
                    });

                    logger.info(`${TAG} Digest sent`, { businessId: biz.id });
                    results.push({ businessId: biz.id, sent: true });
                } else {
                    results.push({ businessId: biz.id, skipped: true, reason: 'No phone numbers' });
                }
            } catch (error) {
                logger.error(`${TAG} Error for business`, error, { businessId: biz.id });
                results.push({ businessId: biz.id, error: 'Failed' });
            }
        }

        return Response.json({ success: true, results });
    } catch (error) {
        logger.error(`${TAG} Fatal error`, error);
        return Response.json({ error: 'Digest failed' }, { status: 500 });
    }
}
