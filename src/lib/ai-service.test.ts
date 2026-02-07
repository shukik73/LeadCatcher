import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Shared mock function that persists across module resets
const mockCreate = vi.fn();

// Mock OpenAI before importing ai-service
vi.mock('openai', () => {
    return {
        default: class MockOpenAI {
            chat = {
                completions: {
                    create: mockCreate,
                },
            };
        },
    };
});

vi.mock('@/lib/logger', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.mock('@/lib/prompts', () => ({
    INTENT_ANALYSIS_SYSTEM_PROMPT: 'test prompt',
}));

describe('ai-service', () => {
    beforeEach(() => {
        vi.resetModules();
        mockCreate.mockReset();
        process.env.OPENAI_API_KEY = 'test-key';
    });

    afterEach(() => {
        delete process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_MODEL;
    });

    it('returns fallback when OpenAI API key is missing', async () => {
        delete process.env.OPENAI_API_KEY;
        vi.resetModules();

        const { analyzeIntent } = await import('./ai-service');
        const result = await analyzeIntent('test message');

        expect(result).toEqual({
            intent: 'other',
            summary: 'AI analysis unavailable',
            priority: 'low',
        });
    });

    it('returns parsed analysis result on success', async () => {
        const mockResult = {
            intent: 'booking_request',
            summary: 'Customer wants to schedule an appointment',
            suggestedReply: 'Sure, when would you like to come in?',
            priority: 'high',
        };

        mockCreate.mockResolvedValue({
            choices: [{ message: { content: JSON.stringify(mockResult) } }],
        });

        const { analyzeIntent } = await import('./ai-service');
        const result = await analyzeIntent('I want to book an appointment');

        expect(result).toEqual(mockResult);
        expect(mockCreate).toHaveBeenCalledOnce();
    });

    it('passes context to OpenAI when provided', async () => {
        mockCreate.mockResolvedValue({
            choices: [{
                message: {
                    content: JSON.stringify({
                        intent: 'general_inquiry',
                        summary: 'General question',
                        priority: 'medium',
                    }),
                },
            }],
        });

        const { analyzeIntent } = await import('./ai-service');
        await analyzeIntent('Hello there', 'Voicemail Transcript');

        const callArgs = mockCreate.mock.calls[0][0];
        expect(callArgs.messages[1].content).toContain('Voicemail Transcript');
    });

    it('returns fallback on OpenAI API error', async () => {
        mockCreate.mockRejectedValue(new Error('API error'));

        const { analyzeIntent } = await import('./ai-service');
        const result = await analyzeIntent('test message');

        expect(result).toEqual({
            intent: 'other',
            summary: 'Analysis failed',
            priority: 'low',
        });
    });

    it('returns fallback when OpenAI returns empty content', async () => {
        mockCreate.mockResolvedValue({
            choices: [{ message: { content: null } }],
        });

        const { analyzeIntent } = await import('./ai-service');
        const result = await analyzeIntent('test message');

        expect(result).toEqual({
            intent: 'other',
            summary: 'Analysis failed',
            priority: 'low',
        });
    });

    it('uses correct model from environment', async () => {
        process.env.OPENAI_MODEL = 'gpt-4-turbo';

        mockCreate.mockResolvedValue({
            choices: [{
                message: {
                    content: JSON.stringify({
                        intent: 'other',
                        summary: 'test',
                        priority: 'low',
                    }),
                },
            }],
        });

        const { analyzeIntent } = await import('./ai-service');
        await analyzeIntent('test');

        const callArgs = mockCreate.mock.calls[0][0];
        expect(callArgs.model).toBe('gpt-4-turbo');
    });

    it('requests JSON response format', async () => {
        mockCreate.mockResolvedValue({
            choices: [{
                message: {
                    content: JSON.stringify({
                        intent: 'spam',
                        summary: 'Spam message',
                        priority: 'low',
                    }),
                },
            }],
        });

        const { analyzeIntent } = await import('./ai-service');
        await analyzeIntent('Buy cheap stuff now!');

        const callArgs = mockCreate.mock.calls[0][0];
        expect(callArgs.response_format).toEqual({ type: 'json_object' });
    });
});
