"""
LSS AI Brain ; Python v0.5 (fat brain + heuristic skeleton)

WebSocket server that drives an `lss_ai.html` bridge. The bridge connects
as a peer to a Last Ship Sailing multiplayer room, forwards observations
to this brain each frame, and applies whatever action this brain sends
back. The brain is now "fat" : the bridge ships the full map structure
(rooms, tunnels, race graph, champion room) so this script can do its
own pathfinding and steering inside the playable volume.

----------------------------------------------------------------------
SETUP
----------------------------------------------------------------------

    pip install websockets

Then :

    python lss_ai_brain.py

Open lss_ai.html in a browser. Set "Python brain" to ws://localhost:8765,
type a room code, click Join. The bridge connects and starts streaming
observations to this script.

----------------------------------------------------------------------
ARCHITECTURE (v0.5)
----------------------------------------------------------------------

Brain layers, from biggest to smallest decision :

  1. Macro     : pick an intent (engage / flee / race / cap / wander)
                  based on the round mode, health, target visibility,
                  objectives. State machine with hysteresis.

  2. Navigator : given (my_pos, goal_room_id), BFS the room graph and
                  return the next steering target. Mirrors the in-game
                  Bot.chooseRaceWaypoint() so the AI threads corridors
                  the same way a competent in-game bot would.

  3. Micro     : per-tick decisions inside an intent : aim lead, dodge
                  side-step, ability slot to fire. Currently scripted,
                  but each has a (model, obs) -> action hook so a
                  trained net can drop in without changing the skeleton.

  4. Recorder  : writes (obs, action) pairs as JSONL to ./recordings/
                  for future behavior cloning training data. Off by
                  default ; set RECORD = True below to enable.
"""

import asyncio
import collections
import json
import math
import os
import random
import time

try:
    import websockets
except ImportError:
    raise SystemExit("Missing dependency : install with  `pip install websockets`")


# ----------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------
HOST = "localhost"
PORT = 8765

# Set True to write per-tick (obs, action) JSONL files into ./recordings/.
# These are the dataset for future behavior cloning / micro-net training.
RECORD = False
RECORD_DIR = "recordings"

# Per-loadout caps so the brain never asks for inhuman velocities.
FLIGHT_SPEED = {
    "VORTEX":   600.0,
    "PYRO":     420.0,
    "PUNCTURE": 800.0,
    "SLAYER":   800.0,
    "TRACKER":  600.0,
    "BLASTER":  420.0,
    "SYPHON":   600.0,
}

# Preferred engagement distance per loadout.
PREFERRED_RANGE = {
    "VORTEX":   1000.0,
    "PYRO":     500.0,
    "PUNCTURE": 1500.0,
    "SLAYER":   500.0,
    "TRACKER":  1200.0,
    "BLASTER":  1000.0,
    "SYPHON":   800.0,
}


# ----------------------------------------------------------------------
# Vector helpers (kept inline to avoid a numpy dependency).
# ----------------------------------------------------------------------
def vsub(a, b): return (a[0]-b[0], a[1]-b[1], a[2]-b[2])
def vadd(a, b): return (a[0]+b[0], a[1]+b[1], a[2]+b[2])
def vmul(a, k): return (a[0]*k, a[1]*k, a[2]*k)
def vdot(a, b): return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
def vlen(a): return math.sqrt(vdot(a, a))
def vnorm(a):
    L = vlen(a)
    if L < 1e-6:
        return (0.0, 0.0, 0.0)
    return (a[0]/L, a[1]/L, a[2]/L)
def vcross(a, b):
    return (a[1]*b[2] - a[2]*b[1],
            a[2]*b[0] - a[0]*b[2],
            a[0]*b[1] - a[1]*b[0])


