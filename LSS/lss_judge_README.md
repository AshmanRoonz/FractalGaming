# LSS Judge Bot (v0.1)

Passive observer peer + Python cheat-detection brain. The bot joins an LSS
multiplayer room as a third (or fifth) peer, participates in the lobby
handshake so it does not block matches, but never moves, fires, or claims
hits. Everything it sees on the P2P mesh is streamed to a local Python
process that runs deterministic detection rules and logs flagged events.

## Files

| File | What it is |
|---|---|
| `lss_judge.html` | The observer bridge. Open in a browser. |
| `lss_judge_brain.py` | WebSocket server that receives observations and detects. |
| `judge.sqlite` | Auto-created. Stores matches, peers, flags. |
| `judge_replays/` | Auto-created. One JSONL per match, raw stream. |

## Run it

```
pip install websockets
python lss_judge_brain.py
```

In another window: open `lss_judge.html` in a browser. Type the room code,
click **Join Room**. The brain status flips to "connected" when the bridge
links up; the lobby phase widget tracks lobby/starting/launching/playing.

Leave the tab open during matches. Each match writes one JSONL replay and
some rows to `judge.sqlite`.

## Detection rules (v0.1)

All deterministic, aiming for ~0 false positives.

| Rule | Trigger |
|---|---|
| `NAN_POSITION` | Position is NaN / Infinity. |
| `TELEPORT` | Position jump > 3000 u in one tick while alive. |
| `SPEED_VIOLATION` | Sustained speed > base flight speed * 1.6. |
| `FIRE_RATE_VIOLATION` | Two `proj` events closer than weapon cooldown * 0.85. |
| `DAMAGE_MISMATCH` | Hit claim's expected HP+shield drop never appears on target. |
| `RESURRECTION` | Peer broadcasts dead=true then alive=true without spawn protection. |

All rules respect spawn protection and `dead` state to avoid flagging legit
respawns / lobby positions. Rules only fire after the `launch_at` event so
warmup positions do not register.

## Inspect flags

```
sqlite3 judge.sqlite "SELECT match_id, substr(peer_id,1,8), rule, severity, detail
                       FROM flags ORDER BY id DESC LIMIT 20;"
```

To see suspects across matches:

```
sqlite3 judge.sqlite "SELECT substr(peer_id,1,8), rule, COUNT(*) AS n
                       FROM flags GROUP BY peer_id, rule
                       HAVING n > 1 ORDER BY n DESC;"
```

## v27 game-side changes (v27.judge)

`last_ship_sailing_v27.html` was patched to recognize judge peers and
exclude them from every game gate. The judge's loadout broadcast
carries `isJudge: true`; the game flips `peer.isJudge = true` on
receipt and from that point on the judge is invisible to:

- `allPeersReady()` and the lobby ready tally
- `checkAllLoadoutsReady()` and the loadout commit gate
- `_allPeersWarmupReady()` and the shader-warmup gate
- `assignTeamFromPeerOrder()` (judges don't take a team slot)
- The match_start and launch_at proposer election (and the
  receiver-side proposer verification)
- The fleet strip / lobby chips
- The hit-vote quorum (`totalPeers`)
- Night vision attach (judges have no ship)
- `amStasisOwner()` (stasis field ownership election)

Helpers near `function updateLobbyPeers()`: `_peerIsJudge(peer)`,
`nonJudgePeerIds()`, `nonJudgePeerEntries()`, `nonJudgePeerCount()`.
Search the v27 file for `(v27.judge)` to see every change.

## Caveats

- The judge bot still needs `isJudge: true` baked into its loadout
  broadcast for the game to recognize it. Older v27 builds without
  the patch will see the judge as a dead BLASTER named JUDGE and
  treat it as a player ; upgrade game + bot together.
- Fire rate / speed caps mirror `WEAPON_BY_LOADOUT` and `FLIGHT_SPEED`
  in v27. If you tune the game, mirror in `lss_judge_brain.py`.
- Statistical detectors (aim precision, reaction time histograms) need
  baseline data from honest play and are deliberately not included yet.

## Protocol summary

Bridge -> Brain (JSON over WebSocket):

```
{ kind: "match_start_obs", ts, roomCode, judgeId }
{ kind: "peer_join",       ts, peerId }
{ kind: "peer_leave",      ts, peerId }
{ kind: "state",           ts, peerId, data: {px,py,pz,vx,vy,vz,qx,qy,qz,qw,hp,shield,dead,spawnProt,...} }
{ kind: "proj",            ts, peerId, data: {ox,oy,oz,vx,vy,vz,color,...} }
{ kind: "hit",             ts, peerId, data: {shooterId,targetId,hitId,damage,sx,sy,sz} }
{ kind: "vote",            ts, peerId, data: {hitId,valid,voterId} }
{ kind: "loadout",         ts, peerId, data: {loadoutKey,team,discord_name} }
{ kind: "event",           ts, peerId, data: {type, ...} }
{ kind: "match_end_obs",   ts }
```

Brain -> Bridge: nothing (one-way pipe).
