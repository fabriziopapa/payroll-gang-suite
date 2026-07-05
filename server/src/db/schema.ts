// ============================================================
// PAYROLL GANG SUITE — Schema Drizzle ORM (PostgreSQL)
// ============================================================

import { sql } from 'drizzle-orm'
import {
  pgTable,
  varchar,
  boolean,
  integer,
  serial,
  uuid,
  timestamp,
  date,
  jsonb,
  text,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'

// ------------------------------------------------------------
// JWT BLOCKLIST (SEC-C02 — revoca access token al logout)
// ------------------------------------------------------------

export const jwtBlocklist = pgTable('jwt_blocklist', {
  /** JWT ID (jti claim) — UUID v4 generato al momento dell'emissione */
  jti:       varchar('jti', { length: 36 }).primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [
  // Indice per la pulizia periodica dei token scaduti
  index('idx_jwt_blocklist_expires_at').on(t.expiresAt),
])

// ------------------------------------------------------------
// UTENTI (Auth — passwordless TOTP)
// ------------------------------------------------------------

export const users = pgTable('users', {
  id:           uuid('id').primaryKey().defaultRandom(),
  username:     varchar('username', { length: 100 }).notNull().unique(),
  /** TOTP secret cifrato con AES-256-GCM (via cryptoService) */
  totpSecret:   text('totp_secret').notNull(),
  /** Ultimo token TOTP usato — previene replay attack */
  lastOtpToken: varchar('last_otp_token', { length: 8 }),
  isAdmin:      boolean('is_admin').notNull().default(false),
  isActive:     boolean('is_active').notNull().default(false),
  /** true dopo che l'utente ha scansionato il QR e verificato il primo OTP */
  totpVerified: boolean('totp_verified').notNull().default(false),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt:  timestamp('last_login_at', { withTimezone: true }),
  /**
   * FIX #4 — Activation token con scadenza 24h.
   * SHA-256 hex del token grezzo (mai salvato in chiaro).
   * NULL = nessun token pendente (già attivato o non ancora generato).
   */
  activationTokenHash:  varchar('activation_token_hash', { length: 64 }),
  activationExpiresAt:  timestamp('activation_expires_at', { withTimezone: true }),
  /**
   * SEC-M01 — TOTP brute-force lockout.
   * Counter incrementato ad ogni OTP errato; resettato ad ogni login riuscito.
   */
  failedOtpCount: integer('failed_otp_count').notNull().default(0),
  /** NULL = non bloccato. Impostato a now+15m quando failedOtpCount raggiunge 5. */
  lockedUntil:    timestamp('locked_until', { withTimezone: true }),
})

// ------------------------------------------------------------
// REFRESH TOKENS (rotanti, hash Argon2)
// ------------------------------------------------------------

export const refreshTokens = pgTable('refresh_tokens', {
  id:           serial('id').primaryKey(),
  userId:       uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** Hash Argon2 del token — il token grezzo non viene mai salvato */
  tokenHash:    text('token_hash').notNull(),
  /**
   * FIX C-1 / M-4: primi 8 byte del raw token in hex (16 chars).
   * Non segreto ma univoco — permette lookup O(1) senza scan su tokenHash.
   * Indice UNIQUE garantisce lookup istantaneo senza iterare tutti i token.
   */
  tokenSelector: varchar('token_selector', { length: 16 }).notNull(),
  /** Fingerprint: User-Agent + IP hash — rileva token theft */
  fingerprint:  varchar('fingerprint', { length: 64 }).notNull(),
  expiresAt:    timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt:    timestamp('revoked_at', { withTimezone: true }),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_refresh_tokens_user_id').on(t.userId),
  // FIX C-1 / M-4: lookup O(1) per selector — evita la scansione O(n) con Argon2
  uniqueIndex('idx_refresh_tokens_selector').on(t.tokenSelector),
  // FIX M-4: compound index per query userId + expiresAt (pulizia token scaduti)
  index('idx_refresh_tokens_user_expires').on(t.userId, t.expiresAt),
])

// ------------------------------------------------------------
// ANAGRAFICHE (da XML DATAPACKET HR 2.0 — versione v2)
// Una riga per periodo ruolo: chiave (matricola, decor_inq)
// fin_rap NULL = rapporto ancora attivo
// ------------------------------------------------------------

export const anagrafiche = pgTable('anagrafiche', {
  id:                serial('id').primaryKey(),
  matricola:         varchar('matricola', { length: 10 }).notNull(),
  cognNome:          varchar('cogn_nome', { length: 100 }).notNull(),
  ruolo:             varchar('ruolo', { length: 10 }).notNull(),
  druolo:            varchar('druolo', { length: 100 }),
  /** Data inizio periodo ruolo/inquadramento (da DECOR_INQ del file v2 o DT_INIZIO SGE) */
  decorInq:          date('decor_inq').notNull(),
  /** Fine rapporto di lavoro — NULL = ancora attivo */
  finRap:            date('fin_rap'),
  /** Data del file da cui è stata importata la riga */
  dataAggiornamento: date('data_aggiornamento').notNull(),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Campi SGE (xlsx ru_tab_def) — nullable per retrocompatibilità con import XML
  idAb:              integer('id_ab'),
  cognome:           varchar('cognome', { length: 100 }),
  nome:              varchar('nome', { length: 100 }),
  dtNascita:         date('dt_nascita'),
  genere:            varchar('genere', { length: 1 }),
  codFis:            varchar('cod_fis', { length: 16 }),
  // SHA-256 sui campi funzionali — confronto O(1) per import differenziale
  hashRecord:        varchar('hash_record', { length: 64 }),
}, (t) => [
  uniqueIndex('anagrafiche_matricola_decor_inq_key').on(t.matricola, t.decorInq),
  index('idx_anag_matricola').on(t.matricola),
  index('idx_anag_storico').on(t.matricola, t.decorInq, t.finRap),
  index('idx_anagrafiche_ruolo').on(t.ruolo),
])

// ------------------------------------------------------------
// VOCI DI BILANCIO (da XML HR)
// ------------------------------------------------------------

export const voci = pgTable('voci', {
  id:          serial('id').primaryKey(),
  codice:      varchar('codice', { length: 10 }).notNull(),
  descrizione: varchar('descrizione', { length: 200 }).notNull(),
  /** YYYYMMDD */
  dataIn:      varchar('data_in', { length: 8 }).notNull(),
  /** YYYYMMDD — "22220202" = illimitato */
  dataFin:     varchar('data_fin', { length: 8 }).notNull(),
  tipo:        varchar('tipo', { length: 5 }),
  personale:   varchar('personale', { length: 2 }),
  immissione:  varchar('immissione', { length: 20 }),
  conguaglio:  varchar('conguaglio', { length: 30 }),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('idx_voci_codice_data_in').on(t.codice, t.dataIn),
])

// ------------------------------------------------------------
// CAPITOLI (legati a voci)
// ------------------------------------------------------------

export const capitoli = pgTable('capitoli', {
  id:          serial('id').primaryKey(),
  voceId:      integer('voce_id').notNull().references(() => voci.id, { onDelete: 'cascade' }),
  codice:      varchar('codice', { length: 10 }).notNull(),
  descrizione: varchar('descrizione', { length: 200 }),
}, (t) => [
  index('idx_capitoli_voce_id').on(t.voceId),
  uniqueIndex('idx_capitoli_voce_codice').on(t.voceId, t.codice),
])

// ------------------------------------------------------------
// CAPITOLI ANAGRAFICA (da XML HR — standalone, non per-voce)
// Sorgente: 'standard' = Capitoli_STAMPA.xml
//           'locali'   = Capitoli_Locali_STAMPA.xml
// ------------------------------------------------------------

export const capitoliAnag = pgTable('capitoli_anag', {
  id:          serial('id').primaryKey(),
  /** Codice capitolo, es. "001279" */
  codice:      varchar('codice', { length: 10 }).notNull(),
  /** Sorgente file: 'standard' | 'locali' */
  sorgente:    varchar('sorgente', { length: 10 }).notNull(),
  descrizione: varchar('descrizione', { length: 200 }),
  breve:       varchar('breve', { length: 30 }),
  tipoLiq:     varchar('tipo_liq', { length: 1 }),
  fCapitolo:   varchar('f_capitolo', { length: 1 }),
  dataIns:     varchar('data_ins', { length: 19 }),
  dataMod:     varchar('data_mod', { length: 19 }),
  operatore:   varchar('operatore', { length: 255 }),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('idx_capitoli_anag_codice_sorgente').on(t.codice, t.sorgente),
  index('idx_capitoli_anag_sorgente').on(t.sorgente),
])

// ------------------------------------------------------------
// IMPOSTAZIONI APP (chiave/valore JSONB)
// ------------------------------------------------------------

export const appSettings = pgTable('app_settings', {
  chiave:    varchar('chiave', { length: 100 }).primaryKey(),
  valore:    jsonb('valore').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ------------------------------------------------------------
// BOZZE / ARCHIVIO
// ------------------------------------------------------------

export const bozze = pgTable('bozze', {
  id:                uuid('id').primaryKey().defaultRandom(),
  nome:              varchar('nome', { length: 200 }).notNull(),
  stato:             varchar('stato', { length: 20 }).notNull().default('bozza'),
  protocolloDisplay: varchar('protocollo_display', { length: 100 }),
  /** Serializzazione completa: liquidazioni + nominativi */
  dati:              jsonb('dati').notNull(),
  createdBy:         uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_bozze_stato').on(t.stato),
  index('idx_bozze_created_by').on(t.createdBy),
])

// ------------------------------------------------------------
// AUDIT LOG (immutabile — solo insert, mai update/delete)
// ------------------------------------------------------------

export const auditLog = pgTable('audit_log', {
  id:        serial('id').primaryKey(),
  userId:    uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  azione:    varchar('azione', { length: 100 }).notNull(),
  entita:    varchar('entita', { length: 50 }),
  entitaId:  varchar('entita_id', { length: 100 }),
  dettagli:  jsonb('dettagli'),
  ip:        varchar('ip', { length: 45 }),
  userAgent: text('user_agent'),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_audit_user_id').on(t.userId),
  index('idx_audit_timestamp').on(t.timestamp),
])

// ------------------------------------------------------------
// IMPORT LOG ANAGRAFICHE SGE
// ------------------------------------------------------------

export const anagImportLog = pgTable('anag_import_log', {
  id:                   serial('id').primaryKey(),
  nomeFile:             varchar('nome_file', { length: 255 }),
  dataImportazione:     timestamp('data_importazione', { withTimezone: true }).notNull().defaultNow(),
  utenteImportazione:   uuid('utente_importazione').references(() => users.id, { onDelete: 'set null' }),
  numRecordFile:        integer('num_record_file').notNull().default(0),
  numRecordInseriti:    integer('num_record_inseriti').notNull().default(0),
  numRecordAggiornati:  integer('num_record_aggiornati').notNull().default(0),
  numRecordInvariati:   integer('num_record_invariati').notNull().default(0),
  numRecordNonPresenti: integer('num_record_non_presenti').notNull().default(0),
  numErrori:            integer('num_errori').notNull().default(0),
  esito:                varchar('esito', { length: 10 }).notNull().default('OK'),
  messaggioErrore:      text('messaggio_errore'),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_import_log_data').on(t.dataImportazione),
])

// ------------------------------------------------------------
// TEMPLATI CERTIFICATO (stampa unione — template-come-dato)
// strutturaJson: blocchi testo statico + segnaposto {{path}} + tag [[m|f]]
// + righe tabella emolumenti + regole matching voci teoriche (configurabili)
// ------------------------------------------------------------

export const templatiCertificato = pgTable('templati_certificato', {
  id:            uuid('id').primaryKey().defaultRandom(),
  nome:          varchar('nome', { length: 200 }).notNull(),
  /** Struttura completa del template (bollo, corpo, tabella, firma, matching) */
  strutturaJson: jsonb('struttura_json').notNull(),
  attivo:        boolean('attivo').notNull().default(true),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ------------------------------------------------------------
// PROGRESSIVO CERTIFICATI per anno solare (assegnazione atomica)
// UPDATE ... SET ultimo = ultimo + 1 RETURNING ultimo  (dentro transazione)
// evita collisioni in concorrenza meglio di MAX(progressivo)+1
// ------------------------------------------------------------

export const certificatoProgressivi = pgTable('certificato_progressivi', {
  anno:   integer('anno').primaryKey(),
  ultimo: integer('ultimo').notNull().default(0),
})

// ------------------------------------------------------------
// CERTIFICATI giuridico-stipendiali generati
// protocollo: calcolato in app (AAAA/NNN) — Drizzle non supporta GENERATED
// datiJson: output parser cedolino (audit + rigenerazione DOCX senza ri-parsing)
// NB: per scelta privacy (opzione A) datiJson NON contiene iban né CF nucleo
//
// CIFRATURA A RIPOSO (PGS-04): `cf` e `datiJson` contengono PII retributiva
// (codice fiscale + lordo/netto/ritenute). Sono cifrati AES-256-GCM nel
// repository (PgCertificatiRepository) prima dell'insert e decifrati in lettura:
//  - cf: stringa "iv:tag:cipher" base64 (come familiari_cache) → serve col. larga
//  - datiJson: envelope jsonb { v:1, enc:"iv:tag:cipher" } (payload cifrato opaco)
// Le colonne di lista/ricerca (matricola, nominativo, protocollo, periodo)
// restano in chiaro: la lista NON legge cf/datiJson → nessun impatto prestazioni.
// Righe legacy (pre-cifratura) sono lette in modo trasparente (fallback al grezzo).
// ------------------------------------------------------------

export const certificati = pgTable('certificati', {
  id:             uuid('id').primaryKey().defaultRandom(),
  anno:           integer('anno').notNull(),
  progressivo:    integer('progressivo').notNull(),
  /** Derivato AAAA/NNN (zero-pad 3) — calcolato in app al momento dell'insert */
  protocollo:     varchar('protocollo', { length: 20 }).notNull(),
  matricola:      varchar('matricola', { length: 10 }),
  /** CF CIFRATO (AES-256-GCM iv:tag:cipher base64) → colonna larga come familiari_cache */
  cf:             varchar('cf', { length: 255 }),
  /** Periodo retribuzione del cedolino, es. "MAGGIO 2026" */
  periodo:        varchar('periodo', { length: 50 }),
  /** Nominativo per ricerca rapida, es. "ROSSI Mario" */
  nominativo:     varchar('nominativo', { length: 200 }),
  siglaOperatore: varchar('sigla_operatore', { length: 20 }).notNull(),
  dirigente:      varchar('dirigente', { length: 200 }),
  templateId:     uuid('template_id').references(() => templatiCertificato.id, { onDelete: 'set null' }),
  /** Output del parser CIFRATO — envelope { v:1, enc:"iv:tag:cipher" } (AES-256-GCM) */
  datiJson:       jsonb('dati_json').notNull(),
  createdBy:      uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('idx_certificati_anno_progressivo').on(t.anno, t.progressivo),
  index('idx_certificati_anno').on(t.anno),
  index('idx_certificati_matricola').on(t.matricola),
  index('idx_certificati_created_by').on(t.createdBy),
])

// ------------------------------------------------------------
// TEMPLATI PDF REGION (riconoscimento layout cedolino via regioni)
// VERSIONATI E IMMUTABILI: ogni riga = una versione; modifiche →
// nuova riga (versione+1), auto-attivata, predecessore disattivato
// in transazione (mai UPDATE in-place sui campi geometrici).
// templateFamilyId: lineage stabile fra versioni, indipendente da
// nome/id (refinement Gate 2 — evita rottura lineage a rinomina).
// pageGeometryJson/partiJson: solo coordinate % — MAI bytes/binary PDF.
// certificatoTemplateId: FK fissata a CREAZIONE, lega permanentemente
// layout↔forma certificato (mai modificabile dopo — Gate 1, Q6).
// ------------------------------------------------------------

export const templatiPdfRegion = pgTable('templati_pdf_region', {
  id:               uuid('id').primaryKey().defaultRandom(),
  templateFamilyId: uuid('template_family_id').notNull().defaultRandom(),
  nome:             varchar('nome', { length: 200 }).notNull(),
  nota:             text('nota'),
  /** Contatore interno per unicità/ordinamento — mai esposto come label */
  versione:         integer('versione').notNull().default(1),
  /** Formato AA.MM.GG (mirror APP_VERSION) — puramente cosmetico/audit */
  versioneLabel:    varchar('versione_label', { length: 8 }).notNull(),
  attivo:           boolean('attivo').notNull().default(true),
  /** PageGeometry[]: pageIndex/widthPt/heightPt/rotation */
  pageGeometryJson: jsonb('page_geometry_json').notNull(),
  /** ParteTemplate[]: discriminated union ParteAnagrafica | ParteVoce */
  partiJson:        jsonb('parti_json').notNull(),
  certificatoTemplateId: uuid('certificato_template_id').notNull().references(() => templatiCertificato.id),
  createdBy:        uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('idx_templati_pdf_region_family_versione').on(t.templateFamilyId, t.versione),
  // Audit Gate4 H2: vincolo strutturale "max 1 versione attiva per famiglia" —
  // indice unico parziale, garanzia DB-level indipendente dal lock applicativo
  // in createNewVersion(). Riflette migration 0007_pdf_region_one_active.sql
  // (creato CONCURRENTLY in produzione — drizzle non genera/applica DDL da qui,
  // serve solo a tenere lo schema introspect-coerente con il DB reale).
  uniqueIndex('idx_pdf_region_one_active_per_family').on(t.templateFamilyId).where(sql`attivo = true`),
  index('idx_templati_pdf_region_attivo').on(t.attivo),
  index('idx_templati_pdf_region_family').on(t.templateFamilyId),
  index('idx_templati_pdf_region_created_by').on(t.createdBy),
])

// ------------------------------------------------------------
// VOCI CONFIG (parametri manuali per voce — riferimento cedolino WD/WE)
// Separata da `voci`: l'import XML fa upsert su (codice, data_in) e
// cancellerebbe la config. Chiave logica `codice`. Migration 0008.
// ------------------------------------------------------------

export const vociConfig = pgTable('voci_config', {
  codice:       varchar('codice', { length: 10 }).primaryKey(),
  /** Override di csvDefaults.parti — NULL = default globale */
  parti:        integer('parti'),
  /** 'none' | 'standard' | 'contoterzi' — NULL = nessun pre-set */
  tipoScorporo: varchar('tipo_scorporo', { length: 12 }),
  /** Prefisso tag: 'TL' | 'WD' | 'WE' — NULL = nessuno */
  tagDefault:   varchar('tag_default', { length: 8 }),
  /** Se true e tag WE: figlio (FG) più giovane, sempre 1 riga CSV */
  autoFiglio:   boolean('auto_figlio').notNull().default(false),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ------------------------------------------------------------
// FAMILIARI CACHE (figli da CINECA CSA-WS — tag cedolino WE)
// rapporto_parentela 'FG' = figlio/a. Migration 0008.
// ------------------------------------------------------------

export const familiariCache = pgTable('familiari_cache', {
  id:                serial('id').primaryKey(),
  idAb:              integer('id_ab'),
  matricola:         varchar('matricola', { length: 10 }),
  /** cod_fisc CIFRATO (AES-256-GCM iv:tag:cipher base64) → serve colonna larga */
  codFisc:           varchar('cod_fisc', { length: 255 }).notNull(),
  cognome:           varchar('cognome', { length: 100 }),
  nome:              varchar('nome', { length: 100 }),
  sesso:             varchar('sesso', { length: 1 }),
  rapportoParentela: varchar('rapporto_parentela', { length: 4 }).notNull(),
  dataNasc:          date('data_nasc'),
  aggiornatoAt:      timestamp('aggiornato_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('idx_familiari_cache_persona_cf').on(t.matricola, t.codFisc),
  index('idx_familiari_cache_matricola').on(t.matricola),
  index('idx_familiari_cache_id_ab').on(t.idAb),
])

// ------------------------------------------------------------
// TIPI INFERITI (usati nelle repository)
// ------------------------------------------------------------

export type User              = typeof users.$inferSelect
export type NewUser           = typeof users.$inferInsert
export type RefreshToken      = typeof refreshTokens.$inferSelect
export type JwtBlocklistEntry = typeof jwtBlocklist.$inferSelect
export type Anagrafica        = typeof anagrafiche.$inferSelect
export type NewAnagrafica     = typeof anagrafiche.$inferInsert
export type AnagImportLog     = typeof anagImportLog.$inferSelect
export type NewAnagImportLog  = typeof anagImportLog.$inferInsert
export type Voce              = typeof voci.$inferSelect
export type Capitolo          = typeof capitoli.$inferSelect
export type CapitoloAnag      = typeof capitoliAnag.$inferSelect
export type VoceConfig        = typeof vociConfig.$inferSelect
export type NewVoceConfig     = typeof vociConfig.$inferInsert
export type FamiliareCache    = typeof familiariCache.$inferSelect
export type NewFamiliareCache = typeof familiariCache.$inferInsert
export type NewCapitoloAnag   = typeof capitoliAnag.$inferInsert
export type Bozza             = typeof bozze.$inferSelect
export type NewBozza          = typeof bozze.$inferInsert
export type AuditEntry        = typeof auditLog.$inferSelect
export type TemplateCertificato    = typeof templatiCertificato.$inferSelect
export type NewTemplateCertificato = typeof templatiCertificato.$inferInsert
export type Certificato            = typeof certificati.$inferSelect
export type NewCertificato         = typeof certificati.$inferInsert
export type PdfRegionTemplate      = typeof templatiPdfRegion.$inferSelect
export type NewPdfRegionTemplate   = typeof templatiPdfRegion.$inferInsert
