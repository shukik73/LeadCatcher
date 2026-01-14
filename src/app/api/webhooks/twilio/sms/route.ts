import { supabaseAdmin } from '@/lib/supabase-server';
import { validateTwilioRequest } from '@/lib/twilio-validator';
import { normalizePhoneNumber } from '@/lib/phone-utils';
import { logger } from '@/lib/logger';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    // 1. SECURITY: Validate request
    const isValid = await validateTwilioRequest(request);
    if (!isValid) {
        logger.warn('[SMS Webhook] Invalid Twilio signature');
        return new Response('Unauthorized', { status: 403 });
    }

    const formData = await request.formData();
    const fromRaw = formData.get('From') as string;
    const toRaw = formData.get('To') as string;
    const body = formData.get('Body') as string;

    if (!fromRaw || !body) return new Response('Invalid Request', { status: 400 });

    const from = normalizePhoneNumber(fromRaw);
    const to = normalizePhoneNumber(toRaw);
    const bodyUpper = body.trim().toUpperCase();

    logger.info(`[SMS Webhook] Message received`, { from, to, bodyLength: body.length });

    // 2. ISOLATION: Find lead based on caller AND business number
    // First find the business associated with the 'To' number
    const { data: business } = await supabaseAdmin
        .from('businesses')
        .select('id, owner_phone, name')
        .eq('forwarding_number', to)
        .single();

    if (!business) {
        logger.error(`[SMS Webhook] No business found for number`, null, { to });
        return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }

    // 2.5. TCPA COMPLIANCE: Handle STOP keywords (STOP, UNSUBSCRIBE, CANCEL, END, QUIT)
    const stopKeywords = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
    const isOptOut = stopKeywords.some(keyword => bodyUpper === keyword || bodyUpper === `${keyword}ALL`);

    if (isOptOut) {
        const optOutKeyword = stopKeywords.find(keyword => bodyUpper.startsWith(keyword)) || 'STOP';
        
        // Add to opt-out table (upsert to handle re-opts)
        await supabaseAdmin.from('opt_outs').upsert({
            business_id: business.id,
            phone_number: from,
            opt_out_keyword: optOutKeyword,
            opted_out_at: new Date().toISOString()
        }, {
            onConflict: 'business_id,phone_number'
        });

        logger.info('[SMS Webhook] Opt-out registered', { from, businessId: business.id, keyword: optOutKeyword });

        // Send confirmation message (TCPA requirement)
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        try {
            await client.messages.create({
                to: from,
                from: to,
                body: `You have been unsubscribed. You will no longer receive messages from ${business.name}. Reply START to resubscribe.`,
            });
        } catch (err) {
            logger.error('Error sending opt-out confirmation', err);
        }

        // Return TwiML response (don't process as normal message)
        return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }

    // 2.6. TCPA COMPLIANCE: Handle START keyword (re-subscribe)
    if (bodyUpper === 'START') {
        // Remove from opt-out table
        await supabaseAdmin.from('opt_outs')
            .delete()
            .eq('business_id', business.id)
            .eq('phone_number', from);

        logger.info('[SMS Webhook] Re-subscription', { from, businessId: business.id });

        // Send confirmation
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        try {
            await client.messages.create({
                to: from,
                from: to,
                body: `You have been resubscribed. You will now receive messages from ${business.name}. Reply STOP to unsubscribe.`,
            });
        } catch (err) {
            logger.error('Error sending resubscription confirmation', err);
        }

        return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }

    // 2.7. TCPA COMPLIANCE: Check if user is opted out
    const { data: optOut } = await supabaseAdmin
        .from('opt_outs')
        .select('id')
        .eq('business_id', business.id)
        .eq('phone_number', from)
        .maybeSingle();

    if (optOut) {
        logger.info('[SMS Webhook] Message from opted-out user ignored', { from, businessId: business.id });
        // Don't process message, but don't send error (TCPA compliance)
        return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }

    // Find or Create Lead
    let leadId: string | null = null;

    const { data: lead } = await supabaseAdmin
        .from('leads')
        .select('id')
        .eq('caller_phone', from)
        .eq('business_id', business.id)
        .single();

    if (lead) {
        leadId = lead.id;
    } else {
        // New lead via SMS (rare but possible)
        const { data: newLead } = await supabaseAdmin
            .from('leads')
            .insert({
                caller_phone: from,
                status: 'New',
                business_id: business.id
            })
            .select('id')
            .single();
        if (newLead) leadId = newLead.id;
    }

    if (leadId) {
        // 3. Log Message
        await supabaseAdmin.from('messages').insert({
            lead_id: leadId,
            direction: 'inbound',
            body: body
        });

        // 4. AI Analysis (Async-ish)
        try {
            // We run this "inline" for MVP, but in prod this should be a background job
            const { analyzeIntent } = await import('@/lib/ai-service');
            const analysis = await analyzeIntent(body);

            logger.info('AI Analysis Result', { analysis, leadId });

            if (analysis.intent !== 'other') {
                await supabaseAdmin.from('leads')
                    .update({
                        intent: analysis.intent,
                        ai_summary: analysis.summary
                    })
                    .eq('id', leadId);
            }
        } catch (error) {
            logger.error('AI Analysis failed', error);
        }

        // 5. Notify Owner
        if (business.owner_phone) {
            const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
            try {
                await client.messages.create({
                    to: business.owner_phone,
                    from: to,
                    body: `📩 Reply from ${from}: "${body}"`,
                });
            } catch (err) {
                logger.error('Error notifying owner of SMS:', err);
            }
        }
    }

    return new Response('<Response></Response>', {
        headers: { 'Content-Type': 'text/xml' },
    });
}
