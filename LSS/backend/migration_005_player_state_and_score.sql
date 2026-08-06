-- Migration 005: cross-device player state (aegis + prefs) and a generic
-- per-participant SCORE so solo/PvE modes can share the leaderboard.
--
-- Why:
--   1. Aegis ranks and settings lived only in localStorage ('lss_aegis',
--      'lss_settings', ...), so they were lost on a browser change and never
--      followed a player between PC / phone / Quest.
--   2. Endless is ranked by HOW FAR you got, which has no home in a schema
--      built around kills / deaths / damage. The owner chose ONE combined
--      board segmented by game_mode, so endless needs a metric that lives
--      alongside the PvP ones rather than in a separate table.
--
-- Apply (remote):
--   wrangler d1 execute lss-stats --remote --file=migration_005_player_state_and_score.sql
-- NOTE: the two ALTER TABLE ADD COLUMN statements are NOT idempotent — apply
-- once. Everything else here is safe to re-run.

-- ----------------------------------------------------------------------
-- Per-player cross-device state. One row per Discord user.
--
-- aegis_json : {"2":5,"8":3,...} rank id -> level. Merged by MAX per rank on
--              write (owner's choice), so progress is monotonic and playing
--              offline or on a second device can never roll a level back.
-- prefs_json : the ACCOUNT-level settings subset only (ship skin, perk,
--              difficulty, HUD scale). Device-level settings (quality, touch,
--              audio latency, VR perf) deliberately stay in localStorage — a
--              Quest and a desktop need different ones, so syncing them would
--              fight the player.
-- Both are opaque JSON blobs: the game owns their shape, the Worker only
-- merges aegis and stores prefs. That keeps schema churn out of gameplay
-- iteration, which on this project moves several builds a day.
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_state (
  discord_id   TEXT PRIMARY KEY,
  aegis_json   TEXT NOT NULL DEFAULT '{}',
  prefs_json   TEXT NOT NULL DEFAULT '{}',
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_player_state_updated ON player_state(updated_at);

-- ----------------------------------------------------------------------
-- Generic per-participant score. NULL for every existing PvP row and for any
-- mode that does not use it, so nothing already recorded changes meaning.
-- Endless writes distance travelled here; campaign can use it for a run
-- score later without another migration.
-- ----------------------------------------------------------------------
ALTER TABLE match_participants ADD COLUMN score INTEGER;

-- Per-match run length in seconds, for plausibility checks and for showing
-- "best run" durations on profiles. matches.duration_sec already exists but
-- is the whole match; for solo runs they coincide, for PvP they do not.
ALTER TABLE match_participants ADD COLUMN survived_sec REAL;

CREATE INDEX IF NOT EXISTS idx_mp_score ON match_participants(score DESC);
