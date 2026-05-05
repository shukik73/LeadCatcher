import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture every supabaseAdmin.from(table) call so we can assert what tables
// the rate-limiter touches.
const fromCalls: Array<{ table: string; opts: unknown[] }> = [];

function makeChain(returnValue: { count: number | null; error: unknown }) {
    const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        // The chain's .then is what `await` calls — return our mocked value.
        then: (resolve: (v: unknown) => void) => resolve(returnValue),
    };
    return chain;
}

const mockChainResults: Array<{ count: number | null; error: unknown }> = [];

vi.mock('@/lib/supabase-server', () => ({
    supabaseAdmin: {
        from: (table: string, ...opts: unknown[]) => {
            fromCalls.push({ table, opts });
            const next = mockChainResults.shift() || { count: 0, error: null };
            return makeChain(next);
        },
    },
}));

vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { checkSmsRateLimit } from '@/lib/sms-rate-limit';

describe('checkSmsRateLimit', () => {
    beforeEach(() => {
        fromCalls.length = 0;
        mockChainResults.length = 0;
    });

    it('queries the messages table directly and never loads lead IDs', async () => {
        // First query (per-caller) and second query (per-business) both return 0.
        mockChainResults.push({ count: 0, error: null });
        mockChainResults.push({ count: 0, error: null });

        const result = await checkSmsRateLimit('biz-1', '+15551234567');
        expect(result.allowed).toBe(true);

        const tablesQueried = fromCalls.map(c => c.table);
        // Critical: we must NOT call .from('leads') just to materialize IDs.
        expect(tablesQueried).not.toContain('leads');
        // Both counts must be against the messages table.
        expect(tablesQueried.filter(t => t === 'messages').length).toBeGreaterThanOrEqual(1);
    });

    it('blocks the SMS when the per-caller count query errors (fail closed)', async () => {
        mockChainResults.push({ count: null, error: { message: 'boom' } });

        const result = await checkSmsRateLimit('biz-1', '+15551234567');
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/precaution/i);
    });

    it('blocks the SMS when the per-caller limit is hit', async () => {
        mockChainResults.push({ count: 5, error: null }); // PER_CALLER_LIMIT

        const result = await checkSmsRateLimit('biz-1', '+15551234567');
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/messages per hour to this number/i);
    });

    it('blocks the SMS when the per-business limit is hit', async () => {
        mockChainResults.push({ count: 0, error: null }); // per-caller OK
        mockChainResults.push({ count: 200, error: null }); // PER_BUSINESS_LIMIT

        const result = await checkSmsRateLimit('biz-1', '+15551234567');
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/messages per hour for this business/i);
    });
});
