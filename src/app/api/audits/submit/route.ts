import { createSupabaseServerClient, supabaseAdmin } from '@/lib/supabase-server';
import { validateCsrfOrigin } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { calculateAuditScore, QUESTION_KEYS, type QuestionKey } from '@/lib/audit-scoring';
import { syncAuditToRepairDesk } from '@/lib/audit-rd-sync';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const TAG = '[AuditSubmit]';

const auditSchema = z.object({
    store_name: z.string().min(1).max(200),
    store_email: z.string().email().max(255).optional().or(z.literal('')),
    manager_email: z.string().email().max(255).optional().or(z.literal('')),
    employee_name: z.string().min(1).max(200),
    submitted_by: z.string().min(1).max(200),
    audit_date: z.string().min(1),
    rd_lead_id: z.string().max(256).optional().or(z.literal('')),
    call_analysis_id: z.string().uuid().optional().or(z.literal('')),
    q_proper_greeting: z.boolean(),
    q_open_ended_questions: z.boolean(),
    q_location_info: z.boolean(),
    q_closing_with_name: z.boolean(),
    q_warranty_mention: z.boolean(),
    q_timely_answers: z.boolean(),
    q_alert_demeanor: z.boolean(),
    q_call_under_2_30: z.boolean(),
    q_effort_customer_in: z.boolean(),
    device_price_quoted: z.string().max(500).optional().or(z.literal('')),
    improvements: z.string().max(5000).optional().or(z.literal('')),
    call_status: z.string().max(100).optional().or(z.literal('')),
}).strict();

/**
 * POST /api/audits/submit
 *
 * Submit a phone call audit with quality scoring.
 * Optionally links to a call_analyses record and syncs to RepairDesk.
 */
export async function POST(request: Request) {
    if (!validateCsrfOrigin(request)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return Response.json({ error: 'Invalid JSON' }, { status: 400 });
        }

        const parsed = auditSchema.safeParse(body);
        if (!parsed.success) {
            return Response.json(
                { error: 'Invalid payload', details: parsed.error.issues.map(i => i.message) },
                { status: 400 },
            );
        }

        const input = parsed.data;

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

        // Calculate score
        const answers: Record<QuestionKey, boolean> = {} as Record<QuestionKey, boolean>;
        for (const key of QUESTION_KEYS) {
            answers[key] = input[key];
        }
        const score = calculateAuditScore(answers);

        // Parse audit_date
        const auditDate = new Date(input.audit_date);
        if (isNaN(auditDate.getTime())) {
            return Response.json({ error: 'Invalid audit_date' }, { status: 400 });
        }

        // Insert audit
        const { data: inserted, error: insertError } = await supabaseAdmin
            .from('call_audits')
            .insert({
                business_id: business.id,
                call_analysis_id: input.call_analysis_id || null,
                store_name: input.store_name,
                store_email: input.store_email || null,
                manager_email: input.manager_email || null,
                employee_name: input.employee_name,
                submitted_by: input.submitted_by,
                audit_date: auditDate.toISOString(),
                rd_lead_id: input.rd_lead_id || null,
                q_proper_greeting: input.q_proper_greeting,
                q_open_ended_questions: input.q_open_ended_questions,
                q_location_info: input.q_location_info,
                q_closing_with_name: input.q_closing_with_name,
                q_warranty_mention: input.q_warranty_mention,
                q_timely_answers: input.q_timely_answers,
                q_alert_demeanor: input.q_alert_demeanor,
                q_call_under_2_30: input.q_call_under_2_30,
                q_effort_customer_in: input.q_effort_customer_in,
                total_score: score.total_score,
                max_possible_score: score.max_possible_score,
                device_price_quoted: input.device_price_quoted || null,
                improvements: input.improvements || null,
                call_status: input.call_status || null,
            })
            .select('id')
            .single();

        if (insertError) {
            logger.error(`${TAG} Insert failed`, insertError);
            return Response.json({ error: 'Failed to save audit' }, { status: 500 });
        }

        const auditId = inserted!.id;

        // Link to call_analyses if provided
        if (input.call_analysis_id) {
            const { error: linkError } = await supabaseAdmin
                .from('call_analyses')
                .update({
                    audit_id: auditId,
                    audit_score: score.total_score,
                })
                .eq('id', input.call_analysis_id)
                .eq('business_id', business.id);

            if (linkError) {
                logger.error(`${TAG} Failed to link audit to call_analyses`, linkError, {
                    auditId,
                    callAnalysisId: input.call_analysis_id,
                });
            }
        }

        // Non-blocking RepairDesk sync
        if (input.rd_lead_id) {
            syncAuditToRepairDesk(auditId, business.id).catch((error) => {
                logger.error(`${TAG} Background RD sync failed`, error, { auditId });
            });
        }

        logger.info(`${TAG} Audit submitted`, {
            auditId,
            score: score.total_score.toString(),
            employee: input.employee_name,
        });

        return Response.json({
            success: true,
            id: auditId,
            total_score: score.total_score,
            max_possible_score: score.max_possible_score,
            percentage: score.percentage,
        });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
