# LSS Backend Plan ; Discord Identity + Cloudflare D1

Last updated: 2026-05-02
Status: SHIPPED (verified 2026-05-08)
Supersedes: most of LSS_discord-plan.md (Discord channels are no longer the data store ; this plan is the new architectural truth)

> **Archive note (2026-05-08):** A code audit confirmed every route in this
> plan is implemented in `backend/src/worker.js`: `/auth/verify`, `/match`
> POST + `/match/:id`, `/leaderboard` (with slice/sort/loadout/map filters),
> `/player/:id` career, `/heartbeat`, `/room/:code` DELETE, `/rooms` list,
> `/me` scrub. `last_ship_sailing_v14.html` calls `/heartbeat` every 30s and
> POSTs match results on round end. The static stats site
> (`leaderboard.html`, `profile.html`, `rooms.html`) exists on disk. D1
> schema + three migrations are in place. Discord OAuth identity is wired
> into the lobby (v10).
>
> Original plan content preserved below for historical reference.

## Why this plan exists

The earlier Discord plan (LSS_discord-plan.md) used Discord channels as the persistence layer ; match results posted to channels, leaderboards reconstructed by parsing channel history, lobby browser by reading recent heartbeat messages. The reasoning was "zero infrastructure, Discord stores it all for free."

That reasoning broke the moment we accepted a Cloudflare Worker as the webhook proxy (necessary because webhook URLs cannot live in public HTML). Once we have any Worker, we already have the option of a real backend, and a real backend is meaningfully better than parsing Discord messages every time someone opens the leaderboard.

The Activities pivot a couple of sessions later confirmed the broader direction: LSS is fundamentally a full-window browser game (VR support, fullscreen, gamepad-heavy controls) that does not fit Discord's embedded-app model. Discord stays as the identity provider and the community hub ; everything else moves to a proper website + Cloudflare backend.

This plan is what we build instead.

## Vision

LSS is a serverless P2P browser game with a small custom backend. Identity is Discord (one-click signin, recognized avatars, no signup friction). Persistence is Cloudflare D1 (real SQLite database at the edge, free tier easily covers expected scale). Stats, leaderboards, profiles, and lobby browser live as static HTML pages on lss.fractalreality.ca that fetch from a Worker API.

The result is a game with real career tracking, permanent shareable profile URLs, fast SQL-backed queries, and rich custom UI for stats ; all without running a server we administer, and without forcing the data into Discord's channel model.

Discord is preserved for what it's actually good at: identity (OAuth) and community (the LSS Discord server). Optional notification posts to Discord channels are kept as a thin community-engagement layer (championship wins, big milestones), but they're outputs, not storage.

## Architecture

```
       ┌──────────────────────────────────┐
       │  lss.fractalreality.ca            │
       │  (GitHub Pages, static)           │
       │                                   │
       │  index.html      ; the game       │
       │  leaderboard.html                 │
       │  profile.html?id=...              │
       │  match.html?id=...                │
       │  rooms.html                       │
       │  maps.html (later)                │
       └─────────────┬────────────────────┘
                     │
                     │  fetch(api.lss.fractalreality.ca/...)
                     ▼
       ┌──────────────────────────────────┐
       │  Cloudflare Workers               │
       │  api.lss.fractalreality.ca/*      │
       │                                   │
       │  POST /match           write      │
       │  POST /heartbeat       write      │
       │  GET  /leaderboard     read       │
       │  GET  /player/:id      read       │
       │  GET  /match/:id       read       │
       │  GET  /rooms           read       │
       │  DELETE /me            scrub      │
       │  POST /auth/verify     bouncer    │
       └─────────────┬────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                          │
        ▼                          ▼
  ┌──────────┐            ┌──────────────┐
  │  D1      │            │  KV          │
  │  SQLite  │            │  cache       │
  │  (stats) │            │  (rooms,     │
  │          │            │   top10)     │
  └──────────┘            └──────────────┘
        │
        │  optional: post big moments to Discord
        ▼
  ┌──────────────────────────────────────┐
  │  Discord webhooks (notifications)    │
  │  (#highlights, #championships)       │
  │  one-way, fire-and-forget             │
  └──────────────────────────────────────┘

  ┌──────────────────────────────────────┐
  │  Discord OAuth (PKCE)                │
  │  identity only ; no data storage     │
  │  (already in v10)                    │
  └──────────────────────────────────────┘
```

