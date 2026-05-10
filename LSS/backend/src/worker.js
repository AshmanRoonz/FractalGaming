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
// (v15 lobby) Presence TTL = 2x heartbeat interval, so a single missed beat
// doesn't drop the player. Heartbeat-rate limit gives 5s of slack vs the
// 30s client cadence ; rejects calls < 25s apart per user with 429.
const PRESENCE_TTL_SEC      = 60;
const HEARTBEAT_MIN_GAP_MS  = 25_000;
const LOBBY_LIST_DEFAULT_CAP = 100;
const LOBBY_LIST_MAX_CAP     = 250;   // hard ceiling for ?limit param
// (v15 lobby) Invite + cooldown constants per design_lobby_invite.md.
const INVITE_TTL_SEC         = 90;            // invite expires if no action
// Cloudflare KV requires expirationTtl >= 60 ; the original spec started
// the ladder at 30s which threw a 500 on KV.put. Rounded up to 60s for the
// first level ; the rest stay on the design doc curve.
const COOLDOWN_LADDER_SEC    = [60, 90, 150, 240];
const COOLDOWN_AGE_TTL_SEC   = 604800;        // 7-day memory of repeat spammers
// (v15 step 6) Lobby room (separate from the legacy `room:` heartbeat
// rooms used by the live-rooms browser). 30 min TTL covers any normal
// match length ; touch on every room write (join / leave / scoop /
// state change) so active rooms never expire mid-match.
const LOBBY_ROOM_TTL_SEC     = 1800;
const LOBBY_ROOM_MAX_SIZE    = 6;
const LOBBY_ROOM_CODE_LEN    = 4;

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

// True if a discord_id looks like a real Discord snowflake (humans),
// false for synthetic IDs we generate for bots / unsigned peers.
// Synthetic prefixes: bot:, peer:, local:.
function isHumanDiscordId(id) {
  if (!id) return false;
  return !id.includes(':');
}

