import OpenAI from 'openai';
import { logger } from '@/lib/logger';

/**
 * Lightweight AI-driven lead qualification for inbound replies after a missed
 * call. The bot asks at most 2-3 short questions (device, issue, urgency or
 * desired time) and then fires a structured summary to the owner.
 *
 * Constrained on purpose — we are not building a free-form chatbot. The state
 * machine lives in the `qualification_step` integer column on `leads`.
 */

const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

const TAG = '[Lead Qualification]';

export type QualificationStatus = 'none' | 'in_progress' | 'qualified';

export type Urgency = 'high' | 'medium' | 'low' | null;

export interface QualificationData {
    device?: string | null;
    issue?: string | null;
    urgency?: Urgency;
    desired_time?: string | null;
}

export interface QualificationDecision {
    next_question: string | null;
    qualified: boolean;
    extracted: QualificationData;
}

const QUALIFICATION_SYSTEM_PROMPT = `You are a friendly, concise receptionist for a phone-repair shop qualifying an inbound SMS lead.

You will receive:
- the most recent customer message
- what we already know about this lead

You must:
1. Update the lead's qualification fields based on the latest message: device, issue, urgency (high|medium|low), desired_time (free-text like "today", "this weekend", or null).
2. Decide if we have enough info. We need at LEAST device + issue + (urgency OR desired_time) to be qualified.
3. If not qualified yet, choose ONE short next question (under 140 chars). Prefer in this order: device -> issue -> urgency/desired_time.
4. Never ask more than three questions total. After three exchanges, set qualified=true even if some fields are missing.
5. Never include URLs, prices, or promises about repair time.

Return JSON only:
{
  "next_question": "short question or null when qualified",
  "qualified": true|false,
  "extracted": { "device": null|string, "issue": null|string, "urgency": "high"|"medium"|"low"|null, "desired_time": null|string }
}`;

const MAX_QUESTIONS = 3;

/** Decide the next qualification step using OpenAI. Falls back to a heuristic when AI is unavailable. */
export async function qualifyLead(opts: {
    customerMessage: string;
    existing: QualificationData;
    step: number;
}): Promise<QualificationDecision> {
    const { customerMessage, existing, step } = opts;

    if (step >= MAX_QUESTIONS) {
        return { next_question: null, qualified: true, extracted: existing };
    }

    if (!openai) {
        return heuristicQualify(customerMessage, existing, step);
    }

    try {
        const response = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            messages: [
                { role: 'system', content: QUALIFICATION_SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: JSON.stringify({
                        latest_message: customerMessage,
                        already_known: existing,
                        questions_asked_so_far: step,
                    }),
                },
            ],
            response_format: { type: 'json_object' },
        });

        const content = response.choices[0]?.message?.content;
        if (!content) throw new Error('No content from OpenAI');

        const parsed = JSON.parse(content) as Partial<QualificationDecision>;
        const merged: QualificationData = {
            device: parsed.extracted?.device ?? existing.device ?? null,
            issue: parsed.extracted?.issue ?? existing.issue ?? null,
            urgency: parsed.extracted?.urgency ?? existing.urgency ?? null,
            desired_time: parsed.extracted?.desired_time ?? existing.desired_time ?? null,
        };
        const nextQuestion = parsed.qualified ? null : sanitizeQuestion(parsed.next_question);
        return {
            next_question: nextQuestion,
            qualified: !!parsed.qualified || step + 1 >= MAX_QUESTIONS,
            extracted: merged,
        };
    } catch (error) {
        logger.error(`${TAG} qualifyLead failed, falling back to heuristic`, error);
        return heuristicQualify(customerMessage, existing, step);
    }
}

function sanitizeQuestion(q: string | null | undefined): string | null {
    if (!q) return null;
    // Strip any URLs the model might have hallucinated.
    return q.replace(/https?:\/\/\S+/gi, '').trim().slice(0, 200) || null;
}

function heuristicQualify(
    message: string,
    existing: QualificationData,
    step: number,
): QualificationDecision {
    const text = message.toLowerCase();
    const merged: QualificationData = { ...existing };

    if (!merged.device) {
        const deviceMatch = text.match(/iphone|samsung|galaxy|pixel|ipad|tablet|laptop|macbook|computer|phone/);
        if (deviceMatch) merged.device = deviceMatch[0];
    }
    if (!merged.issue) {
        const issueMatch = text.match(/screen|battery|charging|water|crack|broken|won't turn on|wont turn on|virus|slow/);
        if (issueMatch) merged.issue = issueMatch[0];
    }
    if (!merged.urgency) {
        if (/asap|today|now|urgent|emergency/.test(text)) merged.urgency = 'high';
        else if (/tomorrow|this week|soon/.test(text)) merged.urgency = 'medium';
        else if (/whenever|next week|no rush/.test(text)) merged.urgency = 'low';
    }

    const haveCore = !!(merged.device && merged.issue && (merged.urgency || merged.desired_time));
    if (haveCore || step + 1 >= MAX_QUESTIONS) {
        return { next_question: null, qualified: true, extracted: merged };
    }

    let nextQuestion: string;
    if (!merged.device) {
        nextQuestion = 'What device or item needs repair?';
    } else if (!merged.issue) {
        nextQuestion = "What's the issue with it?";
    } else {
        nextQuestion = 'How soon do you need it fixed?';
    }
    return { next_question: nextQuestion, qualified: false, extracted: merged };
}

/** Build a structured summary line for the owner once a lead is qualified. */
export function buildOwnerSummary(opts: {
    customerPhone: string;
    customerName?: string | null;
    data: QualificationData;
}): string {
    const parts: string[] = ['New qualified lead'];
    if (opts.customerName) parts.push(`from ${opts.customerName}`);
    parts.push(`(${opts.customerPhone})`);
    const detailParts: string[] = [];
    if (opts.data.device) detailParts.push(`Device: ${opts.data.device}`);
    if (opts.data.issue) detailParts.push(`Issue: ${opts.data.issue}`);
    if (opts.data.urgency) detailParts.push(`Urgency: ${opts.data.urgency}`);
    if (opts.data.desired_time) detailParts.push(`Wants: ${opts.data.desired_time}`);
    const summary = parts.join(' ');
    return detailParts.length > 0 ? `${summary} — ${detailParts.join(' | ')}` : summary;
}

export const MAX_QUALIFICATION_QUESTIONS = MAX_QUESTIONS;
