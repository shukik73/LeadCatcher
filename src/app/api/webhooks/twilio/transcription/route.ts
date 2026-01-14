import { supabaseAdmin } from '@/lib/supabase-server';
import { validateTwilioRequest } from '@/lib/twilio-validator';
import { analyzeIntent } from '@/lib/ai-service';
import { logger } from '@/lib/logger';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    // 1. Validate (Optional but recommended for callbacks)
    // Twilio callbacks for transcription might need different validation context
    // For MVP, we'll verify it loosely or trust the signature if possible.

    const formData = await request.formData();
    const transcriptionText = formData.get('TranscriptionText') as string;
    const transcriptionStatus = formData.get('TranscriptionStatus') as string;

    // URL Params passed in callback URL
    const url = new URL(request.url);
    const businessId = url.searchParams.get('businessId');
    const caller = url.searchParams.get('caller'); // E.164
    const called = url.searchParams.get('called'); // E.164

    if (!businessId || !caller || !called) {
        logger.error('Missing params in transcription callback', null, { url: request.url });
        return new Response('Missing params', { status: 400 });
    }

    if (transcriptionStatus !== 'completed') {
        logger.warn('Transcription failed or pending', { status: transcriptionStatus });
        return new Response('OK');
    }

    logger.info('Voicemail Transcribed', { textLength: transcriptionText.length, caller });

    // 2. AI Analysis
    // We summarize the voicemail and generate a reply
    const analysis = await analyzeIntent(transcriptionText, 'Voicemail Transcript');

    // 3. Update Lead
    // Find the lead first
    const { data: lead } = await supabaseAdmin
        .from('leads')
        .select('id')
        .eq('business_id', businessId)
        .eq('caller_phone', caller)
        .single();

    if (lead) {
        await supabaseAdmin.from('leads')
            .update({
                intent: analysis.intent,
                ai_summary: `Voicemail: ${analysis.summary}`
            })
            .eq('id', lead.id);

        // Log the transcript as an inbound message? 
        // Or specific voicemail type. For now, inbound message is fine.
        await supabaseAdmin.from('messages').insert({
            lead_id: lead.id,
            direction: 'inbound',
            body: `[Voicemail]: ${transcriptionText}`,
            is_ai_generated: false
        });
    }

    // 4. Send Smart SMS Reply
    // We send the reply suggested by the AI
    if (analysis.suggestedReply) {
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        try {
            await client.messages.create({
                to: caller,
                from: called,
                body: analysis.suggestedReply,
            });

            // Log the outbound reply
            if (lead) {
                await supabaseAdmin.from('messages').insert({
                    lead_id: lead.id,
                    direction: 'outbound',
                    body: analysis.suggestedReply,
                    is_ai_generated: true
                });
            }

            logger.info('Smart Voicemail Reply Sent', { body: analysis.suggestedReply });
        } catch (error) {
            logger.error('Failed to send smart reply', error);
        }
    }

    // 5. Notify Owner with Summary
    // We could send the summary to the owner
    const { data: business } = await supabaseAdmin.from('businesses').select('owner_phone').eq('id', businessId).single();
    if (business?.owner_phone) {
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        try {
            await client.messages.create({
                to: business.owner_phone,
                from: called,
                body: `🎙️ New Voicemail from ${caller}.\nSummary: ${analysis.summary}\nIntent: ${analysis.intent}`,
            });
        } catch (e) { /* ignore */ }
    }

    return new Response('OK');
}
