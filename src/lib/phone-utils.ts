/**
 * Phone Number Utilities
 * 
 * Normalizes and validates phone numbers for consistent storage
 * and Twilio API usage.
 */

/**
 * Normalizes a phone number to E.164 format (+1XXXXXXXXXX)
 * 
 * @param phone - Phone number in any format
 * @returns Normalized phone number in E.164 format
 * @throws Error if phone number is invalid
 */
export function normalizePhoneNumber(phone: string): string {
  if (!phone) {
    throw new Error('Phone number is required');
  }

  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');

  // Validate US phone numbers
  // 10 digits: local number
  // 11 digits starting with 1: country code + local number
  if (digits.length === 11 && digits[0] === '1') {
    return `+1${digits.slice(1)}`;
  } else if (digits.length === 10) {
    return `+1${digits}`;
  }

  // If already in E.164 format, validate and return
  if (phone.startsWith('+1') && digits.length === 11) {
    return phone;
  }

  throw new Error(`Invalid phone number format: ${phone}. Expected 10 or 11 digits.`);
}

/**
 * Formats a phone number for display
 * 
 * @param phone - Phone number in E.164 format
 * @returns Formatted phone number (e.g., "(305) 555-0100")
 */
export function formatPhoneNumber(phone: string): string {
  let normalized;
  try {
    normalized = normalizePhoneNumber(phone);
  } catch {
    return phone;
  }
  const digits = normalized.replace(/\D/g, '');

  if (digits.length === 11 && digits[0] === '1') {
    const areaCode = digits.slice(1, 4);
    const exchange = digits.slice(4, 7);
    const number = digits.slice(7);
    return `(${areaCode}) ${exchange}-${number}`;
  }

  return phone;
}

/**
 * Validates if a phone number is in a valid format
 * 
 * @param phone - Phone number to validate
 * @returns true if valid, false otherwise
 */
export function isValidPhoneNumber(phone: string): boolean {
  try {
    normalizePhoneNumber(phone);
    return true;
  } catch {
    return false;
  }
}
