-- LSS D1 schema (initial). See LSS_backend-plan.md.
-- Apply with:  wrangler d1 execute lss-stats --file=schema.sql
-- Re-applying is safe ; all CREATE statements use IF NOT EXISTS.

-- ----------------------------------------------------------------------
-- Players: one row per Discord user that has ever signed in.
-- Updated on signin (display_name + avatar_hash may change). Career
-- totals are denormalized here for fast leaderboard queries ; they are
-- recomputed when a match becomes validated.
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS players (
  discord_id     TEXT PRIMARY KEY,
  username       TEXT NOT NULL,
  display_name   TEXT,
  avatar_hash    TEXT,
  created_at     INTEGER NOT NULL,
  last_seen      INTEGER NOT NULL,
  total_matches  INTEGER NOT NULL DEFAULT 0,
  total_wins     INTEGER NOT NULL DEFAULT 0,
  total_kills    INTEGER NOT NULL DEFAULT 0,
  total_deaths   INTEGER NOT NULL DEFAULT 0,
  total_damage   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_players_last_seen ON players(last_seen);
CREATE INDEX IF NOT EXISTS idx_players_total_wins ON players(total_wins DESC);
CREATE INDEX IF NOT EXISTS idx_players_total_kills ON players(total_kills DESC);

-- ----------------------------------------------------------------------
-- Matches: one row per completed match.
-- A match becomes validated (validated=1) when ALL participants have
-- reported and their reports agree. Disputed (validated=2) means
-- reports disagreed and the match is excluded from rollups. Pending
-- (validated=0) is the initial state.
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matches (
  id                TEXT PRIMARY KEY,
  started_at        INTEGER NOT NULL,
  ended_at          INTEGER NOT NULL,
  map_key           TEXT NOT NULL,
  winning_team      INTEGER,
  duration_sec      REAL,
  validated         INTEGER NOT NULL DEFAULT 0,
  participant_count INTEGER NOT NULL,
  validated_at      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_matches_started ON matches(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_validated ON matches(validated);
CREATE INDEX IF NOT EXISTS idx_matches_map ON matches(map_key);

-- ----------------------------------------------------------------------
-- Match participants: one row per (match, participant, reporter).
-- For a 4-player match where every participant reports their own
-- version of all four players' stats, that's 16 rows total. Consensus
-- is "all reports of all participants in a match agree on each
-- participant's stats." When that holds, match.validated flips to 1
-- and player career totals get rolled up (in a single transaction).
--
-- The (match_id, discord_id, reported_by) primary key prevents a
-- single peer from over-writing their own report ; a re-POST replaces
-- their previous numbers (good ; lets clients retry).
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_participants (
  match_id       TEXT NOT NULL,
  discord_id     TEXT NOT NULL,
  reported_by    TEXT NOT NULL,
  team           INTEGER NOT NULL,
  loadout_key    TEXT NOT NULL,
  kills          INTEGER NOT NULL DEFAULT 0,
  deaths         INTEGER NOT NULL DEFAULT 0,
  damage_dealt   INTEGER NOT NULL DEFAULT 0,
  damage_taken   INTEGER NOT NULL DEFAULT 0,
  is_mvp         INTEGER NOT NULL DEFAULT 0,
  is_winner      INTEGER NOT NULL DEFAULT 0,
  signature      TEXT,
  reported_at    INTEGER NOT NULL,
  PRIMARY KEY (match_id, discord_id, reported_by)
);

CREATE INDEX IF NOT EXISTS idx_mp_match ON match_participants(match_id);
CREATE INDEX IF NOT EXISTS idx_mp_player ON match_participants(discord_id);
CREATE INDEX IF NOT EXISTS idx_mp_loadout ON match_participants(loadout_key);

-- ----------------------------------------------------------------------
-- Achievements: optional ; one row per (player, achievement_type)
-- they've earned. Triggers set elsewhere ; this table just stores
-- the result for fast profile-page rendering.
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS achievements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id     TEXT NOT NULL,
  type           TEXT NOT NULL,
  achieved_at    INTEGER NOT NULL,
  match_id       TEXT,
  metadata_json  TEXT
);

CREATE INDEX IF NOT EXISTS idx_ach_player ON achievements(discord_id);
CREATE INDEX IF NOT EXISTS idx_ach_type   ON achievements(type);

-- ----------------------------------------------------------------------
-- Per-loadout aggregates ; denormalized for fast profile-page renders.
-- One row per (player, loadout). Updated when matches validate.
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_loadout_stats (
  discord_id     TEXT NOT NULL,
  loadout_key    TEXT NOT NULL,
  matches        INTEGER NOT NULL DEFAULT 0,
  wins           INTEGER NOT NULL DEFAULT 0,
  kills          INTEGER NOT NULL DEFAULT 0,
  deaths         INTEGER NOT NULL DEFAULT 0,
  damage_dealt   INTEGER NOT NULL DEFAULT 0,
  damage_taken   INTEGER NOT NULL DEFAULT 0,
  mvp_count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (discord_id, loadout_key)
);

CREATE INDEX IF NOT EXISTS idx_pls_player  ON player_loadout_stats(discord_id);
CREATE INDEX IF NOT EXISTS idx_pls_loadout ON player_loadout_stats(loadout_key);
