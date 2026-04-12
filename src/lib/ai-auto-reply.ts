import OpenAI from 'openai';
import { logger } from '@/lib/logger';

const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

const TAG = '[AI AutoReply]';

const AUTO_REPLY_SYSTEM_PROMPT = `You are a friendly, professional receptionist for a phone repair shop. A customer texted in response to a missed call SMS. Generate a helpful reply.

Rules:
- Keep replies under 160 characters when possible (SMS-friendly)
- Be warm, professional, and action-oriented
- If they mention a specific device + issue, acknowledge it and mention you can help
- If they ask about pricing, give a general range if possible or offer to look it up
- Always try to get them to visit the store or book an appointment
- Never make up specific prices — say "starting at" or "we can give you an exact quote"
- Never include URLs or links
- Use the business name if provided
- If the message is spam or irrelevant, reply politely that you can help with device repairs

Return JSON only:
{
  "reply": "The SMS reply text (under 160 chars preferred)",
  "should_reply": true/false (false for spam, STOP keywords, or gibberish),
  "confidence": "high" | "medium" | "low"
}`;

export interface AutoReplyResult {
    reply: string;
    should_reply: boolean;
    confidence: 'high' | 'medium' | 'low';
}

/**
 * Generate an AI-powered auto-reply to a customer SMS.
 * Returns null if AI is unavailable or confidence is too low.
 */
export async function generateAutoReply(
    customerMessage: string,
    businessName: string,
    context?: string,
): Promise<AutoReplyResult | null> {
    if (!openai) {
        logger.warn(`${TAG} OpenAI API key missing`);
        return null;
    }

    try {
        const contextParts = [
            `Business: ${businessName}`,
            `Customer message: "${customerMessage}"`,
            context ? `Additional context: ${context}` : null,
        ].filter(Boolean).join('\n');

        const response = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || 'gpt-4o',
            messages: [
                { role: 'system', content: AUTO_REPLY_SYSTEM_PROMPT },
                { role: 'user', content: contextParts },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.5,
        });

        const content = response.choices[0].message.content;
        if (!content) return null;

        const parsed = JSON.parse(content);

        const result: AutoReplyResult = {
            reply: typeof parsed.reply === 'string'
                ? parsed.reply.replace(/https?:\/\/\S+/gi, '').replace(/www\.\S+/gi, '').trim()
                : '',
            should_reply: parsed.should_reply === true,
            confidence: ['high', 'medium', 'low'].includes(parsed.confidence)
                ? parsed.confidence
                : 'low',
        };

        // Don't auto-reply if confidence is low or reply is empty
        if (!result.reply || result.confidence === 'low') {
            return null;
        }

        logger.info(`${TAG} Generated reply`, {
            confidence: result.confidence,
            should_reply: result.should_reply,
        });

        return result;
    } catch (error) {
        logger.error(`${TAG} Failed to generate reply`, error);
        return null;
    }
}
