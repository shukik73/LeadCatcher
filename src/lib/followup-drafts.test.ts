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
            // pending_followups: .select().in()
            return {
                select: vi.fn(() => ({ in: vi.fn(() => existingDraftsResult()) })),
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

    it('drops calls that already have a draft in any status', async () => {
        candidatesResult.mockResolvedValue({ data: [row('a'), row('b')], error: null });
        existingDraftsResult.mockResolvedValue({ data: [{ call_analysis_id: 'a' }], error: null });

        const out = await findFollowUpCandidates('biz-1');
        expect(out.map((c) => c.id)).toEqual(['b']);
    });

    it('returns empty on query error instead of throwing', async () => {
        candidatesResult.mockResolvedValue({ data: null, error: { message: 'boom' } });
        const out = await findFollowUpCandidates('biz-1');
        expect(out).toEqual([]);
    });

    it('includes answered quote calls (intent by category) and follow_up_needed calls; drops no-intent calls', async () => {
        candidatesResult.mockResolvedValue({
            data: [
                row('quote', { category: 'repair_quote', follow_up_needed: false }),     // intent by category
                row('flagged', { category: 'other', follow_up_needed: true }),            // intent by flag
                row('noise', { category: 'other', follow_up_needed: false }),             // no intent → dropped
            ],
            error: null,
        });
        const out = await findFollowUpCandidates('biz-1');
        expect(out.map((c) => c.id).sort()).toEqual(['flagged', 'quote']);
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
