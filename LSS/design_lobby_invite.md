# LSS v12 ; Lobby + Discord Invite Plan (LOCKED)

Implementation target: `last_ship_sailing_v12.html`. This document is the spec the implementing cowork session will follow.

---

## Decisions locked

| # | Question | Decision |
|---|---|---|
| 1 | Auth | **Reuse existing leaderboard Discord auth.** One sign-in for the whole game. |
| 2 | Privacy | **Signed in == always visible.** No opt-out toggle, no Go Invisible. |
| 3 | Friends list | **None.** Discord already has friends; we just expose "everyone playing right now." |
| 4 | Mid-match invites | **Queue, don't suppress.** The toast appears even mid-fight; the player chooses when to engage. |
| 5 | Heartbeat interval | **30 seconds.** Cuts request volume in half vs the original 15s. |
| 6 | Security posture | **Relaxed.** localStorage for the Discord token is fine; this isn't a competitive-economy game. |
| 7 | Anti-grief | **Incremental invite cooldown.** Same inviter → same target: 30s, 1m, 2m, 3m, then plateau at 3m. Resets after target accepts an invite or after 24h of silence. |

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

Cooldown ladder (seconds): `[30, 60, 120, 180, 180, 180, ...]`. After 24h of no invites between this pair, the level resets to 0 (handled by a 24h TTL on a separate `cooldownAge:<fromId>:<toId>` key).

---

## Worker endpoints

All endpoints require `Authorization: Bearer <discord_access_token>`. Worker validates by calling Discord `/users/@me` once per session and caching the result for ~5 min.

| Method | Path | Body | Returns | Notes |
|---|---|---|---|---|
| POST | `/lobby/heartbeat` | presence (sans `available`, `lastSeen`) | `{ ok: true }` | Called every **30s** by the game while open. Worker stamps `lastSeen` and writes KV with 60s TTL. |
| GET  | `/lobby/list` | — | `[ presence, ... ]` | Returns all `presence:*` keys, computes `available` server-side, sorts by `available DESC, username ASC`. |
| POST | `/lobby/invite` | `{ toId, roomId }` | `{ id, expiresAt }` OR `{ error: 'cooldown', retryAfter: 30 }` | Worker reads `cooldown:fromId:toId`. If still active, returns 429. Else creates invite, bumps `level`, writes new cooldown with the next-level TTL. |
| GET  | `/lobby/invites` | — | `[ invite, ... ]` | All invites where `toId === self`, not yet expired. Game polls every **3s**. |
| POST | `/lobby/invite/:id/accept` | — | `{ ok, roomId }` | Atomic delete; returns `roomId`. Resets the cooldown for this `fromId/toId` pair (level → 0). |
| POST | `/lobby/invite/:id/ignore` | — | `{ ok }` | Atomic delete. Does NOT reset cooldown ; ignoring a spammer keeps the cooldown ramping. |
| POST | `/lobby/leave` | — | `{ ok }` | Optional, called on `beforeunload`. Eagerly deletes own presence. |

**Total: 6 endpoints**. ~250-350 lines of Worker code.

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
await KV.put(ageKey, JSON.stringify({ level }), { expirationTtl: 86400 })  // 24h memory

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
│  LOBBY                                         │
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
│  Auto-refresh every 5s                         │
└───────────────────────────────────────────────┘
```

- Sign-in button vanishes after auth, replaced with the self-row pinned at top
- List sorted by `available DESC, username ASC`
- Invite button states:
  - Enabled (green) ; can invite
  - Disabled grey "On cooldown (1m 23s)" ; show retryAfter from the 429
  - Disabled grey "Match full" ; if recipient unavailable
- Single Invite click POSTs `/lobby/invite { toId, roomId: ourCurrentRoom }`. If we're in solo, `roomId` is generated from our Discord id (deterministic) so the recipient joins us.

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

Polling: game calls `/lobby/invites` every **3s** while signed in. Diff against last response:
- New IDs spawn a toast
- Disappeared IDs auto-fade their toast (someone else accepted/ignored on this device, or it expired)

### Accept flow

1. Click Accept on toast
2. POST `/lobby/invite/:id/accept` → `{ roomId }`
3. If currently in solo: tear down bot match (use existing match-end cleanup), switch to multi
4. If currently in a multi room: leave that room cleanly (existing teardown path)
5. Trystero `joinRoom('lss-' + roomId)` ; existing peer handshake takes over

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

## Polling vs push (decision: poll for v1, SSE in v2 if needed)

Per-player request volume at steady state with 100 simultaneous players:

| Endpoint | Per player | Total/day |
|---|---|---|
| `/lobby/heartbeat` (every 30s) | 2880/day | 288k |
| `/lobby/invites` (every 3s) | 28800/day | 2.88M |
| `/lobby/list` (every 5s while panel open, est 10% of time) | 1728/day | 173k |

Total ~3.4M requests/day at 100 concurrent. **Cloudflare Workers free tier: 100k/day**, paid tier $5/mo for 10M/day. Will need the paid tier or a push protocol if you grow past ~30 concurrent.

v2 should switch `/lobby/invites` to Server-Sent Events to push invites instead of polling. SSE on Cloudflare Workers is supported via the `ReadableStream` response. Cuts the invite poll line entirely.

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

- **6 route handlers** (~200 lines): heartbeat, list, invite-create, invite-poll, accept, ignore
- **Auth middleware** (~30 lines): pulls bearer token, hits Discord `/users/@me`, caches the result for 5 min
- **Cooldown logic** (~40 lines): the ladder + KV operations described above
- **CORS headers** (~10 lines): allow your game domain
- **KV bindings**: 1 namespace (or 2 if you want to isolate from leaderboard data)

---

## Implementation order (for the next cowork session)

1. **Surface auth**: confirm or add `window.LSS_AUTH` interface; verify Discord identity is available globally
2. **Worker scaffolding**: 6 endpoints with stub responses (no KV writes yet); test from devtools
3. **Heartbeat + list**: add the 30s heartbeat; render the lobby panel reading from `/lobby/list`
4. **Invite create + cooldown**: wire the Invite button; surface the cooldown ladder errors as the disabled-button text
5. **Invite poll + toast**: 3s polling; toast component with countdown; accept/ignore handlers
6. **Trystero room handoff**: accept-flow joins the inviter's room cleanly
7. **Polish**: avatars, transitions, empty states, sign-in error handling
8. **Manual playtest**: two browsers, both sign in, see each other in the list, invite, accept, end up in same match

Estimated effort: **half a day to a day** depending on how cleanly the existing leaderboard auth surfaces identity.

---

## Out of scope for v12 (catalog for later)

- Server-Sent Events for invite push (v2)
- Friends-only filter (Discord already has it)
- Block / mute (incremental cooldown handles spam)
- Voice chat (use Discord)
- Rich presence beyond ship + status (could add map name, music style, kill count)
- Lobby chat (out of scope; use Discord)

---

## Glossary

- **roomId**: a Trystero room name, currently auto-generated per match. For invites we'll use a deterministic-from-discord-id room name when inviter is solo, so the recipient lands in the inviter's room without needing extra plumbing.
- **Cooldown ladder**: per-pair throttle that escalates on repeated invites without acceptance, resets on accept.
- **Identity**: Discord user object { id, username, avatar }. Persisted in localStorage as the token; refreshed silently on 401.
