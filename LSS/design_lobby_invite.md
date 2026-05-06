# LSS v12 ; Lobby + Discord Invite Plan (LOCKED, revised after design review)

Implementation target: `last_ship_sailing_v12.html`. This document is the spec the implementing cowork session will follow.

> **Revision note:** the original v1 of this plan was reviewed against the Worker free-tier budget and a few edge cases. The locked decisions below survived intact ; the changes below them (SSE-from-day-one, list pagination, heartbeat rate limit, accept-time inviter revalidation, sign-out affordance, 7-day cooldown memory) are refinements, not reversals.

---

## Decisions locked

| # | Question | Decision |
|---|---|---|
| 1 | Auth | **Reuse existing leaderboard Discord auth.** One sign-in for the whole game. |
| 2 | Privacy | **Signed in == always visible.** No opt-out toggle, no Go Invisible. A prominent "Sign out of lobby" button gives players a one-click exit when they want quiet. |
| 3 | Friends list | **None.** Discord already has friends; we just expose "everyone playing right now." |
| 4 | Mid-match invites | **Queue, don't suppress.** The toast appears even mid-fight; the player chooses when to engage. |
| 5 | Heartbeat interval | **30 seconds.** Server rate-limits to reject heartbeats less than 25s apart per user (5s slack). |
| 6 | Security posture | **Relaxed.** localStorage for the Discord token is fine; this isn't a competitive-economy game. |
| 7 | Anti-grief | **Incremental invite cooldown.** Same inviter → same target: 30s, 1m, 2m, 3m, then plateau at 3m. Resets after target accepts an invite. Cooldown memory persists for **7 days** of inviter silence (not 24h). |
| 8 | Invite delivery | **SSE (Server-Sent Events) from day one**, not 3s polling. The polling math broke the Workers free tier at ~3 concurrent users; SSE keeps a single open connection per signed-in player and pushes invites instantly. |

---

## Architecture overview

```
Browser (last_ship_sailing_v12.html)
  ↕  reuses the existing Discord OAuth flow that powers the leaderboards
Discord OAuth
  ↕  HTTPS, JSON, fetch
Cloudflare Worker  (existing ; new /lobby/* routes added alongside leaderboard routes)
  ↕  KV with TTL on entries
Cloudflare KV  (existing or new namespace)
```

No new infrastructure. New endpoints on your existing Worker, new keys in your existing KV.

---

## Data shapes

### Player presence (KV `presence:<discordUserId>`, TTL 60s)

```json
{
  "id": "discord_user_id_string",
  "username": "Ashroney",
  "avatar": "https://cdn.discordapp.com/avatars/.../...png",
  "ship": "BLASTER" | "SYPHON" | ... | null,
  "team": "A" | "B" | null,
  "status": "lobby" | "warmup" | "playing" | "round_end" | "match_end",
  "mode": "solo" | "multi",
  "roomId": "trystero_room_id" | null,
  "roomFull": false,
  "matchSize": { "current": 1, "max": 4 },
  "available": true,
  "lastSeen": 1714500000000
}
```

`available` is computed server-side on read:
- `mode === 'solo'` → `true`
- `mode === 'multi' AND roomFull === false AND status !== 'round_end' AND status !== 'match_end'` → `true`
- otherwise → `false`

TTL is **60s** (2x the heartbeat interval) so a single missed heartbeat doesn't drop the player from the list.

### Invite (KV `invite:<id>`, TTL 90s)

```json
{
  "id": "uuid",
  "fromId": "discord_id_of_inviter",
  "fromUsername": "Ashroney",
  "fromAvatar": "https://...",
  "toId": "discord_id_of_target",
  "roomId": "trystero_room_id_of_inviter",
  "createdAt": 1714500000000,
  "expiresAt": 1714500090000
}
```

### Cooldown record (KV `cooldown:<fromId>:<toId>`, TTL = current cooldown duration)

```json
{
  "level": 1,                          // 0..3+ ; index into the cooldown ladder
  "lastInviteAt": 1714500000000
}
```

Cooldown ladder (seconds): `[30, 60, 120, 180, 180, 180, ...]`. After **7 days** of no invites between this pair, the level resets to 0 (handled by a 7d TTL on a separate `cooldownAge:<fromId>:<toId>` key). The longer memory means a determined spammer can't simply wait 24h to re-ramp ; "you abused me last week and I haven't forgotten."

