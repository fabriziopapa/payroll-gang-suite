-- ============================================================
-- Migration 0020 — Tipi conto: elaborazioni mensili dalle testate CSA
--
-- COSA. Due tabelle per la funzione "Tipi conto" dell'area Emolumenti:
--   · emolumenti_tipiconto_elab   una riga per elaborazione (mese, ruolo,
--                                 comparto, stato anteprima/confermata);
--   · emolumenti_tipiconto_righe  una riga per matricola: nazione del conto
--                                 su cui CSA ha pagato, tipo conto, motivo
--                                 se da chiarire, progressivi delle testate.
--
-- PERCHE'. Mese per mese l'ufficio deve sapere chi e' pagato su conto
-- italiano, SEPA o extra UE, e produrre un TXT per gruppo. La fonte e' la
-- testata del liquidato CSA: il pagamento, non una stima dall'anagrafica.
-- L'elaborazione si CONGELA: resta leggibile anche quando in CSA la
-- liquidazione non c'e' piu'.
--
-- REGOLE
--   · una sola elaborazione CONFERMATA e non archiviata per mese, ruolo e
--     comparto (indice unico parziale); le anteprime non si bloccano a
--     vicenda;
--   · `progressivi` non e' decorativo: dice perche' una matricola con piu'
--     testate e' stata contata una volta sola;
--   · `elenco_paesi` dice con quale elenco dei paesi e' stata classificata:
--     senza, fra un anno due mesi identici darebbero gruppi diversi e
--     nessuno saprebbe perche';
--   · `fonte` = 'manuale' quando la nazione di una riga da chiarire l'ha
--     inserita una persona, con la sua nota: si vede sempre che lo e'.
--
-- PRIVACY. Nessun IBAN, nessun BIC, nessuna intestazione: della testata
-- sopravvivono matricola, progressivo e due lettere di nazione.
--
-- NON si applica a mano:   ./pgs-migra.sh applica
-- Gira come superutente. Additiva e idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS emolumenti_tipiconto_elab (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  anno                SMALLINT     NOT NULL CHECK (anno BETWEEN 1990 AND 2100),
  mese                SMALLINT     NOT NULL CHECK (mese BETWEEN 1 AND 12),
  ruolo               VARCHAR(4)   NOT NULL,
  comparto            VARCHAR(2)   NOT NULL,
  progr_liquidazione  VARCHAR(3),
  stato               VARCHAR(12)  NOT NULL CHECK (stato IN ('anteprima', 'confermata')),
  testate_lette       INTEGER      NOT NULL,
  testate_liquid      INTEGER      NOT NULL,
  elenco_paesi        VARCHAR(40)  NOT NULL,
  recuperata_il       TIMESTAMPTZ  NOT NULL,
  created_by          UUID         REFERENCES users(id) ON DELETE SET NULL,
  updated_by          UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  archiviata_il       TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS emolumenti_tipiconto_una_confermata
  ON emolumenti_tipiconto_elab (anno, mese, ruolo, comparto)
  WHERE stato = 'confermata' AND archiviata_il IS NULL;
CREATE INDEX IF NOT EXISTS emolumenti_tipiconto_periodo
  ON emolumenti_tipiconto_elab (anno DESC, mese DESC);

CREATE TABLE IF NOT EXISTS emolumenti_tipiconto_righe (
  elab_id      UUID         NOT NULL REFERENCES emolumenti_tipiconto_elab(id) ON DELETE CASCADE,
  matricola    VARCHAR(6)   NOT NULL,
  naz_iban     CHAR(2),
  tipo_conto   VARCHAR(12)  NOT NULL CHECK (tipo_conto IN ('IT', 'SEPA', 'EXTRA_UE', 'DA_CHIARIRE')),
  motivo       VARCHAR(40),
  progressivi  VARCHAR(40)  NOT NULL,
  fonte        VARCHAR(10)  NOT NULL DEFAULT 'CSA' CHECK (fonte IN ('CSA', 'manuale')),
  nota         VARCHAR(300),
  PRIMARY KEY (elab_id, matricola)
);
