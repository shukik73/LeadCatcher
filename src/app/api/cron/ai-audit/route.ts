import { supabaseAdmin } from '@/lib/supabase-server';
import { RepairDeskClient } from '@/lib/repairdesk';
import { transcribeRecording } from '@/lib/call-transcriber';
import { auditCall } from '@/lib/ai-call-auditor';
import { normalizePhoneNumber } from '@/lib/phone-utils';
import { QUESTION_KEYS } from '@/lib/audit-scoring';
import { logger } from '@/lib/logger';
import { timingSafeEqual } from 'crypto';

export const dynamic = 'force-dynamic';

const TAG = '[AI Audit Cron]';
const MAX_CALLS_PER_RUN = 10; // Limit per business per cron run to control costs

/**
 * Adaptive schedule (checked inside the handler):
 * - 10 AM - 7 PM:  every 10 min  (business hours)
 * - 7 PM - 10 PM:  every 30 min  (evening)
 * - 7 AM - 10 AM:  every 30 min  (morning ramp)
 * - 10 PM - 7 AM:  every 90 min  (overnight)
 *
 * Vercel Cron calls this every 10 minutes. We skip runs that fall
 * outside the current interval based on time of day.
 */
function shouldRunNow(timezone: string): boolean {
    const now = new Date();
    let hour: number;
    try {
        // Get the hour in the business timezone
        const formatter = new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            hour12: false,
            timeZone: timezone,
        });
        hour = parseInt(formatter.format(now), 10);
    } catch {
        hour = now.getUTCHours(); // fallback to UTC
    }

    const minute = now.getMinutes();

    // 10 AM - 7 PM: every 10 min (always run)
    if (hour >= 10 && hour < 19) return true;

    // 7 PM - 10 PM: every 30 min (run at :00 and :30)
    if (hour >= 19 && hour < 22) return minute < 10;

    // 7 AM - 10 AM: every 30 min (run at :00 and :30)
    if (hour >= 7 && hour < 10) return minute < 10;

    // 10 PM - 7 AM: every 90 min (run at :00 only on even hours)
    if (hour >= 22 || hour < 7) {
        return minute < 10 && hour % 2 === 0;
    }

    return true;
}

