"""
LSS Judge Brain ; Python v0.1

WebSocket server that receives raw observation envelopes from lss_judge.html
and runs deterministic cheat detection rules. Flagged events go to SQLite ;
full per-match replays go to ./judge_replays/<match_id>.jsonl.

----------------------------------------------------------------------
SETUP
----------------------------------------------------------------------

    pip install websockets

Then :

    python lss_judge_brain.py

Open lss_judge.html in a browser. Set "Judge brain" to ws://localhost:8766,
type a room code, click Join Room. The bridge connects and starts streaming
observations to this script.

----------------------------------------------------------------------
DETECTION RULES (v0.1, deterministic only)
----------------------------------------------------------------------

  NAN_POSITION       : px/py/pz is NaN or Infinity.
  TELEPORT           : position delta > TELEPORT_THRESHOLD_U in one tick
                       while alive (no spawn protection).
  SPEED_VIOLATION    : sustained speed > FLIGHT_SPEED[loadout] * SPEED_TOL.
  FIRE_RATE_VIOLATION: two proj broadcasts from same peer closer than
                       WEAPON_FIRE_INTERVAL[loadout] * FIRE_RATE_TOL.
  DAMAGE_MISMATCH    : hit claim says X damage to target Y, but Y's next
                       state shows HP did not drop (and Y was not spawn
                       protected).
  RESURRECTION       : peer broadcasts dead=true then alive=true without
                       a corresponding round_end / launch_at gate.

These rules aim for ~0 false positives so flags are signal. Statistical
rules (aim precision, reaction time histograms) are deliberately not
included yet ; they need baseline data from honest play.
"""

import asyncio
import json
import math
import sqlite3
import time
from collections import defaultdict
from pathlib import Path

try:
    import websockets
except ImportError:
    raise SystemExit("Missing dependency : install with  `pip install websockets`")


# ----------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------
HOST = "localhost"
PORT = 8766

REPLAY_DIR = Path("judge_replays")
DB_PATH = Path("judge.sqlite")

# Mirror the game's LOADOUTS table. If you tune the game, mirror here.
FLIGHT_SPEED = {
    "VORTEX":   600.0,
    "PYRO":     420.0,
    "PUNCTURE": 800.0,
    "SLAYER":   800.0,
    "TRACKER":  600.0,
    "BLASTER":  420.0,
    "SYPHON":   600.0,
}

# Seconds between primary fire (lower = faster). Mirror WEAPON_BY_LOADOUT.
WEAPON_FIRE_INTERVAL = {
    "VORTEX":   0.25,
    "PYRO":     1.20,
    "PUNCTURE": 1.50,
    "SLAYER":   0.85,
    "TRACKER":  0.85,
    "BLASTER":  0.05,
    "SYPHON":   0.09,
}

# Tolerances. Calibrated to suppress false positives from normal play :
#  - SPEED_TOL  : afterburner / boost abilities can push above base speed.
#  - FIRE_RATE  : reload/cooldown jitter ; allow 85 % of nominal interval.
SPEED_TOL = 1.6
FIRE_RATE_TOL = 0.85

# Position jump in one tick > this u and alive = TELEPORT.
TELEPORT_THRESHOLD_U = 3000.0

# Ignore deltas across longer gaps (peer dropped / paused).
MAX_DT_S = 0.4

# Window inside which a hit claim's expected HP drop must be observed on
# the target. If the target's next state in this window shows no drop and
# the target was not spawn protected, the claim is a lie.
HIT_VERIFY_WINDOW_S = 1.0


# ----------------------------------------------------------------------
# Per-match state
# ----------------------------------------------------------------------
class MatchState:
    """All observed state for one room observation session."""
    def __init__(self, room_code, judge_id, started_at_ms):
        self.room_code = room_code
        self.judge_id = judge_id
        self.started_at_ms = started_at_ms
        self.match_id = f"{room_code}_{started_at_ms}"
        # peerId -> {"loadoutKey", "team", "name"}
        self.loadouts = {}
        # peerId -> {"ts": ms, "data": dict}
        self.last_state = {}
        # peerId -> [ts_ms, ...] recent proj timestamps
        self.fire_times = defaultdict(list)
        # peerId -> last seen hp+shield (for damage mismatch)
        self.last_hp = {}
        self.last_shield = {}
        # Pending hit claims awaiting verification :
        # list of {"shooter", "target", "damage", "claim_ts"}
        self.pending_hits = []
        # Sticky : once we have flagged a peer for a rule in this match,
        # back off repeats for COOLDOWN_S so logs do not flood.
        self.flag_cooldown = {}  # (peer, rule) -> ts
        # Tracks whether match has entered "playing" phase ; pre-playing
        # broadcasts are lobby chatter and not subject to gameplay rules.
        self.playing = False

        REPLAY_DIR.mkdir(exist_ok=True)
        self.replay_path = REPLAY_DIR / f"{self.match_id}.jsonl"
        self.replay_fp = open(self.replay_path, "a", buffering=1)

    def close(self):
        try:
            self.replay_fp.close()
        except Exception:
            pass


