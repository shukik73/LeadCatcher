import OpenAI from 'openai';
import { logger } from '@/lib/logger';
import type { QualificationData, Urgency } from '@/lib/lead-qualification';

/**
 * Answer-first AI receptionist for inbound SMS leads.
 *
 * Replaces the old device -> issue -> urgency interrogation. ONE model call:
 *   1. ANSWERS what the customer actually asked, using real shop facts
 *      (services, address, hours, free-check policy).
 *   2. Drives the visit / appointment. Never quotes a price.
 *   3. Extracts device / issue / urgency for the owner summary on the side.
 *
 * Falls back to a safe, helpful static reply when OpenAI is unavailable —
 * never an interrogation.
 */

const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30_000, maxRetries: 1 })
    : null;

const TAG = '[AI Receptionist]';

export interface ReceptionistContext {
    businessName: string;
    address?: string | null;
    services?: string | null;
    /** Natural one-liner, e.g. "Open now until 7 PM" (from summarizeHours). */
    hoursLine?: string | null;
    isOpenNow?: boolean;
    /** When true, the bot leads with the free in-store check. */
    freeCheck?: boolean;
}

export interface ReceptionistResult {
    reply: string;
    should_reply: boolean;
    qualified: boolean;
    extracted: QualificationData;
    confidence: 'high' | 'medium' | 'low';
}

const SYSTEM_PROMPT = `You are the receptionist for a local electronics repair shop, replying to a customer's SMS. You are warm, concise, and genuinely helpful — like a trusted local expert, not a script.

YOUR #1 JOB: ANSWER what the customer actually asked. Read their message and respond to it directly. Do NOT ignore their questions to collect form fields. Do NOT ask about something they already told you.

You are given the shop's real facts (name, address, services, hours, policy) and what we already know about this lead. Use them:
- "Do you fix X / are you near Y / what are your hours?" -> answer it using the facts. If the device/repair is in our services, confirm we do it. If you're unsure it's in scope, say we'd be happy to take a look.
- Location questions: give the address and warmly invite them in. Don't invent distances.
- PRICE questions: NEVER quote a number or range. Explain pricing depends on the exact model and damage, so the first in-store check is FREE and we give an exact quote on the spot, no pressure.
- Always nudge toward visiting or booking. Mention hours if relevant.

If their message has no detail yet (e.g. "I have a question"), warmly invite them and ask ONE friendly question about what they need — never a rigid checklist.

STYLE:
- Under 320 characters. Shorter is better. Plain, friendly SMS tone.
- Use the shop name naturally. No URLs or links. No emojis unless they used one.
- Don't over-promise repair times or prices.

Also quietly extract, from the whole conversation so far, what device + issue they have and how urgent it is — for the owner. Asking is NOT required; infer from what they wrote.

Set should_reply=false ONLY for spam, opt-out/STOP, or pure gibberish.
Set qualified=true once we know device AND issue (urgency/timing optional) OR there's clearly enough for the owner to act.

Return JSON only:
{
  "reply": "the SMS reply",
  "should_reply": true|false,
  "qualified": true|false,
  "device": null|string,
  "issue": null|string,
  "urgency": "high"|"medium"|"low"|null,
  "desired_time": null|string,
  "confidence": "high"|"medium"|"low"
}`;

function buildContextBlock(ctx: ReceptionistContext, existing: QualificationData): string {
    const facts: string[] = [`Shop name: ${ctx.businessName}`];
    if (ctx.address) facts.push(`Address: ${ctx.address}`);
    if (ctx.services) facts.push(`Services we offer: ${ctx.services}`);
    if (ctx.hoursLine) facts.push(`Hours right now: ${ctx.hoursLine}`);
    if (typeof ctx.isOpenNow === 'boolean') facts.push(`Open right now: ${ctx.isOpenNow ? 'yes' : 'no'}`);
    if (ctx.freeCheck) facts.push('Policy: first in-store check/diagnostic is FREE; exact quote given in person. Never quote prices over text.');
    const known: string[] = [];
    if (existing.device) known.push(`device=${existing.device}`);
    if (existing.issue) known.push(`issue=${existing.issue}`);
    if (existing.urgency) known.push(`urgency=${existing.urgency}`);
    if (existing.desired_time) known.push(`desired_time=${existing.desired_time}`);
    facts.push(`Already known about this lead: ${known.length ? known.join(', ') : 'nothing yet'}`);
    return facts.join('\n');
}

