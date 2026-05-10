// ============================================================
// PAYROLL GANG SUITE — Modal Informativa Cookie (GDPR Art. 13)
// Nessun consenso richiesto: solo cookie tecnici necessari
// ============================================================

import { useRef, useId } from 'react'
import { useModalKeyboard } from '../hooks/useFocusTrap'

interface CookieRowProps {
  label: string
  value: string
  mono?: boolean
}

function CookieRow({ label, value, mono }: CookieRowProps) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 border-b border-slate-700/50 last:border-0">
      <span className="text-xs text-slate-500 leading-tight">{label}</span>
      <span className={`text-xs text-slate-300 leading-snug break-words ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  )
}

interface Props {
  onClose: () => void
}

export default function PrivacyCookieModal({ onClose }: Props) {
  const titleId   = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalKeyboard(dialogRef, onClose)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center
                 sm:p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div ref={dialogRef} className="bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-2xl
                      shadow-2xl w-full sm:max-w-md flex flex-col
                      max-h-[92vh] sm:max-h-[88vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4
                        border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <svg className="w-4 h-4 text-indigo-400 shrink-0" fill="none"
                 viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6
                   a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <h2 id={titleId} className="text-white font-semibold text-sm truncate">
              Informativa Cookie
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white transition rounded-lg
                       p-1.5 hover:bg-slate-800 shrink-0 ml-2"
            aria-label="Chiudi"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body — scrollabile */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          <p className="text-xs text-slate-400 leading-relaxed">
            Questo sito utilizza esclusivamente{' '}
            <strong className="text-white font-medium">
              cookie tecnici strettamente necessari
            </strong>{' '}
            per l'autenticazione. Non sono presenti cookie di profilazione,
            analytics o marketing.
          </p>

          {/* Cookie 1 — pgs_refresh */}
          <div className="bg-slate-800/50 border border-slate-700/80 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-4 py-2.5
                            bg-slate-800 border-b border-slate-700/80 flex-wrap">
              <span className="font-mono text-xs text-indigo-300 font-medium shrink-0">
                pgs_refresh
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap
                               bg-green-900/40 text-green-400 border border-green-800/60">
                Tecnico necessario
              </span>
            </div>
            <div className="px-4 py-1">
              <CookieRow label="Scopo"        value="Mantenere la sessione autenticata" />
              <CookieRow label="Durata"       value="7 giorni" />
              <CookieRow label="Attributi"    value="HttpOnly · Secure · SameSite=Strict" mono />
              <CookieRow label="Impostato da" value="fabriziopapa.com" />
            </div>
          </div>

          {/* Cookie 2 — server_name_session (Cloudflare) */}
          <div className="bg-slate-800/50 border border-slate-700/80 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-4 py-2.5
                            bg-slate-800 border-b border-slate-700/80 flex-wrap">
              <span className="font-mono text-xs text-slate-300 font-medium break-all">
                server_name_session
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap
                               bg-slate-700 text-slate-400 border border-slate-600">
                Terza parte
              </span>
            </div>
            <div className="px-4 py-1">
              <CookieRow label="Scopo"        value="Routing e affidabilità rete (Cloudflare)" />
              <CookieRow label="Durata"       value="24 ore" />
              <CookieRow label="Impostato da" value="Cloudflare Inc." />
              <CookieRow label="Trasferimento" value="USA — EU‑US Data Privacy Framework" />
            </div>
            <div className="px-4 pb-3 pt-1">
              <a
                href="https://www.cloudflare.com/privacypolicy/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-indigo-400
                           hover:text-indigo-300 transition"
              >
                Privacy Policy Cloudflare
                <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24"
                     stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4
                       M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </div>

          {/* Servizio 3 — Cloudflare Turnstile (protezione bot) */}
          <div className="bg-slate-800/50 border border-slate-700/80 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-4 py-2.5
                            bg-slate-800 border-b border-slate-700/80 flex-wrap">
              <span className="font-mono text-xs text-slate-300 font-medium break-all">
                Cloudflare Turnstile
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap
                               bg-slate-700 text-slate-400 border border-slate-600">
                Servizio terza parte
              </span>
            </div>
            <div className="px-4 py-1">
              <CookieRow
                label="Scopo"
                value="Protezione bot invisibile alla pagina di accesso — nessuna interazione richiesta agli utenti legittimi"
              />
              <CookieRow
                label="Dati elaborati"
                value="Segnali browser (timing, canvas, WebGL, navigator), indirizzo IP — inviati a Cloudflare per analisi anti-bot"
              />
              <CookieRow label="Gestore"         value="Cloudflare Inc., 101 Townsend St., San Francisco, CA 94107, USA" />
              <CookieRow label="Trasferimento"   value="USA — EU‑US Data Privacy Framework (decisione di adeguatezza CE 10 luglio 2023)" />
              <CookieRow label="Base giuridica"  value="Art. 6(1)(f) GDPR — legittimo interesse alla sicurezza del sistema" />
            </div>
            <div className="px-4 pb-3 pt-1">
              <a
                href="https://www.cloudflare.com/privacypolicy/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-indigo-400
                           hover:text-indigo-300 transition"
              >
                Privacy Policy Cloudflare
                <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24"
                     stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4
                       M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </div>

          {/* Note legali */}
          <div className="space-y-1.5 text-xs text-slate-500 pt-1">
            <p>
              <span className="text-slate-400">Base giuridica cookie tecnici: </span>
              Art. 6(1)(b) GDPR — esecuzione del servizio richiesto.
            </p>
            <p>
              <span className="text-slate-400">Base giuridica Turnstile: </span>
              Art. 6(1)(f) GDPR — legittimo interesse alla protezione del sistema da accessi automatizzati.
            </p>
            <p>
              <span className="text-slate-400">Normativa: </span>
              GDPR Reg. UE 2016/679 · D.Lgs. 196/2003 ·
              Linee Guida Garante Cookie 10 giugno 2021.
            </p>
            <p>
              <span className="text-slate-400">Aggiornamento: </span>
              Maggio 2026.
            </p>
          </div>

        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-800 shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700
                       text-slate-300 hover:text-white text-sm font-medium transition"
          >
            Ho capito
          </button>
        </div>

      </div>
    </div>
  )
}
