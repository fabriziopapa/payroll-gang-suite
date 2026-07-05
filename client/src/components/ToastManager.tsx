// ============================================================
// PAYROLL GANG SUITE — ToastManager
// Notifiche slide-in (warning, success, error, info)
// Usa un emitter a livello di modulo: showToast() da qualsiasi file
// ============================================================

import { useState, useEffect, useCallback } from 'react'

// ── Emitter singleton ─────────────────────────────────────────

export type ToastLevel = 'warning' | 'success' | 'error' | 'info'

interface ToastPayload {
  message: string
  level:   ToastLevel
}

type ToastHandler = (t: ToastPayload) => void
const _handlers = new Set<ToastHandler>()

/**
 * Mostra un toast da qualsiasi file/componente.
 * Richiede che <ToastManager> sia montato nel DOM (Layout).
 */
export function showToast(message: string, level: ToastLevel = 'info'): void {
  _handlers.forEach(h => h({ message, level }))
}

// ── Helpers visivi ────────────────────────────────────────────

const LEVEL_CLS: Record<ToastLevel, string> = {
  warning: 'bg-amber-950/95 border-amber-700 text-amber-100',
  success: 'bg-emerald-950/95 border-emerald-700 text-emerald-100',
  error:   'bg-red-950/95 border-red-700 text-red-100',
  info:    'bg-slate-800/95 border-slate-600 text-slate-100',
}

const LEVEL_ICON: Record<ToastLevel, string> = {
  warning: '⚠',
  success: '✓',
  error:   '✕',
  info:    'ℹ',
}

const LEVEL_ICON_CLS: Record<ToastLevel, string> = {
  warning: 'text-amber-400',
  success: 'text-emerald-400',
  error:   'text-red-400',
  info:    'text-slate-400',
}

const TOAST_DURATION_MS = 8000

// ── Component ─────────────────────────────────────────────────

interface Toast extends ToastPayload {
  id: string
}

export default function ToastManager() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast: ToastHandler = useCallback(({ message, level }) => {
    const id = crypto.randomUUID()
    setToasts(prev => [...prev, { id, message, level }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, TOAST_DURATION_MS)
  }, [])

  useEffect(() => {
    _handlers.add(addToast)
    return () => { _handlers.delete(addToast) }
  }, [addToast])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 w-full max-w-sm pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`
            flex items-start gap-3 px-4 py-3 rounded-xl shadow-2xl border
            pointer-events-auto
            ${LEVEL_CLS[t.level]}
          `}
          style={{ animation: 'slideUpFadeIn 0.25s ease-out' }}
        >
          <span className={`text-base shrink-0 mt-0.5 ${LEVEL_ICON_CLS[t.level]}`}>
            {LEVEL_ICON[t.level]}
          </span>
          <p className="text-sm leading-relaxed flex-1">{t.message}</p>
          <button
            onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
            className="ml-1 shrink-0 opacity-50 hover:opacity-100 transition"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      ))}

      {/* CSS animation — iniettata una volta sola */}
      <style>{`
        @keyframes slideUpFadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
