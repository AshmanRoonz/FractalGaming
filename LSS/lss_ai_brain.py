"""
LSS AI Brain ; Python v0.2

A WebSocket server that drives an `lss_ai.html` bridge. The bridge connects
as a peer to a Last Ship Sailing multiplayer room, forwards game state to
this brain each frame, and applies whatever action this brain sends back.

This file is the PYTHON SIDE of that loop. Replace the policy function
(`pick_action`) with whatever you want : a hand-coded heuristic (the
default below), a behavior-cloned net, a PPO policy, anything.

----------------------------------------------------------------------
SETUP
----------------------------------------------------------------------
Requires Python 3.8+ and the `websockets` library :

    pip install websockets

Then run :

    python lss_ai_brain.py

Open lss_ai.html in a browser, set "Python brain" to ws://localhost:8765,
type a room code, click Join. The bridge connects and starts streaming
observations to this script. The brain prints a status line every second.

----------------------------------------------------------------------
PROTOCOL
----------------------------------------------------------------------
Bridge -> brain (JSON), sent every ~50 ms while playing :

    {
      "kind": "obs",
      "tick": int,
      "t": float (seconds since page load),
      "dt": float (frame delta),
      "match_state": "lobby" | "starting" | "launching" | "playing" | "roundEnd",
      "self": {
        "px": float, "py": float, "pz": float,
        "vx": float, "vy": float, "vz": float,
        "qx": float, "qy": float, "qz": float, "qw": float,
        "hp": int, "shield": int,
        "max_hp": int, "max_shield": int,
        "loadout": "VORTEX" | "PYRO" | ...,
        "team": 2 | 3,
        "dead": bool, "doomed": bool,
        "core_meter": float (0-100),
        "ability_cd": [c0, c1, c2] (seconds remaining),
        "fire_ready": bool,
        "spawn_prot": float
      },
      "peers": [
        {
          "id": "<peerId>",
          "px": ..., "py": ..., "pz": ...,
          "vx": ..., "vy": ..., "vz": ...,
          "qx": ..., "qy": ..., "qz": ..., "qw": ...,
          "hp": int, "shield": int,
          "dead": bool, "doomed": bool,
          "team": int, "loadout": str
        },
        ...
      ],
      "projectiles": [
        {
          "ox": ..., "oy": ..., "oz": ...,
          "vx": ..., "vy": ..., "vz": ...,
          "color": int,
          "owner": "<peerId>",
          "isArcWave": bool, "isCluster": bool, "isFireSource": bool
        },
        ...
      ]
    }

Brain -> bridge (JSON), reply per obs (any subset of fields) :

    {
      "vx": float, "vy": float, "vz": float,
      "aim": [x, y, z],     # world-space point to face
      "fire": bool,
      "ability": int,       # 0/1/2 (slot to use), omit / null to skip
      "core": bool
    }

----------------------------------------------------------------------
DEFAULT POLICY
----------------------------------------------------------------------
The shipped pick_action() is a tactical heuristic :
  * Pick the closest enemy peer not on our team and not dead
  * Aim at that enemy
  * Move toward them, with sinusoidal lateral juke for evasion
  * Fire continuously
  * Use offensive ability (slot 0) when off cooldown
  * Pop core when meter is full and an enemy is in range

Swap pick_action() for anything else ; the rest of the loop stays the same.
"""

import asyncio
import json
import math
import random
import time

try:
    import websockets
except ImportError:
    raise SystemExit(
        "Missing dependency : install with  `pip install websockets`"
    )


# ----------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------
HOST = "localhost"
PORT = 8765

# Per-loadout flight-speed limit so the brain doesn't ask for inhuman
# velocities. Mirrors the game's CHASSIS.flightSpeed table.
FLIGHT_SPEED = {
    "VORTEX":   600.0,
    "PYRO":     420.0,
    "PUNCTURE": 800.0,
    "SLAYER":   800.0,
    "TRACKER":  600.0,
    "BLASTER":  420.0,
    "SYPHON":   600.0,
}


