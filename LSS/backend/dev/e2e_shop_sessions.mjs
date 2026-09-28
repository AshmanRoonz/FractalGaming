// End-to-end test of sessions + match posting + the PayPal shop against a LOCAL Worker.
// Needs the two launch entries running: `lss-mocks` (8788) and `lss-backend-dev` (8787), with the
// schema applied to the local D1:
//   cd LSS/backend && wrangler d1 execute lss-stats --local --persist-to dev/.state --file=schema.sql
// Then:  node LSS/backend/dev/e2e_shop_sessions.mjs
// Everything here is local - fake Discord ids, a mock PayPal, a throwaway D1 - so it can be run as
// often as wanted. Products it creates are namespaced 'skin:e2e_*' and re-created each run.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 'http://localhost:8787';
const M = 'http://localhost:8788';
const ORIGIN = 'http://localhost:8099';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, '..');
const WRANGLER = process.env.WRANGLER_JS || 'C:/Users/ashro/AppData/Roaming/npm/node_modules/wrangler/bin/wrangler.js';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); }
}
async function call(method, p, { token, body, base = W, headers } = {}) {
  const h = { Origin: ORIGIN, ...(headers || {}) };
  if (token) h.Authorization = 'Bearer ' + token;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  let json = null; const text = await res.text();
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text };
}
function sql(command) {
  const out = execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'lss-stats', '--local', '--persist-to', 'dev/.state', '--json', '--command', command],
    { cwd: BACKEND, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}

const A = '900000000000000001', B = '900000000000000002';
const now = Date.now();

console.log('\n[health]');
let r = await call('GET', '/health');
check('health reports sessions + mock paypal', r.status === 200 && r.json.sessions === true && r.json.shop.paypal === true && r.json.shop.env === 'sandbox', r.json);

console.log('\n[sessions]');
r = await call('POST', '/auth/session', { token: 'dead' });
check('a dead Discord token cannot mint a session (401 invalid_token)', r.status === 401 && r.json.error === 'invalid_token', r.json);
r = await call('POST', '/auth/session', { token: 'dev_' + A });
const sessA = r.json && r.json.session;
check('a live Discord token mints an lss_ session', r.status === 200 && /^lss_[A-Za-z0-9_-]{40,}$/.test(sessA || '') && r.json.user.id === A, r.json);
check('session expiry is ~180 days out', r.json && r.json.expires_at > now + 179 * 864e5, r.json && r.json.expires_at);
r = await call('POST', '/auth/session', { token: sessA });
check('a session cannot mint another session (400)', r.status === 400, r.json);
r = await call('GET', '/me', { token: sessA });
check('GET /me with the session', r.status === 200 && r.json.user.id === A && Array.isArray(r.json.entitlements) && r.json.session && r.json.session.expires_at > now, r.json);
const dbSess = sql(`SELECT token_hash, discord_id FROM sessions WHERE discord_id = '${A}'`);
check('D1 stores only the SHA-256 of the token', dbSess.length >= 1 && dbSess.every(s => /^[0-9a-f]{64}$/.test(s.token_hash) && !String(s.token_hash).includes(sessA)), dbSess);
r = await call('GET', '/me', { token: 'lss_' + 'x'.repeat(43) });
check('an unknown session is 401 session_expired', r.status === 401 && r.json.error === 'session_expired', r.json);
r = await call('GET', '/me', { token: 'dev_' + A });
check('legacy raw Discord token still authenticates', r.status === 200 && r.json.user.id === A && r.json.session === null, r.json);

console.log('\n[match posting]');
const mid = 'solo_e2e_' + now;
const match = {
  match_id: mid, started_at: now - 300000, ended_at: now, map_key: 'hourglass', mode: 'classic',
  winning_team: 2, duration_sec: 300, networked: false,
  participants: [
    { discord_id: A, team: 2, loadout_key: 'VORTEX', kills: 9, deaths: 1, damage_dealt: 123456, damage_taken: 2000, is_mvp: 1, is_winner: 1, score: 4 },
    { discord_id: 'bot:PYRO:0', team: 3, loadout_key: 'PYRO', kills: 1, deaths: 4, damage_dealt: 5000, damage_taken: 9000, is_mvp: 0, is_winner: 0, score: 1 },
  ],
};
r = await call('POST', '/match', { token: sessA, body: match });
check('POST /match with a session', r.status === 200 && r.json.ok, r.json);
let row = sql(`SELECT validated, mode, game_mode FROM matches WHERE id = '${mid}'`)[0];
check('the solo match validated immediately', row && row.validated === 1 && row.game_mode === 'classic', row);
let pl = sql(`SELECT total_matches, total_wins, total_kills FROM players WHERE discord_id = '${A}'`)[0];
check('career totals rolled up', pl && pl.total_matches >= 1 && pl.total_wins >= 1 && pl.total_kills >= 9, pl);
r = await call('POST', '/match', { token: 'dead', body: { ...match, match_id: mid + '_x' } });
check('a dead legacy token is 401 (client holds the match)', r.status === 401, r.json);

