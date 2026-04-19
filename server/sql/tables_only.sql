-- ============================================================
-- PAYROLL GANG SUITE — Tabelle + privilegi + settings
-- Usare quando DB e utente sono già stati creati (es. via aaPanel GUI).
-- Eseguire connessi al database payroll_gang:
--   psql -U postgres -d payroll_gang -f tables_only.sql
-- ============================================================

-- Estensione UUID (gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABELLE
-- ============================================================

-- Utenti — auth passwordless TOTP + JWT ES256
CREATE TABLE IF NOT EXISTS users (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  username              VARCHAR(100) NOT NULL UNIQUE,
  totp_secret           TEXT         NOT NULL,
  last_otp_token        VARCHAR(8),
  is_admin              BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active             BOOLEAN      NOT NULL DEFAULT FALSE,
  totp_verified         BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Activation token con scadenza 24h (SHA-256 hex, mai in chiaro)
  activation_token_hash VARCHAR(64),
  activation_expires_at TIMESTAMPTZ,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_login_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_activation_token
  ON users (activation_token_hash)
  WHERE activation_token_hash IS NOT NULL;

-- Refresh token rotanti (hash Argon2id, fingerprint UA+IP)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          SERIAL      PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL,
  fingerprint VARCHAR(64) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);

-- Anagrafiche HR v2
-- Chiave composita (matricola, decor_inq): un dipendente può avere
-- più periodi ruolo. fin_rap NULL = rapporto ancora attivo.
CREATE TABLE IF NOT EXISTS anagrafiche (
  id                  SERIAL       PRIMARY KEY,
  matricola           VARCHAR(10)  NOT NULL,
  cogn_nome           VARCHAR(100) NOT NULL,
  ruolo               VARCHAR(10)  NOT NULL,
  druolo              VARCHAR(100),
  decor_inq           DATE         NOT NULL,
  fin_rap             DATE,
  data_aggiornamento  DATE         NOT NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT anagrafiche_matricola_decor_inq_key UNIQUE (matricola, decor_inq)
);
CREATE INDEX IF NOT EXISTS idx_anagrafiche_ruolo ON anagrafiche(ruolo);
CREATE INDEX IF NOT EXISTS idx_anag_matricola    ON anagrafiche(matricola);
CREATE INDEX IF NOT EXISTS idx_anag_storico      ON anagrafiche(matricola, decor_inq, fin_rap);

-- Voci di bilancio (da XML HR)
CREATE TABLE IF NOT EXISTS voci (
  id          SERIAL       PRIMARY KEY,
  codice      VARCHAR(10)  NOT NULL,
  descrizione VARCHAR(200) NOT NULL,
  data_in     VARCHAR(8)   NOT NULL,
  data_fin    VARCHAR(8)   NOT NULL DEFAULT '22220202',
  tipo        VARCHAR(5),
  personale   VARCHAR(2),
  immissione  VARCHAR(20),
  conguaglio  VARCHAR(30),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT idx_voci_codice_data_in UNIQUE (codice, data_in)
);

-- Capitoli (legati a voci, da XML HR)
CREATE TABLE IF NOT EXISTS capitoli (
  id          SERIAL       PRIMARY KEY,
  voce_id     INTEGER      NOT NULL REFERENCES voci(id) ON DELETE CASCADE,
  codice      VARCHAR(10)  NOT NULL,
  descrizione VARCHAR(200),
  CONSTRAINT idx_capitoli_voce_codice UNIQUE (voce_id, codice)
);
CREATE INDEX IF NOT EXISTS idx_capitoli_voce_id ON capitoli(voce_id);

-- Capitoli anagrafica (standalone)
-- Sorgente: 'standard' = Capitoli_STAMPA.xml
--           'locali'   = Capitoli_Locali_STAMPA.xml
CREATE TABLE IF NOT EXISTS capitoli_anag (
  id          SERIAL       PRIMARY KEY,
  codice      VARCHAR(10)  NOT NULL,
  sorgente    VARCHAR(10)  NOT NULL,
  descrizione VARCHAR(200),
  breve       VARCHAR(30),
  tipo_liq    VARCHAR(1),
  f_capitolo  VARCHAR(1),
  data_ins    VARCHAR(19),
  data_mod    VARCHAR(19),
  operatore   VARCHAR(255),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_capitoli_anag_codice_sorgente UNIQUE (codice, sorgente)
);
CREATE INDEX IF NOT EXISTS idx_capitoli_anag_sorgente ON capitoli_anag(sorgente);

-- Impostazioni applicazione (chiave/valore JSONB)
CREATE TABLE IF NOT EXISTS app_settings (
  chiave     VARCHAR(100) PRIMARY KEY,
  valore     JSONB        NOT NULL,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Bozze e archivio liquidazioni
CREATE TABLE IF NOT EXISTS bozze (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  nome               VARCHAR(200) NOT NULL,
  stato              VARCHAR(20)  NOT NULL DEFAULT 'bozza',
  protocollo_display VARCHAR(100),
  dati               JSONB        NOT NULL,
  created_by         UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bozze_stato      ON bozze(stato);
CREATE INDEX IF NOT EXISTS idx_bozze_created_by ON bozze(created_by);

-- Audit log — immutabile (solo INSERT, mai UPDATE/DELETE)
CREATE TABLE IF NOT EXISTS audit_log (
  id         SERIAL       PRIMARY KEY,
  user_id    UUID         REFERENCES users(id) ON DELETE SET NULL,
  azione     VARCHAR(100) NOT NULL,
  entita     VARCHAR(50),
  entita_id  VARCHAR(100),
  dettagli   JSONB,
  ip         VARCHAR(45),
  user_agent TEXT,
  timestamp  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_user_id   ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);

-- ============================================================
-- PRIVILEGI MINIMI (least privilege)
-- ============================================================

GRANT USAGE ON SCHEMA public TO payroll_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO payroll_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO payroll_user;

-- Audit log: solo INSERT (l'applicazione non può modificare o cancellare)
REVOKE UPDATE, DELETE ON audit_log FROM payroll_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO payroll_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO payroll_user;

-- ============================================================
-- IMPOSTAZIONI DEFAULT
-- ============================================================

INSERT INTO app_settings (chiave, valore) VALUES
  ('coefficienti_scorporo', '{"PA":32.70,"PO":32.70,"RD":34.31,"RU":32.70,"ND":32.70}'),
  ('csv_defaults',          '{"tipoProvvedimento":"000","aliquota":0,"parti":0,"flagAdempimenti":0,"idContrattoCSA":""}'),
  ('tags',                  '[{"prefisso":"TL","builtin":true}]'),
  ('last_import_anagrafiche', 'null'),
  ('last_import_voci',        'null')
ON CONFLICT (chiave) DO NOTHING;
