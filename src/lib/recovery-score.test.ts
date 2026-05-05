import { describe, it, expect } from 'vitest';
import { calculateRecoveryScore } from '@/lib/recovery-score';

describe('calculateRecoveryScore', () => {
    it('reports zero rate and revenue when there is no activity', () => {
        const out = calculateRecoveryScore({
            missedCalls: 0,
            smsSent: 0,
            customerReplies: 0,
            bookedLeads: 0,
            avgBookedValue: 0,
        });
        expect(out).toEqual({
            missed_calls: 0,
            sms_sent: 0,
            customer_replies: 0,
            booked_leads: 0,
            recovery_rate: 0,
            estimated_recovered_revenue: 0,
        });
    });

    it('computes recovery rate as bookedLeads / missedCalls', () => {
        const out = calculateRecoveryScore({
            missedCalls: 20,
            smsSent: 18,
            customerReplies: 12,
            bookedLeads: 5,
            avgBookedValue: 0,
        });
        expect(out.recovery_rate).toBe(25); // 5/20
    });

    it('computes estimated revenue as bookedLeads * avgBookedValue', () => {
        const out = calculateRecoveryScore({
            missedCalls: 10,
            smsSent: 9,
            customerReplies: 6,
            bookedLeads: 3,
            avgBookedValue: 150.5,
        });
        expect(out.estimated_recovered_revenue).toBeCloseTo(451.5, 2);
    });

    it('clamps negative inputs to zero', () => {
        const out = calculateRecoveryScore({
            missedCalls: -5,
            smsSent: -3,
            customerReplies: -1,
            bookedLeads: -2,
            avgBookedValue: -10,
        });
        expect(out.missed_calls).toBe(0);
        expect(out.estimated_recovered_revenue).toBe(0);
    });

    it('handles non-finite avgBookedValue without crashing', () => {
        const out = calculateRecoveryScore({
            missedCalls: 5,
            smsSent: 5,
            customerReplies: 3,
            bookedLeads: 2,
            avgBookedValue: NaN,
        });
        expect(out.estimated_recovered_revenue).toBe(0);
    });
});
