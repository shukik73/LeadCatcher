import { supabaseAdmin } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

const TAG = '[PatternTracker]';

/**
 * Records an SMS/callback pattern usage.
 * Call this when an auto-reply or callback script is sent.
 */
export async function trackPatternUsed(
    businessId: string,
    patternText: string,
    patternType: 'sms' | 'callback_script' | 'voicemail' = 'sms',
): Promise<void> {
    try {
        // Try to increment existing pattern
        const { data: existing } = await supabaseAdmin
            .from('message_patterns')
            .select('id, times_used')
            .eq('business_id', businessId)
            .eq('pattern_text', patternText)
            .eq('pattern_type', patternType)
            .single();

        if (existing) {
            await supabaseAdmin
                .from('message_patterns')
                .update({
                    times_used: existing.times_used + 1,
                    last_used_at: new Date().toISOString(),
                })
                .eq('id', existing.id);
        } else {
            // Insert new pattern
            await supabaseAdmin
                .from('message_patterns')
                .insert({
                    business_id: businessId,
                    pattern_text: patternText,
                    pattern_type: patternType,
                    times_used: 1,
                    last_used_at: new Date().toISOString(),
                });
        }
    } catch (error) {
        // Non-critical — don't break the main flow
        logger.warn(`${TAG} Failed to track pattern`, { error });
    }
}

/**
 * Records a conversion for a pattern.
 * Call this when a call with a specific auto-reply leads to a booking.
 */
export async function trackPatternConverted(
    businessId: string,
    patternText: string,
    patternType: 'sms' | 'callback_script' | 'voicemail' = 'sms',
): Promise<void> {
    try {
        const { data: existing } = await supabaseAdmin
            .from('message_patterns')
            .select('id, times_converted')
            .eq('business_id', businessId)
            .eq('pattern_text', patternText)
            .eq('pattern_type', patternType)
            .single();

        if (existing) {
            await supabaseAdmin
                .from('message_patterns')
                .update({
                    times_converted: existing.times_converted + 1,
                })
                .eq('id', existing.id);
        }
        // If pattern doesn't exist, skip — can't convert something we didn't track
    } catch (error) {
        logger.warn(`${TAG} Failed to track conversion`, { error });
    }
}

/**
 * Returns the top-performing message patterns for a business.
 * Ordered by conversion rate DESC, then times_used DESC.
 * Only returns patterns used at least `minUses` times for statistical relevance.
 */
export async function getTopPatterns(
    businessId: string,
    patternType?: string,
    limit: number = 10,
    minUses: number = 3,
): Promise<Array<{
    id: string;
    pattern_text: string;
    pattern_type: string;
    times_used: number;
    times_converted: number;
    conversion_rate: number;
}>> {
    let query = supabaseAdmin
        .from('message_patterns')
        .select('id, pattern_text, pattern_type, times_used, times_converted, conversion_rate')
        .eq('business_id', businessId)
        .gte('times_used', minUses)
        .order('conversion_rate', { ascending: false })
        .order('times_used', { ascending: false })
        .limit(limit);

    if (patternType) {
        query = query.eq('pattern_type', patternType);
    }

    const { data, error } = await query;

    if (error) {
        logger.error(`${TAG} Failed to fetch top patterns`, error);
        return [];
    }

    return data || [];
}
