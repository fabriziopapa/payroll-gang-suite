-- ============================================================
-- Migration 0017 — la chiave di anagrafiche comprende il ruolo
--
-- COSA. Il vincolo di unicita' passa da (matricola, decor_inq) a
-- (matricola, decor_inq, ruolo).
--
-- PERCHE'. Alla fonte esistono persone con DUE rapporti veri che iniziano
-- lo STESSO giorno con ruoli diversi (estrazione del 2026-09-23: 16 casi,
-- per esempio ND e NM, o DR e BE). Con la chiave vecchia ne poteva entrare
-- uno solo: l'import li segnalava come "chiave duplicata" e teneva l'ultimo
-- nell'ordine del file, cioe' uno a caso. Misurato: una persona tornata ND
-- dopo un incarico NM risultava senza ruolo dal giorno in cui l'incarico
-- finiva, e l'unica riga che rispondeva giusto era un avanzo di un import
-- precedente. Con il ruolo nella chiave i due rapporti convivono, e dove
-- si sovrappongono PGS li mostra entrambi e sceglie l'operatore — come
-- gia' fa per i rapporti sovrapposti con decorrenze diverse.
--
-- EFFETTO SULLE LIQUIDAZIONI. Nessuna riga salvata cambia: il ruolo di una
-- liquidazione e' fotografato nella bozza. Cambia la risposta di "Aggiorna
-- Ruolo" alle sole date in cui i due rapporti dello stesso giorno sono
-- entrambi validi: invece di un ruolo scelto a caso, la scelta fra i due.
--
-- ORDINE. Prima si crea il vincolo nuovo, poi si toglie il vecchio: la
-- tabella non resta mai senza vincolo. I dati di oggi rispettano gia' il
-- vincolo nuovo (unici su due colonne implica unici su tre).
--
-- DOPO questa migrazione il codice PRECEDENTE non puo' piu' importare
-- anagrafiche (il suo ON CONFLICT (matricola, decor_inq) non trova piu' un
-- vincolo corrispondente): per questo va applicata insieme al rilascio
-- 26.09.24.1, che la usa, e non prima. Tutto il resto funziona.
--
-- NON si applica a mano:   ./pgs-migra.sh applica
-- Gira come superutente (proprietario della tabella). Idempotente.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'anagrafiche_matricola_decor_inq_ruolo_key'
      AND conrelid = 'anagrafiche'::regclass
  ) THEN
    ALTER TABLE anagrafiche
      ADD CONSTRAINT anagrafiche_matricola_decor_inq_ruolo_key
      UNIQUE (matricola, decor_inq, ruolo);
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'anagrafiche_matricola_decor_inq_key'
      AND conrelid = 'anagrafiche'::regclass
  ) THEN
    ALTER TABLE anagrafiche DROP CONSTRAINT anagrafiche_matricola_decor_inq_key;
  END IF;
END $$;

-- Se in qualche installazione la chiave vecchia fosse un indice unico e
-- non un vincolo (schema.ts la dichiarava come uniqueIndex), va tolta anche
-- in quella forma.
DROP INDEX IF EXISTS anagrafiche_matricola_decor_inq_key;
