// LSS backend - LOCAL MOCKS of Discord and PayPal, for exercising the Worker under `wrangler dev`.
//
// Why this exists: the session flow needs a Discord token that verifies, and the shop needs a
// PayPal that creates, approves and captures orders. Neither can be driven for real from a dev
// machine without real accounts and real money, so the Worker is pointed here instead - but ONLY
// when it runs with DEV_MOCKS=1 (see _discordApi / _paypalBase in src/worker.js; see dev/mock.env).
//
//   node LSS/backend/dev/mock_services.mjs          (or the `lss-mocks` entry in .claude/launch.json)
//
// DISCORD   GET  /discord/users/@me          Bearer dev_<discord id>  -> that user.  Anything else -> 401
//                                            (so 'dead' plays an expired Discord token).
// PAYPAL    POST /paypal/v1/oauth2/token
//           POST /paypal/v2/checkout/orders
//           GET  /paypal/v2/checkout/orders/:id
//           POST /paypal/v2/checkout/orders/:id/capture
//           POST /paypal/v1/notifications/verify-webhook-signature   (transmission_sig 'good' passes)
//           GET  /checkoutnow?token=:id        a clickable fake approval page -> return_url / cancel_url
// KNOBS     POST /mock/capture-status {status}   next capture answers COMPLETED | PENDING | DECLINED
//           POST /mock/approve/:id               approve without the browser page
//           POST /mock/amount/:id {value}        tamper with the captured amount (mismatch test)
//           GET  /mock/orders                    everything this process has seen
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.env.PORT || 8788);
const orders = new Map();          // id -> order
const byRequestId = new Map();     // PayPal-Request-Id -> order id (create idempotency)
const captureReplies = new Map();  // capture PayPal-Request-Id -> response json (capture idempotency)
let nextCaptureStatus = 'COMPLETED';
const amountOverride = new Map();  // order id -> captured value override

const rid = (n) => randomBytes(n).toString('hex').toUpperCase();

