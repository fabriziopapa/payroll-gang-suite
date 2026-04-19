-- ============================================================
-- PAYROLL GANG SUITE — Migration: Anagrafiche V2
-- Aggiunge storico ruoli alla tabella anagrafiche esistente
--
-- ISTRUZIONI VPS (aapanel):
--   1. Backup DB da aapanel → Database → PostgreSQL → Backup
--   2. Apri Terminal aapanel
--   3. psql -U payroll_user -d payroll_gang -f /path/to/migrate_anagrafiche_v2.sql
--      oppure copia-incolla nel query editor di aapanel
--
-- ORDINE OBBLIGATORIO:
--   1. Esegui questo file sul VPS
--   2. Poi: npm run build:server && pm2 restart payroll_gang_suite
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- STEP 1 — Aggiunge le nuove colonne (nullable inizialmente)
-- ------------------------------------------------------------

ALTER TABLE anagrafiche
  ADD COLUMN IF NOT EXISTS decor_inq DATE,
  ADD COLUMN IF NOT EXISTS fin_rap   DATE;

-- ------------------------------------------------------------
-- STEP 2 — Popola decor_inq con data_aggiornamento per le
--           righe esistenti (migliore approssimazione disponibile)
-- ------------------------------------------------------------

UPDATE anagrafiche
SET decor_inq = data_aggiornamento
WHERE decor_inq IS NULL;

-- ------------------------------------------------------------
-- STEP 3 — Rende decor_inq NOT NULL
-- ------------------------------------------------------------

ALTER TABLE anagrafiche
  ALTER COLUMN decor_inq SET NOT NULL;

-- ------------------------------------------------------------
-- STEP 4 — Rimuove il vincolo UNIQUE sulla sola matricola
--           (IF EXISTS per sicurezza: il nome varia tra versioni)
-- ------------------------------------------------------------

ALTER TABLE anagrafiche
  DROP CONSTRAINT IF EXISTS anagrafiche_matricola_key;

ALTER TABLE anagrafiche
  DROP CONSTRAINT IF EXISTS anagrafiche_matricola_unique;

-- ------------------------------------------------------------
-- STEP 5 — Aggiunge il nuovo vincolo UNIQUE su (matricola, decor_inq)
-- ------------------------------------------------------------

ALTER TABLE anagrafiche
  ADD CONSTRAINT anagrafiche_matricola_decor_inq_key
  UNIQUE (matricola, decor_inq);

-- ------------------------------------------------------------
-- STEP 6 — Elimina colonne non più necessarie con v2
-- ------------------------------------------------------------

ALTER TABLE anagrafiche
  DROP COLUMN IF EXISTS cod_fisc,
  DROP COLUMN IF EXISTS ruolo_corr,
  DROP COLUMN IF EXISTS druolo_corr;

-- ------------------------------------------------------------
-- STEP 7 — Indici per performance query ruolo-at
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_anag_matricola
  ON anagrafiche(matricola);

CREATE INDEX IF NOT EXISTS idx_anag_storico
  ON anagrafiche(matricola, decor_inq, fin_rap);

-- ------------------------------------------------------------
-- STEP 8 — Verifica finale (deve mostrare le colonne aggiornate)
-- ------------------------------------------------------------

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'anagrafiche'
ORDER BY ordinal_position;

COMMIT;
