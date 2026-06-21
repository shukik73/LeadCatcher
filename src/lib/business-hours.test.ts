import { describe, it, expect } from 'vitest';
import { summarizeHours, to12Hour, type BusinessHours } from '@/lib/business-hours';

const HOURS: BusinessHours = {
    monday: { open: '10:00', close: '19:00', isOpen: true },
    tuesday: { open: '10:00', close: '19:00', isOpen: true },
    wednesday: { open: '10:00', close: '19:00', isOpen: true },
    thursday: { open: '10:00', close: '19:00', isOpen: true },
    friday: { open: '10:00', close: '19:00', isOpen: true },
    saturday: { open: '10:00', close: '19:00', isOpen: true },
    sunday: { open: '12:00', close: '18:00', isOpen: true },
};

describe('to12Hour', () => {
    it('formats on-the-hour and half-hour times', () => {
        expect(to12Hour('19:00')).toBe('7 PM');
        expect(to12Hour('12:00')).toBe('12 PM');
        expect(to12Hour('00:00')).toBe('12 AM');
        expect(to12Hour('09:30')).toBe('9:30 AM');
    });
});

describe('summarizeHours (America/New_York)', () => {
    const tz = 'America/New_York';

    it('reports open with a closing time during business hours', () => {
        // Mon 2026-06-22 14:00 ET (18:00 UTC)
        const out = summarizeHours(HOURS, tz, new Date('2026-06-22T18:00:00Z'));
        expect(out.isOpenNow).toBe(true);
        expect(out.todayLine).toBe('Open now until 7 PM');
    });

    it('reports opening time when before open the same day', () => {
        // Sun 2026-06-21 09:30 ET (13:30 UTC) — opens at noon
        const out = summarizeHours(HOURS, tz, new Date('2026-06-21T13:30:00Z'));
        expect(out.isOpenNow).toBe(false);
        expect(out.todayLine).toBe('Closed now — opens today at 12 PM');
    });

    it('points to the next open day after closing', () => {
        // Mon 2026-06-22 20:00 ET (00:00 UTC Tue) — after close, opens tomorrow
        const out = summarizeHours(HOURS, tz, new Date('2026-06-23T00:00:00Z'));
        expect(out.isOpenNow).toBe(false);
        expect(out.todayLine).toContain('opens tomorrow at 10 AM');
    });

    it('returns a neutral summary when hours are missing', () => {
        const out = summarizeHours(null, tz, new Date('2026-06-22T18:00:00Z'));
        expect(out.isOpenNow).toBe(false);
        expect(out.todayLine).toBe('');
    });
});
