// ============================================================
// PAYROLL GANG SUITE — Zustand Store (v5 + immer)
// Stato globale: auth, editor, dati DB, UI
// ============================================================

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type {
  Nominativo,
  DettaglioLiquidazione,
  AppSettings,
  Comunicazione,
} from '../types'
import type { UserApi, AnagraficaApi, VoceApi, BozzaApi, CapitoloAnagApi } from '../api/endpoints'
import { DEFAULT_COEFFICIENTI_SCORPORO } from '../constants/scorporoCoefficients'
import { DEFAULT_CSV_PARAMS, PALETTE_DETTAGLIO, TAG_BUILTIN } from '../constants/csvDefaults'
import { setAccessToken } from '../api/client'

// ── Tipi ─────────────────────────────────────────────────────

export type PageId =
  | 'login'
  | 'dashboard'
  | 'editor'
  | 'anagrafiche'
  | 'voci'
  | 'capitoli'
  | 'impostazioni'
  | 'utenti'

/** Struttura salvata nel campo `dati` JSONB della bozza */
export interface BozzaDati {
  nominativi:        Nominativo[]
  dettagli:          DettaglioLiquidazione[]
  protocolloDisplay: string
  comunicazioni:     Comunicazione[]
}

// ── Impostazioni default ──────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings = {
  coefficienti:         DEFAULT_COEFFICIENTI_SCORPORO,
  csvDefaults:          DEFAULT_CSV_PARAMS,
  tags:                 TAG_BUILTIN.map(p => ({ prefisso: p, builtin: true })),
  rubrica:              [],
  modelliComunicazione: [],
}

// ── Helpers ───────────────────────────────────────────────────

const uid = (): string => crypto.randomUUID()

const nextDetColor = (dettagli: DettaglioLiquidazione[]): string =>
  PALETTE_DETTAGLIO[dettagli.length % PALETTE_DETTAGLIO.length] as string

// ── Store Interface ───────────────────────────────────────────

interface AppStore {
  // ── Auth
  user:           UserApi | null
  accessToken:    string | null
  bootstrapDone:  boolean   // true dopo il tentativo di restore sessione

  // ── Navigazione
  currentPage: PageId

  // ── Editor — sessione corrente
  currentBozzaId:    string | null
  currentBozzaNome:  string
  nominativi:        Nominativo[]
  dettagli:          DettaglioLiquidazione[]
  comunicazioni:     Comunicazione[]
  protocolloDisplay: string
  isDirty:           boolean

  // ── Dati da DB
  bozze:        BozzaApi[]
  anagrafiche:  AnagraficaApi[]
  voci:         VoceApi[]
  capitoliAnag: CapitoloAnagApi[]

  // ── Impostazioni
  settings: AppSettings

  // ── UI
  isLoading:   boolean
  globalError: string | null

  // ── Actions Auth
  setAuth:        (user: UserApi, token: string) => void
  clearAuth:      () => void
  setBootstrap:   (done: boolean) => void

  // ── Actions Navigazione
  navigate: (page: PageId) => void

  // ── Actions Editor
  newLiquidazione:   (nome?: string) => void
  loadBozzaInEditor: (bozza: BozzaApi) => void
  addNominativo:     (data: Omit<Nominativo, 'id'>) => string
  updateNominativo:  (id: string, updates: Partial<Nominativo>) => void
  removeNominativo:  (id: string) => void
  addDettaglio:      (partial?: Partial<Omit<DettaglioLiquidazione, 'id' | 'colore'>>) => string
  updateDettaglio:   (id: string, updates: Partial<DettaglioLiquidazione>) => void
  removeDettaglio:   (id: string) => void
  setProtocolloDisplay: (p: string) => void
  setCurrentBozzaNome:  (nome: string) => void
  markSaved:         (bozzaId: string) => void

  // ── Actions Comunicazioni
  addComunicazione:    (data: Omit<Comunicazione, 'id' | 'createdAt' | 'updatedAt'>) => string
  updateComunicazione: (id: string, updates: Partial<Comunicazione>) => void
  removeComunicazione: (id: string) => void

