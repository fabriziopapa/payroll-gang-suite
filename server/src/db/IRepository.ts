// ============================================================
// PAYROLL GANG SUITE — Interfacce Abstract Repository
// Cambia driver DB senza toccare nulla al di sopra di questo layer
// ============================================================

// ------------------------------------------------------------
// Risultato operazione di import XML
// ------------------------------------------------------------

export interface ImportResult {
  inserted:    number
  updated:     number
  skipped:     number
  errors:      Array<{ row: number; message: string }>
  processedAt: Date
}

// ------------------------------------------------------------
// Anagrafica Repository
// ------------------------------------------------------------

export interface AnagraficaInput {
  matricola:         string
  cognNome:          string
  ruolo:             string
  druolo?:           string
  decorInq:          string   // YYYY-MM-DD — inizio periodo ruolo
  finRap?:           string   // YYYY-MM-DD — fine rapporto (undefined = attivo)
  dataAggiornamento: Date
}

/**
 * Risultato query ruolo-at:
 * - 0 risultati → nessun record storico, usa fallback locale
 * - 1 risultato → univoco, fill automatico
 * - N>1 risultati → ambiguo, mostra scelta all'utente
 */
export interface RuoloAtResult {
  ruolo:    string        // codice breve "PA"
  druolo:   string | null // descrizione "Professori Associati"
  decorInq: string        // "2020-01-01" — mostrato nell'UI per disambiguare
  finRap:   string | null // null = ancora attivo
}

export interface IAnagraficheRepository {
  findAll(): Promise<AnagraficaRow[]>
  findByMatricola(matricola: string): Promise<AnagraficaRow[]>  // array: storia completa
  findByRuolo(ruolo: string): Promise<AnagraficaRow[]>
  findRuoloAt(matricola: string, data?: string): Promise<RuoloAtResult[]>
  upsertMany(items: AnagraficaInput[]): Promise<ImportResult>
  getLastImportDate(): Promise<Date | null>
}

export interface AnagraficaRow {
  id:                number
  matricola:         string
  cognNome:          string
  ruolo:             string
  druolo:            string | null
  decorInq:          string        // YYYY-MM-DD
  finRap:            string | null // YYYY-MM-DD o null
  dataAggiornamento: string
  updatedAt:         Date
}

// ------------------------------------------------------------
// Voci Repository
// ------------------------------------------------------------

export interface VoceInput {
  codice:      string
  descrizione: string
  dataIn:      string
  dataFin:     string
  tipo?:       string
  personale?:  string
  immissione?: string
  conguaglio?: string
  capitoli:    Array<{ codice: string; descrizione?: string }>
}

export interface VoceRow {
  id:          number
  codice:      string
  descrizione: string
  dataIn:      string
  dataFin:     string
  tipo:        string | null
  capitoli:    Array<{ codice: string; descrizione: string | null }>
}

export interface IVociRepository {
  findAll(): Promise<VoceRow[]>
  findByCodice(codice: string): Promise<VoceRow | null>
  findActive(dataRiferimento?: Date): Promise<VoceRow[]>
  upsertMany(items: VoceInput[]): Promise<ImportResult>
  getLastImportDate(): Promise<Date | null>
}

// ------------------------------------------------------------
// Bozze Repository
// ------------------------------------------------------------

export interface BozzaRow {
  id:                 string
  nome:               string
  stato:              'bozza' | 'archiviata'
  protocolloDisplay:  string | null
  dati:               unknown
  createdBy:          string | null
  createdByUsername:  string | null
  createdAt:          Date
  updatedAt:          Date
}

export interface BozzaInput {
  nome:              string
  stato?:            'bozza' | 'archiviata'
  protocolloDisplay?: string
  dati:              unknown
  createdBy?:        string
}

export interface IBozzeRepository {
  findAll(userId?: string): Promise<BozzaRow[]>
  findById(id: string): Promise<BozzaRow | null>
  create(data: BozzaInput): Promise<BozzaRow>
  update(id: string, data: Partial<BozzaInput>): Promise<BozzaRow>
  archive(id: string): Promise<BozzaRow>
  restore(id: string): Promise<BozzaRow>
  delete(id: string): Promise<void>
}

// ------------------------------------------------------------
// Users Repository
// ------------------------------------------------------------