## Tech stack

- **Static hosting**: GitHub Pages at lss.fractalreality.ca (no migration needed). Optionally Cloudflare Pages later for better edge cache.
- **Identity**: Discord OAuth via PKCE (already shipped in v10, no Client Secret needed).
- **API**: Cloudflare Workers, free tier (100k requests/day, way more than we need).
- **Database**: Cloudflare D1 (edge SQLite), free tier 5GB storage / 100k row reads-day / 100k row writes-day.
- **Cache**: Cloudflare KV for hot reads (top-10 leaderboard, current room list).
- **Optional CDN**: Cloudflare R2 for ship GLBs / audio if GitHub Pages bandwidth ever becomes an issue. Not needed at launch.
- **Optional notifications**: existing Discord webhook proxy Worker, repurposed to fire on big moments only.

## D1 schema (initial)

```sql
-- Players: one row per Discord user that has ever signed in.
-- Updated on signin (display_name + avatar_hash may change).
CREATE TABLE players (
  discord_id     TEXT PRIMARY KEY,
  username       TEXT NOT NULL,
  display_name   TEXT,
  avatar_hash    TEXT,
  created_at     INTEGER NOT NULL,    -- ms epoch
  last_seen      INTEGER NOT NULL,    -- ms epoch
  total_matches  INTEGER DEFAULT 0,
  total_wins     INTEGER DEFAULT 0,
  total_kills    INTEGER DEFAULT 0,
  total_deaths   INTEGER DEFAULT 0,
  total_damage   INTEGER DEFAULT 0
);
CREATE INDEX idx_players_last_seen ON players(last_seen);

-- Matches: one row per completed match (after consensus).
-- A match becomes "validated" when all participants have submitted
-- matching results ; only validated matches are counted in stats.
CREATE TABLE matches (
  id             TEXT PRIMARY KEY,        -- deterministic from room + round
  started_at     INTEGER NOT NULL,
  ended_at       INTEGER NOT NULL,
  map_key        TEXT NOT NULL,
  winning_team   INTEGER,                 -- 2 (Fleet A) or 3 (Fleet B), null for draw
  duration_sec   REAL,
  validated      INTEGER NOT NULL DEFAULT 0,  -- 0=pending, 1=validated, 2=disputed
  participant_count INTEGER NOT NULL
);
CREATE INDEX idx_matches_started ON matches(started_at);
CREATE INDEX idx_matches_validated ON matches(validated);

-- Match participants: one row per player per match.
-- Stats here roll up into players.* on validation.
CREATE TABLE match_participants (
  match_id       TEXT NOT NULL,
  discord_id     TEXT NOT NULL,
  team           INTEGER NOT NULL,
  loadout_key    TEXT NOT NULL,           -- SLAYER, BLASTER, TRACKER, etc.
  kills          INTEGER NOT NULL DEFAULT 0,
  deaths         INTEGER NOT NULL DEFAULT 0,
  damage_dealt   INTEGER NOT NULL DEFAULT 0,
  damage_taken   INTEGER NOT NULL DEFAULT 0,
  is_mvp         INTEGER NOT NULL DEFAULT 0,
  is_winner      INTEGER NOT NULL DEFAULT 0,
  reported_by    TEXT NOT NULL,            -- discord_id of reporter
  signature      TEXT,                     -- optional signed payload
  PRIMARY KEY (match_id, discord_id, reported_by)
);
CREATE INDEX idx_mp_player ON match_participants(discord_id);
CREATE INDEX idx_mp_loadout ON match_participants(loadout_key);

-- Optional: achievements unlocked per player.
CREATE TABLE achievements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id     TEXT NOT NULL,
  type           TEXT NOT NULL,           -- 'first_win', 'sword_block_master', etc.
  achieved_at    INTEGER NOT NULL,
  match_id       TEXT,
  metadata_json  TEXT
);
CREATE INDEX idx_ach_player ON achievements(discord_id);
```

