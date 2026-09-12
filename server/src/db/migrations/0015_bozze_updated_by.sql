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
-- NON si applica a mano. La applica ./pgs-migra.sh, che la registra in
-- `schema_migrations`, riallinea i permessi e si ferma se qualcosa non
-- torna:
--
--   ./pgs-migra.sh applica
--
-- Dal 2026-09-12 le migrazioni girano come SUPERUTENTE del database,
-- perche' `payroll_user` non possiede piu' alcun oggetto (vedi
-- server/sql/permessi.sql). L'intestazione precedente di questo file
-- diceva di applicarla come `payroll_user`: era sbagliata, ed e' cio'
-- che ha prodotto l'incidente del 2026-09-12 su `bozze` — migrazione
-- rifiutata con "must be owner of table" e deploy proseguito comunque.
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
