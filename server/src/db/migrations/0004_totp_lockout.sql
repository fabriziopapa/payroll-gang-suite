-- ============================================================
-- Migration 0004 — TOTP Lockout per-utente (SEC-M01)
-- Blocca l'account per 15 minuti dopo 5 OTP errati consecutivi.
-- Eseguire una sola volta sul DB di produzione/sviluppo.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_otp_count  integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until      timestamptz;

COMMENT ON COLUMN users.failed_otp_count IS
  'SEC-M01: numero di tentativi OTP falliti consecutivi. Resettato a 0 dopo login riuscito.';
COMMENT ON COLUMN users.locked_until IS
  'SEC-M01: timestamp fino al quale l''account è bloccato (now+15m). NULL = non bloccato.';

-- ============================================================
-- RECOVERY DI EMERGENZA — superadmin bloccato
-- ============================================================
-- Se l'unico admin è bloccato (5 OTP falliti) e non può accedere all'interfaccia
-- per usare POST /api/v1/users/:id/unlock, eseguire questo SQL direttamente sul DB:
--
--   UPDATE users
--     SET failed_otp_count = 0, locked_until = NULL
--     WHERE username = 'admin';
--
-- Questo sblocca l'account senza cambiare il segreto TOTP.
-- Registrare manualmente l'operazione nel log di sistema per audit.
-- ============================================================
