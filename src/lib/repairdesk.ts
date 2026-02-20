import { logger } from '@/lib/logger';

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
    notes: string;
    created_at: string;
    updated_at: string;
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

    constructor(apiKey: string, subdomain?: string) {
        this.apiKey = apiKey;

        // Default to "api" subdomain if none provided (same as ReviewGuard)
        const cleanSubdomain = (subdomain || 'api').trim();

        if (!SUBDOMAIN_RE.test(cleanSubdomain)) {
            throw new Error(
                `Invalid RepairDesk subdomain "${cleanSubdomain}". Use only letters, numbers, and hyphens.`
            );
        }

        this.baseUrl = `https://${cleanSubdomain}.repairdesk.co/api/web/v1`;
    }

    private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
        const separator = endpoint.includes('?') ? '&' : '?';
        const url = `${this.baseUrl}${endpoint}${separator}api_key=${this.apiKey}`;

        logger.info('[RepairDesk] API request', { endpoint, method: options.method || 'GET' });

        const response = await fetch(url, {
            ...options,
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
     * Get call logs, optionally filtered by page and date range.
     */
    async getCallLogs(page = 1, since?: string): Promise<RepairDeskListResponse<RepairDeskCallLog>> {
        let endpoint = `/call-logs?page=${page}`;
        if (since) {
            endpoint += `&since=${encodeURIComponent(since)}`;
        }
        return this.request<RepairDeskListResponse<RepairDeskCallLog>>(endpoint);
    }

    /**
     * Get missed calls since a given timestamp.
     * Filters call logs for inbound calls with status 'missed'.
     */
    async getMissedCalls(page = 1, since?: string): Promise<RepairDeskListResponse<RepairDeskCallLog>> {
        let endpoint = `/call-logs?page=${page}&status=missed&direction=inbound`;
        if (since) {
            endpoint += `&since=${encodeURIComponent(since)}`;
        }
        return this.request<RepairDeskListResponse<RepairDeskCallLog>>(endpoint);
    }

    /**
     * Check if there was an outbound call to a specific phone number since a given time.
     * Used to detect if the user returned a missed call.
     */
    async getOutboundCallsTo(phone: string, since?: string): Promise<RepairDeskListResponse<RepairDeskCallLog>> {
        let endpoint = `/call-logs?direction=outbound&phone=${encodeURIComponent(phone)}`;
        if (since) {
            endpoint += `&since=${encodeURIComponent(since)}`;
        }
        return this.request<RepairDeskListResponse<RepairDeskCallLog>>(endpoint);
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
}