function stripUrls(text: string): string {
    return text.replace(/https?:\/\/\S+/gi, '').replace(/www\.\S+/gi, '').trim();
}

function normalizeUrgency(u: unknown): Urgency {
    return u === 'high' || u === 'medium' || u === 'low' ? u : null;
}

/**
 * Generate the receptionist reply + extracted lead data. Returns a static
 * helpful fallback (never null) so a customer is never left hanging, except
 * when the AI explicitly decides no reply is warranted (spam/STOP).
 */
export async function generateReceptionistReply(opts: {
    customerMessage: string;
    existing: QualificationData;
    context: ReceptionistContext;
}): Promise<ReceptionistResult> {
    const { customerMessage, existing, context } = opts;

    if (!openai) {
        logger.warn(`${TAG} OpenAI key missing — using static fallback`);
        return staticFallback(customerMessage, existing, context);
    }

    try {
        const response = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || 'gpt-4o',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: `${buildContextBlock(context, existing)}\n\nCustomer's latest message: "${customerMessage}"`,
                },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.5,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) return staticFallback(customerMessage, existing, context);

        const parsed = JSON.parse(content);
        const reply = typeof parsed.reply === 'string' ? stripUrls(parsed.reply) : '';

        // Strip URLs from extracted fields too, not just the customer-facing reply.
        // These fields flow into the owner-alert SMS (buildOwnerSummary), so a caller
        // can't inject a phishing link via the "device"/"issue" text they dictate.
        const stripField = (v: unknown): string | null =>
            typeof v === 'string' ? stripUrls(v) || null : null;

        const extracted: QualificationData = {
            device: stripField(parsed.device) ?? existing.device ?? null,
            issue: stripField(parsed.issue) ?? existing.issue ?? null,
            urgency: normalizeUrgency(parsed.urgency) ?? existing.urgency ?? null,
            desired_time: stripField(parsed.desired_time) ?? existing.desired_time ?? null,
        };

        const result: ReceptionistResult = {
            reply,
            should_reply: parsed.should_reply !== false && reply.length > 0,
            qualified: parsed.qualified === true,
            extracted,
            confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'medium',
        };

        logger.info(`${TAG} Generated reply`, {
            should_reply: result.should_reply,
            qualified: result.qualified,
            confidence: result.confidence,
        });
        return result;
    } catch (error) {
        logger.error(`${TAG} Generation failed — static fallback`, error);
        return staticFallback(customerMessage, existing, context);
    }
}

/** Heuristic device/issue/urgency extraction for the no-AI fallback path. */
function heuristicExtract(message: string, existing: QualificationData): QualificationData {
    const text = message.toLowerCase();
    const merged: QualificationData = { ...existing };
    if (!merged.device) {
        const m = text.match(/iphone|samsung|galaxy|pixel|ipad|tablet|laptop|macbook|imac|computer|pc|playstation|ps5|ps4|xbox|nintendo|switch|tv|console|phone/);
        if (m) merged.device = m[0];
    }
    if (!merged.issue) {
        const m = text.match(/screen|battery|charging|charge|water|crack|broken|hdmi|port|won'?t turn on|power|virus|slow|overheat/);
        if (m) merged.issue = m[0];
    }
    if (!merged.urgency) {
        if (/asap|today|now|urgent|emergency/.test(text)) merged.urgency = 'high';
        else if (/tomorrow|this week|soon/.test(text)) merged.urgency = 'medium';
        else if (/whenever|next week|no rush|low/.test(text)) merged.urgency = 'low';
    }
    return merged;
}

function staticFallback(
    message: string,
    existing: QualificationData,
    ctx: ReceptionistContext,
): ReceptionistResult {
    const extracted = heuristicExtract(message, existing);
    const bits: string[] = [`Thanks for reaching out to ${ctx.businessName}! We'd love to help.`];
    if (ctx.address) bits.push(`Swing by ${ctx.address}`);
    if (ctx.hoursLine) bits.push(`(${ctx.hoursLine.toLowerCase()})`);
    if (ctx.freeCheck) bits.push('— the first check is free and we\'ll give you an exact quote in person.');
    else bits.push('and we\'ll take a look.');
    bits.push('What can we help you with?');
    const reply = stripUrls(bits.join(' ').replace(/\s+/g, ' ').trim());
    return {
        reply,
        should_reply: true,
        qualified: !!(extracted.device && extracted.issue),
        extracted,
        confidence: 'low',
    };
}
