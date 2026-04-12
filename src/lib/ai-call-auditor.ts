import OpenAI from 'openai';
import { logger } from '@/lib/logger';
import { QUESTION_KEYS, QUESTION_LABELS, type QuestionKey } from '@/lib/audit-scoring';

const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

const TAG = '[AI Auditor]';

export interface AuditInput {
    transcript: string;
    callDuration?: number | null;
    callStatus: 'missed' | 'answered' | 'voicemail';
    customerName?: string | null;
    customerPhone?: string | null;
    direction: 'inbound' | 'outbound';
}

export interface AuditResult {
    // Quality scoring (the 9 questions)
    quality_scores: Record<QuestionKey, boolean>;
    total_score: number;
    max_possible_score: number;
    // Call categorization
    category: 'repair_quote' | 'status_check' | 'parts_inquiry' | 'follow_up' | 'spam' | 'wrong_number';
    urgency: 'high' | 'medium' | 'low';
    sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated';
    summary: string;
    // Action items
    action_items: ActionItem[];
    // Coaching
    coaching_note: string;
}

export interface ActionItem {
    title: string;
    description: string;
    action_type: 'callback' | 'follow_up' | 'repair_update' | 'quote_needed' | 'escalation' | 'info';
    priority: 'high' | 'medium' | 'low';
    assigned_role: 'owner' | 'tech' | 'front_desk';
}

const FALLBACK_RESULT: AuditResult = {
    quality_scores: Object.fromEntries(QUESTION_KEYS.map(k => [k, false])) as Record<QuestionKey, boolean>,
    total_score: 0,
    max_possible_score: 100,
    category: 'follow_up',
    urgency: 'medium',
    sentiment: 'neutral',
    summary: 'AI audit unavailable - manual review recommended',
    action_items: [{
        title: 'Review this call manually',
        description: 'AI audit was unavailable. Please review this call and determine next steps.',
        action_type: 'follow_up',
        priority: 'medium',
        assigned_role: 'owner',
    }],
    coaching_note: '',
};

const QUALITY_QUESTIONS_FOR_PROMPT = QUESTION_KEYS.map(
    (key) => `"${key}": ${QUESTION_LABELS[key]}`
).join('\n');

const AUTO_AUDIT_SYSTEM_PROMPT = `You are a phone call quality auditor for a phone repair business. You review call transcripts and produce two things:

1. **Quality Scoring**: Evaluate the employee's phone handling on these 9 criteria (true/false for each):
${QUALITY_QUESTIONS_FOR_PROMPT}

Rules for scoring:
- q_proper_greeting: Did the employee greet with the store name and their name?
- q_open_ended_questions: Did they ask discovery questions to understand the customer's need?
- q_location_info: Did they mention the store location, landmarks, or directions?
- q_closing_with_name: Did they close by giving their name or the store name?
- q_warranty_mention: Did they mention any warranty (lifetime, limited, etc.)?
- q_timely_answers: Were answers given promptly without long pauses or "let me check"?
- q_alert_demeanor: Was the employee attentive, patient, and professional?
- q_call_under_2_30: Was the call approximately 2 minutes 30 seconds or less? Use the duration metadata if available, otherwise estimate from the transcript length.
- q_effort_customer_in: Did the employee actively try to get the customer to visit the store?

2. **Action Items**: Based on the call, what needs to happen next? Generate 1-3 specific action items.

Action types:
- callback: Customer needs a return call
- follow_up: Need to check on something and get back to customer
- repair_update: Update customer on repair status
- quote_needed: Need to provide a price quote
- escalation: Issue needs manager/owner attention
- info: Informational, no action needed

Assigned roles: owner, tech, front_desk

Return JSON only:
{
  "quality_scores": { "q_proper_greeting": true/false, ... all 9 keys },
  "category": "repair_quote|status_check|parts_inquiry|follow_up|spam|wrong_number",
  "urgency": "high|medium|low",
  "sentiment": "positive|neutral|negative|frustrated",
  "summary": "One sentence summary of the call",
  "action_items": [
    {
      "title": "Short action title (max 80 chars)",
      "description": "What specifically needs to be done",
      "action_type": "callback|follow_up|repair_update|quote_needed|escalation|info",
      "priority": "high|medium|low",
      "assigned_role": "owner|tech|front_desk"
    }
  ],
  "coaching_note": "One actionable improvement tip for the employee"
}`;

/**
 * AI-powered call audit. Analyzes a transcript and produces:
 * - 9-point quality score
 * - Call categorization (category, urgency, sentiment)
 * - Action items for the team
 * - Coaching feedback
 *
 * Fails gracefully - always returns a usable result.
 */
