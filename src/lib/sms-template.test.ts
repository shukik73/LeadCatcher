import { describe, it, expect } from 'vitest';
import { appendBookingLink, replaceBusinessName, replaceFirstName, stripUnknownTokens, renderMissedCallSms } from '@/lib/sms-template';

describe('appendBookingLink', () => {
    it('substitutes {{booking_link}} when URL is configured', () => {
        const out = appendBookingLink('Book here: {{booking_link}}', 'https://book.example.com');
        expect(out).toBe('Book here: https://book.example.com');
    });

    it('removes the {{booking_link}} placeholder when URL is missing', () => {
        const out = appendBookingLink('Book here: {{booking_link}}', null);
        expect(out).toBe('Book here:');
    });

    it('appends booking sentence when template has no placeholder and URL exists', () => {
        const out = appendBookingLink('Hi! We missed your call.', 'https://book.example.com');
        expect(out).toBe('Hi! We missed your call. You can also book here: https://book.example.com');
    });

    it('returns the body unchanged when no URL and no placeholder', () => {
        const out = appendBookingLink('Hi!', null);
        expect(out).toBe('Hi!');
    });

    it('treats whitespace-only URL as no URL', () => {
        const out = appendBookingLink('Hi!', '   ');
        expect(out).toBe('Hi!');
    });

    it('handles spaced placeholder syntax', () => {
        const out = appendBookingLink('Book: {{ booking_link }}', 'https://book.example.com');
        expect(out).toBe('Book: https://book.example.com');
    });
});

describe('replaceBusinessName', () => {
    it('replaces {{business_name}} with the business name', () => {
        expect(replaceBusinessName('Hi, this is {{business_name}}', 'Acme Repair')).toBe('Hi, this is Acme Repair');
    });

    it('falls back to a default when name missing', () => {
        expect(replaceBusinessName('Hi, this is {{business_name}}', null)).toBe('Hi, this is our business');
    });
});

describe('renderMissedCallSms', () => {
    it('substitutes business_name and booking_link together', () => {
        const out = renderMissedCallSms(
            'Hi, this is {{business_name}}. Book: {{booking_link}}',
            { name: 'Acme', booking_url: 'https://book.example.com' },
        );
        expect(out).toBe('Hi, this is Acme. Book: https://book.example.com');
    });

    it('appends booking sentence when template has no placeholder', () => {
        const out = renderMissedCallSms(
            'Hi, this is {{business_name}}. We missed your call.',
            { name: 'Acme', booking_url: 'https://book.example.com' },
        );
        expect(out).toBe('Hi, this is Acme. We missed your call. You can also book here: https://book.example.com');
    });

    it('does not append booking sentence when no URL is configured', () => {
        const out = renderMissedCallSms(
            'Hi, this is {{business_name}}.',
            { name: 'Acme', booking_url: null },
        );
        expect(out).toBe('Hi, this is Acme.');
    });

    // Regression for the shipped default template, which uses {{first_name}} —
    // previously never substituted and texted to customers as a literal token.
    it('resolves {{first_name}} to a friendly fallback when caller is unknown', () => {
        const out = renderMissedCallSms(
            'Hi {{first_name}}, thanks for calling {{business_name}}. Sorry we missed you.',
            { name: 'Acme', booking_url: null },
        );
        expect(out).toBe('Hi there, thanks for calling Acme. Sorry we missed you.');
    });

    it('uses the caller first name when provided', () => {
        const out = renderMissedCallSms(
            'Hi {{first_name}}, thanks for calling {{business_name}}.',
            { name: 'Acme', booking_url: null },
            'Maria',
        );
        expect(out).toBe('Hi Maria, thanks for calling Acme.');
    });

    it('never leaks an unsupported {{token}} to the customer', () => {
        const out = renderMissedCallSms(
            'Hi {{business_name}}, your code is {{secret_code}}.',
            { name: 'Acme', booking_url: null },
        );
        expect(out).toBe('Hi Acme, your code is.');
        expect(out).not.toContain('{{');
    });
});

describe('replaceFirstName', () => {
    it('falls back to "there" when name is missing', () => {
        expect(replaceFirstName('Hi {{first_name}}!', null)).toBe('Hi there!');
        expect(replaceFirstName('Hi {{first_name}}!', '  ')).toBe('Hi there!');
    });

    it('substitutes the provided name', () => {
        expect(replaceFirstName('Hi {{ first_name }}!', 'Sam')).toBe('Hi Sam!');
    });
});

describe('stripUnknownTokens', () => {
    it('removes leftover tokens and tidies punctuation/whitespace', () => {
        expect(stripUnknownTokens('Hi {{nope}}, welcome  back')).toBe('Hi, welcome back');
    });
});
