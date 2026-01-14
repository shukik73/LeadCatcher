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
  const url = process.env.TWILIO_WEBHOOK_URL || request.url; // In prod use env var to handle load balancers/ngrok

  // Parse form data
  const formData = await request.clone().formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    params[key] = value.toString();
  });

  return validateRequest(authToken, signature, url, params);
}
