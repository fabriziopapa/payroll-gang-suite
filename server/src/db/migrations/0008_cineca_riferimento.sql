-- ============================================================
-- Migration 0008 — Riferimento cedolino WD/WE + config voci
-- 2 tabelle nuove:
--   voci_config     — parametri manuali per voce (parti, scorporo, tag)
--                     SEPARATA da `voci`: l'import XML fa upsert su
--                     (codice, data_in) e cancellerebbe la config.
--   familiari_cache — cache figli da CINECA CSA-WS (WE), per non
--                     ribattere l'API ad ogni cedolino.
-- Idempotente: IF NOT EXISTS / ON CONFLICT DO NOTHING.
-- Applicare a mano:  psql -U payroll_user -d payroll_gang -f 0008_cineca_riferimento.sql
-- ============================================================

-- ── Config manuale per voce ───────────────────────────────────
-- Chiave logica `codice` (NON (codice,data_in)): la config è una
-- proprietà della voce, indipendente dai periodi di validità.
CREATE TABLE IF NOT EXISTS voci_config (
  codice         VARCHAR(10)  PRIMARY KEY,
  -- override di csvDefaults.parti; NULL = usa il default globale
  parti          INTEGER,
  -- 'none' | 'standard' | 'contoterzi'; NULL = nessun pre-set
  tipo_scorporo  VARCHAR(12),
  -- prefisso tag riferimento cedolino: 'TL' | 'WD' | 'WE'; NULL = nessuno
  tag_default    VARCHAR(8),
  -- flag voce: scelta automatica del figlio (più giovane) per il tag WE
  auto_figlio    BOOLEAN      NOT NULL DEFAULT false,
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE  voci_config IS
  'Parametri manuali per voce (non importabili da XML). Sopravvive ai reimport perché separata da `voci`.';
COMMENT ON COLUMN voci_config.tag_default IS
  'TL=testo libero (gruppo), WD=CF dipendente (per-nominativo), WE=CF figlio (per-nominativo).';
COMMENT ON COLUMN voci_config.auto_figlio IS
  'Se true e tag WE: prende il figlio (rapportoParentela FG) più giovane. Sempre 1 sola riga CSV.';

-- ── Cache familiari (figli) da CINECA CSA-WS ──────────────────
-- Popolata da getFamiliari(idAb|matricola). rapporto_parentela 'FG' = figlio/a.
-- "più giovane" = max(data_nasc) tra i FG.
CREATE TABLE IF NOT EXISTS familiari_cache (
  id                  SERIAL       PRIMARY KEY,
  -- almeno uno tra id_ab e matricola valorizzato
  id_ab               INTEGER,
  matricola           VARCHAR(10),
  cod_fisc            VARCHAR(16)  NOT NULL,
  cognome             VARCHAR(100),
  nome                VARCHAR(100),
  sesso               VARCHAR(1),
  rapporto_parentela  VARCHAR(4)   NOT NULL,
  data_nasc           DATE,
  aggiornato_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_familiari_cache_persona_cf
  ON familiari_cache (matricola, cod_fisc);
CREATE INDEX IF NOT EXISTS idx_familiari_cache_matricola ON familiari_cache (matricola);
CREATE INDEX IF NOT EXISTS idx_familiari_cache_id_ab     ON familiari_cache (id_ab);

COMMENT ON TABLE  familiari_cache IS
  'Cache nucleo familiare da CINECA CSA-WS. I figli (rapporto_parentela=FG) servono al tag cedolino WE.';