console.log('\n[shop setup]');
sql(`DELETE FROM entitlements WHERE sku LIKE 'skin:e2e%'`);
sql(`DELETE FROM purchases WHERE sku LIKE 'skin:e2e%'`);
sql(`DELETE FROM products WHERE sku LIKE 'skin:e2e%'`);
sql(`INSERT INTO products (sku, kind, title, price_cents, currency, active, grants_json, sort, created_at, updated_at) VALUES
  ('skin:e2e_diamond', 'skin', 'E2E DIAMOND', 299, 'USD', 1, '[]', 1, ${now}, ${now}),
  ('skin:e2e_pending', 'skin', 'E2E PENDING', 199, 'USD', 1, '[]', 2, ${now}, ${now}),
  ('skin:e2e_tamper',  'skin', 'E2E TAMPER',  499, 'USD', 1, '[]', 3, ${now}, ${now}),
  ('skin:e2e_bundle',  'bundle', 'E2E BUNDLE', 599, 'USD', 1, '["skin:e2e_b1","skin:e2e_b2"]', 4, ${now}, ${now}),
  ('skin:e2e_retired', 'skin', 'E2E RETIRED', 299, 'USD', 0, '[]', 5, ${now}, ${now})`);
r = await call('GET', '/shop/catalog');
const cat = r.json && r.json.products || [];
check('catalog lists products incl. retired, with on_sale flags', r.status === 200 && cat.some(p => p.sku === 'skin:e2e_retired' && p.on_sale === false) && cat.some(p => p.sku === 'skin:e2e_diamond' && p.on_sale && p.price_cents === 299), cat);
check('catalog expands bundle grants', cat.some(p => p.sku === 'skin:e2e_bundle' && p.grants.includes('skin:e2e_b1') && p.grants.includes('skin:e2e_b2') && p.grants.includes('skin:e2e_bundle')), cat.find(p => p.sku === 'skin:e2e_bundle'));

console.log('\n[purchase: happy path]');
r = await call('POST', '/shop/paypal/create', { token: sessA, body: { sku: 'skin:e2e_diamond', origin: ORIGIN, price_cents: 1 } });
const ord1 = r.json && r.json.order_id;
check('create order -> approve_url on the mock', r.status === 200 && /\/checkoutnow\?token=/.test(r.json.approve_url || ''), r.json);
let mo = (await call('GET', '/mock/orders', { base: M })).json.find(o => o.id === ord1);
check('price came from D1, not the request body (2.99 not 0.01)', mo && mo.purchase_units[0].amount.value === '2.99', mo && mo.purchase_units[0].amount);
check('custom_id = buyer, invoice_id = our purchase id', mo && mo.purchase_units[0].custom_id === A && /^pur_/.test(mo.purchase_units[0].invoice_id), mo && mo.purchase_units[0]);
r = await call('POST', '/shop/paypal/capture', { token: sessA, body: { order_id: ord1 } });
check('capture before approval -> still created, nothing granted', r.status === 200 && r.json.status === 'created' && !r.json.entitlements.includes('skin:e2e_diamond'), r.json);
r = await call('POST', '/shop/paypal/capture', { token: 'dev_' + B, body: { order_id: ord1 } });
check("another account cannot capture someone else's order (403)", r.status === 403, r.json);
await call('POST', '/mock/approve/' + ord1, { base: M });
r = await call('POST', '/shop/paypal/capture', { token: sessA, body: { order_id: ord1 } });
check('approved -> captured -> completed + entitled', r.status === 200 && r.json.status === 'completed' && r.json.entitlements.includes('skin:e2e_diamond'), r.json);
r = await call('POST', '/shop/paypal/capture', { token: sessA, body: { order_id: ord1 } });
check('capture is idempotent', r.status === 200 && r.json.status === 'completed', r.json);
let pur1 = sql(`SELECT status, provider_capture, amount_cents FROM purchases WHERE provider_order = '${ord1}'`)[0];
check('purchase row completed with capture id', pur1 && pur1.status === 'completed' && /^CAP/.test(pur1.provider_capture || ''), pur1);
r = await call('POST', '/shop/paypal/create', { token: sessA, body: { sku: 'skin:e2e_diamond' } });
check('buying an owned sku is refused (409 already_owned)', r.status === 409 && r.json.error === 'already_owned', r.json);
r = await call('POST', '/shop/paypal/create', { token: sessA, body: { sku: 'skin:e2e_retired' } });
check('a retired product cannot be bought (404)', r.status === 404, r.json);
r = await call('POST', '/shop/paypal/create', { token: sessA, body: { sku: "skin:x'; DROP TABLE players;--" } });
check('a hostile sku is rejected (400 bad_sku)', r.status === 400, r.json);
r = await call('GET', '/me', { token: sessA });
check('/me lists the entitlement', r.json.entitlements.includes('skin:e2e_diamond'), r.json);

