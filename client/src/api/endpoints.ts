// ============================================================
// PAYROLL GANG SUITE — API Endpoints tipizzati
// ============================================================

import { apiFetch } from './client'
import type { AppSettings } from '../types'

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
  login: (username: string, token: string) =>
    apiFetch<{ accessToken: string; user: UserApi }>('/auth/login', {
      method: 'POST',
      body:   JSON.stringify({ username, token }),
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
  activate: (activationToken: string, otpToken: string) =>
    apiFetch<{ success: boolean }>('/auth/activate', {
      method: 'POST',
      body:   JSON.stringify({ activationToken, token: otpToken }),
    }),
}

// ── Utenti (admin only) ───────────────────────────────────────

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

export const bozzeApi = {
  list: () =>
    apiFetch<BozzaApi[]>('/bozze'),

  /**
   * FIX H-1: recupera una bozza completa (con campo `dati`) via GET /bozze/:id.
   * Usata da RicercaPage dopo la lista summary, e dall'editor/viewer per caricare i dati.
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

  archive: (id: string) =>
    apiFetch<BozzaApi>(`/bozze/${id}/archive`, { method: 'POST' }),

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
  list: () =>
    apiFetch<AnagraficaApi[]>('/anagrafiche'),

  importXml: (xml: string, dataAggiornamento?: string) =>
    apiFetch<ImportResult>('/anagrafiche/import', {
      method: 'POST',
      body:   JSON.stringify({ xml, ...(dataAggiornamento ? { dataAggiornamento } : {}) }),
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

// ── Settings ─────────────────────────────────────────────────

export const settingsApi = {
  get: () =>
    apiFetch<AppSettings>('/settings'),

  update: (settings: Partial<AppSettings>) =>
    apiFetch<AppSettings>('/settings', {
      method: 'PUT',
      body:   JSON.stringify(settings),
    }),
}
