-- LSS D1 migration 003: per-match peaks (max) and floors (min) for
-- kills / deaths / damage. Averages and losses are derivable from
-- existing totals at query time, so no columns for those.
--
-- Apply once with:
--   wrangler d1 execute lss-stats --file=migration_003_per_match_extremes.sql --remote
--
-- max_*  ; biggest single-match value the player has hit in that mode
-- min_*  ; smallest single-match value (NULLABLE until the first match
--          ; lets us distinguish "never played" from "had a 0-stat match")
--
-- Mirrored across combined / solo / mp ; same denormalization story
-- as migration_002.

-- COMBINED (across modes)
ALTER TABLE players ADD COLUMN max_kills_match  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN min_kills_match  INTEGER;
ALTER TABLE players ADD COLUMN max_deaths_match INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN min_deaths_match INTEGER;
ALTER TABLE players ADD COLUMN max_damage_match INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN min_damage_match INTEGER;

-- SOLO MODE
ALTER TABLE players ADD COLUMN solo_max_kills_match  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN solo_min_kills_match  INTEGER;
ALTER TABLE players ADD COLUMN solo_max_deaths_match INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN solo_min_deaths_match INTEGER;
ALTER TABLE players ADD COLUMN solo_max_damage_match INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN solo_min_damage_match INTEGER;

-- MULTIPLAYER MODE
ALTER TABLE players ADD COLUMN mp_max_kills_match   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN mp_min_kills_match   INTEGER;
ALTER TABLE players ADD COLUMN mp_max_deaths_match  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN mp_min_deaths_match  INTEGER;
ALTER TABLE players ADD COLUMN mp_max_damage_match  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN mp_min_damage_match  INTEGER;