# ----------------------------------------------------------------------
# Map cache + navigator
# ----------------------------------------------------------------------
class MapCache:
    """Holds the static map. Built from the one-shot map_static packet."""

    def __init__(self):
        self.map_key = None
        self.mode = "champion"
        self.rooms = []
        self.tunnels = []
        self.nodes = {}
        self.finish_id = None
        self.arena_size = 4000.0
        self.spawn_a_id = None
        self.spawn_b_id = None

    def ingest(self, packet):
        self.map_key = packet.get("mapKey")
        self.mode = packet.get("mode", "champion")
        self.rooms = packet.get("rooms", [])
        self.tunnels = []
        for tun in packet.get("tunnels", []):
            path = [(p["x"], p["y"], p["z"]) for p in tun.get("path", [])]
            if len(path) >= 2:
                self.tunnels.append({"r": tun.get("r", 100), "path": path})
        self.nodes = {}
        rg = packet.get("race_graph", {}) or {}
        for nid, n in (rg.get("nodes", {}) or {}).items():
            self.nodes[nid] = {
                "x": n["x"], "y": n["y"], "z": n["z"], "r": n["r"],
                "team": n.get("team"), "champion": n.get("champion", False),
                "neighbors": [
                    {"id": nb["id"],
                     "mid": (nb["mid"]["x"], nb["mid"]["y"], nb["mid"]["z"])}
                    for nb in n.get("neighbors", [])
                ],
            }
        self.finish_id = rg.get("finishId") or packet.get("champion_room_id")
        self.arena_size = float(packet.get("arena_size", 4000.0))
        for rm in self.rooms:
            if rm.get("team") == "A":
                self.spawn_a_id = rm.get("id")
            elif rm.get("team") == "B":
                self.spawn_b_id = rm.get("id")

    def loaded(self):
        return len(self.nodes) > 0

    def room_containing(self, pt):
        for rm in self.rooms:
            dx = pt[0] - rm["x"]
            dy = pt[1] - rm["y"]
            dz = pt[2] - rm["z"]
            if dx*dx + dy*dy + dz*dz <= rm["r"] * rm["r"]:
                return rm["id"]
        return None

    def nearest_room(self, pt):
        best_id, best_d2 = None, float("inf")
        for rm in self.rooms:
            dx = pt[0] - rm["x"]
            dy = pt[1] - rm["y"]
            dz = pt[2] - rm["z"]
            d2 = dx*dx + dy*dy + dz*dz
            if d2 < best_d2:
                best_d2 = d2
                best_id = rm["id"]
        return best_id, math.sqrt(best_d2)

    def inside_play_volume(self, pt):
        if self.room_containing(pt):
            return True
        for tun in self.tunnels:
            path = tun["path"]
            r = tun["r"]
            for i in range(len(path) - 1):
                a = path[i]
                b = path[i + 1]
                ab = vsub(b, a)
                ab2 = vdot(ab, ab)
                if ab2 < 1e-3:
                    continue
                ap = vsub(pt, a)
                t = max(0.0, min(1.0, vdot(ap, ab) / ab2))
                c = vadd(a, vmul(ab, t))
                d = vlen(vsub(pt, c))
                if d <= r:
                    return True
        return False


class Navigator:
    """BFS through the room graph. Mirrors v27's Bot.chooseRaceWaypoint().

    Given (pos, goal_room_id), returns the next steering target.
    Inside the current room sphere : aim at the corridor MIDPOINT to
    thread the tunnel mouth cleanly. Outside : aim at the next room
    center (line from corridor to next room center is safe).
    """

    def __init__(self, mp):
        self.mp = mp
        self._sticky_room_id = None

    def next_waypoint(self, pos, goal_id):
        mp = self.mp
        if not mp.loaded() or goal_id not in mp.nodes:
            return None

        inside = mp.room_containing(pos)
        nearest, _ = mp.nearest_room(pos)
        if inside:
            self._sticky_room_id = inside
        elif self._sticky_room_id is None:
            self._sticky_room_id = nearest
        cur = self._sticky_room_id
        if cur is None:
            return None
        if cur == goal_id:
            n = mp.nodes[goal_id]
            return (n["x"], n["y"], n["z"])

        prev = {}
        queue = collections.deque([cur])
        visited = {cur: True}
        found = False
        while queue:
            nid = queue.popleft()
            if nid == goal_id:
                found = True
                break
            for nb in mp.nodes[nid]["neighbors"]:
                if nb["id"] in visited:
                    continue
                visited[nb["id"]] = True
                prev[nb["id"]] = (nid, nb["mid"])
                queue.append(nb["id"])

        if not found:
            n = mp.nodes[goal_id]
            return (n["x"], n["y"], n["z"])

        step_id = goal_id
        step_edge = prev.get(step_id)
        while step_edge and step_edge[0] != cur:
            step_id = step_edge[0]
            step_edge = prev.get(step_id)

        next_room = mp.nodes.get(step_id)
        if not next_room:
            n = mp.nodes[goal_id]
            return (n["x"], n["y"], n["z"])

        if inside == cur and step_edge:
            return step_edge[1]
        return (next_room["x"], next_room["y"], next_room["z"])


