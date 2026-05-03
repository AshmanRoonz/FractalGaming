// LSS Backend Worker. The API behind lss.fractalreality.ca.
//
// Routes (see LSS_backend-plan.md):
//   POST   /auth/verify           ; validate Discord token, upsert player
//   POST   /match                 ; submit a match result (per-participant)
//   GET    /match/:id             ; full match detail
//   GET    /leaderboard           ; ranked players (?slice & ?sort & ?loadout & ?map & ?limit)
//   GET    /player/:discord_id    ; player career + recent matches + loadout stats
//   POST   /heartbeat             ; refresh a room's KV TTL
//   DELETE /room/:code            ; remove a room (host explicitly closes)
//   GET    /rooms                 ; live room list
//   DELETE /me                    ; scrub the calling user from the database
//
// Architecture:
//   - Cloudflare Worker, ES module format.
//   - D1 database for stats (binding: DB).
//   - KV namespaces for ephemeral hot data (bindings: ROOMS, CACHE).
//   - Discord OAuth tokens validated via /users/@me on every authed call.
//     A small KV cache could be added later to reduce Discord API load.
//   - CORS allowlist driven by env.ALLOWED_ORIGINS (comma-separated).

const DISCORD_API = 'https://discord.com/api/v10';
const LEADERBOARD_TTL_SEC = 60;       // KV cache TTL for top-N
const ROOM_TTL_SEC        = 90;       // KV TTL for room heartbeats
const RECENT_ROOM_WINDOW_MS = 75_000; // older rooms filtered out of /rooms

// ---------- CORS / response helpers ----------------------------------

function corsHeaders(env, origin) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const allow   = allowed.includes(origin) ? origin : (allowed[0] || '*');
  return {
    'Access-Control-Allow-Origin':  allow,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age':       '86400',
    'Vary': 'Origin',
  };
}

function jsonResponse(status, body, env, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(env, origin), 'Content-Type': 'application/json' },
  });
}

// ---------- Auth ------------------------------------------------------

// Validates the Authorization: Bearer <token> header by hitting Discord's
// /users/@me endpoint. Returns the Discord user object on success, or
// throws a Response on failure (caller catches and forwards).
async function requireAuth(request) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) throw new ApiError(401, 'missing_token');
  const res = await fetch(DISCORD_API + '/users/@me', {
    headers: { Authorization: auth },
  });
  if (!res.ok) throw new ApiError(401, 'invalid_token');
  return await res.json();
}

class ApiError extends Error {
  constructor(status, code, detail) { super(code); this.status = status; this.code = code; this.detail = detail; }
}

