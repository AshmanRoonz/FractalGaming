# LSS Lobby + Invite Design

## Goal

When a player has the game open and is signed in with Discord:
1. Their Discord identity (id, username, avatar) is broadcast as "playing LSS"
2. Other players see a list of who's playing, with availability badges
3. Anyone in the list can send an invite to anyone else
4. Recipients see a non-blocking toast in-game; click to expand into Accept / Ignore
5. Accept routes them into the inviter's Trystero room

Works the same whether the recipient is in solo or multi.

## Architecture overview

```
Browser (your game)
  ↕  (OAuth redirect via existing leaderboard flow OR fresh)
Discord OAuth
  ↕  (HTTPS, JSON, fetch)
Cloudflare Worker  (existing for leaderboards; new endpoints alongside)
  ↕  (KV store, 30-90s TTL on entries)
Cloudflare KV  (free tier, plenty for thousands of presence entries)
```

No new infrastructure; new endpoints on your existing Worker, new keys in your existing KV (or a new namespace if you want isolation).

## Data shapes

### Player presence (KV: `presence:<discordUserId>`, TTL 30s)

```json
{
  "id": "discord_user_id_string",
  "username": "Ashroney",
  "avatar": "https://cdn.discordapp.com/avatars/.../...png",
  "team": "A" | "B" | null,
  "ship": "BLASTER" | "SYPHON" | ...,
  "status": "lobby" | "warmup" | "playing" | "round_end" | "match_end",
  "mode": "solo" | "multi",
  "roomId": "trystero_room_id" | null,
  "roomFull": false,
  "matchSize": { "current": 1, "max": 4 },
  "available": true,                // can be invited (computed below)
  "lastSeen": 1714500000000          // server time on heartbeat write
}
```

`available` rule: `mode === 'solo' OR (mode === 'multi' AND roomFull === false AND status !== 'round_end')`. Server can compute this on read so the client doesn't lie.

### Invite (KV: `invite:<id>`, TTL 60s)

```json
{
  "id": "uuid",
  "fromId": "discord_id_of_inviter",
  "fromUsername": "Ashroney",
  "fromAvatar": "https://...",
  "toId": "discord_id_of_target",
  "roomId": "trystero_room_id",      // the inviter's current room
  "createdAt": 1714500000000,
  "expiresAt": 1714500060000
}
```

## Worker endpoints

All calls assume Discord OAuth bearer in `Authorization: Bearer <token>` so the Worker can verify identity. Worker exchanges token with Discord's `/users/@me` endpoint once and caches the result.

| Method | Path | Body | Returns | Notes |
|---|---|---|---|---|
| POST | `/lobby/heartbeat` | presence (without `available` and `lastSeen`) | `{ ok: true }` | Called every 15s by the game while open. Worker stamps `lastSeen` and writes KV with 30s TTL. |
| GET  | `/lobby/list` | (none) | `[ presence, presence, ... ]` | Returns all keys matching `presence:*` whose `lastSeen` is recent. Auto-filters expired entries. |
| POST | `/lobby/invite` | `{ toId, roomId }` | `{ id, expiresAt }` | Creates an invite KV entry. Worker pulls `fromId/fromUsername/fromAvatar` from the bearer token's user. |
| GET  | `/lobby/invites` | (none) | `[ invite, invite, ... ]` | Returns all invites where `toId === self`, not yet expired. Game polls every 3s. |
| POST | `/lobby/invite/:id/accept` | (none) | `{ ok, roomId }` | Marks invite consumed (delete from KV). Returns the roomId so the game can join it via Trystero. |
| POST | `/lobby/invite/:id/ignore` | (none) | `{ ok }` | Deletes the invite. |
| POST | `/lobby/leave` | (none) | `{ ok }` | Optional: deletes own presence eagerly when player closes the tab. |

Total: 6 endpoints, ~250-350 lines of Worker code.

## Game-side UI

### Lobby panel (existing settings overlay or new section)

A new tab in the existing settings panel: **Lobby**. Shows:

- "Sign in with Discord" button if not signed in
- After sign-in: a `<table>` of all players from `/lobby/list`:
  - Avatar, username, ship icon, status badge, room size if multi
  - Invite button (disabled if `available === false`)
- Auto-refresh every 5s while the panel is open
- Self-row pinned at top with a "Go invisible" toggle (sets a flag the heartbeat respects)

Doesn't gate gameplay; you can play without ever signing in.

### Toast notification (in-game)

Lives in a fixed-position div that's z-indexed above the cockpit but below modal overlays. Stacks downward as multiple invites come in.

Each toast:

