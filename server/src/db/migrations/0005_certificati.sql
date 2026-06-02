-- ============================================================
-- Migration 0005 — Sezione Certificati giuridico-stipendiali
-- 3 tabelle: templati_certificato, certificato_progressivi, certificati
-- + seed del template di default (giuridico-stipendiale)
-- Idempotente: IF NOT EXISTS / ON CONFLICT DO NOTHING.
-- ============================================================

-- ── Templati (template-come-dato, CRUD da UI) ────────────────
CREATE TABLE IF NOT EXISTS templati_certificato (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome           varchar(200) NOT NULL,
  struttura_json jsonb        NOT NULL,
  attivo         boolean      NOT NULL DEFAULT true,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now()
);

-- ── Progressivo per anno solare (assegnazione atomica) ───────
CREATE TABLE IF NOT EXISTS certificato_progressivi (
  anno   integer PRIMARY KEY,
  ultimo integer NOT NULL DEFAULT 0
);

-- ── Certificati generati ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS certificati (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anno            integer      NOT NULL,
  progressivo     integer      NOT NULL,
  protocollo      varchar(20)  NOT NULL,
  matricola       varchar(10),
  cf              varchar(16),
  periodo         varchar(50),
  nominativo      varchar(200),
  sigla_operatore varchar(20)  NOT NULL,
  dirigente       varchar(200),
  template_id     uuid REFERENCES templati_certificato(id) ON DELETE SET NULL,
  dati_json       jsonb        NOT NULL,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_certificati_anno_progressivo
  ON certificati (anno, progressivo);
CREATE INDEX IF NOT EXISTS idx_certificati_anno       ON certificati (anno);
CREATE INDEX IF NOT EXISTS idx_certificati_matricola  ON certificati (matricola);
CREATE INDEX IF NOT EXISTS idx_certificati_created_by ON certificati (created_by);

COMMENT ON COLUMN certificati.protocollo IS
  'Derivato AAAA/NNN (zero-pad 3), calcolato in app. Unico per (anno, progressivo).';
COMMENT ON COLUMN certificati.dati_json IS
  'Output parser cedolino (audit + rigenerazione DOCX). Privacy opzione A: NO iban, NO CF nucleo.';

-- ============================================================
-- SEED — template di default "giuridico-stipendiale"
-- UUID fisso per ON CONFLICT idempotente. Modificabile da UI.
-- matchTeoriche/inquadramentoMap/extraRename = regole CONFIGURABILI
-- (non più hardcoded nel codice) — vedi merge.ts.
-- ============================================================
INSERT INTO templati_certificato (id, nome, struttura_json, attivo)
VALUES (
  '00000000-0000-0000-0000-0000000c0001',
  'Certificato giuridico-stipendiale',
  '{
    "bollo": { "testo": "MARCA DA BOLLO DA EURO 16,00\nASSOLTA TRAMITE BONIFICO" },
    "intestazione": {
      "protocollo": "REG.TO AL N. {{protocollo}}",
      "posizione": "Pos: {{sigla_operatore}}/Stipendi"
    },
    "titolo": "Si certifica",
    "corpo": [
      "che [[il Sig.|la Sig.ra]] {{anagrafica.cognome}} {{anagrafica.nome}}, [[nato|nata]] a {{anagrafica.luogo_nascita}} il {{anagrafica.data_nascita}}, codice fiscale {{anagrafica.codice_fiscale}}, è [[dipendente|dipendente]] di questa Università con contratto di lavoro subordinato a tempo indeterminato, a decorrere dal {{anagrafica.inizio_rapporto}};",
      "che [[il Sig.|la Sig.ra]] {{anagrafica.cognome}} {{anagrafica.nome}} è attualmente [[inquadrato|inquadrata]] come {{anagrafica.inquadramento_label}}, settore {{anagrafica.settore}}, C.C.N.L. comparto Università;",
      "che [[il Sig.|la Sig.ra]] {{anagrafica.cognome}} {{anagrafica.nome}} percepisce (con riferimento al cedolino di {{periodo_label}}) emolumenti come di seguito specificato:"
    ],
    "tabellaEmolumenti": [
      { "voce": "Retribuzione lorda", "segno": "(+)", "src": "teo.stipendio" },
      { "voce": "IIS Conglobata", "segno": "(+)", "src": "teo.iis" },
      { "voce": "I.V.C.", "segno": "(+)", "src": "teo.ivc" },
      { "voce": "Differenziale indiv. Stipendio", "segno": "(+)", "src": "teo.diff_stip" },
      { "voce": "Differenziale indiv. IIS Conglobata", "segno": "(+)", "src": "teo.diff_iis" },
      { "voce": "Ritenute fiscali", "segno": "(-)", "src": "cert.ritenute_fiscali" },
      { "voce": "Ritenute previdenziali ed assistenziali", "segno": "(-)", "src": "cert.ritenute_previdenziali" },
      { "voce": "Importo al netto delle ritenute di legge", "segno": "(=)", "src": "cert.netto_ritenute_legge", "bold": true }
    ],
    "testoExtraerariali": "su tale importo gravano le seguenti ritenute extra-erariali:",
    "testoNetto": "Per un importo netto a pagare di {{netto_pagare_label}}.",
    "chiusura": "Si rilascia per gli usi consentiti.",
    "luogoData": "Napoli, {{data_rilascio}}.",
    "firma": [
      "Il Dirigente della Ripartizione",
      "Economico Patrimoniale",
      "(dott. {{dirigente}})"
    ],
    "matchTeoriche": [
      { "field": "stipendio", "keywords": ["stipendio classe"] },
      { "field": "diff_stip", "keywords": ["differenziale indiv. stipendio"] },
      { "field": "diff_iis",  "keywords": ["differenziale indiv. iis"] },
      { "field": "iis",       "keywords": ["iis conglobata"] },
      { "field": "ivc",       "keywords": ["vacanza", "i.v.c"] }
    ],
    "inquadramentoMap": {
      "Area dei Collaboratori": "Collaboratore",
      "Area degli Operatori": "Operatore",
      "Area dei Funzionari": "Funzionario",
      "Area Elevate Professionalità": "Elevata Professionalità"
    },
    "extraRename": {
      "Trattenuta sindacale": "Trattenuta Sindacale",
      "Quota C.R.A.L.": "CRAL",
      "Cessione V": "Cessione V"
    }
  }'::jsonb,
  true
)
ON CONFLICT (id) DO NOTHING;
