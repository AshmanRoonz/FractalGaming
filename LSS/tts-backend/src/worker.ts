/**
 * Last Ship Sailing - TTS backend
 *
 * A Cloudflare Worker that turns text into spoken audio so the Meta Quest
 * browser (which has no built-in TTS voices) can still hear the ship-AI
 * announcer. The code lives on GitHub; a GitHub Action deploys it to
 * Cloudflare on push (see ../.github/workflows/deploy-tts-backend.yml).
 *
 * Endpoint:
 *   GET /tts?text=<text>&voice=<id>&speed=<float>
 *     -> 200 audio/mpeg (MP3)
 *
 * Provider: Cloudflare Workers AI MeloTTS by default
 * (model "@cf/myshell-ai/melotts"). Free tier covers tens of thousands of
 * calls per day for a personal project. Swap to ElevenLabs by setting the
 * ELEVENLABS_API_KEY secret (see the commented section in handleTts()).
 *
 * Caching: every distinct (text, voice, speed) tuple is cached in the
 * Cloudflare edge cache forever (immutable), so repeated announcer lines
 * never re-bill the AI model. The cache key is a SHA-256 of the inputs,
 * so URL ordering does not matter.
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
      return json({ ok: true, service: 'lss-tts', voices: listVoices() }, 200, request, env);
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

  // Edge cache lookup, keyed by SHA-256 of normalized inputs.
  const cacheKey = await buildCacheKey(text, voice, speed, url);
  const cache = (caches as any).default as Cache;
  const cached = await cache.match(cacheKey);
  if (cached) {
    return withCors(cached, request, env);
  }

  let audio: ArrayBuffer;
  let contentType = 'audio/mpeg';
  try {
    if (env.ELEVENLABS_API_KEY) {
      const eleven = await elevenlabsTts(env, text, voice, speed);
      audio = eleven.audio;
      contentType = eleven.contentType;
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

async function elevenlabsTts(env: Env, text: string, voice: string, speed: number): Promise<{ audio: ArrayBuffer; contentType: string }> {
  const voiceId = env.ELEVENLABS_VOICE_ID || voice;
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
      voice_settings: { stability: 0.45, similarity_boost: 0.75, speed },
    }),
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`elevenlabs ${resp.status}: ${errBody.slice(0, 200)}`);
  }
  return { audio: await resp.arrayBuffer(), contentType: 'audio/mpeg' };
}

function voiceToLang(voice: string): string {
  const v = (voice || '').toUpperCase();
  const allowed = ['EN-US', 'EN-GB', 'EN-AU', 'EN-INDIA', 'EN-DEFAULT'];
  return allowed.includes(v) ? v : 'EN-US';
}

function listVoices() {
  return {
    melotts: ['EN-US', 'EN-GB', 'EN-AU', 'EN-INDIA', 'EN-DEFAULT'],
    note: 'Pass ?voice=<id>. ElevenLabs voice ids work too if ELEVENLABS_API_KEY is set.',
  };
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

async function buildCacheKey(text: string, voice: string, speed: number, baseUrl: URL): Promise<Request> {
  const normalized = JSON.stringify({ t: text, v: voice.toUpperCase(), s: Math.round(speed * 100) / 100 });
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
  if (out instanceof Uint8Array) {
    return out.slice().buffer as ArrayBuffer;
  }
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
  if (out && out.audio) {
    if (typeof out.audio === 'string') {
      const bin = atob(out.audio);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.slice().buffer as ArrayBuffer;
    }
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
