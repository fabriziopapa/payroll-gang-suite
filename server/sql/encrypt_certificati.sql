-- ============================================================
-- PAYROLL GANG SUITE — Migration: cifratura a riposo certificati (PGS-04)
-- Allarga certificati.cf per ospitare il ciphertext AES-256-GCM
-- (iv:tag:cipher base64), come già fatto per familiari_cache.cod_fisc.
--
-- La cifratura vera e propria dei DATI (cf + dati_json) avviene nel
-- backfill applicativo, che ha la ENCRYPTION_KEY (non esprimibile in SQL).
--
-- ISTRUZIONI VPS (aapanel):
--   1. Backup DB da aapanel → Database → PostgreSQL → Backup
--   2. Apri Terminal aapanel
--   3. psql -U payroll_user -d payroll_gang -f /path/to/encrypt_certificati.sql
--
-- ORDINE OBBLIGATORIO:
--   1. Esegui QUESTO file sul VPS (allarga la colonna)
--   2. npm run build:server
--   3. node --env-file=../.env dist/db/encrypt-certificati-backfill.js
--        (cifra le righe esistenti — idempotente, ri-eseguibile)
--   4. pm2 restart payroll_gang_suite
-- ============================================================

BEGIN;

-- Allarga cf: 16 → 255 (il ciphertext è più lungo del CF in chiaro).
-- Widening puro: nessun cast/perdita dati sulle righe esistenti.
ALTER TABLE certificati ALTER COLUMN cf TYPE varchar(255);

COMMIT;