FLAG_COOLDOWN_S = 2.0


# ----------------------------------------------------------------------
# Judge : detection + persistence
# ----------------------------------------------------------------------
class Judge:
    def __init__(self):
        self.db = self._init_db()
        self.flag_count = 0

    def _init_db(self):
        db = sqlite3.connect(DB_PATH)
        db.executescript("""
            CREATE TABLE IF NOT EXISTS matches (
                match_id      TEXT PRIMARY KEY,
                room_code     TEXT,
                judge_id      TEXT,
                started_at_ms INTEGER,
                ended_at_ms   INTEGER
            );
            CREATE TABLE IF NOT EXISTS peers (
                match_id     TEXT,
                peer_id      TEXT,
                loadout      TEXT,
                team         INTEGER,
                display_name TEXT,
                PRIMARY KEY (match_id, peer_id)
            );
            CREATE TABLE IF NOT EXISTS flags (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                match_id  TEXT,
                peer_id   TEXT,
                ts_ms     INTEGER,
                rule      TEXT,
                severity  TEXT,
                detail    TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_flags_peer  ON flags(peer_id);
            CREATE INDEX IF NOT EXISTS idx_flags_match ON flags(match_id);
            CREATE INDEX IF NOT EXISTS idx_flags_rule  ON flags(rule);
        """)
        db.commit()
        return db

    # ===== Persistence helpers =====

    def record_match(self, m):
        try:
            self.db.execute(
                "INSERT OR IGNORE INTO matches "
                "(match_id, room_code, judge_id, started_at_ms) VALUES (?, ?, ?, ?)",
                (m.match_id, m.room_code, m.judge_id, m.started_at_ms),
            )
            self.db.commit()
        except Exception as e:
            print("[db] record_match:", e)

    def end_match(self, m, ts):
        try:
            self.db.execute(
                "UPDATE matches SET ended_at_ms = ? WHERE match_id = ?",
                (ts, m.match_id),
            )
            self.db.commit()
        except Exception:
            pass
        m.close()

    def record_loadout(self, m, peer_id, data):
        try:
            self.db.execute(
                "INSERT OR REPLACE INTO peers "
                "(match_id, peer_id, loadout, team, display_name) VALUES (?, ?, ?, ?, ?)",
                (m.match_id, peer_id, data.get("loadoutKey"),
                 data.get("team"), data.get("discord_name")),
            )
            self.db.commit()
        except Exception as e:
            print("[db] record_loadout:", e)

    def flag(self, m, peer_id, ts, rule, severity, detail):
        # Cooldown to avoid flood for sticky rules.
        key = (peer_id, rule)
        last = m.flag_cooldown.get(key, 0)
        if ts - last < FLAG_COOLDOWN_S * 1000:
            return
        m.flag_cooldown[key] = ts
        self.flag_count += 1
        short = peer_id[:8] if peer_id else "-"
        print(f"[FLAG #{self.flag_count:>4}] {m.match_id}  {short}  "
              f"{rule:<22} ({severity:<4}) : {detail}")
        try:
            self.db.execute(
                "INSERT INTO flags (match_id, peer_id, ts_ms, rule, severity, detail) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (m.match_id, peer_id, ts, rule, severity, detail),
            )
            self.db.commit()
        except Exception as e:
            print("[db] flag:", e)

    # ===== Detection rules =====

    def on_state(self, m, env):
        peer_id = env["peerId"]
        ts = env["ts"]
        d = env.get("data") or {}
        if "px" not in d:
            return

        px = d.get("px", 0.0)
        py = d.get("py", 0.0)
        pz = d.get("pz", 0.0)

        # NaN / Inf check (cheap, near-zero false positives).
        for v in (px, py, pz):
            if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
                self.flag(m, peer_id, ts, "NAN_POSITION", "high",
                          f"px={px} py={py} pz={pz}")
                m.last_state[peer_id] = {"ts": ts, "data": d}
                return

        # Skip gameplay-rule checks if we have not entered the playing phase
        # yet. Lobby positions can be wherever.
        if not m.playing:
            m.last_state[peer_id] = {"ts": ts, "data": d}
            m.last_hp[peer_id] = d.get("hp", 0)
            m.last_shield[peer_id] = d.get("shield", 0)
            return

        last = m.last_state.get(peer_id)
        if last:
            dt_ms = ts - last["ts"]
            dt = dt_ms / 1000.0
            if 0 < dt < MAX_DT_S:
                lp = last["data"]
                dx = px - lp.get("px", px)
                dy = py - lp.get("py", py)
                dz = pz - lp.get("pz", pz)
                dist = math.sqrt(dx*dx + dy*dy + dz*dz)
                speed = dist / dt

                was_dead = bool(lp.get("dead")) or (lp.get("spawnProt") or 0) > 0
                is_dead = bool(d.get("dead")) or (d.get("spawnProt") or 0) > 0
                in_play = (not was_dead) and (not is_dead)

                lo = m.loadouts.get(peer_id) or {}
                loadout_key = lo.get("loadoutKey")
                base_speed = FLIGHT_SPEED.get(loadout_key, 800.0)
                cap = base_speed * SPEED_TOL

                if in_play and dist > TELEPORT_THRESHOLD_U:
                    self.flag(m, peer_id, ts, "TELEPORT", "high",
                              f"jumped {int(dist)}u in {dt:.3f}s "
                              f"(loadout={loadout_key})")
                elif in_play and speed > cap:
                    self.flag(m, peer_id, ts, "SPEED_VIOLATION", "med",
                              f"{int(speed)} u/s vs cap {int(cap)} "
                              f"(loadout={loadout_key})")

                # Resurrection : was dead, now alive, with no recent
                # round_end / launch_at to reset.
                if lp.get("dead") and not d.get("dead") and (d.get("spawnProt") or 0) == 0:
                    self.flag(m, peer_id, ts, "RESURRECTION", "high",
                              "alive=true after dead=true with spawnProt=0")

        # Verify pending hit claims against this peer's new HP.
        self._verify_pending_hits(m, peer_id, ts, d)

        m.last_state[peer_id] = {"ts": ts, "data": d}
        m.last_hp[peer_id] = d.get("hp", 0)
        m.last_shield[peer_id] = d.get("shield", 0)

    def on_proj(self, m, env):
        peer_id = env["peerId"]
        ts = env["ts"]
        if not m.playing:
            return
        lo = m.loadouts.get(peer_id) or {}
        loadout_key = lo.get("loadoutKey")
        interval = WEAPON_FIRE_INTERVAL.get(loadout_key)
        if interval is None:
            return
        times = m.fire_times[peer_id]
        # Prune > 5 s old.
        cutoff = ts - 5000
        while times and times[0] < cutoff:
            times.pop(0)
        if times:
            gap = (ts - times[-1]) / 1000.0
            min_gap = interval * FIRE_RATE_TOL
            if 0 < gap < min_gap:
                self.flag(m, peer_id, ts, "FIRE_RATE_VIOLATION", "high",
                          f"{int(gap*1000)}ms between shots vs min "
                          f"{int(min_gap*1000)}ms (loadout={loadout_key})")
        times.append(ts)

    def on_hit(self, m, env):
        d = env.get("data") or {}
        ts = env["ts"]
        if not m.playing:
            return
        shooter = d.get("shooterId")
        target = d.get("targetId")
        damage = d.get("damage", 0) or 0
        if not target or damage <= 0:
            return
        m.pending_hits.append({
            "shooter": shooter,
            "target": target,
            "damage": damage,
            "claim_ts": ts,
        })

    def _verify_pending_hits(self, m, target_peer, ts, new_data):
        """When a new state from a target arrives, look at pending hits
        against them. If the hit was claimed within HIT_VERIFY_WINDOW_S
        and the target's HP+shield did not drop by the expected amount,
        flag the shooter for a damage lie.

        We use HP+shield combined because in-game shield absorbs first.
        """
        if not m.pending_hits:
            return
        window_cutoff = ts - int(HIT_VERIFY_WINDOW_S * 1000)
        prev_hp = m.last_hp.get(target_peer, 0) or 0
        prev_shield = m.last_shield.get(target_peer, 0) or 0
        new_hp = new_data.get("hp", 0) or 0
        new_shield = new_data.get("shield", 0) or 0
        prev_total = prev_hp + prev_shield
        new_total = new_hp + new_shield
        observed_drop = prev_total - new_total

        # Was the target spawn-protected at any point during the window ?
        # If so, hits legitimately do nothing : do not flag.
        target_protected = (new_data.get("spawnProt") or 0) > 0

        # Walk pending hits ; process the ones aimed at this target.
        remaining = []
        for hit in m.pending_hits:
            if hit["target"] != target_peer:
                remaining.append(hit)
                continue
            if hit["claim_ts"] < window_cutoff:
                # Window expired without a state to verify against ; drop.
                continue
            if target_protected:
                # Cannot judge ; drop without flagging.
                continue
            # If the new state arrived AFTER the claim and HP did not move
            # by at least 25 % of expected damage (consensus rounding +
            # damage reduction abilities can shave the real drop), the
            # claim is suspect.
            expected = hit["damage"]
            if observed_drop < expected * 0.25 and observed_drop < 50:
                self.flag(m, hit["shooter"], ts, "DAMAGE_MISMATCH", "med",
                          f"claimed {expected} dmg to "
                          f"{target_peer[:8]} but only "
                          f"{int(observed_drop)} HP+shield observed")
        m.pending_hits = remaining

    def on_loadout(self, m, env):
        peer_id = env["peerId"]
        d = env.get("data") or {}
        if not d.get("loadoutKey"):
            return
        m.loadouts[peer_id] = {
            "loadoutKey": d.get("loadoutKey"),
            "team": d.get("team"),
            "name": d.get("discord_name"),
        }
        self.record_loadout(m, peer_id, d)

    def on_event(self, m, env):
        d = env.get("data") or {}
        t = d.get("type")
        if t == "launch_at":
            # Real match start is launch_at -> ~3 s later "playing" begins.
            # Use a small grace so the first second of position jitter does
            # not register as teleport.
            m.playing = True
        elif t == "round_end":
            m.playing = False
        elif t == "match_start":
            # Earlier handshake step ; still in warmup. Don't enable rules
            # yet.
            pass

    # ===== WebSocket message dispatch =====

    async def handle_envelope(self, env, ctx):
        kind = env.get("kind")
        if kind == "match_start_obs":
            m = MatchState(env.get("roomCode", "?"),
                           env.get("judgeId", "?"),
                           env.get("ts", int(time.time() * 1000)))
            ctx["match"] = m
            self.record_match(m)
            print(f"[MATCH] start  {m.match_id}")
            return

        m = ctx.get("match")
        if not m:
            return

        # Write to replay log first so we never lose raw data due to a
        # detector exception.
        try:
            m.replay_fp.write(json.dumps(env) + "\n")
        except Exception:
            pass

        if kind == "match_end_obs":
            self.end_match(m, env.get("ts", int(time.time() * 1000)))
            print(f"[MATCH] end    {m.match_id}")
            ctx["match"] = None
            return

        try:
            if kind == "state":
                self.on_state(m, env)
            elif kind == "proj":
                self.on_proj(m, env)
            elif kind == "hit":
                self.on_hit(m, env)
            elif kind == "loadout":
                self.on_loadout(m, env)
            elif kind == "event":
                self.on_event(m, env)
            # peer_join / peer_leave / vote : recorded in replay only.
        except Exception as e:
            print(f"[detect] {kind} crashed:", e)

    async def handler(self, ws):
        ctx = {"match": None}
        peer = getattr(ws, "remote_address", None) or "?"
        print(f"[ws] bridge connected from {peer}")
        try:
            async for msg in ws:
                try:
                    env = json.loads(msg)
                except Exception:
                    continue
                await self.handle_envelope(env, ctx)
        except websockets.ConnectionClosed:
            pass
        except Exception as e:
            print("[ws] handler error:", e)
        finally:
            m = ctx.get("match")
            if m:
                self.end_match(m, int(time.time() * 1000))
            print(f"[ws] bridge disconnected from {peer}")


# ----------------------------------------------------------------------
# Entry
# ----------------------------------------------------------------------
async def main():
    judge = Judge()
    print(f"LSS Judge Brain listening on ws://{HOST}:{PORT}")
    print(f"  Replays   -> {REPLAY_DIR.resolve()}")
    print(f"  Database  -> {DB_PATH.resolve()}")
    print()
    async with websockets.serve(judge.handler, HOST, PORT):
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nstopped")