  // ── Actions Data
  setBozze:         (bozze: BozzaApi[]) => void
  upsertBozza:      (bozza: BozzaApi) => void
  removeBozza:      (id: string) => void
  setAnagrafiche:   (items: AnagraficaApi[]) => void
  setVoci:          (items: VoceApi[]) => void
  setCapitoliAnag:  (items: CapitoloAnagApi[]) => void
  setSettings:      (s: AppSettings) => void

  // ── Actions UI
  setLoading:     (v: boolean) => void
  setGlobalError: (e: string | null) => void
}

// ── Store ─────────────────────────────────────────────────────

export const useStore = create<AppStore>()(
  immer((set, get) => ({
    // ── Stato iniziale ───────────────────────────────────────
    user:              null,
    accessToken:       null,
    bootstrapDone:     false,
    currentPage:       'login',
    currentBozzaId:    null,
    currentBozzaNome:  '',
    nominativi:        [],
    dettagli:          [],
    comunicazioni:     [],
    protocolloDisplay: '',
    isDirty:           false,
    bozze:             [],
    anagrafiche:       [],
    voci:              [],
    capitoliAnag:      [],
    settings:          DEFAULT_SETTINGS,
    isLoading:         false,
    globalError:       null,

    // ── Auth ─────────────────────────────────────────────────
    setAuth: (user, token) => {
      setAccessToken(token)
      set(s => {
        s.user         = user
        s.accessToken  = token
        s.currentPage  = 'dashboard'
        s.bootstrapDone = true
      })
    },

    clearAuth: () => {
      setAccessToken(null)
      set(s => {
        s.user            = null
        s.accessToken     = null
        s.currentPage     = 'login'
        s.currentBozzaId  = null
        s.nominativi      = []
        s.dettagli        = []
        s.bozze           = []
        s.bootstrapDone   = true
      })
    },

    setBootstrap: (done) => set(s => { s.bootstrapDone = done }),

    // ── Navigazione ──────────────────────────────────────────
    navigate: (page) => set(s => { s.currentPage = page }),

    // ── Editor ───────────────────────────────────────────────
    newLiquidazione: (nome) =>
      set(s => {
        s.currentBozzaId    = null
        s.currentBozzaNome  = nome ?? `Liquidazione ${new Date().toLocaleDateString('it-IT')}`
        s.nominativi        = []
        s.dettagli          = []
        s.comunicazioni     = []
        s.protocolloDisplay = ''
        s.isDirty           = false
        s.currentPage       = 'editor'
      }),

    loadBozzaInEditor: (bozza) => {
      const dati = (bozza.dati ?? {}) as Partial<BozzaDati>
      set(s => {
        s.currentBozzaId    = bozza.id
        s.currentBozzaNome  = bozza.nome
        s.nominativi        = dati.nominativi    ?? []
        s.dettagli          = dati.dettagli      ?? []
        s.comunicazioni     = dati.comunicazioni ?? []
        s.protocolloDisplay = dati.protocolloDisplay ?? bozza.protocolloDisplay ?? ''
        s.isDirty           = false
        s.currentPage       = 'editor'
      })
    },

    addNominativo: (data) => {
      const id = uid()
      set(s => { s.nominativi.push({ ...data, id }); s.isDirty = true })
      return id
    },

    updateNominativo: (id, updates) =>
      set(s => {
        const idx = s.nominativi.findIndex(n => n.id === id)
        if (idx >= 0) { Object.assign(s.nominativi[idx]!, updates); s.isDirty = true }
      }),

    removeNominativo: (id) =>
      set(s => { s.nominativi = s.nominativi.filter(n => n.id !== id); s.isDirty = true }),

    addDettaglio: (partial) => {
      const id = uid()
      const { settings, dettagli } = get()
      const csv = settings.csvDefaults
      const det: DettaglioLiquidazione = {
        id,
        colore:                      nextDetColor(dettagli),
        nomeDescrittivo:             partial?.nomeDescrittivo             ?? '',
        voce:                        partial?.voce                        ?? '',
        capitolo:                    partial?.capitolo                    ?? '',
        competenzaLiquidazione:      partial?.competenzaLiquidazione      ?? '',
        dataCompetenzaVoce:          partial?.dataCompetenzaVoce          ?? '',
        flagScorporo:                partial?.flagScorporo                ?? false,
        riferimentoCedolino:         partial?.riferimentoCedolino         ?? '',
        identificativoProvvedimento: partial?.identificativoProvvedimento ?? '000000000',
        tipoProvvedimento:           partial?.tipoProvvedimento           ?? csv.tipoProvvedimento,
        numeroProvvedimento:         partial?.numeroProvvedimento         ?? '',
        dataProvvedimento:           partial?.dataProvvedimento           ?? '',
        aliquota:                    partial?.aliquota                    ?? csv.aliquota,
        parti:                       partial?.parti                       ?? csv.parti,
        flagAdempimenti:             partial?.flagAdempimenti             ?? csv.flagAdempimenti,
        idContrattoCSA:              partial?.idContrattoCSA              ?? csv.idContrattoCSA,
        centroCosto:                 partial?.centroCosto                 ?? '',
        note:                        partial?.note                        ?? '',
      }
      set(s => { s.dettagli.push(det); s.isDirty = true })
      return id
    },

    updateDettaglio: (id, updates) =>
      set(s => {
        const idx = s.dettagli.findIndex(d => d.id === id)
        if (idx >= 0) {
          Object.assign(s.dettagli[idx]!, { ...updates, modifiedBy: s.user?.username ?? undefined })
          s.isDirty = true
        }
      }),

    removeDettaglio: (id) =>
      set(s => {
        s.dettagli   = s.dettagli.filter(d => d.id !== id)
        s.nominativi = s.nominativi.filter(n => n.dettaglioId !== id)
        s.isDirty    = true
      }),

    setProtocolloDisplay: (p) =>
      set(s => { s.protocolloDisplay = p; s.isDirty = true }),

    setCurrentBozzaNome: (nome) =>
      set(s => { s.currentBozzaNome = nome; s.isDirty = true }),

    markSaved: (bozzaId) =>
      set(s => { s.currentBozzaId = bozzaId; s.isDirty = false }),

    // ── Comunicazioni ────────────────────────────────────────
    addComunicazione: (data) => {
      const id  = uid()
      const now = new Date().toISOString()
      set(s => {
        s.comunicazioni.push({ ...data, id, createdAt: now, updatedAt: now })
        s.isDirty = true
      })
      return id
    },

    updateComunicazione: (id, updates) =>
      set(s => {
        const idx = s.comunicazioni.findIndex(c => c.id === id)
        if (idx >= 0) {
          Object.assign(s.comunicazioni[idx]!, { ...updates, updatedAt: new Date().toISOString() })
          s.isDirty = true
        }
      }),

    removeComunicazione: (id) =>
      set(s => {
        s.comunicazioni = s.comunicazioni.filter(c => c.id !== id)
        s.isDirty = true
      }),

    // ── Data ─────────────────────────────────────────────────
    setBozze:        (bozze)  => set(s => { s.bozze = bozze }),
    setAnagrafiche:  (items)  => set(s => { s.anagrafiche = items }),
    setVoci:         (items)  => set(s => { s.voci = items }),
    setCapitoliAnag: (items)  => set(s => { s.capitoliAnag = items }),
    setSettings:     (cfg)    => set(s => { s.settings = cfg }),

    upsertBozza: (bozza) =>
      set(s => {
        const idx = s.bozze.findIndex(b => b.id === bozza.id)
        if (idx >= 0) s.bozze[idx] = bozza
        else s.bozze.unshift(bozza)
      }),

    removeBozza: (id) =>
      set(s => { s.bozze = s.bozze.filter(b => b.id !== id) }),

    // ── UI ───────────────────────────────────────────────────
    setLoading:     (v) => set(s => { s.isLoading   = v }),
    setGlobalError: (e) => set(s => { s.globalError = e }),
  })),
)
