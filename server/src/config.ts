/**
 * Server configuration, read from the environment in one place.
 *
 * The PayPal keys live in the repo-root `.env` (see `.env.example`) so there
 * is only one file to edit. `server/.env` is still read for the database and
 * other server settings; values that are already set (for example by Render)
 * always win.
 *
 * Nothing in this module is ever sent to the app: the client id and secret
 * stay on the server, and the app only receives an order id / approval URL.
 */
import {config as loadEnv} from 'dotenv';
import {join} from 'node:path';

// __dirname is server/src in dev and server/dist when compiled, so `../..`
// points at the repo root in both cases.
loadEnv({path: join(__dirname, '..', '..', '.env')});
// server/.env (cwd) for DATABASE_URL and the other server settings. dotenv
// does not override values that are already present.
loadEnv();

const trimmed = (value: string | undefined): string => (value ?? '').trim();

const mode = trimmed(process.env.PAYPAL_MODE).toLowerCase() === 'live' ? 'live' : 'sandbox';

/** Public base URL of this API, without a trailing slash. */
const appBaseUrl = (
  trimmed(process.env.APP_BASE_URL) ||
  // Render sets this automatically, so a deploy works before anyone fills
  // in APP_BASE_URL.
  trimmed(process.env.RENDER_EXTERNAL_URL) ||
  `http://localhost:${trimmed(process.env.PORT) || '4000'}`
).replace(/\/+$/, '');

export const paypalConfig = {
  clientId: trimmed(process.env.PAYPAL_CLIENT_ID),
  clientSecret: trimmed(process.env.PAYPAL_CLIENT_SECRET),
  /**
   * The webhook id from the PayPal app's Webhooks page. It is not a secret,
   * but it must match or PayPal's signature check will fail.
   */
  webhookId: trimmed(process.env.PAYPAL_WEBHOOK_ID),
  mode,
  currency: (trimmed(process.env.PAYPAL_CURRENCY) || 'PHP').toUpperCase(),
  returnUrl: trimmed(process.env.PAYPAL_RETURN_URL) || `${appBaseUrl}/paypal/return`,
  cancelUrl: trimmed(process.env.PAYPAL_CANCEL_URL) || `${appBaseUrl}/paypal/cancel`,
  /** REST base URL for the selected mode. */
  apiBase: mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com',
} as const;

/** True when both PayPal credentials are present. */
export function isPaypalConfigured(): boolean {
  return Boolean(paypalConfig.clientId && paypalConfig.clientSecret);
}

/** True when the webhook endpoint can verify PayPal signatures. */
export function isPaypalWebhookConfigured(): boolean {
  return isPaypalConfigured() && Boolean(paypalConfig.webhookId);
}
