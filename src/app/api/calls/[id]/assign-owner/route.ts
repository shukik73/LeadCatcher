import { updateCallAnalysis } from '@/lib/call-actions';
import { validateCsrfOrigin } from '@/lib/csrf';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
    owner: z.string().min(1).max(100),
}).strict();

/**
 * POST /api/calls/:id/assign-owner
 * Assigns an owner (rep/tech name) to a call follow-up.
 * Body: { "owner": "Mike" }
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
        return Response.json({ error: 'Body must include "owner" (string)' }, { status: 400 });
    }

    const { id } = await params;
    const result = await updateCallAnalysis(id, () => ({
        owner: parsed.data.owner,
    }), 'assign-owner');

    return Response.json(
        result.success ? result : { error: result.error },
        { status: result.status || 200 },
    );
}
