import { createSupabaseServerClient } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

const TAG = '[CallAction]';

interface ActionResult {
    success: boolean;
    status?: number;
    error?: string;
    data?: Record<string, unknown>;
}

/**
 * Authenticates the user, verifies they own the call, then applies the update.
 */
export async function updateCallAnalysis(
    callId: string,
    updateFn: (currentRow: Record<string, unknown>) => Record<string, unknown>,
    actionName: string,
): Promise<ActionResult> {
    try {
        const supabase = await createSupabaseServerClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (!user || authError) {
            return { success: false, status: 401, error: 'Unauthorized' };
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id')
            .eq('user_id', user.id)
            .single();

        if (!business) {
            return { success: false, status: 404, error: 'Business not found' };
        }

        // Fetch current row (RLS ensures ownership)
        const { data: call, error: fetchError } = await supabase
            .from('call_analyses')
            .select('*')
            .eq('id', callId)
            .eq('business_id', business.id)
            .single();

        if (!call || fetchError) {
            return { success: false, status: 404, error: 'Call not found' };
        }

        const updates = updateFn(call);

        const { error: updateError } = await supabase
            .from('call_analyses')
            .update(updates)
            .eq('id', callId);

        if (updateError) {
            logger.error(`${TAG} ${actionName} failed`, updateError, { callId });
            return { success: false, status: 500, error: `Failed to ${actionName}` };
        }

        logger.info(`${TAG} ${actionName}`, { callId, ...updates });
        return { success: true, data: { id: callId, ...updates } };
    } catch (error) {
        logger.error(`${TAG} ${actionName} unexpected error`, error);
        return { success: false, status: 500, error: 'Internal server error' };
    }
}
