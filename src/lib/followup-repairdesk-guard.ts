import { RepairDeskClient } from '@/lib/repairdesk';
import { logger } from '@/lib/logger';

const TAG = '[FollowUpGuard]';

/**
 * Pure: did any ticket land at/after the call (i.e. the customer already came in
 * since they called)? Tickets with missing/garbage dates are ignored.
 */
export function cameInSince(tickets: { created_at?: string | null }[], sinceIso: string): boolean {
    const since = new Date(sinceIso).getTime();
    if (!Number.isFinite(since)) return false;
    return tickets.some((t) => {
        const ts = t.created_at ? new Date(t.created_at).getTime() : NaN;
        return Number.isFinite(ts) && ts >= since;
    });
}

export interface GuardResult {
    /** Confirmed the customer already came in (has a RepairDesk ticket since the call). */
    cameIn: boolean;
    /** False if RepairDesk couldn't be reached — caller should fail safe (skip auto-send). */
    checked: boolean;
}

/**
 * Before auto-texting "come on by", confirm against RepairDesk that the customer
 * hasn't ALREADY come in since the call. On any RepairDesk error we return
 * checked:false so the caller falls back to manual approval — better to queue a
 * follow-up for review than to auto-text someone standing at the counter.
 */
export async function customerCameInAfterCall(
    apiKey: string,
    phone: string,
    callCreatedAt: string,
): Promise<GuardResult> {
    try {
        const res = await new RepairDeskClient(apiKey).searchTickets(phone);
        return { cameIn: cameInSince(res?.data || [], callCreatedAt), checked: true };
    } catch (error) {
        logger.error(`${TAG} RepairDesk lookup failed; will not auto-send`, error, { phone });
        return { cameIn: false, checked: false };
    }
}
