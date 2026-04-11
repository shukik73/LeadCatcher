import { createSupabaseServerClient } from '@/lib/supabase-server';
import { validateCsrfOrigin } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { syncAuditToRepairDesk } from '@/lib/audit-rd-sync';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const TAG = '[AuditSyncRD]';

const bodySchema = z.object({
    audit_id: z.string().uuid(),
}).strict();

/**
 * POST /api/audits/sync-rd
 *
 * Manually sync an audit to RepairDesk.
 * Finds the customer by rd_lead_id, locates their ticket, and adds the audit note.
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

        const parsed = bodySchema.safeParse(body);
        if (!parsed.success) {
            return Response.json(
                { error: 'Invalid payload', details: parsed.error.issues.map(i => i.message) },
                { status: 400 },
            );
        }

        const { audit_id } = parsed.data;

        const supabase = await createSupabaseServerClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (!user || authError) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id, repairdesk_api_key')
            .eq('user_id', user.id)
            .single();

        if (!business) {
            return Response.json({ error: 'Business not found' }, { status: 404 });
        }

        if (!business.repairdesk_api_key) {
            return Response.json({ error: 'RepairDesk not configured' }, { status: 400 });
        }

        // Verify ownership
        const { data: audit } = await supabase
            .from('call_audits')
            .select('id, rd_synced_at')
            .eq('id', audit_id)
            .eq('business_id', business.id)
            .single();

        if (!audit) {
            return Response.json({ error: 'Audit not found' }, { status: 404 });
        }

        if (audit.rd_synced_at) {
            return Response.json({ success: true, already_synced: true });
        }

        const result = await syncAuditToRepairDesk(audit_id, business.id);

        logger.info(`${TAG} Manual sync completed`, {
            auditId: audit_id,
            ticketId: result.ticketId?.toString() || 'none',
        });

        return Response.json({
            success: true,
            ticket_found: result.ticketId != null,
            ticket_id: result.ticketId,
        });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Failed to sync audit' }, { status: 500 });
    }
}