# ----------------------------------------------------------------------
# Macro intent state machine
# ----------------------------------------------------------------------
INTENT_WANDER  = "wander"
INTENT_ENGAGE  = "engage"
INTENT_FLEE    = "flee"
INTENT_RACE    = "race"
INTENT_CAP     = "cap"


class Macro:
    """Pick an intent. State machine with hysteresis."""

    def __init__(self):
        self.last_intent = INTENT_WANDER
        self.last_change = 0.0
        self._last_target = None
        self.HOLD_S = 1.0

    def pick(self, obs, mp):
        self_st = obs.get("self") or {}
        peers = obs.get("peers") or []
        my_team = self_st.get("team")
        my_pos = (self_st.get("px", 0.0), self_st.get("py", 0.0), self_st.get("pz", 0.0))
        my_hp = self_st.get("hp", 1)
        my_max = self_st.get("max_hp", 1) or 1
        hp_frac = my_hp / my_max
        doomed = self_st.get("doomed", False)
        mode = obs.get("mode", "champion")
        nav = obs.get("nav") or {}
        champ_id = nav.get("champion_room_id")

        target = None
        target_d = float("inf")
        for p in peers:
            if not p or p.get("dead") or p.get("team") == my_team:
                continue
            d = vlen(vsub((p["px"], p["py"], p["pz"]), my_pos))
            if d < target_d:
                target_d = d
                target = p

        new_intent = self.last_intent
        new_target = None

        if doomed or hp_frac < 0.18:
            new_intent = INTENT_FLEE
            if target:
                away = vnorm(vsub(my_pos, (target["px"], target["py"], target["pz"])))
                new_target = away
            else:
                new_target = (0.0, 0.0, 0.0)
        elif mode == "race" and champ_id:
            new_intent = INTENT_RACE
            new_target = champ_id
        elif champ_id and (target_d > 1800 or target is None):
            new_intent = INTENT_CAP
            new_target = champ_id
        elif target:
            new_intent = INTENT_ENGAGE
            new_target = target
        else:
            new_intent = INTENT_WANDER
            new_target = None

        now = obs.get("t", 0.0)
        if new_intent != self.last_intent and new_intent != INTENT_FLEE:
            if (now - self.last_change) < self.HOLD_S:
                return self.last_intent, self._last_target
        self.last_intent = new_intent
        self.last_change = now
        self._last_target = new_target
        return new_intent, new_target


# ----------------------------------------------------------------------
# Micro layers : aim lead, dodge, ability picker.
# Each has signature (obs, ctx) -> value, plus an optional `model`
# attribute that, if set, swaps in a trained net. The defaults are
# scripted heuristics good enough to ship.
# ----------------------------------------------------------------------
class MicroAimLead:
    model = None

    def predict(self, obs, target):
        if self.model is not None:
            return self.model.predict(obs, target)
        self_st = obs.get("self") or {}
        loadout = self_st.get("loadout") or "VORTEX"
        lead_t = {
            "VORTEX":   0.05,
            "PYRO":     0.40,
            "PUNCTURE": 0.05,
            "SLAYER":   0.20,
            "TRACKER":  0.30,
            "BLASTER":  0.05,
            "SYPHON":   0.05,
        }.get(loadout, 0.10)
        tvx = target.get("vx", 0.0) or 0.0
        tvy = target.get("vy", 0.0) or 0.0
        tvz = target.get("vz", 0.0) or 0.0
        return (target["px"] + tvx * lead_t,
                target["py"] + tvy * lead_t,
                target["pz"] + tvz * lead_t)


class MicroDodge:
    model = None

    def __init__(self):
        self._phase = random.random() * math.tau
        self._period = 0.6 + random.random() * 1.4

    def predict(self, obs, to_target_unit):
        if self.model is not None:
            return self.model.predict(obs, to_target_unit)
        t = obs.get("t", 0.0)
        up = (0.0, 1.0, 0.0)
        right = vnorm(vcross(to_target_unit, up))
        juke = math.sin((t + self._phase) * (math.tau / self._period))
        return vmul(right, juke)


