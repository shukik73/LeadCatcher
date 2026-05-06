import { describe, it, expect, vi, beforeEach } from 'vitest';

const businessUpdateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
const callAnalysesInsertSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'a-1' }, error: null }),
    }),
});

const mockGetAllCalls = vi.fn();

vi.mock('@/lib/repairdesk', () => ({
    RepairDeskClient: vi.fn(function () {
        return {
            getAllCalls: mockGetAllCalls,
            searchTickets: vi.fn().mockResolvedValue({ data: [] }),
            addTicketNote: vi.fn(),
        };
    }),
}));

vi.mock('@/lib/call-transcriber', () => ({
    transcribeRecording: vi.fn().mockResolvedValue(''),
}));

vi.mock('@/lib/ai-call-auditor', () => ({
    auditCall: vi.fn().mockResolvedValue({
        summary: 's',
        sentiment: 'neutral',
        category: 'follow_up',
        urgency: 'low',
        action_items: [],
        coaching_note: null,
        quality_scores: {},
        total_score: 0,
        max_possible_score: 0,
    }),
}));

vi.mock('@/lib/phone-utils', () => ({
    normalizePhoneNumber: vi.fn((p: string) => `+1${p.replace(/\D/g, '').slice(-10)}`),
}));

vi.mock('@/lib/audit-scoring', () => ({
    QUESTION_KEYS: [],
}));

vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/supabase-server', () => ({
    supabaseAdmin: {
        from: (table: string) => {
            if (table === 'businesses') {
                return {
                    select: vi.fn().mockReturnThis(),
                    not: vi.fn().mockResolvedValue({
                        data: [{
                            id: 'biz-1',
                            repairdesk_api_key: 'k',
                            repairdesk_store_url: null,
                            ai_audit_last_poll_at: '2024-01-01T00:00:00Z',
                            timezone: 'America/New_York',
                            name: 'Acme',
                        }],
                        error: null,
                    }),
                    update: businessUpdateSpy,
                    eq: vi.fn().mockResolvedValue({ error: null }),
                };
            }
            if (table === 'call_analyses') {
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                    insert: callAnalysesInsertSpy,
                    update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
                };
            }
            if (table === 'action_items') {
                return { insert: vi.fn().mockResolvedValue({ error: null }) };
            }
            return {};
        },
    },
}));

import { GET } from '@/app/api/cron/ai-audit/route';

function cronRequest() {
    return new Request('https://example.com/api/cron/ai-audit', {
        method: 'GET',
        headers: { authorization: 'Bearer test-cron-secret' },
    });
}

describe('AI audit watermark advancement', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.CRON_SECRET = 'test-cron-secret';
        // Force schedule into business hours so the run isn't skipped.
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-06-01T15:00:00Z'));  // 11 AM Eastern
    });

    it('does NOT advance watermark when MAX_CALLS_PER_RUN forces an early exit (11 calls, cap=10)', async () => {
        // Page 1 returns 11 calls with last_page=2 — there's clearly more backlog.
        const calls = Array.from({ length: 11 }, (_, i) => ({
            id: 1000 + i,
            phone: '+1555000' + (1000 + i),
            customer_name: `c${i}`,
            direction: 'inbound',
            status: 'missed',
            duration: 0,
            recording_url: null,
            notes: '',
            customer_id: 0,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
        }));
        mockGetAllCalls.mockResolvedValue({
            data: calls,
            meta: { current_page: 1, last_page: 2, per_page: 50, total: 60 },
        });

        const res = await GET(cronRequest());
        expect(res.status).toBe(200);

        // 10 calls should be processed but watermark MUST NOT advance.
        expect(callAnalysesInsertSpy).toHaveBeenCalledTimes(10);
        expect(businessUpdateSpy).not.toHaveBeenCalled();
    });

    it('advances watermark when the backlog is fully drained', async () => {
        mockGetAllCalls.mockResolvedValue({
            data: [{
                id: 1,
                phone: '+15551234567',
                customer_name: 'a',
                direction: 'inbound',
                status: 'missed',
                duration: 0,
                recording_url: null,
                notes: '',
                customer_id: 0,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
            }],
            meta: { current_page: 1, last_page: 1, per_page: 50, total: 1 },
        });

        const res = await GET(cronRequest());
        expect(res.status).toBe(200);
        expect(businessUpdateSpy).toHaveBeenCalled();
    });
});