```
┌───────────────────────────────────────┐
│ [avatar]  Bob is inviting you         │
│ to a multiplayer match                │
│                                       │
│ [Accept]  [Ignore]                    │
└───────────────────────────────────────┘
```

Auto-dismisses on a 60s countdown bar at the bottom (matches invite TTL). Click anywhere on the toast (other than buttons) opens a fuller dialog with the inviter's loadout / current room status.

Polling: game calls `/lobby/invites` every 3s while signed in. New invites that weren't in the previous response spawn toasts. Already-shown invites that disappeared from the list (timed out or accepted/ignored elsewhere) auto-fade.

### Accept flow

1. Click Accept on toast
2. Game POST `/lobby/invite/:id/accept` → gets back `roomId`
3. If currently in solo: drop the bot match, switch to multi mode
4. If currently in a multi room: leave that room cleanly first
5. Trystero `joinRoom('lss-' + roomId)` ; existing peer handshake handles the rest

### Ignore flow

1. Click Ignore on toast
2. Toast slides out
3. Game POST `/lobby/invite/:id/ignore`
4. Same invite from the same player can re-arrive after a configurable cooldown (server side, optional)

## Auth tradeoffs

Decision pending. Two options:

### Reuse existing leaderboard auth

**Pros:**
- Single sign-in for the whole game
- One source of truth for "is this player Discord-authenticated"
- Less code; the lobby just calls `getDiscordIdentity()` from whatever the leaderboard already uses
- One Discord OAuth app to maintain

**Cons:**
- Coupling: lobby + leaderboard share an identity layer; bug in one could affect the other
- If the leaderboard auth flow is brittle (e.g. tied to a specific page state), the lobby may inherit that
- I need to read the existing auth code to wire correctly

**Recommended if** the leaderboard auth already produces a Discord token + user object that's accessible globally in the game.

### Fresh OAuth for this feature

**Pros:**
- Self-contained: the lobby module owns its identity
- Easier to remove later or migrate to a different auth provider
- Doesn't depend on me understanding existing code

**Cons:**
- User has to sign in twice (once for leaderboards, once for lobby)
- Two OAuth apps in Discord developer portal to maintain
- Possibly two access tokens floating around in browser storage

**Recommended if** the existing leaderboard auth doesn't expose a clean "give me the Discord identity" API.

**My lean: reuse**, but I need a 5-minute look at how the leaderboard auth surfaces the identity. If there's already a `window.LSS_DISCORD_USER` or equivalent, this is trivial.

## Open questions / decisions before code

1. **Privacy default**: should signed-in players be visible to everyone by default, or opt-in via a "go public" toggle?
2. **Invite cooldown**: should the same inviter be unable to spam the same target? (e.g. 30s cooldown server-side)
3. **Friends list**: do you want a friends-only filter on the lobby, or is it always "everyone playing"?
4. **Mid-match invites**: if you're in a tight 4v4, do you want the toast to suppress until round end? Or always show?
5. **Rate limiting**: heartbeats every 15s × 100 players × 24/7 = ~57k requests/day. Well under the Cloudflare free tier. Invite polls every 3s × 100 = ~290k/day per player ; this scales worse. Want me to use Server-Sent Events or WebSockets instead so push replaces poll?
6. **Identity persistence**: token in `localStorage`, `sessionStorage`, or HttpOnly cookie? `localStorage` is simplest but bad for security; cookie is best but needs the Worker to handle it.
7. **Anti-grief**: any block / mute mechanism, or out of scope for v1?

## Iteration plan

- v1: auth + presence + list + invite toast + accept/ignore. ~2 hours of game work + 1 hour of Worker work after design lock.
- v2: friends-only filter, in-match suppression, rate-limited invites
- v3: WebSockets or SSE for real-time invite delivery instead of polling
- v4: rich presence (show what music style, what ship, what map you're on)

## Pitfalls I'm watching for

- Discord token expiration mid-session: handle re-auth silently when a 401 comes back from the Worker
- Player closes tab without calling `/lobby/leave`: TTL expiry handles it but they linger for ~30s
- Race condition: two players accept the same invite simultaneously (highly unlikely in practice; Worker can mark accepted atomically with a conditional KV write)
- Trystero room handoff: leaving a multi room mid-match needs a clean teardown; I'll use the existing round-wipe code path

## Next steps

If this design looks right, my asks before I start coding:
1. Worker base URL + how you want me to add routes (separate file? extend an existing handler?)
2. Discord OAuth client_id (or confirmation that I should use a fresh one)
3. Sample fetch call from the existing leaderboard so I can see the auth pattern
4. Decisions on the open questions above (especially #1 privacy default and #5 push vs poll)