class MicroAbility:
    model = None

    def predict(self, obs, intent, target_dist):
        if self.model is not None:
            return self.model.predict(obs, intent, target_dist)
        self_st = obs.get("self") or {}
        cds = self_st.get("ability_cd") or [0, 0, 0]
        if intent == INTENT_ENGAGE and target_dist < 2400.0 and cds[0] <= 0.05:
            return 0
        if intent == INTENT_FLEE and cds[1] <= 0.05:
            return 1
        if intent in (INTENT_ENGAGE, INTENT_CAP) and target_dist < 1400.0 and cds[2] <= 0.05:
            if random.random() < 0.05:
                return 2
        return -1


# ----------------------------------------------------------------------
# Recorder : JSONL of (obs, action) for behavior cloning later.
# ----------------------------------------------------------------------
class Recorder:
    def __init__(self, enabled):
        self.enabled = enabled
        self.f = None
        if enabled:
            os.makedirs(RECORD_DIR, exist_ok=True)
            stamp = time.strftime("%Y%m%d_%H%M%S")
            self.path = os.path.join(RECORD_DIR, f"session_{stamp}.jsonl")
            self.f = open(self.path, "a", buffering=1)
            print(f"[recorder] writing to {self.path}")

    def write(self, obs, action):
        if not self.enabled or self.f is None:
            return
        try:
            self.f.write(json.dumps({"obs": obs, "act": action}) + "\n")
        except Exception:
            pass

    def close(self):
        if self.f:
            try:
                self.f.close()
            except Exception:
                pass


# ----------------------------------------------------------------------
# Per-bridge brain state.
# ----------------------------------------------------------------------
class BrainState:
    def __init__(self):
        self.map = MapCache()
        self.nav = Navigator(self.map)
        self.macro = Macro()
        self.aim = MicroAimLead()
        self.dodge = MicroDodge()
        self.ability = MicroAbility()
        self.recorder = Recorder(RECORD)
        self.last_action = None


# ----------------------------------------------------------------------
# pick_action : the full per-tick policy.
# ----------------------------------------------------------------------
def pick_action(obs, st):
    self_st = obs.get("self") or {}
    if self_st.get("dead") or obs.get("match_state") != "playing":
        return {"vx": 0.0, "vy": 0.0, "vz": 0.0, "fire": False}

    my_pos = (self_st.get("px", 0.0), self_st.get("py", 0.0), self_st.get("pz", 0.0))
    loadout = self_st.get("loadout") or "VORTEX"
    max_speed = FLIGHT_SPEED.get(loadout, 600.0)
    pref_range = PREFERRED_RANGE.get(loadout, 800.0)

    intent, tgt = st.macro.pick(obs, st.map)

    goal_pt = None
    target_peer = None
    target_dist = float("inf")

    if intent == INTENT_ENGAGE and tgt is not None:
        target_peer = tgt
        enemy_pos = (tgt["px"], tgt["py"], tgt["pz"])
        target_dist = vlen(vsub(enemy_pos, my_pos))
        if st.map.loaded():
            my_room = st.map.room_containing(my_pos)
            their_room = st.map.room_containing(enemy_pos)
            if my_room and their_room and my_room != their_room:
                wp = st.nav.next_waypoint(my_pos, their_room)
                goal_pt = wp if wp else enemy_pos
            else:
                goal_pt = enemy_pos
        else:
            goal_pt = enemy_pos

    elif intent == INTENT_FLEE:
        if isinstance(tgt, tuple) and len(tgt) == 3:
            goal_pt = vadd(my_pos, vmul(tgt, 800.0))
        else:
            goal_pt = my_pos

    elif intent in (INTENT_RACE, INTENT_CAP):
        room_id = tgt
        wp = st.nav.next_waypoint(my_pos, room_id) if st.map.loaded() else None
        goal_pt = wp if wp else my_pos

    else:
        t = obs.get("t", 0.0)
        goal_pt = vadd(my_pos, (math.cos(t * 0.3) * 200.0, 0.0, math.sin(t * 0.3) * 200.0))

    to_goal = vsub(goal_pt, my_pos)
    dist = vlen(to_goal)
    if dist < 1e-3:
        dir_unit = (0.0, 0.0, -1.0)
    else:
        dir_unit = vmul(to_goal, 1.0 / dist)

    if intent == INTENT_ENGAGE and target_peer is not None:
        gap = target_dist - pref_range
        if abs(gap) < 150.0:
            forward_k = 0.0
        else:
            forward_k = 1.0 if gap > 0 else -0.6
        forward = vmul(dir_unit, forward_k)
        lateral = st.dodge.predict(obs, dir_unit)
        combo = vnorm(vadd(forward, vmul(lateral, 0.9)))
        speed = max_speed * 0.85
        vx, vy, vz = vmul(combo, speed)
    elif intent == INTENT_FLEE:
        vx, vy, vz = vmul(dir_unit, max_speed)
    else:
        vx, vy, vz = vmul(dir_unit, max_speed)

    if target_peer is not None:
        aim_pt = st.aim.predict(obs, target_peer)
        fire = target_dist < 3000.0 and bool(self_st.get("fire_ready", True))
    else:
        aim_pt = goal_pt
        fire = False

    ability_slot = st.ability.predict(obs, intent, target_dist)
    ability_field = ability_slot if ability_slot >= 0 else None

    core_meter = self_st.get("core_meter", 0)
    core = (core_meter >= 100) and target_peer is not None and target_dist < 2400.0

    action = {
        "vx": vx, "vy": vy, "vz": vz,
        "aim": [aim_pt[0], aim_pt[1], aim_pt[2]],
        "fire": fire,
        "ability": ability_field,
        "core": core,
        "_intent": intent,
    }
    st.last_action = action
    st.recorder.write(obs, action)
    return action


