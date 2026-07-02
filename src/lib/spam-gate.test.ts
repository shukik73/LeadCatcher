import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---
const mockSupabaseFrom = vi.fn();
vi.mock('@/lib/supabase-server', () => ({
    supabaseAdmin: { from: (...args: unknown[]) => mockSupabaseFrom(...args) },
}));
vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('twilio', () => ({ default: () => ({}) }));

import { evaluateCallerHeuristics, isBlocklisted, evaluateSpam } from '@/lib/spam-gate';

function chain(returnValue: { data: unknown; error: unknown }) {
    return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(returnValue),
        upsert: vi.fn().mockResolvedValue({ error: null }),
    };
}

describe('evaluateCallerHeuristics (pure)', () => {
    it('never blocks a normal mobile caller in standard mode', () => {
        const v = evaluateCallerHeuristics({ caller: '+13055551212', callerName: 'JOHN SMITH' }, 'standard');
        expect(v.isSpam).toBe(false);
    });

    it('hard-blocks anonymous / withheld caller ID', () => {
        for (const c of ['anonymous', 'Private', 'UNAVAILABLE', 'restricted', '']) {
            const v = evaluateCallerHeuristics({ caller: c }, 'standard');
            expect(v.isSpam, `caller="${c}"`).toBe(true);
            expect(v.reason).toBe('anonymous_caller');
        }
    });

    it('hard-blocks an implausible / short-code number', () => {
        const v = evaluateCallerHeuristics({ caller: '12345' }, 'standard');
        expect(v.isSpam).toBe(true);
        expect(v.reason).toBe('invalid_number');
    });

    it('mode "off" never blocks, even anonymous', () => {
        expect(evaluateCallerHeuristics({ caller: 'anonymous' }, 'off').isSpam).toBe(false);
    });

    it('soft signals (VoIP + foreign + no CNAM) only block in aggressive mode', () => {
        const signals = { caller: '+447700900000', callerName: null, fromCountry: 'GB', businessCountry: 'US', lineType: 'nonFixedVoip' };
        // Standard: soft signals present but not a hard block → allowed.
        expect(evaluateCallerHeuristics(signals, 'standard').isSpam).toBe(false);
        // Aggressive: score 2 (voip) + 2 (foreign) + 1 (no cnam) = 5 >= 3 → blocked.
        const agg = evaluateCallerHeuristics(signals, 'aggressive');
        expect(agg.isSpam).toBe(true);
        expect(agg.score).toBeGreaterThanOrEqual(3);
    });

    it('a domestic VoIP caller with CNAM is NOT blocked even in aggressive mode', () => {
        // e.g. a real customer on Google Voice: VoIP (+2) but domestic and named → score 2 < 3.
        const v = evaluateCallerHeuristics(
            { caller: '+13055551212', callerName: 'JANE DOE', fromCountry: 'US', businessCountry: 'US', lineType: 'nonFixedVoip' },
            'aggressive',
        );
        expect(v.isSpam).toBe(false);
    });
});

describe('isBlocklisted', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns true when the number is on the list', async () => {
        mockSupabaseFrom.mockReturnValue(chain({ data: { id: 'x' }, error: null }));
        expect(await isBlocklisted('biz-1', '+13055551212')).toBe(true);
    });

    it('returns false when absent', async () => {
        mockSupabaseFrom.mockReturnValue(chain({ data: null, error: null }));
        expect(await isBlocklisted('biz-1', '+13055551212')).toBe(false);
    });

    it('fails OPEN (false) on a DB error', async () => {
        mockSupabaseFrom.mockReturnValue(chain({ data: null, error: { message: 'boom' } }));
        expect(await isBlocklisted('biz-1', '+13055551212')).toBe(false);
    });
});

describe('evaluateSpam (orchestration)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('blocks a blocklisted caller regardless of heuristics', async () => {
        mockSupabaseFrom.mockReturnValue(chain({ data: { id: 'x' }, error: null }));
        const v = await evaluateSpam({ businessId: 'biz-1', caller: '+13055551212', callerNormalized: '+13055551212', mode: 'standard' });
        expect(v.isSpam).toBe(true);
        expect(v.reason).toBe('blocklisted');
    });

    it('allows a normal caller not on the blocklist', async () => {
        mockSupabaseFrom.mockReturnValue(chain({ data: null, error: null }));
        const v = await evaluateSpam({ businessId: 'biz-1', caller: '+13055551212', callerNormalized: '+13055551212', callerName: 'JOHN', mode: 'standard' });
        expect(v.isSpam).toBe(false);
    });

    it('mode "off" short-circuits to allowed without touching the DB', async () => {
        const v = await evaluateSpam({ businessId: 'biz-1', caller: 'anonymous', mode: 'off' });
        expect(v.isSpam).toBe(false);
        expect(mockSupabaseFrom).not.toHaveBeenCalled();
    });
});
