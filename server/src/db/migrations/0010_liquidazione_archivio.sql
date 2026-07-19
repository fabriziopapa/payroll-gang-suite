-- ============================================================
-- Migration 0010 — Dati di archiviazione liquidazione
--   data_liquidazione    — data di liquidazione (obbligatoria alla
--                          archiviazione, richiesta dal modal client)
--   id_liquidazione_csa  — ID liquidazione generato da CSA,
--                          es. "1ND001950001220240442801" (facoltativo)
-- NULL per bozze attive e archiviate legacy (pre-migrazione).
-- Idempotente: IF NOT EXISTS.
-- Applicare a mano:  psql -U payroll_user -d payroll_gang -f 0010_liquidazione_archivio.sql
-- ============================================================

ALTER TABLE bozze ADD COLUMN IF NOT EXISTS data_liquidazione   DATE;
ALTER TABLE bozze ADD COLUMN IF NOT EXISTS id_liquidazione_csa VARCHAR(40);

COMMENT ON COLUMN bozze.data_liquidazione IS
  'Data di liquidazione — valorizzata all''archiviazione (obbligatoria nel flusso client).';
COMMENT ON COLUMN bozze.id_liquidazione_csa IS
  'ID liquidazione CSA (es. 1ND001950001220240442801) — facoltativo, integrabile dopo l''archiviazione.';
