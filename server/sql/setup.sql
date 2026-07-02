-- ============================================================
-- PAYROLL GANG SUITE — Setup Database PostgreSQL (CONSOLIDATO)
--
-- UNICO file per installazione su VPS vuota: crea ruolo, database,
-- tutte le 17 tabelle, indici, privilegi e dati seed.
-- Sostituisce e consolida: vecchio setup.sql, tables_only.sql,
-- migrate_anagrafiche_v2.sql, add_capitoli_anag.sql,
-- encrypt_certificati.sql e le migrazioni 0001–0009
-- (server/src/db/migrations/ — conservate solo come storico).
--
-- Fonte di verità dello schema: server/src/db/schema.ts
-- Allineato a: v26.07.01
--
-- ESECUZIONE (come superuser postgres, passando la password
-- dell'utente applicativo come variabile psql):
--
--   psql -U postgres \
--        -v app_password='PASSWORD_SICURA_QUI' \
--        -f setup.sql
--
-- Idempotente: ri-eseguibile senza danni (IF NOT EXISTS ovunque).
-- ============================================================

-- ------------------------------------------------------------
-- Utente applicazione (least privilege) — creato solo se assente
-- ------------------------------------------------------------
SELECT format('CREATE ROLE payroll_user WITH LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'payroll_user')
\gexec

-- ------------------------------------------------------------
-- Database — creato solo se assente
-- ------------------------------------------------------------
SELECT 'CREATE DATABASE payroll_gang OWNER payroll_user ENCODING ''UTF8'' TEMPLATE template0'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'payroll_gang')
\gexec

\c payroll_gang

-- Estensione UUID (gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABELLE (ordine rispetta le FK)
-- ============================================================

-- ------------------------------------------------------------
-- UTENTI — auth passwordless TOTP + JWT ES256
-- Include: activation token 24h (migr. 0001), lockout TOTP (migr. 0004)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  username              VARCHAR(100) NOT NULL UNIQUE,
  -- TOTP secret cifrato AES-256-GCM (cryptoService)
  totp_secret           TEXT         NOT NULL,
  -- Ultimo token TOTP usato — previene replay attack
  last_otp_token        VARCHAR(8),
  is_admin              BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active             BOOLEAN      NOT NULL DEFAULT FALSE,
  totp_verified         BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Activation token con scadenza 24h (SHA-256 hex, mai in chiaro)
  activation_token_hash VARCHAR(64),
  activation_expires_at TIMESTAMPTZ,
  -- SEC-M01: lockout dopo 5 OTP errati consecutivi (15 min)
  failed_otp_count      INTEGER      NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_login_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_activation_token
  ON users (activation_token_hash)
  WHERE activation_token_hash IS NOT NULL;

-- ------------------------------------------------------------
-- JWT BLOCKLIST (SEC-C02 — revoca access token al logout)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jwt_blocklist (
  jti        VARCHAR(36)  PRIMARY KEY,
  expires_at TIMESTAMPTZ  NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jwt_blocklist_expires_at ON jwt_blocklist (expires_at);

-- ------------------------------------------------------------
-- REFRESH TOKENS (rotanti, hash Argon2id, selector O(1))
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id             SERIAL      PRIMARY KEY,
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Hash Argon2 del token — il token grezzo non viene mai salvato
  token_hash     TEXT        NOT NULL,
  -- Primi 8 byte del raw token in hex (16 char) — lookup O(1), non segreto
  token_selector VARCHAR(16) NOT NULL,
  -- Fingerprint SHA256(userAgent) — rileva token theft
  fingerprint    VARCHAR(64) NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX        IF NOT EXISTS idx_refresh_tokens_user_id      ON refresh_tokens (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_selector     ON refresh_tokens (token_selector);
CREATE INDEX        IF NOT EXISTS idx_refresh_tokens_user_expires ON refresh_tokens (user_id, expires_at);

-- ------------------------------------------------------------
-- ANAGRAFICHE v2 + campi SGE (xlsx ru_tab_def)
-- Una riga per periodo ruolo: chiave (matricola, decor_inq)
-- fin_rap NULL = rapporto ancora attivo
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anagrafiche (
  id                 SERIAL       PRIMARY KEY,
  matricola          VARCHAR(10)  NOT NULL,
  cogn_nome          VARCHAR(100) NOT NULL,
  ruolo              VARCHAR(10)  NOT NULL,
  druolo             VARCHAR(100),
  -- Inizio periodo ruolo/inquadramento (DECOR_INQ v2 o DT_INIZIO SGE)
  decor_inq          DATE         NOT NULL,
  -- Fine rapporto — NULL = ancora attivo
  fin_rap            DATE,
  -- Data del file da cui è stata importata la riga
  data_aggiornamento DATE         NOT NULL,
  -- Campi SGE (nullable per retrocompatibilità con import XML)
  id_ab              INTEGER,
  cognome            VARCHAR(100),
  nome               VARCHAR(100),
  dt_nascita         DATE,
  genere             VARCHAR(1),
  cod_fis            VARCHAR(16),
  -- SHA-256 sui campi funzionali — confronto O(1) import differenziale
  hash_record        VARCHAR(64),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT anagrafiche_matricola_decor_inq_key UNIQUE (matricola, decor_inq)
);
CREATE INDEX IF NOT EXISTS idx_anag_matricola    ON anagrafiche (matricola);
CREATE INDEX IF NOT EXISTS idx_anag_storico      ON anagrafiche (matricola, decor_inq, fin_rap);
CREATE INDEX IF NOT EXISTS idx_anagrafiche_ruolo ON anagrafiche (ruolo);
CREATE INDEX IF NOT EXISTS idx_anag_hash         ON anagrafiche (hash_record);

-- ------------------------------------------------------------
-- IMPORT LOG ANAGRAFICHE SGE
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anag_import_log (
  id                      SERIAL       PRIMARY KEY,
  nome_file               VARCHAR(255),
  data_importazione       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  utente_importazione     UUID         REFERENCES users(id) ON DELETE SET NULL,
  num_record_file         INTEGER      NOT NULL DEFAULT 0,
  num_record_inseriti     INTEGER      NOT NULL DEFAULT 0,
  num_record_aggiornati   INTEGER      NOT NULL DEFAULT 0,
  num_record_invariati    INTEGER      NOT NULL DEFAULT 0,
  num_record_non_presenti INTEGER      NOT NULL DEFAULT 0,
  num_errori              INTEGER      NOT NULL DEFAULT 0,
  esito                   VARCHAR(10)  NOT NULL DEFAULT 'OK',
  messaggio_errore        TEXT,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_import_log_data ON anag_import_log (data_importazione DESC);

-- ------------------------------------------------------------
-- VOCI DI BILANCIO (da XML HR)
-- ------------------------------------------------------------
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
  CONSTRAINT voci_codice_data_in_key UNIQUE (codice, data_in)
);
CREATE INDEX IF NOT EXISTS idx_voci_active_range ON voci (data_in, data_fin);
-- Partial: lookup rapido voci a validità illimitata
CREATE INDEX IF NOT EXISTS idx_voci_illimitata   ON voci (codice, data_in) WHERE data_fin = '22220202';

-- ------------------------------------------------------------
-- CAPITOLI (annidati per voce)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS capitoli (
  id          SERIAL       PRIMARY KEY,
  voce_id     INTEGER      NOT NULL REFERENCES voci(id) ON DELETE CASCADE,
  codice      VARCHAR(10)  NOT NULL,
  descrizione VARCHAR(200),
  CONSTRAINT capitoli_voce_id_codice_key UNIQUE (voce_id, codice)
);
CREATE INDEX IF NOT EXISTS idx_capitoli_voce_id ON capitoli (voce_id);

-- ------------------------------------------------------------
-- CAPITOLI ANAGRAFICA (standalone)
-- sorgente: 'standard' = Capitoli_STAMPA.xml | 'locali' = Capitoli_Locali_STAMPA.xml
-- ------------------------------------------------------------
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
CREATE INDEX IF NOT EXISTS idx_capitoli_anag_sorgente ON capitoli_anag (sorgente);

-- ------------------------------------------------------------
-- VOCI CONFIG (parametri manuali per voce — riferimento cedolino WD/WE)
-- Separata da `voci`: l'import XML farebbe perdere la config.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voci_config (
  codice        VARCHAR(10)  PRIMARY KEY,
  -- override di csvDefaults.parti; NULL = default globale
  parti         INTEGER,
  -- 'none' | 'standard' | 'contoterzi'; NULL = nessun pre-set
  tipo_scorporo VARCHAR(12),
  -- prefisso tag: 'TL' | 'WD' | 'WE'; NULL = nessuno
  tag_default   VARCHAR(8),
  -- se true e tag WE: figlio (FG) più giovane, sempre 1 riga CSV
  auto_figlio   BOOLEAN      NOT NULL DEFAULT FALSE,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- FAMILIARI CACHE (figli da CINECA CSA-WS — tag cedolino WE)
-- cod_fisc CIFRATO a riposo (AES-256-GCM "iv:tag:cipher" base64)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS familiari_cache (
  id                 SERIAL       PRIMARY KEY,
  id_ab              INTEGER,
  matricola          VARCHAR(10),
  cod_fisc           VARCHAR(255) NOT NULL,
  cognome            VARCHAR(100),
  nome               VARCHAR(100),
  sesso              VARCHAR(1),
  rapporto_parentela VARCHAR(4)   NOT NULL,
  data_nasc          DATE,
  aggiornato_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_familiari_cache_persona_cf ON familiari_cache (matricola, cod_fisc);
CREATE INDEX        IF NOT EXISTS idx_familiari_cache_matricola  ON familiari_cache (matricola);
CREATE INDEX        IF NOT EXISTS idx_familiari_cache_id_ab      ON familiari_cache (id_ab);

-- ------------------------------------------------------------
-- IMPOSTAZIONI APP (chiave/valore JSONB)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  chiave     VARCHAR(100) PRIMARY KEY,
  valore     JSONB        NOT NULL,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- BOZZE / ARCHIVIO liquidazioni
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bozze (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  nome               VARCHAR(200) NOT NULL,
  stato              VARCHAR(20)  NOT NULL DEFAULT 'bozza',
  protocollo_display VARCHAR(100),
  -- Serializzazione completa editor: nominativi + dettagli + comunicazioni
  dati               JSONB        NOT NULL,
  created_by         UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bozze_stato      ON bozze (stato);
CREATE INDEX IF NOT EXISTS idx_bozze_created_by ON bozze (created_by);

-- ------------------------------------------------------------
-- AUDIT LOG — immutabile (solo INSERT, mai UPDATE/DELETE)
-- ------------------------------------------------------------
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
CREATE INDEX IF NOT EXISTS idx_audit_user_id   ON audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log (timestamp);

-- ------------------------------------------------------------
-- TEMPLATI CERTIFICATO (stampa unione — template-come-dato)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS templati_certificato (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  nome           VARCHAR(200) NOT NULL,
  struttura_json JSONB        NOT NULL,
  attivo         BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- PROGRESSIVO CERTIFICATI per anno solare (assegnazione atomica)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS certificato_progressivi (
  anno   INTEGER PRIMARY KEY,
  ultimo INTEGER NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------
-- CERTIFICATI giuridico-stipendiali generati
-- PGS-04 cifratura a riposo: cf (varchar 255) e dati_json cifrati
-- AES-256-GCM nel repository; colonne di lista restano in chiaro.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS certificati (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  anno            INTEGER      NOT NULL,
  progressivo     INTEGER      NOT NULL,
  -- Derivato AAAA/NNN (zero-pad 3) — calcolato in app
  protocollo      VARCHAR(20)  NOT NULL,
  matricola       VARCHAR(10),
  -- CF CIFRATO (AES-256-GCM "iv:tag:cipher" base64)
  cf              VARCHAR(255),
  periodo         VARCHAR(50),
  nominativo      VARCHAR(200),
  sigla_operatore VARCHAR(20)  NOT NULL,
  dirigente       VARCHAR(200),
  template_id     UUID         REFERENCES templati_certificato(id) ON DELETE SET NULL,
  -- Output parser CIFRATO — envelope { v:1, enc:"iv:tag:cipher" }
  dati_json       JSONB        NOT NULL,
  created_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_certificati_anno_progressivo ON certificati (anno, progressivo);
CREATE INDEX        IF NOT EXISTS idx_certificati_anno             ON certificati (anno);
CREATE INDEX        IF NOT EXISTS idx_certificati_matricola        ON certificati (matricola);
CREATE INDEX        IF NOT EXISTS idx_certificati_created_by       ON certificati (created_by);

-- ------------------------------------------------------------
-- TEMPLATI PDF REGION (riconoscimento layout cedolino)
-- Versionati e immutabili: ogni riga = una versione.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS templati_pdf_region (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Lineage stabile fra versioni, indipendente da nome/id
  template_family_id      UUID         NOT NULL DEFAULT gen_random_uuid(),
  nome                    VARCHAR(200) NOT NULL,
  nota                    TEXT,
  versione                INTEGER      NOT NULL DEFAULT 1,
  -- Formato AA.MM.GG (mirror APP_VERSION) — cosmetico/audit
  versione_label          VARCHAR(8)   NOT NULL,
  attivo                  BOOLEAN      NOT NULL DEFAULT TRUE,
  -- PageGeometry[]: pageIndex/widthPt/heightPt/rotation
  page_geometry_json      JSONB        NOT NULL,
  -- ParteTemplate[]: solo coordinate % — MAI bytes/binary PDF
  parti_json              JSONB        NOT NULL,
  -- FK fissata a CREAZIONE — mai modificabile dopo
  certificato_template_id UUID         NOT NULL REFERENCES templati_certificato(id),
  created_by              UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_templati_pdf_region_family_versione
  ON templati_pdf_region (template_family_id, versione);
-- Vincolo strutturale: max 1 versione attiva per famiglia (Audit Gate4 H2)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pdf_region_one_active_per_family
  ON templati_pdf_region (template_family_id)
  WHERE attivo = TRUE;
CREATE INDEX IF NOT EXISTS idx_templati_pdf_region_attivo     ON templati_pdf_region (attivo);
CREATE INDEX IF NOT EXISTS idx_templati_pdf_region_family     ON templati_pdf_region (template_family_id);
CREATE INDEX IF NOT EXISTS idx_templati_pdf_region_created_by ON templati_pdf_region (created_by);

-- ============================================================
-- PRIVILEGI MINIMI (least privilege)
-- ============================================================

GRANT CONNECT ON DATABASE payroll_gang TO payroll_user;
GRANT USAGE ON SCHEMA public TO payroll_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO payroll_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO payroll_user;

-- Audit log: solo INSERT (l'applicazione non può modificare, cancellare o svuotare)
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM payroll_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO payroll_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO payroll_user;

-- ============================================================
-- SEED — app_settings: NESSUNO.
-- Le chiavi vive sono camelCase (coefficienti, csvDefaults, tags, …
-- vedi whitelist ALLOWED_SETTINGS_KEYS in routes/settings.ts) e vengono
-- create dall'app: il client ha i default in constants/ e le salva al
-- primo "Salva impostazioni"; last_import_* le scrive il server all'import.
-- (Il vecchio seed usava chiavi snake_case morte: coefficienti_scorporo,
-- csv_defaults — mai lette dall'app. Rimosse.)
-- ============================================================

-- ============================================================
-- SEED — template certificato di default (UUID fissi, idempotenti)
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
  TRUE
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO templati_certificato (id, nome, struttura_json, attivo)
VALUES (
  '00000000-0000-0000-0000-0000000c0002',
  'Certificato semplificato (aggregati)',
  '{
    "tabellaEmolumenti": [
      { "voce": "Retribuzioni lorde",     "segno": "(+)", "src": "cert.lordo_teorico" },
      { "voce": "Ritenute fiscali",       "segno": "(-)", "src": "cert.ritenute_fiscali" },
      { "voce": "Ritenute previdenziali", "segno": "(-)", "src": "cert.ritenute_previdenziali" },
      { "voce": "Importo al netto delle ritenute di legge", "segno": "(=)", "src": "cert.netto_ritenute_legge", "bold": true }
    ]
  }'::jsonb,
  TRUE
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- VERIFICA FINALE — deve elencare 17 tabelle
-- ============================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
