// ============================================================
// PAYROLL GANG SUITE — API Endpoints tipizzati
// ============================================================

import { apiFetch } from './client'
import type { AppSettings, VoceConfig } from '../types'
import type {
  AnagraficaPgs, ArchivioTestata, Carico, Iniziativa, Legame, Lotto, ParametriTessera, PatchScelta, Persona, QuotaSocio, Richiesta,
  ScontoPers, Sede, SezioneLotto, StatoApi, TipoEvento, Tipologia, Variazione,
} from '../components/cral/tipi'

// ── Tipi risposta dal server ──────────────────────────────────

export interface UserApi {
  id:       string
  username: string
  isAdmin:  boolean
}

export interface AnagraficaApi {
  id:                number
  matricola:         string
  cognNome:          string
  ruolo:             string
  druolo:            string | null
  decorInq:          string        // YYYY-MM-DD
  finRap:            string | null // YYYY-MM-DD o null
  dataAggiornamento: string
  updatedAt:         string
  // Campi SGE (null per record importati da XML)
  idAb?:      number | null
  cognome?:   string | null
  nome?:      string | null
  dtNascita?: string | null
  genere?:    string | null
  codFis?:    string | null
  /** Area del conto su cui CSA paga: 'IT' | 'SEPA' | 'EXTRA_UE' | 'NON_NOTO'.
   *  Calcolata dal server a partire da nazIban: non e' piu' un dato salvato.
   *  Non contiene l'IBAN: solo la classificazione. */
  areaConto?: string | null
  /** Paese dell'IBAN su cui CSA paga (due lettere), null se assente. */
  nazIban?:   string | null
}

export interface ImportXlsxResult extends ImportResult {
  importId: number
}

/**
 * Risultato di /ruolo-at:
 *   - 0 elementi → nessun record, usa fallback locale
 *   - 1 elemento → univoco, fill automatico
 *   - N>1        → ambiguo, mostra scelta (RuoloDisambiguaModal)
 */
export interface RuoloAtApiResult {
  ruolo:    string
  druolo:   string | null
  decorInq: string        // mostrato per disambiguare
  finRap:   string | null
}

export interface VoceApi {
  id:          number
  codice:      string
  descrizione: string
  dataIn:      string
  dataFin:     string
  tipo:        string | null
  capitoli:    Array<{ codice: string; descrizione: string | null }>
}

export interface BozzaApi {
  id:                 string
  nome:               string
  stato:              'bozza' | 'archiviata'
  protocolloDisplay:  string | null
  /**
   * FIX H-1: `dati` assente nella risposta GET /bozze (lista).
   * Presente solo in GET /bozze/:id (singola bozza, usata dall'editor/viewer).
   */
  dati?:              unknown
  /** Data di liquidazione ISO YYYY-MM-DD — valorizzata all'archiviazione */
  dataLiquidazione:   string | null
  /** ID liquidazione CSA, es. "1ND999999001220240442801" — facoltativo */
  idLiquidazioneCsa:  string | null
  createdBy:          string | null
  createdByUsername:  string | null
  /** Chi ha salvato per ultimo. NULL sulle liquidazioni precedenti alla
   *  migrazione 0015: si popola al primo salvataggio. */
  updatedBy:          string | null
  updatedByUsername:  string | null
  createdAt:          string
  updatedAt:          string
}

export interface ImportResult {
  inserted:    number
  updated:     number
  skipped:     number
  errors:      Array<{ row: number; message: string }>
  processedAt: string
}

// ── Tipi gestione utenti ──────────────────────────────────────

export interface UserManagementEntry {
  id:           string
  username:     string
  isAdmin:      boolean
  isActive:     boolean
  totpVerified: boolean
  createdAt:    string
  lastLoginAt:  string | null
}

export interface RegisterResult {
  userId:          string
  activationToken: string   // FIX #4: token opaco per il link ?activate=
  qrCodeUrl:       string
  backupKey:       string
  emailSent:       boolean
}

export interface RegenQrResult {
  activationToken: string   // FIX #4: token opaco per il link ?activate=
  qrCodeUrl:       string
  backupKey:       string
  emailSent:       boolean
}

// ── Auth ──────────────────────────────────────────────────────

export const authApi = {
  login: (username: string, token: string, cfTurnstileToken?: string) =>
    apiFetch<{ accessToken: string; user: UserApi }>('/auth/login', {
      method: 'POST',
      body:   JSON.stringify({ username, token, ...(cfTurnstileToken ? { cfTurnstileToken } : {}) }),
    }),

  logout: () =>
    apiFetch<{ success: boolean }>('/auth/logout', { method: 'POST' }),

  me: () =>
    apiFetch<{ user: UserApi }>('/auth/me'),

  register: (username: string, isAdmin: boolean) =>
    apiFetch<RegisterResult>('/auth/register', {
      method: 'POST',
      body:   JSON.stringify({ username, isAdmin }),
    }),

  // FIX #4: invia activationToken (token opaco da URL) + token OTP
  activate: (activationToken: string, otpToken: string, cfTurnstileToken?: string) =>
    apiFetch<{ success: boolean }>('/auth/activate', {
      method: 'POST',
      body:   JSON.stringify({ activationToken, token: otpToken, ...(cfTurnstileToken ? { cfTurnstileToken } : {}) }),
    }),
}

// ── Utenti (admin only) ───────────────────────────────────────

export interface AuditEntryApi {
  id:        number
  userId:    string | null
  username:  string | null
  azione:    string
  entita:    string | null
  entitaId:  string | null
  dettagli:  unknown
  ip:        string | null
  userAgent: string | null
  timestamp: string
}

export interface AuditListResult {
  rows:     AuditEntryApi[]
  total:    number
  page:     number
  pageSize: number
}

export const auditApi = {
  list: (params: {
    page?: number; pageSize?: number; azione?: string
    search?: string; from?: string; to?: string
  } = {}) => {
    const qs = new URLSearchParams()
    if (params.page)     qs.set('page', String(params.page))
    if (params.pageSize) qs.set('pageSize', String(params.pageSize))
    if (params.azione)   qs.set('azione', params.azione)
    if (params.search)   qs.set('search', params.search)
    if (params.from)     qs.set('from', params.from)
    if (params.to)       qs.set('to', params.to)
    const q = qs.toString()
    return apiFetch<AuditListResult>(`/audit${q ? `?${q}` : ''}`)
  },
  azioni: () => apiFetch<string[]>('/audit/azioni'),
}

export const usersApi = {
  list: () =>
    apiFetch<UserManagementEntry[]>('/users'),

  delete: (id: string) =>
    apiFetch<void>(`/users/${id}`, {
      method:  'DELETE',
      headers: { 'X-Confirm-Delete': 'true' },
    }),

  setActive: (id: string, active: boolean) =>
    apiFetch<{ success: boolean }>(`/users/${id}/active`, {
      method: 'PUT',
      body:   JSON.stringify({ active }),
    }),

  regenQr: (id: string) =>
    apiFetch<RegenQrResult>(`/users/${id}/regen-qr`, { method: 'POST' }),

  setAdmin: (id: string, isAdmin: boolean) =>
    apiFetch<{ success: boolean }>(`/users/${id}/admin`, {
      method: 'PUT',
      body:   JSON.stringify({ isAdmin }),
    }),

  /** SEC-M01 FIX G: sblocca account bloccato per OTP (admin only). */
  unlock: (id: string) =>
    apiFetch<{ success: boolean }>(`/users/${id}/unlock`, { method: 'POST' }),
}