function send(res, status, body, headers) {
  const isStr = typeof body === 'string';
  res.writeHead(status, {
    'Content-Type': isStr ? 'text/html; charset=utf-8' : 'application/json',
    'Access-Control-Allow-Origin': '*',
    ...(headers || {}),
  });
  res.end(isStr ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; });
    req.on('end', () => resolve(s));
  });
}
function publicOrder(o) {
  const base = `http://localhost:${PORT}`;
  const links = [{ rel: 'self', href: `${base}/paypal/v2/checkout/orders/${o.id}`, method: 'GET' }];
  if (o.status === 'PAYER_ACTION_REQUIRED') links.push({ rel: 'payer-action', href: `${base}/checkoutnow?token=${o.id}`, method: 'GET' });
  if (o.status === 'APPROVED') links.push({ rel: 'capture', href: `${base}/paypal/v2/checkout/orders/${o.id}/capture`, method: 'POST' });
  return { id: o.id, intent: 'CAPTURE', status: o.status, purchase_units: o.purchase_units, links, create_time: o.create_time };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  const raw = (req.method === 'POST' || req.method === 'PUT') ? await readBody(req) : '';
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch (_) {}
  const log = (...a) => console.log(new Date().toISOString().slice(11, 19), req.method, p, ...a);

  if (req.method === 'OPTIONS') return send(res, 204, '');

  // ---------------- Discord ----------------
  if (req.method === 'GET' && p === '/discord/users/@me') {
    const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/, '');
    const m = tok.match(/^dev_(\d{5,25})$/);
    if (!m) { log('-> 401 (token ' + tok.slice(0, 12) + ')'); return send(res, 401, { message: '401: Unauthorized', code: 0 }); }
    const id = m[1];
    log('-> user ' + id);
    return send(res, 200, { id, username: 'devpilot' + id.slice(-4), global_name: 'Dev Pilot ' + id.slice(-4), avatar: null, discriminator: '0' });
  }

  // ---------------- PayPal ----------------
  if (req.method === 'POST' && p === '/paypal/v1/oauth2/token') {
    if (!String(req.headers.authorization || '').startsWith('Basic ')) return send(res, 401, { error: 'invalid_client' });
    log('-> token');
    return send(res, 200, { access_token: 'MOCK-' + rid(8), token_type: 'Bearer', expires_in: 32400 });
  }
  if (p.startsWith('/paypal/') && !String(req.headers.authorization || '').startsWith('Bearer MOCK-')) {
    return send(res, 401, { name: 'AUTHENTICATION_FAILURE' });
  }
  if (req.method === 'POST' && p === '/paypal/v2/checkout/orders') {
    const reqId = req.headers['paypal-request-id'];
    if (reqId && byRequestId.has(reqId)) { log('-> replay ' + byRequestId.get(reqId)); return send(res, 200, publicOrder(orders.get(byRequestId.get(reqId)))); }
    const pu = body && body.purchase_units && body.purchase_units[0];
    const ctx = body && body.payment_source && body.payment_source.paypal && body.payment_source.paypal.experience_context;
    if (!pu || !pu.amount || !ctx || !ctx.return_url) return send(res, 400, { name: 'INVALID_REQUEST', details: [{ issue: 'MISSING_REQUIRED_PARAMETER' }] });
    const o = {
      id: 'MOCK' + rid(7), status: 'PAYER_ACTION_REQUIRED', create_time: new Date().toISOString(),
      purchase_units: [{ reference_id: pu.reference_id, custom_id: pu.custom_id, invoice_id: pu.invoice_id, description: pu.description, amount: pu.amount }],
      return_url: ctx.return_url, cancel_url: ctx.cancel_url,
    };
    orders.set(o.id, o);
    if (reqId) byRequestId.set(reqId, o.id);
    log('-> created ' + o.id + ' ' + pu.amount.value + ' ' + pu.amount.currency_code + ' for ' + pu.custom_id + ' (' + pu.reference_id + ')');
    return send(res, 201, publicOrder(o));
  }
  let m = p.match(/^\/paypal\/v2\/checkout\/orders\/([A-Z0-9]+)(\/capture)?$/);
  if (m) {
    const o = orders.get(m[1]);
    if (!o) return send(res, 404, { name: 'RESOURCE_NOT_FOUND', details: [{ issue: 'INVALID_RESOURCE_ID' }] });
    if (req.method === 'GET' && !m[2]) { log('-> ' + o.status); return send(res, 200, publicOrder(o)); }
    if (req.method === 'POST' && m[2]) {
      const reqId = req.headers['paypal-request-id'];
      if (reqId && captureReplies.has(reqId)) { log('-> capture replay'); return send(res, 201, captureReplies.get(reqId)); }
      if (o.status === 'COMPLETED') return send(res, 422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] });
      if (o.status !== 'APPROVED') return send(res, 422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED' }] });
      const pu = o.purchase_units[0];
      const amount = { ...pu.amount };
      delete amount.breakdown;
      if (amountOverride.has(o.id)) amount.value = amountOverride.get(o.id);
      o.status = 'COMPLETED';
      pu.payments = { captures: [{ id: 'CAP' + rid(7), status: nextCaptureStatus, amount, custom_id: pu.custom_id, invoice_id: pu.invoice_id, final_capture: true }] };
      nextCaptureStatus = 'COMPLETED';
      const reply = publicOrder(o);
      if (reqId) captureReplies.set(reqId, reply);
      log('-> captured ' + o.id + ' ' + pu.payments.captures[0].status);
      return send(res, 201, reply);
    }
  }
  if (req.method === 'POST' && p === '/paypal/v1/notifications/verify-webhook-signature') {
    const ok = body && body.transmission_sig === 'good' && body.webhook_id && body.webhook_event;
    log('-> webhook verify ' + (ok ? 'SUCCESS' : 'FAILURE'));
    return send(res, 200, { verification_status: ok ? 'SUCCESS' : 'FAILURE' });
  }

  // ---------------- The fake approval page ----------------
  if (req.method === 'GET' && (p === '/checkoutnow' || p === '/checkoutnow/approve' || p === '/checkoutnow/cancel')) {
    const o = orders.get(url.searchParams.get('token') || '');
    if (!o) return send(res, 404, '<h1>no such order</h1>');
    if (p === '/checkoutnow/approve') {
      if (o.status === 'PAYER_ACTION_REQUIRED') o.status = 'APPROVED';
      log('-> approved ' + o.id);
      const u = new URL(o.return_url); u.searchParams.set('token', o.id); u.searchParams.set('PayerID', 'MOCKPAYER');
      return send(res, 302, '', { Location: u.toString() });
    }
    if (p === '/checkoutnow/cancel') {
      const u = new URL(o.cancel_url); u.searchParams.set('token', o.id);
      return send(res, 302, '', { Location: u.toString() });
    }
    const pu = o.purchase_units[0];
    return send(res, 200, `<!doctype html><meta charset="utf-8"><title>Mock PayPal</title>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <body style="font:15px system-ui;background:#f5f7fa;color:#1a1a2e;display:grid;place-items:center;min-height:100vh;margin:0">
      <div style="background:#fff;padding:28px 32px;border-radius:12px;box-shadow:0 4px 24px #0002;max-width:360px;text-align:center">
        <div style="font:700 22px system-ui;color:#003087">Pay<span style="color:#009cde">Pal</span> <small style="color:#c00">MOCK</small></div>
        <p>${pu.description || pu.reference_id}</p>
        <p style="font-size:28px;font-weight:700;margin:6px 0 18px">$${pu.amount.value} ${pu.amount.currency_code}</p>
        <a id="mock-pay" href="/checkoutnow/approve?token=${o.id}" style="display:block;background:#ffc439;color:#111;padding:12px;border-radius:22px;text-decoration:none;font-weight:700">Pay Now</a>
        <a id="mock-cancel" href="/checkoutnow/cancel?token=${o.id}" style="display:block;margin-top:12px;color:#555">Cancel and return</a>
        <p style="font-size:11px;color:#888;margin-top:18px">order ${o.id} · no money moves · dev mock</p>
      </div></body>`);
  }

  // ---------------- Knobs ----------------
  if (req.method === 'POST' && p === '/mock/capture-status') { nextCaptureStatus = String((body && body.status) || 'COMPLETED'); log('-> next ' + nextCaptureStatus); return send(res, 200, { ok: true, next: nextCaptureStatus }); }
  m = p.match(/^\/mock\/approve\/([A-Z0-9]+)$/);
  if (req.method === 'POST' && m) { const o = orders.get(m[1]); if (!o) return send(res, 404, { error: 'no order' }); if (o.status === 'PAYER_ACTION_REQUIRED') o.status = 'APPROVED'; log('-> approved ' + o.id); return send(res, 200, publicOrder(o)); }
  m = p.match(/^\/mock\/amount\/([A-Z0-9]+)$/);
  if (req.method === 'POST' && m) { amountOverride.set(m[1], String(body && body.value)); return send(res, 200, { ok: true }); }
  if (req.method === 'GET' && p === '/mock/orders') return send(res, 200, [...orders.values()].map(publicOrder));

  log('-> 404');
  return send(res, 404, { error: 'mock: no route', path: p });
});

server.listen(PORT, () => console.log(`[lss-mocks] Discord + PayPal mocks on http://localhost:${PORT}`));
