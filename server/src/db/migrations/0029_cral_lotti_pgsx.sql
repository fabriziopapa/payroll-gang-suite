-- ============================================================
-- Migration 0029 — Lotti CRAL arrivati da un file cifrato (.pgsx)
--
-- COSA. Dalla 26.11.14.4 i dati del CRAL passano da un'installazione
-- all'altra (produzione ↔ pre-produzione) in un file cifrato, dalla
-- scheda Impostazioni › «Esporta e importa». All'arrivo il file diventa
-- un lotto di variazioni da validare, come gia' fanno l'archivio in
-- chiaro e i tracciati Excel: questa migrazione aggiunge la provenienza
-- 'PGSX' a quelle ammesse.
--
-- PERCHE' UNA PROVENIENZA A PARTE. Un lotto arrivato da file cifrato non
-- si applica con la strada degli altri, che conferma le variazioni
-- riuscite e lascia in errore le altre: si applica solo per intero.
-- Finche' quella strada non c'e' (prossimo rilascio) si puo' confrontare,
-- accettare e provare, ma non applicare.
--
-- Non tocca i dati: cambia l'elenco dei valori ammessi da un vincolo.
-- Le righe che ci sono oggi restano valide.
--
-- NON si applica a mano:   ./pgs-migra.sh applica
-- Gira come superutente. Idempotente.
-- ============================================================

ALTER TABLE cral_lotti DROP CONSTRAINT IF EXISTS cral_lotti_origine_check;
ALTER TABLE cral_lotti ADD CONSTRAINT cral_lotti_origine_check CHECK (origine IN ('T6', 'T7', 'ARCHIVIO', 'PGSX'));

COMMENT ON TABLE cral_lotti IS 'Modulo CRAL: lotti di variazioni da validare (T6 aggiornamento dati, T7 quote versate, archivio da un altro ambiente, file cifrato .pgsx). Nulla si applica senza accettazione; a lotto chiuso restano solo i conteggi.';
