# LSS Backend

Cloudflare Worker + D1 + KV. Implements the API behind lss.fractalreality.ca's stats pages, the in-game match-result posting, and the lobby browser.

See `../LSS_backend-plan.md` for the full architecture rationale.

## Layout

- `wrangler.toml`     ; Worker config + D1/KV bindings
- `schema.sql`        ; D1 schema migration (idempotent)
- `src/worker.js`     ; the Worker itself (one file, all routes)

## First-time deploy

> **ALREADY DONE for production - do not run these.** `lss-stats`, both KV namespaces and the Worker have
> existed since 2026-05-03, and migrations 002-006 are applied (006 on 2026-09-27). Re-running
> `wrangler d1 create` just errors ("A database with that name already exists"); re-running an OLD
> migration errors on its `ALTER TABLE` (duplicate column). Nothing breaks either way, but nothing here
> needs doing. To switch on the shop, skip to **Turning on PayPal checkout** below.

This section is only for rebuilding the backend from scratch in a new Cloudflare account. It assumes wrangler is installed (`npm i -g wrangler`) and you're logged in (`wrangler login`).

### 1. Provision the D1 database

```bash
cd backend
wrangler d1 create lss-stats
```

Copy the `database_id` from the output and paste it into `wrangler.toml` (replacing `REPLACE_WITH_D1_ID_FROM_WRANGLER_CREATE_OUTPUT`).

### 2. Provision the KV namespaces

```bash
wrangler kv namespace create ROOMS
wrangler kv namespace create CACHE
```

Copy each printed `id` into `wrangler.toml` (replacing `REPLACE_WITH_ROOMS_KV_ID` and `REPLACE_WITH_CACHE_KV_ID`).

### 3. Apply the schema

```bash
wrangler d1 execute lss-stats --file=schema.sql --remote
```

Re-running is safe (all `CREATE` statements are `IF NOT EXISTS`).

### 4. Deploy the Worker

```bash
wrangler deploy
```

Output prints the Worker URL, e.g. `https://lss-backend.<your-account>.workers.dev`.

### 5. Smoke test

