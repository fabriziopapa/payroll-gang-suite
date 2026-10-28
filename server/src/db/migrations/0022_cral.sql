-- ============================================================
-- Migration 0022 — Modulo CRAL: soci, sedi, eventi, quote associative
--
-- COSA. Il modulo CRAL (solo admin): anagrafica dei soci e delle persone
-- che partecipano agli eventi, sedi di consegna, eventi (strenne,
-- panettoni, vendite, gite, campi estivi, cinema) con le scelte di ogni
-- persona, magazzino dei biglietti e quote associative annuali.
--
-- TABELLE
--   · cral_sedi                 sedi di consegna («Esterni» compresa)
--   · cral_parametri            una riga: formato della tessera, prossimi ID
--   · cral_tipi                 tipi di evento (colore, a pagamento, modalita')
--   · cral_tipologie_prodotto   tipologie dei prodotti a pagamento
--   · cral_soci                 persone: socio dipendente (SD), socio esterno
--                               (SE), esterno (EST), familiare (FAM)
--   · cral_familiari_legami     familiare → uno o piu' soci (coniuge, figlio)
--   · cral_soci_tessere         storico delle tessere di chi e' cessato
--   · cral_iniziative           eventi; i dettagli (opzioni, prodotti,
--                               settimane, articoli, sconti per tipologia)
--                               in `config` JSONB, validato dal server
--   · cral_iniziative_partecipanti  partecipanti degli eventi «singoli»
--   · cral_scelte               una riga per persona e evento: scelta,
--                               quantita', settimane, versato, sconto
--                               personale... in `dati` JSONB validato
--   · cral_carichi, cral_richieste  magazzino biglietti (cinema)
--   · cral_quote_anno, cral_quote   quota associativa per anno solare
--
-- IDENTITA'. Il socio dipendente ha come ID la matricola PGS; gli altri
-- EXT-nnnn o FAM-nnnn. Quando un esterno si «trova in anagrafica PGS»
-- l'ID diventa la matricola: tutte le chiavi esterne sono ON UPDATE
-- CASCADE, quindi legami, scelte, richieste e quote lo seguono.
--
-- PRIVACY. Nessun codice fiscale (decisione GDPR): cognome, nome e data
-- di nascita. Email facoltativa. L'audit registra ID e conteggi, mai nomi.
--
-- NON si applica a mano:   ./pgs-migra.sh applica
-- Gira come superutente. Additiva e idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS cral_sedi (
  id          VARCHAR(12)   PRIMARY KEY CHECK (id ~ '^[A-Z0-9]{1,12}$'),
  nome        VARCHAR(120)  NOT NULL CHECK (char_length(btrim(nome)) > 0),
  attiva      BOOLEAN       NOT NULL DEFAULT TRUE,
  ordine      INTEGER       NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cral_sedi_nome ON cral_sedi (lower(nome));

CREATE TABLE IF NOT EXISTS cral_parametri (
  id                SMALLINT     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  tessera_formato   VARCHAR(4)   NOT NULL DEFAULT 'NUM' CHECK (tessera_formato IN ('NUM', 'PREF')),
  tessera_prefisso  VARCHAR(10)  NOT NULL DEFAULT 'CRAL-',
  tessera_cifre     SMALLINT     NOT NULL DEFAULT 4 CHECK (tessera_cifre BETWEEN 1 AND 8),
  tessera_prossimo  INTEGER      NOT NULL DEFAULT 1 CHECK (tessera_prossimo >= 1),
  riammissione      VARCHAR(8)   NOT NULL DEFAULT 'NUOVO' CHECK (riammissione IN ('NUOVO', 'SUFFISSO')),
  suffisso_sep      VARCHAR(1)   NOT NULL DEFAULT '/' CHECK (suffisso_sep IN ('/', '-', '.', '')),
  suffisso_cifre    SMALLINT     NOT NULL DEFAULT 2 CHECK (suffisso_cifre BETWEEN 1 AND 3),
  ext_prossimo      INTEGER      NOT NULL DEFAULT 1 CHECK (ext_prossimo >= 1),
  fam_prossimo      INTEGER      NOT NULL DEFAULT 1 CHECK (fam_prossimo >= 1),
  updated_by        UUID         REFERENCES users(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);
INSERT INTO cral_parametri (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS cral_tipi (
  id           VARCHAR(10)  PRIMARY KEY CHECK (id ~ '^[A-Z0-9]{1,10}$'),
  nome         VARCHAR(60)  NOT NULL CHECK (char_length(btrim(nome)) > 0),
  colore       CHAR(7)      NOT NULL DEFAULT '#6366F1' CHECK (colore ~ '^#[0-9A-Fa-f]{6}$'),
  a_pagamento  BOOLEAN      NOT NULL DEFAULT FALSE,
  modo         VARCHAR(10)  CHECK (modo IN ('SCELTA', 'NESSUNA', 'ORDINE', 'TURNI', 'MAGAZZINO')),
  attivo       BOOLEAN      NOT NULL DEFAULT TRUE,
  ordine       INTEGER      NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cral_tipologie_prodotto (
  id      VARCHAR(10)  PRIMARY KEY CHECK (id ~ '^[A-Z0-9]{1,10}$'),
  nome    VARCHAR(80)  NOT NULL CHECK (char_length(btrim(nome)) > 0),
  attiva  BOOLEAN      NOT NULL DEFAULT TRUE,
  ordine  INTEGER      NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cral_soci (
  id             VARCHAR(12)   PRIMARY KEY CHECK (id ~ '^([0-9]{1,10}|EXT-[0-9]{4,6}|FAM-[0-9]{4,6})$'),
  tipo           VARCHAR(3)    NOT NULL CHECK (tipo IN ('SD', 'SE', 'EST', 'FAM')),
  matricola      VARCHAR(10)   UNIQUE,
  cognome        VARCHAR(100)  NOT NULL CHECK (char_length(btrim(cognome)) > 0),
  nome           VARCHAR(100)  NOT NULL DEFAULT '',
  nascita        DATE,
  email          VARCHAR(254),
  sede_id        VARCHAR(12)   REFERENCES cral_sedi(id) ON UPDATE CASCADE ON DELETE SET NULL,
  tessera        VARCHAR(30),
  riammissioni   SMALLINT      NOT NULL DEFAULT 0 CHECK (riammissioni >= 0),
  stato          VARCHAR(12)   NOT NULL DEFAULT 'DA_VALIDARE' CHECK (stato IN ('ATTIVO', 'DA_VALIDARE', 'RIFIUTATO', 'CESSATO')),
  iscritto_il    DATE          NOT NULL DEFAULT CURRENT_DATE,
  cessato_il     DATE,
  provenienza    VARCHAR(200),
  atipico        BOOLEAN       NOT NULL DEFAULT FALSE,
  note           VARCHAR(1000) NOT NULL DEFAULT '',
  creato_da      UUID          REFERENCES users(id) ON DELETE SET NULL,
  creato_il      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  validato_da    UUID          REFERENCES users(id) ON DELETE SET NULL,
  validato_il    TIMESTAMPTZ,
  modificato_da  UUID          REFERENCES users(id) ON DELETE SET NULL,
  modificato_il  TIMESTAMPTZ,
  -- Il socio dipendente e' una matricola PGS, e la matricola e' l'ID.
  CONSTRAINT cral_soci_sd_matricola CHECK (tipo <> 'SD' OR matricola IS NOT NULL),
  CONSTRAINT cral_soci_id_matricola CHECK (matricola IS NULL OR id = matricola),
  -- La tessera e' solo dei soci (dipendenti ed esterni).
  CONSTRAINT cral_soci_tessera_soci CHECK (tessera IS NULL OR tipo IN ('SD', 'SE')),
  CONSTRAINT cral_soci_cessato CHECK (stato <> 'CESSATO' OR cessato_il IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS cral_soci_tessera ON cral_soci (lower(tessera)) WHERE tessera IS NOT NULL;
CREATE INDEX IF NOT EXISTS cral_soci_stato ON cral_soci (stato, tipo);

CREATE TABLE IF NOT EXISTS cral_familiari_legami (
  familiare_id  VARCHAR(12)  NOT NULL REFERENCES cral_soci(id) ON UPDATE CASCADE ON DELETE CASCADE,
  socio_id      VARCHAR(12)  NOT NULL REFERENCES cral_soci(id) ON UPDATE CASCADE ON DELETE CASCADE,
  relazione     VARCHAR(8)   NOT NULL CHECK (relazione IN ('CONIUGE', 'FIGLIO')),
  PRIMARY KEY (familiare_id, socio_id),
  CHECK (familiare_id <> socio_id)
);
CREATE INDEX IF NOT EXISTS cral_familiari_legami_socio ON cral_familiari_legami (socio_id);

CREATE TABLE IF NOT EXISTS cral_soci_tessere (
  id        SERIAL       PRIMARY KEY,
  socio_id  VARCHAR(12)  NOT NULL REFERENCES cral_soci(id) ON UPDATE CASCADE ON DELETE CASCADE,
  tessera   VARCHAR(30)  NOT NULL,
  dal       DATE,
  al        DATE         NOT NULL
);
CREATE INDEX IF NOT EXISTS cral_soci_tessere_socio ON cral_soci_tessere (socio_id);

CREATE TABLE IF NOT EXISTS cral_iniziative (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_id        VARCHAR(10)   NOT NULL REFERENCES cral_tipi(id) ON UPDATE CASCADE,
  titolo         VARCHAR(160)  NOT NULL CHECK (char_length(btrim(titolo)) > 0),
  anno           SMALLINT      NOT NULL,
  data           DATE          NOT NULL,
  scadenza       DATE,
  stato          VARCHAR(8)    NOT NULL DEFAULT 'BOZZA' CHECK (stato IN ('BOZZA', 'APERTA', 'CHIUSA')),
  modalita       VARCHAR(10)   NOT NULL CHECK (modalita IN ('SCELTA', 'NESSUNA', 'ORDINE', 'TURNI', 'MAGAZZINO')),
  partecipanti   VARCHAR(7)    NOT NULL DEFAULT 'GRUPPI' CHECK (partecipanti IN ('GRUPPI', 'SINGOLI')),
  gruppi         TEXT[]        NOT NULL DEFAULT '{}' CHECK (gruppi <@ ARRAY['SD', 'SE', 'EST', 'FAM']::text[]),
  sedi           TEXT[]        NOT NULL DEFAULT '{}',
  predefinita    VARCHAR(20),
  fornitore      VARCHAR(160)  NOT NULL DEFAULT '',
  pagamento      VARCHAR(300)  NOT NULL DEFAULT '',
  note           VARCHAR(1000) NOT NULL DEFAULT '',
  quota_cent     INTEGER       NOT NULL DEFAULT 0 CHECK (quota_cent >= 0),
  config         JSONB         NOT NULL DEFAULT '{}'::jsonb,
  archiviata     BOOLEAN       NOT NULL DEFAULT FALSE,
  archiviata_da  UUID          REFERENCES users(id) ON DELETE SET NULL,
  archiviata_il  TIMESTAMPTZ,
  created_by     UUID          REFERENCES users(id) ON DELETE SET NULL,
  updated_by     UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cral_iniziative_partecipanti (
  iniziativa_id  UUID         NOT NULL REFERENCES cral_iniziative(id) ON DELETE CASCADE,
  socio_id       VARCHAR(12)  NOT NULL REFERENCES cral_soci(id) ON UPDATE CASCADE ON DELETE CASCADE,
  PRIMARY KEY (iniziativa_id, socio_id)
);

CREATE TABLE IF NOT EXISTS cral_scelte (
  iniziativa_id  UUID         NOT NULL REFERENCES cral_iniziative(id) ON DELETE CASCADE,
  socio_id       VARCHAR(12)  NOT NULL REFERENCES cral_soci(id) ON UPDATE CASCADE ON DELETE CASCADE,
  dati           JSONB        NOT NULL DEFAULT '{}'::jsonb,
  fonte          VARCHAR(12)  NOT NULL DEFAULT 'manuale' CHECK (fonte IN ('manuale', 'modulo', 'predefinita')),
  updated_by     UUID         REFERENCES users(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (iniziativa_id, socio_id)
);
CREATE INDEX IF NOT EXISTS cral_scelte_socio ON cral_scelte (socio_id);

CREATE TABLE IF NOT EXISTS cral_carichi (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  iniziativa_id  UUID          NOT NULL REFERENCES cral_iniziative(id) ON DELETE CASCADE,
  articolo       VARCHAR(20)   NOT NULL,
  quantita       INTEGER       NOT NULL CHECK (quantita > 0),
  data           DATE          NOT NULL,
  note           VARCHAR(300)  NOT NULL DEFAULT '',
  created_by     UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cral_carichi_iniziativa ON cral_carichi (iniziativa_id);

CREATE TABLE IF NOT EXISTS cral_richieste (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  iniziativa_id   UUID          NOT NULL REFERENCES cral_iniziative(id) ON DELETE CASCADE,
  socio_id        VARCHAR(12)   NOT NULL REFERENCES cral_soci(id) ON UPDATE CASCADE,
  articolo        VARCHAR(20)   NOT NULL,
  quantita        INTEGER       NOT NULL CHECK (quantita > 0),
  data_richiesta  DATE          NOT NULL,
  stato           VARCHAR(10)   NOT NULL DEFAULT 'ATTESA' CHECK (stato IN ('ATTESA', 'CONSEGNATA', 'ANNULLATA')),
  data_consegna   DATE,
  modo            VARCHAR(5)    NOT NULL DEFAULT 'MANO' CHECK (modo IN ('MANO', 'EMAIL')),
  pagato          BOOLEAN       NOT NULL DEFAULT FALSE,
  sconto          JSONB,
  note            VARCHAR(300)  NOT NULL DEFAULT '',
  created_by      UUID          REFERENCES users(id) ON DELETE SET NULL,
  updated_by      UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CHECK (stato <> 'CONSEGNATA' OR data_consegna IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS cral_richieste_iniziativa ON cral_richieste (iniziativa_id);

CREATE TABLE IF NOT EXISTS cral_quote_anno (
  anno          SMALLINT     PRIMARY KEY CHECK (anno BETWEEN 2000 AND 2100),
  importo_cent  INTEGER      NOT NULL CHECK (importo_cent > 0),
  updated_by    UUID         REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cral_quote (
  anno        SMALLINT     NOT NULL REFERENCES cral_quote_anno(anno) ON DELETE CASCADE,
  socio_id    VARCHAR(12)  NOT NULL REFERENCES cral_soci(id) ON UPDATE CASCADE ON DELETE CASCADE,
  modo        VARCHAR(10)  NOT NULL CHECK (modo IN ('UNICA', 'MENSILE', 'TRATTENUTA')),
  mesi        BOOLEAN[]    NOT NULL DEFAULT ARRAY[false,false,false,false,false,false,false,false,false,false,false,false]
                           CHECK (cardinality(mesi) = 12),
  pagata_il   DATE,
  note        VARCHAR(300) NOT NULL DEFAULT '',
  updated_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (anno, socio_id)
);

COMMENT ON TABLE cral_soci IS
  'Modulo CRAL: soci dipendenti (ID = matricola PGS), soci esterni, esterni e familiari (EXT-/FAM-). Nessun codice fiscale: cognome, nome, data di nascita.';
COMMENT ON TABLE cral_iniziative IS
  'Modulo CRAL: eventi. config JSONB = opzioni, prodotti, periodi (settimane), articoli (biglietti), sconti per tipologia; validato dal server (lib/cral.ts).';
COMMENT ON TABLE cral_scelte IS
  'Modulo CRAL: una riga per persona e evento. dati JSONB = scelta, quantita, settimane, versato, pagato, consegnato, note, riferimento, sconto personale; validato dal server.';

-- Valori iniziali: solo su tabelle vuote, cosi' rilanciarla non duplica e
-- non resuscita cio' che e' stato tolto nel frattempo.
INSERT INTO cral_sedi (id, nome, ordine)
SELECT v.id, v.nome, v.ordine FROM (VALUES
  ('CD',  'Sede del Centro Direzionale', 1),
  ('ACT', 'Sede di Via Acton', 2),
  ('PAR', 'Sede di Via Generale Parisi - Palazzo Pacanowski', 3),
  ('MED', 'Sede di Via Medina', 4),
  ('NOL', 'Sede di Nola', 5),
  ('VDA', 'Sede di Villa Doria d''Angri', 6),
  ('EST', 'Esterni', 7)
) AS v(id, nome, ordine)
WHERE NOT EXISTS (SELECT 1 FROM cral_sedi);

INSERT INTO cral_tipi (id, nome, colore, a_pagamento, modo, ordine)
SELECT v.id, v.nome, v.colore, v.pag, v.modo, v.ordine FROM (VALUES
  ('EVE', 'Evento',           '#0891B2', FALSE, NULL,        1),
  ('STR', 'Strenna',          '#7C3AED', FALSE, NULL,        2),
  ('PAN', 'Panettone',        '#D97706', FALSE, NULL,        3),
  ('COL', 'Colomba',          '#16A34A', FALSE, NULL,        4),
  ('VEN', 'Vendita prodotti', '#DB2777', TRUE,  NULL,        5),
  ('GIT', 'Gita',             '#65A30D', TRUE,  NULL,        6),
  ('CAM', 'Campo estivo',     '#0EA5E9', TRUE,  'TURNI',     7),
  ('CIN', 'Cinema',           '#F43F5E', TRUE,  'MAGAZZINO', 8)
) AS v(id, nome, colore, pag, modo, ordine)
WHERE NOT EXISTS (SELECT 1 FROM cral_tipi);

INSERT INTO cral_tipologie_prodotto (id, nome, ordine)
SELECT v.id, v.nome, v.ordine FROM (VALUES
  ('OLI', 'Olio', 1),
  ('TER', 'Prodotti della terra', 2),
  ('DOL', 'Dolci', 3),
  ('QUO', 'Quota di partecipazione', 4),
  ('PAS', 'Pasto', 5)
) AS v(id, nome, ordine)
WHERE NOT EXISTS (SELECT 1 FROM cral_tipologie_prodotto);

INSERT INTO cral_quote_anno (anno, importo_cent)
SELECT 2026, 6000 WHERE NOT EXISTS (SELECT 1 FROM cral_quote_anno);
