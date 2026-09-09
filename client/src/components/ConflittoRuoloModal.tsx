// ============================================================
// PAYROLL GANG SUITE — ConflittoRuoloModal
//
// Mostrato da "Aggiorna Ruolo" quando un nominativo ha un ruolo
// modificato manualmente che differisce dal ruolo storico in DB.
// L'utente sceglie per ogni caso se mantenere la modifica manuale
// oppure usare il dato dal DB.
// ============================================================

import { useState, useRef, useId } from 'react'
import { useModalKeyboard } from '../hooks/useFocusTrap'

export interface ConflittoItem {
  nomId:        string
  matricola:    string
  cognomeNome:  string
  /** Ruolo attualmente impostato (modifica manuale dell'utente) */
  ruoloManuale: string
  /** Ruolo restituito dal DB per la data competenza voce */
  ruoloDb:      string
  druoloDb:     string | null
}

interface Props {
  items:         ConflittoItem[]
  /** nomId + scelta: 'mantieni' = lascia ruoloManuale, 'db' = usa ruoloDb */
  onResolve:     (nomId: string, scelta: 'mantieni' | 'db') => void
  onAllResolved: () => void
  onClose:       () => void
}

export default function ConflittoRuoloModal({
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

  function handleChoice(scelta: 'mantieni' | 'db') {
    if (!current) return
    onResolve(current.nomId, scelta)
    if (isLast) onAllResolved()
    else setIndex(i => i + 1)
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
              Ruolo diverso dal dato storico
            </h2>
            <p className="text-slate-500 text-xs mt-0.5">
              {index + 1} di {items.length} — scegli quale ruolo tenere
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

        {/* Persona */}
        <div className="px-5 py-4 border-b border-slate-800">
          <p className="text-white font-medium">{current.cognomeNome}</p>
          <p className="text-slate-400 text-sm font-mono mt-0.5">{current.matricola}</p>
        </div>

        {/* Scelta */}
        <div className="px-5 py-5 space-y-3">
          <p className="text-slate-400 text-xs mb-1">
            Il ruolo attuale differisce dal dato storico in DB alla data di competenza. Quale vuoi tenere?
          </p>

          {/* Opzione A — mantieni modifica manuale */}
          <button
            type="button"
            onClick={() => handleChoice('mantieni')}
            className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl
                       bg-slate-800 hover:bg-amber-900/30 border border-slate-700
                       hover:border-amber-700 transition text-left group"
          >
            <div className="w-8 h-8 rounded-lg bg-amber-900/40 border border-amber-800
                            flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536
                     L6.5 21.036H3v-3.572L16.732 3.732z"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-slate-400 text-xs mb-0.5">Mantieni ruolo attuale</p>
              <p className="text-white font-mono font-semibold text-sm">{current.ruoloManuale}</p>
            </div>
          </button>

          {/* Opzione B — usa ruolo storico dal DB */}
          <button
            type="button"
            onClick={() => handleChoice('db')}
            className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl
                       bg-slate-800 hover:bg-indigo-900/30 border border-slate-700
                       hover:border-indigo-600 transition text-left group"
          >
            <div className="w-8 h-8 rounded-lg bg-indigo-900/40 border border-indigo-800
                            flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9
                     m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-slate-400 text-xs mb-0.5">Usa ruolo storico dal DB</p>
              <p className="text-white font-mono font-semibold text-sm">{current.ruoloDb}</p>
              {current.druoloDb && (
                <p className="text-slate-500 text-xs mt-0.5 truncate">{current.druoloDb}</p>
              )}
            </div>
          </button>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 text-sm transition"
          >
            Annulla tutto
          </button>

          {/* Indicatore progresso */}
          <div className="flex gap-1">
            {items.map((_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition
                  ${i < index ? 'bg-emerald-500' : i === index ? 'bg-amber-400' : 'bg-slate-700'}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