export interface UserRow {
  id:           string
  username:     string
  isAdmin:      boolean
  isActive:     boolean
  totpVerified: boolean
  createdAt:    Date
  lastLoginAt:  Date | null
}

/**
 * Usato da activateUser: include i campi sensibili necessari per
 * verificare OTP e controllare la scadenza del token.
 */
export interface ActivationUserRow extends UserRow {
  totpSecret:          string
  lastOtpToken:        string | null
  activationExpiresAt: Date | null
}

export interface IUsersRepository {
  findAll(): Promise<UserRow[]>
  findById(id: string): Promise<UserRow | null>
  findByUsername(username: string): Promise<(UserRow & {
    totpSecret:   string
    lastOtpToken: string | null
  }) | null>
  create(data: {
    username:   string
    totpSecret: string
    isAdmin:    boolean
  }): Promise<UserRow>
  setTotpVerified(id: string): Promise<void>
  updateLastLogin(id: string): Promise<void>
  updateLastOtpToken(id: string, token: string): Promise<void>
  setActive(id: string, active: boolean): Promise<void>
  updateTotpSecret(id: string, totpSecret: string): Promise<void>
  delete(id: string): Promise<void>
  // ── FIX #4: Activation token con scadenza ──────────────────
  /** Cerca utente per hash SHA-256 del token di attivazione. */
  findByActivationTokenHash(tokenHash: string): Promise<ActivationUserRow | null>
  /** Imposta hash + scadenza del token di attivazione. */
  setActivationToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>
  /** Cancella il token dopo l'attivazione (o rigenera QR). */
  clearActivationToken(userId: string): Promise<void>
  /** Imposta/rimuove il ruolo admin. */
  setAdmin(id: string, isAdmin: boolean): Promise<void>
}

// ------------------------------------------------------------
// Settings Repository
// ------------------------------------------------------------

export interface ISettingsRepository {
  get<T>(chiave: string): Promise<T | null>
  set<T>(chiave: string, valore: T): Promise<void>
  getAll(): Promise<Record<string, unknown>>
}

// ------------------------------------------------------------
// Audit Repository
// ------------------------------------------------------------

export interface AuditInput {
  userId?:   string
  azione:    string
  entita?:   string
  entitaId?: string
  dettagli?: unknown
  ip?:       string
  userAgent?: string
}

export interface IAuditRepository {
  log(entry: AuditInput): Promise<void>
  findRecent(limit?: number): Promise<AuditEntry[]>
}

export interface AuditEntry {
  id:        number
  userId:    string | null
  azione:    string
  entita:    string | null
  entitaId:  string | null
  dettagli:  unknown
  ip:        string | null
  timestamp: Date
}

// ------------------------------------------------------------
// Capitoli Anagrafica Repository
// Capitoli standalone da Capitoli_STAMPA.xml / Capitoli_Locali_STAMPA.xml
// ------------------------------------------------------------

export type CapitoloSorgente = 'standard' | 'locali'

export interface CapitoloAnagInput {
  codice:       string
  sorgente:     CapitoloSorgente
  descrizione?: string
  breve?:       string
  tipoLiq?:     string
  fCapitolo?:   string
  dataIns?:     string
  dataMod?:     string
  operatore?:   string
}

export interface CapitoloAnagRow {
  id:          number
  codice:      string
  sorgente:    string
  descrizione: string | null
  breve:       string | null
  tipoLiq:     string | null
  fCapitolo:   string | null
  dataIns:     string | null
  dataMod:     string | null
  operatore:   string | null
  updatedAt:   Date
}

export interface ICapitoliAnagRepository {
  findAll(sorgente?: CapitoloSorgente): Promise<CapitoloAnagRow[]>
  findByCodice(codice: string): Promise<CapitoloAnagRow[]>
  upsertMany(items: CapitoloAnagInput[]): Promise<ImportResult>
  getLastImportDates(): Promise<{ standard: Date | null; locali: Date | null }>
}

// ------------------------------------------------------------
// Factory type — punto di accesso unico al DB layer
// ------------------------------------------------------------

export interface RepositoryFactory {
  anagrafiche:  IAnagraficheRepository
  voci:         IVociRepository
  bozze:        IBozzeRepository
  users:        IUsersRepository
  settings:     ISettingsRepository
  audit:        IAuditRepository
  capitoliAnag: ICapitoliAnagRepository
}
