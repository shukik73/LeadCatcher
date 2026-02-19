import { describe, it, expect } from 'vitest';
import { validateRepairDeskUrl } from './url-validator';

describe('validateRepairDeskUrl', () => {
    describe('valid URLs', () => {
        it('accepts standard RepairDesk URL', () => {
            const result = validateRepairDeskUrl('https://mystore.repairdesk.co');
            expect(result.valid).toBe(true);
            expect(result.url).toBeDefined();
        });

        it('accepts api.repairdesk.co', () => {
            const result = validateRepairDeskUrl('https://api.repairdesk.co');
            expect(result.valid).toBe(true);
        });

        it('accepts repairdesk.co root', () => {
            const result = validateRepairDeskUrl('https://repairdesk.co');
            expect(result.valid).toBe(true);
        });

        it('accepts URL with path', () => {
            const result = validateRepairDeskUrl('https://mystore.repairdesk.co/api/v1');
            expect(result.valid).toBe(true);
        });
    });

    describe('scheme validation', () => {
        it('rejects HTTP URLs', () => {
            const result = validateRepairDeskUrl('http://mystore.repairdesk.co');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('HTTPS');
        });

        it('rejects FTP URLs', () => {
            const result = validateRepairDeskUrl('ftp://mystore.repairdesk.co');
            expect(result.valid).toBe(false);
        });
    });

    describe('SSRF prevention', () => {
        it('rejects localhost', () => {
            const result = validateRepairDeskUrl('https://localhost');
            expect(result.valid).toBe(false);
        });

        it('rejects private IP 127.0.0.1', () => {
            const result = validateRepairDeskUrl('https://127.0.0.1');
            expect(result.valid).toBe(false);
        });

        it('rejects private IP 10.0.0.1', () => {
            const result = validateRepairDeskUrl('https://10.0.0.1');
            expect(result.valid).toBe(false);
        });

        it('rejects private IP 172.16.0.1', () => {
            const result = validateRepairDeskUrl('https://172.16.0.1');
            expect(result.valid).toBe(false);
        });

        it('rejects private IP 192.168.1.1', () => {
            const result = validateRepairDeskUrl('https://192.168.1.1');
            expect(result.valid).toBe(false);
        });

        it('rejects AWS metadata endpoint', () => {
            const result = validateRepairDeskUrl('https://169.254.169.254');
            expect(result.valid).toBe(false);
        });

        it('rejects GCP metadata endpoint', () => {
            const result = validateRepairDeskUrl('https://metadata.google.internal');
            expect(result.valid).toBe(false);
        });

        it('rejects public IPs (raw IP not a domain)', () => {
            const result = validateRepairDeskUrl('https://8.8.8.8');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('IP addresses');
        });
    });

    describe('port validation', () => {
        it('rejects non-standard ports', () => {
            const result = validateRepairDeskUrl('https://mystore.repairdesk.co:8080');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('port');
        });

        it('allows port 443 explicitly', () => {
            const result = validateRepairDeskUrl('https://mystore.repairdesk.co:443');
            expect(result.valid).toBe(true);
        });
    });

    describe('hostname allowlist', () => {
        it('rejects non-RepairDesk domains', () => {
            const result = validateRepairDeskUrl('https://evil.com');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('not a recognized RepairDesk domain');
        });

        it('rejects look-alike domains', () => {
            const result = validateRepairDeskUrl('https://repairdesk.co.evil.com');
            expect(result.valid).toBe(false);
        });

        it('rejects subdomains of similar domains', () => {
            const result = validateRepairDeskUrl('https://store.notrepairdesk.co');
            expect(result.valid).toBe(false);
        });
    });

    describe('edge cases', () => {
        it('rejects empty string', () => {
            const result = validateRepairDeskUrl('');
            expect(result.valid).toBe(false);
        });

        it('rejects invalid URL format', () => {
            const result = validateRepairDeskUrl('not-a-url');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Invalid URL');
        });

        it('rejects IPv6 addresses', () => {
            const result = validateRepairDeskUrl('https://[::1]');
            expect(result.valid).toBe(false);
        });

        it('rejects URLs with credentials', () => {
            // URL with username:password@host - the URL parser handles this
            const result = validateRepairDeskUrl('https://user:pass@evil.com');
            expect(result.valid).toBe(false);
        });

        it('handles URL-encoded hostnames', () => {
            // %2e = . encoded - URL parser normalizes this
            const result = validateRepairDeskUrl('https://evil%2ecom');
            expect(result.valid).toBe(false);
        });
    });
});
