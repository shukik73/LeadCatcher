import { describe, it, expect, beforeEach } from 'vitest';
import { generateReceptionistReply } from '@/lib/ai-receptionist';

describe('generateReceptionistReply static fallback (no OPENAI_API_KEY)', () => {
    beforeEach(() => {
        delete process.env.OPENAI_API_KEY;
    });

    it('returns a helpful reply with shop facts — never an interrogation', async () => {
        const out = await generateReceptionistReply({
            customerMessage: 'do you fix ps5 hdmi ports? how much?',
            existing: {},
            context: {
                businessName: 'Techy Miramar',
                address: '16263 Miramar Pkwy',
                hoursLine: 'Open now until 7 PM',
                isOpenNow: true,
                freeCheck: true,
            },
        });
        expect(out.should_reply).toBe(true);
        expect(out.reply).toContain('Techy Miramar');
        expect(out.reply).toContain('16263 Miramar Pkwy');
        // Drives the free check, does not quote a price.
        expect(out.reply.toLowerCase()).toContain('free');
        expect(out.reply).not.toMatch(/\$\d/);
        // Still extracts intel heuristically for the owner.
        expect(out.extracted.device).toBe('ps5');
    });

    it('never includes URLs', async () => {
        const out = await generateReceptionistReply({
            customerMessage: 'screen cracked on my iphone',
            existing: {},
            context: { businessName: 'Shop', freeCheck: true },
        });
        expect(out.reply).not.toMatch(/https?:\/\//);
        expect(out.extracted.device).toBe('iphone');
        expect(out.extracted.issue).toMatch(/screen|crack/);
    });
});