// Upsert the player row with the latest identity from Discord.
async function upsertPlayer(env, user) {
  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO players (discord_id, username, display_name, avatar_hash, created_at, last_seen)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      username = excluded.username,
      display_name = excluded.display_name,
      avatar_hash = excluded.avatar_hash,
      last_seen = excluded.last_seen
  `).bind(
    user.id,
    user.username,
    user.global_name || user.username,
    user.avatar || null,
    now,
    now,
  ).run();
}

// ---------- Match consensus ------------------------------------------

// After every match POST we check: have all expected participants
// reported, AND do their reports agree? If yes, validate + roll up.
// If reports are in but disagree, mark disputed.
async function tryValidateMatch(env, matchId) {
  const matchRow = await env.DB.prepare('SELECT * FROM matches WHERE id = ?').bind(matchId).first();
  if (!matchRow) return;
  if (matchRow.validated !== 0) return;     // already settled

  const reports = await env.DB.prepare(`
    SELECT * FROM match_participants WHERE match_id = ?
  `).bind(matchId).all();
  if (!reports.results) return;

  // Group by reporter ; need (participant_count) reports each covering
  // (participant_count) participants for full consensus.
  const byReporter = new Map();
  for (const r of reports.results) {
    if (!byReporter.has(r.reported_by)) byReporter.set(r.reported_by, []);
    byReporter.get(r.reported_by).push(r);
  }

  if (byReporter.size < matchRow.participant_count) return; // still waiting
  for (const list of byReporter.values()) {
    if (list.length !== matchRow.participant_count) return; // partial report
  }

  // Cross-check: does every reporter agree on every participant's stats?
  const canonical = new Map(); // discord_id -> stat snapshot from first reporter
  let firstReporter = true;
  for (const [, list] of byReporter) {
    for (const r of list) {
      const key = r.discord_id;
      const snap = {
        team: r.team,
        loadout_key: r.loadout_key,
        kills: r.kills,
        deaths: r.deaths,
        damage_dealt: r.damage_dealt,
        damage_taken: r.damage_taken,
        is_mvp: r.is_mvp,
        is_winner: r.is_winner,
      };
      if (firstReporter) {
        canonical.set(key, snap);
      } else {
        const c = canonical.get(key);
        if (!c) return markDisputed(env, matchId);
        for (const k of Object.keys(snap)) {
          if (c[k] !== snap[k]) return markDisputed(env, matchId);
        }
      }
    }
    firstReporter = false;
  }

  // All reports agreed. Roll up to player career totals (one statement
  // per participant ; D1 doesn't expose multi-statement transactions yet
  // for non-batch APIs, but each upsert is atomic).
  const now = Date.now();
  await env.DB.prepare(`
    UPDATE matches SET validated = 1, validated_at = ? WHERE id = ?
  `).bind(now, matchId).run();

  for (const [discordId, snap] of canonical) {
    // Bump player career totals.
    await env.DB.prepare(`
      UPDATE players
      SET total_matches = total_matches + 1,
          total_wins    = total_wins    + ?,
          total_kills   = total_kills   + ?,
          total_deaths  = total_deaths  + ?,
          total_damage  = total_damage  + ?
      WHERE discord_id = ?
    `).bind(
      snap.is_winner ? 1 : 0,
      snap.kills,
      snap.deaths,
      snap.damage_dealt,
      discordId,
    ).run();

    // Bump per-loadout aggregates.
    await env.DB.prepare(`
      INSERT INTO player_loadout_stats (
        discord_id, loadout_key, matches, wins, kills, deaths,
        damage_dealt, damage_taken, mvp_count
      )
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(discord_id, loadout_key) DO UPDATE SET
        matches      = matches      + 1,
        wins         = wins         + excluded.wins,
        kills        = kills        + excluded.kills,
        deaths       = deaths       + excluded.deaths,
        damage_dealt = damage_dealt + excluded.damage_dealt,
        damage_taken = damage_taken + excluded.damage_taken,
        mvp_count    = mvp_count    + excluded.mvp_count
    `).bind(
      discordId, snap.loadout_key,
      snap.is_winner ? 1 : 0,
      snap.kills, snap.deaths, snap.damage_dealt, snap.damage_taken,
      snap.is_mvp ? 1 : 0,
    ).run();
  }

  // Bust the leaderboard cache so the next read picks up new totals.
  await invalidateLeaderboardCache(env);
}

async function markDisputed(env, matchId) {
  const now = Date.now();
  await env.DB.prepare(`
    UPDATE matches SET validated = 2, validated_at = ? WHERE id = ?
  `).bind(now, matchId).run();
}

async function invalidateLeaderboardCache(env) {
  // KV doesn't have prefix delete on the free tier ; a list+delete loop
  // is the pattern. Cache keys are short-lived (60s) anyway, so we can
  // also just let them expire naturally.
  try {
    const list = await env.CACHE.list({ prefix: 'leaderboard:' });
    for (const k of list.keys) await env.CACHE.delete(k.name);
  } catch (_) {}
}

// ---------- Route: POST /auth/verify ---------------------------------

async function handleAuthVerify(request, env, origin) {
  const user = await requireAuth(request);
  await upsertPlayer(env, user);
  return jsonResponse(200, { ok: true, user }, env, origin);
}

// ---------- Route: POST /match ---------------------------------------

async function handlePostMatch(request, env, origin) {
  const user = await requireAuth(request);
  await upsertPlayer(env, user);

  let body;
  try { body = await request.json(); }
  catch (_) { throw new ApiError(400, 'invalid_json'); }

  // Basic shape validation.
  if (!body || typeof body !== 'object') throw new ApiError(400, 'invalid_payload');
  const requiredFields = ['match_id','started_at','ended_at','map_key','participants'];
  for (const f of requiredFields) {
    if (!(f in body)) throw new ApiError(400, 'missing_field:' + f);
  }
  if (!Array.isArray(body.participants) || body.participants.length === 0) {
    throw new ApiError(400, 'no_participants');
  }
  if (body.participants.length > 12) throw new ApiError(400, 'too_many_participants');

  // The reporter must be among the participants ; prevents random
  // accounts from posting matches they weren't in.
  const isReporterParticipant = body.participants.some(p => p.discord_id === user.id);
  if (!isReporterParticipant) throw new ApiError(403, 'reporter_not_in_match');

  // Insert / update the match row (idempotent on match_id).
  await env.DB.prepare(`
    INSERT INTO matches (id, started_at, ended_at, map_key, winning_team, duration_sec, participant_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).bind(
    String(body.match_id),
    Number(body.started_at),
    Number(body.ended_at),
    String(body.map_key),
    body.winning_team == null ? null : Number(body.winning_team),
    body.duration_sec == null ? null : Number(body.duration_sec),
    body.participants.length,
  ).run();

  // Insert / replace this reporter's view of every participant.
  const now = Date.now();
  for (const p of body.participants) {
    if (!p.discord_id) throw new ApiError(400, 'participant_missing_discord_id');
    await env.DB.prepare(`
      INSERT INTO match_participants (
        match_id, discord_id, reported_by, team, loadout_key,
        kills, deaths, damage_dealt, damage_taken,
        is_mvp, is_winner, signature, reported_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(match_id, discord_id, reported_by) DO UPDATE SET
        team         = excluded.team,
        loadout_key  = excluded.loadout_key,
        kills        = excluded.kills,
        deaths       = excluded.deaths,
        damage_dealt = excluded.damage_dealt,
        damage_taken = excluded.damage_taken,
        is_mvp       = excluded.is_mvp,
        is_winner    = excluded.is_winner,
        signature    = excluded.signature,
        reported_at  = excluded.reported_at
    `).bind(
      String(body.match_id),
      String(p.discord_id),
      user.id,
      Number(p.team || 0),
      String(p.loadout_key || ''),
      Number(p.kills || 0),
      Number(p.deaths || 0),
      Number(p.damage_dealt || 0),
      Number(p.damage_taken || 0),
      p.is_mvp ? 1 : 0,
      p.is_winner ? 1 : 0,
      p.signature || null,
      now,
    ).run();
  }

  // Try to validate (no-op if not all reports are in yet).
  await tryValidateMatch(env, String(body.match_id));

  return jsonResponse(200, { ok: true, match_id: body.match_id }, env, origin);
}

