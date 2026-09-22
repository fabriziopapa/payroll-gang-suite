-- ============================================================
-- Migration 0016 — naz_iban in anagrafiche
--
-- COSA. Due lettere: il codice ISO 3166-1 alpha-2 del paese dell'IBAN su
-- cui CSA paga. Il FATTO, accanto al giudizio che ne deriva.
--
-- PERCHE'. Fino a oggi l'estrazione Oracle conservava solo la conclusione
-- (`area_conto = 'SEPA'`) e buttava la premessa (`LT`). Conseguenza
-- misurata: alla domanda "quali anagrafiche oggi EXTRA_UE cambierebbero
-- gruppo con l'elenco EPC corretto?" PGS non sapeva rispondere, perche' il
-- dato con cui rispondere non era stato conservato. Serviva tornare in
-- Oracle e rifare l'estrazione. Un archivio che tiene le conclusioni e
-- scarta le premesse non si puo' correggere: si puo' solo rifare.
--
-- Con la nazione in tabella, cambiare l'elenco EPC diventa un file piu' un
-- ricalcolo, e la differenza si vede PRIMA di essere scritta.
--
-- LA REGOLA NON STA QUI. `area_conto` resta una colonna SALVATA, non
-- generata: una colonna generata in Postgres pretende un'espressione
-- IMMUTABLE, cioe' l'elenco dei prefissi di nuovo dentro SQL — che e'
-- esattamente il problema da cui stiamo uscendo. La regola vive in
-- server/src/lib/areaConto.ts, con i suoi test; la colonna resta
-- indicizzabile e le query di oggi non cambiano.
--
-- PRIVACY. Qui entrano DUE LETTERE e nient'altro. Mai un IBAN, nemmeno
-- parziale o mascherato, mai un BIC, mai un ABI/CAB. Stesso livello di
-- riservatezza di area_conto.
--
-- NULL significa "non estratto": anagrafica importata prima di questa
-- migrazione, o file privo della colonna. E' diverso da area_conto =
-- 'NON_NOTO', che significa "estratto, ma nessuna coordinata CSA attiva".
--
-- IL RIPIEGO SUL BIC NON ESISTE PIU'. L'estrazione precedente, quando la
-- nazione era nulla, usava i caratteri 5-6 del BIC — che sono la nazione
-- della BANCA, non del CONTO. I dati di settembre 2026 mostrano il caso
-- opposto: REVOITM2 (Revolut) e BPPIITRRXXX (Poste) hanno IBAN italiani.
-- Misurato prima di togliere il ripiego: le coordinate CSA attive con
-- nazione nulla e BIC valorizzato sono ZERO. Toglierlo non cambia gruppo
-- a nessuno.
--
-- Idempotente: IF NOT EXISTS.
-- Applicare con:  ./pgs-migra.sh applica
-- ============================================================

ALTER TABLE anagrafiche ADD COLUMN IF NOT EXISTS naz_iban CHAR(2);

COMMENT ON COLUMN anagrafiche.naz_iban IS
  'Paese dell''IBAN su cui CSA paga, ISO 3166-1 alpha-2. Il fatto da cui si deriva area_conto. NULL = non estratto. Mai un IBAN, mai un BIC.';
