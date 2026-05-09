-- ============================================================
-- Migration 0003 — JWT Blocklist (SEC-C02)
-- Permette la revoca immediata degli access token al logout.
-- Eseguire una sola volta sul DB di produzione/sviluppo.
-- ============================================================

CREATE TABLE IF NOT EXISTS jwt_blocklist (
  jti        varchar(36)  NOT NULL,
  expires_at timestamptz  NOT NULL,
  CONSTRAINT jwt_blocklist_pkey PRIMARY KEY (jti)
);

-- Indice per la pulizia periodica dei token scaduti (job ogni ora)
CREATE INDEX IF NOT EXISTS idx_jwt_blocklist_expires_at
  ON jwt_blocklist (expires_at);

COMMENT ON TABLE jwt_blocklist IS
  'SEC-C02: JWT access token revocati al logout. Righe scadute eliminate automaticamente ogni ora.';
COMMENT ON COLUMN jwt_blocklist.jti IS
  'JWT ID (claim jti) — UUID v4 emesso al momento della firma del token.';
COMMENT ON COLUMN jwt_blocklist.expires_at IS
  'Scadenza originale del token (claim exp). Usata per la pulizia automatica.';
