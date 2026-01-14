import OpenAI from 'openai';
import { logger } from '@/lib/logger';

import { INTENT_ANALYSIS_SYSTEM_PROMPT } from '@/lib/prompts';

// Initialize OpenAI only if key is present
const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

interface AnalysisResult {
    intent: 'booking_request' | 'price_inquiry' | 'general_inquiry' | 'spam' | 'other';
    summary: string;
    suggestedReply?: string;
    priority: 'high' | 'medium' | 'low';
}

export async function analyzeIntent(text: string, context?: string): Promise<AnalysisResult> {
    if (!openai) {
        logger.warn('OpenAI API Key missing, skipping analysis');
        return {
            intent: 'other',
            summary: 'AI analysis unavailable',
            priority: 'low'
        };
    }

    try {
        const response = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: INTENT_ANALYSIS_SYSTEM_PROMPT
                },
                {
                    role: 'user',
                    content: `Message: "${text}"\nContext: ${context || 'None'}`
                }
            ],
            response_format: { type: 'json_object' }
        });

        const content = response.choices[0].message.content;
        if (!content) throw new Error('No content from OpenAI');

        const result = JSON.parse(content) as AnalysisResult;
        return result;

    } catch (error) {
        logger.error('Error analyzing intent with OpenAI', error);
        return {
            intent: 'other',
            summary: 'Analysis failed',
            priority: 'low'
        };
    }
}
