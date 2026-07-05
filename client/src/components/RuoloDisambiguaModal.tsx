// ============================================================
// PAYROLL GANG SUITE — RuoloDisambiguaModal
//
// Usato quando findRuoloAt restituisce >1 ruolo per una matricola
// (es. cambio ruolo nello stesso mese).
// Elabora una coda di nominativi uno alla volta.
// ============================================================

import { useState, useRef, useId } from 'react'
import type { RuoloAtApiResult } from '../api/endpoints'
import { useModalKeyboard } from '../hooks/useFocusTrap'

// ── Tipi pubblici ─────────────────────────────────────────────

export interface DisambiguaItem {
  /** ID univoco del Nominativo da aggiornare */
  nomId:       string
  matricola:   string
  cognomeNome: string
  /** Opzioni ruolo restituite da ruolo-at (sempre >1 per questo item) */
  options:     RuoloAtApiResult[]
}

interface Props {
  items:         DisambiguaItem[]
  /** Chiamato per ogni risoluzione (può essere chiamato più volte) */
  onResolve:     (nomId: string, ruolo: string, druolo: string) => void
  /** Chiamato quando tutta la coda è stata elaborata */
  onAllResolved: () => void
  onClose:       () => void
}

// ── Componente ────────────────────────────────────────────────

export default function RuoloDisambiguaModal({
  items,
  onResolve,
  onAllResolved,
  onClose,
}: Props) {
  const [index, setIndex] = useState(0)
  const titleId   = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalKeyboard(dialogRef, onClose)

  const current = items[index]
  const isLast  = index >= items.length - 1

  function handleChoose(option: RuoloAtApiResult) {
    if (!current) return
    onResolve(current.nomId, option.ruolo, option.druolo ?? '')
    if (isLast) {
      onAllResolved()
    } else {
      setIndex(i => i + 1)
    }
  }

  function handleSkip() {
    if (isLast) {
      onAllResolved()
    } else {
      setIndex(i => i + 1)
    }
  }

  if (!current) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div ref={dialogRef} className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <h2 id={titleId} className="text-white font-semibold flex items-center gap-2">
              <span className="text-amber-400">⚠</span>
              Ruolo ambiguo
            </h2>
            <p className="text-slate-500 text-xs mt-0.5">
              {index + 1} di {items.length} — scegli il ruolo corretto
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Chiudi"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Persona corrente */}
        <div className="px-5 py-4 border-b border-slate-800">
          <p className="text-white font-medium">{current.cognomeNome}</p>
          <p className="text-slate-400 text-sm font-mono mt-0.5">{current.matricola}</p>
        </div>

        {/* Opzioni ruolo */}
        <div className="px-5 py-4 space-y-2">
          <p className="text-slate-400 text-xs mb-3">
            Sono stati trovati più periodi sovrapposti alla data indicata.
            Seleziona quello corretto:
          </p>

          {current.options.map((opt, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleChoose(opt)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl
                         bg-slate-800 hover:bg-slate-700 border border-slate-700
                         hover:border-indigo-600 transition text-left group"
            >
              <span className="text-xs px-2 py-1 rounded bg-slate-700 group-hover:bg-slate-600
                               text-slate-200 font-mono font-medium shrink-0">
                {opt.ruolo}
              </span>
              <div className="flex-1 min-w-0">
                {opt.druolo && (
                  <p className="text-white text-sm truncate">{opt.druolo}</p>
                )}
                <p className="text-slate-500 text-xs mt-0.5">
                  Dal {opt.decorInq}
                  {opt.finRap ? ` al ${opt.finRap}` : ' · in corso'}
                </p>
              </div>
              <svg className="w-4 h-4 text-slate-600 group-hover:text-indigo-400 shrink-0 transition"
                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
              </svg>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-slate-800">
          <button
            type="button"
            onClick={handleSkip}
            className="text-slate-500 hover:text-slate-300 text-sm transition"
          >
            Salta (mantieni attuale)
          </button>

          {/* Indicatore progresso */}
          <div className="flex gap-1">
            {items.map((_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition
                  ${i < index ? 'bg-emerald-500' : i === index ? 'bg-indigo-400' : 'bg-slate-700'}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
