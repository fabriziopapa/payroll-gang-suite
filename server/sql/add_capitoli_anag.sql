-- ============================================================
-- PAYROLL GANG SUITE — Migrazione: Capitoli Anagrafica
-- Eseguire una sola volta sul DB del VPS tramite aapanel →
-- PostgreSQL → Database payroll_gang → SQL Query
-- ============================================================

-- Tabella capitoli anagrafica (standalone, non per-voce)
CREATE TABLE IF NOT EXISTS capitoli_anag (
  id           SERIAL PRIMARY KEY,
  codice       VARCHAR(10)  NOT NULL,
  sorgente     VARCHAR(10)  NOT NULL,          -- 'standard' | 'locali'
  descrizione  VARCHAR(200),
  breve        VARCHAR(30),
  tipo_liq     VARCHAR(1),
  f_capitolo   VARCHAR(1),
  data_ins     VARCHAR(19),
  data_mod     VARCHAR(19),
  operatore    VARCHAR(255),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT   uq_capitoli_anag_codice_sorgente UNIQUE (codice, sorgente)
);

CREATE INDEX IF NOT EXISTS idx_capitoli_anag_sorgente ON capitoli_anag (sorgente);

-- Commento informativo
COMMENT ON TABLE capitoli_anag IS
  'Capitoli anagrafica HR: standard (Capitoli_STAMPA.xml) e locali (Capitoli_Locali_STAMPA.xml)';
