import { validateRequest } from 'twilio';
import { headers } from 'next/headers';
import { logger } from '@/lib/logger';

export async function validateTwilioRequest(request: Request): Promise<boolean> {
  const headersList = await headers();
  const signature = headersList.get('x-twilio-signature');

  // If no signature, and we are not in strict production mode, maybe log warning? 
  // For now, fail safe.
  if (!signature) {
    logger.warn('Missing X-Twilio-Signature header');
    return false;
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN!;

  // Build validation URL: Twilio signs against the exact URL it posted to.
  // Using request.url directly can fail behind proxies/load balancers/ngrok.
  // TWILIO_WEBHOOK_URL takes precedence (explicit override for proxy setups),
  // then APP_BASE_URL, then falls back to request.url.
  let url: string;
  const baseUrl = process.env.TWILIO_WEBHOOK_URL || process.env.APP_BASE_URL;
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
