import { supabaseAdmin } from '@/lib/supabase-server';
import { RepairDeskClient } from '@/lib/repairdesk';
import { logger } from '@/lib/logger';
import { QUESTION_KEYS, QUESTION_LABELS } from '@/lib/audit-scoring';

const TAG = '[RD AuditSync]';

/**
 * Sync an audit to RepairDesk.
 *
 * 1. Fetches the audit and business RD credentials
 * 2. Looks up the customer by rd_lead_id
 * 3. Searches for their most recent ticket
 * 4. Adds a formatted audit note to the ticket
 *
 * Non-blocking: errors are logged but never thrown.
 */
export async function syncAuditToRepairDesk(
    auditId: string,
    businessId: string,
): Promise<{ ticketId: number | null; synced: boolean }> {
    try {
        const { data: business } = await supabaseAdmin
            .from('businesses')
            .select('repairdesk_api_key, repairdesk_store_url')
            .eq('id', businessId)
            .single();

        if (!business?.repairdesk_api_key) {
            logger.info(`${TAG} No RepairDesk credentials, skipping`, { auditId });
            return { ticketId: null, synced: false };
        }

        const { data: audit } = await supabaseAdmin
            .from('call_audits')
            .select('*')
            .eq('id', auditId)
            .single();

        if (!audit) {
            logger.error(`${TAG} Audit not found`, null, { auditId });
            return { ticketId: null, synced: false };
        }

        if (audit.rd_synced_at) {
            return { ticketId: audit.rd_ticket_id ? parseInt(audit.rd_ticket_id) : null, synced: true };
        }

        if (!audit.rd_lead_id) {
            logger.info(`${TAG} No rd_lead_id on audit, skipping`, { auditId });
            return { ticketId: null, synced: false };
        }

        const client = new RepairDeskClient(
            business.repairdesk_api_key,
            business.repairdesk_store_url || undefined,
        );

        // Look up the customer to get their phone number
        let customerPhone: string | null = null;
        try {
            const customer = await client.getCustomer(parseInt(audit.rd_lead_id));
            customerPhone = customer.phone || null;
        } catch (error) {
            logger.error(`${TAG} Failed to fetch customer from RepairDesk`, error, {
                auditId,
                rdLeadId: audit.rd_lead_id,
            });
            return { ticketId: null, synced: false };
        }

        if (!customerPhone) {
            logger.info(`${TAG} Customer has no phone, cannot search tickets`, { auditId });
            return { ticketId: null, synced: false };
        }

        // Find the most recent ticket for this customer
        let ticketId: number | null = null;
        try {
            const tickets = await client.searchTickets(customerPhone);
            if (tickets.data.length > 0) {
                ticketId = tickets.data[0].id;

                // Build the audit note
                const questionLines = QUESTION_KEYS.map((key) => {
                    const answer = audit[key] ? 'Yes' : 'No';
                    return `  ${QUESTION_LABELS[key]}: ${answer}`;
                }).join('\n');

                const percentage = audit.max_possible_score > 0
                    ? Math.round((audit.total_score / audit.max_possible_score) * 100)
                    : 0;

                const noteParts = [
                    `[LeadCatcher Phone Call Audit]`,
                    `Date: ${new Date(audit.audit_date).toLocaleString()}`,
                    `Employee: ${audit.employee_name}`,
                    `Submitted by: ${audit.submitted_by}`,
                    `Score: ${audit.total_score}/${audit.max_possible_score} (${percentage}%)`,
                    ``,
                    `Quality Checklist:`,
                    questionLines,
                    audit.device_price_quoted ? `\nDevice/Price Quoted: ${audit.device_price_quoted}` : null,
                    audit.improvements ? `Improvements: ${audit.improvements}` : null,
                    audit.call_status ? `Call Status: ${audit.call_status}` : null,
                ].filter((line) => line !== null).join('\n');

                await client.addTicketNote(ticketId, noteParts);
            }
        } catch (error) {
            logger.error(`${TAG} Failed to sync audit note to RepairDesk`, error, {
                auditId,
                customerPhone,
            });
        }

        // Update audit with sync status
        await supabaseAdmin
            .from('call_audits')
            .update({
                rd_synced_at: new Date().toISOString(),
                ...(ticketId != null ? { rd_ticket_id: ticketId.toString() } : {}),
            })
            .eq('id', auditId);

        logger.info(`${TAG} Audit synced`, {
            auditId,
            ticketId: ticketId?.toString() || 'none',
        });

        return { ticketId, synced: true };
    } catch (error) {
        logger.error(`${TAG} Unexpected error (non-blocking)`, error, { auditId });
        return { ticketId: null, synced: false };
    }
}
