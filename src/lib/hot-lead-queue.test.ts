import { describe, expect, it } from 'vitest';
import { buildHotLeadQueue } from './hot-lead-queue';

describe('buildHotLeadQueue', () => {
    it('merges actionable call analyses and open action items sorted by urgency then due date', () => {
        const leads = buildHotLeadQueue({
            calls: [
                {
                    id: 'call-low',
                    source_call_id: 'CA-low',
                    customer_name: 'Low Call',
                    customer_phone: '111',
                    urgency: 'low',
                    call_status: 'missed',
                    callback_status: 'pending',
                    due_by: '2026-06-08T12:00:00.000Z',
                    summary: 'Low urgency call',
                    follow_up_notes: null,
                    coaching_note: null,
                    rd_ticket_id: null,
                    created_at: '2026-06-08T08:00:00.000Z',
                    updated_at: '2026-06-08T08:00:00.000Z',
                },
            ],
            actionItems: [
                {
                    id: 'action-high',
                    title: 'Call customer about quote',
                    description: 'Customer is waiting on iPhone quote',
                    action_type: 'quote_needed',
                    priority: 'high',
                    status: 'pending',
                    customer_name: 'High Action',
                    customer_phone: '222',
                    call_analysis_id: null,
                    rd_ticket_id: 'RD-7',
                    created_at: '2026-06-08T09:00:00.000Z',
                    updated_at: '2026-06-08T09:00:00.000Z',
                },
            ],
            now: new Date('2026-06-08T10:00:00.000Z'),
        });

        expect(leads.summary.total).toBe(2);
        expect(leads.summary.highUrgency).toBe(1);
        expect(leads.leads.map((lead) => lead.id)).toEqual(['action-high', 'call-low']);
        expect(leads.leads[0]).toMatchObject({
            sourceType: 'action_item',
            customerName: 'High Action',
            urgency: 'high',
            callbackStatus: 'pending',
            summary: 'Call customer about quote',
            followUpNotes: 'Customer is waiting on iPhone quote',
            rdTicketId: 'RD-7',
        });
    });
});
