-- ============================================================
-- Migration 0014 — chi ha modificato per ultimo una lavorazione Emolumenti
--
-- `created_by` c'era dalla 0012 e dice chi ha creato. Mancava il rovescio:
-- chi ha salvato per ultimo. Serve a sapere a chi chiedere quando una
-- lavorazione non torna, cosa che con piu' persone sullo stesso elenco
-- capita.
--
-- PERCHE' UNA COLONNA E NON L'AUDIT. Il dato ci sarebbe gia' in `audit_log`
-- (ogni `update` e' registrato con utente e id). Ma l'audit serve a
-- ricostruire cosa e' successo, non a far funzionare l'interfaccia: legando
-- l'elenco alla sua ritenzione, il giorno che lo si sfoltisce l'informazione
-- sparisce da schermo. Tenerli separati e' il motivo per cui l'audit puo'
-- essere archiviato senza rompere niente.
--
-- ON DELETE SET NULL come per `created_by`: cancellare un utente non deve
-- portarsi via la lavorazione.
--
-- Le righe esistenti restano a NULL, e non le riempiamo con `created_by`:
-- sarebbe un'ipotesi, non un fatto. Si popolano da se' al primo salvataggio.
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

ALTER TABLE emolumenti_lavorazioni
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_emol_lav_updated_by
  ON emolumenti_lavorazioni (updated_by);

COMMENT ON COLUMN emolumenti_lavorazioni.updated_by IS
  'Chi ha salvato per ultimo (update/archivia/riapri). NULL sulle righe precedenti alla 0014.';

-- Controllo: la colonna c'e' e l'indice pure.
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_name = 'emolumenti_lavorazioni'
  AND  column_name IN ('created_by', 'updated_by')
ORDER  BY column_name;