Rooms live in KV instead of D1, since they're ephemeral and have a TTL:

```
KV namespace: ROOMS
key:   room:<room_code>
value: { host_id, map_key, player_count, version, last_seen }
TTL:   90 seconds (auto-expire if no heartbeat)
```

Top-10 leaderboard cached in KV with a 60-second TTL:

```
KV namespace: CACHE
key:   leaderboard:<slice>:<sort>
value: JSON [{ discord_id, display_name, avatar_url, ... }]
TTL:   60 seconds
```

## Worker API endpoints

Single Worker (`api.lss.fractalreality.ca`) handles all routes. Auth is via the `Authorization: Bearer <discord_token>` header that the game already has from PKCE signin.

### Auth helper

`POST /auth/verify`
- Body: empty
- Headers: `Authorization: Bearer <discord_token>`
- Validates the token via Discord's `/users/@me`, upserts the player row, returns canonical user object.
- Used by every authenticated endpoint internally; rarely called directly by the game.

### Match writes

`POST /match`
- Headers: `Authorization: Bearer <discord_token>`
- Body:
  ```json
  {
    "match_id": "deterministic_hash",
    "started_at": 1714694400000,
    "ended_at":   1714694520000,
    "map_key": "hourglass",
    "winning_team": 2,
    "duration_sec": 120.0,
    "participants": [
      { "discord_id": "...", "team": 2, "loadout_key": "SLAYER",
        "kills": 12, "deaths": 3, "damage_dealt": 8400, "damage_taken": 5100,
        "is_mvp": 1, "is_winner": 1 }
    ]
  }
  ```