// ── Bozze ─────────────────────────────────────────────────────

/** Dati richiesti all'archiviazione di una liquidazione. */
export interface LiquidazioneInfo {
  /** ISO YYYY-MM-DD — obbligatoria */
  dataLiquidazione:   string
  /** ID liquidazione CSA — facoltativo */
  idLiquidazioneCsa?: string
}

export const bozzeApi = {
  list: () =>
    apiFetch<BozzaApi[]>('/bozze'),

  /**
   * GET /bozze/all-with-data — tutte le bozze con `dati` JSONB incluso.
   * Usata da RicercaPage: sostituisce il pattern 1+N (lista + N getById).
   * Una sola query DB invece di N query parallele.
   */
  listWithData: () =>
    apiFetch<BozzaApi[]>('/bozze/all-with-data'),

  /**
   * Ricerca server-side sui gruppi (JSONB) — ritorna solo i riepiloghi
   * (senza `dati`). Usata dalla Dashboard: nessun trasferimento del JSONB.
   */
  search: (params: {
    stato?: 'bozza' | 'archiviata'
    text?: string; titolo?: string; voce?: string; capitolo?: string
    idProv?: string; centroCosto?: string; note?: string; from?: string; to?: string
  }) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v != null && String(v).trim() !== '') qs.set(k, String(v))
    }
    const q = qs.toString()
    return apiFetch<BozzaApi[]>(`/bozze/search${q ? `?${q}` : ''}`)
  },

  /** Come search ma con `dati` completo (per la pagina Ricerca). */
  searchWithData: (params: {
    stato?: 'bozza' | 'archiviata'
    text?: string; titolo?: string; voce?: string; capitolo?: string
    idProv?: string; centroCosto?: string; note?: string; from?: string; to?: string
  }) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v != null && String(v).trim() !== '') qs.set(k, String(v))
    }
    qs.set('withData', 'true')
    return apiFetch<BozzaApi[]>(`/bozze/search?${qs.toString()}`)
  },

  /**
   * FIX H-1: recupera una bozza completa (con campo `dati`) via GET /bozze/:id.
   * Usata dall'editor/viewer per caricare i dati di una singola bozza.
   */
  getById: (id: string) =>
    apiFetch<BozzaApi>(`/bozze/${id}`),

  create: (nome: string, dati: unknown, protocolloDisplay?: string) =>
    apiFetch<BozzaApi>('/bozze', {
      method: 'POST',
      body:   JSON.stringify({ nome, dati, ...(protocolloDisplay ? { protocolloDisplay } : {}) }),
    }),

  update: (id: string, data: { nome?: string; dati?: unknown; protocolloDisplay?: string }) =>
    apiFetch<BozzaApi>(`/bozze/${id}`, {
      method: 'PUT',
      body:   JSON.stringify(data),
    }),

  archive: (id: string, info: LiquidazioneInfo) =>
    apiFetch<BozzaApi>(`/bozze/${id}/archive`, {
      method: 'POST',
      body:   JSON.stringify(info),
    }),

  /** Aggiorna data liquidazione / ID CSA di una bozza già archiviata. */
  updateLiquidazioneInfo: (id: string, info: LiquidazioneInfo) =>
    apiFetch<BozzaApi>(`/bozze/${id}/liquidazione-info`, {
      method: 'PATCH',
      body:   JSON.stringify(info),
    }),

  restore: (id: string) =>
    apiFetch<BozzaApi>(`/bozze/${id}/restore`, { method: 'POST' }),

  delete: (id: string) =>
    apiFetch<void>(`/bozze/${id}`, {
      method:  'DELETE',
      headers: { 'X-Confirm-Delete': 'true' },
    }),
}

// ── Anagrafiche ───────────────────────────────────────────────

export const anagraficheApi = {
  list: (data?: string) =>
    apiFetch<AnagraficaApi[]>(data ? `/anagrafiche?data=${data}` : '/anagrafiche'),

  importXml: (xml: string, dataAggiornamento?: string) =>
    apiFetch<ImportResult>('/anagrafiche/import', {
      method: 'POST',
      body:   JSON.stringify({ xml, ...(dataAggiornamento ? { dataAggiornamento } : {}) }),
    }),

  importXlsx: (xlsx: string, nomeFile?: string) =>
    apiFetch<ImportXlsxResult>('/anagrafiche/import-xlsx', {
      method: 'POST',
      body:   JSON.stringify({ xlsx, ...(nomeFile ? { nomeFile } : {}) }),
    }),

  lastImport: () =>
    apiFetch<{ lastImport: string | null }>('/anagrafiche/last-import'),

  /**
   * Recupera il ruolo di una persona a una data specifica (o attuale).
   * @param matricola  Matricola del dipendente
   * @param data       YYYY-MM-DD — se omessa, restituisce i ruoli attivi (fin_rap IS NULL)
   */
  ruoloAt: (matricola: string, data?: string) =>
    apiFetch<RuoloAtApiResult[]>(
      `/anagrafiche/ruolo-at?matricola=${encodeURIComponent(matricola)}${data ? `&data=${data}` : ''}`,
    ),

  /**
   * Versione bulk di ruoloAt: 1 sola richiesta per N matricole.
   * Ritorna mappa matricola → risultati (matricole senza dati storici assenti dalla mappa).
   * Usata da "Aggiorna Ruolo" sui gruppi grandi (evita il rate-limit).
   */
  ruoloAtBulk: (matricole: string[], data?: string) =>
    apiFetch<Record<string, RuoloAtApiResult[]>>('/anagrafiche/ruolo-at-bulk', {
      method: 'POST',
      body:   JSON.stringify({ matricole, data }),
    }),
}

// ── Voci ──────────────────────────────────────────────────────

export const vociApi = {
  list: () =>
    apiFetch<VoceApi[]>('/voci'),

  active: () =>
    apiFetch<VoceApi[]>('/voci/active'),

  importXml: (xml: string) =>
    apiFetch<ImportResult>('/voci/import', {
      method: 'POST',
      body:   JSON.stringify({ xml }),
    }),

  lastImport: () =>
    apiFetch<{ lastImport: string | null }>('/voci/last-import'),
}

// ── Voci Config (parametri manuali per voce — rif. cedolino) ──

export const vociConfigApi = {
  list: () =>
    apiFetch<VoceConfig[]>('/voci-config'),

  save: (codice: string, cfg: Omit<VoceConfig, 'codice'>) =>
    apiFetch<VoceConfig>(`/voci-config/${encodeURIComponent(codice)}`, {
      method: 'PUT',
      body:   JSON.stringify(cfg),
    }),

  remove: (codice: string) =>
    apiFetch<{ success: boolean }>(`/voci-config/${encodeURIComponent(codice)}`, {
      method: 'DELETE',
    }),
}

// ── CINECA CSA-WS (riferimento cedolino WD/WE) ────────────────

export interface FamiliareApi {
  codFisc:           string
  rapportoParentela: string
  cognome:           string | null
  nome:              string | null
  sesso:             string | null
  dataNasc:          string | null
}