In a browser console (on https://lss.fractalreality.ca so CORS passes):

```js
fetch('https://lss-backend.<your-account>.workers.dev/health').then(r => r.json()).then(console.log)
```

Expect `{ ok: true, ts: <number> }`.

### 6. Custom domain (optional, recommended)

After the first deploy works, route the Worker at `api.lss.fractalreality.ca`:

1. In the Cloudflare dashboard → Workers & Pages → `lss-backend` → Settings → Triggers → Custom Domains → Add Custom Domain.
2. Type `api.lss.fractalreality.ca`.
3. Cloudflare adds the necessary DNS record automatically (since fractalreality.ca DNS is on Cloudflare).
4. Test: `fetch('https://api.lss.fractalreality.ca/health').then(r => r.json()).then(console.log)`.

Then update the game's API base URL constant from the workers.dev URL to `https://api.lss.fractalreality.ca`.

## Local development

```bash
wrangler dev
```

Spawns a local server on `http://localhost:8787` with hot-reload. D1 and KV are emulated locally (use `--remote` to hit the real ones).

To apply schema to the local D1:
```bash
wrangler d1 execute lss-stats --file=schema.sql --local
```

## Routes (quick reference)

| Method | Path                  | Auth | Notes                                                      |
| ------ | --------------------- | ---- | ---------------------------------------------------------- |
| POST   | /auth/session         | discord | trade a Discord token for a 180-day sliding LSS session |
| POST   | /auth/logout          | yes  | end the calling session                                    |
| GET    | /me                   | yes  | identity + owned entitlements; the client's liveness probe |
| POST   | /auth/verify          | yes  | validate a token, upsert player                            |
| POST   | /match                | yes  | submit per-participant match-result reports                |
| GET    | /match/:id            | no   | full match scoreboard                                      |
| GET    | /leaderboard          | no   | ?slice & ?sort & ?loadout & ?map & ?limit ; KV-cached 60s |
| GET    | /player/:id           | no   | career + recent matches + per-loadout breakdown            |
| GET    | /me/state, PUT /me/state | yes | cross-device aegis + account prefs                     |
| GET    | /shop/catalog         | no   | premium products (incl. retired) + whether checkout is on  |
| POST   | /shop/paypal/create   | yes  | `{sku}` -> PayPal order for the caller -> `approve_url`    |
| POST   | /shop/paypal/capture  | yes  | `{order_id}` -> capture + grant; idempotent                |
| POST   | /shop/paypal/webhook  | PayPal signature | approvals, captures, refunds, chargebacks (needs PAYPAL_WEBHOOK_ID) |
| POST   | /heartbeat            | yes  | refresh a room's KV TTL                                    |
| DELETE | /room/:code           | yes  | host explicitly closes a room                              |
| GET    | /rooms                | no   | live room list (filtered to recent heartbeats)             |
| DELETE | /me                   | yes  | scrub the calling user from D1 (keeps purchases/entitlements) |
| GET    | /health               | no   | sanity check; also reports `sessions` + `shop.paypal`/`env` |

`auth: yes` means `Authorization: Bearer <token>` where the token is EITHER an LSS session (`lss_...`, one D1 read) OR a raw Discord OAuth token (verified against Discord's `/users/@me`; older clients).

## Sessions (migration 006) - why the leaderboard lost months of matches

Discord access tokens die **7 days** after sign-in and the game never refreshed them. From day 8 every `POST /match` got 401, the client's outbox retried 40 times and deleted the match, and the menu still showed the player as signed in. Live D1 (2026-09-27): 221 matches ever, none from Jun 16 to Sep 5, the owner's last accepted request Sep 20.

Now the client spends the Discord token **once** at `POST /auth/session` and gets an `lss_` session that slides forward on every use (180 days of *inactivity* to lapse). If a login does die, the game shows **SIGN IN AGAIN · N MATCHES WAITING** and holds every match until the player signs back in. D1 stores only the SHA-256 of each session token.

## The shop (migration 006)

What is premium is **data**: a livery is locked while a `products` row names `skin:<SHIP_SKINS id>`. No game build is needed to price, retire or free a skin. Manage it with `tools/lss_shop.py` (uses wrangler's login - no admin key):

```bash
python tools/lss_shop.py price img_diamond 2.99
python tools/lss_shop.py products
python tools/lss_shop.py find <player name>
python tools/lss_shop.py grant <discord_id> img_diamond --note "paypal.me, txn XYZ" --paid 2.99
python tools/lss_shop.py purchases
```

Add `--local` to target the `wrangler dev` database instead of production. `grant --paid` records a manual sale, which covers selling through a plain PayPal link.

### Turning on PayPal checkout

Sandbox and live keys are stored under DIFFERENT secret names, side by side; `PAYPAL_ENV` in `wrangler.toml` picks which set is used. The part in capitals is the secret's NAME - type it exactly; the key itself is pasted at the prompt.

| | sandbox (fake money) | live (real money) |
|---|---|---|
| Client ID | `PAYPAL_CLIENT_ID` | `PAYPAL_LIVE_CLIENT_ID` |
| Secret | `PAYPAL_CLIENT_SECRET` | `PAYPAL_LIVE_CLIENT_SECRET` |
| Webhook id (optional) | `PAYPAL_WEBHOOK_ID` | `PAYPAL_LIVE_WEBHOOK_ID` |

1. developer.paypal.com, logged in with the PayPal **business** account -> Apps & Credentials -> the Sandbox/Live switch -> Create App (type Merchant).
2. `wrangler secret put <NAME> --name lss-backend` for the ID and the Secret of that mode. (Sandbox done 2026-09-28.)
3. Going live: add the `PAYPAL_LIVE_*` pair (nothing changes yet), then `PAYPAL_ENV = "live"` + `wrangler deploy`. Rolling back is `"sandbox"` + `wrangler deploy` - the sandbox keys are still there.
4. Optional but recommended: in the app's Webhooks add `https://lss-backend.ashroney.workers.dev/shop/paypal/webhook` for `CHECKOUT.ORDER.APPROVED` and `PAYMENT.CAPTURE.*`, then put that webhook's id under the webhook name for that mode. Without it everything works except automatic revocation on refunds/chargebacks (`lss_shop.py revoke` does it by hand).

While the current mode has no keys the shop is inert: premium skins show **SHOP OPENING SOON** and the create/capture routes answer 503.

A purchase is decided entirely server-side: the price comes from `products`, the buyer is the session that created the order (also PayPal's `custom_id`), and a skin is granted only when PayPal reports the capture `COMPLETED` for exactly that amount and currency. A buyer who approves and closes the tab is captured by the 5-minute cron.

## Local dev loop (no real Discord, no real money)

Launch entries in `.claude/launch.json`: `lss-mocks` (Discord + PayPal mocks on :8788, including a clickable fake checkout page) and `lss-backend-dev` (`wrangler dev` on :8787 with `DEV_MOCKS=1`, see `dev/mock.env`). Then:

```bash
cd LSS/backend
wrangler d1 execute lss-stats --local --persist-to dev/.state --file=schema.sql
node dev/e2e_shop_sessions.mjs
```

The e2e script (41 checks) covers sessions, legacy tokens, match posting, the whole PayPal lifecycle, a forged webhook, a refund and the cron capture. To drive the real game against it, on `http://localhost:8099` set `localStorage.lss_api_base = 'http://localhost:8787'` (honoured on localhost only) and seed `lss_discord_user` + `lss_discord_token = 'dev_<id>'`.

## Operations

### Apply a schema migration

Add the new statements to `schema.sql` (or a new file) then run:

```bash
wrangler d1 execute lss-stats --file=schema.sql --remote
```

### Query D1 ad-hoc

```bash
wrangler d1 execute lss-stats --command="SELECT count(*) FROM players;" --remote
```

### Tail Worker logs

```bash
wrangler tail
```

### Rotate ALLOWED_ORIGINS or APPLICATION_ID

Edit `wrangler.toml`, then `wrangler deploy`.

### View KV contents

```bash
wrangler kv key list --binding=ROOMS
wrangler kv key get --binding=ROOMS room:ABC123
```

## Trust model (short version)

- Identity is Discord, validated on every authed request.
- Match results require **consensus**: all participants must POST and their reports must agree before the match is counted. Disagreements mark the match disputed and exclude it from leaderboards.
- Rooms are anonymous-readable but only the host (token-bound) can delete.
- Player data deletion is on-demand via `DELETE /me`.

For ranked play later, layer cryptographic signatures on each participant's report (key derived from OAuth flow), so consensus becomes "all participants signed agreeing reports" instead of just "all participants reported the same numbers." Defer until ranked is real.
