import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for the follow-up draft engine (template-fallback path; no OPENAI key
 * in the test env so draftFollowUpSms exercises the degraded mode by default).
 */

const candidatesResult = vi.fn();
const existingDraftsResult = vi.fn();

// The OpenAI SDK refuses to construct in vitest's jsdom environment when a
// key is present; stub the module and clear the key so the lib takes its
// template-fallback path (the behavior under test).
vi.mock('openai', () => ({ default: vi.fn() }));
process.env.OPENAI_API_KEY = '';

vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/supabase-server', () => ({
    supabaseAdmin: {
        from: (table: string) => {
            if (table === 'call_analyses') {
                // .select().eq().eq().in().is().is().not().gte().lte().order().limit()
                const chain: Record<string, unknown> = {};
                const self = () => chain;
                for (const m of ['select', 'eq', 'in', 'is', 'not', 'gte', 'lte', 'order']) {
                    chain[m] = vi.fn(self);
                }
                chain.limit = vi.fn(() => candidatesResult());
                return chain;
            }
            // pending_followups: .select().eq().in()
            return {
                select: vi.fn(() => ({ eq: vi.fn(() => ({ in: vi.fn(() => existingDraftsResult()) })) })),
            };
        },
    },
}));

import { findFollowUpCandidates, draftFollowUpSms } from '@/lib/followup-drafts';

const row = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    customer_name: 'Maria Lopez',
    customer_phone: '+13055551234',
    summary: 'Maria asked about selling her Apple monitor; said she would bring it by.',
    category: 'repair_quote',
    created_at: new Date(Date.now() - 5 * 3600_000).toISOString(),
    ...overrides,
});

describe('findFollowUpCandidates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        existingDraftsResult.mockResolvedValue({ data: [], error: null });
    });

    it('returns candidates with phone numbers, filtering spam and wrong numbers', async () => {
        candidatesResult.mockResolvedValue({
            data: [
                row('a'),
                row('b', { category: 'spam' }),
                row('c', { category: 'wrong_number' }),
                row('d', { customer_phone: null }),
            ],
            error: null,
        });

        const out = await findFollowUpCandidates('biz-1');
        expect(out.map((c) => c.id)).toEqual(['a']);
    });

    it('drops callers who already have a draft (matched by phone, any status)', async () => {
        candidatesResult.mockResolvedValue({
            data: [row('a', { customer_phone: '+13050001111' }), row('b', { customer_phone: '+13050002222' })],
            error: null,
        });
        existingDraftsResult.mockResolvedValue({ data: [{ customer_phone: '+13050001111' }], error: null });

        const out = await findFollowUpCandidates('biz-1');
        expect(out.map((c) => c.id)).toEqual(['b']);
    });

    it('collapses multiple calls from the same number into ONE follow-up (per caller, not per call)', async () => {
        candidatesResult.mockResolvedValue({
            data: [
                // newest-first, as the DB query orders them; both from the same caller
                row('call-2', { customer_phone: '+19998887777', created_at: new Date(Date.now() - 2 * 3600_000).toISOString() }),
                row('call-1', { customer_phone: '+19998887777', created_at: new Date(Date.now() - 6 * 3600_000).toISOString() }),
            ],
            error: null,
        });
        const out = await findFollowUpCandidates('biz-1');
        expect(out.map((c) => c.id)).toEqual(['call-2']); // freshest call only
    });

    it('returns empty on query error instead of throwing', async () => {
        candidatesResult.mockResolvedValue({ data: null, error: { message: 'boom' } });
        const out = await findFollowUpCandidates('biz-1');
        expect(out).toEqual([]);
    });

    it('keeps quote/parts leads; drops status-check, follow_up, and no-intent calls', async () => {
        candidatesResult.mockResolvedValue({
            data: [
                row('quote', { category: 'repair_quote', customer_phone: '+13050000001' }),                          // kept
                row('parts', { category: 'parts_inquiry', customer_phone: '+13050000002' }),                         // kept
                row('rena', { category: 'status_check', follow_up_needed: true, customer_phone: '+13050000003' }),   // existing customer → dropped
                row('vague', { category: 'follow_up', follow_up_needed: true, customer_phone: '+13050000004' }),     // too vague → dropped
                row('noise', { category: 'other', follow_up_needed: true, customer_phone: '+13050000005' }),         // no sales intent → dropped
            ],
            error: null,
        });
        const out = await findFollowUpCandidates('biz-1');
        expect(out.map((c) => c.id).sort()).toEqual(['parts', 'quote']);
    });
});

describe('draftFollowUpSms (template fallback, no OpenAI key)', () => {
    it('produces a personalized, sendable template draft (never auto-sendable)', async () => {
        const draft = await draftFollowUpSms(row('a') as never, 'Techy Miramar');
        expect(draft.shouldSend).toBe(true);
        expect(draft.aiGenerated).toBe(false);
        // Templates are low-confidence so they never auto-send — approval only.
        expect(draft.confidence).toBe('low');
        expect(draft.sms).toContain('Hi Maria');
        expect(draft.sms).toContain('Techy Miramar');
        expect(draft.sms.length).toBeLessThanOrEqual(320);
    });

    it('omits the name greeting when the "name" is just a phone number', async () => {
        const draft = await draftFollowUpSms(
            row('a', { customer_name: '+17866089301 ' }) as never,
            'Techy Miramar',
        );
        expect(draft.sms.startsWith('Hi, ')).toBe(true);
        expect(draft.sms).not.toContain('+1786');
    });
});