export const cinecaApi = {
  /** CF dipendente (dato locale SGE) — per tag WD */
  cf: (matricola: string) =>
    apiFetch<{ matricola: string; codFisc: string; source: string }>(
      `/cineca/cf?matricola=${encodeURIComponent(matricola)}`),

  /** Nucleo familiare completo — per scelta manuale figlio (WE) */
  familiari: (matricola: string) =>
    apiFetch<{ matricola: string; familiari: FamiliareApi[]; fromCache: boolean }>(
      `/cineca/familiari?matricola=${encodeURIComponent(matricola)}`),

  /** Figlio (FG) più giovane — per tag WE con scelta automatica */
  figlioGiovane: (matricola: string) =>
    apiFetch<{ matricola: string; figlio: FamiliareApi; fromCache: boolean }>(
      `/cineca/figlio-giovane?matricola=${encodeURIComponent(matricola)}`),

  /** CF dipendente (locale) per N matricole — 1 richiesta (tag WD, recupero gruppo) */
  cfBulk: (matricole: string[]) =>
    apiFetch<Record<string, { codFisc: string }>>('/cineca/cf-bulk', {
      method: 'POST',
      body:   JSON.stringify({ matricole }),
    }),

  /** Figlio FG più giovane per N matricole — 1 richiesta (tag WE, recupero gruppo) */
  figliGiovaneBulk: (matricole: string[]) =>
    apiFetch<Record<string, FamiliareApi | null>>('/cineca/figli-giovane-bulk', {
      method: 'POST',
      body:   JSON.stringify({ matricole }),
    }),

  /** Tutti i figli (FG) per N matricole — scelta manuale in blocco (tag WE, no auto) */
  figliBulk: (matricole: string[]) =>
    apiFetch<Record<string, FamiliareApi[]>>('/cineca/figli-bulk', {
      method: 'POST',
      body:   JSON.stringify({ matricole }),
    }),
}

// ── Capitoli Anagrafica ───────────────────────────────────────

export type CapitoloSorgente = 'standard' | 'locali'

export interface CapitoloAnagApi {
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
  updatedAt:   string
}

export const capitoliApi = {
  list: (sorgente?: CapitoloSorgente) =>
    apiFetch<CapitoloAnagApi[]>(sorgente ? `/capitoli?sorgente=${sorgente}` : '/capitoli'),

  importXml: (xml: string, sorgente: CapitoloSorgente) =>
    apiFetch<ImportResult>('/capitoli/import', {
      method: 'POST',
      body:   JSON.stringify({ xml, sorgente }),
    }),

  lastImport: () =>
    apiFetch<{ standard: string | null; locali: string | null }>('/capitoli/last-import'),
}

// ── Certificati ───────────────────────────────────────────────

export interface AnagraficaCedolinoApi {
  periodo_retribuzione: string | null
  matricola:            string | null
  cognome:              string | null
  nome:                 string | null
  codice_fiscale:       string | null
  data_nascita:         string | null
  luogo_nascita:        string | null
  inquadramento:        string | null
  area_profilo:         string | null
  ruolo:                string | null
  inizio_rapporto:      string | null
  anzianita_servizio:   string | null
  afferenza:            string | null
  sede:                 string | null
}

export interface VoceTeoricaApi { descrizione: string; valore: number | null; totale: boolean }

export interface VoceDettaglioApi {
  sezione:     string | null
  descrizione: string
  valore:      number
  numeri_riga: number[]
  arretrato:   boolean
  conguaglio:  boolean
  scadenza:    string | null
  decorrenza:  string | null
}

export interface CertificatoCalcolatoApi {
  lordo_teorico:          number | null
  ritenute_fiscali:       number | null
  ritenute_previdenziali: number | null
  netto_ritenute_legge:   number | null
  extraerariali_totale:   number | null
  extraerariali_righe:    Array<{ descrizione: string; decorrenza: string | null; scadenza: string | null; valore: number | null }>
  netto_a_pagare:         number | null
  quinto:                 number | null
  settimo:                number | null
}

/** Output del parser cedolino (anteprima editabile). */
export interface CedolinoParsedApi {
  anagrafica:         AnagraficaCedolinoApi
  voci_teoriche:      VoceTeoricaApi[]
  voci_dettaglio:     VoceDettaglioApi[]
  riepilogo_cedolino: Record<string, number | null>
  certificato:        CertificatoCalcolatoApi
}

export interface DocxPayload { filename: string; base64: string }

export interface CertificatoSummaryApi {
  id:                string
  anno:              number
  progressivo:       number
  protocollo:        string
  matricola:         string | null
  nominativo:        string | null
  periodo:           string | null
  siglaOperatore:    string
  createdByUsername: string | null
  createdAt:         string
}

export interface CertificatoCreatedApi extends CertificatoSummaryApi {
  docx: DocxPayload
}

export interface TemplateApi {
  id:            string
  nome:          string
  strutturaJson: unknown
  attivo:        boolean
  createdAt:     string
  updatedAt:     string
}

export interface CreaCertificatoBody {
  parsed:         CedolinoParsedApi
  templateId:     string
  siglaOperatore: string
  dirigente?:     string
  dataRilascio:   string
  sesso?:         'M' | 'F'
  anno?:          number
  /** modalità assolvimento marca da bollo scelta (da settings.bolloOpzioni) */
  bolloTesto?:    string
}

export interface CedolinoDaLiquidatoApi {
  parsed:        CedolinoParsedApi
  /** true se il netto ricalcolato quadra con la voce 03003 del liquidato. */
  quadratura:    boolean
  nettoCedolino: number | null
}