---

## Worker endpoints

All endpoints require `Authorization: Bearer <discord_access_token>`. Worker validates by calling Discord `/users/@me` once per session and caching the result for ~5 min.

| Method | Path | Body | Returns | Notes |
|---|---|---|---|---|
| POST | `/lobby/heartbeat` | presence (sans `available`, `lastSeen`) | `{ ok: true }` | Called every **30s** by the game while open. Worker rate-limits to reject calls < 25s apart per user (5s slack). Stamps `lastSeen`, writes KV with 60s TTL. |
| GET  | `/lobby/list` | `?limit=100&offset=0` (optional) | `{ players: [presence, ...], total: N }` | Lists `presence:*` keys, computes `available` server-side, sorts by `available DESC, username ASC`, **caps at 100 entries per response** (default; client can paginate via offset if needed). |
| POST | `/lobby/invite` | `{ toId, roomId }` | `{ id, expiresAt }` OR `{ error: 'cooldown', retryAfter: 30 }` | Worker reads `cooldown:fromId:toId`. If still active, returns 429. Else creates invite, bumps `level`, writes new cooldown with the next-level TTL. |
| GET  | `/lobby/invites/stream` | — | **`text/event-stream`** | **Server-Sent Events**. Long-lived connection per signed-in player. Server pushes `event: invite` when one targets this user, `event: expired` when one ages out, `event: heartbeat` every 30s as keepalive. Client `EventSource` reconnects automatically on drop. Replaces the original 3s polling endpoint. |
| POST | `/lobby/invite/:id/accept` | — | `{ ok, roomId }` OR `{ error: 'gone' }` | Worker re-reads `presence:fromId` and uses the inviter's CURRENT `roomId` ; if the inviter has left or moved on, returns 410 Gone with a friendly message. Atomic delete on success. Resets the cooldown for this `fromId/toId` pair (level → 0, both `cooldown:` and `cooldownAge:` keys cleared). |
| POST | `/lobby/invite/:id/ignore` | — | `{ ok }` | Atomic delete. Does NOT reset cooldown ; ignoring a spammer keeps the ladder ramping. |
| POST | `/lobby/leave` | — | `{ ok }` | Eagerly deletes own presence. Called on `beforeunload`, on the "Sign out of lobby" button click, and on Discord sign-out. |

**Total: 7 endpoints** (was 6 ; +1 for SSE). ~300-400 lines of Worker code.

### Cooldown logic in detail

On `POST /lobby/invite { toId, roomId }`:

```
key   = `cooldown:${fromId}:${toId}`
now   = Date.now()
prev  = await KV.get(key, 'json')   // null if no cooldown active
ageKey = `cooldownAge:${fromId}:${toId}`

let level = 0
if (prev) {
  // Cooldown still active ; tell the inviter to wait.
  return 429 { error: 'cooldown', retryAfter: ttlRemaining(key) }
}
// Look up the persistent level (24h memory).
const ageRec = await KV.get(ageKey, 'json')
level = ageRec ? Math.min(ageRec.level + 1, 4) : 1   // first invite = level 1 (30s)

// LADDER index = level - 1 ; level 1 → 30s, 2 → 60s, 3 → 120s, 4+ → 180s
const LADDER = [30, 60, 120, 180]
const ttl = LADDER[Math.min(level, LADDER.length) - 1]

await KV.put(key, JSON.stringify({ level, lastInviteAt: now }), { expirationTtl: ttl })
await KV.put(ageKey, JSON.stringify({ level }), { expirationTtl: 604800 })  // 7-day memory

// Create the invite.
const inv = { id: uuid(), fromId, fromUsername, fromAvatar, toId, roomId, createdAt: now, expiresAt: now + 90_000 }
await KV.put(`invite:${inv.id}`, JSON.stringify(inv), { expirationTtl: 90 })
return { id: inv.id, expiresAt: inv.expiresAt }
```

On accept: delete `cooldown:fromId:toId` AND `cooldownAge:fromId:toId` so the next invite starts fresh at level 1.

