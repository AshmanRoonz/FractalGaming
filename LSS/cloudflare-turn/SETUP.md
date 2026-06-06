# Cloudflare TURN setup for Last Ship Sailing (free plan)

This adds a TURN relay so players on different networks — especially cell
hotspots / carrier-grade NAT — can actually connect. It runs on the free
Cloudflare plan: Realtime TURN gives 1,000 GB/month free (you won't get close),
and the Worker fits the free Workers tier.

There are two pieces:
1. A **Realtime TURN app** (gives you the credentials/secret).
2. A tiny **Worker** (`worker.js`) that mints short-lived credentials for the
   game so the secret never ships in client JS.

---

## 1. Create the Realtime TURN app

1. Cloudflare dashboard → search/sidebar for **Realtime** (it may also appear as
   "Realtime / Calls").
2. Open **TURN** → **Create** a TURN app (name it e.g. `lss-turn`).
3. Copy the two values it gives you:
   - **Turn Token ID**  → this is `TURN_TOKEN_ID`
   - **API Token** (the secret key) → this is `TURN_API_TOKEN`
   Keep the API token private.

## 2. Deploy the Worker

You can use the CLI (wrangler) or paste into the dashboard.

### Option A — wrangler CLI
From this `cloudflare-turn/` folder:
```bash
npm install -g wrangler        # if you don't have it
wrangler login
wrangler secret put TURN_TOKEN_ID     # paste the Turn Token ID
wrangler secret put TURN_API_TOKEN    # paste the API token
wrangler deploy
```
Wrangler prints the URL, e.g. `https://lss-turn.<your-subdomain>.workers.dev`.

### Option B — dashboard
1. Workers & Pages → **Create** → **Worker** → name it `lss-turn` → Deploy.
2. Edit code → paste the contents of `worker.js` → Save and deploy.
3. Worker → **Settings** → **Variables and Secrets** → add two **secrets**:
   `TURN_TOKEN_ID` and `TURN_API_TOKEN`.
4. Copy the Worker URL from the Worker's page.

(Optional) To lock it to your domain, set a plain var `ALLOWED_ORIGIN` to
`https://lss.fractalreality.ca`. Leave it unset while testing.

## 3. Point the game at the Worker

In `last_ship_sailing_v28.html`, find:
```js
const LSS_TURN_ENDPOINT = 'https://REPLACE-ME.workers.dev';
```
Replace the URL with your Worker URL from step 2. That's the only edit.

The game fetches credentials from the Worker on room join and passes them to
Trystero. If the Worker is unreachable or not yet configured, it falls back to
the old behavior (STUN-only), so LAN play keeps working regardless.

## 4. Test it

1. Open the Worker URL directly in a browser — you should see JSON like
   `{"iceServers":[{"urls":[...],"username":"...","credential":"..."}]}`.
   If you see `not_configured`, the secrets aren't set. If `turn_generate_failed`,
   the Token ID / API token don't match.
2. In the game, create a room on your home wifi, join it from a phone on
   **cell data** (hotspot off the same phone won't test NAT — use cellular).
   They should now connect.

## Notes / limits

- TURN only relays when a direct peer connection can't form; it does **not**
  burn data when peers connect directly. Game state is tiny, so the 1,000 GB
  free tier is effectively unlimited here.
- `stun.cloudflare.com` is free and unlimited and is included in the returned
  iceServers automatically.
- This fixes the **connection** layer. If players still can't *discover* each
  other's room on some networks (the BitTorrent-tracker signaling Trystero uses
  can be blocked on restrictive networks), the next step is moving signaling to
  a Worker too — ask and I'll scaffold that. Do this TURN step first and test.
