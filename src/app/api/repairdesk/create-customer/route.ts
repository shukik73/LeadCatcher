import { createSupabaseServerClient } from '@/lib/supabase-server';
import { RepairDeskClient } from '@/lib/repairdesk';
import { validateCsrfOrigin } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const TAG = '[RD CreateCustomer]';

const bodySchema = z.object({
    first_name: z.string().min(1).max(100),
    last_name: z.string().max(100).optional().default(''),
    phone: z.string().min(1).max(20),
    email: z.string().email().max(255).optional(),
}).strict();

/**
 * POST /api/repairdesk/create-customer
 *
 * Creates a new customer in RepairDesk from call data.
 */
export async function POST(request: Request) {
    if (!validateCsrfOrigin(request)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return Response.json({ error: 'Invalid JSON' }, { status: 400 });
        }

        const parsed = bodySchema.safeParse(body);
        if (!parsed.success) {
            return Response.json(
                { error: 'Invalid payload', details: parsed.error.issues.map(i => i.message) },
                { status: 400 },
            );
        }

        const supabase = await createSupabaseServerClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (!user || authError) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id, repairdesk_api_key, repairdesk_store_url')
            .eq('user_id', user.id)
            .single();

        if (!business) {
            return Response.json({ error: 'Business not found' }, { status: 404 });
        }

        if (!business.repairdesk_api_key) {
            return Response.json({ error: 'RepairDesk not configured' }, { status: 400 });
        }

        const client = new RepairDeskClient(
            business.repairdesk_api_key,
            business.repairdesk_store_url || undefined,
        );

        const customer = await client.createCustomer(parsed.data);

        logger.info(`${TAG} Customer created`, { customerId: customer.id.toString() });
        return Response.json({ success: true, customer });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Failed to create customer' }, { status: 500 });
    }
}