On ignore: delete only the invite, leave the cooldown ladder ticking. Spammers ramp themselves out.

---

## Game-side UI

### Lobby panel (new tab in the existing settings overlay)

Add a "Lobby" button in the settings overlay tab strip. Panel contents:

```
┌───────────────────────────────────────────────┐
│  LOBBY                              [Sign out] │
│                                                │
│  [ Sign in with Discord ]                      │   ← if not signed in
│                                                │
│  ────── OR after sign-in ──────                │
│                                                │
│  You: [avatar] Ashroney        BLASTER • Solo  │
│  ─────────────────────────────────────────     │
│  [avatar] Bob       SYPHON • In Match (3/4)    │
│      [Invite to your match]                    │
│  [avatar] Carol     PYRO   • Solo              │
│      [Invite to your match]                    │
│  [avatar] Dave      VORTEX • Match Full        │
│      (Invite disabled)                         │
│                                                │
│  Showing 47 of 47 players · Auto-refresh 5s    │
└───────────────────────────────────────────────┘
```

- Sign-in button vanishes after auth, replaced with the self-row pinned at top.
- **"Sign out" button in the top-right of the lobby panel.** Calls `POST /lobby/leave`, closes the SSE stream, drops the access token from localStorage. The player vanishes from everyone else's lobby list within ~60s (next presence TTL expiry). They stay signed into Discord proper for leaderboard/profile views ; this button only signs them out of the lobby's discoverability surface. Locked decision #2 ("always visible while signed in") still holds; this is the explicit, prominent way to choose otherwise without losing all Discord-related features.
- List sorted by `available DESC, username ASC`, capped at 100 entries (footer shows total if > 100, e.g. "Showing 100 of 247 players").
- Invite button states:
  - Enabled (green) ; can invite
  - Disabled grey "On cooldown (1m 23s)" ; show retryAfter from the 429
  - Disabled grey "Match full" ; if recipient unavailable
- Single Invite click POSTs `/lobby/invite { toId, roomId: ourCurrentRoom }`. If we're in solo, `roomId` is generated from our Discord id (deterministic) so the recipient joins us. The accept-time re-validation handles the case where we changed rooms between send and accept.

### Toast notification (in-game)

Fixed-position div, top-right corner, z-index above HUD but below modal overlays. Stacks downward.

Each toast:

```
┌────────────────────────────────────┐
│ ▓▓▓▓▓▓▓▓░░░░░░░░  (countdown)      │
│ [avatar] Bob is inviting you       │
│          to a match                │
│                                    │
│ [Accept]    [Ignore]               │
└────────────────────────────────────┘
```

- 90s countdown bar at the top (matches invite TTL)
- Auto-dismisses on countdown end (no action sent to server; invite expires naturally)
- Click anywhere on toast (other than buttons) opens the fuller dialog
- Mid-match: still appears; player can ignore to dismiss instantly without consequence (cooldown still ticks)

Delivery: `EventSource('/lobby/invites/stream')` opens once at sign-in and stays open for the session. Server pushes:
- `event: invite` ; spawn a toast with the payload
- `event: expired` ; auto-fade any toast for that invite id (someone else acted or it timed out)
- `event: heartbeat` ; ignored client-side, just keeps the connection alive
- Browser auto-reconnects on drop (built into EventSource); a `Last-Event-ID` header lets the server replay anything missed during a brief disconnect.

### Accept flow

1. Click Accept on toast
2. POST `/lobby/invite/:id/accept`
3. Server re-reads inviter's current presence and returns either `{ ok, roomId }` (still valid) or `410 Gone` (inviter has left/moved). On 410: toast morphs into a brief error message ("Bob has moved on to a different match") and slides out; no further action.
4. On success, if currently in solo: tear down bot match (use existing match-end cleanup), switch to multi
5. If currently in a multi room: leave that room cleanly (existing teardown path)
6. Trystero `joinRoom('lss-' + roomId)` ; existing peer handshake takes over

### Ignore flow

1. Click Ignore on toast
2. POST `/lobby/invite/:id/ignore`
3. Toast slides out
4. Cooldown ladder advances on the server (next invite from same inviter waits longer)

---

## Auth integration (reusing leaderboard)

