import { supabaseAdmin } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

const TAG = '[DailyReport]';

export interface DailyReport {
    date: string;
    total_calls_analyzed: number;
    by_status: { missed: number; answered: number; outbound: number };
    by_urgency: { high: number; medium: number; low: number };
    followups_pending: number;
    high_urgency_overdue: number;
    booked_count: number;
    lost_count: number;
    booked_revenue: number;
    missed_revenue_estimate: number;
    top_coaching_notes: string[];
    top_categories: { category: string; count: number }[];
}

export interface DailyReportOutput {
    json: DailyReport;
    markdown: string;
}

/**
 * Generates a daily summary report for a business.
 * Covers the past 24 hours by default, or a specific date range.
 */
export async function generateDailyReport(
    businessId: string,
    fromDate?: string,
    toDate?: string,
): Promise<DailyReportOutput> {
    const now = new Date();
    const from = fromDate || new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const to = toDate || now.toISOString();

    logger.info(`${TAG} Generating report`, { businessId, from, to });

    // Fetch all analyses in the date range
    const { data: calls, error } = await supabaseAdmin
        .from('call_analyses')
        .select('call_status, category, urgency, callback_status, coaching_note, booked_value, due_by, follow_up_needed')
        .eq('business_id', businessId)
        .gte('created_at', from)
        .lte('created_at', to);

    if (error) {
        logger.error(`${TAG} Failed to fetch calls`, error);
        throw new Error('Failed to generate report');
    }

    const rows = calls || [];

    // Count by status
    const byStatus = { missed: 0, answered: 0, outbound: 0 };
    const byUrgency = { high: 0, medium: 0, low: 0 };
    const categoryMap: Record<string, number> = {};
    const coachingNotes: string[] = [];
    let bookedCount = 0;
    let lostCount = 0;
    let bookedRevenue = 0;
    let followupsPending = 0;
    let highUrgencyOverdue = 0;

    for (const row of rows) {
        // By status
        if (row.call_status in byStatus) {
            byStatus[row.call_status as keyof typeof byStatus]++;
        }

        // By urgency
        if (row.urgency in byUrgency) {
            byUrgency[row.urgency as keyof typeof byUrgency]++;
        }

        // Categories
        if (row.category) {
            categoryMap[row.category] = (categoryMap[row.category] || 0) + 1;
        }

        // Callback outcomes
        if (row.callback_status === 'booked') {
            bookedCount++;
            if (row.booked_value) bookedRevenue += Number(row.booked_value);
        }
        if (row.callback_status === 'lost') {
            lostCount++;
        }

        // Pending follow-ups
        if (row.follow_up_needed && ['pending', 'called', 'no_answer'].includes(row.callback_status)) {
            followupsPending++;
        }

        // High urgency overdue (due_by passed by more than 15 min)
        if (
            row.urgency === 'high' &&
            row.follow_up_needed &&
            row.callback_status === 'pending' &&
            row.due_by
        ) {
            const dueTime = new Date(row.due_by).getTime();
            if (now.getTime() - dueTime > 15 * 60 * 1000) {
                highUrgencyOverdue++;
            }
        }

        // Coaching notes
        if (row.coaching_note && row.coaching_note.trim()) {
            coachingNotes.push(row.coaching_note.trim());
        }
    }

    // Top 3 coaching notes (unique, most recent first since rows are already ordered)
    const uniqueNotes = [...new Set(coachingNotes)].slice(0, 3);

    // Top categories sorted by count
    const topCategories = Object.entries(categoryMap)
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    // Missed revenue estimate: lost calls * average booked value
    const avgBookedValue = bookedCount > 0 ? bookedRevenue / bookedCount : 150; // $150 default estimate
    const missedRevenueEstimate = lostCount * avgBookedValue;

    const report: DailyReport = {
        date: now.toISOString().split('T')[0],
        total_calls_analyzed: rows.length,
        by_status: byStatus,
        by_urgency: byUrgency,
        followups_pending: followupsPending,
        high_urgency_overdue: highUrgencyOverdue,
        booked_count: bookedCount,
        lost_count: lostCount,
        booked_revenue: bookedRevenue,
        missed_revenue_estimate: missedRevenueEstimate,
        top_coaching_notes: uniqueNotes,
        top_categories: topCategories,
    };

    const markdown = renderMarkdown(report);

    return { json: report, markdown };
}

function renderMarkdown(r: DailyReport): string {
    const lines: string[] = [
        `# Daily Call Report — ${r.date}`,
        '',
        `## Summary`,
        `- **Total calls analyzed:** ${r.total_calls_analyzed}`,
        `- Missed: ${r.by_status.missed} | Answered: ${r.by_status.answered} | Outbound: ${r.by_status.outbound}`,
        '',
        `## Urgency Breakdown`,
        `- High: ${r.by_urgency.high} | Medium: ${r.by_urgency.medium} | Low: ${r.by_urgency.low}`,
        '',
        `## Follow-Up Status`,
        `- **Pending follow-ups:** ${r.followups_pending}`,
        `- **High urgency overdue (>15 min):** ${r.high_urgency_overdue}`,
        '',
        `## Outcomes`,
        `- **Booked:** ${r.booked_count} ($${r.booked_revenue.toFixed(2)} revenue)`,
        `- **Lost:** ${r.lost_count}`,
        `- **Estimated missed revenue:** $${r.missed_revenue_estimate.toFixed(2)}`,
        '',
    ];

    if (r.top_categories.length > 0) {
        lines.push(`## Top Call Categories`);
        for (const c of r.top_categories) {
            lines.push(`- ${c.category}: ${c.count}`);
        }
        lines.push('');
    }

    if (r.top_coaching_notes.length > 0) {
        lines.push(`## Top Coaching Notes`);
        for (let i = 0; i < r.top_coaching_notes.length; i++) {
            lines.push(`${i + 1}. ${r.top_coaching_notes[i]}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}
