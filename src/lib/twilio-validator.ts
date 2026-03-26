import { validateRequest } from 'twilio';
import { headers } from 'next/headers';
import { getWebhookBaseUrl } from '@/lib/webhook-url';
import { logger } from '@/lib/logger';

export async function validateTwilioRequest(request: Request): Promise<boolean> {
  const headersList = await headers();
  const signature = headersList.get('x-twilio-signature');

  if (!signature) {
    logger.warn('Missing X-Twilio-Signature header');
    return false;
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN!;

  // Build validation URL: Twilio signs against the exact URL it posted to.
  // Use the same canonical base URL used for callback generation so they always match.
  // TWILIO_WEBHOOK_URL takes precedence (explicit override for proxy setups).
  let url: string;
  const overrideUrl = process.env.TWILIO_WEBHOOK_URL;
  const baseUrl = overrideUrl || getWebhookBaseUrl();
  if (baseUrl) {
    const requestUrl = new URL(request.url);
    url = `${baseUrl.replace(/\/$/, '')}${requestUrl.pathname}${requestUrl.search}`;
  } else {
    url = request.url;
  }

  // Parse form data
  const formData = await request.clone().formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    params[key] = value.toString();
  });

  return validateRequest(authToken, signature, url, params);
}
