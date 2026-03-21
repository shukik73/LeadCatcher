import OpenAI from 'openai';
import { logger } from '@/lib/logger';
import { CALL_SCORING_SYSTEM_PROMPT } from '@/lib/prompts';

// Lazy-init: reuse the same pattern as ai-service.ts
const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

export interface CallScoringInput {
    transcript?: string | null;
    summary?: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
    callStatus: 'missed' | 'answered' | 'outbound';
    callDuration?: number | null;
    previousCallCount?: number;
}

export interface CallScoringResult {
    category: 'repair_quote' | 'status_check' | 'parts_inquiry' | 'follow_up' | 'spam' | 'wrong_number';
    urgency: 'high' | 'medium' | 'low';
    sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated';
    summary: string;
    follow_up_needed: boolean;
    follow_up_notes: string;
    coaching_note: string;
    due_by: string; // ISO timestamptz
}

const FALLBACK_RESULT: CallScoringResult = {
    category: 'follow_up',
    urgency: 'medium',
    sentiment: 'neutral',
    summary: 'AI scoring unavailable — manual review recommended',
    follow_up_needed: true,
    follow_up_notes: 'Call the customer back to follow up on their missed call.',
    coaching_note: 'AI scoring was unavailable. Review this call manually.',
    due_by: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours
};

/**
 * Scores a call using AI analysis.
 * Returns structured scoring for category, urgency, follow-up guidance, and coaching.
 * Fails gracefully — always returns a usable result.
 */
export async function scoreCall(input: CallScoringInput): Promise<CallScoringResult> {
    if (!openai) {
        logger.warn('OpenAI API key missing — returning fallback call score');
        return { ...FALLBACK_RESULT };
    }

    // Build context string for the AI — no raw PII in the prompt itself
    const contextParts: string[] = [];
    if (input.callStatus) contextParts.push(`Call status: ${input.callStatus}`);
    if (input.callDuration != null) contextParts.push(`Duration: ${input.callDuration}s`);
    if (input.previousCallCount && input.previousCallCount > 0) {
        contextParts.push(`Previous calls from this number: ${input.previousCallCount}`);
    }
    if (input.customerName) contextParts.push(`Customer name: ${input.customerName}`);

    const textToAnalyze = input.transcript
        || input.summary
        || `Missed call from customer. Call status: ${input.callStatus}. No transcript available.`;

    try {
        const response = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || 'gpt-4o',
            messages: [
                { role: 'system', content: CALL_SCORING_SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: `Call Context:\n${contextParts.join('\n')}\n\nTranscript/Summary:\n${textToAnalyze}`
                }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.3, // Lower temp for more consistent scoring
        });

        const content = response.choices[0].message.content;
        if (!content) throw new Error('No content from OpenAI');

        const parsed = JSON.parse(content);

        // Validate and sanitize the AI output
        const result = validateScoringResult(parsed);

        logger.info('Call scored successfully', {
            category: result.category,
            urgency: result.urgency,
            follow_up_needed: result.follow_up_needed,
        });

        return result;
    } catch (error) {
        logger.error('Error scoring call with OpenAI', error);
        return { ...FALLBACK_RESULT };
    }
}

/**
 * Validates and normalizes AI output into a safe CallScoringResult.
 * Prevents bad AI output from breaking downstream logic.
 */
function validateScoringResult(raw: Record<string, unknown>): CallScoringResult {
    const validCategories = ['repair_quote', 'status_check', 'parts_inquiry', 'follow_up', 'spam', 'wrong_number'] as const;
    const validUrgency = ['high', 'medium', 'low'] as const;
    const validSentiment = ['positive', 'neutral', 'negative', 'frustrated'] as const;

    const category = validCategories.includes(raw.category as typeof validCategories[number])
        ? (raw.category as typeof validCategories[number])
        : 'follow_up';

    const urgency = validUrgency.includes(raw.urgency as typeof validUrgency[number])
        ? (raw.urgency as typeof validUrgency[number])
        : 'medium';

    const sentiment = validSentiment.includes(raw.sentiment as typeof validSentiment[number])
        ? (raw.sentiment as typeof validSentiment[number])
        : 'neutral';

    // Calculate due_by from due_by_hours
    const dueByHours = typeof raw.due_by_hours === 'number' && raw.due_by_hours > 0
        ? raw.due_by_hours
        : urgency === 'high' ? 0.25 : urgency === 'medium' ? 2 : 24;

    const dueBy = new Date(Date.now() + dueByHours * 60 * 60 * 1000).toISOString();

    // Sanitize text fields — strip URLs to prevent injection
    const sanitize = (val: unknown, fallback: string): string => {
        if (typeof val !== 'string' || !val.trim()) return fallback;
        return val
            .replace(/https?:\/\/\S+/gi, '[link removed]')
            .replace(/www\.\S+/gi, '[link removed]')
            .trim();
    };

    return {
        category,
        urgency,
        sentiment,
        summary: sanitize(raw.summary, 'No summary available'),
        follow_up_needed: typeof raw.follow_up_needed === 'boolean' ? raw.follow_up_needed : true,
        follow_up_notes: sanitize(raw.follow_up_notes, 'Follow up with the customer about their call.'),
        coaching_note: sanitize(raw.coaching_note, ''),
        due_by: dueBy,
    };
}
