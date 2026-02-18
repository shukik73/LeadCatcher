/**
 * URL validation for server-side fetches (SSRF prevention).
 *
 * Blocks private/internal IPs, localhost, non-HTTPS schemes,
 * and optionally enforces a hostname allowlist.
 */

const PRIVATE_IP_RANGES = [
  /^127\./,              // Loopback
  /^10\./,               // Class A private
  /^172\.(1[6-9]|2\d|3[01])\./, // Class B private
  /^192\.168\./,         // Class C private
  /^169\.254\./,         // Link-local
  /^0\./,                // "This" network
  /^::1$/,               // IPv6 loopback
  /^fc00:/i,             // IPv6 unique local
  /^fe80:/i,             // IPv6 link-local
];

const BLOCKED_HOSTNAMES = [
  'localhost',
  'metadata.google.internal',          // GCP metadata
  '169.254.169.254',                   // AWS/GCP/Azure metadata
  'metadata.google.internal.',
];

/** Allowed hostname patterns for RepairDesk URLs */
const REPAIRDESK_ALLOWED_PATTERNS = [
  /\.repairdesk\.co$/i,
  /^api\.repairdesk\.co$/i,
  /^repairdesk\.co$/i,
];

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
  url?: URL;
}

/**
 * Validate a URL for safe server-side fetching.
 *
 * - Must be HTTPS
 * - Must not resolve to private/internal IPs
 * - Must not target metadata endpoints
 * - For RepairDesk: must match *.repairdesk.co
 */
export function validateRepairDeskUrl(input: string): UrlValidationResult {
  // Must be a non-empty string
  if (!input || typeof input !== 'string') {
    return { valid: false, error: 'URL is required' };
  }

  // Parse the URL
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // Must be HTTPS
  if (url.protocol !== 'https:') {
    return { valid: false, error: 'Only HTTPS URLs are allowed' };
  }

  // Block non-standard ports
  if (url.port && url.port !== '443') {
    return { valid: false, error: 'Non-standard ports are not allowed' };
  }

  const hostname = url.hostname.toLowerCase();

  // Block known dangerous hostnames
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    return { valid: false, error: 'This hostname is not allowed' };
  }

  // Block IP-based hostnames (catches private ranges + direct IP access)
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    // Check against private IP ranges
    if (PRIVATE_IP_RANGES.some(re => re.test(hostname))) {
      return { valid: false, error: 'Private/internal IP addresses are not allowed' };
    }
    // Even public IPs are suspicious for RepairDesk — block all raw IPs
    return { valid: false, error: 'IP addresses are not allowed; use a domain name' };
  }

  // Block IPv6 addresses
  if (hostname.startsWith('[') || /^[0-9a-f:]+$/i.test(hostname)) {
    return { valid: false, error: 'IPv6 addresses are not allowed' };
  }

  // Enforce RepairDesk hostname allowlist
  const matchesAllowed = REPAIRDESK_ALLOWED_PATTERNS.some(re => re.test(hostname));
  if (!matchesAllowed) {
    return {
      valid: false,
      error: `Hostname "${hostname}" is not a recognized RepairDesk domain. Expected *.repairdesk.co`,
    };
  }

  return { valid: true, url };
}
