-- ============================================================
-- Migration 0015 — chi ha modificato per ultimo una liquidazione
--
-- Gemella della 0014, che ha fatto la stessa cosa su
-- `emolumenti_lavorazioni`. Le due aree erano rimaste asimmetriche: in
-- Emolumenti si vedeva chi aveva salvato per ultimo, in Liquidazioni no.
-- Con piu' persone sullo stesso elenco la domanda che si fa e' "chi ha
-- toccato questa liquidazione?", non "chi l'ha creata tre mesi fa".
--
-- ON DELETE SET NULL come per `created_by`: cancellare un utente non deve
-- portarsi via la liquidazione.
--
-- Le righe esistenti restano a NULL, e non le riempiamo con `created_by`:
-- sarebbe un'ipotesi, non un fatto. Si popolano da se' al primo
-- salvataggio, archiviazione o riapertura.
--
-- Applicare a mano, COME PROPRIETARIO della tabella (vedi
-- server/sql/owner_payroll_user.sql): `setup.sql` crea le tabelle come
-- `postgres`, quindi un ALTER da un altro utente viene rifiutato con
-- "must be owner of table".
--
--   psql -h <DB_HOST> -p <DB_PORT> -U payroll_user -d payroll_gang \
--        -f server/src/db/migrations/0015_bozze_updated_by.sql
--
-- Additiva e idempotente: si puo' applicare a codice vecchio ancora in
-- esecuzione, senza fermare niente.
-- ============================================================

ALTER TABLE bozze
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bozze_updated_by ON bozze (updated_by);

COMMENT ON COLUMN bozze.updated_by IS
  'Chi ha salvato per ultimo (update/archive/restore/liquidazione-info). NULL sulle righe precedenti alla 0015.';

-- Controllo: le due colonne ci sono.
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_name = 'bozze'
  AND  column_name IN ('created_by', 'updated_by')
ORDER  BY column_name;
