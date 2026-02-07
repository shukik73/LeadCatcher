import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isBusinessHours, formatTemplate, type BusinessHours } from './business-logic';

describe('business-logic', () => {
    describe('isBusinessHours', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('returns true when hours is null (default always open)', () => {
            expect(isBusinessHours(null, 'America/New_York')).toBe(true);
        });

        it('returns false when business is closed on that day', () => {
            // Set to a known Monday at 10:00 AM UTC
            vi.setSystemTime(new Date('2025-01-06T15:00:00Z')); // Monday 10:00 AM ET

            const hours: BusinessHours = {
                monday: { open: '09:00', close: '17:00', isOpen: false },
            };

            expect(isBusinessHours(hours, 'America/New_York')).toBe(false);
        });

        it('returns true when current time is within business hours', () => {
            // Monday 10:00 AM ET = 15:00 UTC
            vi.setSystemTime(new Date('2025-01-06T15:00:00Z'));

            const hours: BusinessHours = {
                monday: { open: '09:00', close: '17:00', isOpen: true },
            };

            expect(isBusinessHours(hours, 'America/New_York')).toBe(true);
        });

        it('returns false when current time is outside business hours (before open)', () => {
            // Monday 07:00 AM ET = 12:00 UTC
            vi.setSystemTime(new Date('2025-01-06T12:00:00Z'));

            const hours: BusinessHours = {
                monday: { open: '09:00', close: '17:00', isOpen: true },
            };

            expect(isBusinessHours(hours, 'America/New_York')).toBe(false);
        });

        it('returns false when current time is outside business hours (after close)', () => {
            // Monday 18:00 ET = 23:00 UTC
            vi.setSystemTime(new Date('2025-01-06T23:00:00Z'));

            const hours: BusinessHours = {
                monday: { open: '09:00', close: '17:00', isOpen: true },
            };

            expect(isBusinessHours(hours, 'America/New_York')).toBe(false);
        });

        it('returns false when day has no hours configured', () => {
            // Monday
            vi.setSystemTime(new Date('2025-01-06T15:00:00Z'));

            const hours: BusinessHours = {
                tuesday: { open: '09:00', close: '17:00', isOpen: true },
            };

            // Monday not in hours object
            expect(isBusinessHours(hours, 'America/New_York')).toBe(false);
        });

        it('handles different timezones correctly', () => {
            // 2025-01-06 at 22:00 UTC
            // In LA (PST, UTC-8): Monday 14:00
            // In NY (EST, UTC-5): Monday 17:00
            vi.setSystemTime(new Date('2025-01-06T22:00:00Z'));

            const hours: BusinessHours = {
                monday: { open: '09:00', close: '15:00', isOpen: true },
            };

            // LA: 14:00, within 09:00-15:00 -> true
            expect(isBusinessHours(hours, 'America/Los_Angeles')).toBe(true);

            // NY: 17:00, at boundary of 09:00-15:00 -> false (17:00 > 15:00)
            expect(isBusinessHours(hours, 'America/New_York')).toBe(false);
        });

        it('returns true on invalid timezone (fail open)', () => {
            vi.setSystemTime(new Date('2025-01-06T15:00:00Z'));

            const hours: BusinessHours = {
                monday: { open: '09:00', close: '17:00', isOpen: true },
            };

            expect(isBusinessHours(hours, 'Invalid/Timezone')).toBe(true);
        });

        it('returns true at the exact open time (boundary)', () => {
            // Monday 09:00 ET = 14:00 UTC
            vi.setSystemTime(new Date('2025-01-06T14:00:00Z'));

            const hours: BusinessHours = {
                monday: { open: '09:00', close: '17:00', isOpen: true },
            };

            expect(isBusinessHours(hours, 'America/New_York')).toBe(true);
        });

        it('returns true at the exact close time (boundary)', () => {
            // Monday 17:00 ET = 22:00 UTC
            vi.setSystemTime(new Date('2025-01-06T22:00:00Z'));

            const hours: BusinessHours = {
                monday: { open: '09:00', close: '17:00', isOpen: true },
            };

            expect(isBusinessHours(hours, 'America/New_York')).toBe(true);
        });
    });

    describe('formatTemplate', () => {
        it('returns default template when template is null', () => {
            const result = formatTemplate(null, { business_name: 'Acme Corp' });
            expect(result).toBe('Sorry we missed your call from Acme Corp. How can we help you?');
        });

        it('replaces template variables with values', () => {
            const template = 'Hi from {{business_name}}, call us at {{phone}}!';
            const result = formatTemplate(template, {
                business_name: 'Acme Corp',
                phone: '555-1234',
            });
            expect(result).toBe('Hi from Acme Corp, call us at 555-1234!');
        });

        it('replaces missing variables with empty string', () => {
            const template = 'Hi {{name}}, welcome to {{business_name}}!';
            const result = formatTemplate(template, { business_name: 'Acme Corp' });
            expect(result).toBe('Hi , welcome to Acme Corp!');
        });

        it('handles template with no variables', () => {
            const template = 'Thanks for calling!';
            const result = formatTemplate(template, {});
            expect(result).toBe('Thanks for calling!');
        });

        it('handles multiple occurrences of same variable', () => {
            const template = '{{name}} called {{name}}';
            const result = formatTemplate(template, { name: 'John' });
            expect(result).toBe('John called John');
        });

        it('handles empty string template (treated as falsy, returns default)', () => {
            const result = formatTemplate('', { business_name: 'Acme' });
            expect(result).toBe('Sorry we missed your call from Acme. How can we help you?');
        });
    });
});
