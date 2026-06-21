/**
 * Derive a human-friendly open/closed summary from a business's
 * `business_hours` jsonb + IANA timezone. Feeds the AI receptionist so it can
 * say "we're open until 7" or "we open at noon" instead of guessing.
 *
 * business_hours shape: { monday: { open: "10:00", close: "19:00", isOpen: true }, ... }
 */

export interface DayHours {
    open: string;   // "HH:mm"
    close: string;  // "HH:mm"
    isOpen: boolean;
}

export type BusinessHours = Record<string, DayHours>;

export interface HoursSummary {
    isOpenNow: boolean;
    /** e.g. "Open now until 7 PM" or "Closed now — opens today at 12 PM" */
    todayLine: string;
}

const DAY_ORDER = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** "19:00" -> "7 PM", "12:00" -> "12 PM", "09:30" -> "9:30 AM" */
export function to12Hour(hhmm: string): string {
    const [hStr, mStr] = hhmm.split(':');
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    if (Number.isNaN(h)) return hhmm;
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return m > 0 ? `${h12}:${mStr.padStart(2, '0')} ${period}` : `${h12} ${period}`;
}

/** Current weekday index (0=Sun) and "HH:mm" in the given timezone. */
function nowInTimezone(tz: string, now: Date): { dayIndex: number; hhmm: string } {
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' })
        .format(now)
        .toLowerCase();
    const dayIndex = DAY_ORDER.indexOf(weekday);
    const time = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
    }).format(now);
    // Intl can emit "24:05" at midnight in some runtimes — normalize to "00:05".
    const hhmm = time.replace(/^24:/, '00:');
    return { dayIndex: dayIndex < 0 ? 0 : dayIndex, hhmm };
}

/**
 * Summarize whether the shop is open right now and a natural one-liner about
 * today's / the next opening. Returns a neutral summary when hours are missing.
 */
export function summarizeHours(
    hours: BusinessHours | null | undefined,
    timezone: string | null | undefined,
    now: Date = new Date(),
): HoursSummary {
    const tz = timezone || 'America/New_York';
    if (!hours || typeof hours !== 'object') {
        return { isOpenNow: false, todayLine: '' };
    }

    const { dayIndex, hhmm } = nowInTimezone(tz, now);
    const todayName = DAY_ORDER[dayIndex];
    const today = hours[todayName];

    if (today?.isOpen && hhmm >= today.open && hhmm < today.close) {
        return { isOpenNow: true, todayLine: `Open now until ${to12Hour(today.close)}` };
    }

    // Closed now. If we open later today, say so.
    if (today?.isOpen && hhmm < today.open) {
        return { isOpenNow: false, todayLine: `Closed now — opens today at ${to12Hour(today.open)}` };
    }

    // Find the next open day within the coming week.
    for (let i = 1; i <= 7; i++) {
        const idx = (dayIndex + i) % 7;
        const name = DAY_ORDER[idx];
        const d = hours[name];
        if (d?.isOpen) {
            const label = i === 1 ? 'tomorrow' : capitalize(name);
            return { isOpenNow: false, todayLine: `Closed now — opens ${label} at ${to12Hour(d.open)}` };
        }
    }

    return { isOpenNow: false, todayLine: 'Currently closed' };
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
