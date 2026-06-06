// ============================================================
// PAYROLL GANG SUITE — App Root
// Auth gate + routing basato su stato Zustand
// ============================================================

import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { useStore } from './store/useStore'
import { setAccessToken, setOnUnauthorized } from './api/client'
import { settingsApi } from './api/endpoints'
import { showToast } from './components/ToastManager'
import type { UserApi } from './api/endpoints'
import { DEFAULT_CSV_PARAMS, TAG_BUILTIN } from './constants/csvDefaults'
import { DEFAULT_COEFFICIENTI_SCORPORO } from './constants/scorporoCoefficients'
import type { AppSettings } from './types'

// Bootstrap: numero massimo di retry automatici su 429 prima di fermarsi
// (oltre il cap resta l'avviso con retry manuale, mai redirect login)
const MAX_BOOTSTRAP_RETRIES = 5

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
import CertificatiPage    from './pages/CertificatiPage'
import CertificatiTemplatePage from './pages/CertificatiTemplatePage'
import PdfRegionTemplatesPage from './pages/PdfRegionTemplatesPage'

// Lazy: unica pagina che porta pdfjs-dist (canvas rendering, Step 7/usePdfDocument)
// — code-split dedicato, niente nel bundle principale finché un admin non apre
// lo strumento di disegno regioni (uso saltuario, costo di caricamento accettabile).
const PdfRegionEditorPage = lazy(() => import('./pages/PdfRegionEditorPage'))

function PdfEditorLoadingFallback() {
  return (
    <div className="p-10 flex items-center justify-center">
      <svg className="animate-spin w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
      </svg>
    </div>
  )
}

// Stato throttling bootstrap: null = nessun throttle in corso
interface ThrottleState {
  remaining: number   // secondi al prossimo tentativo automatico
  capped:    boolean  // true = esauriti i retry automatici (solo retry manuale)
}

export default function App() {
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>  | null>(null)
  const countdownRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const retryCountRef = useRef(0)
  const tryRestoreRef = useRef<() => void>(() => {})

  const [throttle, setThrottle] = useState<ThrottleState | null>(null)

  const {
    user,
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
    function clearTimers(): void {
      if (retryTimerRef.current !== null) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null }
      if (countdownRef.current  !== null) { clearInterval(countdownRef.current); countdownRef.current  = null }
    }

    // 429: throttling temporaneo — NON è sessione scaduta.
    // Mostra avviso dedicato (mai login) con countdown + retry automatico.
    function startThrottle(retryAfterRaw: string | null): void {
      setBootstrap(true)  // sblocca lo splash; il gate di render mostra l'avviso
      clearTimers()

      const parsed = retryAfterRaw ? parseInt(retryAfterRaw, 10) : NaN
      const wait   = Number.isFinite(parsed) && parsed > 0 ? parsed : 60

      retryCountRef.current += 1
      const capped = retryCountRef.current > MAX_BOOTSTRAP_RETRIES
      setThrottle({ remaining: wait, capped })
      if (capped) return  // niente più auto-retry: resta avviso + bottone manuale

      const deadline = Date.now() + wait * 1000
      countdownRef.current = setInterval(() => {
        const rem = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
        setThrottle({ remaining: rem, capped: false })
      }, 1000)
      retryTimerRef.current = setTimeout(() => { clearTimers(); void tryRestore() }, wait * 1000)
    }

    async function tryRestore(): Promise<void> {
      clearTimers()  // annulla retry/countdown pendenti (StrictMode / retry concorrente)
      try {
        const res = await fetch('/api/v1/auth/refresh', {
          method:      'POST',
          credentials: 'include',
        })

        // 429: rate limit — avviso dedicato + retry, MAI login.
        // fetch raw NON lancia su 429: va intercettato sullo status.
        if (res.status === 429) {
          startThrottle(res.headers.get('Retry-After'))
          return
        }
        // 5xx: problema server transitorio → non buttare fuori l'utente
        if (res.status >= 500) {
          setThrottle(null)
          setBootstrap(true)
          showToast('Errore server temporaneo. Ricarica la pagina.', 'error')
          return
        }
        // 401/altro non-ok: nessuna sessione valida → login (comportamento corretto)
        if (!res.ok) {
          setThrottle(null)
          setBootstrap(true)
          return
        }

        // /refresh restituisce anche user — nessuna chiamata extra a /auth/me
        const { accessToken, user } = await res.json() as { accessToken: string; user: UserApi }
        retryCountRef.current = 0
        setThrottle(null)
        setAccessToken(accessToken)
        setAuth(user, accessToken)
      } catch (err) {
        // fetch raw lancia solo su errore di rete (TypeError) o abort
        if (err instanceof TypeError) console.warn('Bootstrap: network unavailable', err)
        setThrottle(null)
        setBootstrap(true)
      }
    }

    tryRestoreRef.current = tryRestore
    void tryRestore()

    // Cleanup: evita retry e setState dopo unmount
    return () => { clearTimers() }
  }, [setBootstrap, setAuth])

  // Retry manuale dall'avviso: azzera il contatore e ritenta subito
  const onManualRetry = (): void => {
    retryCountRef.current = 0
    tryRestoreRef.current()
  }

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
          pdfRegionEditorEnabled: typeof raw?.pdfRegionEditorEnabled === 'boolean' ? raw.pdfRegionEditorEnabled : false,
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

  // ── Avviso throttling 429 — NON redirige al login ─────────
  // Mostrato solo se non c'è ancora una sessione ripristinata.
  if (throttle && !user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-slate-900 border border-amber-500/30 rounded-xl p-8 text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-amber-500/10 flex items-center justify-center">
            <svg className="w-6 h-6 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-slate-100 text-lg font-semibold mb-2">Troppe richieste al server</h1>
          <p className="text-slate-400 text-sm mb-6">
            Il limite di richieste è stato raggiunto temporaneamente.
            <br />
            <span className="text-amber-300/90">La tua sessione è ancora valida</span> — nessun logout.
          </p>

          {throttle.capped ? (
            <p className="text-slate-500 text-sm mb-5">
              Tentativi automatici esauriti. Attendi qualche minuto e riprova.
            </p>
          ) : (
            <p className="text-slate-300 text-sm mb-5">
              Nuovo tentativo automatico tra{' '}
              <span className="font-mono font-semibold text-amber-300">{throttle.remaining}s</span>
            </p>
          )}

          <button
            onClick={onManualRetry}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-amber-500/90 hover:bg-amber-500 text-slate-950 font-medium text-sm transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Riprova ora
          </button>
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
      {currentPage === 'certificati'  && <CertificatiPage />}
      {currentPage === 'certificati-template' && <CertificatiTemplatePage />}
      {currentPage === 'pdf-region-templates' && <PdfRegionTemplatesPage />}
      {currentPage === 'pdf-region-editor' && user?.isAdmin && (
        <Suspense fallback={<PdfEditorLoadingFallback />}>
          <PdfRegionEditorPage />
        </Suspense>
      )}
    </Layout>
  )
}
