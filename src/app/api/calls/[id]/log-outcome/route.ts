import { updateCallAnalysis } from '@/lib/call-actions';
import { validateCsrfOrigin } from '@/lib/csrf';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
    outcome: z.enum(['booked', 'lost', 'no_answer']),
    notes: z.string().max(5000).optional(),
    booked_value: z.number().nonnegative().nullable().optional(),
}).strict();

/**
 * POST /api/calls/:id/log-outcome
 * Logs a follow-up outcome with optional notes and booking value.
 */
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    if (!validateCsrfOrigin(request)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
        return Response.json(
            { error: 'Invalid payload', details: parsed.error.issues.map(i => i.message) },
            { status: 400 },
        );
    }

    const { outcome, notes, booked_value } = parsed.data;
    const { id } = await params;

    const result = await updateCallAnalysis(id, () => ({
        callback_status: outcome,
        acted_on: true,
        ...(notes ? { outcome_notes: notes } : {}),
        ...(booked_value != null ? { booked_value } : {}),
    }), 'log-outcome');

    return Response.json(
        result.success ? result : { error: result.error },
        { status: result.status || 200 },
    );
}
