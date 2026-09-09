-- ============================================================
-- Migration 0013 — ID liquidazione CSA sulle lavorazioni Emolumenti
--
-- Allinea `emolumenti_lavorazioni` a `bozze`: all'archiviazione si registra
-- non solo QUANDO e' stato liquidato (data_liquidazione, gia' presente) ma
-- anche CON QUALE liquidazione CSA, es. "1ND090005001220240442801".
-- Facoltativo: spesso l'ID arriva dopo, e si integra in un secondo momento.
--
-- Cosi' l'archiviazione di un emolumento chiede le stesse due cose
-- dell'archiviazione di una liquidazione, e usa lo stesso identico modale.
--
-- Applicare a mano, come proprietario della tabella:
--   psql -h <DB_HOST> -p <DB_PORT> -U payroll_user -d payroll_gang \
--        -f server/src/db/migrations/0013_emolumenti_id_liquidazione_csa.sql
--
-- Idempotente: IF NOT EXISTS.
-- ============================================================

ALTER TABLE emolumenti_lavorazioni
  ADD COLUMN IF NOT EXISTS id_liquidazione_csa VARCHAR(40);

COMMENT ON COLUMN emolumenti_lavorazioni.id_liquidazione_csa IS
  'ID liquidazione CSA (es. 1ND090005001220240442801) — facoltativo, integrabile dopo l''archiviazione.';
