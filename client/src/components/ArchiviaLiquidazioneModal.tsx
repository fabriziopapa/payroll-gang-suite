// ============================================================
// PAYROLL GANG SUITE — ArchiviaLiquidazioneModal
// Richiesta dati di archiviazione:
//   · data di liquidazione  — obbligatoria
//   · ID liquidazione CSA   — facoltativo (integrabile in seguito)
// Riusato in modalità "modifica" dal Viewer per aggiornare i dati
// di una liquidazione già archiviata.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import type { LiquidazioneInfo } from '../api/endpoints'

interface Props {
  /** 'archivia' = flusso archiviazione; 'modifica' = edit su archiviata */
  mode:        'archivia' | 'modifica'
  /** Nome della liquidazione, mostrato nel sottotitolo */
  nome:        string
  /** Prefill (per ri-archiviazione dopo ripristino o modifica) */
  initialData?: { dataLiquidazione?: string | null; idLiquidazioneCsa?: string | null }
  /** Conferma — il chiamante esegue la chiamata API; il modal gestisce lo spinner */
  onConfirm:   (info: LiquidazioneInfo) => Promise<void>
  onClose:     () => void
}

export default function ArchiviaLiquidazioneModal({ mode, nome, initialData, onConfirm, onClose }: Props) {
  const [dataLiquidazione, setDataLiquidazione] = useState(initialData?.dataLiquidazione ?? '')
  const [idCsa, setIdCsa]                       = useState(initialData?.idLiquidazioneCsa ?? '')
  const [saving, setSaving]                     = useState(false)
  const dateRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    dateRef.current?.focus()
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const dataValida = /^\d{4}-\d{2}-\d{2}$/.test(dataLiquidazione)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!dataValida || saving) return
    setSaving(true)
    try {
      await onConfirm({
        dataLiquidazione,
        ...(idCsa.trim() ? { idLiquidazioneCsa: idCsa.trim() } : {}),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="archivia-modal-title"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl"
      >
        <h3 id="archivia-modal-title" className="text-white font-semibold mb-1">
          {mode === 'archivia' ? 'Archivia liquidazione' : 'Dati liquidazione'}
        </h3>
        <p className="text-slate-400 text-sm mb-5 truncate">«{nome}»</p>

        {/* Data di liquidazione — obbligatoria */}
        <label className="block mb-4">
          <span className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">
            Data di liquidazione <span className="text-red-400">*</span>
          </span>
          <input
            ref={dateRef}
            type="date"
            required
            value={dataLiquidazione}
            onChange={e => setDataLiquidazione(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700
                       text-white text-sm [color-scheme:dark]
                       focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-transparent"
          />
        </label>

        {/* ID liquidazione CSA — facoltativo */}
        <label className="block mb-6">
          <span className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">
            ID liquidazione CSA
          </span>
          <input
            type="text"
            value={idCsa}
            onChange={e => setIdCsa(e.target.value)}
            maxLength={40}
            placeholder="es. 1ND001950001220240442801"
            spellCheck={false}
            autoComplete="off"
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700
                       text-white text-sm font-mono placeholder:text-slate-600 placeholder:font-sans
                       focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-transparent"
          />
          <span className="block text-xs text-slate-500 mt-1.5">
            Facoltativo — riportato da CSA, integrabile anche dopo l'archiviazione.
          </span>
        </label>

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-slate-300 hover:text-white text-sm transition"
          >
            Annulla
          </button>
          <button
            type="submit"
            disabled={!dataValida || saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500
                       text-white text-sm font-medium transition
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving && (
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {mode === 'archivia' ? 'Archivia' : 'Salva'}
          </button>
        </div>
      </form>
    </div>
  )
}
