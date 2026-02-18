export interface BusinessHours {
    [key: string]: {
        open: string;  // "09:00"
        close: string; // "17:00"
        isOpen: boolean;
    };
}

export function isBusinessHours(hours: BusinessHours | null, timezone: string): boolean {
    if (!hours) return true; // Default to always open if not configured

    try {
        // specific time in target timezone
        // e.g. "Monday, 14:30"
        const options: Intl.DateTimeFormatOptions = {
            timeZone: timezone,
            weekday: 'long',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        };

        // We need to parse this carefully or use parts
        const formatter = new Intl.DateTimeFormat('en-US', options);
        const parts = formatter.formatToParts(new Date());

        const dayName = parts.find(p => p.type === 'weekday')?.value.toLowerCase(); // "monday"
        const hour = parts.find(p => p.type === 'hour')?.value;
        const minute = parts.find(p => p.type === 'minute')?.value;

        if (!dayName || !hour || !minute) return true; // Fail open if parsing fails

        const currentTime = `${hour}:${minute}`;
        const todayHours = hours[dayName];

        if (!todayHours || !todayHours.isOpen) return false;

        return currentTime >= todayHours.open && currentTime <= todayHours.close;
    } catch (error) {
        void error; // Fail open — error already caught
        return true; // Fail open
    }
}

export function formatTemplate(template: string | null, variables: Record<string, string>): string {
    if (!template) {
        // Default fallback template
        return `Sorry we missed your call from ${variables.business_name}. How can we help you?`;
    }

    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] || '');
}
