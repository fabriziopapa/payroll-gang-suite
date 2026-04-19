// ============================================================
// PAYROLL GANG SUITE — Login Page (TOTP passwordless)
// Supporta flusso di attivazione via ?activate=UUID
// ============================================================

import React, { useState, useRef, useEffect } from 'react'
import { useStore } from '../store/useStore'
import { authApi } from '../api/endpoints'
import { setAccessToken } from '../api/client'
import { APP_NAME, APP_VERSION } from '../types'
import PrivacyCookieModal from '../components/PrivacyCookieModal'

export default function LoginPage() {
  const { setAuth } = useStore()

  // ── Detect ?activate=UUID in URL ─────────────────────────────
  const urlParams  = new URLSearchParams(window.location.search)
  const activateId = urlParams.get('activate') ?? null

  // Modalità attiva: 'login' | 'activate'
  const [mode, setMode] = useState<'login' | 'activate'>(
    activateId ? 'activate' : 'login',
  )

  // ── Login state ───────────────────────────────────────────────
  const [username, setUsername]       = useState('')
  const [token, setToken]             = useState('')
  const [error, setError]             = useState<string | null>(null)
  const [loading, setLoading]         = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(false)

  // ── Activate state ────────────────────────────────────────────
  const [activateToken, setActivateToken]   = useState('')
  const [activateError, setActivateError]   = useState<string | null>(null)
  const [activateLoading, setActivateLoading] = useState(false)
  const [activateSuccess, setActivateSuccess] = useState(false)

  const tokenRef         = useRef<HTMLInputElement>(null)
  const activateTokenRef = useRef<HTMLInputElement>(null)

  // Auto-focus
  useEffect(() => {
    if (mode === 'login') {
      document.querySelector<HTMLInputElement>('input[name="username"]')?.focus()
    } else {
      activateTokenRef.current?.focus()
    }
  }, [mode])

  // Auto-submit login quando token è completo (6 cifre)
  useEffect(() => {
    if (mode === 'login' && token.length === 6 && username.trim()) {
      handleLoginSubmit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // Auto-submit activation quando token è completo
  useEffect(() => {
    if (mode === 'activate' && activateToken.length === 6 && activateId) {
      handleActivateSubmit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activateToken])

  // ── Login ─────────────────────────────────────────────────────
  async function handleLoginSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!username.trim() || token.length !== 6 || loading) return

    setLoading(true)
    setError(null)

    try {
      const { accessToken, user } = await authApi.login(username.trim(), token)
      setAccessToken(accessToken)
      setAuth(user, accessToken)
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? 'ERRORE'
      setError(
        code === 'AUTH_FAILED'
          ? 'Credenziali non valide. Verifica email e codice OTP.'
          : code === 'RATE_LIMIT_EXCEEDED'
          ? 'Troppi tentativi. Attendi qualche minuto.'
          : `Errore di connessione (${code}).`,
      )
      setToken('')
      tokenRef.current?.focus()
    } finally {
      setLoading(false)
    }
  }

  // ── Attivazione ───────────────────────────────────────────────
  async function handleActivateSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!activateId || activateToken.length !== 6 || activateLoading) return

    setActivateLoading(true)
    setActivateError(null)

    try {
      await authApi.activate(activateId, activateToken)
      setActivateSuccess(true)
      // Rimuovi il parametro dall'URL senza ricaricare la pagina
      window.history.replaceState({}, '', window.location.pathname)
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? 'ERRORE'
      setActivateError(
        code === 'ACTIVATION_FAILED'
          ? 'Codice non valido o account già attivato. Verifica il codice OTP.'
          : code === 'ACTIVATION_TOKEN_EXPIRED'
          ? 'Il link di attivazione è scaduto (validità 24h). Contatta l\'amministratore per ricevere un nuovo link.'
          : code === 'RATE_LIMIT_EXCEEDED'
          ? 'Troppi tentativi. Attendi qualche minuto.'
          : `Errore (${code}).`,
      )
      setActivateToken('')
      activateTokenRef.current?.focus()
    } finally {
      setActivateLoading(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo / titolo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600 mb-4">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">{APP_NAME}</h1>
          <p className="text-slate-400 text-sm mt-1">v{APP_VERSION}</p>
        </div>

        {/* Tab switcher */}
        {activateId && !activateSuccess && (
          <div className="flex gap-1 mb-4 bg-slate-800/60 p-1 rounded-xl">
            <button
              onClick={() => setMode('activate')}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition
                ${mode === 'activate' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Attiva account
            </button>
            <button
              onClick={() => setMode('login')}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition
                ${mode === 'login' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Accedi
            </button>
          </div>
        )}

        {/* ── ATTIVAZIONE ─────────────────────────────────────── */}
        {mode === 'activate' && (
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-6 shadow-xl">

            {activateSuccess ? (
              /* Successo */
              <div className="text-center space-y-4">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-900/50 mx-auto">
                  <svg className="w-7 h-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-white">Account attivato!</h2>
                <p className="text-slate-400 text-sm">
                  Puoi ora accedere con la tua email e il codice OTP dall'app Authenticator.
                </p>
                <button
                  onClick={() => setMode('login')}
                  className="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500
                             text-white font-medium text-sm transition"
                >
                  Vai al login →
                </button>
              </div>
            ) : (
              /* Form attivazione */
              <>
                <h2 className="text-lg font-semibold text-white mb-1">Primo accesso</h2>
                <p className="text-slate-400 text-sm mb-6">
                  Scansiona il QR code con Google Authenticator, poi inserisci
                  il codice a 6 cifre per attivare l'account.
                </p>

                <form onSubmit={handleActivateSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">
                      Codice OTP (dall'app Authenticator)
                    </label>
                    <input
                      ref={activateTokenRef}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      autoComplete="one-time-code"
                      value={activateToken}
                      onChange={e => setActivateToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      disabled={activateLoading}
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700
                                 text-white placeholder-slate-500 text-sm tracking-[0.5em] text-center
                                 focus:outline-none focus:ring-2 focus:ring-indigo-500
                                 disabled:opacity-50 transition font-mono"
                    />
                    <p className="text-xs text-slate-500 mt-1.5">
                      Il codice si aggiorna ogni 30 secondi
                    </p>
                  </div>

                  {activateError && (
                    <div className="flex items-start gap-2.5 p-3 rounded-lg bg-red-950 border border-red-800">
                      <svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-red-300 text-sm">{activateError}</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={activateLoading || activateToken.length !== 6}
                    className="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500
                               text-white font-medium text-sm transition
                               disabled:opacity-50 disabled:cursor-not-allowed
                               flex items-center justify-center gap-2"
                  >
                    {activateLoading ? (
                      <>
                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Attivazione…
                      </>
                    ) : 'Attiva account'}
                  </button>
                </form>
              </>
            )}
          </div>
        )}

        {/* ── LOGIN ────────────────────────────────────────────── */}
        {mode === 'login' && (
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-white mb-1">Accesso</h2>
            <p className="text-slate-400 text-sm mb-6">
              Inserisci il codice dall'app Authenticator
            </p>

            <form onSubmit={handleLoginSubmit} className="space-y-4">

              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Email
                </label>
                <input
                  name="username"
                  type="email"
                  autoComplete="email"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && tokenRef.current?.focus()}
                  placeholder="mario.rossi@ateneo.it"
                  disabled={loading}
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700
                             text-white placeholder-slate-500 text-sm
                             focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                             disabled:opacity-50 transition"
                />
              </div>

              {/* TOTP */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Codice OTP
                </label>
                <input
                  ref={tokenRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  autoComplete="one-time-code"
                  value={token}
                  onChange={e => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  disabled={loading}
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700
                             text-white placeholder-slate-500 text-sm tracking-[0.5em] text-center
                             focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                             disabled:opacity-50 transition font-mono"
                />
                <p className="text-xs text-slate-500 mt-1.5">
                  Il codice si aggiorna ogni 30 secondi
                </p>
              </div>

              {/* Errore */}
              {error && (
                <div className="flex items-start gap-2.5 p-3 rounded-lg bg-red-950 border border-red-800">
                  <svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-red-300 text-sm">{error}</p>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading || !username.trim() || token.length !== 6}
                className="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500
                           text-white font-medium text-sm transition
                           disabled:opacity-50 disabled:cursor-not-allowed
                           flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Accesso in corso…
                  </>
                ) : 'Accedi'}
              </button>

            </form>
          </div>
        )}

        <p className="text-center text-slate-600 text-xs mt-6">
          Autenticazione passwordless TOTP · RFC 6238
        </p>
        <p className="text-center text-slate-700 text-xs mt-2">
          Accedendo verranno impostati cookie tecnici necessari.{' '}
          <button
            onClick={() => setShowPrivacy(true)}
            className="text-slate-500 hover:text-slate-400 underline underline-offset-2 transition"
          >
            Informativa cookie
          </button>
        </p>
      </div>

      {showPrivacy && <PrivacyCookieModal onClose={() => setShowPrivacy(false)} />}
    </div>
  )
}