// After every match POST we check: have all expected human participants
// reported, AND do their reports agree? If yes, validate + roll up.
// If reports are in but disagree, mark disputed. Bots / unsigned peers
// don't report (no token), so consensus uses human_count, not the
// total participant_count.
async function tryValidateMatch(env, matchId) {
  const matchRow = await env.DB.prepare('SELECT * FROM matches WHERE id = ?').bind(matchId).first();
  if (!matchRow) return;
  if (matchRow.validated !== 0) return;     // already settled

  const reports = await env.DB.prepare(`
    SELECT * FROM match_participants WHERE match_id = ?
  `).bind(matchId).all();
  if (!reports.results) return;

  // Group by reporter. Only HUMAN reporters count toward consensus ;
  // bots / unsigned peers can't post, so we expect exactly
  // matchRow.human_count reports each covering all participant_count
  // participants.
  const byReporter = new Map();
  for (const r of reports.results) {
    if (!isHumanDiscordId(r.reported_by)) continue; // shouldn't happen ; defensive
    if (!byReporter.has(r.reported_by)) byReporter.set(r.reported_by, []);
    byReporter.get(r.reported_by).push(r);
  }

  if (byReporter.size < matchRow.human_count) return; // still waiting
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
  // for non-batch APIs, but each upsert is atomic). Career totals are
  // tracked three ways: combined (total_*) + solo-mode + multiplayer-
  // mode. The mode-specific columns drive separate solo / mp leaderboards.
  const now = Date.now();
  await env.DB.prepare(`
    UPDATE matches SET validated = 1, validated_at = ? WHERE id = ?
  `).bind(now, matchId).run();

  const isMp = (matchRow.mode === 'multiplayer');

  for (const [discordId, snap] of canonical) {
    // Skip non-human participants ; they don't have player rows and
    // their stats live only in match_participants for the historical
    // record (so the match scoreboard renders correctly).
    if (!isHumanDiscordId(discordId)) continue;

    // Bump player career totals (combined + mode-specific).
    if (isMp) {
      await env.DB.prepare(`
        UPDATE players
        SET total_matches = total_matches + 1,
            total_wins    = total_wins    + ?,
            total_kills   = total_kills   + ?,
            total_deaths  = total_deaths  + ?,
            total_damage  = total_damage  + ?,
            mp_matches    = mp_matches    + 1,
            mp_wins       = mp_wins       + ?,
            mp_kills      = mp_kills      + ?,
            mp_deaths     = mp_deaths     + ?,
            mp_damage     = mp_damage     + ?
        WHERE discord_id = ?
      `).bind(
        snap.is_winner ? 1 : 0,
        snap.kills, snap.deaths, snap.damage_dealt,
        snap.is_winner ? 1 : 0,
        snap.kills, snap.deaths, snap.damage_dealt,
        discordId,
      ).run();
    } else {
      await env.DB.prepare(`
        UPDATE players
        SET total_matches = total_matches + 1,
            total_wins    = total_wins    + ?,
            total_kills   = total_kills   + ?,
            total_deaths  = total_deaths  + ?,
            total_damage  = total_damage  + ?,
            solo_matches  = solo_matches  + 1,
            solo_wins     = solo_wins     + ?,
            solo_kills    = solo_kills    + ?,
            solo_deaths   = solo_deaths   + ?,
            solo_damage   = solo_damage   + ?
        WHERE discord_id = ?
      `).bind(
        snap.is_winner ? 1 : 0,
        snap.kills, snap.deaths, snap.damage_dealt,
        snap.is_winner ? 1 : 0,
        snap.kills, snap.deaths, snap.damage_dealt,
        discordId,
      ).run();
    }

    // Per-match peaks + floors (combined + mode-specific). Splits the
    // SET list across two prefixes ; the mode column-prefix gets the
    // same value as the combined columns, since this match is one or
    // the other (never both).
    const modePrefix = isMp ? 'mp_' : 'solo_';
    await env.DB.prepare(`
      UPDATE players SET
        max_kills_match  = max(max_kills_match,  ?),
        min_kills_match  = min(coalesce(min_kills_match, ?),  ?),
        max_deaths_match = max(max_deaths_match, ?),
        min_deaths_match = min(coalesce(min_deaths_match, ?), ?),
        max_damage_match = max(max_damage_match, ?),
        min_damage_match = min(coalesce(min_damage_match, ?), ?),
        ${modePrefix}max_kills_match  = max(${modePrefix}max_kills_match,  ?),
        ${modePrefix}min_kills_match  = min(coalesce(${modePrefix}min_kills_match, ?),  ?),
        ${modePrefix}max_deaths_match = max(${modePrefix}max_deaths_match, ?),
        ${modePrefix}min_deaths_match = min(coalesce(${modePrefix}min_deaths_match, ?), ?),
        ${modePrefix}max_damage_match = max(${modePrefix}max_damage_match, ?),
        ${modePrefix}min_damage_match = min(coalesce(${modePrefix}min_damage_match, ?), ?)
      WHERE discord_id = ?
    `).bind(
      // combined
      snap.kills,        snap.kills,        snap.kills,
      snap.deaths,       snap.deaths,       snap.deaths,
      snap.damage_dealt, snap.damage_dealt, snap.damage_dealt,
      // mode-specific
      snap.kills,        snap.kills,        snap.kills,
      snap.deaths,       snap.deaths,       snap.deaths,
      snap.damage_dealt, snap.damage_dealt, snap.damage_dealt,
      // WHERE
      discordId,
    ).run();

    // Bump per-loadout aggregates (combined across modes for now ;
    // could split solo/mp here later if useful).
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

  // Compute mode + human_count from participants. Humans are real
  // Discord IDs without our synthetic prefixes (bot:, peer:, local:).
  const humanCount = body.participants.filter(p => isHumanDiscordId(p.discord_id)).length;
  const mode = humanCount >= 2 ? 'multiplayer' : 'solo';

  // Insert / update the match row (idempotent on match_id).
  await env.DB.prepare(`
    INSERT INTO matches (id, started_at, ended_at, map_key, winning_team, duration_sec, participant_count, mode, human_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).bind(
    String(body.match_id),
    Number(body.started_at),
    Number(body.ended_at),
    String(body.map_key),
    body.winning_team == null ? null : Number(body.winning_team),
    body.duration_sec == null ? null : Number(body.duration_sec),
    body.participants.length,
    mode,
    humanCount,
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
  // mode = multiplayer (default) | solo | combined.
  const modeRaw  = (url.searchParams.get('mode') || 'multiplayer').toLowerCase();
  const mode     = (modeRaw === 'solo' || modeRaw === 'combined') ? modeRaw : 'multiplayer';

  const cacheKey = `leaderboard:${mode}:${slice}:${sort}:${loadout}:${map}:${limit}`;
  const cached   = await env.CACHE.get(cacheKey, 'json');
  if (cached) return jsonResponse(200, { mode, entries: cached, cached: true }, env, origin);

  // Pick the column-prefix that matches the requested mode.
  // mode=multiplayer (default): mp_*  , mode=solo: solo_*, mode=combined: total_*.
  const colPrefix  = mode === 'solo' ? 'solo_' : mode === 'combined' ? 'total_' : 'mp_';
  const matchesCol = colPrefix + 'matches';
  const winsCol    = colPrefix + 'wins';
  const killsCol   = colPrefix + 'kills';
  const deathsCol  = colPrefix + 'deaths';
  const damageCol  = colPrefix + 'damage';

  // Sort column whitelist (avoid SQL injection via untrusted ORDER BY).
  const sortColumn = ({
    wins:     winsCol,
    kills:    killsCol,
    matches:  matchesCol,
    damage:   damageCol,
  })[sort] || winsCol;

  // Per-match peak / floor column names mirror the mode prefix.
  const maxKillsCol  = colPrefix + 'max_kills_match';
  const minKillsCol  = colPrefix + 'min_kills_match';
  const maxDeathsCol = colPrefix + 'max_deaths_match';
  const minDeathsCol = colPrefix + 'min_deaths_match';
  const maxDamageCol = colPrefix + 'max_damage_match';
  const minDamageCol = colPrefix + 'min_damage_match';

  // Per-loadout / per-map / time-slice filters not yet wired ; v1
  // returns global all-time top-N for the chosen mode.
  const result = await env.DB.prepare(`
    SELECT discord_id, username, display_name, avatar_hash,
           ${matchesCol} AS matches_, ${winsCol} AS wins_,
           ${killsCol} AS kills_, ${deathsCol} AS deaths_, ${damageCol} AS damage_,
           ${maxKillsCol}  AS max_kills_,  ${minKillsCol}  AS min_kills_,
           ${maxDeathsCol} AS max_deaths_, ${minDeathsCol} AS min_deaths_,
           ${maxDamageCol} AS max_damage_, ${minDamageCol} AS min_damage_
    FROM players
    WHERE ${matchesCol} > 0
    ORDER BY ${sortColumn} DESC, ${killsCol} DESC
    LIMIT ?
  `).bind(limit).all();

  const entries = (result.results || []).map(p => decoratePlayerStats(p));

  await env.CACHE.put(cacheKey, JSON.stringify(entries), { expirationTtl: LEADERBOARD_TTL_SEC });
  return jsonResponse(200, { mode, entries, cached: false }, env, origin);
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

  // Build per-mode decorated stat blocks so the profile page can render
  // separate Solo / Multiplayer / Combined cards without doing the math
  // client-side. For 'combined' mode, kills/wins/etc. live under
  // total_*, but max/min peaks live under unprefixed names ; for solo
  // and mp, all columns share the prefix.
  const modeStats = {};
  for (const m of ['combined', 'solo', 'mp']) {
    const aggPre  = m === 'combined' ? 'total_' : (m + '_');
    const peakPre = m === 'combined' ? ''       : (m + '_');
    modeStats[m] = decoratePlayerStats({
      discord_id:    player.discord_id,
      username:      player.username,
      display_name:  player.display_name,
      avatar_hash:   player.avatar_hash,
      matches_:      player[aggPre  + 'matches'],
      wins_:         player[aggPre  + 'wins'],
      kills_:        player[aggPre  + 'kills'],
      deaths_:       player[aggPre  + 'deaths'],
      damage_:       player[aggPre  + 'damage'],
      max_kills_:    player[peakPre + 'max_kills_match'],
      min_kills_:    player[peakPre + 'min_kills_match'],
      max_deaths_:   player[peakPre + 'max_deaths_match'],
      min_deaths_:   player[peakPre + 'min_deaths_match'],
      max_damage_:   player[peakPre + 'max_damage_match'],
      min_damage_:   player[peakPre + 'min_damage_match'],
    });
  }

  return jsonResponse(200, {
    player: {
      ...player,
      avatar_url: avatarUrlFor(player),
    },
    stats: modeStats,
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

// Build the public leaderboard / player API response for a player row.
// Expects the SQL alias columns: matches_, wins_, kills_, deaths_,
// damage_, max_/min_ peaks. Computes derived fields (avg, kd, win_rate,
// losses) so callers don't have to. Safe against zero matches.
function decoratePlayerStats(p) {
  const matches = p.matches_ || 0;
  const wins    = p.wins_    || 0;
  const losses  = Math.max(0, matches - wins);
  const kills   = p.kills_   || 0;
  const deaths  = p.deaths_  || 0;
  const damage  = p.damage_  || 0;
  const round1  = (n) => Math.round(n * 10) / 10;
  const round2  = (n) => Math.round(n * 100) / 100;
  return {
    discord_id:   p.discord_id,
    display_name: p.display_name || p.username,
    avatar_url:   avatarUrlFor(p),
    matches,
    wins,
    losses,
    win_rate:    matches > 0 ? round2(wins / matches) : 0,
    kills,
    deaths,
    damage,
    kd:          deaths > 0 ? round2(kills / deaths) : kills,
    avg_kills:   matches > 0 ? round1(kills  / matches) : 0,
    avg_deaths:  matches > 0 ? round1(deaths / matches) : 0,
    avg_damage:  matches > 0 ? Math.round(damage / matches) : 0,
    max_kills:   p.max_kills_  || 0,
    min_kills:   p.min_kills_  == null ? null : p.min_kills_,
    max_deaths:  p.max_deaths_ || 0,
    min_deaths:  p.min_deaths_ == null ? null : p.min_deaths_,
    max_damage:  p.max_damage_ || 0,
    min_damage:  p.min_damage_ == null ? null : p.min_damage_,
  };
}

// ---------- (v15 lobby) Lobby + room scaffolding stubs ---------------
//
// Step 2 of the v15 lobby implementation. These are placeholder handlers
// that validate auth and return sensible JSON shapes so the v15 client can
// hit them from devtools and confirm the route plumbing + CORS + Discord
// token validation work end-to-end. Step 3 will replace each stub body
// with the actual KV reads/writes per design_lobby_invite.md.
//
// All handlers require Authorization: Bearer <discord_token> ; the
// requireAuth helper above hits Discord /users/@me and returns the user
// object. Stubs echo identity back so the client can verify "yes, the
// worker saw me as the right Discord user."

// Compute server-side `available` + `scoopable` flags from a presence
// record. Centralized so /lobby/list and any future fan-out reuse the
// same logic. v15 rule: solo players are invitable (available:true) but
// NOT scoopable. Multi players with an open lobby seat are both available
// and scoopable. Anyone in warmup/playing/round_end/match_end is busy.
function computeLobbyFlags(p) {
  const status = p && p.status;
  const mode   = p && p.mode;
  const roomFull = !!(p && p.roomFull);
  // Solo (in a bots match) : invitable, never scoopable.
  if (mode === 'solo') {
    return { available: true, scoopable: false };
  }
  // Multi mode rules :
  //   - 'browsing' : sitting on the main menu, hasn't opted into matchmaking
  //     yet (might be tweaking settings / leaderboards). Invitable, NOT
  //     scoopable. Becomes scoopable when they explicitly Quick Match or
  //     enter a public room with open seats.
  //   - 'lobby' / 'looking' / 'idle' : actively waiting for a match ; both
  //     invitable AND scoopable (open to be filled into a partial room).
  //   - any 'in-match' status (warmup / playing / round_end / match_end) or
  //     a full room : not available.
  if (mode === 'multi') {
    if (status === 'browsing') return { available: true, scoopable: false };
    if (!roomFull && (status === 'lobby' || status === 'looking' || status === 'idle' || !status)) {
      return { available: true, scoopable: true };
    }
  }
  return { available: false, scoopable: false };
}

async function handleLobbyHeartbeat(request, env, origin) {
  const user = await requireAuth(request);
  let body = {};
  try { body = await request.json(); } catch (_) { throw new ApiError(400, 'invalid_json'); }

  // Rate limit : reject calls less than HEARTBEAT_MIN_GAP_MS apart per user
  // so a buggy or malicious client can't inflate the bill. 5s slack vs the
  // 30s client cadence handles legitimate jitter.
  const key = 'presence:' + user.id;
  const existing = await env.ROOMS.get(key, 'json');
  const now = Date.now();
  if (existing && existing.lastSeen && (now - existing.lastSeen) < HEARTBEAT_MIN_GAP_MS) {
    return jsonResponse(429, {
      error: 'too_many_heartbeats',
      retryAfter: Math.ceil((HEARTBEAT_MIN_GAP_MS - (now - existing.lastSeen)) / 1000),
    }, env, origin);
  }

  // Avatar URL : same shape as the leaderboard / room heartbeat already use.
  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
    : null;

  const presence = {
    id:        user.id,
    username:  user.global_name || user.username,
    avatar:    avatarUrl,
    ship:      typeof body.ship === 'string' ? body.ship : null,
    team:      (body.team === 'A' || body.team === 'B') ? body.team : null,
    status:    typeof body.status === 'string' ? body.status : 'lobby',
    mode:      (body.mode === 'multi') ? 'multi' : 'solo',
    roomId:    typeof body.roomId === 'string' ? body.roomId : null,
    roomFull:  !!body.roomFull,
    matchSize: (body.matchSize && typeof body.matchSize === 'object')
                 ? { current: Number(body.matchSize.current || 1), max: Number(body.matchSize.max || 6) }
                 : { current: 1, max: 6 },
    lastSeen:  now,
  };
  await env.ROOMS.put(key, JSON.stringify(presence), { expirationTtl: PRESENCE_TTL_SEC });
  return jsonResponse(200, { ok: true }, env, origin);
}

async function handleLobbyList(request, env, origin) {
  const user = await requireAuth(request);
  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(1, parseInt(url.searchParams.get('limit') || String(LOBBY_LIST_DEFAULT_CAP), 10) || LOBBY_LIST_DEFAULT_CAP),
    LOBBY_LIST_MAX_CAP,
  );
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

  const list = await env.ROOMS.list({ prefix: 'presence:' });
  const players = [];
  // KV.list returns key metadata only ; one .get per key for the full
  // record. Worker free tier handles a few hundred keys per request fine.
  for (const k of list.keys) {
    const p = await env.ROOMS.get(k.name, 'json');
    if (!p) continue;
    const flags = computeLobbyFlags(p);
    players.push({ ...p, ...flags });
  }
  // Sort: available first, then alpha by username for stable display.
  players.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    const an = (a.username || '').toLowerCase();
    const bn = (b.username || '').toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
  const total = players.length;
  const page  = players.slice(offset, offset + limit);

  // (v15) Bundle this user's pending invites into the same response so the
  // client's existing 5s list poll handles invite delivery. Replaces the
  // SSE-stream design from the v12 doc ; works without Durable Objects.
  // Worst-case latency : 5s (one poll cycle).
  const inviteList = await env.ROOMS.list({ prefix: 'invite:' + user.id + ':' });
  const invites = [];
  for (const k of inviteList.keys) {
    const inv = await env.ROOMS.get(k.name, 'json');
    if (inv) invites.push(inv);
  }
  invites.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  // (v15 step 6) Also tell the caller which room they're in (server side).
  // Client compares to its current Trystero state on each poll ; if the
  // server says they're in a room they aren't yet connected to (e.g.,
  // they got scooped), the client auto-joins via Trystero. Up to 5 s
  // latency, no SSE / push needed.
  const myRoom = await _roomFindForUser(env, user.id);

  return jsonResponse(200, {
    players: page, total, limit, offset, invites,
    me: { id: user.id, room: myRoom },
  }, env, origin);
}

async function handleLobbyLeave(request, env, origin) {
  const user = await requireAuth(request);
  await env.ROOMS.delete('presence:' + user.id);
  return jsonResponse(200, { ok: true }, env, origin);
}

// ---------- Invite flow (v15 lobby) ----------------------------------

// Generate a short random invite ID.
function _newInviteId() {
  // 12 random hex chars ≈ 48 bits ; collision-resistant for transient invites.
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

async function handleLobbyInvite(request, env, origin) {
  const user = await requireAuth(request);
  let body = {};
  try { body = await request.json(); } catch (_) { throw new ApiError(400, 'invalid_json'); }
  const toId = String(body.toId || '');
  if (!toId) throw new ApiError(400, 'missing_to_id');
  if (toId === user.id) throw new ApiError(400, 'self_invite');

  // Confirm the recipient is actually online + available so we don't waste
  // a slot on a phantom invite. Their roomFull / status may have changed
  // between client-side render and the click ; the client will hide the
  // button if they go busy, but we double-check here.
  const targetPresence = await env.ROOMS.get('presence:' + toId, 'json');
  if (!targetPresence) {
    return jsonResponse(404, { error: 'recipient_offline' }, env, origin);
  }
  const targetFlags = computeLobbyFlags(targetPresence);
  if (!targetFlags.available) {
    return jsonResponse(409, { error: 'recipient_busy' }, env, origin);
  }

  // Cooldown ladder check : same inviter -> same target.
  const cdKey  = 'cooldown:' + user.id + ':' + toId;
  const ageKey = 'cooldownAge:' + user.id + ':' + toId;
  const now    = Date.now();
  const active = await env.ROOMS.get(cdKey, 'json');
  if (active) {
    // Worker KV doesn't expose remaining TTL ; store expiresAt on the
    // record itself and compute retryAfter from there.
    const remainingMs = Math.max(0, (active.expiresAt || 0) - now);
    return jsonResponse(429, {
      error: 'cooldown',
      retryAfter: Math.ceil(remainingMs / 1000),
    }, env, origin);
  }
  // Look up persistent ladder level (7-day memory).
  const ageRec = await env.ROOMS.get(ageKey, 'json');
  const level  = ageRec ? Math.min((ageRec.level || 0) + 1, COOLDOWN_LADDER_SEC.length) : 1;
  const ttlSec = COOLDOWN_LADDER_SEC[Math.min(level, COOLDOWN_LADDER_SEC.length) - 1];
  const cdExpiresAt = now + ttlSec * 1000;
  await env.ROOMS.put(cdKey, JSON.stringify({ level, lastInviteAt: now, expiresAt: cdExpiresAt }),
    { expirationTtl: ttlSec });
  await env.ROOMS.put(ageKey, JSON.stringify({ level, lastInviteAt: now }),
    { expirationTtl: COOLDOWN_AGE_TTL_SEC });

  // Resolve the inviter's current roomId from THEIR presence ; if the
  // client passed one we trust it as a hint, but the source of truth is
  // their presence record. Solo inviters use a deterministic room name
  // built from their discord id.
  const myPresence = await env.ROOMS.get('presence:' + user.id, 'json');
  const myRoomId   = (myPresence && myPresence.roomId)
    ? myPresence.roomId
    : (typeof body.roomId === 'string' && body.roomId)
      ? body.roomId
      : 'lss-' + user.id;

  const id = _newInviteId();
  const expiresAt = now + INVITE_TTL_SEC * 1000;
  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
    : null;
  const invite = {
    id,
    fromId:        user.id,
    fromUsername:  user.global_name || user.username,
    fromAvatar:    avatarUrl,
    toId,
    roomId:        myRoomId,
    createdAt:     now,
    expiresAt,
  };
  // Key prefixed by recipient so /lobby/list can KV.list({ prefix: 'invite:'+self+':'}) cheaply.
  await env.ROOMS.put('invite:' + toId + ':' + id, JSON.stringify(invite), { expirationTtl: INVITE_TTL_SEC });

  return jsonResponse(200, { id, expiresAt }, env, origin);
}

async function handleLobbyInviteAccept(request, env, origin, inviteId) {
  const user = await requireAuth(request);
  const key  = 'invite:' + user.id + ':' + inviteId;
  const inv  = await env.ROOMS.get(key, 'json');
  if (!inv) {
    return jsonResponse(410, { error: 'gone', message: 'Invite expired or already handled.' }, env, origin);
  }
  // Re-read inviter's CURRENT presence ; if they've moved rooms or
  // disappeared, return 410 so the recipient knows the invite is stale
  // rather than landing in an empty Trystero room.
  const inviterPresence = await env.ROOMS.get('presence:' + inv.fromId, 'json');
  if (!inviterPresence) {
    await env.ROOMS.delete(key);
    return jsonResponse(410, { error: 'gone', message: 'The inviter has gone offline.' }, env, origin);
  }

  // (v15 step 6) Resolve the inviter's room server-side. Three cases :
  //   A) Inviter already has a lobby room  → join it (or create if missing)
  //   B) Inviter has no roomId             → mint a fresh private room with
  //                                           both of us as the initial pair
  let room = null;
  if (inviterPresence.roomId) {
    room = await env.ROOMS.get('lobbyroom:' + inviterPresence.roomId, 'json');
  }
  if (!room) {
    // Either no roomId, or the cached room expired ; mint a private one
    // with the inviter as host + the invitee both seeded as players.
    const code = await _roomFreshCode(env);
    room = {
      code,
      hostId:    inv.fromId,
      isPublic:  false,
      players: [
        { id: inv.fromId, username: inv.fromUsername, avatar: inv.fromAvatar },
        _roomPlayerSnapshot(user),
      ],
      maxSize:    LOBBY_ROOM_MAX_SIZE,
      createdAt:  Date.now(),
      lastActive: Date.now(),
    };
    await _roomWrite(env, room);
  } else {
    if (room.players.length >= room.maxSize) {
      return jsonResponse(409, { error: 'room_full' }, env, origin);
    }
    if (!room.players.some(p => p.id === user.id)) {
      room.players.push(_roomPlayerSnapshot(user));
      await _roomWrite(env, room);
    }
  }

  // Cleanup : delete invite + reset the 1:1 cooldown so a future invite
  // from the same person starts fresh at level 1.
  await env.ROOMS.delete(key);
  await env.ROOMS.delete('cooldown:'    + inv.fromId + ':' + user.id);
  await env.ROOMS.delete('cooldownAge:' + inv.fromId + ':' + user.id);

  return jsonResponse(200, { ok: true, roomId: room.code, fromId: inv.fromId, room }, env, origin);
}

async function handleLobbyInviteIgnore(request, env, origin, inviteId) {
  const user = await requireAuth(request);
  const key  = 'invite:' + user.id + ':' + inviteId;
  // Ignore : delete the invite but DO NOT reset the cooldown. Repeat
  // spammers ramp themselves up the ladder.
  await env.ROOMS.delete(key);
  return jsonResponse(200, { ok: true }, env, origin);
}

// ---------- (v15 step 6) Lobby rooms ---------------------------------
//
// Room shape stored at `lobbyroom:<code>` with TTL LOBBY_ROOM_TTL_SEC :
//   { code, hostId, isPublic, players: [{ id, username, avatar }, ...],
//     maxSize, createdAt, lastActive }
//
// Codes are 4 chars from a non-confusable alphabet so they're easy to
// share over Discord ("CFRX" not "Q0OO"). Collision-checked at create.

const _ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function _newRoomCode() {
  const a = new Uint8Array(LOBBY_ROOM_CODE_LEN);
  crypto.getRandomValues(a);
  let s = '';
  for (let i = 0; i < LOBBY_ROOM_CODE_LEN; i++) s += _ROOM_CODE_ALPHABET[a[i] % _ROOM_CODE_ALPHABET.length];
  return s;
}

async function _roomFreshCode(env) {
  // Up to 20 attempts ; collision rate at 4 chars / 32 alphabet is ~1e-6
  // until we have ~1000 active rooms. Plenty of headroom.
  for (let i = 0; i < 20; i++) {
    const c = _newRoomCode();
    const existing = await env.ROOMS.get('lobbyroom:' + c, 'json');
    if (!existing) return c;
  }
  throw new ApiError(503, 'no_room_code_available');
}

function _roomPlayerSnapshot(user) {
  return {
    id:       user.id,
    username: user.global_name || user.username,
    avatar:   user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
      : null,
  };
}

async function _roomWrite(env, room) {
  room.lastActive = Date.now();
  await env.ROOMS.put('lobbyroom:' + room.code, JSON.stringify(room),
    { expirationTtl: LOBBY_ROOM_TTL_SEC });
}

async function _roomCreateNew(env, host, isPublic) {
  const code = await _roomFreshCode(env);
  const room = {
    code,
    hostId:    host.id,
    isPublic:  !!isPublic,
    players:   [_roomPlayerSnapshot(host)],
    maxSize:   LOBBY_ROOM_MAX_SIZE,
    createdAt: Date.now(),
    lastActive: Date.now(),
  };
  await _roomWrite(env, room);
  return room;
}

async function _roomFindForUser(env, userId) {
  // Linear scan ; rooms count is small (matches in flight). KV.list returns
  // metadata only, one .get per match. Same shape as the legacy
  // handleGetRooms scan, so we stay consistent.
  const list = await env.ROOMS.list({ prefix: 'lobbyroom:' });
  for (const k of list.keys) {
    const r = await env.ROOMS.get(k.name, 'json');
    if (!r) continue;
    if (r.players && r.players.some(p => p.id === userId)) return r;
  }
  return null;
}

async function handleRoomsCreate(request, env, origin) {
  const user = await requireAuth(request);
  let body = {};
  try { body = await request.json(); } catch (_) {}
  const isPublic = body.isPublic !== false; // default public
  const room = await _roomCreateNew(env, user, isPublic);
  return jsonResponse(200, { room }, env, origin);
}

async function handleRoomsJoin(request, env, origin) {
  const user = await requireAuth(request);
  let body = {};
  try { body = await request.json(); } catch (_) { throw new ApiError(400, 'invalid_json'); }
  const code = String(body.code || '').toUpperCase();
  if (!code) throw new ApiError(400, 'missing_code');
  const room = await env.ROOMS.get('lobbyroom:' + code, 'json');
  if (!room) return jsonResponse(404, { error: 'room_not_found' }, env, origin);
  if (room.players.length >= room.maxSize) return jsonResponse(409, { error: 'room_full' }, env, origin);
  if (!room.players.some(p => p.id === user.id)) {
    room.players.push(_roomPlayerSnapshot(user));
    await _roomWrite(env, room);
  }
  return jsonResponse(200, { room }, env, origin);
}

async function handleRoomsQuickmatch(request, env, origin) {
  const user = await requireAuth(request);
  // Find an open public room with seats. Skip rooms the caller is already in.
  const list = await env.ROOMS.list({ prefix: 'lobbyroom:' });
  for (const k of list.keys) {
    const r = await env.ROOMS.get(k.name, 'json');
    if (!r) continue;
    if (!r.isPublic) continue;
    if (r.players.length >= r.maxSize) continue;
    if (r.players.some(p => p.id === user.id)) continue;
    r.players.push(_roomPlayerSnapshot(user));
    await _roomWrite(env, r);
    return jsonResponse(200, { room: r, joined: true, created: false }, env, origin);
  }
  // No open public rooms ; create one and we're the host waiting for fillers.
  const room = await _roomCreateNew(env, user, true);
  return jsonResponse(200, { room, joined: false, created: true }, env, origin);
}

async function handleRoomsLeave(request, env, origin) {
  const user = await requireAuth(request);
  let body = {};
  try { body = await request.json(); } catch (_) {}
  const code = String(body.code || '').toUpperCase();
  if (!code) throw new ApiError(400, 'missing_code');
  const room = await env.ROOMS.get('lobbyroom:' + code, 'json');
  if (!room) return jsonResponse(200, { ok: true, room: null }, env, origin);
  const idx = room.players.findIndex(p => p.id === user.id);
  if (idx >= 0) room.players.splice(idx, 1);
  if (room.players.length === 0) {
    await env.ROOMS.delete('lobbyroom:' + code);
    return jsonResponse(200, { ok: true, room: null }, env, origin);
  }
  if (room.hostId === user.id) {
    // Transfer host to next player so the room stays alive.
    room.hostId = room.players[0].id;
  }
  await _roomWrite(env, room);
  return jsonResponse(200, { ok: true, room }, env, origin);
}

async function handleRoomsScoop(request, env, origin, code) {
  const user = await requireAuth(request);
  const room = await env.ROOMS.get('lobbyroom:' + code, 'json');
  if (!room) throw new ApiError(404, 'room_not_found');
  if (room.hostId !== user.id) throw new ApiError(403, 'not_host');
  if (room.players.length >= room.maxSize) {
    return jsonResponse(200, { room, scooped: 0 }, env, origin);
  }
  // Walk presence : pull MULTI-mode players who are on the multiplayer
  // surface and not already in a room. Per the v15 rule, this is the
  // explicit aggressive path : the host is choosing to recruit, and
  // browsing players are fair game (they're sitting on multiplayer).
  // Auto-fill via /rooms/quickmatch is the passive path that does NOT
  // touch browsing players ; that one only joins existing partial rooms.
  const list = await env.ROOMS.list({ prefix: 'presence:' });
  let scooped = 0;
  for (const k of list.keys) {
    if (room.players.length >= room.maxSize) break;
    const p = await env.ROOMS.get(k.name, 'json');
    if (!p) continue;
    if (p.id === user.id) continue;
    if (p.mode !== 'multi') continue;
    if (p.roomId) continue;                                  // already in some room
    // Only browsing / lobby / looking / idle multi players are scoopable.
    // Anyone in warmup / playing / round_end / match_end is busy.
    if (!(p.status === 'browsing' || p.status === 'lobby' || p.status === 'looking' || p.status === 'idle' || !p.status)) continue;
    if (room.players.some(rp => rp.id === p.id)) continue;
    room.players.push({ id: p.id, username: p.username, avatar: p.avatar });
    scooped++;
  }
  if (scooped > 0) await _roomWrite(env, room);
  return jsonResponse(200, { room, scooped }, env, origin);
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

      // (v15 lobby) Stub routes ; replace bodies in step 3.
      if (request.method === 'POST' && path === '/lobby/heartbeat') return await handleLobbyHeartbeat(request, env, origin);
      if (request.method === 'GET'  && path === '/lobby/list')      return await handleLobbyList(request, env, origin);
      if (request.method === 'POST' && path === '/lobby/leave')     return await handleLobbyLeave(request, env, origin);
      if (request.method === 'POST' && path === '/lobby/invite')    return await handleLobbyInvite(request, env, origin);
      if (request.method === 'POST' && path.startsWith('/lobby/invite/') && path.endsWith('/accept')) {
        const id = decodeURIComponent(path.slice('/lobby/invite/'.length, path.length - '/accept'.length));
        return await handleLobbyInviteAccept(request, env, origin, id);
      }
      if (request.method === 'POST' && path.startsWith('/lobby/invite/') && path.endsWith('/ignore')) {
        const id = decodeURIComponent(path.slice('/lobby/invite/'.length, path.length - '/ignore'.length));
        return await handleLobbyInviteIgnore(request, env, origin, id);
      }
      if (request.method === 'POST' && path === '/rooms/quickmatch') return await handleRoomsQuickmatch(request, env, origin);
      if (request.method === 'POST' && path === '/rooms/create')     return await handleRoomsCreate(request, env, origin);
      if (request.method === 'POST' && path === '/rooms/join')       return await handleRoomsJoin(request, env, origin);
      if (request.method === 'POST' && path === '/rooms/leave')      return await handleRoomsLeave(request, env, origin);
      if (request.method === 'POST' && path.startsWith('/rooms/') && path.endsWith('/scoop')) {
        const code = decodeURIComponent(path.slice('/rooms/'.length, path.length - '/scoop'.length));
        return await handleRoomsScoop(request, env, origin, code);
      }

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
