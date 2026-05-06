/**
 * Missed-Call Recovery Score: how much of the missed-call funnel got recovered
 * (SMS sent, customer replied, lead booked) and how much revenue was rescued.
 *
 * Calculation lives in pure TS so it's easy to unit test and reuse from
 * dashboards or daily-digest emails.
 */

export interface RecoveryScoreInputs {
    /** Total missed calls in the period. */
    missedCalls: number;
    /** Outbound SMS sent in response to a missed call. */
    smsSent: number;
    /** Inbound customer replies to those SMS. */
    customerReplies: number;
    /** Leads marked Booked or Closed in the period. */
    bookedLeads: number;
    /** Average revenue per booked lead. Falls back to 0 when unknown. */
    avgBookedValue: number;
}

export interface RecoveryScoreResult {
    missed_calls: number;
    sms_sent: number;
    customer_replies: number;
    booked_leads: number;
    /** Booked / missed_calls (0..100). */
    recovery_rate: number;
    /** Estimated recovered revenue = booked_leads * avgBookedValue. */
    estimated_recovered_revenue: number;
}

/**
 * Compute the recovery score from already-aggregated counters.
 * No DB access here so the function is trivial to unit test.
 */
export function calculateRecoveryScore(input: RecoveryScoreInputs): RecoveryScoreResult {
    const missed = Math.max(0, input.missedCalls | 0);
    const sms = Math.max(0, input.smsSent | 0);
    const replies = Math.max(0, input.customerReplies | 0);
    const booked = Math.max(0, input.bookedLeads | 0);
    const avgValue = Number.isFinite(input.avgBookedValue) ? Math.max(0, input.avgBookedValue) : 0;

    const recoveryRate = missed > 0
        ? Math.round((booked / missed) * 100)
        : 0;

    const estimatedRevenue = Math.round(booked * avgValue * 100) / 100;

    return {
        missed_calls: missed,
        sms_sent: sms,
        customer_replies: replies,
        booked_leads: booked,
        recovery_rate: recoveryRate,
        estimated_recovered_revenue: estimatedRevenue,
    };
}
