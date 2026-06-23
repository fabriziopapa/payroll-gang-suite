-- ============================================================
-- Migration 0009 — familiari_cache: cod_fisc cifrato (AES-256-GCM)
-- Il CF dei familiari (PII di minori) ora è cifrato a riposo: il
-- valore "iv:tag:cipher" in base64 supera i 16 char → allarga la colonna.
-- Idempotente. Applicare a mano:
--   psql -U postgres -d payroll_gang -f 0009_familiari_cf_encrypted.sql
-- ============================================================

ALTER TABLE familiari_cache
  ALTER COLUMN cod_fisc TYPE VARCHAR(255);

-- Svuota eventuali righe in chiaro pre-cifratura (verranno ripopolate cifrate
-- al prossimo lookup). Sicuro: è solo cache.
TRUNCATE familiari_cache;

COMMENT ON COLUMN familiari_cache.cod_fisc IS
  'Codice fiscale CIFRATO (AES-256-GCM, formato iv:tag:cipher base64).';
