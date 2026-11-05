/**
 * A small client for the PayPal Orders v2 REST API.
 *
 * Only the server calls this file. It gets an OAuth access token with the
 * client id/secret, then creates and captures orders. The app never sees the
 * secret and never tells us the amount — that comes from the plan record.
 */
import {paypalConfig} from '../config';

export class PaypalError extends Error {
  constructor(
    message: string,
    /** HTTP status the API route should answer with. */
    public status = 502,
    /** PayPal's machine-readable error name, e.g. ORDER_NOT_APPROVED. */
    public code = '',
  ) {
    super(message);
  }
}

let cachedToken: {value: string; expiresAt: number} | null = null;

/** Gets (and briefly caches) an OAuth token for the REST API. */
async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }
  const auth = Buffer.from(
    `${paypalConfig.clientId}:${paypalConfig.clientSecret}`,
    'utf8',
  ).toString('base64');

  let res: Response;
  try {
    res = await fetch(`${paypalConfig.apiBase}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
  } catch {
    throw new PaypalError('Could not reach PayPal. Check the server network and try again.', 502);
  }

  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new PaypalError(
      body.error_description ||
        'PayPal rejected the server credentials. Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.',
      502,
      'AUTH_FAILED',
    );
  }
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 300) * 1000,
  };
  return cachedToken.value;
}

async function paypalRequest<T>(
  path: string,
  init: {method: string; body?: unknown},
): Promise<T> {
  const token = await accessToken();
  let res: Response;
  try {
    res = await fetch(`${paypalConfig.apiBase}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new PaypalError('Could not reach PayPal. Check the server network and try again.', 502);
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!res.ok) {
    const err = body as {name?: string; message?: string; details?: Array<{description?: string}>} | null;
    const detail = err?.details?.[0]?.description;
    throw new PaypalError(
      detail || err?.message || `PayPal request failed (${res.status}).`,
      res.status === 401 ? 502 : 422,
      err?.name ?? '',
    );
  }
  return body as T;
}

/* --------------------------------- types --------------------------------- */

export interface PaypalOrder {
  id: string;
  status: string;
  links?: Array<{rel: string; href: string; method?: string}>;
}

export interface PaypalCapture {
  orderId: string;
  orderStatus: string;
  captureId: string;
  captureStatus: string;
  amount: number;
  currency: string;
}

export interface PaypalWebhookHeaders {
  transmissionId: string;
  transmissionTime: string;
  certUrl: string;
  authAlgo: string;
  transmissionSig: string;
}

/* -------------------------------- requests ------------------------------- */

/** Creates an order and returns its id plus the buyer approval URL. */
export async function createPaypalOrder(input: {
  amount: number;
  currency: string;
  description: string;
  customId: string;
}): Promise<{orderId: string; approvalUrl: string}> {
  const order = await paypalRequest<PaypalOrder>('/v2/checkout/orders', {
    method: 'POST',
    body: {
      intent: 'CAPTURE',
      purchase_units: [
        {
          custom_id: input.customId,
          description: input.description.slice(0, 127),
          amount: {
            currency_code: input.currency,
            value: input.amount.toFixed(2),
          },
        },
      ],
      application_context: {
        brand_name: 'HulogTrack',
        landing_page: 'LOGIN',
        user_action: 'PAY_NOW',
        return_url: paypalConfig.returnUrl,
        cancel_url: paypalConfig.cancelUrl,
      },
    },
  });

  const approvalUrl = order.links?.find(link => link.rel === 'approve')?.href;
  if (!approvalUrl) {
    throw new PaypalError('PayPal did not return an approval link. Try again.', 502);
  }
  return {orderId: order.id, approvalUrl};
}

/** Captures an order the buyer has approved. */
export async function capturePaypalOrder(orderId: string): Promise<PaypalCapture> {
  const order = await paypalRequest<{
    id: string;
    status: string;
    purchase_units?: Array<{
      payments?: {
        captures?: Array<{
          id: string;
          status: string;
          amount?: {value?: string; currency_code?: string};
        }>;
      };
    }>;
  }>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    body: {},
  });

  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    orderId: order.id ?? orderId,
    orderStatus: order.status ?? '',
    captureId: capture?.id ?? '',
    captureStatus: capture?.status ?? order.status ?? '',
    amount: Number(capture?.amount?.value ?? 0),
    currency: capture?.amount?.currency_code ?? paypalConfig.currency,
  };
}

/** Reads an order's current state, used to recover from a repeated capture. */
export async function getPaypalOrder(orderId: string): Promise<{
  orderId: string;
  orderStatus: string;
  captureId: string;
  captureStatus: string;
  amount: number;
  currency: string;
}> {
  const order = await paypalRequest<{
    id: string;
    status: string;
    purchase_units?: Array<{
      payments?: {
        captures?: Array<{
          id: string;
          status: string;
          amount?: {value?: string; currency_code?: string};
        }>;
      };
    }>;
  }>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, {method: 'GET'});

  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    orderId: order.id ?? orderId,
    orderStatus: order.status ?? '',
    captureId: capture?.id ?? '',
    captureStatus: capture?.status ?? order.status ?? '',
    amount: Number(capture?.amount?.value ?? 0),
    currency: capture?.amount?.currency_code ?? paypalConfig.currency,
  };
}

/**
 * Asks PayPal to verify a webhook delivery's signature. PayPal signs the
 * transmission headers with its certificate; the API compares that signature
 * with the configured webhook id. Never process a webhook before this says
 * SUCCESS.
 */
export async function verifyPaypalWebhook(input: {
  headers: PaypalWebhookHeaders;
  event: unknown;
}): Promise<boolean> {
  if (!paypalConfig.webhookId) {
    throw new PaypalError(
      'PayPal webhooks are not configured. Add PAYPAL_WEBHOOK_ID to the repo-root .env and restart the API.',
      503,
      'WEBHOOK_NOT_CONFIGURED',
    );
  }

  const result = await paypalRequest<{verification_status?: string}>(
    '/v1/notifications/verify-webhook-signature',
    {
      method: 'POST',
      body: {
        auth_algo: input.headers.authAlgo,
        cert_url: input.headers.certUrl,
        transmission_id: input.headers.transmissionId,
        transmission_sig: input.headers.transmissionSig,
        transmission_time: input.headers.transmissionTime,
        webhook_id: paypalConfig.webhookId,
        webhook_event: input.event,
      },
    },
  );
  return result.verification_status === 'SUCCESS';
}
