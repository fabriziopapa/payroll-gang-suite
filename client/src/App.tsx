// ============================================================
// PAYROLL GANG SUITE — App Root
// Auth gate + routing basato su stato Zustand
// ============================================================

import { useEffect } from 'react'
import { useStore } from './store/useStore'
import { setAccessToken, setOnUnauthorized } from './api/client'
import { authApi, settingsApi } from './api/endpoints'
import { DEFAULT_CSV_PARAMS, TAG_BUILTIN } from './constants/csvDefaults'
import { DEFAULT_COEFFICIENTI_SCORPORO } from './constants/scorporoCoefficients'
import type { AppSettings } from './types'

// ── Pages ────────────────────────────────────────────────────
import LoginPage          from './pages/LoginPage'
import Layout             from './components/Layout'
import DashboardPage      from './pages/DashboardPage'
import EditorPage         from './pages/EditorPage'
import AnagrafichePage    from './pages/AnagrafichePage'
import VociPage           from './pages/VociPage'
import CapitoliPage       from './pages/CapitoliPage'
import ImpostazioniPage   from './pages/ImpostazioniPage'
import GestioneUtentiPage from './pages/GestioneUtentiPage'

export default function App() {
  const {
    currentPage,
    bootstrapDone,
    setAuth,
    clearAuth,
    setBootstrap,
    setSettings,
  } = useStore()

  // ── 1. Registra callback per sessioni scadute ─────────────
  useEffect(() => {
    setOnUnauthorized(() => clearAuth())
  }, [clearAuth])

  // ── 2. Tenta ripristino sessione via refresh cookie ───────
  useEffect(() => {
    async function tryRestore() {
      try {
        // Chiama /auth/refresh — usa l'HttpOnly cookie automaticamente
        const res = await fetch('/api/v1/auth/refresh', {
          method:      'POST',
          credentials: 'include',
        })
        if (!res.ok) {
          setBootstrap(true)
          return
        }
        const { accessToken } = await res.json() as { accessToken: string }
        setAccessToken(accessToken)

        const { user } = await authApi.me()
        setAuth(user, accessToken)
      } catch (err) {
        if (err instanceof TypeError) console.warn('Bootstrap: network unavailable', err)
        setBootstrap(true)
      }
    }
    tryRestore()
  }, [setBootstrap, setAuth])

  // ── 3. Carica settings quando l'utente è autenticato ─────
  useEffect(() => {
    if (currentPage === 'login') return
    settingsApi.get()
      .then(s => {
        // Il server restituisce Record<string,unknown> — cast e deep merge
        const raw = s as unknown as Record<string, unknown>
        setSettings({
          coefficienti:         { ...DEFAULT_COEFFICIENTI_SCORPORO, ...((raw?.coefficienti ?? {}) as object) },
          csvDefaults:          { ...DEFAULT_CSV_PARAMS,             ...((raw?.csvDefaults  ?? {}) as object) },
          tags:                 Array.isArray(raw?.tags) && (raw.tags as unknown[]).length
            ? (raw.tags as AppSettings['tags'])
            : TAG_BUILTIN.map(p => ({ prefisso: p, builtin: true })),
          rubrica:              Array.isArray(raw?.rubrica)              ? (raw.rubrica              as AppSettings['rubrica'])              : [],
          modelliComunicazione: Array.isArray(raw?.modelliComunicazione) ? (raw.modelliComunicazione as AppSettings['modelliComunicazione']) : [],
        })
      })
      .catch(() => { /* usa defaults locali già nello store */ })
  }, [currentPage, setSettings])

  // ── Splash screen mentre bootstrap ───────────────────────
  if (!bootstrapDone) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin w-8 h-8 text-indigo-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <p className="text-slate-500 text-sm">Payroll Gang Suite</p>
        </div>
      </div>
    )
  }

  // ── Login ─────────────────────────────────────────────────
  if (currentPage === 'login') return <LoginPage />

  // ── App autenticata ───────────────────────────────────────
  return (
    <Layout>
      {currentPage === 'dashboard'    && <DashboardPage />}
      {currentPage === 'editor'       && <EditorPage />}
      {currentPage === 'anagrafiche'  && <AnagrafichePage />}
      {currentPage === 'voci'         && <VociPage />}
      {currentPage === 'capitoli'     && <CapitoliPage />}
      {currentPage === 'impostazioni' && <ImpostazioniPage />}
      {currentPage === 'utenti'       && <GestioneUtentiPage />}
    </Layout>
  )
}
