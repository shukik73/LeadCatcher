import { describe, it, expect } from 'vitest';
import { normalizePhoneNumber, formatPhoneNumber, isValidPhoneNumber } from './phone-utils';

describe('Phone Utils', () => {
    describe('normalizePhoneNumber', () => {
        it('normalizes 10-digit US number', () => {
            expect(normalizePhoneNumber('3055550123')).toBe('+13055550123');
        });

        it('normalizes 11-digit US number starting with 1', () => {
            expect(normalizePhoneNumber('13055550123')).toBe('+13055550123');
        });

        it('normalizes formatted US number', () => {
            expect(normalizePhoneNumber('(305) 555-0123')).toBe('+13055550123');
        });

        it('handles number with dots', () => {
            expect(normalizePhoneNumber('305.555.0123')).toBe('+13055550123');
        });

        it('throws error for invalid length', () => {
            expect(() => normalizePhoneNumber('123')).toThrow();
        });
    });

    describe('formatPhoneNumber', () => {
        it('formats E.164 to US standard', () => {
            expect(formatPhoneNumber('+13055550123')).toBe('(305) 555-0123');
        });

        it('returns original if not matching US format', () => {
            expect(formatPhoneNumber('12345')).toBe('12345');
        });
    });

    describe('isValidPhoneNumber', () => {
        it('returns true for valid US number', () => {
            expect(isValidPhoneNumber('3055550123')).toBe(true);
        });

        it('returns false for invalid number', () => {
            expect(isValidPhoneNumber('123')).toBe(false);
        });
    });
});
