import { createSupabaseServerClient } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const TAG = '[CallsList]';

const VALID_CATEGORIES = ['repair_quote', 'status_check', 'parts_inquiry', 'follow_up', 'spam', 'wrong_number'];
const VALID_URGENCIES = ['high', 'medium', 'low'];
const VALID_SENTIMENTS = ['positive', 'neutral', 'negative', 'frustrated'];
const VALID_STATUSES = ['pending', 'called', 'no_answer', 'booked', 'lost'];

/**
 * GET /api/calls/list
 *
 * List call_analyses with filtering, sorting, and pagination.
 * Query params: category, urgency, sentiment, callback_status, owner, from, to, page, limit
 */
export async function GET(request: Request) {
    try {
        const supabase = await createSupabaseServerClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (!user || authError) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id')
            .eq('user_id', user.id)
            .single();

        if (!business) {
            return Response.json({ error: 'Business not found' }, { status: 404 });
        }

        const { searchParams } = new URL(request.url);
        const category = searchParams.get('category');
        const urgency = searchParams.get('urgency');
        const sentiment = searchParams.get('sentiment');
        const callbackStatus = searchParams.get('callback_status');
        const owner = searchParams.get('owner');
        const from = searchParams.get('from');
        const to = searchParams.get('to');
        const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
        const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));

        // Validate filter params
        if (category && !VALID_CATEGORIES.includes(category)) {
            return Response.json({ error: 'Invalid category' }, { status: 400 });
        }
        if (urgency && !VALID_URGENCIES.includes(urgency)) {
            return Response.json({ error: 'Invalid urgency' }, { status: 400 });
        }
        if (sentiment && !VALID_SENTIMENTS.includes(sentiment)) {
            return Response.json({ error: 'Invalid sentiment' }, { status: 400 });
        }
        if (callbackStatus && !VALID_STATUSES.includes(callbackStatus)) {
            return Response.json({ error: 'Invalid callback_status' }, { status: 400 });
        }

        let query = supabase
            .from('call_analyses')
            .select(
                'id, source_call_id, customer_name, customer_phone, call_status, call_duration, ' +
                'recording_url, summary, sentiment, category, urgency, follow_up_needed, follow_up_notes, ' +
                'callback_status, owner, due_by, coaching_note, booked_value, last_contacted_at, ' +
                'contact_attempts, rd_ticket_id, rd_ticket_status, created_at',
                { count: 'exact' }
            )
            .eq('business_id', business.id);

        if (category) query = query.eq('category', category);
        if (urgency) query = query.eq('urgency', urgency);
        if (sentiment) query = query.eq('sentiment', sentiment);
        if (callbackStatus) query = query.eq('callback_status', callbackStatus);
        if (owner) query = query.eq('owner', owner);
        if (from) query = query.gte('created_at', from);
        if (to) query = query.lte('created_at', to);

        const offset = (page - 1) * limit;
        const { data, error, count } = await query
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            logger.error(`${TAG} Query failed`, error);
            return Response.json({ error: 'Failed to fetch calls' }, { status: 500 });
        }

        return Response.json({
            success: true,
            calls: data || [],
            pagination: {
                page,
                limit,
                total: count || 0,
                totalPages: Math.ceil((count || 0) / limit),
            },
        });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
