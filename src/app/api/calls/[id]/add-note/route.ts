import { updateCallAnalysis } from '@/lib/call-actions';
import { validateCsrfOrigin } from '@/lib/csrf';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
    note: z.string().min(1).max(5000),
}).strict();

/**
 * POST /api/calls/:id/add-note
 * Appends an internal note to a call analysis.
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

    const { note } = parsed.data;
    const { id } = await params;

    const result = await updateCallAnalysis(id, (current) => {
        const existing = typeof current.internal_notes === 'string' ? current.internal_notes : '';
        const timestamp = new Date().toISOString();
        const newEntry = `[${timestamp}] ${note}`;
        const updated = existing ? `${existing}\n${newEntry}` : newEntry;
        return { internal_notes: updated };
    }, 'add-note');

    return Response.json(
        result.success ? result : { error: result.error },
        { status: result.status || 200 },
    );
}
