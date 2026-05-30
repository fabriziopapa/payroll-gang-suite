// ============================================================
// PAYROLL GANG SUITE — App Root
// Auth gate + routing basato su stato Zustand
// ============================================================

import { useEffect, useRef } from 'react'
import { useStore } from './store/useStore'
import { setAccessToken, setOnUnauthorized } from './api/client'
import { settingsApi } from './api/endpoints'
import { showToast } from './components/ToastManager'
import type { UserApi } from './api/endpoints'

// Bootstrap: numero massimo di retry automatici su 429 prima di arrendersi
const MAX_BOOTSTRAP_RETRIES = 5
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
import ViewerPage         from './pages/ViewerPage'
import RicercaPage        from './pages/RicercaPage'

export default function App() {
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryCountRef = useRef(0)

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
    // Pianifica un nuovo tentativo dopo un throttling 429 (NON è sessione scaduta)
    function scheduleThrottleRetry(retryAfterRaw: string | null): void {
      setBootstrap(true)  // sblocca la UI — l'utente non resta sullo splash
      if (retryCountRef.current >= MAX_BOOTSTRAP_RETRIES) {
        showToast('Server sovraccarico. Riprova manualmente tra qualche minuto.', 'error')
        return
      }
      retryCountRef.current += 1
      const parsed = retryAfterRaw ? parseInt(retryAfterRaw, 10) : NaN
      const wait   = Number.isFinite(parsed) && parsed > 0 ? parsed : 60
      showToast(`Troppe richieste al server. Nuovo tentativo tra ${wait}s.`, 'warning')
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null
        void tryRestore()
      }, wait * 1000)
    }

    async function tryRestore(): Promise<void> {
      // Annulla eventuale retry pendente (StrictMode double-invoke / retry concorrente)
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
      try {
        const res = await fetch('/api/v1/auth/refresh', {
          method:      'POST',
          credentials: 'include',
        })

        // 429: rate limit — sessione probabilmente ancora valida → retry, NON logout.
        // fetch raw NON lancia su 429: va intercettato sullo status, non in catch.
        if (res.status === 429) {
          scheduleThrottleRetry(res.headers.get('Retry-After'))
          return
        }
        // 5xx: problema server transitorio → non buttare fuori l'utente
        if (res.status >= 500) {
          setBootstrap(true)
          showToast('Errore server temporaneo. Ricarica la pagina.', 'error')
          return
        }
        // 401/altro non-ok: nessuna sessione valida → login (comportamento corretto)
        if (!res.ok) {
          setBootstrap(true)
          return
        }

        // /refresh restituisce anche user — nessuna chiamata extra a /auth/me
        const { accessToken, user } = await res.json() as { accessToken: string; user: UserApi }
        retryCountRef.current = 0
        setAccessToken(accessToken)
        setAuth(user, accessToken)
      } catch (err) {
        // fetch raw lancia solo su errore di rete (TypeError) o abort
        if (err instanceof TypeError) console.warn('Bootstrap: network unavailable', err)
        setBootstrap(true)
      }
    }

    void tryRestore()

    // Cleanup: evita retry e setState dopo unmount
    return () => {
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
    }
  }, [setBootstrap, setAuth])

  // ── 3. Carica settings quando l'utente è autenticato ─────
  useEffect(() => {
    if (currentPage === 'login') return
    settingsApi.get()
      .then(s => {
        // Il server restituisce Record<string,unknown> — cast e deep merge
        const raw = s as unknown as Record<string, unknown>
        setSettings({
          coefficienti:            { ...DEFAULT_COEFFICIENTI_SCORPORO, ...((raw?.coefficienti ?? {}) as object) },
          coefficientiContoTerzi:  (raw?.coefficientiContoTerzi && typeof raw.coefficientiContoTerzi === 'object')
            ? (raw.coefficientiContoTerzi as AppSettings['coefficientiContoTerzi'])
            : {},
          csvDefaults:             { ...DEFAULT_CSV_PARAMS, ...((raw?.csvDefaults ?? {}) as object) },
          tags:                    Array.isArray(raw?.tags) && (raw.tags as unknown[]).length
            ? (raw.tags as AppSettings['tags'])
            : TAG_BUILTIN.map(p => ({ prefisso: p, builtin: true })),
          rubrica:              Array.isArray(raw?.rubrica)              ? (raw.rubrica              as AppSettings['rubrica'])              : [],
          modelliComunicazione: Array.isArray(raw?.modelliComunicazione) ? (raw.modelliComunicazione as AppSettings['modelliComunicazione']) : [],
          turnstileEnabled:     typeof raw?.turnstileEnabled === 'boolean' ? raw.turnstileEnabled : true,
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
      {currentPage === 'viewer'       && <ViewerPage />}
      {currentPage === 'ricerca'      && <RicercaPage />}
    </Layout>
  )
}
