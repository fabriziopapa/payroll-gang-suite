-- ============================================================
-- Migration 0012 — Lavorazioni dell'area Emolumenti
--
-- Salva e recupera il lavoro sui dottorandi/borsisti, come si fa con i gruppi
-- di liquidazione, ma su una TABELLA SEPARATA: l'area Liquidazioni e la tabella
-- `bozze` non vanno toccate (vincolo di isolamento, piano §8.1).
--
--   nome              — "Liquidazioni Emolumenti DR 1", scelto dall'ufficio
--   stato             — 'bozza' (in lavorazione) | 'archiviata' (chiusa)
--   tipo              — DR | BS | BE, facoltativo: serve solo a ritrovarle
--   data_liquidazione — richiesta all'archiviazione, come per le bozze
--   dati              — JSONB: input dell'operatore + snapshot di cio' che
--                       CSA mostrava al salvataggio, cosi' riaprendo si vede
--                       esattamente quello che si vedeva, senza rileggere CSA.
--                       Contiene nominativi, matricole e importi: e' il motivo
--                       per cui le rotte sono admin + audit. Nessun IBAN.
--
-- Applicare a mano, COME PROPRIETARIO della tabella (vedi
-- server/sql/owner_payroll_user.sql):
--   psql -h <DB_HOST> -p <DB_PORT> -U payroll_user -d payroll_gang \
--        -f server/src/db/migrations/0012_emolumenti_lavorazioni.sql
--
-- Idempotente: IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS emolumenti_lavorazioni (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome               VARCHAR(200) NOT NULL,
  stato              VARCHAR(20)  NOT NULL DEFAULT 'bozza',
  tipo               VARCHAR(10),
  data_liquidazione  DATE,
  dati               JSONB        NOT NULL,
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emol_lav_stato      ON emolumenti_lavorazioni (stato);
CREATE INDEX IF NOT EXISTS idx_emol_lav_created_by ON emolumenti_lavorazioni (created_by);
CREATE INDEX IF NOT EXISTS idx_emol_lav_updated    ON emolumenti_lavorazioni (updated_at DESC);

COMMENT ON TABLE  emolumenti_lavorazioni IS
  'Lavorazioni dell''area Emolumenti (dottorandi/borsisti). Separata da bozze: le Liquidazioni non si toccano.';
COMMENT ON COLUMN emolumenti_lavorazioni.stato IS
  'bozza = in lavorazione · archiviata = chiusa, con data_liquidazione valorizzata.';
COMMENT ON COLUMN emolumenti_lavorazioni.dati IS
  'Input dell''operatore + snapshot CSA al salvataggio. Contiene PII: rotte admin + audit.';