// ---------- Route: GET /match/:id ------------------------------------

async function handleGetMatch(env, origin, matchId) {
  const match = await env.DB.prepare('SELECT * FROM matches WHERE id = ?').bind(matchId).first();
  if (!match) return jsonResponse(404, { error: 'match_not_found' }, env, origin);

  // Return canonical participant view (one row per discord_id, taken
  // from any single reporter's view ; for validated matches all reports
  // agree, so any reporter is fine).
  const rows = await env.DB.prepare(`
    SELECT discord_id, team, loadout_key, kills, deaths, damage_dealt, damage_taken, is_mvp, is_winner
    FROM match_participants
    WHERE match_id = ?
    GROUP BY discord_id
  `).bind(matchId).all();

  // Hydrate display names + avatars for the rendered scoreboard.
  const playerIds = (rows.results || []).map(r => r.discord_id);
  const playersById = await fetchPlayersById(env, playerIds);
  const participants = (rows.results || []).map(r => ({
    ...r,
    display_name: playersById[r.discord_id]?.display_name || playersById[r.discord_id]?.username || 'Player',
    avatar_url: avatarUrlFor(playersById[r.discord_id]),
  }));

  return jsonResponse(200, { match, participants }, env, origin);
}

// ---------- Route: GET /leaderboard ----------------------------------

