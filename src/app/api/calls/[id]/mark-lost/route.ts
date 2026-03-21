import { updateCallAnalysis } from '@/lib/call-actions';
import { validateCsrfOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

/**
 * POST /api/calls/:id/mark-lost
 * Marks a call as "lost" — customer did not convert.
 */
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    if (!validateCsrfOrigin(request)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const result = await updateCallAnalysis(id, () => ({
        callback_status: 'lost',
        acted_on: true,
    }), 'mark-lost');

    return Response.json(
        result.success ? result : { error: result.error },
        { status: result.status || 200 },
    );
}
