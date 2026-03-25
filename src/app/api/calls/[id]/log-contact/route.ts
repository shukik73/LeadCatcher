import { updateCallAnalysis } from '@/lib/call-actions';
import { validateCsrfOrigin } from '@/lib/csrf';
import { autoSyncToRepairDesk } from '@/lib/repairdesk-auto-sync';

export const dynamic = 'force-dynamic';

/**
 * POST /api/calls/:id/log-contact
 * Logs a contact attempt — increments contact_attempts and sets last_contacted_at.
 */
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    if (!validateCsrfOrigin(request)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    const result = await updateCallAnalysis(id, (current) => ({
        contact_attempts: (typeof current.contact_attempts === 'number' ? current.contact_attempts : 0) + 1,
        last_contacted_at: new Date().toISOString(),
        callback_status: 'called',
        acted_on: true,
    }), 'log-contact');

    // Auto-sync to RepairDesk on contact attempt (non-blocking)
    if (result.success) {
        autoSyncToRepairDesk(id).catch(() => {});
    }

    return Response.json(
        result.success ? result : { error: result.error },
        { status: result.status || 200 },
    );
}
