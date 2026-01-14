/**
 * Common IANA Timezone Identifiers
 * Used for timezone selection in settings
 */

export const TIMEZONES = [
    { value: 'America/New_York', label: 'Eastern Time (ET)' },
    { value: 'America/Chicago', label: 'Central Time (CT)' },
    { value: 'America/Denver', label: 'Mountain Time (MT)' },
    { value: 'America/Phoenix', label: 'Mountain Time - Arizona (MST)' },
    { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
    { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
    { value: 'Pacific/Honolulu', label: 'Hawaii Time (HST)' },
    { value: 'America/Toronto', label: 'Eastern Time - Toronto' },
    { value: 'America/Vancouver', label: 'Pacific Time - Vancouver' },
    { value: 'America/Mexico_City', label: 'Central Time - Mexico City' },
    { value: 'Europe/London', label: 'London (GMT)' },
    { value: 'Europe/Paris', label: 'Paris (CET)' },
    { value: 'Europe/Berlin', label: 'Berlin (CET)' },
    { value: 'Europe/Rome', label: 'Rome (CET)' },
    { value: 'Europe/Madrid', label: 'Madrid (CET)' },
    { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
    { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
    { value: 'Asia/Hong_Kong', label: 'Hong Kong (HKT)' },
    { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
    { value: 'Asia/Dubai', label: 'Dubai (GST)' },
    { value: 'Australia/Sydney', label: 'Sydney (AEDT)' },
    { value: 'Australia/Melbourne', label: 'Melbourne (AEDT)' },
    { value: 'Pacific/Auckland', label: 'Auckland (NZDT)' },
] as const;

export type TimezoneValue = typeof TIMEZONES[number]['value'];

/**
 * Get timezone label by value
 */
export function getTimezoneLabel(value: string): string {
    const timezone = TIMEZONES.find(tz => tz.value === value);
    return timezone?.label || value;
}

/**
 * Validate if a timezone is valid
 */
export function isValidTimezone(value: string): boolean {
    return TIMEZONES.some(tz => tz.value === value);
}
