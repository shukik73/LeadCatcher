import { supabaseAdmin } from '@/lib/supabase-server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { logger } from '@/lib/logger';
import { scoreCall } from '@/lib/call-scoring';
import { validateCsrfOrigin } from '@/lib/csrf';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const TAG = '[CallAnalyze]';

const analyzeSchema = z.object({
    source_call_id: z.string().min(1).max(256),
    rd_lead_id: z.string().max(256).nullable().optional(),
    customer_name: z.string().max(256).nullable().optional(),
    customer_phone: z.string().max(20).nullable().optional(),
    call_status: z.enum(['missed', 'answered', 'outbound']),
    call_duration: z.number().int().nonnegative().nullable().optional(),
    recording_url: z.string().url().max(2048).nullable().optional(),
    transcript: z.string().max(50000).nullable().optional(),
    summary: z.string().max(5000).nullable().optional(),
}).strict();

/**
 * POST /api/calls/analyze
 *
 * Ingest a call, run AI scoring, and store the analysis.
 * Idempotent on source_call_id — safe to call multiple times.
 * Requires authentication — business_id is derived server-side.
 */
export async function POST(request: Request) {
    if (!validateCsrfOrigin(request)) {
        return new Response('Forbidden', { status: 403 });
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() { return cookieStore.getAll() },
                setAll(cookiesToSet) { try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch { } }
            }
        }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response('Unauthorized', { status: 401 });

    // Derive business_id from authenticated user — never accept from client
    const { data: business } = await supabaseAdmin
        .from('businesses')
        .select('id')
        .eq('user_id', user.id)
        .single();

    if (!business) return Response.json({ error: 'Business not found' }, { status: 404 });

    try {
        let rawBody: unknown;
        try {
            rawBody = await request.json();
        } catch {
            return Response.json({ error: 'Invalid JSON' }, { status: 400 });
        }

        const parsed = analyzeSchema.safeParse(rawBody);
        if (!parsed.success) {
            return Response.json(
                { error: 'Invalid payload', details: parsed.error.issues.map(i => i.message) },
                { status: 400 }
            );
        }

        const input = parsed.data;

        // Idempotency check — if already analyzed, return existing
        const { data: existing } = await supabaseAdmin
            .from('call_analyses')
            .select('id, category, urgency, callback_status')
            .eq('source_call_id', input.source_call_id)
            .single();

        if (existing) {
            logger.info(`${TAG} Duplicate source_call_id, returning existing`, {
                id: existing.id,
                source_call_id: input.source_call_id,
            });
            return Response.json({ success: true, id: existing.id, duplicate: true });
        }

        // Check previous calls from this phone for urgency context
        let previousCallCount = 0;
        if (input.customer_phone) {
            const { count } = await supabaseAdmin
                .from('call_analyses')
                .select('id', { count: 'exact', head: true })
                .eq('business_id', business.id)
                .eq('customer_phone', input.customer_phone);
            previousCallCount = count || 0;
        }

        // Run AI scoring
        const score = await scoreCall({
            transcript: input.transcript,
            summary: input.summary,
            customerName: input.customer_name,
            customerPhone: input.customer_phone,
            callStatus: input.call_status,
            callDuration: input.call_duration,
            previousCallCount,
        });

        // Insert the analysis
        const { data: inserted, error: insertError } = await supabaseAdmin
            .from('call_analyses')
            .insert({
                business_id: business.id,
                source_call_id: input.source_call_id,
                rd_lead_id: input.rd_lead_id || null,
                customer_name: input.customer_name || null,
                customer_phone: input.customer_phone || null,
                call_status: input.call_status,
                call_duration: input.call_duration ?? null,
                recording_url: input.recording_url || null,
                transcript: input.transcript || null,
                summary: score.summary,
                sentiment: score.sentiment,
                category: score.category,
                urgency: score.urgency,
                follow_up_needed: score.follow_up_needed,
                follow_up_notes: score.follow_up_notes,
                callback_status: 'pending',
                coaching_note: score.coaching_note,
                due_by: score.due_by,
                processed_at: new Date().toISOString(),
            })
            .select('id')
            .single();

        if (insertError) {
            // Handle unique constraint violation (race condition)
            if (insertError.code === '23505') {
                logger.info(`${TAG} Race condition duplicate, safe to ignore`, {
                    source_call_id: input.source_call_id,
                });
                return Response.json({ success: true, duplicate: true });
            }
            logger.error(`${TAG} Insert failed`, insertError);
            return Response.json({ error: 'Failed to store analysis' }, { status: 500 });
        }

        logger.info(`${TAG} Call analyzed`, {
            id: inserted?.id,
            category: score.category,
            urgency: score.urgency,
            follow_up_needed: score.follow_up_needed,
        });

        return Response.json({
            success: true,
            id: inserted?.id,
            category: score.category,
            urgency: score.urgency,
            sentiment: score.sentiment,
            follow_up_needed: score.follow_up_needed,
            due_by: score.due_by,
        });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
