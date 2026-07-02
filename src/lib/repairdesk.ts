import { logger } from '@/lib/logger';
import { validateRepairDeskUrl } from '@/lib/url-validator';

/**
 * RepairDesk API Client
 *
 * Docs: https://api-docs.repairdesk.co/
 * Auth: API key passed as query param `api_key`
 * Base URL: https://{subdomain}.repairdesk.co/api/web/v1
 *
 * Matches the architecture from ReviewGuard (controllers/repairDeskController.js).
 */

// --- Types ---

export interface RepairDeskCustomer {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    created_at: string;
    updated_at: string;
}

export interface RepairDeskTicket {
    id: number;
    ticket_id: string;
    customer_id: number;
    customer: RepairDeskCustomer;
    status: string;
    device: string;
    issue: string;
    notes: string;
    total: number;
    created_at: string;
    updated_at: string;
}

export interface RepairDeskListResponse<T> {
    data: T[];
    meta?: {
        current_page: number;
        last_page: number;
        per_page: number;
        total: number;
    };
}

export interface RepairDeskCallLog {
    id: number;
    customer_id: number;
    customer_name: string;
    phone: string;
    direction: 'inbound' | 'outbound';
    status: 'missed' | 'answered' | 'voicemail';
    duration: number;
    recording_url: string | null;
    notes: string;
    created_at: string;
    updated_at: string;
}

// --- Leads feed (/appointment) — the REAL RepairDesk call data ---
// RepairDesk has no /call-logs endpoint: it answers 200 with an embedded error
// object, so every call-log method silently returned nothing. The phone-call
// data actually lives in the leads feed, exposed under the singular
// `/appointment` endpoint as data.LeadsData (live-verified 2026-06-11 against
// a production store: 25/page, newest-first, pagination.next_page_exist).

export interface RepairDeskLeadCustomer {
    id: string;
    fullName: string;
    mobile: string;
    phone?: string;
    email?: string;
}

export interface RepairDeskLeadSummary {
    id: string;
    order_id: string;
    status: string;
    /** 'Answered' | 'Missed Call' | 'OutBound' */
    call_status: string;
    recording_url: string | null;
    /** "YYYY/MM/DD HH:mm", store-local time */
    created_date: string;
    customer: RepairDeskLeadCustomer | null;
}

export interface RepairDeskLead {
    summary: RepairDeskLeadSummary;
}

interface RepairDeskLeadsEnvelope {
    success?: boolean;
    message?: string;
    data?: {
        LeadsData?: RepairDeskLead[];
        pagination?: { page: number; next_page_exist: number; total_pages: number };
        // present instead of LeadsData when the API wraps an error in a 200
        message?: string;
    };
}

/** When a business has no poll watermark yet, only look this far back —
 *  the leads feed holds the store's full history (30k+ rows). */
const DEFAULT_LEADS_LOOKBACK_MS = 2 * 60 * 60 * 1000;

/** Newest-first feed + early stop means we rarely read past page 1-2;
 *  this cap is a backstop against clock skew or a bad `since`. */
const MAX_LEAD_PAGES = 40;

/** Offset (ms) of `timeZone` from UTC at the instant `utcMs`. */
function tzOffsetMs(timeZone: string, utcMs: number): number {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false,
        }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
    );
    const hour = parts.hour === '24' ? 0 : Number(parts.hour);
    const asUtc = Date.UTC(
        Number(parts.year), Number(parts.month) - 1, Number(parts.day),
        hour, Number(parts.minute), Number(parts.second),
    );
    return asUtc - utcMs;
}

/** "YYYY/MM/DD HH:mm" wall-clock time in `timeZone` → epoch ms.
 *  The feed reports store-local time with no offset; parsing it in server
 *  time is wrong in both directions (a UTC host reads an ET timestamp as 4-5h
 *  in the past, silently filtering every call out of the `since` window).
 *  Two-pass offset refinement handles DST transitions. */