console.log('\n[purchase: bundle]');
r = await call('POST', '/shop/paypal/create', { token: sessA, body: { sku: 'skin:e2e_bundle' } });
const ordB = r.json && r.json.order_id;
await call('POST', '/mock/approve/' + ordB, { base: M });
r = await call('POST', '/shop/paypal/capture', { token: sessA, body: { order_id: ordB } });
check('a bundle grants every sku it lists', r.json && r.json.status === 'completed' && ['skin:e2e_bundle', 'skin:e2e_b1', 'skin:e2e_b2'].every(s => r.json.entitlements.includes(s)), r.json);

console.log('\n[purchase: pending + tampered amount]');
r = await call('POST', '/shop/paypal/create', { token: sessA, body: { sku: 'skin:e2e_pending' } });
const ordP = r.json.order_id;
await call('POST', '/mock/approve/' + ordP, { base: M });
await call('POST', '/mock/capture-status', { base: M, body: { status: 'PENDING' } });
r = await call('POST', '/shop/paypal/capture', { token: sessA, body: { order_id: ordP } });
check('a PENDING capture grants nothing yet', r.json.status === 'pending' && !r.json.entitlements.includes('skin:e2e_pending'), r.json);
r = await call('POST', '/shop/paypal/create', { token: sessA, body: { sku: 'skin:e2e_tamper' } });
const ordT = r.json.order_id;
await call('POST', '/mock/approve/' + ordT, { base: M });
await call('POST', '/mock/amount/' + ordT, { base: M, body: { value: '0.01' } });
r = await call('POST', '/shop/paypal/capture', { token: sessA, body: { order_id: ordT } });
check('a capture for the wrong amount goes to review, not granted', r.json.status === 'review' && !r.json.entitlements.includes('skin:e2e_tamper'), r.json);

console.log('\n[webhook]');
const capId = pur1.provider_capture;
const refundEvent = JSON.stringify({ id: 'WH-1', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: {
  id: 'REF1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '2.99' },
  links: [{ rel: 'up', href: M + '/paypal/v2/payments/captures/' + capId, method: 'GET' }] } });
r = await call('POST', '/shop/paypal/webhook', { body: refundEvent, headers: { 'paypal-transmission-sig': 'forged', 'paypal-transmission-id': 't1', 'paypal-transmission-time': new Date().toISOString(), 'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-auth-algo': 'SHA256withRSA' } });
check('a webhook with a bad signature is rejected (400)', r.status === 400, r.json);
r = await call('GET', '/me', { token: sessA });
check('...and changed nothing', r.json.entitlements.includes('skin:e2e_diamond'), r.json);
r = await call('POST', '/shop/paypal/webhook', { body: refundEvent, headers: { 'paypal-transmission-sig': 'good', 'paypal-transmission-id': 't2', 'paypal-transmission-time': new Date().toISOString(), 'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-auth-algo': 'SHA256withRSA' } });
check('a verified full refund is handled', r.status === 200 && r.json.handled === true, r.json);
r = await call('GET', '/me', { token: sessA });
check('...and revokes exactly that livery', !r.json.entitlements.includes('skin:e2e_diamond') && r.json.entitlements.includes('skin:e2e_b1'), r.json);
pur1 = sql(`SELECT status FROM purchases WHERE provider_order = '${ord1}'`)[0];
check('purchase marked refunded', pur1 && pur1.status === 'refunded', pur1);

console.log('\n[cron reconcile: approved on PayPal, buyer never came back]');
sql(`DELETE FROM entitlements WHERE discord_id = '${B}'`);
const sessB = (await call('POST', '/auth/session', { token: 'dev_' + B })).json.session;
r = await call('POST', '/shop/paypal/create', { token: sessB, body: { sku: 'skin:e2e_diamond' } });
const ordC = r.json.order_id;
await call('POST', '/mock/approve/' + ordC, { base: M });
sql(`UPDATE purchases SET updated_at = updated_at - 600000 WHERE provider_order = '${ordC}'`);   // age past the reconcile gap
r = await fetch(W + '/__scheduled?cron=*/5+*+*+*+*');
await new Promise(res => setTimeout(res, 2500));
const purC = sql(`SELECT status FROM purchases WHERE provider_order = '${ordC}'`)[0];
check('the sweep captured and granted it', purC && purC.status === 'completed', purC);
r = await call('GET', '/me', { token: sessB });
check('...so the buyer owns it', r.json.entitlements.includes('skin:e2e_diamond'), r.json);

console.log('\n[admin + logout]');
r = await call('GET', '/admin/audit', { token: 'dev-admin-key' });
check('admin audit with the right key', r.status === 200 && typeof r.json.pending === 'number', r.json);
r = await call('GET', '/admin/audit', { token: 'dev-admin-kez' });
check('admin audit with a wrong key looks like a 404', r.status === 404, r.json);
r = await call('POST', '/auth/logout', { token: sessA });
check('logout', r.status === 200, r.json);
r = await call('GET', '/me', { token: sessA });
check('the session is dead after logout', r.status === 401 && r.json.error === 'session_expired', r.json);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
