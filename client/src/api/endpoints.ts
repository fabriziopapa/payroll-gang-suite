// ============================================================
// PAYROLL GANG SUITE — API Endpoints tipizzati
// ============================================================

import { apiFetch } from './client'
import type { AppSettings, VoceConfig } from '../types'

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
  /** ID liquidazione CSA, es. "1ND001950001220240442801" — facoltativo */
  idLiquidazioneCsa:  string | null
  createdBy:          string | null
  createdByUsername:  string | null
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

export const certificatiApi = {
  /** Estrae i dati dal PDF (base64). Nessuna persistenza. */
  parse: (pdfBase64: string) =>
    apiFetch<CedolinoParsedApi>('/certificati/parse', {
      method: 'POST',
      body:   JSON.stringify({ pdf: pdfBase64 }),
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