export async function auditCall(input: AuditInput): Promise<AuditResult> {
    if (!openai) {
        logger.warn(`${TAG} OpenAI API key missing, returning fallback`);
        return { ...FALLBACK_RESULT };
    }

    if (!input.transcript || input.transcript.trim().length < 10) {
        logger.info(`${TAG} Transcript too short for audit`);
        return {
            ...FALLBACK_RESULT,
            summary: 'Transcript too short or empty for meaningful audit',
        };
    }

    try {
        const contextParts: string[] = [];
        contextParts.push(`Call direction: ${input.direction}`);
        contextParts.push(`Call status: ${input.callStatus}`);
        if (input.callDuration != null) contextParts.push(`Duration: ${input.callDuration}s`);
        if (input.customerName) contextParts.push(`Customer name: ${input.customerName}`);

        const response = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || 'gpt-4o',
            messages: [
                { role: 'system', content: AUTO_AUDIT_SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: `Call Metadata:\n${contextParts.join('\n')}\n\nTranscript:\n${input.transcript}`,
                },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.3,
        });

        const content = response.choices[0].message.content;
        if (!content) throw new Error('No content from OpenAI');

        const parsed = JSON.parse(content);
        return validateAuditResult(parsed);
    } catch (error) {
        logger.error(`${TAG} AI audit failed`, error);
        return { ...FALLBACK_RESULT };
    }
}

function validateAuditResult(raw: Record<string, unknown>): AuditResult {
    const validCategories = ['repair_quote', 'status_check', 'parts_inquiry', 'follow_up', 'spam', 'wrong_number'] as const;
    const validUrgency = ['high', 'medium', 'low'] as const;
    const validSentiment = ['positive', 'neutral', 'negative', 'frustrated'] as const;
    const validActionTypes = ['callback', 'follow_up', 'repair_update', 'quote_needed', 'escalation', 'info'] as const;
    const validRoles = ['owner', 'tech', 'front_desk'] as const;

    // Quality scores
    const rawScores = (raw.quality_scores || {}) as Record<string, unknown>;
    const quality_scores: Record<QuestionKey, boolean> = {} as Record<QuestionKey, boolean>;
    let totalScore = 0;

    const WEIGHTS: Record<QuestionKey, number> = {
        q_proper_greeting: 10, q_open_ended_questions: 15, q_location_info: 5,
        q_closing_with_name: 10, q_warranty_mention: 10, q_timely_answers: 10,
        q_alert_demeanor: 15, q_call_under_2_30: 10, q_effort_customer_in: 15,
    };

    for (const key of QUESTION_KEYS) {
        quality_scores[key] = rawScores[key] === true;
        if (quality_scores[key]) totalScore += WEIGHTS[key];
    }

    // Category/urgency/sentiment
    const category = validCategories.includes(raw.category as typeof validCategories[number])
        ? (raw.category as typeof validCategories[number]) : 'follow_up';
    const urgency = validUrgency.includes(raw.urgency as typeof validUrgency[number])
        ? (raw.urgency as typeof validUrgency[number]) : 'medium';
    const sentiment = validSentiment.includes(raw.sentiment as typeof validSentiment[number])
        ? (raw.sentiment as typeof validSentiment[number]) : 'neutral';

    // Summary
    const sanitize = (val: unknown, fallback: string): string => {
        if (typeof val !== 'string' || !val.trim()) return fallback;
        return val.replace(/https?:\/\/\S+/gi, '[link removed]').replace(/www\.\S+/gi, '[link removed]').trim();
    };
    const summary = sanitize(raw.summary, 'No summary available');

    // Action items
    const rawActions = Array.isArray(raw.action_items) ? raw.action_items : [];
    const action_items: ActionItem[] = rawActions.slice(0, 5).map((item: Record<string, unknown>) => ({
        title: sanitize(item.title, 'Follow up').substring(0, 200),
        description: sanitize(item.description, 'Review and take action').substring(0, 1000),
        action_type: validActionTypes.includes(item.action_type as typeof validActionTypes[number])
            ? (item.action_type as typeof validActionTypes[number]) : 'follow_up',
        priority: validUrgency.includes(item.priority as typeof validUrgency[number])
            ? (item.priority as typeof validUrgency[number]) : 'medium',
        assigned_role: validRoles.includes(item.assigned_role as typeof validRoles[number])
            ? (item.assigned_role as typeof validRoles[number]) : 'owner',
    }));

    if (action_items.length === 0) {
        action_items.push({
            title: 'Review call',
            description: 'AI could not determine specific actions. Please review manually.',
            action_type: 'follow_up',
            priority: 'medium',
            assigned_role: 'owner',
        });
    }

    return {
        quality_scores,
        total_score: totalScore,
        max_possible_score: 100,
        category,
        urgency,
        sentiment,
        summary,
        action_items,
        coaching_note: sanitize(raw.coaching_note, ''),
    };
}
