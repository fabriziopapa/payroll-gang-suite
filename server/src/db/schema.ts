// ============================================================
// PAYROLL GANG SUITE — Schema Drizzle ORM (PostgreSQL)
// ============================================================

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
  /** Data inizio periodo ruolo/inquadramento (da DECOR_INQ del file v2) */
  decorInq:          date('decor_inq').notNull(),
  /** Fine rapporto di lavoro — NULL = ancora attivo */
  finRap:            date('fin_rap'),
  /** Data del file XML da cui è stata importata la riga */
  dataAggiornamento: date('data_aggiornamento').notNull(),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
// TIPI INFERITI (usati nelle repository)
// ------------------------------------------------------------

export type User              = typeof users.$inferSelect
export type NewUser           = typeof users.$inferInsert
export type RefreshToken      = typeof refreshTokens.$inferSelect
export type JwtBlocklistEntry = typeof jwtBlocklist.$inferSelect
export type Anagrafica        = typeof anagrafiche.$inferSelect   // ha decorInq, finRap; no codFisc/ruoloCorr
export type NewAnagrafica     = typeof anagrafiche.$inferInsert
export type Voce              = typeof voci.$inferSelect
export type Capitolo          = typeof capitoli.$inferSelect
export type CapitoloAnag      = typeof capitoliAnag.$inferSelect
export type NewCapitoloAnag   = typeof capitoliAnag.$inferInsert
export type Bozza             = typeof bozze.$inferSelect
export type NewBozza          = typeof bozze.$inferInsert
export type AuditEntry        = typeof auditLog.$inferSelect
