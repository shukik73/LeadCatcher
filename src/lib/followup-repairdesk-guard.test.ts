import { describe, it, expect } from 'vitest';
import { cameInSince } from './followup-repairdesk-guard';

describe('cameInSince (RepairDesk auto-send guard)', () => {
    const callTime = '2026-06-27T10:00:00Z';

    it('true when a ticket was created after the call (customer came in)', () => {
        expect(cameInSince([{ created_at: '2026-06-27T12:30:00Z' }], callTime)).toBe(true);
    });

    it('true when a ticket lands exactly at the call time', () => {
        expect(cameInSince([{ created_at: callTime }], callTime)).toBe(true);
    });

    it('false when the only ticket predates the call (unrelated/old visit)', () => {
        expect(cameInSince([{ created_at: '2026-06-20T09:00:00Z' }], callTime)).toBe(false);
    });

    it('false with no tickets at all', () => {
        expect(cameInSince([], callTime)).toBe(false);
    });

    it('ignores tickets with missing or unparseable dates', () => {
        expect(cameInSince([{ created_at: null }, { created_at: 'not-a-date' }], callTime)).toBe(false);
    });

    it('returns false safely when the call time itself is garbage', () => {
        expect(cameInSince([{ created_at: '2026-06-27T12:00:00Z' }], 'nonsense')).toBe(false);
    });
});
