# LSS TTS Backend

A tiny Cloudflare Worker that gives **Last Ship Sailing** a voice on Meta
Quest. The Quest browser exposes `speechSynthesis` but ships **zero
voices**, so every announcer call is silent. This service turns text into
MP3 audio that the game `fetch`es and plays through a normal `<audio>`
element, which works fine on Quest.

## Why not "run on GitHub" directly?

GitHub itself can host static files (Pages), run CI jobs (Actions), or
spin up dev containers (Codespaces); it does **not** host a persistent
web service that the Quest browser can call. The standard pattern is:

- Source code: lives in your GitHub repo (this folder).
- Deployment: a GitHub Action pushes the worker to Cloudflare on every
  commit (see `.github/workflows/deploy-tts-backend.yml`).
- Hosting: Cloudflare's free Workers tier runs the service at
  `https://lss-tts.<your-cf-subdomain>.workers.dev`.

From your day-to-day workflow that still looks like "I pushed to GitHub
and the new TTS is live"; you just never log into Cloudflare after the
one-time setup.

## What you get

```
GET https://lss-tts.<you>.workers.dev/tts?text=Shields%20offline.
  -> 200 audio/mpeg (MP3 bytes)

GET https://lss-tts.<you>.workers.dev/health
  -> 200 { ok: true, service: "lss-tts", voices: {...} }
```

Parameters:

- `text` (required): the line to speak. Max 400 characters.
- `voice` (optional): `EN-US` (default), `EN-GB`, `EN-AU`, `EN-INDIA`,
  `EN-DEFAULT`. If you enable ElevenLabs (below), pass an ElevenLabs
  voice id instead.
- `speed` (optional): 0.5 to 2.0, default 1.0.

Every distinct (text, voice, speed) tuple is cached forever at the
Cloudflare edge, so the ~30 fixed announcer lines effectively become
free after the first play.

## One-time setup (about 10 minutes)

### 1. Create a Cloudflare account

Free, no credit card needed for Workers + Workers AI free tiers.
<https://dash.cloudflare.com/sign-up>

### 2. Grab two values

- **Account ID**: open <https://dash.cloudflare.com>, your account ID is
  in the URL and on the right rail (looks like `a1b2c3d4...`).
- **API token**: <https://dash.cloudflare.com/profile/api-tokens> ->
  *Create Token* -> use the **Edit Cloudflare Workers** template ->
  Continue -> Create -> copy the token (you only see it once).

### 3. Add them as GitHub secrets

In your repo on GitHub: *Settings* -> *Secrets and variables* ->
*Actions* -> *New repository secret*. Add:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

(Optional, only if you want premium voices later:
`ELEVENLABS_API_KEY`.)

### 4. Move the workflow file to the repo root

GitHub only sees workflows in **`.github/workflows/` at the root of the
repo**. Move (or copy) the file to its proper home:

```bash
mkdir -p .github/workflows
cp fractalgaming/LSS/tts-backend/.github/workflows/deploy-tts-backend.yml \
   .github/workflows/deploy-tts-backend.yml
git rm -r fractalgaming/LSS/tts-backend/.github
```

### 5. Push

```bash
git add .
git commit -m "Add LSS TTS backend"
git push
```

Watch the *Actions* tab in your GitHub repo. The first deploy takes
about a minute. When it finishes, the job log prints your worker's
URL; it will look like `https://lss-tts.<your-subdomain>.workers.dev`.
Open that URL plus `/health` in a browser to confirm.

### 6. Wire it into the game

Open `fractalgaming/LSS/last_ship_sailing_v21.html` and paste the
contents of `client-snippet.html` (in this folder) **after** the
`const ANN = { ... };` block (around line 44331), inside the same
`<script>`. Set the `BACKEND` constant at the top of the snippet to
your worker URL.

## Local development (optional)

```bash
cd fractalgaming/LSS/tts-backend
npm install
npx wrangler login    # one-time browser-based auth
npm run dev           # local server at http://localhost:8787
```

`wrangler dev` proxies Workers AI calls to Cloudflare even when running
locally, so MeloTTS works in dev too.

## Switching to ElevenLabs (optional, premium voice)

1. Grab a key at <https://elevenlabs.io>.
2. Add `ELEVENLABS_API_KEY` (and optionally `ELEVENLABS_VOICE_ID`) as a
   GitHub Actions secret. The deploy workflow pushes it to the Worker
   automatically.
3. Re-deploy by pushing any change. The Worker auto-detects the secret
   and switches engines; no code change needed.

## Costs

- Workers (requests): 100k/day free, then $5/10M.
- Workers AI MeloTTS: 10k Neurons/day free (each TTS call is a tiny
  fraction of one Neuron; a typical game session uses well under the
  free quota even before caching kicks in).
- ElevenLabs (optional): 10k chars/month free, paid tiers from $5/mo.

A solo-developer indie VR game realistically lives entirely inside the
free tier.

## Locking down origins

Once you know the URL the game is served from (itch.io, GitHub Pages,
SideQuest, etc.), edit `wrangler.toml`:

```toml
[vars]
ALLOWED_ORIGINS = "https://your-game.itch.io,https://you.github.io"
```

Push, redeploy, done. The worker will then refuse calls from any other
origin via CORS.
