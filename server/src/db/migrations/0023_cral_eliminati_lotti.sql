-- ============================================================
-- Migration 0023 — Modulo CRAL: stato «Eliminato», ex matricola,
-- lotti di variazioni da validare (aggiornamento massivo T6 e
-- archivio fra ambienti)
--
-- ELIMINATO. Un quinto stato della persona: esce da elenchi, eventi e
-- report e non deve la quota dall'anno dell'eliminazione. Non si cancella
-- nulla: si ricorda lo stato di prima (stato_prima) e con «Ripristina» ci
-- si torna, con la stessa tessera. Gli anni passati da eliminato restano
-- esenti anche dopo il ripristino (anni_esenti).
--
-- EX MATRICOLA. Il socio dipendente che lascia l'Ateneo e resta socio
-- diventa socio esterno con un nuovo ID EXT-nnnn: la matricola non e' piu'
-- l'ID (vincolo cral_soci_id_matricola) e va in ex_matricola, cosi' il
-- prossimo libro soci lo riconosce invece di creare un doppione.
--
-- LOTTI. Le variazioni proposte da un file (T6) o da un archivio di un
-- altro ambiente non si scrivono subito: si salvano qui, si accettano o
-- si scartano (anche un campo alla volta) e solo allora si applicano.
-- A lotto chiuso le variazioni si cancellano e resta il riepilogo.
--
-- NON si applica a mano:   ./pgs-migra.sh applica
-- Gira come superutente. Additiva e idempotente.
-- ============================================================

ALTER TABLE cral_soci DROP CONSTRAINT IF EXISTS cral_soci_stato_check;
ALTER TABLE cral_soci ADD CONSTRAINT cral_soci_stato_check
  CHECK (stato IN ('ATTIVO', 'DA_VALIDARE', 'RIFIUTATO', 'CESSATO', 'ELIMINATO'));

ALTER TABLE cral_soci ADD COLUMN IF NOT EXISTS eliminato_il  DATE;
ALTER TABLE cral_soci ADD COLUMN IF NOT EXISTS eliminato_da  UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE cral_soci ADD COLUMN IF NOT EXISTS stato_prima   VARCHAR(12);
ALTER TABLE cral_soci ADD COLUMN IF NOT EXISTS anni_esenti   SMALLINT[] NOT NULL DEFAULT '{}';
ALTER TABLE cral_soci ADD COLUMN IF NOT EXISTS ex_matricola  VARCHAR(10);

ALTER TABLE cral_soci DROP CONSTRAINT IF EXISTS cral_soci_eliminato;
ALTER TABLE cral_soci ADD CONSTRAINT cral_soci_eliminato CHECK (
  stato <> 'ELIMINATO' OR (eliminato_il IS NOT NULL AND stato_prima IN ('ATTIVO', 'DA_VALIDARE', 'RIFIUTATO', 'CESSATO')));
ALTER TABLE cral_soci DROP CONSTRAINT IF EXISTS cral_soci_ex_matricola;
ALTER TABLE cral_soci ADD CONSTRAINT cral_soci_ex_matricola CHECK (ex_matricola IS NULL OR ex_matricola ~ '^[0-9]{1,10}$');
CREATE UNIQUE INDEX IF NOT EXISTS cral_soci_ex_matricola_u ON cral_soci (ex_matricola) WHERE ex_matricola IS NOT NULL;

CREATE TABLE IF NOT EXISTS cral_lotti (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  origine     VARCHAR(8)    NOT NULL CHECK (origine IN ('T6', 'ARCHIVIO')),
  file        VARCHAR(200)  NOT NULL DEFAULT '',
  ambiente    VARCHAR(80)   NOT NULL DEFAULT '',
  esportato   TIMESTAMPTZ,
  sezioni     TEXT[]        NOT NULL DEFAULT '{}',
  stato       VARCHAR(10)   NOT NULL DEFAULT 'APERTO' CHECK (stato IN ('APERTO', 'CHIUSO', 'SCARTATO')),
  riepilogo   JSONB         NOT NULL DEFAULT '{}'::jsonb,
  creato_da   UUID          REFERENCES users(id) ON DELETE SET NULL,
  creato_il   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  chiuso_da   UUID          REFERENCES users(id) ON DELETE SET NULL,
  chiuso_il   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS cral_lotti_stato ON cral_lotti (stato, creato_il);

CREATE TABLE IF NOT EXISTS cral_lotti_variazioni (
  id         SERIAL        PRIMARY KEY,
  lotto_id   UUID          NOT NULL REFERENCES cral_lotti(id) ON DELETE CASCADE,
  ordine     INTEGER       NOT NULL,
  sezione    VARCHAR(10)   NOT NULL CHECK (sezione IN ('sedi', 'tabelle', 'soci', 'quote', 'eventi')),
  entita     VARCHAR(10)   NOT NULL,
  chiave     VARCHAR(80)   NOT NULL,
  tipo       VARCHAR(10)   NOT NULL CHECK (tipo IN ('NUOVO', 'MODIFICA', 'CONFLITTO')),
  delicata   BOOLEAN       NOT NULL DEFAULT FALSE,
  esito      VARCHAR(10)   NOT NULL DEFAULT 'ATTESA' CHECK (esito IN ('ATTESA', 'ACCETTATA', 'SCARTATA', 'APPLICATA', 'ERRORE')),
  accettati  TEXT[]        NOT NULL DEFAULT '{}',
  dati       JSONB         NOT NULL,
  nota       VARCHAR(300)  NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS cral_lotti_variazioni_lotto ON cral_lotti_variazioni (lotto_id, ordine);

COMMENT ON TABLE cral_lotti IS
  'Modulo CRAL: lotti di variazioni da validare (T6 aggiornamento dati, archivio da un altro ambiente). Nulla si applica senza accettazione; a lotto chiuso restano solo i conteggi.';
COMMENT ON TABLE cral_lotti_variazioni IS
  'Modulo CRAL: una riga per record proposto (nuovo, modificato, in conflitto). dati JSONB = etichetta, campi prima/dopo, record d''origine; si svuota alla chiusura del lotto.';
