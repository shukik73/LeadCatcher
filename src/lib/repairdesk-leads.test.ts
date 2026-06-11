import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RepairDeskClient } from './repairdesk';

/**
 * Tests for the /appointment-backed call-log adapter.
 *
 * RepairDesk has no /call-logs endpoint (it 200s an embedded error object),
 * so getMissedCalls / getOutboundCallsTo / getAllCalls are derived from the
 * leads feed at /appointment (data.LeadsData).
 */

// Format an instant as the store's wall-clock time, the way RepairDesk does.
// The client under test defaults to America/New_York, so tests are correct
// regardless of the machine/CI timezone (the original bug: parsing store-local
// times in server time made every call look hours old on a UTC host).
const STORE_TZ = 'America/New_York';
function fmtRdDate(d: Date): string {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
            timeZone: STORE_TZ,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false,
        }).formatToParts(d).map((p) => [p.type, p.value]),
    );
    const hour = parts.hour === '24' ? '00' : parts.hour;
    return `${parts.year}/${parts.month}/${parts.day} ${hour}:${parts.minute}`;
}

interface LeadOpts {
    id: string;
    callStatus: 'Answered' | 'Missed Call' | 'OutBound';
    createdAt: Date;
    mobile?: string;
    fullName?: string;
    recordingUrl?: string | null;
}

function lead({ id, callStatus, createdAt, mobile = '+1 305-494-4078', fullName = 'Test Caller', recordingUrl = null }: LeadOpts) {
    return {
        summary: {
            id,
            order_id: `L-${id}`,
            status: 'New',
            call_status: callStatus,
            recording_url: recordingUrl,
            created_date: fmtRdDate(createdAt),
            customer: { id: '42', fullName, mobile, email: '' },
        },
        devices: [],
    };
}

function leadsEnvelope(leads: unknown[], nextPageExist = 0) {
    return {
        success: true,
        statusCode: 200,
        message: 'OK',
        data: {
            LeadsData: leads,
            pagination: { page: 1, per_page: 25, next_page_exist: nextPageExist, next_page: 2, total_pages: 1 },
        },
    };
}

function errorEnvelope(message: string) {
    return {
        success: false,
        statusCode: 200,
        message: 'OK',
        data: { name: 'Error', message, code: 0, status: 404 },
    };
}

function mockFetchOnce(bodies: unknown[]) {
    let call = 0;
    const fn = vi.fn(async () => {
        const body = bodies[Math.min(call, bodies.length - 1)];
        call++;
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fn);
    return fn;
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000);

describe('RepairDeskClient leads feed adapter', () => {
    let client: RepairDeskClient;

    beforeEach(() => {
        client = new RepairDeskClient('test-key');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('getLeads surfaces the embedded error when LeadsData is missing (200-wrapped error)', async () => {
        mockFetchOnce([errorEnvelope('Unknown endpoint')]);
        await expect(client.getLeads()).rejects.toThrow(/Unknown endpoint/);
    });

    it('getMissedCalls returns only inbound missed calls, mapped to call-log shape', async () => {
        mockFetchOnce([
            leadsEnvelope([
                lead({ id: '101', callStatus: 'Missed Call', createdAt: minutesAgo(10) }),
                lead({ id: '102', callStatus: 'Answered', createdAt: minutesAgo(9), recordingUrl: 'https://r/a.wav' }),
                lead({ id: '103', callStatus: 'OutBound', createdAt: minutesAgo(8) }),
            ]),
        ]);

        const res = await client.getMissedCalls(1, minutesAgo(60).toISOString());

        expect(res.data).toHaveLength(1);
        const call = res.data[0];
        expect(call.id).toBe(101);
        expect(call.status).toBe('missed');
        expect(call.direction).toBe('inbound');
        expect(call.phone).toBe('+1 305-494-4078');
        expect(call.customer_name).toBe('Test Caller');
        // Synthesized single page: callers' pagination loops must terminate
        expect(res.meta?.last_page).toBe(1);
    });

    it('returns an empty page for page > 1 (all results fit on the synthesized page 1)', async () => {
        mockFetchOnce([
            leadsEnvelope([lead({ id: '101', callStatus: 'Missed Call', createdAt: minutesAgo(5) })]),
        ]);
        const res = await client.getMissedCalls(2, minutesAgo(60).toISOString());
        expect(res.data).toHaveLength(0);
        expect(res.meta?.last_page).toBe(1);
    });

    it('stops paginating once a page is entirely older than `since`', async () => {
        const fetchMock = mockFetchOnce([
            leadsEnvelope([lead({ id: '201', callStatus: 'Answered', createdAt: minutesAgo(600) })], 1),
            leadsEnvelope([lead({ id: '200', callStatus: 'Answered', createdAt: minutesAgo(700) })], 1),
        ]);

        const res = await client.getAllCalls(1, minutesAgo(30).toISOString());

        expect(res.data).toHaveLength(0);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('applies the default lookback when no `since` is given (no full-history scan)', async () => {
        mockFetchOnce([
            leadsEnvelope([
                lead({ id: '301', callStatus: 'Missed Call', createdAt: minutesAgo(30) }),
                lead({ id: '300', callStatus: 'Missed Call', createdAt: minutesAgo(60 * 24) }), // yesterday
            ]),
        ]);

        const res = await client.getMissedCalls(1);

        expect(res.data.map((c) => c.id)).toEqual([301]);
    });

    it('getOutboundCallsTo matches phone numbers across formatting variants', async () => {
        mockFetchOnce([
            leadsEnvelope([
                lead({ id: '401', callStatus: 'OutBound', createdAt: minutesAgo(5), mobile: '+1 305-494-4078' }),
                lead({ id: '402', callStatus: 'OutBound', createdAt: minutesAgo(4), mobile: '+1 786-608-9301' }),
                lead({ id: '403', callStatus: 'Missed Call', createdAt: minutesAgo(3), mobile: '+1 305-494-4078' }),
            ]),
        ]);

        const res = await client.getOutboundCallsTo('13054944078', minutesAgo(60).toISOString());

        expect(res.data.map((c) => c.id)).toEqual([401]);
    });

    it('parses store-local timestamps to the correct instant regardless of server timezone', async () => {
        // A call 10 minutes ago, expressed as ET wall-clock text (as the feed
        // does). On a UTC server, naive parsing would read this as ~4-5h old
        // and filter it out of a 2h window. It must survive the default lookback.
        mockFetchOnce([
            leadsEnvelope([lead({ id: '601', callStatus: 'Missed Call', createdAt: minutesAgo(10) })]),
        ]);

        const res = await client.getMissedCalls(1); // default lookback, no since

        expect(res.data.map((c) => c.id)).toEqual([601]);
        const parsed = Date.parse(res.data[0].created_at);
        expect(Math.abs(parsed - minutesAgo(10).getTime())).toBeLessThan(61_000);
    });

    it('maps recording_url and parses created_date', async () => {
        const created = minutesAgo(15);
        mockFetchOnce([
            leadsEnvelope([
                lead({ id: '501', callStatus: 'Answered', createdAt: created, recordingUrl: 'https://storage01.ringopbx.com/r.wav' }),
            ]),
        ]);

        const res = await client.getAllCalls(1, minutesAgo(60).toISOString());

        expect(res.data).toHaveLength(1);
        expect(res.data[0].recording_url).toBe('https://storage01.ringopbx.com/r.wav');
        // created_date has minute precision; allow up to a minute of truncation
        const parsed = Date.parse(res.data[0].created_at);
        expect(Math.abs(parsed - created.getTime())).toBeLessThan(61_000);
    });
});
