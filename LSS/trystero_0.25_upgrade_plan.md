# Trystero 0.22.0 to 0.25.0 upgrade plan (Last Ship Sailing)

## Current state
The live file `last_ship_sailing_v27.html` is pinned to `https://esm.sh/trystero@0.22.0/torrent` in two places:

- lobby room, inside `_p2pInit()` (~line 3526)
- match room, inside `joinRoom()` (~line 4609)

This pin was the fix for the earlier breakage, not an upgrade. v20 imported `https://esm.sh/@trystero-p2p/torrent` unpinned, which resolves to the latest published version and so jumped onto the 0.23 rewrite; from v21 on you pinned back to 0.22.0. So the 0.25.0 upgrade has not been done yet; the recent change was the opposite (pinning down to keep multiplayer working).

## What changed 0.22 to 0.25, and whether it touches LSS
- **Package split / import path (0.23.0).** `trystero/<strategy>` is now a deprecated compat path; the current package is `@trystero-p2p/<strategy>`. **Affects LSS:** this is the one real edit (the "cosmetic breaking change" Dan mentioned).
- **`joinRoom(config, roomId, onJoinError)` became `joinRoom(config, roomId, callbacks)` (0.23.0).** **No effect:** both LSS call sites pass only `(config, roomId)`.
- **Relay options consolidated under `relayConfig` (0.24.0).** **No effect:** LSS passes only `appId`, no custom trackers / rtcConfig / turnConfig / password.
- **Action name limit raised 12 to 32 bytes (0.23.0).** **No effect:** all 12 LSS action names are short (`pres`, `pres_q`, `inv`, `inv_a`, `inv_i`, `scoop`, `state`, `hit`, `vote`, `event`, `loadout`, `proj`). Bonus: you could rename to readable names now if you want.
- **`trickleIce` now a public option; Torrent still defaults off (0.23.0).** **No required change;** optionally set `trickleIce: true` to speed up initial connects.
- **Firebase `getOccupants()` removed.** N/A (you use the torrent strategy).
- **New internals (0.23.0): shared `RTCPeerConnection` reuse across rooms + offer pooling/recycling.** **Highest risk for LSS.** LSS keeps the same peers in two rooms at once (lobby + match), which is exactly the scenario this reuse touches. This is the most likely cause of the original breakage and the main thing to test.
- **New features available in 0.25.0 (optional): request/response actions and the `onPeerHandshake` admission layer.** Opportunities, not required for parity (see follow-ups).

## The actual code change (minimal, for parity)
Two edits, both just the import URL. Change:

```js
const trystero = await import('https://esm.sh/trystero@0.22.0/torrent');
```

to:

```js
const trystero = await import('https://esm.sh/@trystero-p2p/torrent@0.25.0');
```

at ~line 3526 and ~line 4609.

Pin the version (`@0.25.0`). Do not import unpinned again; the unpinned specifier is what jumped you onto the rewrite last time. If esm.sh does not resolve the scoped package cleanly, the deprecated-but-published fallback is `https://esm.sh/trystero@0.25.0/torrent` (verify by loading it in the browser console first).

Everything else LSS uses is unchanged in 0.25.0, so no other edits are needed for parity: the 2-arg `joinRoom`, the `[send, receive] = room.makeAction(...)` pattern, `onPeerJoin` / `onPeerLeave`, `room.leave()`, `room.ping()`, and `selfId`.

## Test plan (focus on the two-room path)
1. Copy v27 to a v28-test file; keep v27 live and untouched.
2. Make the two import edits, pinned to 0.25.0.
3. Two devices or browsers: verify lobby presence shows both, invite/accept works, the match handoff completes, and both peers actually connect in the **match** room (not just the lobby). This is the shared-connection-reuse path.
4. Late joiner: have a peer join after the match starts (0.23 changed `onPeerJoin` to replay already-active peers to new handlers).
5. Leave and rejoin a room; confirm a clean reconnect.
6. If connectivity fails: try `trickleIce: true`; check `getRelaySockets()` for dead trackers; capture the console output and a minimal repro and send it to Dan.
7. Only promote to a live v28 after the two-room path passes on two real devices.

## Optional follow-ups (after parity is confirmed)
- **Consensus vote round to request/response.** `room.makeAction('vote', { kind: 'request', onRequest })` plus `requestMany(payload, { targets, timeoutMs, onResult })` would replace the manual broadcast + collect + timeout bookkeeping.
- **`onPeerHandshake`** for an identity / anti-cheat admission gate before peers become active (they stay invisible to `getPeers()`, actions, and `onPeerJoin` until they pass).

## awesome-trystero entry
Repo: https://github.com/jeremyckahn/awesome-trystero (projects are alphabetical; this goes after "Jambox" and before "Litghtsaber"):

```md
- [Last Ship Sailing](https://lss.fractalreality.ca) - Real-time multiplayer naval combat with a custom peer-to-peer consensus layer; just a room code, no game server.
```