- The Worker validates the token, checks that the reporter is in the participants list, writes one row per participant to `match_participants` (with reporter set to caller's discord_id).
- Once all participants have reported and their results agree, the match is marked validated and player career totals get rolled up.
- If results disagree, match is marked disputed (validated=2) and ignored from leaderboards.

### Reads

`GET /leaderboard?slice=all|monthly|weekly|daily&loadout=SLAYER&map=hourglass&sort=kills|wins|kd&limit=100`
- Returns ranked players. Cached in KV with 60s TTL, cache key derived from query params.
- Default: all-time, all loadouts, all maps, sorted by wins, top 100.

`GET /player/:discord_id`
- Returns: `{ player, recent_matches: [...], achievements: [...], per_loadout_stats: {...} }`
- Cached briefly (30s) per player.

`GET /match/:match_id`
- Returns full match detail: winner, duration, all participants with their stats.
- Cached aggressively (1 hour) ; matches are immutable once validated.

`GET /rooms`
- Returns active rooms from KV (filtered by recency).
- No auth required ; lobby browser is public.

`POST /heartbeat`
- Headers: `Authorization: Bearer <discord_token>`
- Body: `{ room_code, map_key, player_count, version }`
- Writes/refreshes a KV entry with the player as host. TTL 90s.
- Hosts call this every 30s while their room is open.

`DELETE /room/:code`
- Headers: `Authorization: Bearer <discord_token>`
- Removes a room from KV (host explicitly closing).

### Privacy / GDPR

`DELETE /me`
- Headers: `Authorization: Bearer <discord_token>`
- Scrubs the calling user from the database: deletes player row, match_participants entries, and achievements. Match rows are kept (immutable historical records) but their participants for this user are removed.
- Returns confirmation.

### Optional: highlight notifications

`POST /highlight` (internal, called from the Worker itself when validating a match)
- If a validated match has a notable moment (championship win, 30+ kill round, longest range hit, etc.), the Worker fires a webhook to the existing Discord `#highlights` channel with a formatted embed.
- This is the only place the existing Discord webhook proxy logic survives ; everything else is pure D1.

## Static pages on lss.fractalreality.ca

Plain HTML files, vanilla JS, no build step. Each fetches from the Worker API and renders.

### `/leaderboard.html`

Top-N table of players. Filters: ship loadout, map, time period (all-time, monthly, weekly, daily). Sortable columns. Click player name → goes to their profile. Click match link → goes to match detail.

### `/profile.html?id=<discord_id>`

Player career page. Header: avatar + display name + total stats. Sections: per-loadout breakdown, recent matches, achievements. Permanent shareable URL.

### `/match.html?id=<match_id>`

Match detail page. Header: map, duration, winning team. Body: full participant table with kills/deaths/damage/MVP, sortable. Could later add kill timeline, damage charts, etc.

### `/rooms.html`

Live lobby browser. Auto-refreshes every 10s. Shows: room code, map, player count, host name, "join" button (which copies the room code to clipboard or deeplinks into the game with `?room=<code>`).

### `/maps.html` (later)

Per-map statistics: average duration, win rate by team, popular ship loadouts, average kills per match.

### `/about.html` (later)

What LSS is, who made it, links to Discord, links to GitHub if/when public, credits.

### Existing pages (unchanged)

- `/` ; the game (index.html, currently v10 in dev)
- `/terms.html` ; Terms of Service
- `/privacy.html` ; Privacy Policy (will need updating to mention D1 storage)

## Game-side integration (in the v10/v11 HTML)

Three things the game needs to do beyond what v10 already does:

1. **On match-end, every participant POSTs their match-result JSON to the Worker.**
   ```js
   await fetch('https://api.lss.fractalreality.ca/match', {
     method: 'POST',
     headers: {
       'Authorization': 'Bearer ' + discordToken,
       'Content-Type': 'application/json',
     },
     body: JSON.stringify(matchResultPayload),
   });
   ```

2. **While hosting a room, send heartbeats every 30s.**
   ```js
   setInterval(() => {
     if (!net.isHost || !signedInToDiscord) return;
     fetch('https://api.lss.fractalreality.ca/heartbeat', {
       method: 'POST',
       headers: { 'Authorization': 'Bearer ' + discordToken, 'Content-Type': 'application/json' },
       body: JSON.stringify({
         room_code: net.roomCode,
         map_key: game.selectedMap,
         player_count: net.peers.size + 1,
         version: 'v10',
       }),
     });
   }, 30000);
   ```

3. **In-game stats screen pulls from the Worker.**
   ```js
   const me = await fetch('https://api.lss.fractalreality.ca/player/' + discordUser.id).then(r => r.json());
   renderStatsScreen(me);
   ```

That's it. Three fetch patterns, no other architectural changes to the game itself.

## Privacy implications

The Privacy Policy needs an update. Current text says "we don't run a database." Under this architecture that's no longer true. The new wording will be honest:

- We collect Discord user identity via OAuth (id, username, display_name, avatar_hash) ; same as before.
- We additionally store match results in our Cloudflare D1 instance: each match's metadata (start, end, map, winner) and each participant's stats (kills, deaths, damage, loadout, team).
- We do NOT collect: email, IP address, anything beyond what's listed.
- Storage: D1 instance owned by the developer, hosted on Cloudflare's edge.
- Deletion: `DELETE /me` API endpoint scrubs all your data on demand.
- Discord channels are NOT used for data storage anymore, only for OAuth and (optionally) highlight notifications you can mute / leave the channel to opt out of.

The privacy story is still strong by industry standards: minimal data, free tier infrastructure, deletion on demand, single jurisdiction (Canada).

## Roadmap

### Phase 1: Cloudflare D1 + Worker API (one weekend)

1. Provision D1 database via wrangler. Run the schema migration.
2. Provision KV namespaces for ROOMS and CACHE.
3. Write the Worker (one file, ~200-300 lines): all routes above.
4. Set custom domain `api.lss.fractalreality.ca` for the Worker.
5. Test each endpoint with curl / browser console.

### Phase 2: Game-side match posting (one evening)

6. In v10 (or v11), add `postMatchResult()` that fires on match-end with the user's Discord token.
7. Add error handling: if user isn't signed into Discord, just skip (game still works, just no leaderboard contribution).
8. Test: play a match, confirm a row appears in D1.

### Phase 3: Leaderboard page (one evening)

9. Create `/leaderboard.html` with vanilla JS that fetches from the Worker.
10. Render top-N table with avatars, names, stats.
11. Add filter dropdowns (loadout, map, time period).
12. Wire sortable columns.

### Phase 4: Profile page (one evening)

13. Create `/profile.html?id=...` ; fetches from Worker, renders player header + stats + recent matches.
14. Link from leaderboard to profile.

### Phase 5: Match detail page (couple of hours)

15. Create `/match.html?id=...` ; fetches and renders match scoreboard.
16. Link from profile recent-matches list and from leaderboard match references.

### Phase 6: Lobby browser (one evening)

17. Add heartbeat fire-and-forget to the host's game loop.
18. Create `/rooms.html` with auto-refreshing room list.
19. "Join" button deep-links into the game with `?room=<code>` pre-filled.

### Phase 7: In-game stats screen (one evening)

20. Update the existing scoreboard / stats UI in v10 to fetch career stats from the Worker (instead of just showing per-match numbers).
21. Show "view full profile" link that opens `/profile.html?id=me` in a new tab.

### Phase 8: Privacy update (15 minutes)

22. Edit `privacy.html` to reflect the new D1 storage with deletion endpoint.

### Phase 9: Optional polish

23. Highlight notifications: Worker fires Discord webhook on big moments.
24. Achievements system: schema is already there, define triggers.
25. Maps page with per-map stats.
26. About page.
27. Cloudflare Web Analytics for traffic visibility.

## What from previous work carries over

- ✅ Discord OAuth (PKCE) in v10 ; identity layer is done.
- ✅ Cloudflare account + Worker familiarity ; Worker proxy code we wrote becomes a starting point for the new API.
- ✅ Domain on lss.fractalreality.ca ; same hosting.
- ✅ Discord application ID, OAuth redirect URIs, App Tester / verification work ; OAuth keeps working.
- ✅ Terms + Privacy HTML pages ; valid, just need a privacy update for D1.
- ⚠️ Existing webhook proxy Worker ; gets retired or repurposed for highlight notifications only.
- ❌ The four Discord channel webhooks ; not needed anymore (might keep #highlights for optional notifications). Can delete the others to clean up.
- ❌ The activity/ stub folder ; deprecated, can leave in repo as a "we tried" or delete.

## Open questions

- **Hosting choice for the Workers.** Stay on Cloudflare (current). No reason to move.
- **Custom Worker domain.** `api.lss.fractalreality.ca` requires CNAME setup. Five-minute task. Worth doing on Phase 1 so the API URL is final from the start.
- **Match consensus model.** Strict (all participants must agree before validation) is the recommended default. Loosen to majority later if real-world drops cause too many "disputed" matches.
- **Anti-cheat trust level.** Read-time consensus catches honest reporting differences but a determined cheater could get a friend to co-sign. For ranked play later, we'd add cryptographic per-participant signatures backed by a key derived from the OAuth flow. Defer until ranked is a real feature.
- **Discord notifications scope.** Only #highlights for big moments? Or also auto-post every match? Friction-vs-noise tradeoff. Default: #highlights only, opt-in for per-match.
- **Achievements design.** The schema is in place. Defer the actual achievement triggers (first_win, killing_spree, etc.) until the basics work.
- **Tournaments.** Not in this plan ; would be a future overlay on top (one D1 table, a Worker endpoint or two, a tournament page).

## What this means for the LSS_discord-plan.md

That earlier plan is now mostly historical. The tier 0 channels-as-database architecture is replaced by this D1-backed architecture. The Activities path (tier 0 also) is dead per the popup-pivot conversation. What carries over from the Discord plan:

- PKCE OAuth signin (already shipped in v10).
- The Cloudflare Worker proxy infrastructure (repurposed).
- Optional highlights via webhook (one channel, one-way notifications).

Everything else from the Discord plan ; channels-as-database, slash commands, lobby browser via channel heartbeats, read-time consensus over channel history ; is replaced by the D1 + Worker pattern in this plan.

The Discord plan stays in the repo as the prior thinking, with a note pointing here.

---

License: same as the rest of LSS-related design docs in this repo. Internal planning document.