# ----------------------------------------------------------------------
# Policy : the brain. Replace with anything.
# ----------------------------------------------------------------------
def pick_action(obs: dict, state: dict) -> dict:
    """Take the latest observation, return an action dict.

    `state` is a brain-local persistent dict ; survives across ticks so
    you can carry hidden state (memory, RNN state, target lock, etc.).
    """
    self_st = obs.get("self") or {}
    peers = obs.get("peers") or []
    my_team = self_st.get("team")
    my_loadout = self_st.get("loadout", "SLAYER")
    max_speed = FLIGHT_SPEED.get(my_loadout, 600.0)

    # Only act during actual gameplay. Any other phase (lobby, starting,
    # launching, roundEnd) we hold position. Belt-and-suspenders with the
    # bridge, which also gates motion on match_state ; both sides stay in
    # sync so neither can accidentally start the AI moving before the
    # human spawns in.
    if self_st.get("dead") or obs.get("match_state") != "playing":
        return {"vx": 0, "vy": 0, "vz": 0, "fire": False}

    # Find the closest enemy not on our team and alive.
    my_pos = (self_st.get("px", 0.0), self_st.get("py", 0.0), self_st.get("pz", 0.0))
    target = None
    target_dist = float("inf")
    for p in peers:
        if not p:
            continue
        if p.get("dead"):
            continue
        if p.get("team") == my_team:
            continue
        dx = p.get("px", 0.0) - my_pos[0]
        dy = p.get("py", 0.0) - my_pos[1]
        dz = p.get("pz", 0.0) - my_pos[2]
        d = math.sqrt(dx * dx + dy * dy + dz * dz)
        if d < target_dist:
            target_dist = d
            target = p

    if target is None:
        # No enemy in sight ; drift gently.
        t = obs.get("t", 0.0)
        return {
            "vx": math.cos(t * 0.3) * 80.0,
            "vy": 0.0,
            "vz": math.sin(t * 0.3) * 80.0,
            "fire": False,
        }

    # ----- Movement : close to engagement range, jukes laterally -----
    tx, ty, tz = target["px"], target["py"], target["pz"]
    dx = tx - my_pos[0]
    dy = ty - my_pos[1]
    dz = tz - my_pos[2]
    d = math.sqrt(dx * dx + dy * dy + dz * dz) or 1.0
    nx, ny, nz = dx / d, dy / d, dz / d
    # Engagement range : ~600 u. Closer than that, juke. Farther, approach.
    engage_range = 600.0
    if d > engage_range:
        # Approach at flight-speed cap
        speed = max_speed
        vx = nx * speed
        vy = ny * speed
        vz = nz * speed
    else:
        # In range : strafe perpendicular to the target line, sinusoidal
        # juke pattern. Perpendicular = cross(toTarget, up).
        # right = normalize(cross(normalize(toTarget), (0,1,0)))
        rx = nz   # cross(n, up) = ( n.z, 0, -n.x )
        ry = 0.0
        rz = -nx
        rl = math.sqrt(rx * rx + rz * rz) or 1.0
        rx, rz = rx / rl, rz / rl
        # Sinusoidal lateral juke
        t = obs.get("t", 0.0)
        juke = math.sin(t * 3.0)  # -1 to 1
        speed = max_speed * 0.7
        vx = rx * juke * speed + nx * speed * 0.2  # mild closing
        vy = ny * speed * 0.1
        vz = rz * juke * speed + nz * speed * 0.2

    # ----- Aim : at the target, with very mild lead -----
    # Lead by ~0.15 s assuming we'll fire next frame.
    lead_t = 0.15
    aim = [
        tx + (target.get("vx", 0.0) or 0.0) * lead_t,
        ty + (target.get("vy", 0.0) or 0.0) * lead_t,
        tz + (target.get("vz", 0.0) or 0.0) * lead_t,
    ]

    # ----- Fire : always while target in weapon range (rough estimate) -----
    fire = d < 3000.0 and bool(self_st.get("fire_ready", True))

    # ----- Ability : use offensive (slot 0) when off cooldown and in range -----
    ability = None
    cds = self_st.get("ability_cd") or [0, 0, 0]
    if d < 2200.0 and cds[0] <= 0.01:
        ability = 0

    # ----- Core : activate when meter is full and target in range -----
    core = (self_st.get("core_meter", 0) >= 100) and d < 2400.0

    return {
        "vx": vx, "vy": vy, "vz": vz,
        "aim": aim,
        "fire": fire,
        "ability": ability,
        "core": core,
    }


# ----------------------------------------------------------------------
# WebSocket server loop
# ----------------------------------------------------------------------
async def handle_bridge(ws):
    """One bridge connection. Runs until the bridge disconnects."""
    print(f"[brain] bridge connected from {ws.remote_address}")
    brain_state = {}  # persistent per-bridge memory
    last_print = time.time()
    obs_count = 0
    act_count = 0
    selfId = None
    loadout = None
    try:
        async for msg in ws:
            try:
                obs = json.loads(msg)
            except json.JSONDecodeError:
                continue
            kind = obs.get("kind")
            if kind == "hello":
                selfId = obs.get("selfId")
                loadout = obs.get("loadout")
                print(f"[brain] bridge says hello : selfId={selfId} loadout={loadout} team={obs.get('team')}")
                continue
            if kind != "obs":
                continue
            obs_count += 1
            action = pick_action(obs, brain_state)
            try:
                await ws.send(json.dumps(action))
                act_count += 1
            except Exception:
                break

            now = time.time()
            if now - last_print >= 1.0:
                self_st = obs.get("self", {})
                peers = obs.get("peers", [])
                print(
                    f"[brain] tick={obs.get('tick')} "
                    f"hp={self_st.get('hp')}/{self_st.get('max_hp')} "
                    f"sh={self_st.get('shield')}/{self_st.get('max_shield')} "
                    f"peers={len(peers)} "
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
        print(f"[brain] bridge disconnected ({selfId or '?'})")


async def main():
    print(f"[brain] LSS AI brain listening on ws://{HOST}:{PORT}")
    print(f"[brain] Open lss_ai.html, set brain URL to ws://{HOST}:{PORT}, join a room.")
    async with websockets.serve(handle_bridge, HOST, PORT):
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[brain] shutting down.")
