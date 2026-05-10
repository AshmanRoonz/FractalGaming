# LSS Backend

Cloudflare Worker + D1 + KV. Implements the API behind lss.fractalreality.ca's stats pages, the in-game match-result posting, and the lobby browser.

See `../LSS_backend-plan.md` for the full architecture rationale.

## Layout

- `wrangler.toml`     ; Worker config + D1/KV bindings
- `schema.sql`        ; D1 schema migration (idempotent)
- `src/worker.js`     ; the Worker itself (one file, all routes)

## First-time deploy

Assuming wrangler is installed (`npm i -g wrangler`) and you're logged in (`wrangler login`).

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

| Method | Path              | Auth | Notes                                                      |
| ------ | ----------------- | ---- | ---------------------------------------------------------- |
| POST   | /auth/verify      | yes  | validate Discord token, upsert player                      |
| POST   | /match            | yes  | submit per-participant match-result reports                |
| GET    | /match/:id        | no   | full match scoreboard                                      |
| GET    | /leaderboard      | no   | ?slice & ?sort & ?loadout & ?map & ?limit ; KV-cached 60s |
| GET    | /player/:id       | no   | career + recent matches + per-loadout breakdown            |
| POST   | /heartbeat        | yes  | refresh a room's KV TTL                                    |
| DELETE | /room/:code       | yes  | host explicitly closes a room                              |
| GET    | /rooms            | no   | live room list (filtered to recent heartbeats)             |
| DELETE | /me               | yes  | scrub the calling user from D1                             |
| GET    | /health           | no   | sanity check                                               |

`auth: yes` means the request needs `Authorization: Bearer <discord_oauth_token>` ; the Worker validates it via Discord's `/users/@me` on every call. A small KV cache could be added later to reduce that round-trip.

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
