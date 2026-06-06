/**
 * Last Ship Sailing — TURN credential minter (Cloudflare Worker)
 *
 * The game (Trystero / WebRTC) needs a TURN relay so peers behind
 * carrier-grade / symmetric NAT (cell hotspots, many home routers) can
 * connect. The long-term TURN key is a SECRET and must never ship in client
 * JS, so this Worker holds it and mints short-lived credentials on demand.
 *
 * The browser fetches this Worker on room join and passes the returned
 * iceServers into Trystero's rtcConfig.
 *
 * Secrets (set with `wrangler secret put ...` or in the dashboard):
 *   TURN_TOKEN_ID    - the Realtime TURN app's Token ID
 *   TURN_API_TOKEN   - the Realtime TURN app's API token (the secret key)
 *
 * Optional var:
 *   ALLOWED_ORIGIN   - if set, CORS is restricted to this origin
 *                      (e.g. "https://lss.fractalreality.ca"). If unset, "*".
 */

const CRED_TTL_SECONDS = 86400; // 24h; max allowed is 48h (172800)

export default {
  async fetch(request, env) {
    const allowOrigin = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (!env.TURN_TOKEN_ID || !env.TURN_API_TOKEN) {
      return json({ error: 'not_configured', detail: 'Set TURN_TOKEN_ID and TURN_API_TOKEN secrets.' }, 500, cors);
    }

    try {
      const resp = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_TOKEN_ID}/credentials/generate`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.TURN_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl: CRED_TTL_SECONDS }),
        }
      );

      if (!resp.ok) {
        const detail = await resp.text();
        return json({ error: 'turn_generate_failed', status: resp.status, detail }, 502, cors);
      }

      const data = await resp.json();
      // Cloudflare returns { iceServers: { urls:[...], username, credential } }
      // (a SINGLE iceServer object). RTCPeerConnection / Trystero want an
      // ARRAY, so normalize to one.
      const ice = data && data.iceServers;
      const iceServers = Array.isArray(ice) ? ice : (ice ? [ice] : []);
      return json({ iceServers }, 200, { ...cors, 'Cache-Control': 'no-store' });
    } catch (e) {
      return json({ error: 'worker_error', detail: String(e && e.message || e) }, 500, cors);
    }
  },
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