function parseRdLeadDate(s: string | null | undefined, timeZone: string): number {
    const m = String(s || '').match(/(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
    if (!m) return 0;
    const wallUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    try {
        let guess = wallUtc - tzOffsetMs(timeZone, wallUtc);
        guess = wallUtc - tzOffsetMs(timeZone, guess);
        return guess;
    } catch {
        // Unknown/invalid IANA zone — fall back to server-local parsing
        return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
    }
}

/** Last 10 digits, for phone comparison across formatting variants. */
function phoneDigits(p: string | null | undefined): string {
    return String(p || '').replace(/\D/g, '').slice(-10);
}

function leadToCallLog(lead: RepairDeskLead, timeZone: string): RepairDeskCallLog | null {
    const s = lead?.summary;
    if (!s) return null;
    const createdAt = new Date(parseRdLeadDate(s.created_date, timeZone)).toISOString();
    return {
        id: parseInt(s.id, 10) || 0,
        customer_id: parseInt(s.customer?.id || '0', 10) || 0,
        customer_name: s.customer?.fullName || '',
        phone: s.customer?.mobile || s.customer?.phone || '',
        direction: s.call_status === 'OutBound' ? 'outbound' : 'inbound',
        status: s.call_status === 'Missed Call' ? 'missed' : 'answered',
        duration: 0, // not exposed by the leads feed
        recording_url: s.recording_url || null,
        notes: '',
        created_at: createdAt,
        updated_at: createdAt,
    };
}

/** All call-log results fit in one synthesized page (the adapter already
 *  paginated the upstream feed), so callers' page loops exit after page 1. */
function singlePage<T>(rows: T[], page: number): RepairDeskListResponse<T> {
    return {
        data: page === 1 ? rows : [],
        meta: { current_page: page, last_page: 1, per_page: rows.length || 1, total: rows.length },
    };
}

export interface RepairDeskError {
    message: string;
    status: number;
}

// Validate subdomain: only alphanumeric, hyphens, dots allowed
const SUBDOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$/;

// --- Client ---

export class RepairDeskClient {
    private apiKey: string;
    private baseUrl: string;
    /** IANA zone the store's wall-clock timestamps are written in. */
    private timezone: string;

    constructor(apiKey: string, subdomain?: string, timezone?: string) {
        this.apiKey = apiKey;
        this.timezone = timezone || 'America/New_York';

        // Default to "api" subdomain if none provided (same as ReviewGuard)
        const cleanSubdomain = (subdomain || 'api').trim();

        if (!SUBDOMAIN_RE.test(cleanSubdomain)) {
            throw new Error(
                `Invalid RepairDesk subdomain "${cleanSubdomain}". Use only letters, numbers, and hyphens.`
            );
        }

        const candidateUrl = `https://${cleanSubdomain}.repairdesk.co/api/web/v1`;

        // SSRF validation: ensure the constructed URL is safe for server-side fetching
        const urlValidation = validateRepairDeskUrl(candidateUrl);
        if (!urlValidation.valid) {
            throw new Error(`Invalid RepairDesk URL: ${urlValidation.error}`);
        }

        this.baseUrl = candidateUrl;
    }

    // NOTE: RepairDesk's API requires `api_key` as a query parameter — header-based
    // auth is not supported. The key is never included in log output (only `endpoint`
    // is logged). This is a third-party API constraint, not a design choice.
    private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
        const separator = endpoint.includes('?') ? '&' : '?';
        const url = `${this.baseUrl}${endpoint}${separator}api_key=${this.apiKey}`;

        logger.info('[RepairDesk] API request', { endpoint, method: options.method || 'GET' });

        // Bound every RepairDesk call. Without a timeout a hung upstream request
        // rides Vercel's function limit and can strand webhook_events in
        // 'processing' (which the reclaim path then treats as a duplicate and
        // silently drops). 15s is generous for RepairDesk's REST API.
        const response = await fetch(url, {
            ...options,
            signal: options.signal ?? AbortSignal.timeout(15_000),
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                ...options.headers,
            },
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            logger.error('[RepairDesk] API error', null, {
                status: response.status.toString(),
                endpoint,
                error: errorText,
            });
            throw new Error(`RepairDesk API error ${response.status}: ${errorText}`);
        }

        return response.json() as Promise<T>;
    }

    /**
     * Get all customers, optionally filtered by page
     */
    async getCustomers(page = 1): Promise<RepairDeskListResponse<RepairDeskCustomer>> {
        return this.request<RepairDeskListResponse<RepairDeskCustomer>>(
            `/customers?page=${page}`
        );
    }

    /**
     * Get a single customer by ID
     */
    async getCustomer(customerId: number): Promise<RepairDeskCustomer> {
        return this.request<RepairDeskCustomer>(`/customers/${customerId}`);
    }

    /**
     * Search customers by phone number or name
     */
    async searchCustomers(query: string): Promise<RepairDeskListResponse<RepairDeskCustomer>> {
        return this.request<RepairDeskListResponse<RepairDeskCustomer>>(
            `/customers?search=${encodeURIComponent(query)}`
        );
    }

    /**
     * Get all tickets, optionally filtered by page
     */
    async getTickets(page = 1): Promise<RepairDeskListResponse<RepairDeskTicket>> {
        return this.request<RepairDeskListResponse<RepairDeskTicket>>(
            `/tickets?page=${page}`
        );
    }

    /**
     * Get a single ticket by ID
     */
    async getTicket(ticketId: number): Promise<RepairDeskTicket> {
        return this.request<RepairDeskTicket>(`/tickets/${ticketId}`);
    }

    /**
     * Fetch one page of the leads feed (`/appointment`).
     * RepairDesk wraps errors in HTTP 200 responses, so a missing LeadsData
     * array is treated as an error (the embedded message is surfaced).
     */
    async getLeads(page = 1): Promise<{ leads: RepairDeskLead[]; nextPageExists: boolean }> {
        const body = await this.request<RepairDeskLeadsEnvelope>(`/appointment?page=${page}`);
        const leads = body?.data?.LeadsData;
        if (!Array.isArray(leads)) {
            const msg = body?.data?.message || body?.message || 'unexpected /appointment response shape';
            throw new Error(`RepairDesk /appointment error: ${msg}`);
        }
        return { leads, nextPageExists: Boolean(body?.data?.pagination?.next_page_exist) };
    }

    /**
     * All lead calls since `since` (ISO timestamp), mapped to RepairDeskCallLog.
     * Newest-first feed: stops paginating once a page is entirely older than
     * `since`. With no/invalid `since`, looks back DEFAULT_LEADS_LOOKBACK_MS
     * instead of scanning the store's entire lead history.
     */
    private async getLeadCallLogsSince(since?: string): Promise<RepairDeskCallLog[]> {
        const parsedSince = since ? Date.parse(since) : NaN;
        const sinceMs = Number.isFinite(parsedSince)
            ? parsedSince
            : Date.now() - DEFAULT_LEADS_LOOKBACK_MS;

        const out: RepairDeskCallLog[] = [];
        for (let page = 1; page <= MAX_LEAD_PAGES; page++) {
            const { leads, nextPageExists } = await this.getLeads(page);
            if (leads.length === 0) break;

            let oldestOnPage = Infinity;
            for (const lead of leads) {
                const log = leadToCallLog(lead, this.timezone);
                if (!log) continue;
                const createdMs = Date.parse(log.created_at);
                oldestOnPage = Math.min(oldestOnPage, createdMs);
                if (createdMs >= sinceMs) out.push(log);
            }

            if (oldestOnPage < sinceMs || !nextPageExists) break;
        }
        return out;
    }

    /**
     * Get call logs since a given timestamp.
     * Sourced from the leads feed — see getLeads().
     */
    async getCallLogs(page = 1, since?: string): Promise<RepairDeskListResponse<RepairDeskCallLog>> {
        return this.getAllCalls(page, since);
    }

    /**
     * Get missed inbound calls since a given timestamp.
     */
    async getMissedCalls(page = 1, since?: string): Promise<RepairDeskListResponse<RepairDeskCallLog>> {
        const logs = await this.getLeadCallLogsSince(since);
        return singlePage(logs.filter((l) => l.status === 'missed' && l.direction === 'inbound'), page);
    }

    /**
     * Check if there was an outbound call to a specific phone number since a given time.
     * Used to detect if the user returned a missed call.
     */
    async getOutboundCallsTo(phone: string, since?: string): Promise<RepairDeskListResponse<RepairDeskCallLog>> {
        const target = phoneDigits(phone);
        const logs = await this.getLeadCallLogsSince(since);
        return singlePage(
            logs.filter((l) => l.direction === 'outbound' && target && phoneDigits(l.phone) === target),
            1,
        );
    }

    /**
     * Get ALL calls (answered + missed + outbound) since a given timestamp.
     * Used by the AI auto-audit cron to review all calls.
     */
    async getAllCalls(page = 1, since?: string): Promise<RepairDeskListResponse<RepairDeskCallLog>> {
        return singlePage(await this.getLeadCallLogsSince(since), page);
    }

    /**
     * Test connection by fetching the first page of customers (limit=1).
     * Matches ReviewGuard pattern: GET /customers?limit=1
     */
    async testConnection(): Promise<{ success: boolean; error?: string; baseUrl?: string }> {
        try {
            await this.request<unknown>('/customers?limit=1');
            return { success: true };
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            return { success: false, error: message, baseUrl: this.baseUrl };
        }
    }

    // -------------------------------------------------------
    // Write methods (for bidirectional RepairDesk integration)
    // -------------------------------------------------------

    /**
     * Search tickets by customer phone number.
     */
    async searchTickets(phone: string): Promise<RepairDeskListResponse<RepairDeskTicket>> {
        return this.request<RepairDeskListResponse<RepairDeskTicket>>(
            `/tickets?search=${encodeURIComponent(phone)}`
        );
    }

    /**
     * Get full ticket details by ID.
     */
    async getTicketDetails(ticketId: number): Promise<RepairDeskTicket> {
        return this.request<RepairDeskTicket>(`/tickets/${ticketId}`);
    }

    /**
     * Add a note to an existing RepairDesk ticket.
     */
    async addTicketNote(ticketId: number, note: string): Promise<void> {
        await this.request<unknown>(`/tickets/${ticketId}/notes`, {
            method: 'POST',
            body: JSON.stringify({ note }),
        });
    }

    /**
     * Create a new customer in RepairDesk.
     */
    async createCustomer(data: {
        first_name: string;
        last_name: string;
        phone: string;
        email?: string;
    }): Promise<RepairDeskCustomer> {
        return this.request<RepairDeskCustomer>('/customers', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    /**
     * Update an existing customer in RepairDesk.
     */
    async updateCustomer(
        customerId: number,
        data: Partial<Pick<RepairDeskCustomer, 'first_name' | 'last_name' | 'phone' | 'email' | 'address' | 'city' | 'state' | 'zip'>>,
    ): Promise<RepairDeskCustomer> {
        return this.request<RepairDeskCustomer>(`/customers/${customerId}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }
}
