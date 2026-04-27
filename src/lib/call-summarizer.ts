import OpenAI from 'openai';
import { logger } from '@/lib/logger';

const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

const TAG = '[Call Summarizer]';

const SUMMARIZE_PROMPT = `You are an assistant for a phone repair shop. Given a call transcript (or notes), extract:

1. What the customer called about — be specific with device names and issues
2. What action is needed from the shop
3. A short RepairDesk note (1-2 sentences, written as if a tech is logging it)

Examples of good RepairDesk notes:
- "Customer called about iPhone 14 Pro Max screen replacement. Quoted $89. Needs follow-up to schedule drop-off."
- "Called to check status on laptop repair (ticket open). Parts not in yet — needs update when parts arrive."
- "Asking about iPad Air battery replacement pricing. Interested, said they'll come by this week."
- "Called asking if we fix Samsung Galaxy S24. Told them yes, quoted $79 for screen. Customer will visit tomorrow."

Return JSON only:
{
  "device": "Device name if mentioned (e.g. 'iPhone 14 Pro Max', 'MacBook Pro', 'Samsung Galaxy S24') or null",
  "issue": "What's wrong or what they need (e.g. 'screen replacement', 'battery', 'status check', 'repair quote') or null",
  "rd_note": "The RepairDesk note to add to the ticket (1-2 sentences, specific and actionable)",
  "needs_follow_up": true/false,
  "follow_up_reason": "Why follow-up is needed (e.g. 'Quote given, customer deciding', 'Parts need to be ordered', 'Promised callback with price') or null",
  "is_actionable": true/false (false for spam, wrong number, hang-ups)
}`;

export interface CallSummaryResult {
    device: string | null;
    issue: string | null;
    rd_note: string;
    needs_follow_up: boolean;
    follow_up_reason: string | null;
    is_actionable: boolean;
}

export async function summarizeCallForRepairDesk(
    transcript: string,
    context?: { customerName?: string; callDuration?: number; direction?: string },
): Promise<CallSummaryResult | null> {
    if (!openai) {
        logger.warn(`${TAG} OpenAI API key missing`);
        return null;
    }

    if (!transcript || transcript.trim().length < 5) {
        return null;
    }

    try {
        const contextParts: string[] = [];
        if (context?.customerName) contextParts.push(`Customer: ${context.customerName}`);
        if (context?.callDuration != null) contextParts.push(`Duration: ${context.callDuration}s`);
        if (context?.direction) contextParts.push(`Direction: ${context.direction}`);

        const userMessage = contextParts.length > 0
            ? `Context: ${contextParts.join(', ')}\n\nTranscript:\n${transcript}`
            : `Transcript:\n${transcript}`;

        const response = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || 'gpt-4o',
            messages: [
                { role: 'system', content: SUMMARIZE_PROMPT },
                { role: 'user', content: userMessage },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.3,
        });

        const content = response.choices[0].message.content;
        if (!content) return null;

        const parsed = JSON.parse(content);

        const sanitize = (val: unknown): string | null => {
            if (typeof val !== 'string' || !val.trim()) return null;
            return val.replace(/https?:\/\/\S+/gi, '').replace(/www\.\S+/gi, '').trim() || null;
        };

        return {
            device: sanitize(parsed.device),
            issue: sanitize(parsed.issue),
            rd_note: sanitize(parsed.rd_note) || 'Call reviewed — see transcript for details.',
            needs_follow_up: parsed.needs_follow_up === true,
            follow_up_reason: sanitize(parsed.follow_up_reason),
            is_actionable: parsed.is_actionable !== false,
        };
    } catch (error) {
        logger.error(`${TAG} Failed`, error);
        return null;
    }
}