The implementing session needs to find the existing leaderboard auth code and expose two things:

```javascript
window.LSS_AUTH = {
  isSignedIn: () => boolean,
  getDiscordIdentity: () => { id, username, avatar, accessToken } | null,
  signIn: () => Promise<identity>,         // triggers OAuth flow
  signOut: () => void,
  onChange: (callback) => unsubscribe,     // notifies on sign-in/out
}
```

If the existing leaderboard code already has an equivalent global, the lobby module just reads from it. If not, the implementing session does a small refactor to surface this.

---

## Identity persistence

Token in `localStorage` under key `lss_discord_token` (or whatever the leaderboard already uses). On token expiry (Worker returns 401), silently retry the OAuth flow.

User explicitly said security is not a concern for this game, so localStorage is fine. No HttpOnly cookies, no Worker-managed sessions.

---

## Polling vs push (decision: SSE for invites in v1)

**Original v1 plan (3s polling) blew the Workers free tier at ~3 concurrent users.** Math:
- Invite-poll alone: 1 player × every 3s = 28,800 requests/day → 100k free-tier ceiling hit at ~3.5 concurrent.

So SSE is promoted to v1. Steady-state cost with the revised pipeline:

| Endpoint | Per player | Total/day at 100 concurrent |
|---|---|---|
| `/lobby/heartbeat` (every 30s) | 2,880/day | 288k |
| `/lobby/list` (every 5s while panel open, est 10% of time) | 1,728/day | 173k |
| `/lobby/invites/stream` (SSE keepalive every 30s) | 2,880/day | 288k |
| Invite-create / accept / ignore (per actual invite) | ~5/day typical | 500/day |

Total ~750k requests/day at 100 concurrent. Comfortably within the **paid tier** ($5/mo for 10M/day) and survives well past the free tier with light usage. The big win vs polling: invite delivery is now instant (no 3s poll latency) and the per-player request rate is 10x lower.

SSE on Cloudflare Workers uses `ReadableStream` with a `text/event-stream` response. Each connection is held open until the client disconnects ; Workers bills wall-clock CPU time, not connection time, so 100 idle long-lived SSE connections cost roughly nothing. The 30s heartbeat events keep middleboxes from killing the connection.

If/when you outgrow this, the next move is **Durable Objects** for invite fanout (one per active player), but that's a v3 concern at significant scale.

---

## List pagination (`/lobby/list`)

`/lobby/list` returns up to 100 players per response by default, server-side sorted `available DESC, username ASC`. The cap exists because:
- Each `KV.list()` call costs CPU + a per-key read for fields like `available`.
- Every signed-in client polls this every 5s while the panel is open.
- An unbounded list grows quadratically in cost as the player base grows.

The 100-player cap is generous for any realistic concurrent population but stops one runaway moment from turning into a Worker bill. Client supports `?limit=N&offset=K` if a future "show all 247 players" view is wanted ; v1 just renders the first 100 and shows "+N more available" if `total > 100`.

---

## Heartbeat rate limiter

`/lobby/heartbeat` rejects calls less than 25s apart per user with HTTP 429 ("too many heartbeats"). Server reads `presence:<fromId>.lastSeen`, compares to `Date.now()`, returns early if the delta is < 25,000ms. Five seconds of slack vs the 30s client cadence so legitimate jitter doesn't trip the limit. Costs one extra KV read per heartbeat (~1ms) and stops a buggy or malicious client from inflating the bill.

---

## Inviter-still-in-room re-validation on accept

Critical edge case the original plan missed: between sending an invite and the recipient accepting, the inviter may have left their room or accepted someone else's invite. The recipient would land in an empty Trystero room and stare at nothing.

`POST /lobby/invite/:id/accept` now does a re-read:

```
1. Load `invite:<id>` from KV; 410 if missing/expired.
2. Load `presence:<inviter.fromId>` from KV.
3. If presence is missing OR presence.roomId !== invite.roomId:
     return 410 { error: 'gone', message: 'The inviter has moved on.' }
4. Else return { ok: true, roomId: presence.roomId }  // use CURRENT roomId, not the cached one
5. Atomic delete invite + clear cooldown.
```

This means the recipient always lands in a room the inviter currently occupies, or gets a clean error toast that says so. Two extra KV reads per accept (~5ms), zero new infrastructure.

