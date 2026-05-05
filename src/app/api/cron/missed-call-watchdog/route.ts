import { logger } from '@/lib/logger';
import { timingSafeEqual } from 'crypto';

export const dynamic = 'force-dynamic';

const TAG = '[Missed Call Watchdog]';

function verifyCronSecret(header: string | null): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret || !header) return false;
    const expected = `Bearer ${secret}`;
    if (header.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

/**
 * GET /api/cron/missed-call-watchdog
 *
 * DISABLED: this fallback ran alongside /api/repairdesk/poll and double-processed
 * the same RepairDesk missed-call data. The cron is removed from vercel.json
 * and this route now no-ops. Remove the file entirely once we confirm nothing
 * external still calls it.
 */
export async function GET(request: Request) {
    if (!verifyCronSecret(request.headers.get('authorization'))) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    logger.info(`${TAG} Watchdog disabled - superseded by /api/repairdesk/poll`);
    return Response.json({ disabled: true, reason: 'Replaced by /api/repairdesk/poll' });
}
