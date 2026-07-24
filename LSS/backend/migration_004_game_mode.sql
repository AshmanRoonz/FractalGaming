-- Migration 004: game-mode segmentation (classic / race / assault).
-- The matches.mode column already means solo-vs-multiplayer, so the game
-- mode gets its own column. The game client sends `mode` in the match
-- payload as of v34.82; older clients omit it and the Worker falls back
-- to inferring from the map_key prefix.
--
-- Apply (remote):
--   wrangler d1 execute lss-stats --remote --file=migration_004_game_mode.sql
-- NOTE: ALTER TABLE ADD COLUMN is not idempotent — apply once. (The index
-- and backfill statements are safe to re-run.)

ALTER TABLE matches ADD COLUMN game_mode TEXT;

CREATE INDEX IF NOT EXISTS idx_matches_gamemode ON matches(game_mode);

-- Backfill history: race maps only ever ran in race mode, assault maps
-- only in assault; everything else predates game modes = classic.
UPDATE matches SET game_mode = CASE
  WHEN map_key LIKE 'race_%'    THEN 'race'
  WHEN map_key LIKE 'assault_%' THEN 'assault'
  ELSE 'classic'
END
WHERE game_mode IS NULL;
