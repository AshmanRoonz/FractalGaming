-- Migration 006: durable sign-in sessions + the shop (products / purchases / entitlements).
--
-- Why:
--   1. SESSIONS - THE REASON THE LEADERBOARD STOPPED RECORDING. Every authed call used to present
--      the player's raw Discord OAuth access token, which Discord expires 7 days after sign-in and
--      which nothing ever refreshed. From day 8 every POST /match answered 401; the client parked
--      the match in its outbox, retried it 40 times and deleted it, while the main menu kept
--      painting the avatar as signed in. Live D1 on 2026-09-27: the owner's last accepted request
--      was 2026-09-20, the last recorded match 2026-09-16, and there is a Jun 16 -> Sep 5 hole
--      with no match at all across months of daily play. Matches arrived in bursts after each
--      sign-in and stopped about a week later - the token's lifetime, exactly.
--      A session is minted ONCE from a verified Discord token (POST /auth/session) and then slides
--      forward every time it is used, so an active player never meets an expiry again.
--   2. THE SHOP. Paid liveries: what an account owns lives HERE, keyed by Discord id, so it
--      follows the player to every device and cannot be granted by editing localStorage.
--      products     = what is for sale and what it costs (the ONLY source of a price - the client
--                     never sends an amount).
--      purchases    = one row per checkout attempt, with the provider's order/capture ids.
--      entitlements = what an account owns. The only table the game reads for unlocks.
--
-- Apply (remote):
--   wrangler d1 execute lss-stats --remote --file=migration_006_sessions_and_shop.sql
-- Every statement is IF NOT EXISTS - safe to re-run. Nothing existing is altered.

-- ----------------------------------------------------------------------
-- Sessions. The raw token is `lss_<43 base64url chars>` and lives only in the player's browser;
-- this table keeps its SHA-256, so a database leak does not leak live logins.
-- expires_at slides forward on use (see SESSION_TTL_MS in worker.js); a session nobody uses for
-- the whole window lapses, and the player signs in with Discord again.
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  token_hash    TEXT PRIMARY KEY,
  discord_id    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  user_agent    TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_player  ON sessions(discord_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ----------------------------------------------------------------------
-- Products. A livery is sku 'skin:<SHIP_SKINS id>' (e.g. 'skin:img_diamond').
--   A skin is PREMIUM while a row names it (as the sku, or inside a bundle's grants_json).
--   active = 1 -> on sale.  active = 0 -> retired: still premium, owners keep it, nobody can buy.
--   Deleting the row makes the skin free for everyone again.
-- grants_json lists EXTRA skus a bundle unlocks; the product's own sku is always granted too.
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  sku          TEXT PRIMARY KEY,
  kind         TEXT NOT NULL DEFAULT 'skin',
  title        TEXT NOT NULL,
  price_cents  INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'USD',
  active       INTEGER NOT NULL DEFAULT 1,
  grants_json  TEXT NOT NULL DEFAULT '[]',
  sort         INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- ----------------------------------------------------------------------
-- Purchases. id is ours ('pur_...') and doubles as the PayPal invoice_id, so every PayPal
-- transaction in the merchant dashboard points back at exactly one row here.
-- status: created -> completed | pending (PayPal is holding the money) | review (captured but the
--         amount did not match - granted nothing, look at it) | failed | abandoned
--         completed -> refunded | reversed (chargeback) - the entitlement is revoked.
-- Kept on DELETE /me on purpose: these are payment records, and a player who deletes their stats
-- and signs in again still owns what they paid for.
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchases (
  id               TEXT PRIMARY KEY,
  discord_id       TEXT NOT NULL,
  sku              TEXT NOT NULL,
  provider         TEXT NOT NULL,
  provider_order   TEXT,
  provider_capture TEXT,
  status           TEXT NOT NULL,
  amount_cents     INTEGER NOT NULL,
  currency         TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  completed_at     INTEGER,
  note             TEXT
);

CREATE INDEX IF NOT EXISTS idx_purchases_player  ON purchases(discord_id);
CREATE INDEX IF NOT EXISTS idx_purchases_status  ON purchases(status, created_at);
CREATE INDEX IF NOT EXISTS idx_purchases_capture ON purchases(provider_capture);
-- NULLs are distinct in a SQLite unique index, so manual grants (no order id) never collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_order ON purchases(provider, provider_order);

-- ----------------------------------------------------------------------
-- Entitlements. One row per (account, sku). revoked_at is set on a refund / chargeback / manual
-- revoke rather than deleting the row, so the history survives. source = 'paypal' | 'grant'.
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entitlements (
  discord_id   TEXT NOT NULL,
  sku          TEXT NOT NULL,
  source       TEXT NOT NULL,
  purchase_id  TEXT,
  granted_at   INTEGER NOT NULL,
  revoked_at   INTEGER,
  note         TEXT,
  PRIMARY KEY (discord_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_entitlements_sku ON entitlements(sku);
