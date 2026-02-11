import { logger } from '@/lib/logger';

/**
 * RepairDesk API Client
 *
 * Docs: https://api-docs.repairdesk.co/
 * Auth: API key passed as query param `api_key`
 * Base URL: https://{store}.repairdesk.co/api/v1
 *
 * Update BASE_URL and endpoints once confirmed from your RepairDesk dashboard.
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

export interface RepairDeskError {
    message: string;
    status: number;
}

// --- Client ---

export class RepairDeskClient {
    private apiKey: string;
    private baseUrl: string;

    constructor(apiKey: string, storeUrl?: string) {
        this.apiKey = apiKey;
        // Default base URL pattern — update if RepairDesk uses a different structure
        this.baseUrl = storeUrl
            ? `${storeUrl.replace(/\/$/, '')}/api/v1`
            : 'https://api.repairdesk.co/api/v1';
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
     * Test connection by fetching the first page of customers
     */
    async testConnection(): Promise<boolean> {
        try {
            await this.getCustomers(1);
            return true;
        } catch {
            return false;
        }
    }
}
