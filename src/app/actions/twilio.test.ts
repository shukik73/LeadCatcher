import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression coverage for B-02 (multi-tenant collision on the shared Twilio number).
 *
 * Before the fix, a second business onboarding hit the partial unique index
 * `businesses_forwarding_number_unique` and got a raw Postgres 23505 surfaced as a
 * generic "Failed to save phone number to your account". These tests prove the
 * failure now returns a clear, single-tenant-aware message, and that the
 * TWILIO_NUMBER_STRATEGY seam is wired for the future per-tenant implementation.
 */

// Hoisted so they're initialized before the vi.mock factories run (vitest lifts
// vi.mock and the SUT import above normal top-level consts).
const { mockList, mockIncomingNumberUpdate, mockOwnershipMaybeSingle, mockUpdateEq } = vi.hoisted(() => ({
    mockList: vi.fn(),
    mockIncomingNumberUpdate: vi.fn(),
    mockOwnershipMaybeSingle: vi.fn(),
    mockUpdateEq: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Twilio client: incomingPhoneNumbers is both callable (sid) -> { update } and has .list().
vi.mock('twilio', () => {
    const incomingPhoneNumbers = Object.assign(
        () => ({ update: mockIncomingNumberUpdate }),
        { list: mockList },
    );
    const twilioFn = () => ({ incomingPhoneNumbers });
    return { default: twilioFn };
});

// Supabase: server client (auth + RLS business lookup) and admin client (cross-tenant
// ownership check + protected update).
const getUserMock = vi.fn();
const serverBusinessSingle = vi.fn();

vi.mock('@/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
    supabaseAdmin: {
        from: () => ({
            select: () => ({
                eq: () => ({
                    neq: () => ({ maybeSingle: mockOwnershipMaybeSingle }),
                }),
            }),
            update: () => ({ eq: mockUpdateEq }),
        }),
    },
}));

import { autoLinkTwilioNumber, linkTwilioNumberToBusiness } from '@/app/actions/twilio';
import { createSupabaseServerClient } from '@/lib/supabase-server';

const SHARED_NUMBER = '+15550001111';

beforeEach(() => {
    vi.clearAllMocks();

    process.env.TWILIO_ACCOUNT_SID = 'ACtestaccountsid';
    process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
    process.env.TWILIO_PHONE_NUMBER = SHARED_NUMBER;
    delete process.env.TWILIO_NUMBER_STRATEGY;
    // Skip the auto webhook-config branch (keeps the Twilio mock minimal).
    delete process.env.APP_BASE_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;

    const serverClient = {
        auth: { getUser: getUserMock },
        from: () => ({
            select: () => ({ eq: () => ({ single: serverBusinessSingle }) }),
        }),
    };
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(serverClient);

    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    serverBusinessSingle.mockResolvedValue({ data: { id: 'biz-current' }, error: null });
    mockList.mockResolvedValue([{ phoneNumber: SHARED_NUMBER, sid: 'PN123' }]);
    mockOwnershipMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockUpdateEq.mockResolvedValue({ error: null });
});

describe('autoLinkTwilioNumber — single-tenant collision (B-02)', () => {
    it('returns a clear single-tenant error when another business already owns the number', async () => {
        // A different business already holds the shared forwarding number.
        mockOwnershipMaybeSingle.mockResolvedValue({ data: { id: 'biz-other' }, error: null });

        const result = await autoLinkTwilioNumber();

        expect(result.success).toBe(false);
        expect(result.error).toContain('already linked to another business');
        expect(result.error).toContain('single-tenant');
        // Must NOT attempt the update once the collision is detected.
        expect(mockUpdateEq).not.toHaveBeenCalled();
    });

    it('links successfully for the first business to claim the number', async () => {
        const result = await autoLinkTwilioNumber();

        expect(result.success).toBe(true);
        expect(result.forwardingNumber).toBe(SHARED_NUMBER);
        expect(mockUpdateEq).toHaveBeenCalledTimes(1);
    });
});

describe('linkTwilioNumberToBusiness — 23505 race safety net', () => {
    it('translates a unique-violation on update into the friendly message', async () => {
        // Pre-check passes (no owner yet) but the update loses the race -> 23505.
        mockOwnershipMaybeSingle.mockResolvedValue({ data: null, error: null });
        mockUpdateEq.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });

        const result = await linkTwilioNumberToBusiness(SHARED_NUMBER, 'PN123');

        expect(result.success).toBe(false);
        expect(result.error).toContain('already linked to another business');
        expect(result.error).not.toBe('Failed to save phone number to your account');
    });
});

describe('TWILIO_NUMBER_STRATEGY=per-tenant seam', () => {
    it('fails loudly (not implemented) without touching the shared-number path', async () => {
        process.env.TWILIO_NUMBER_STRATEGY = 'per-tenant';

        const result = await autoLinkTwilioNumber();

        expect(result.success).toBe(false);
        expect(result.error).toContain('not enabled yet');
        // Shared-number lookup and ownership check must be skipped entirely.
        expect(mockList).not.toHaveBeenCalled();
        expect(mockOwnershipMaybeSingle).not.toHaveBeenCalled();
    });
});