export const certificatiApi = {
  /** Estrae i dati dal PDF (base64). Nessuna persistenza. */
  parse: (pdfBase64: string) =>
    apiFetch<CedolinoParsedApi>('/certificati/parse', {
      method: 'POST',
      body:   JSON.stringify({ pdf: pdfBase64 }),
    }),

  /** Costruisce il cedolino dagli aggregati del liquidato CINECA (admin). */
  daLiquidato: (anno: string, mese: string, matricola: string) =>
    apiFetch<CedolinoDaLiquidatoApi>('/certificati/da-liquidato', {
      method: 'POST',
      body:   JSON.stringify({ anno, mese, matricola }),
    }),

  /** Crea record (protocollo atomico) + genera DOCX. */
  create: (body: CreaCertificatoBody) =>
    apiFetch<CertificatoCreatedApi>('/certificati', {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  list: (anno?: number, search?: string) => {
    const q = new URLSearchParams()
    if (anno) q.set('anno', String(anno))
    if (search) q.set('search', search)
    const qs = q.toString()
    return apiFetch<CertificatoSummaryApi[]>(`/certificati${qs ? `?${qs}` : ''}`)
  },

  /** Rigenera il DOCX da datiJson (download). */
  docx: (id: string) =>
    apiFetch<DocxPayload>(`/certificati/${id}/docx`),

  /** Elimina definitivamente un certificato (admin). Il progressivo viene
   *  risincronizzato a MAX rimanente lato server. */
  delete: (id: string) =>
    apiFetch<void>(`/certificati/${id}`, {
      method:  'DELETE',
      headers: { 'X-Confirm-Delete': 'true' },
    }),
}

export const templatiCertificatoApi = {
  list: (soloAttivi?: boolean) =>
    apiFetch<TemplateApi[]>(`/templati-certificato${soloAttivi ? '?soloAttivi=true' : ''}`),

  getById: (id: string) =>
    apiFetch<TemplateApi>(`/templati-certificato/${id}`),

  create: (nome: string, strutturaJson: unknown, attivo = true) =>
    apiFetch<TemplateApi>('/templati-certificato', {
      method: 'POST',
      body:   JSON.stringify({ nome, strutturaJson, attivo }),
    }),

  update: (id: string, data: { nome?: string; strutturaJson?: unknown; attivo?: boolean }) =>
    apiFetch<TemplateApi>(`/templati-certificato/${id}`, {
      method: 'PUT',
      body:   JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiFetch<void>(`/templati-certificato/${id}`, { method: 'DELETE' }),
}

// ── PDF Region Editor ────────────────────────────────────────
// Mirror verbatim dei tipi dominio server (services/pdfRegion/types.ts,
// Gate 2 §A) — strutture dati pure, identiche client/server (round-trip
// JSON lossless: niente divergenza di forma come per CedolinoParsedApi,
// che invece allenta riepilogo_cedolino a Record<string, number|null>).
// `sezione` allentato a string — mirror VoceDettaglioApi riga 325
// (SezioneCedolino non attraversa il confine di tipo client/server).

/** Geometria pagina — widthPt/heightPt in punti PDF nativi (pdfjs getViewport @ scale 1). */
export interface PageGeometry {
  pageIndex: number
  widthPt:   number
  heightPt:  number
  rotation:  0 | 90 | 180 | 270
}

/** Rettangolo regione — coordinate percentuali 0..1 relative alla pagina (spazio-viewport). */
export interface RegionRect {
  pageIndex: number
  x:         number
  y:         number
  width:     number
  height:    number
}

export type AnagraficaRuolo =
  | 'matricola' | 'cognome_nome' | 'periodo_retribuzione'
  // campi 1:1 su AnagraficaCedolino — mirror server services/pdfRegion/types.ts
  | 'codice_fiscale' | 'data_nascita' | 'luogo_nascita'
  | 'inquadramento' | 'area_profilo' | 'ruolo'
  | 'inizio_rapporto' | 'anzianita_servizio' | 'afferenza' | 'sede'

/** Parte anagrafica — 1 sola regione (discriminated union, mirror server: niente campi ambigui). */
export interface ParteAnagrafica {
  kind:    'anagrafica'
  id:      string
  label:   string
  ruolo:   AnagraficaRuolo
  regione: RegionRect
}

/** Parte voce — coppia di regioni + attributi calcolo. Strada A pura: `sezione` passthrough diretto. */
export interface ParteVoce {
  kind:               'voce'
  id:                 string
  label:              string
  regioneDescrizione: RegionRect
  regioneImporto:     RegionRect
  sezione:            string            // SezioneCedolino — passthrough Strada A (allentato, vedi nota)
  sign:               '+' | '-'
  isArretrato:        boolean
  decorrenza?:        string | null     // ISO 8601 — solo sezione 'sindacali'/'altre_ritenute'
  scadenza?:          string | null
}

export type ParteTemplate = ParteAnagrafica | ParteVoce

export interface AdattatoreWarning {
  tipo:      'TEO_MANCANTE' | 'IMPORTO_NON_LETTO' | 'RIEPILOGO_SINTETIZZATO'
  campo?:    string
  parteId?:  string
  messaggio: string
}

export interface AdattatoreError {
  tipo:      'REGIONE_VUOTA' | 'IMPORTO_NON_PARSABILE' | 'PAGINA_FUORI_RANGE' | 'ANAGRAFICA_INCOMPLETA'
  parteId?:  string
  messaggio: string
}

/** Risposta /extract — preview editabile, NESSUNA persistenza (mirror /certificati/parse). */
export interface ExtractPreviewResult {
  parsed:   CedolinoParsedApi
  warnings: AdattatoreWarning[]
  errors:   AdattatoreError[]   // se non vuoto, blocca generazione finché non corretto in anteprima
}

export interface PdfRegionTemplateApi {
  id:                    string
  templateFamilyId:      string
  nome:                  string
  nota:                  string | null
  versione:              number
  versioneLabel:         string
  attivo:                boolean
  pageGeometry:          PageGeometry[]
  parti:                 ParteTemplate[]
  certificatoTemplateId: string
  createdBy:             string | null
  createdByUsername:     string | null
  createdAt:             string
  updatedAt:             string
}

/** Body create/createNewVersion — solo i campi editabili dall'operatore (mirror Gate 2 §D). */
export type PdfRegionTemplateBody = Omit<PdfRegionTemplateApi,
  'id' | 'templateFamilyId' | 'versione' | 'versioneLabel' | 'attivo' |
  'createdBy' | 'createdByUsername' | 'createdAt' | 'updatedAt'>

export const pdfRegionTemplatesApi = {
  list: (opts?: { all?: boolean }) =>
    apiFetch<PdfRegionTemplateApi[]>(`/pdf-region-templates${opts?.all ? '?all=true' : ''}`),

  getById: (id: string) =>
    apiFetch<PdfRegionTemplateApi>(`/pdf-region-templates/${id}`),

  create: (data: PdfRegionTemplateBody) =>
    apiFetch<PdfRegionTemplateApi>('/pdf-region-templates', {
      method: 'POST', body: JSON.stringify(data),
    }),

  /** Crea nuova versione (admin) — mai patch parziale, sempre sostituzione completa. */
  createNewVersion: (id: string, data: PdfRegionTemplateBody) =>
    apiFetch<PdfRegionTemplateApi>(`/pdf-region-templates/${id}`, {
      method: 'PUT', body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiFetch<void>(`/pdf-region-templates/${id}`, {
      method: 'DELETE', headers: { 'X-Confirm-Delete': 'true' },
    }),

  /** Estrae anteprima dal PDF (base64) applicando il template. Nessuna persistenza. */
  extract: (id: string, pdfBase64: string) =>
    apiFetch<ExtractPreviewResult>(`/pdf-region-templates/${id}/extract`, {
      method: 'POST', body: JSON.stringify({ pdf: pdfBase64 }),
    }),
}

// ── Settings ─────────────────────────────────────────────────

export const settingsApi = {
  get: () =>
    apiFetch<AppSettings>('/settings'),

  update: (settings: Partial<AppSettings>) =>
    apiFetch<AppSettings>('/settings', {
      method: 'PUT',
      body:   JSON.stringify(settings),
    }),

  // Senza autenticazione — espone solo chiavi pubbliche (es. turnstileEnabled)
  getPublic: () =>
    apiFetch<{ turnstileEnabled: boolean }>('/settings/public'),
}

// ── Verifica liquidato (CINECA) ──────────────────────────────

export interface LiquidatoVoceApi {
  flVoce:        boolean
  capitolo:      string
  flagc:         string
  voce:          string
  progrVoce:     string
  dataCompVoce:  string
  aliquota:      number
  parti:         number
  importo:       number
  importoTotale: number
  riferimento:   string | null
  progrLiquidazione: string
}

export interface RigaRicostruitaApi {
  chiave:            string
  matricola:         string
  voce:              string
  capitolo:          string
  dataCompVoce:      string
  riferimento:       string | null
  modalita:          'importo' | 'parti'
  nRighe:            number
  tipo:              string
  importoTotale?:    number
  parti?:            number
  importoUnitario?:  number
  valore?:           number
  valoreNetto?:      number
}

export interface RicostruzioneApi {
  inviiPGS:   RigaRicostruitaApi[]
  conguagli:  RigaRicostruitaApi[]
  storni:     RigaRicostruitaApi[]
  rettifiche: RigaRicostruitaApi[]
}

export interface LiquidatoDettaglioApi {
  anno:          string
  mese:          string
  matricola:     string
  dettaglio:     LiquidatoVoceApi[]
  ricostruzione: RicostruzioneApi
}

export const verificaLiquidatoApi = {
  /** Dettaglio liquidato + ricostruzione invii PGS (admin). */
  dettaglio: (anno: string, mese: string, matricola: string) => {
    const q = new URLSearchParams({ anno, mese, matricola })
    return apiFetch<LiquidatoDettaglioApi>(`/verifica-liquidato/dettaglio?${q.toString()}`)
  },
}

/** Una riga dell'elenco dei paesi (paesi_conto). Date 'AAAA-MM-GG'. */
export interface PaeseContoApi {
  id:        number
  codice:    string
  area:      'SEPA' | 'EXTRA_UE'
  validoDal: string
  validoAl:  string | null
  fonte:     string
  nota:      string | null
  createdAt: string
}

export const paesiContoApi = {
  /** Elenco in vigore e storia completa. */
  elenco: () =>
    apiFetch<{ inVigore: PaeseContoApi[]; storia: PaeseContoApi[] }>('/area-conto/paesi'),
  /** Cambia l'area di un paese da una data (admin). Non sovrascrive: apre una riga nuova. */
  cambia: (body: { codice: string; area: 'SEPA' | 'EXTRA_UE'; validoDal?: string; nota: string }) =>
    apiFetch<{ nuova: PaeseContoApi; chiusa: PaeseContoApi | null }>('/area-conto/paesi', {
      method: 'POST',
      body:   JSON.stringify(body),
    }),
}

// ── Emolumenti: pannello CSA (dottorandi e borse) ─────────────
// Sola lettura. Serve a sapere che cosa è GIÀ in CSA prima di produrre il CSV.

/** Voce variabile CSA, come normalizzata dal server. */
export interface VoceCsaApi {
  /** Chiave composta CSA (comparto+ruolo+matricola+mese+anno+voce+progr.);
   *  valorizzata solo su alcune righe. */
  idVoce:              string | null
  codiceVoce:          string
  descrizioneVoce:     string | null
  comparto:            string | null
  ruolo:               string | null
  /** YYYY-MM-DD */
  dataCompetenzaVoce:  string | null
  anno:                number | null
  mese:                number | null
  codiceStatoVoce:     string | null
  parti:               number | null
  importo:             number | null
  codiceCapitolo:      string | null
  codiceCentroDiCosto: string | null
  riferimento:         string | null
  nota:                string | null
}

export interface RisultatoMatricolaApi {
  matricola:  string
  idAb:       number | null
  /** false = matricola non trovata in anagrafiche PGS (manca l'import SGE). */
  anagrafica: boolean
  /** Errore CSA per questa sola matricola; le altre proseguono comunque. */
  errore:     string | null
  voci:       VoceCsaApi[]
}

export interface EmolumentiCsaVociApi {
  parametri: { codiceVoce: string; annoDa: number | null; annoA: number | null }
  risultati: RisultatoMatricolaApi[]
}

export type EsitoRisoluzione = 'trovato' | 'ambiguo' | 'non-trovato'

export interface CandidatoApi {
  matricola:    string
  nomeCompleto: string
  ruolo:        string | null
  idAb:         number | null
}

export interface RigaRisoltaApi {
  nominativo:          string
  numeroProvvedimento: string | null
  esito:               EsitoRisoluzione
  matricola:           string | null
  idAb:                number | null
  nomeCompleto:        string | null
  ruolo:               string | null
  /** Valorizzato solo su 'ambiguo': la scelta resta all'operatore. */
  candidati:           CandidatoApi[]
  /** Area del conto su cui CSA paga: 'IT' | 'SEPA' | 'EXTRA_UE' | 'NON_NOTO'.
   *  null = matricola non trovata. Non e' un IBAN e non lo contiene. */
  areaConto:           string | null
  /** Paese dell'IBAN da cui l'area e' calcolata (due lettere), o null. */
  nazIban:             string | null
}


/**
 * Un rapporto nella storia anagrafica di una matricola.
 * Non e' "il ruolo": e' uno dei ruoli, con le date in cui e' valso. Per i
 * dottorandi e i borsisti ce ne sono parecchi, ed e' normale.
 */
export interface StoricoRuoloApi {
  ruolo:     string
  druolo:    string | null
  decorInq:  string        // YYYY-MM-DD
  finRap:    string | null // null = ancora aperto
  idAb:      number | null
  /** Area del conto calcolata dalla nazione di QUELLA riga d'anagrafica. */
  areaConto: string | null
  /** Paese dell'IBAN di quella riga (due lettere), o null. */
  nazIban?:  string | null
}

/** Lavorazione dell'area Emolumenti — riga di elenco, senza il payload. */
export interface LavorazioneApi {
  id:               string
  nome:             string
  stato:            'bozza' | 'archiviata' | string
  tipo:             string | null
  dataLiquidazione:  string | null
  /** ID liquidazione CSA — facoltativo, come nelle bozze. */
  idLiquidazioneCsa: string | null
  createdBy:        string | null
  /** Chi ha salvato per ultimo. NULL sulle lavorazioni create prima della
   *  migrazione 0014: si popola al primo salvataggio. */
  updatedBy:        string | null
  createdAt:        string
  updatedAt:        string
  /** Risolti con un join solo nell'ELENCO: le altre risposte restituiscono la
   *  riga come sta in tabella e non li portano. Da qui il `?`. */
  createdByUsername?: string | null
  updatedByUsername?: string | null
  /** 'AAAA-MM' letto dal payload, solo nell'elenco. Puo' mancare o essere
   *  sporco: va validato prima di mostrarlo. */
  meseLiquidazione?: string | null
}

/** Lavorazione completa: `dati` e' il payload serializzato dalla pagina. */
export interface LavorazioneFullApi extends LavorazioneApi {
  dati: Record<string, unknown>
}

/** Esito per matricola di "Verifica conti da CSA". */
export interface ContoDaCsaApi {
  matricola:   string
  /** Nazione su cui CSA ha pagato; null se da chiarire. */
  nazIban:     string | null
  /** 'IT' | 'SEPA' | 'EXTRA_UE'; null se da chiarire. */
  area:        string | null
  /** 'senza coordinata' | 'coordinate discordanti' | 'nazione assente' | 'progressivo assente' */
  motivo:      string | null
  progressivi: string
}

export interface ContiDaCsaApi {
  conti:          ContoDaCsaApi[]
  /** Matricole chieste che nelle testate di quel mese non ci sono. */
  nonTrovate:     string[]
  testateLette:   number
  testateLiquide: number
  epcVersione:    string
}

export const emolumentiApi = {
  /** Nomi incollati → matricole, contro l'anagrafica locale. Nessuna chiamata a CSA. */
  risolviNominativi: (righe: Array<{ nominativo: string; numeroProvvedimento?: string }>) =>
    apiFetch<{ risultati: RigaRisoltaApi[] }>('/emolumenti/risolvi-nominativi', {
      method: 'POST',
      body:   JSON.stringify({ righe }),
    }),

  /** Storia completa dei ruoli di una matricola: un rapporto per riga, con le
   *  date. Si chiama a richiesta, quando l'operatore apre i dettagli di una
   *  persona — non in blocco per tutto l'elenco. */
  storicoRuoli: (matricola: string) =>
    apiFetch<{ matricola: string; storico: StoricoRuoloApi[] }>(
      `/emolumenti/storico-ruoli/${encodeURIComponent(matricola)}`,
    ),

  /** Conto su cui CSA ha pagato, dalle testate del liquidato di un mese (admin).
   *  Nessun IBAN: solo nazione, area e progressivi, e solo per le matricole chieste. */
  contiDaCsa: (body: {
    anno: number; mese: number; ruoli: string[]; comparto?: string
    progrLiquidazione?: string; matricole: string[]
  }) =>
    apiFetch<ContiDaCsaApi>('/emolumenti/conti-da-csa', {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  /** Storia dei ruoli per N matricole in una chiamata sola. Serve a segnalare
   *  l'ambiguità sulle righe prima che l'operatore apra i dettagli. */
  storicoRuoliBulk: (matricole: string[]) =>
    apiFetch<{ storici: Record<string, StoricoRuoloApi[]> }>('/emolumenti/storico-ruoli', {
      method: 'POST',
      body:   JSON.stringify({ matricole }),
    }),

  /** Voci già presenti in CSA per le matricole indicate (admin). */
  csaVoci: (body: {
    matricole:   string[]
    codiceVoce?: string
    annoDa?:     number
    annoA?:      number
  }) => apiFetch<EmolumentiCsaVociApi>('/emolumenti/csa/voci', {
    method: 'POST',
    body:   JSON.stringify(body),
  },
  // CSA-WS via reverse proxy è lento (~8s a chiamata) e qui se ne fanno tante,
  // sei alla volta: i 30s di default aborterebbero un elenco lungo a metà.
  5 * 60_000),

  // ── Lavorazioni: salva, riapri, archivia ─────────────────────────────
  // Il payload puo' essere grosso (200 righe con lo snapshot CSA): il timeout
  // di default basta, ma non e' una chiamata "leggera" — niente autosave a
  // ogni tasto premuto.

  lavorazioni: (stato?: 'bozza' | 'archiviata') =>
    apiFetch<{ lavorazioni: LavorazioneApi[] }>(
      stato ? `/emolumenti/lavorazioni?stato=${stato}` : '/emolumenti/lavorazioni',
    ),

  lavorazione: (id: string) =>
    apiFetch<LavorazioneFullApi>(`/emolumenti/lavorazioni/${id}`),

  creaLavorazione: (body: { nome: string; tipo?: string; dati: Record<string, unknown> }) =>
    apiFetch<LavorazioneFullApi>('/emolumenti/lavorazioni', {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  aggiornaLavorazione: (
    id: string,
    body: { nome?: string; tipo?: string | null; dati?: Record<string, unknown> },
  ) => apiFetch<LavorazioneFullApi>(`/emolumenti/lavorazioni/${id}`, {
    method: 'PUT',
    body:   JSON.stringify(body),
  }),

  /** Stesso payload dell'archiviazione delle liquidazioni: data obbligatoria,
   *  ID CSA facoltativo. Cosi' le due schermate usano lo stesso modale. */
  archiviaLavorazione: (id: string, info: LiquidazioneInfo) =>
    apiFetch<LavorazioneFullApi>(`/emolumenti/lavorazioni/${id}/archivia`, {
      method: 'POST',
      body:   JSON.stringify(info),
    }),

  riapriLavorazione: (id: string) =>
    apiFetch<LavorazioneFullApi>(`/emolumenti/lavorazioni/${id}/riapri`, {
      method: 'POST',
    }),

  eliminaLavorazione: (id: string) =>
    apiFetch<void>(`/emolumenti/lavorazioni/${id}`, { method: 'DELETE' }),
}

// ── Emolumenti · Tipi conto ─────────────────────────────────
export type TipoContoApi = 'IT' | 'SEPA' | 'EXTRA_UE' | 'DA_CHIARIRE'

export interface TipoContoElabApi {
  id: string; anno: number; mese: number; ruolo: string; comparto: string
  progrLiquidazione: string | null
  stato: 'anteprima' | 'confermata'
  testateLette: number; testateLiquid: number
  elencoPaesi: string; recuperataIl: string
  createdBy: string | null; updatedBy: string | null
  createdAt: string; updatedAt: string
  conteggi: Record<TipoContoApi, number>
}

export interface TipoContoRigaApi {
  matricola: string
  nominativo: string | null
  nazIban: string | null
  tipoConto: TipoContoApi
  motivo: string | null
  progressivi: string
  fonte: 'CSA' | 'manuale'
  nota: string | null
  /** Solo sulle DA CHIARIRE: la nazione dell'anagrafica, mai applicata da sola. */
  suggerimento: { nazIban: string; tipoConto: string } | null
}

/** La lettura CSA puo' durare: tre minuti invece dei trenta secondi di default. */
const TIMEOUT_CSA = 180_000

export const tipiContoApi = {
  elenco: () =>
    apiFetch<{ elaborazioni: TipoContoElabApi[] }>('/emolumenti/tipi-conto'),

  recupera: (body: { anno: number; mese: number; progrLiquidazione?: string }) =>
    apiFetch<{ id: string }>('/emolumenti/tipi-conto/recupera', {
      method: 'POST', body: JSON.stringify(body),
    }, TIMEOUT_CSA),

  leggi: (id: string) =>
    apiFetch<{ elaborazione: TipoContoElabApi; righe: TipoContoRigaApi[] }>(
      `/emolumenti/tipi-conto/${encodeURIComponent(id)}`),

  riclassifica: (id: string) =>
    apiFetch<{ ok: true }>(`/emolumenti/tipi-conto/${encodeURIComponent(id)}/riclassifica`, {
      method: 'POST', body: JSON.stringify({}),
    }, TIMEOUT_CSA),

  conferma: (id: string) =>
    apiFetch<{ ok: true }>(`/emolumenti/tipi-conto/${encodeURIComponent(id)}/conferma`, {
      method: 'POST', body: JSON.stringify({}),
    }),

  nazioneManuale: (id: string, matricola: string, body: { nazIban: string; nota: string }) =>
    apiFetch<{ ok: true; tipoConto: TipoContoApi }>(
      `/emolumenti/tipi-conto/${encodeURIComponent(id)}/righe/${encodeURIComponent(matricola)}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),

  txt: (id: string, tipo: 'IT' | 'SEPA' | 'EXTRA_UE') =>
    apiFetch<{ nomeFile: string; contenuto: string }>(
      `/emolumenti/tipi-conto/${encodeURIComponent(id)}/txt/${tipo}`),

  archivia: (id: string) =>
    apiFetch<void>(`/emolumenti/tipi-conto/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

// ── Versamenti enti (rubrica e modelli mail) ─────────────────
// Le righe della stampa versamenti NON passano di qui: si elaborano nel
// browser. Il server riceve solo codici e descrizioni degli enti.

export interface VersamentoEnteApi {
  codice:      string
  descrizione: string
  email:       string[]
  abilitato:   boolean
  modelloId:   string | null
  ultimoFile:  string | null
  ultimoVisto: string | null
}

export interface VersamentoModelloApi {
  id:          string
  nome:        string
  oggetto:     string
  testo:       string
  allegati:    import('../utils/versamentiAllegati').AllegatiConfig
  predefinito: boolean
}

export type VersamentoModelloBody = Pick<VersamentoModelloApi, 'nome' | 'oggetto' | 'testo' | 'allegati'>

export const versamentiApi = {
  enti: () =>
    apiFetch<{ enti: VersamentoEnteApi[] }>('/versamenti/enti'),

  sincronizza: (body: { file: string; enti: Array<{ codice: string; descrizione: string }> }) =>
    apiFetch<{ enti: VersamentoEnteApi[]; nuovi: string[] }>('/versamenti/enti/sincronizza', {
      method: 'POST', body: JSON.stringify(body),
    }),

  importaEnti: (body: { file: string; righe: Array<{ codice: string; descrizione: string; email: string; abilitato: boolean }> }) =>
    apiFetch<{ enti: VersamentoEnteApi[]; nuovi: string[]; aggiornati: string[]; saltati: string[]; invariati: string[] }>('/versamenti/enti/importa', {
      method: 'POST', body: JSON.stringify(body),
    }),

  aggiornaEnte: (codice: string, body: { email?: string; abilitato?: boolean; modelloId?: string | null }) =>
    apiFetch<{ ente: VersamentoEnteApi }>(`/versamenti/enti/${encodeURIComponent(codice)}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),

  modelli: () =>
    apiFetch<{ modelli: VersamentoModelloApi[] }>('/versamenti/modelli'),

  creaModello: (body: VersamentoModelloBody) =>
    apiFetch<{ modello: VersamentoModelloApi }>('/versamenti/modelli', {
      method: 'POST', body: JSON.stringify(body),
    }),

  aggiornaModello: (id: string, body: VersamentoModelloBody) =>
    apiFetch<{ modello: VersamentoModelloApi }>(`/versamenti/modelli/${encodeURIComponent(id)}`, {
      method: 'PUT', body: JSON.stringify(body),
    }),

  predefinito: (id: string) =>
    apiFetch<{ modello: VersamentoModelloApi }>(`/versamenti/modelli/${encodeURIComponent(id)}/predefinito`, {
      method: 'POST', body: JSON.stringify({}),
    }),

  eliminaModello: (id: string) =>
    apiFetch<{ entiRiportati: number }>(`/versamenti/modelli/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  eventoGenerazione: (body: { file: string; enti: string[]; eml: number; righe: number; mesi: string[]; modo: 'unico' | 'mese'; selezione?: boolean }) =>
    apiFetch<{ ok: true }>('/versamenti/eventi/generazione', {
      method: 'POST', body: JSON.stringify(body),
    }),

  /** Esportazione CSV/PDF dalla Consultazione: solo conteggi, mai nomi o codici fiscali. */
  eventoEsportazione: (body: {
    file: string; formato: 'csv' | 'pdf'; modo: 'unico' | 'ente'; enti: string[]
    righe: number; persone: number; file_generati: number; codiceFiscale: boolean
  }) =>
    apiFetch<{ ok: true }>('/versamenti/eventi/esportazione', {
      method: 'POST', body: JSON.stringify(body),
    }),
}

// ── Modulo CRAL (solo admin) ──────────────────────────────────
// Tipi del modello in components/cral/tipi.ts: qui solo le chiamate.

export interface CralAbbinamentoApi {
  i: number
  esito: 'trovato' | 'parziale' | 'ambiguo' | 'non-trovato'
  via: 'matricola' | 'nominativo' | 'nominativo e data di nascita'
  candidati: AnagraficaPgs[]
  matricolaIgnota?: string
  nascitaDiversa?: string
}
export type CralOperazioneApi =
  | { op: 'aggiorna'; socio: string; sede?: string | null; tessera?: string; atipico?: boolean; nota?: string }
  | { op: 'nuovoPgs'; matricola: string; tipo: 'SD' | 'EST'; cognome: string; nome: string; nascita: string | null; email: string; sede: string | null; tessera: string; atipico: boolean; nota: string }
  | { op: 'nuovoEsterno'; tipo: 'SE' | 'EST'; cognome: string; nome: string; nascita: string | null; email: string; sede: string | null; tessera: string; atipico: boolean; nota: string }
  | { op: 'cessa'; socio: string; nota?: string }
export interface CralRigaT6 {
  socio: string; riga: number
  valori: { sede?: string | null; nascita?: string | null; email?: string | null; tessera?: string | null; note?: string | null; tipo?: 'SD' | 'SE' | 'EST'; stato?: 'ATTIVO' | 'CESSATO' | 'ELIMINATO'; dataStato?: string }
}
/** Riga del T7 (quote versate): importi in centesimi, 'X' = la rata (o la quota dell'anno per l'unica soluzione). */
export interface CralRigaT7 {
  socio: string; riga: number; anno: number; modo?: 'UNICA' | 'MENSILE' | 'TRATTENUTA'
  mesi?: Record<string, number | 'X'>; unica?: { importo: number | 'X'; data?: string }; note?: string
}
export interface CralNuovaPersonaApi {
  tipo: 'SD' | 'SE' | 'EST' | 'FAM'; matricola?: string; cognome?: string; nome?: string; nascita?: string | null
  email?: string; sede?: string | null; tessera?: string; note?: string; legami?: Legame[]; perIniziativa?: string
}
export type CralIniziativaBody = Pick<Iniziativa, 'tipo' | 'titolo' | 'anno' | 'data' | 'scadenza' | 'stato' | 'modalita' | 'modoPart' | 'gruppi' | 'sedi' | 'predefinita' | 'fornitore' | 'pagamento' | 'note' | 'quota'> & {
  config: Pick<Iniziativa, 'opzioni' | 'prodotti' | 'periodi' | 'articoli' | 'sconti'>
}

const corpo = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) })
const enc = encodeURIComponent

export const cralApi = {
  stato: () => apiFetch<StatoApi>('/cral/stato'),
  anagrafica: (q: string) => apiFetch<{ risultati: AnagraficaPgs[] }>(`/cral/anagrafica?q=${enc(q)}`),
  leggiFile: (nome: string, base64: string) =>
    apiFetch<{ fogli: Record<string, string[][]> }>('/cral/file/leggi', corpo('POST', { nome, base64 }), 60_000),
  abbina: (righe: Array<{ i: number; nominativo: string; matricola?: string; nascita?: string }>) =>
    apiFetch<{ esiti: CralAbbinamentoApi[] }>('/cral/import/abbina', corpo('POST', { righe }), 60_000),
  confermaImport: (file: string, operazioni: CralOperazioneApi[]) =>
    apiFetch<{ esito: { nuoviPgs: number; nuoviEsterni: number; aggiornati: number; tessere: number; cessati: number } }>(
      '/cral/import/conferma', corpo('POST', { file, operazioni }), 60_000),

  creaSede: (nome: string) => apiFetch<{ sede: Sede }>('/cral/sedi', corpo('POST', { nome })),
  aggiornaSede: (id: string, p: { nome?: string; attiva?: boolean }) => apiFetch<{ sede: Sede }>(`/cral/sedi/${enc(id)}`, corpo('PATCH', p)),
  creaTipo: (t: { nome: string; colore: string; pagamento: boolean }) => apiFetch<{ tipo: TipoEvento }>('/cral/tipi', corpo('POST', t)),
  aggiornaTipo: (id: string, p: { nome?: string; colore?: string; pagamento?: boolean; attivo?: boolean }) =>
    apiFetch<{ tipo: TipoEvento }>(`/cral/tipi/${enc(id)}`, corpo('PATCH', p)),
  creaTipologia: (nome: string) => apiFetch<{ tipologia: Tipologia }>('/cral/tipologie', corpo('POST', { nome })),
  aggiornaTipologia: (id: string, p: { nome?: string; attiva?: boolean }) =>
    apiFetch<{ tipologia: Tipologia }>(`/cral/tipologie/${enc(id)}`, corpo('PATCH', p)),
  salvaTessera: (t: ParametriTessera) => apiFetch<unknown>('/cral/parametri/tessera', corpo('PUT', t)),

  creaPersona: (p: CralNuovaPersonaApi) => apiFetch<{ socio: Persona }>('/cral/soci', corpo('POST', p)),
  modificaPersona: (id: string, p: Partial<Pick<Persona, 'cognome' | 'nome' | 'nascita' | 'email' | 'sede' | 'tessera' | 'note' | 'atipico'>> & { tipo?: 'SD' | 'SE' | 'EST' }) =>
    apiFetch<{ socio: Persona }>(`/cral/soci/${enc(id)}`, corpo('PATCH', p)),
  legami: (id: string, legami: Legame[]) => apiFetch<{ socio: Persona }>(`/cral/soci/${enc(id)}/legami`, corpo('PUT', { legami })),
  cambiaStato: (ids: string[], azione: 'valida' | 'rifiuta' | 'rimetti' | 'cessa' | 'riattiva' | 'elimina' | 'ripristina') =>
    apiFetch<{ fatte: number }>('/cral/soci/stato', corpo('POST', { ids, azione })),
  tipologia: (ids: string[], tipo: 'SD' | 'SE' | 'EST') => apiFetch<{ fatte: number }>('/cral/soci/tipologia', corpo('POST', { ids, tipo })),
  passaEsterno: (id: string) => apiFetch<{ socio: Persona }>(`/cral/soci/${enc(id)}/passa-esterno`, corpo('POST', {})),
  esportaSoci: (ids: string[]) => apiFetch<{ ambiente: string; base64: string }>('/cral/export/soci', corpo('POST', { ids }), 60_000),
  esportaArchivio: (sezioni: SezioneLotto[]) => apiFetch<ArchivioTestata>(`/cral/export/archivio?sezioni=${enc(sezioni.join(','))}`, undefined, 120_000),
  lotti: () => apiFetch<{ lotti: Lotto[] }>('/cral/lotti'),
  lotto: (id: string) => apiFetch<{ lotto: Lotto; variazioni: Variazione[] }>(`/cral/lotti/${enc(id)}`, undefined, 60_000),
  lottoArchivio: (file: string, sezioni: SezioneLotto[], archivio: unknown) =>
    apiFetch<{ id: string; variazioni: number }>('/cral/lotti/archivio', corpo('POST', { file, sezioni, archivio }), 180_000),
  lottoT7: (file: string, righe: CralRigaT7[]) => apiFetch<{ id: string | null; variazioni: number }>('/cral/lotti/t7', corpo('POST', { file, righe }), 120_000),
  esportaQuote: (anno: number, ids: string[]) => apiFetch<{ ambiente: string; base64: string }>('/cral/export/quote', corpo('POST', { anno, ids }), 60_000),
  lottoT6: (file: string, righe: CralRigaT6[]) => apiFetch<{ id: string | null; variazioni: number }>('/cral/lotti/t6', corpo('POST', { file, righe }), 120_000),
  decidi: (id: string, b: { voci?: Array<{ id: number; esito: 'ACCETTATA' | 'SCARTATA' | 'ATTESA'; accettati?: string[] }>; sezione?: SezioneLotto; azione?: 'accettaTutte' | 'scartaTutte' | 'azzera' }) =>
    apiFetch<{ fatte: number }>(`/cral/lotti/${enc(id)}`, corpo('PATCH', b), 60_000),
  applicaLotto: (id: string) => apiFetch<{ esito: { applicate: number; errori: number; campiSaltati: number; chiuso: boolean } }>(`/cral/lotti/${enc(id)}/applica`, corpo('POST', {}), 300_000),
  scartaLotto: (id: string) => apiFetch<{ ok: true }>(`/cral/lotti/${enc(id)}/scarta`, corpo('POST', {})),
  riammetti: (id: string) => apiFetch<{ socio: Persona }>(`/cral/soci/${enc(id)}/riammetti`, corpo('POST', {})),
  collega: (id: string, matricola: string) => apiFetch<{ socio: Persona }>(`/cral/soci/${enc(id)}/collega`, corpo('POST', { matricola })),
  sposta: (ids: string[], sede: string | null) => apiFetch<{ fatte: number }>('/cral/soci/sposta', corpo('POST', { ids, sede })),

  creaIniziativa: (b: CralIniziativaBody) => apiFetch<{ iniziativa: { id: string } }>('/cral/iniziative', corpo('POST', b)),
  salvaIniziativa: (id: string, b: CralIniziativaBody) => apiFetch<{ iniziativa: { id: string } }>(`/cral/iniziative/${enc(id)}`, corpo('PUT', b)),
  archivia: (id: string, archiviata: boolean) => apiFetch<{ ok: true }>(`/cral/iniziative/${enc(id)}/archivia`, corpo('POST', { archiviata })),
  partecipanti: (id: string, aggiungi: string[], togli: string[] = []) =>
    apiFetch<{ fatte: number }>(`/cral/iniziative/${enc(id)}/partecipanti`, corpo('POST', { aggiungi, togli })),
  scelta: (id: string, socio: string, dati: PatchScelta, fonte: 'manuale' | 'modulo' | 'predefinita' = 'manuale') =>
    apiFetch<{ dati: Record<string, unknown> }>(`/cral/iniziative/${enc(id)}/scelte/${enc(socio)}`, corpo('PATCH', { dati, fonte })),
  scelteInBlocco: (id: string, voci: Array<{ socio: string; dati: PatchScelta; sostituisci?: boolean }>, fonte: 'manuale' | 'modulo' | 'predefinita') =>
    apiFetch<{ fatte: number }>(`/cral/iniziative/${enc(id)}/scelte`, corpo('POST', { voci, fonte }), 60_000),
  carico: (id: string, c: Omit<Carico, 'id'>) => apiFetch<{ carico: Carico }>(`/cral/iniziative/${enc(id)}/carichi`, corpo('POST', c)),
  richiesta: (id: string, r: Pick<Richiesta, 'persona' | 'art' | 'qta' | 'dataRich' | 'modo' | 'note'>) =>
    apiFetch<{ richiesta: Richiesta }>(`/cral/iniziative/${enc(id)}/richieste`, corpo('POST', r)),
  aggiornaRichiesta: (id: string, rid: string, p: { stato?: Richiesta['stato']; dataCons?: string | null; modo?: Richiesta['modo']; pagato?: boolean; sconto?: ScontoPers | null; note?: string }) =>
    apiFetch<{ richiesta: Richiesta }>(`/cral/iniziative/${enc(id)}/richieste/${enc(rid)}`, corpo('PATCH', p)),

  quotaAnno: (anno: number, importo: number) => apiFetch<{ ok: true }>(`/cral/quote-anno/${anno}`, corpo('PUT', { importo })),
  quota: (anno: number, socio: string, p: Partial<QuotaSocio>) =>
    apiFetch<{ quota: QuotaSocio }>(`/cral/quote/${anno}/${enc(socio)}`, corpo('PATCH', p)),
  trattenuta: (anno: number, mese: number, soci: string[]) =>
    apiFetch<{ fatte: number }>(`/cral/quote/${anno}/trattenuta`, corpo('POST', { mese, soci })),
}
