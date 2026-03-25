import { supabaseAdmin } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

const TAG = '[CoachingReport]';

export interface OwnerStats {
    owner: string;
    total_calls: number;
    calls_booked: number;
    calls_lost: number;
    calls_pending: number;
    booked_rate: number;
    avg_response_minutes: number | null;
    coaching_notes: string[];
}

export interface CoachingSummary {
    period_start: string;
    period_end: string;
    total_calls: number;
    by_owner: OwnerStats[];
    top_coaching_notes: string[];
    common_patterns: { pattern: string; count: number }[];
    high_urgency_count: number;
    overdue_count: number;
}

/**
 * Generates a coaching summary for a business over a date range.
 * Aggregates coaching notes, per-owner stats, and common patterns.
 */
export async function generateCoachingSummary(
    businessId: string,
    fromDate: string,
    toDate: string,
): Promise<CoachingSummary> {
    logger.info(`${TAG} Generating summary`, { businessId, from: fromDate, to: toDate });

    const { data: calls, error } = await supabaseAdmin
        .from('call_analyses')
        .select('owner, category, urgency, callback_status, coaching_note, follow_up_needed, due_by, booked_value, last_contacted_at, created_at')
        .eq('business_id', businessId)
        .gte('created_at', fromDate)
        .lte('created_at', toDate);

    if (error) {
        logger.error(`${TAG} Failed to fetch calls`, error);
        throw new Error('Failed to generate coaching summary');
    }

    const rows = calls || [];
    const now = new Date();

    // Per-owner aggregation
    const ownerMap: Record<string, {
        total: number;
        booked: number;
        lost: number;
        pending: number;
        responseTimes: number[];
        notes: string[];
    }> = {};

    const allNotes: string[] = [];
    const patternMap: Record<string, number> = {};
    let highUrgencyCount = 0;
    let overdueCount = 0;

    for (const row of rows) {
        const ownerKey = row.owner || 'Unassigned';

        if (!ownerMap[ownerKey]) {
            ownerMap[ownerKey] = { total: 0, booked: 0, lost: 0, pending: 0, responseTimes: [], notes: [] };
        }

        const stats = ownerMap[ownerKey];
        stats.total++;

        if (row.callback_status === 'booked') stats.booked++;
        if (row.callback_status === 'lost') stats.lost++;
        if (['pending', 'called', 'no_answer'].includes(row.callback_status)) stats.pending++;

        // Response time: time from call creation to first contact
        if (row.last_contacted_at && row.created_at) {
            const created = new Date(row.created_at).getTime();
            const contacted = new Date(row.last_contacted_at).getTime();
            const minutes = (contacted - created) / (1000 * 60);
            if (minutes > 0 && minutes < 10080) { // cap at 1 week
                stats.responseTimes.push(minutes);
            }
        }

        // Coaching notes
        if (row.coaching_note?.trim()) {
            const note = row.coaching_note.trim();
            stats.notes.push(note);
            allNotes.push(note);

            // Extract patterns (simple keyword-based)
            const lowerNote = note.toLowerCase();
            for (const keyword of COACHING_KEYWORDS) {
                if (lowerNote.includes(keyword)) {
                    patternMap[keyword] = (patternMap[keyword] || 0) + 1;
                }
            }
        }

        // Urgency tracking
        if (row.urgency === 'high') highUrgencyCount++;

        // Overdue tracking
        if (
            row.follow_up_needed &&
            row.callback_status === 'pending' &&
            row.due_by &&
            now.getTime() > new Date(row.due_by).getTime()
        ) {
            overdueCount++;
        }
    }

    // Build per-owner stats
    const byOwner: OwnerStats[] = Object.entries(ownerMap)
        .map(([owner, stats]) => ({
            owner,
            total_calls: stats.total,
            calls_booked: stats.booked,
            calls_lost: stats.lost,
            calls_pending: stats.pending,
            booked_rate: stats.total > 0 ? Math.round((stats.booked / stats.total) * 100) : 0,
            avg_response_minutes: stats.responseTimes.length > 0
                ? Math.round(stats.responseTimes.reduce((a, b) => a + b, 0) / stats.responseTimes.length)
                : null,
            coaching_notes: [...new Set(stats.notes)].slice(0, 5),
        }))
        .sort((a, b) => b.total_calls - a.total_calls);

    // Top coaching notes (deduplicated)
    const topNotes = [...new Set(allNotes)].slice(0, 10);

    // Common patterns
    const commonPatterns = Object.entries(patternMap)
        .map(([pattern, count]) => ({ pattern: PATTERN_LABELS[pattern] || pattern, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);

    return {
        period_start: fromDate,
        period_end: toDate,
        total_calls: rows.length,
        by_owner: byOwner,
        top_coaching_notes: topNotes,
        common_patterns: commonPatterns,
        high_urgency_count: highUrgencyCount,
        overdue_count: overdueCount,
    };
}

// Keywords to detect coaching themes
const COACHING_KEYWORDS = [
    'upsell', 'price', 'quote', 'greeting', 'hold', 'wait',
    'follow up', 'callback', 'status', 'update', 'competitor',
    'empathy', 'apologize', 'apology', 'transfer', 'voicemail',
    'name', 'appointment', 'schedule', 'confirm', 'rude', 'slow',
    'parts', 'timeline', 'eta', 'warranty', 'discount',
] as const;

const PATTERN_LABELS: Record<string, string> = {
    'upsell': 'Missed upsell opportunity',
    'price': 'Pricing communication',
    'quote': 'Quote handling',
    'greeting': 'Greeting quality',
    'hold': 'Hold time management',
    'wait': 'Wait time communication',
    'follow up': 'Follow-up timeliness',
    'callback': 'Callback handling',
    'status': 'Status update communication',
    'update': 'Update communication',
    'competitor': 'Competitor mention handling',
    'empathy': 'Empathy & tone',
    'apologize': 'Apology when needed',
    'apology': 'Apology when needed',
    'transfer': 'Call transfer handling',
    'voicemail': 'Voicemail quality',
    'name': 'Using customer name',
    'appointment': 'Appointment scheduling',
    'schedule': 'Scheduling efficiency',
    'confirm': 'Confirmation practices',
    'rude': 'Courtesy concerns',
    'slow': 'Response speed',
    'parts': 'Parts communication',
    'timeline': 'Timeline expectations',
    'eta': 'ETA communication',
    'warranty': 'Warranty information',
    'discount': 'Discount handling',
};
