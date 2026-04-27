import { supabaseAdmin } from '@/lib/supabase-server';
import { RepairDeskClient } from '@/lib/repairdesk';
import { transcribeRecording } from '@/lib/call-transcriber';
import { summarizeCallForRepairDesk } from '@/lib/call-summarizer';
import { normalizePhoneNumber } from '@/lib/phone-utils';
import { logger } from '@/lib/logger';
import { timingSafeEqual } from 'crypto';

export const dynamic = 'force-dynamic';

const TAG = '[Call Review]';
const MAX_CALLS_PER_RUN = 8;

function verifyCronSecret(header: string | null): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret || !header) return false;
    const expected = `Bearer ${secret}`;
    if (header.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

/**
 * GET /api/cron/call-review
 *
 * Runs every 1-2 hours. For each business:
 * 1. Fetches recent calls from RepairDesk (answered + missed with recordings)
 * 2. Transcribes recordings via Whisper
 * 3. AI extracts device, issue, and action needed
 * 4. Writes specific notes to RepairDesk tickets:
 *    "Customer called about iPhone 14 Pro Max screen. Quoted $89. Needs follow-up."
 * 5. Creates action items for follow-ups
 */
export async function GET(request: Request) {
    if (!verifyCronSecret(request.headers.get('authorization'))) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { data: businesses } = await supabaseAdmin
            .from('businesses')
            .select('id, name, repairdesk_api_key, repairdesk_store_url, ai_audit_last_poll_at')
            .not('repairdesk_api_key', 'is', null);

        if (!businesses || businesses.length === 0) {
            return Response.json({ message: 'No businesses configured' });
        }

        const results = [];

        for (const biz of businesses) {
            try {
                const result = await reviewBusinessCalls(biz);
                results.push({ businessId: biz.id, ...result });
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

async function reviewBusinessCalls(biz: {
    id: string; name: string; repairdesk_api_key: string;
    repairdesk_store_url: string | null; ai_audit_last_poll_at: string | null;
}) {
    const client = new RepairDeskClient(
        biz.repairdesk_api_key,
        biz.repairdesk_store_url || undefined,
    );

    const since = biz.ai_audit_last_poll_at || undefined;
    let reviewed = 0;
    let notesAdded = 0;
    let followUpsCreated = 0;

    // Fetch all calls
    const calls = await client.getAllCalls(1, since);

    for (const call of calls.data) {
        if (reviewed >= MAX_CALLS_PER_RUN) break;
        if (!call.phone) continue;

        let phone: string;
        try {
            phone = normalizePhoneNumber(call.phone);
        } catch {
            continue;
        }

        // Dedup check
        const rdCallLogId = `rd-review-${call.id}`;
        const { data: existing } = await supabaseAdmin
            .from('call_analyses')
            .select('id')
            .eq('business_id', biz.id)
            .eq('rd_call_log_id', rdCallLogId)
            .maybeSingle();

        if (existing) continue;

        // Transcribe if recording available
        let transcript: string | null = null;
        if (call.recording_url) {
            transcript = await transcribeRecording(call.recording_url);
        }

        const textToAnalyze = transcript || call.notes || null;
        if (!textToAnalyze) continue; // Nothing to review

        // AI: extract device, issue, and generate RD note
        const summary = await summarizeCallForRepairDesk(textToAnalyze, {
            customerName: call.customer_name,
            callDuration: call.duration,
            direction: call.direction,
        });

        if (!summary || !summary.is_actionable) continue;

        // Store in call_analyses
        const { data: analysis } = await supabaseAdmin
            .from('call_analyses')
            .insert({
                business_id: biz.id,
                source_call_id: rdCallLogId,
                rd_call_log_id: rdCallLogId,
                customer_name: call.customer_name || null,
                customer_phone: phone,
                call_status: call.status,
                call_duration: call.duration,
                recording_url: call.recording_url || null,
                transcript,
                summary: summary.rd_note,
                sentiment: 'neutral',
                category: summary.issue?.includes('status') ? 'status_check'
                    : summary.issue?.includes('screen') || summary.issue?.includes('battery') || summary.issue?.includes('repair') ? 'repair_quote'
                    : summary.issue?.includes('part') ? 'parts_inquiry'
                    : 'follow_up',
                urgency: summary.needs_follow_up ? 'medium' : 'low',
                follow_up_needed: summary.needs_follow_up,
                follow_up_notes: summary.follow_up_reason || null,
                callback_status: call.status === 'missed' ? 'pending' : 'called',
                processed_at: new Date().toISOString(),
            })
            .select('id')
            .single();

        reviewed++;

        // Write note to RepairDesk ticket
        try {
            const tickets = await client.searchTickets(phone);
            if (tickets.data.length > 0) {
                const ticket = tickets.data[0];
                const deviceInfo = summary.device ? ` (${summary.device})` : '';

                const rdNote = [
                    `[LeadCatcher Call Review]`,
                    `${call.direction === 'inbound' ? 'Incoming' : 'Outgoing'} ${call.status} call${deviceInfo}`,
                    summary.rd_note,
                    summary.needs_follow_up ? `\nFollow-up needed: ${summary.follow_up_reason}` : null,
                ].filter(Boolean).join('\n');

                await client.addTicketNote(ticket.id, rdNote);
                notesAdded++;

                // Update analysis with ticket info
                if (analysis?.id) {
                    await supabaseAdmin
                        .from('call_analyses')
                        .update({
                            rd_synced_at: new Date().toISOString(),
                            rd_ticket_id: ticket.id.toString(),
                            rd_ticket_status: ticket.status,
                        })
                        .eq('id', analysis.id);
                }
            }
        } catch (error) {
            logger.error(`${TAG} Failed to add RD note`, error, { phone });
        }

        // Create follow-up action item
        if (summary.needs_follow_up && analysis?.id) {
            const title = summary.device && summary.issue
                ? `${summary.device} ${summary.issue} — ${call.customer_name || phone}`
                : summary.follow_up_reason || `Follow up with ${call.customer_name || phone}`;

            await supabaseAdmin.from('action_items').insert({
                business_id: biz.id,
                call_analysis_id: analysis.id,
                title: title.substring(0, 200),
                description: summary.rd_note,
                action_type: summary.issue?.includes('status') ? 'repair_update'
                    : summary.issue?.includes('quote') || summary.issue?.includes('price') ? 'quote_needed'
                    : 'follow_up',
                priority: 'medium',
                assigned_role: 'tech',
                customer_name: call.customer_name || null,
                customer_phone: phone,
                source: 'ai',
            });

            followUpsCreated++;
        }
    }

    // Advance watermark
    if (reviewed > 0) {
        await supabaseAdmin
            .from('businesses')
            .update({ ai_audit_last_poll_at: new Date().toISOString() })
            .eq('id', biz.id);
    }

    logger.info(`${TAG} Business reviewed`, {
        businessId: biz.id,
        reviewed: reviewed.toString(),
        notesAdded: notesAdded.toString(),
        followUpsCreated: followUpsCreated.toString(),
    });

    return { reviewed, notesAdded, followUpsCreated };
}