async function handleGetLeaderboard(request, env, origin) {
  const url = new URL(request.url);
  const slice    = url.searchParams.get('slice')   || 'all';
  const sort     = url.searchParams.get('sort')    || 'wins';
  const loadout  = url.searchParams.get('loadout') || '';
  const map      = url.searchParams.get('map')     || '';
  const limit    = Math.min(Number(url.searchParams.get('limit') || 100), 500);

  const cacheKey = `leaderboard:${slice}:${sort}:${loadout}:${map}:${limit}`;
  const cached   = await env.CACHE.get(cacheKey, 'json');
  if (cached) return jsonResponse(200, { entries: cached, cached: true }, env, origin);

  // Sort column whitelist (avoid SQL injection via untrusted ORDER BY).
  const sortColumn = ({
    wins:     'total_wins',
    kills:    'total_kills',
    matches:  'total_matches',
    damage:   'total_damage',
  })[sort] || 'total_wins';

  // For now, the per-loadout / per-map / time-slice filters are not yet
  // wired ; v1 returns global all-time top-N. Filters layer on later
  // (would need to query match_participants joined to players, with
  // matches.started_at filter for time slices).
  const result = await env.DB.prepare(`
    SELECT discord_id, username, display_name, avatar_hash,
           total_matches, total_wins, total_kills, total_deaths, total_damage
    FROM players
    WHERE total_matches > 0
    ORDER BY ${sortColumn} DESC, total_kills DESC
    LIMIT ?
  `).bind(limit).all();

  const entries = (result.results || []).map(p => ({
    discord_id:   p.discord_id,
    display_name: p.display_name || p.username,
    avatar_url:   avatarUrlFor(p),
    matches:      p.total_matches,
    wins:         p.total_wins,
    kills:        p.total_kills,
    deaths:       p.total_deaths,
    damage:       p.total_damage,
    kd:           p.total_deaths > 0 ? +(p.total_kills / p.total_deaths).toFixed(2) : p.total_kills,
  }));

  await env.CACHE.put(cacheKey, JSON.stringify(entries), { expirationTtl: LEADERBOARD_TTL_SEC });
  return jsonResponse(200, { entries, cached: false }, env, origin);
}

// ---------- Route: GET /player/:id -----------------------------------

async function handleGetPlayer(env, origin, discordId) {
  const player = await env.DB.prepare(`
    SELECT * FROM players WHERE discord_id = ?
  `).bind(discordId).first();
  if (!player) return jsonResponse(404, { error: 'player_not_found' }, env, origin);

  const loadoutStats = await env.DB.prepare(`
    SELECT * FROM player_loadout_stats WHERE discord_id = ? ORDER BY matches DESC
  `).bind(discordId).all();

  const recentMatches = await env.DB.prepare(`
    SELECT m.id, m.started_at, m.ended_at, m.map_key, m.winning_team, m.duration_sec,
           mp.team, mp.loadout_key, mp.kills, mp.deaths, mp.is_winner, mp.is_mvp
    FROM matches m
    JOIN match_participants mp ON mp.match_id = m.id
    WHERE m.validated = 1 AND mp.discord_id = ? AND mp.reported_by = ?
    ORDER BY m.started_at DESC
    LIMIT 20
  `).bind(discordId, discordId).all();

  const achievements = await env.DB.prepare(`
    SELECT type, achieved_at, match_id FROM achievements
    WHERE discord_id = ? ORDER BY achieved_at DESC
  `).bind(discordId).all();

  return jsonResponse(200, {
    player: {
      ...player,
      avatar_url: avatarUrlFor(player),
    },
    loadout_stats: loadoutStats.results || [],
    recent_matches: recentMatches.results || [],
    achievements: achievements.results || [],
  }, env, origin);
}

// ---------- Routes: rooms (lobby browser) -----------------------------

