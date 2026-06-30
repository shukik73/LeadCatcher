import { describe, it, expect } from 'vitest';
import { isCarrierAutoReply } from '@/lib/auto-reply-bounce';

describe('isCarrierAutoReply', () => {
    it('detects the "not monitored, please try calling" carrier bounce', () => {
        expect(
            isCarrierAutoReply('Undelivered: SMS to this number is not monitored. Please try calling.'),
        ).toBe(true);
    });

    it('detects a bare "this number is not monitored" auto-reply', () => {
        expect(isCarrierAutoReply('This number is not monitored.')).toBe(true);
    });

    it('detects an "unable to receive text messages" auto-reply', () => {
        expect(isCarrierAutoReply('This phone is unable to receive text messages.')).toBe(true);
    });

    it('detects a "does not accept text messages" auto-reply', () => {
        expect(isCarrierAutoReply('Sorry, this line does not accept text messages.')).toBe(true);
    });

    it('detects a generic "message could not be delivered" bounce', () => {
        expect(isCarrierAutoReply('Your message could not be delivered.')).toBe(true);
    });

    it('treats a real customer reply as NOT a bounce', () => {
        expect(isCarrierAutoReply('Yes please call me back, my screen is cracked')).toBe(false);
    });

    it('does not over-match a customer who simply mentions calling', () => {
        expect(isCarrierAutoReply('Can you call me at 5pm?')).toBe(false);
    });

    it('returns false for empty or whitespace input', () => {
        expect(isCarrierAutoReply('')).toBe(false);
        expect(isCarrierAutoReply('   ')).toBe(false);
    });
});
