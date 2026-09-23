-- ============================================================
-- Migration 0019 — paesi_conto: l'elenco dei paesi SEPA / EXTRA_UE in PGS
--
-- COSA. Una tabella con una riga per paese e per periodo: codice ISO del
-- paese dell'IBAN, area (SEPA o EXTRA_UE), da quando e fino a quando vale,
-- da quale fonte viene, chi l'ha inserita.
--
-- PERCHE'. Fino a oggi l'elenco SEPA stava scritto nel codice
-- (lib/areaConto.ts): per cambiarlo serviva un rilascio. Non esiste una
-- fonte automatica affidabile (misurato il 2026-09-24: la pagina EPC e'
-- dietro Cloudflare; l'elenco "SEPA" delle Pubblicazioni UE non ha AL MD
-- ME MK RS). Quindi l'elenco lo tiene PGS, e un amministratore lo aggiorna
-- da Impostazioni. Il controllo automatico notturno verra' solo se si
-- trovera' una fonte affidabile.
--
-- REGOLE
--   · un paese ha UNA sola riga in vigore (indice unico parziale): non puo'
--     essere insieme SEPA ed EXTRA_UE;
--   · un cambio non sovrascrive: chiude la riga in vigore (valido_al) e ne
--     apre una nuova. La storia resta, e l'endpoint /area-conto puo'
--     rispondere "a una data";
--   · IT e' SEPA qui; che risulti "IT" e non "SEPA" lo decide la regola
--     (lib/areaConto.ts), non la tabella;
--   · un paese assente dalla tabella vale EXTRA_UE, come fino a oggi.
--
-- PRIVACY: nessun dato personale. Solo codici paese.
--
-- NON si applica a mano:   ./pgs-migra.sh applica
-- Gira come superutente. Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS paesi_conto (
  id          BIGSERIAL    PRIMARY KEY,
  codice      CHAR(2)      NOT NULL CHECK (codice ~ '^[A-Z]{2}$'),
  area        VARCHAR(10)  NOT NULL CHECK (area IN ('SEPA', 'EXTRA_UE')),
  valido_dal  DATE         NOT NULL,
  valido_al   DATE,
  fonte       VARCHAR(80)  NOT NULL,
  nota        VARCHAR(300),
  created_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (valido_al IS NULL OR valido_al >= valido_dal)
);

-- UNA sola riga in vigore per paese: un paese non puo' essere insieme SEPA
-- ed EXTRA_UE. Lo garantisce il database, non il codice.
CREATE UNIQUE INDEX IF NOT EXISTS paesi_conto_in_vigore
  ON paesi_conto (codice) WHERE valido_al IS NULL;
CREATE INDEX IF NOT EXISTS paesi_conto_codice ON paesi_conto (codice, valido_dal);

COMMENT ON TABLE paesi_conto IS
  'Area del conto per paese dell''IBAN (SEPA / EXTRA_UE), con la sua storia. Una riga in vigore per paese (valido_al NULL). IT e'' SEPA: l''area IT la da'' la regola, non la tabella.';

-- Elenco iniziale: EPC409-09 "EPC List of SEPA Scheme Countries" v8.0 del
-- 24/12/2025, 42 prefissi IBAN. E' lo stesso elenco di lib/areaConto.ts.
-- Si semina solo se il paese non ha gia' una riga in vigore: rilanciarla
-- non duplica e non sovrascrive un cambio fatto nel frattempo.
INSERT INTO paesi_conto (codice, area, valido_dal, fonte) VALUES
  ('AD', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('AL', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('AT', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('BE', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('BG', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('CH', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('CY', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('CZ', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('DE', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('DK', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('EE', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('ES', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('FI', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('FR', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('GB', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('GI', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('GR', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('HR', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('HU', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('IE', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('IS', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('IT', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('LI', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('LT', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('LU', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('LV', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('MC', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('MD', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('ME', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('MK', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('MT', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('NL', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('NO', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('PL', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('PT', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('RO', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('RS', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('SE', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('SI', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('SK', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('SM', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0'),
  ('VA', 'SEPA', DATE '2025-12-24', 'EPC409-09 v8.0')
ON CONFLICT (codice) WHERE valido_al IS NULL DO NOTHING;