function verifyCronSecret(header: string | null): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret || !header) return false;
    const expected = `Bearer ${secret}`;
    if (header.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

/**
 * GET /api/cron/ai-audit
 *
 * Cron-triggered endpoint that:
 * 1. Polls RepairDesk for ALL recent calls (answered, missed, voicemail)
 * 2. Transcribes recordings via OpenAI Whisper
 * 3. AI audits each call (quality scoring + action items)
 * 4. Stores results and creates action items
 * 5. Syncs findings back to RepairDesk
 */
export async function GET(request: Request) {
    if (!verifyCronSecret(request.headers.get('authorization'))) {
        logger.warn(`${TAG} Unauthorized cron request`);
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { data: businesses, error: bizError } = await supabaseAdmin
            .from('businesses')
            .select('id, repairdesk_api_key, repairdesk_store_url, ai_audit_last_poll_at, timezone, name')
            .not('repairdesk_api_key', 'is', null);

        if (bizError) {
            logger.error(`${TAG} Failed to fetch businesses`, bizError);
            return Response.json({ error: 'Database error' }, { status: 500 });
        }

        if (!businesses || businesses.length === 0) {
            return Response.json({ message: 'No businesses with RepairDesk configured' });
        }

        const results = [];

        for (const business of businesses) {
            const tz = business.timezone || 'America/New_York';

            // Adaptive schedule: skip if not time to run for this business
            if (!shouldRunNow(tz)) {
                results.push({ businessId: business.id, skipped: true, reason: 'Not in schedule window' });
                continue;
            }

            try {
                const result = await processBusinessCalls(business);
                results.push({ businessId: business.id, ...result });
            } catch (error) {
                logger.error(`${TAG} Error processing business`, error, {
                    businessId: business.id,
                });
                results.push({ businessId: business.id, error: 'Processing failed' });
            }
        }

        logger.info(`${TAG} Completed`, {
            businessCount: businesses.length.toString(),
        });

        return Response.json({ success: true, results });
    } catch (error) {
        logger.error(`${TAG} Fatal error`, error);
        return Response.json({ error: 'Cron failed' }, { status: 500 });
    }
}

interface BusinessRow {
    id: string;
    repairdesk_api_key: string;
    repairdesk_store_url: string | null;
    ai_audit_last_poll_at: string | null;
    timezone: string | null;
    name: string;
}

async function processBusinessCalls(business: BusinessRow) {
    const client = new RepairDeskClient(
        business.repairdesk_api_key,
        business.repairdesk_store_url || undefined,
    );

    const since = business.ai_audit_last_poll_at || undefined;
    let callsProcessed = 0;
    let actionItemsCreated = 0;
    let rdSynced = 0;
    let allCallsFetched = true;
    // True only if we drained every page of the RepairDesk feed without hitting
    // either the per-run call cap or the page cap. Used to decide whether to
    // advance the watermark.
    let backlogDrained = false;
    let hitRunCap = false;
    let hitPageCap = false;

    try {
        let page = 1;
        const MAX_PAGES = 10;
        let totalProcessedThisRun = 0;

        while (page <= MAX_PAGES && totalProcessedThisRun < MAX_CALLS_PER_RUN) {
            const callLogs = await client.getAllCalls(page, since);

            if (callLogs.data.length === 0) {
                backlogDrained = true;
                break;
            }

            for (const call of callLogs.data) {
                if (totalProcessedThisRun >= MAX_CALLS_PER_RUN) break;

                // Skip calls without a phone number
                if (!call.phone) continue;

                const rdCallLogId = `rd-call-${call.id}`;

                // Deduplication: skip if we already processed this call
                const { data: existing } = await supabaseAdmin
                    .from('call_analyses')
                    .select('id')
                    .eq('business_id', business.id)
                    .eq('rd_call_log_id', rdCallLogId)
                    .maybeSingle();

                if (existing) continue;

                let normalizedPhone: string;
                try {
                    normalizedPhone = normalizePhoneNumber(call.phone);
                } catch {
                    logger.warn(`${TAG} Skipping call with invalid phone`, {
                        callId: call.id.toString(),
                    });
                    continue;
                }

                // Step 1: Transcribe the recording (if available)
                let transcript: string | null = null;
                if (call.recording_url) {
                    transcript = await transcribeRecording(call.recording_url);
                }

                // Step 2: AI audit
                const auditResult = await auditCall({
                    transcript: transcript || call.notes || `${call.status} call from ${call.customer_name || 'unknown customer'}. Duration: ${call.duration}s`,
                    callDuration: call.duration,
                    callStatus: call.status,
                    customerName: call.customer_name,
                    customerPhone: normalizedPhone,
                    direction: call.direction,
                });

                // Step 3: Insert call_analyses record
                const { data: analysis, error: insertError } = await supabaseAdmin
                    .from('call_analyses')
                    .insert({
                        business_id: business.id,
                        source_call_id: rdCallLogId,
                        rd_call_log_id: rdCallLogId,
                        customer_name: call.customer_name || null,
                        customer_phone: normalizedPhone,
                        call_status: call.status,
                        call_duration: call.duration,
                        recording_url: call.recording_url || null,
                        transcript: transcript || null,
                        summary: auditResult.summary,
                        sentiment: auditResult.sentiment,
                        category: auditResult.category,
                        urgency: auditResult.urgency,
                        follow_up_needed: auditResult.action_items.some(
                            a => a.action_type !== 'info',
                        ),
                        follow_up_notes: auditResult.action_items
                            .map(a => `[${a.priority.toUpperCase()}] ${a.title}: ${a.description}`)
                            .join('\n'),
                        coaching_note: auditResult.coaching_note || null,
                        callback_status: call.status === 'missed' ? 'pending' : 'called',
                        ai_quality_scores: auditResult.quality_scores,
                        ai_quality_total: auditResult.total_score,
                        ai_audited_at: new Date().toISOString(),
                        due_by: auditResult.urgency === 'high'
                            ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
                            : auditResult.urgency === 'medium'
                                ? new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
                                : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                        processed_at: new Date().toISOString(),
                    })
                    .select('id')
                    .single();

                if (insertError) {
                    if (insertError.code === '23505') continue; // duplicate, skip
                    logger.error(`${TAG} Failed to insert call analysis`, insertError);
                    continue;
                }

                // Step 4: Create action items
                for (const item of auditResult.action_items) {
                    if (item.action_type === 'info') continue; // skip info-only items

                    const { error: actionError } = await supabaseAdmin
                        .from('action_items')
                        .insert({
                            business_id: business.id,
                            call_analysis_id: analysis?.id || null,
                            title: item.title,
                            description: item.description,
                            action_type: item.action_type,
                            priority: item.priority,
                            assigned_role: item.assigned_role,
                            customer_name: call.customer_name || null,
                            customer_phone: normalizedPhone,
                            source: 'ai',
                        });

                    if (!actionError) actionItemsCreated++;
                }

                // Step 5: Sync back to RepairDesk (add audit note to ticket)
                if (analysis?.id) {
                    try {
                        const tickets = await client.searchTickets(normalizedPhone);
                        if (tickets.data.length > 0) {
                            const ticket = tickets.data[0];
                            const qualityPct = auditResult.max_possible_score > 0
                                ? Math.round((auditResult.total_score / auditResult.max_possible_score) * 100)
                                : 0;

                            const qualityLines = QUESTION_KEYS.map(key => {
                                const passed = auditResult.quality_scores[key];
                                return `  ${passed ? 'PASS' : 'FAIL'}: ${key.replace(/^q_/, '').replace(/_/g, ' ')}`;
                            }).join('\n');

                            const note = [
                                `[LeadCatcher AI Call Audit]`,
                                `Call: ${call.direction} ${call.status} (${call.duration}s)`,
                                `Quality Score: ${auditResult.total_score}/100 (${qualityPct}%)`,
                                `Category: ${auditResult.category} | Urgency: ${auditResult.urgency}`,
                                ``,
                                `Quality Breakdown:`,
                                qualityLines,
                                ``,
                                `Summary: ${auditResult.summary}`,
                                auditResult.coaching_note ? `Coaching: ${auditResult.coaching_note}` : null,
                                ``,
                                `Action Items:`,
                                ...auditResult.action_items.map(a =>
                                    `  - [${a.priority.toUpperCase()}] ${a.title} (${a.assigned_role})`
                                ),
                            ].filter(l => l !== null).join('\n');

                            await client.addTicketNote(ticket.id, note);

                            await supabaseAdmin
                                .from('call_analyses')
                                .update({
                                    rd_synced_at: new Date().toISOString(),
                                    rd_ticket_id: ticket.id.toString(),
                                    rd_ticket_status: ticket.status,
                                })
                                .eq('id', analysis.id);

                            rdSynced++;
                        }
                    } catch (error) {
                        logger.error(`${TAG} RD sync failed (non-blocking)`, error, {
                            callId: call.id.toString(),
                        });
                    }
                }

                callsProcessed++;
                totalProcessedThisRun++;
            }

            const meta = callLogs.meta;
            if (!meta || page >= meta.last_page || callLogs.data.length === 0) {
                backlogDrained = true;
                break;
            }
            page++;
        }

        // If the loop exited because we ran out of budget (not because the feed
        // was exhausted), record that so we leave the watermark alone.
        if (!backlogDrained) {
            if (totalProcessedThisRun >= MAX_CALLS_PER_RUN) hitRunCap = true;
            if (page > MAX_PAGES) hitPageCap = true;
        }
    } catch (error) {
        allCallsFetched = false;
        logger.error(`${TAG} Failed to fetch calls`, error, {
            businessId: business.id,
        });
    }

    // Advance watermark only if (a) every page was fetched without errors, AND
    // (b) we actually drained the backlog this run. If MAX_CALLS_PER_RUN or
    // MAX_PAGES forced an early exit, leave the watermark so the next run picks
    // up where we left off.
    const shouldAdvanceWatermark = allCallsFetched && backlogDrained && !hitRunCap && !hitPageCap;
    if (shouldAdvanceWatermark) {
        await supabaseAdmin
            .from('businesses')
            .update({ ai_audit_last_poll_at: new Date().toISOString() })
            .eq('id', business.id);
    } else if (allCallsFetched && (hitRunCap || hitPageCap)) {
        logger.warn(`${TAG} Watermark not advanced - backlog still pending`, {
            businessId: business.id,
            hitRunCap: hitRunCap.toString(),
            hitPageCap: hitPageCap.toString(),
        });
    }

    logger.info(`${TAG} Business processed`, {
        businessId: business.id,
        callsProcessed: callsProcessed.toString(),
        actionItemsCreated: actionItemsCreated.toString(),
        rdSynced: rdSynced.toString(),
    });

    return { callsProcessed, actionItemsCreated, rdSynced };
}
