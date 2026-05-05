import { describe, it, expect, beforeEach } from 'vitest';
import { qualifyLead, buildOwnerSummary, MAX_QUALIFICATION_QUESTIONS } from '@/lib/lead-qualification';

describe('qualifyLead heuristic (no OPENAI_API_KEY)', () => {
    beforeEach(() => {
        delete process.env.OPENAI_API_KEY;
    });

    it('asks for the device on the first interaction', async () => {
        const out = await qualifyLead({
            customerMessage: 'Hi',
            existing: {},
            step: 0,
        });
        expect(out.qualified).toBe(false);
        expect(out.next_question).toMatch(/device/i);
    });

    it('extracts known fields and asks the next missing one', async () => {
        const out = await qualifyLead({
            customerMessage: 'iphone screen is cracked',
            existing: {},
            step: 0,
        });
        expect(out.extracted.device).toBe('iphone');
        expect(out.extracted.issue).toMatch(/screen|crack/);
        expect(out.qualified).toBe(false);
        expect(out.next_question).toMatch(/how soon|fixed/i);
    });

    it('marks the lead qualified once device + issue + urgency are known', async () => {
        const out = await qualifyLead({
            customerMessage: 'I need it fixed today asap',
            existing: { device: 'iphone', issue: 'screen' },
            step: 1,
        });
        expect(out.extracted.urgency).toBe('high');
        expect(out.qualified).toBe(true);
        expect(out.next_question).toBeNull();
    });

    it('forces qualification after MAX_QUALIFICATION_QUESTIONS', async () => {
        const out = await qualifyLead({
            customerMessage: 'whatever',
            existing: {},
            step: MAX_QUALIFICATION_QUESTIONS,
        });
        expect(out.qualified).toBe(true);
        expect(out.next_question).toBeNull();
    });
});

describe('buildOwnerSummary', () => {
    it('formats a structured summary with all fields', () => {
        const summary = buildOwnerSummary({
            customerPhone: '+15551234567',
            customerName: 'Jane',
            data: { device: 'iphone', issue: 'cracked screen', urgency: 'high', desired_time: 'today' },
        });
        expect(summary).toContain('Jane');
        expect(summary).toContain('+15551234567');
        expect(summary).toContain('Device: iphone');
        expect(summary).toContain('Issue: cracked screen');
        expect(summary).toContain('Urgency: high');
        expect(summary).toContain('Wants: today');
    });

    it('omits empty fields gracefully', () => {
        const summary = buildOwnerSummary({
            customerPhone: '+15551234567',
            customerName: null,
            data: { device: 'iphone' },
        });
        expect(summary).toContain('+15551234567');
        expect(summary).toContain('Device: iphone');
        expect(summary).not.toContain('Issue:');
    });
});