# ----------------------------------------------------------------------
# WebSocket server loop
# ----------------------------------------------------------------------
async def handle_bridge(ws):
    print(f"[brain] bridge connected from {ws.remote_address}")
    st = BrainState()
    last_print = time.time()
    obs_count = 0
    act_count = 0
    selfId = None
    loadout = None
    try:
        async for msg in ws:
            try:
                packet = json.loads(msg)
            except json.JSONDecodeError:
                continue
            kind = packet.get("kind")

            if kind == "hello":
                selfId = packet.get("selfId")
                loadout = packet.get("loadout")
                print(f"[brain] hello : selfId={selfId} loadout={loadout} team={packet.get('team')}")
                continue

            if kind == "map_static":
                st.map.ingest(packet)
                print(f"[brain] map_static : key={st.map.map_key} mode={st.map.mode} "
                      f"rooms={len(st.map.rooms)} tunnels={len(st.map.tunnels)} "
                      f"finish={st.map.finish_id}")
                continue

            if kind == "map_request":
                # Bridge couldn't fetch the map (file:// origin or hosted
                # somewhere different from the maps folder). Read it off
                # disk and ship it back.
                mk = packet.get("mapKey") or ""
                path = os.path.join("maps", f"map_{mk}.json")
                try:
                    with open(path, "r") as fmap:
                        data = json.load(fmap)
                    await ws.send(json.dumps({
                        "kind": "map_data", "mapKey": mk, "data": data,
                    }))
                    print(f"[brain] map_data sent : {mk}")
                except FileNotFoundError:
                    print(f"[brain] map_request failed : no such file {path}")
                except Exception as e:
                    print(f"[brain] map_request failed ({mk}) : {e}")
                continue

            if kind != "obs":
                continue

            obs_count += 1
            action = pick_action(packet, st)
            send_action = {k: v for k, v in action.items() if not k.startswith("_")}
            try:
                await ws.send(json.dumps(send_action))
                act_count += 1
            except Exception:
                break

            now = time.time()
            if now - last_print >= 1.0:
                self_st = packet.get("self", {})
                peers = packet.get("peers", [])
                intent = action.get("_intent", "?")
                print(
                    f"[brain] tick={packet.get('tick')} intent={intent:7s} "
                    f"hp={self_st.get('hp')}/{self_st.get('max_hp')} "
                    f"sh={self_st.get('shield')}/{self_st.get('max_shield')} "
                    f"peers={len(peers)} room={packet.get('nav', {}).get('current_room_id')} "
                    f"obs={obs_count} act={act_count}"
                )
                last_print = now
                obs_count = 0
                act_count = 0
    except websockets.exceptions.ConnectionClosed:
        pass
    except Exception as e:
        print(f"[brain] handler error : {e}")
    finally:
        st.recorder.close()
        print(f"[brain] bridge disconnected ({selfId or '?'})")


async def main():
    print(f"[brain] LSS AI brain v0.5 listening on ws://{HOST}:{PORT}")
    print(f"[brain] Open lss_ai.html, set brain URL to ws://{HOST}:{PORT}, join a room.")
    if RECORD:
        print(f"[brain] RECORD = True : writing (obs, act) JSONL to ./{RECORD_DIR}/")
    async with websockets.serve(handle_bridge, HOST, PORT):
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[brain] shutting down.")