async function handlePostHeartbeat(request, env, origin) {
  const user = await requireAuth(request);
  let body;
  try { body = await request.json(); } catch (_) { throw new ApiError(400, 'invalid_json'); }
  if (!body.room_code) throw new ApiError(400, 'missing_room_code');

  const entry = {
    code:         String(body.room_code),
    host_id:      user.id,
    host_name:    user.global_name || user.username,
    host_avatar:  user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=32` : null,
    map_key:      body.map_key || '',
    player_count: Number(body.player_count || 1),
    version:      String(body.version || ''),
    last_seen:    Date.now(),
  };
  await env.ROOMS.put('room:' + entry.code, JSON.stringify(entry), { expirationTtl: ROOM_TTL_SEC });
  return jsonResponse(200, { ok: true }, env, origin);
}

async function handleDeleteRoom(request, env, origin, code) {
  const user = await requireAuth(request);
  const existing = await env.ROOMS.get('room:' + code, 'json');
  if (!existing) return jsonResponse(404, { error: 'room_not_found' }, env, origin);
  if (existing.host_id !== user.id) return jsonResponse(403, { error: 'not_host' }, env, origin);
  await env.ROOMS.delete('room:' + code);
  return jsonResponse(200, { ok: true }, env, origin);
}

async function handleGetRooms(env, origin) {
  const list = await env.ROOMS.list({ prefix: 'room:' });
  const now  = Date.now();
  const rooms = [];
  for (const k of list.keys) {
    const r = await env.ROOMS.get(k.name, 'json');
    if (!r) continue;
    if (now - r.last_seen > RECENT_ROOM_WINDOW_MS) continue;
    rooms.push(r);
  }
  rooms.sort((a, b) => b.last_seen - a.last_seen);
  return jsonResponse(200, { rooms }, env, origin);
}

// ---------- Route: DELETE /me ----------------------------------------

async function handleDeleteMe(request, env, origin) {
  const user = await requireAuth(request);
  // Scrub the player row + their match participation entries +
  // achievements + per-loadout aggregates. Keep matches themselves
  // (immutable historical records) but our user no longer appears in
  // them. Player leaderboard rank vanishes.
  await env.DB.prepare('DELETE FROM player_loadout_stats WHERE discord_id = ?').bind(user.id).run();
  await env.DB.prepare('DELETE FROM achievements           WHERE discord_id = ?').bind(user.id).run();
  await env.DB.prepare('DELETE FROM match_participants    WHERE discord_id = ? OR reported_by = ?').bind(user.id, user.id).run();
  await env.DB.prepare('DELETE FROM players                WHERE discord_id = ?').bind(user.id).run();
  await invalidateLeaderboardCache(env);
  return jsonResponse(200, { ok: true, scrubbed: true }, env, origin);
}

// ---------- Helpers --------------------------------------------------

async function fetchPlayersById(env, ids) {
  if (!ids.length) return {};
  const placeholders = ids.map(() => '?').join(',');
  const result = await env.DB.prepare(
    `SELECT discord_id, username, display_name, avatar_hash FROM players WHERE discord_id IN (${placeholders})`
  ).bind(...ids).all();
  const map = {};
  for (const p of (result.results || [])) map[p.discord_id] = p;
  return map;
}

function avatarUrlFor(player) {
  if (!player) return null;
  if (player.avatar_hash) {
    return `https://cdn.discordapp.com/avatars/${player.discord_id}/${player.avatar_hash}.png?size=64`;
  }
  // Default avatar based on Discord's modulo system.
  const idx = (BigInt(player.discord_id || '0') >> 22n) % 6n;
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

// ---------- Router ---------------------------------------------------

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // CORS preflight.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, origin) });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // --- Routes ---
      if (request.method === 'POST'   && path === '/auth/verify')  return await handleAuthVerify(request, env, origin);
      if (request.method === 'POST'   && path === '/match')        return await handlePostMatch(request, env, origin);
      if (request.method === 'GET'    && path.startsWith('/match/')) {
        const id = decodeURIComponent(path.slice('/match/'.length));
        return await handleGetMatch(env, origin, id);
      }
      if (request.method === 'GET'    && path === '/leaderboard')  return await handleGetLeaderboard(request, env, origin);
      if (request.method === 'GET'    && path.startsWith('/player/')) {
        const id = decodeURIComponent(path.slice('/player/'.length));
        return await handleGetPlayer(env, origin, id);
      }
      if (request.method === 'POST'   && path === '/heartbeat')    return await handlePostHeartbeat(request, env, origin);
      if (request.method === 'DELETE' && path.startsWith('/room/')) {
        const code = decodeURIComponent(path.slice('/room/'.length));
        return await handleDeleteRoom(request, env, origin, code);
      }
      if (request.method === 'GET'    && path === '/rooms')        return await handleGetRooms(env, origin);
      if (request.method === 'DELETE' && path === '/me')           return await handleDeleteMe(request, env, origin);

      // Health check (handy for monitoring + verifying deploys).
      if (request.method === 'GET' && path === '/health') {
        return jsonResponse(200, { ok: true, ts: Date.now() }, env, origin);
      }

      return jsonResponse(404, { error: 'not_found', path }, env, origin);
    } catch (err) {
      if (err instanceof ApiError) {
        return jsonResponse(err.status, { error: err.code, detail: err.detail }, env, origin);
      }
      console.error('[lss-backend] unexpected error:', err && err.stack || err);
      return jsonResponse(500, { error: 'internal_error', detail: String(err && err.message || err) }, env, origin);
    }
  },
};
