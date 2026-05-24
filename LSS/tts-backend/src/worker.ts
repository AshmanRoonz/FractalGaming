/**
 * Last Ship Sailing - TTS backend
 *
 * Cloudflare Worker that turns text into spoken audio so the Meta Quest
 * browser can hear the ship-AI announcer. Defaults to Cloudflare Workers AI
 * (MeloTTS) when no ElevenLabs key is configured ; uses ElevenLabs when
 * ELEVENLABS_API_KEY is set.
 *
 * Endpoint:
 *   GET /tts?text=<text>&voice=<id>&speed=<float>  ->  200 audio/mpeg
 */

export interface Env {
  AI: Ai;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_VOICE_ID?: string;
  ALLOWED_ORIGINS?: string;
}

interface Ai {
  run(model: string, input: Record<string, unknown>): Promise<any>;
}

const DEFAULT_VOICE = 'EN-US';
const DEFAULT_SPEED = 1.0;
const MAX_TEXT_LEN = 400;

// Hardcoded ElevenLabs voice id for the ship AI announcer. Used when the
// ELEVENLABS_API_KEY secret is present and ELEVENLABS_VOICE_ID is unset.
// Change voice without redeploying by setting ELEVENLABS_VOICE_ID secret:
//   echo "<new-id>" | npx wrangler secret put ELEVENLABS_VOICE_ID
const DEFAULT_ELEVEN_VOICE_ID = 'Xq2dbIWNPChFB77imiDe';

// Heuristic: ElevenLabs voice ids are ~20 char alphanumeric strings.
// The MeloTTS voice param uses "EN-US" / "EN-GB" style codes. We only
// honor a client-passed voice for ElevenLabs when it actually looks like
// an ElevenLabs id ; otherwise we fall back to the env / default voice.
function looksLikeElevenLabsId(s: string): boolean {
  return /^[A-Za-z0-9]{16,32}$/.test(s);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'method_not_allowed' }, 405, request, env);
    }
    if (url.pathname === '/' || url.pathname === '/health') {
      return json({
        ok: true,
        service: 'lss-tts',
        provider: env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'workers-ai-melotts',
        voices: listVoices(),
      }, 200, request, env);
    }
    if (url.pathname === '/tts') {
      return handleTts(request, env, ctx, url);
    }
    return json({ error: 'not_found' }, 404, request, env);
  },
};

async function handleTts(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const text = (url.searchParams.get('text') || '').trim();
  const voice = (url.searchParams.get('voice') || DEFAULT_VOICE).trim();
  const speed = clamp(parseFloat(url.searchParams.get('speed') || '') || DEFAULT_SPEED, 0.5, 2.0);

  if (!text) return json({ error: 'missing_text' }, 400, request, env);
  if (text.length > MAX_TEXT_LEN) {
    return json({ error: 'text_too_long', max: MAX_TEXT_LEN }, 413, request, env);
  }

  const cacheKey = await buildCacheKey(text, voice, speed, url, !!env.ELEVENLABS_API_KEY);
  const cache = (caches as any).default as Cache;
  const cached = await cache.match(cacheKey);
  if (cached) return withCors(cached, request, env);

  let audio: ArrayBuffer;
  const contentType = 'audio/mpeg';
  try {
    if (env.ELEVENLABS_API_KEY) {
      audio = await elevenlabsTts(env, text, voice, speed);
    } else {
      const out = await env.AI.run('@cf/myshell-ai/melotts', {
        prompt: text,
        lang: voiceToLang(voice),
      });
      audio = await coerceToArrayBuffer(out);
    }
  } catch (err: any) {
    console.error('[tts] synth failed:', err && err.message ? err.message : err);
    return json({ error: 'synth_failed', detail: String(err && err.message || err) }, 502, request, env);
  }

  const response = new Response(audio, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-length': String(audio.byteLength),
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return withCors(response, request, env);
}

async function elevenlabsTts(env: Env, text: string, voice: string, speed: number): Promise<ArrayBuffer> {
  // Priority: client-passed id (only if it looks like one) > env override > hardcoded default.
  // This lets the client stay provider-agnostic (it always passes EN-US-style codes).
  const voiceId = looksLikeElevenLabsId(voice)
    ? voice
    : (env.ELEVENLABS_VOICE_ID || DEFAULT_ELEVEN_VOICE_ID);
  // ElevenLabs speed lives in voice_settings ; valid band is ~0.7-1.2.
  // Our incoming speed mirrors announcer.rate (0.5-2.0) so we clamp here.
  const elevenSpeed = Math.min(1.2, Math.max(0.7, speed));
  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': env.ELEVENLABS_API_KEY!,
      'content-type': 'application/json',
      'accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.45, similarity_boost: 0.75, speed: elevenSpeed },
    }),
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`elevenlabs ${resp.status}: ${errBody.slice(0, 300)}`);
  }
  return await resp.arrayBuffer();
}

function voiceToLang(voice: string): string {
  const v = (voice || '').toUpperCase();
  const allowed = ['EN-US', 'EN-GB', 'EN-AU', 'EN-INDIA', 'EN-DEFAULT'];
  return allowed.includes(v) ? v : 'EN-US';
}

function listVoices() {
  return {
    melotts: ['EN-US', 'EN-GB', 'EN-AU', 'EN-INDIA', 'EN-DEFAULT'],
    note: 'Pass ?voice=<id>. When ELEVENLABS_API_KEY is set, an ElevenLabs voice id may also be passed.',
  };
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

async function buildCacheKey(text: string, voice: string, speed: number, baseUrl: URL, isEleven: boolean): Promise<Request> {
  // Bake provider into the cache key so flipping ELEVENLABS_API_KEY does not
  // serve stale MeloTTS audio for an ElevenLabs-configured worker.
  const normalized = JSON.stringify({
    p: isEleven ? 'el' : 'melo',
    t: text,
    v: voice.toUpperCase(),
    s: Math.round(speed * 100) / 100,
  });
  const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  const hex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  const keyUrl = new URL(baseUrl.toString());
  keyUrl.search = '';
  keyUrl.pathname = `/_cache/${hex}.mp3`;
  return new Request(keyUrl.toString(), { method: 'GET' });
}

async function coerceToArrayBuffer(out: any): Promise<ArrayBuffer> {
  if (out instanceof ArrayBuffer) return out;
  if (out && typeof out.arrayBuffer === 'function') return await out.arrayBuffer();
  if (out instanceof Uint8Array) return out.slice().buffer as ArrayBuffer;
  if (out instanceof ReadableStream) {
    const reader = out.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) { chunks.push(value); total += value.byteLength; }
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.byteLength; }
    return merged.buffer;
  }
  if (out && typeof out.audio === 'string') {
    const bin = atob(out.audio);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.slice().buffer as ArrayBuffer;
  }
  throw new Error('unrecognized AI output shape');
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
  const allowOrigin = allowed.includes('*') || allowed.includes(origin) ? (origin || '*') : 'null';
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    'vary': 'origin',
  };
}

function withCors(response: Response, request: Request, env: Env): Response {
  const out = new Response(response.body, response);
  const cors = corsHeaders(request, env) as Record<string, string>;
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
}

function json(body: unknown, status: number, request: Request, env: Env): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(corsHeaders(request, env) as Record<string, string>),
    },
  });
}
