import { updateCallAnalysis } from '@/lib/call-actions';
import { validateCsrfOrigin } from '@/lib/csrf';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
    booked_value: z.number().nonnegative().nullable().optional(),
}).strict().optional();

/**
 * POST /api/calls/:id/mark-booked
 * Marks a call as "booked" — customer confirmed appointment/repair.
 * Optionally accepts { booked_value: number }.
 */
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    if (!validateCsrfOrigin(request)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    let bookedValue: number | null = null;
    try {
        const body = await request.json();
        const parsed = bodySchema.safeParse(body);
        if (parsed.success && parsed.data?.booked_value != null) {
            bookedValue = parsed.data.booked_value;
        }
    } catch {
        // Empty body is fine
    }

    const { id } = await params;
    const result = await updateCallAnalysis(id, () => ({
        callback_status: 'booked',
        acted_on: true,
        ...(bookedValue != null ? { booked_value: bookedValue } : {}),
    }), 'mark-booked');

    return Response.json(
        result.success ? result : { error: result.error },
        { status: result.status || 200 },
    );
}