---

## File-level scope (what changes in v12)

The implementing session adds approximately:

- **Lobby module** (~400 lines): module-scoped block in v12 HTML containing the API client (fetch wrappers), the polling loops, the lobby panel UI, the toast UI, the accept/ignore handlers
- **Settings panel hook** (~30 lines): one new tab button + container div in the existing settings overlay
- **CSS additions** (~80 lines): toast styles, lobby panel styles
- **Auth integration shim** (~50 lines): the `window.LSS_AUTH` exposure layer if the leaderboard doesn't already provide it
- **Round-state hooks** (~20 lines): heartbeats with current ship/status/roomId pulled from existing game state per beat

Everything contained ; no edits to existing combat/audio/visual systems beyond reading values for heartbeat data.

---

## Worker scope (what to add to your existing worker)

Approximate additions:

- **7 route handlers** (~250 lines): heartbeat, list (with pagination), invite-create, invite-stream (SSE), accept (with revalidation), ignore, leave
- **Auth middleware** (~30 lines): pulls bearer token, hits Discord `/users/@me`, caches the result for 5 min
- **Heartbeat rate limiter** (~10 lines): rejects calls < 25s apart per user
- **Cooldown logic** (~40 lines): the ladder + KV operations described above (7-day memory window)
- **SSE fan-out** (~60 lines): per-user `ReadableStream` controller registry, push on invite-create, send 30s keepalives
- **CORS headers** (~10 lines): allow your game domain ; SSE response also needs `text/event-stream` + appropriate cache headers
- **KV bindings**: 1 namespace (or 2 if you want to isolate from leaderboard data)

---

## Implementation order (for the next cowork session)

1. **Surface auth**: confirm or add `window.LSS_AUTH` interface; verify Discord identity is available globally
2. **Worker scaffolding**: 7 endpoints with stub responses (no KV writes yet); test from devtools
3. **Heartbeat + list**: add the 30s heartbeat with the 25s server-side rate limit; render the lobby panel reading from `/lobby/list` with the 100-entry cap and `Showing N of M` footer
4. **Invite create + cooldown**: wire the Invite button; surface the cooldown ladder errors as the disabled-button text; persist 7-day cooldown memory
5. **Invite stream + toast**: open SSE connection on sign-in; toast component with countdown; accept/ignore handlers; reconnect-on-drop with `Last-Event-ID`
6. **Accept-time revalidation + Trystero room handoff**: accept handler re-reads inviter's current presence, surfaces 410 errors, otherwise joins the inviter's CURRENT room cleanly
7. **Sign-out flow**: lobby panel "Sign out" button calls `/lobby/leave`, closes SSE, clears localStorage
8. **Polish**: avatars, transitions, empty states, sign-in error handling
9. **Manual playtest**: two browsers, both sign in, see each other in the list, invite, accept, end up in same match. Edge case: inviter joins a third party's room before invitee accepts; verify recipient gets 410 not an empty room

Estimated effort: **about a day** depending on how cleanly the existing leaderboard auth surfaces identity. SSE adds ~2 hours over the original polling estimate but saves the request-volume problem from day one.

---

## Out of scope for v12 (catalog for later)

- Durable Objects for invite fanout (v3 ; only relevant past several hundred concurrent)
- Friends-only filter (Discord already has it)
- Block / mute (incremental cooldown handles spam)
- Voice chat (use Discord)
- Rich presence beyond ship + status (could add map name, music style, kill count)
- Lobby chat (out of scope; use Discord)
- Persistent "muted players" list separate from cooldown (ladder + 7d memory should be enough)
- Pagination UI for `/lobby/list` past 100 (server already supports `?limit&offset`; client just shows the first 100 in v1)

---

## Glossary

- **roomId**: a Trystero room name, currently auto-generated per match. For invites we'll use a deterministic-from-discord-id room name when inviter is solo, so the recipient lands in the inviter's room without needing extra plumbing.
- **Cooldown ladder**: per-pair throttle that escalates on repeated invites without acceptance, resets on accept.
- **Identity**: Discord user object { id, username, avatar }. Persisted in localStorage as the token; refreshed silently on 401.
