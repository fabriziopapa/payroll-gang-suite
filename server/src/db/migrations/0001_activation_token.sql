-- ============================================================
-- Migration 0001 — Activation token con scadenza 24h (Fix #4)
-- Eseguire una sola volta sul DB di produzione/sviluppo.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS activation_token_hash  varchar(64),
  ADD COLUMN IF NOT EXISTS activation_expires_at  timestamptz;

-- Indice per lookup rapido durante l'attivazione
CREATE INDEX IF NOT EXISTS idx_users_activation_token
  ON users (activation_token_hash)
  WHERE activation_token_hash IS NOT NULL;

COMMENT ON COLUMN users.activation_token_hash IS
  'SHA-256 hex del token di attivazione grezzo (mai salvato in chiaro). NULL = nessun token pendente.';
COMMENT ON COLUMN users.activation_expires_at IS
  'Scadenza del token di attivazione (24h da emissione). NULL = nessun token pendente.';
