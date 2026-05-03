-- LSS D1 migration 002: split solo from multiplayer.
--
-- Apply once with:
--   wrangler d1 execute lss-stats --file=migration_002_solo_mp_split.sql --remote
--
-- Adds:
--   matches.mode         TEXT  ; 'solo' or 'multiplayer'
--   matches.human_count  INT   ; number of human (real Discord) participants
--   players.solo_*       INT   ; per-player solo-mode totals
--   players.mp_*         INT   ; per-player multiplayer-mode totals
--
-- Existing matches are not retroactively classified ; they keep their
-- default mode='solo' / human_count=1 as set by the column DEFAULT.
-- Going forward, the Worker computes both at insert time.

ALTER TABLE matches ADD COLUMN mode         TEXT    NOT NULL DEFAULT 'solo';
ALTER TABLE matches ADD COLUMN human_count  INTEGER NOT NULL DEFAULT 1;

ALTER TABLE players ADD COLUMN solo_matches INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN solo_wins    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN solo_kills   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN solo_deaths  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN solo_damage  INTEGER NOT NULL DEFAULT 0;

ALTER TABLE players ADD COLUMN mp_matches   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN mp_wins      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN mp_kills     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN mp_deaths    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN mp_damage    INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_matches_mode ON matches(mode);
CREATE INDEX IF NOT EXISTS idx_players_mp_wins   ON players(mp_wins DESC);
CREATE INDEX IF NOT EXISTS idx_players_solo_wins ON players(solo_wins DESC);
