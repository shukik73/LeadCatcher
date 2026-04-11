/**
 * Phone Call Audit Scoring
 *
 * Balanced 100-point scale with per-question weights.
 * Weights can be adjusted — historical scores are preserved
 * because total_score and max_possible_score are persisted at submission time.
 */

export const QUESTION_KEYS = [
    'q_proper_greeting',
    'q_open_ended_questions',
    'q_location_info',
    'q_closing_with_name',
    'q_warranty_mention',
    'q_timely_answers',
    'q_alert_demeanor',
    'q_call_under_2_30',
    'q_effort_customer_in',
] as const;

export type QuestionKey = typeof QUESTION_KEYS[number];

export const QUESTION_WEIGHTS: Record<QuestionKey, number> = {
    q_proper_greeting: 10,
    q_open_ended_questions: 15,
    q_location_info: 5,
    q_closing_with_name: 10,
    q_warranty_mention: 10,
    q_timely_answers: 10,
    q_alert_demeanor: 15,
    q_call_under_2_30: 10,
    q_effort_customer_in: 15,
};

export const QUESTION_LABELS: Record<QuestionKey, string> = {
    q_proper_greeting: 'Proper greeting used',
    q_open_ended_questions: 'Open-ended question asked',
    q_location_info: 'Location/landmarks provided',
    q_closing_with_name: 'Call closed with name',
    q_warranty_mention: 'Lifetime warranty mentioned',
    q_timely_answers: 'Timely answers provided',
    q_alert_demeanor: 'Alert/patient demeanor',
    q_call_under_2_30: 'Call under 2:30',
    q_effort_customer_in: 'Effort to get customer in door',
};

export const MAX_POSSIBLE_SCORE = Object.values(QUESTION_WEIGHTS).reduce((a, b) => a + b, 0);

export interface AuditScoreResult {
    total_score: number;
    max_possible_score: number;
    percentage: number;
}

export function calculateAuditScore(
    answers: Record<QuestionKey, boolean>,
): AuditScoreResult {
    let total = 0;
    for (const key of QUESTION_KEYS) {
        if (answers[key]) {
            total += QUESTION_WEIGHTS[key];
        }
    }
    return {
        total_score: total,
        max_possible_score: MAX_POSSIBLE_SCORE,
        percentage: MAX_POSSIBLE_SCORE > 0 ? Math.round((total / MAX_POSSIBLE_SCORE) * 100) : 0,
    };
}
