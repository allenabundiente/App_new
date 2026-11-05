/**
 * PayPal routes.
 *
 *   GET  /api/payments/paypal/quote?planId=...&type=...
 *   POST /api/payments/paypal/create-order   {planId, type}
 *   POST /api/payments/paypal/capture        {orderId}
 *   POST /api/payments/paypal/webhook        PayPal-signed events
 *
 * The app sends the plan and the payment type only. The amount is always
 * computed from the schedule on the server, and capture is idempotent.
 */
import {Router, type Request, type Response} from 'express';
import {currentUser, requireAuth} from '../auth';
import {toStr} from '../convert';
import {h} from './helpers';
import {paypalConfig} from '../config';
import {PaypalError} from '../services/paypal';
import {handlePaypalWebhook} from '../services/paypalWebhooks';
import {
  capturePaypalForBuyer,
  createPaypalOrderForBuyer,
  PaypalHttpError,
  parsePaypalType,
  quoteForBuyer,
} from '../services/paypalPayments';

/** Turns the service errors into the right HTTP response. */
function fail(res: Response, e: unknown): void {
  if (e instanceof PaypalHttpError) {
    res.status(e.status).json({error: e.message});
    return;
  }
  if (e instanceof PaypalError) {
    res.status(e.status).json({error: e.message});
    return;
  }
  throw e;
}

export function createPaypalRouter(): Router {
  const r = Router();

  // Public endpoint: PayPal does not send a buyer session. Every delivery is
  // verified against PayPal's signature before it can touch an order.
  r.post(
    '/payments/paypal/webhook',
    h(async (req, res) => {
      try {
        const result = await handlePaypalWebhook({
          headers: {
            transmissionId: toStr(req.header('paypal-transmission-id')),
            transmissionTime: toStr(req.header('paypal-transmission-time')),
            certUrl: toStr(req.header('paypal-cert-url')),
            authAlgo: toStr(req.header('paypal-auth-algo')),
            transmissionSig: toStr(req.header('paypal-transmission-sig')),
          },
          event: req.body,
        });
        res.json(result);
      } catch (e) {
        fail(res, e);
      }
    }),
  );

  r.get(
    '/payments/paypal/quote',
    requireAuth,
    h(async (req, res) => {
      try {
        const planId = toStr(req.query.planId);
        if (!planId) {
          throw new PaypalHttpError('planId is required.', 400);
        }
        const type = parsePaypalType(req.query.type);
        res.json(await quoteForBuyer(planId, type, currentUser(req)));
      } catch (e) {
        fail(res, e);
      }
    }),
  );

  r.post(
    '/payments/paypal/create-order',
    requireAuth,
    h(async (req, res) => {
      try {
        const planId = toStr(req.body?.planId);
        if (!planId) {
          throw new PaypalHttpError('planId is required.', 400);
        }
        const type = parsePaypalType(req.body?.type);
        const order = await createPaypalOrderForBuyer({
          planId,
          type,
          user: currentUser(req),
        });
        res.status(201).json(order);
      } catch (e) {
        fail(res, e);
      }
    }),
  );

  r.post(
    '/payments/paypal/capture',
    requireAuth,
    h(async (req, res) => {
      try {
        const result = await capturePaypalForBuyer({
          orderId: toStr(req.body?.orderId),
          user: currentUser(req),
        });
        if (result.status === 'pending') {
          res.status(202).json(result);
          return;
        }
        res.json(result);
      } catch (e) {
        fail(res, e);
      }
    }),
  );

  return r;
}

/* --------------------------- browser return pages ------------------------- */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)} — HulogTrack</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
         background:linear-gradient(135deg,#0b1020,#1b1440 55%,#0b1020); color:#f3f5ff; padding:24px; }
  .card { width:100%; max-width:420px; background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.18);
          border-radius:24px; padding:32px; text-align:center; box-shadow:0 18px 60px rgba(0,0,0,.45);
          backdrop-filter:blur(18px); }
  h1 { font-size:21px; margin:0 0 8px; }
  p { color:#b9c2e2; font-size:14px; line-height:1.5; margin:0 0 18px; }
  a.btn { display:inline-block; background:#8b7bff; color:#fff; text-decoration:none; font-weight:700;
          padding:14px 22px; border-radius:14px; }
  .fine { font-size:12px; color:#8792b5; margin-top:16px; }
</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;
}

/** PayPal sends the browser here after approval. */
export function paypalReturnPage(req: Request, res: Response): void {
  const raw = toStr(req.query.token) || toStr(req.query.orderId);
  const orderId = raw.replace(/[^A-Za-z0-9_-]/g, '');
  const deepLink = orderId
    ? `hulogtrack://paypal/return?orderId=${encodeURIComponent(orderId)}`
    : 'hulogtrack://paypal/return';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(
    page(
      'Payment approved',
      `<h1>Payment approved</h1>
       <p>Return to HulogTrack to finish recording your payment. No second charge is made — opening the app checks the same PayPal order.</p>
       <a class="btn" href="${escapeHtml(deepLink)}">Return to HulogTrack</a>
       <p class="fine">If the button does not open the app, switch back to HulogTrack manually and tap “I’ve approved — check payment”.</p>
       <script>setTimeout(function(){ location.href = ${JSON.stringify(deepLink)}; }, 700);</script>`,
    ),
  );
}

/** PayPal sends the browser here when the buyer cancels. */
export function paypalCancelPage(_req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(
    page(
      'Payment cancelled',
      `<h1>Payment cancelled</h1>
       <p>Nothing was charged. You can close this page and try again from HulogTrack whenever you are ready.</p>
       <a class="btn" href="hulogtrack://paypal/cancel">Return to HulogTrack</a>`,
    ),
  );
}

/** Convenience for diagnostics: does this server have PayPal configured? */
export function paypalSetupSummary(): {mode: string; currency: string; configured: boolean} {
  return {
    mode: paypalConfig.mode,
    currency: paypalConfig.currency,
    configured: Boolean(paypalConfig.clientId && paypalConfig.clientSecret),
  };
}
