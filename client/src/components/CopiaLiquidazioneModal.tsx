// ============================================================
// PAYROLL GANG SUITE — CopiaLiquidazioneModal
//
// Copia una liquidazione (bozza o archiviata) in una nuova bozza:
// l'utente seleziona i gruppi da copiare. Vengono copiati tutti i
// dati dei gruppi (voce, capitolo, competenza, provvedimento, ...)
// ma MAI i nominativi né le comunicazioni; protocollo azzerato.
// ============================================================

import { useState, useId, useRef } from 'react'
import { bozzeApi, type BozzaApi } from '../api/endpoints'
import type { BozzaDati } from '../store/useStore'
import type { DettaglioLiquidazione, Nominativo } from '../types'
import { useModalKeyboard } from '../hooks/useFocusTrap'
import { showToast } from './ToastManager'

interface Props {
  /** Bozza sorgente COMPLETA (con campo `dati` — caricata via getById) */
  bozza:     BozzaApi
  onClose:   () => void
  /** Chiamata con la nuova bozza creata dal server */
  onCreated: (nuova: BozzaApi) => void
}

export default function CopiaLiquidazioneModal({ bozza, onClose, onCreated }: Props) {
  const dati       = (bozza.dati ?? {}) as Partial<BozzaDati>
  const dettagli   = dati.dettagli   ?? []
  const nominativi = dati.nominativi ?? []

  const [nome, setNome]         = useState(`${bozza.nome} (copia)`)
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(dettagli.map(d => d.id)),
  )
  const [creating, setCreating] = useState(false)

  const titleId   = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalKeyboard(dialogRef, onClose)

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(prev =>
      prev.size === dettagli.length ? new Set() : new Set(dettagli.map(d => d.id)),
    )
  }

  function countNoms(dettaglioId: string): number {
    return nominativi.filter((n: Nominativo) => n.dettaglioId === dettaglioId).length
  }

  async function handleCreate() {
    const nomeTrim = nome.trim()
    if (!nomeTrim || selected.size === 0 || creating) return
    setCreating(true)

    const dettagliCopiati: DettaglioLiquidazione[] = dettagli
      .filter(d => selected.has(d.id))
      .map(d => {
        const copia: DettaglioLiquidazione = { ...d, id: crypto.randomUUID() }
        delete copia.modifiedBy
        return copia
      })

    const nuoviDati: BozzaDati = {
      nominativi:        [],
      dettagli:          dettagliCopiati,
      comunicazioni:     [],
      protocolloDisplay: '',
    }

    try {
      const nuova = await bozzeApi.create(nomeTrim, nuoviDati)
      onCreated(nuova)
    } catch {
      showToast('Errore durante la creazione della copia', 'error')
      setCreating(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div ref={dialogRef}
        className="bg-slate-900 border-0 sm:border border-slate-700
                   rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg
                   max-h-[90dvh] flex flex-col shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <h2 id={titleId} className="text-white font-semibold">Copia liquidazione</h2>
            <p className="text-slate-500 text-xs mt-0.5 truncate max-w-sm">
              da «{bozza.nome}» — i nominativi non vengono copiati
            </p>
          </div>
          <button onClick={onClose} aria-label="Chiudi"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-4">

          {/* Nome nuova bozza */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Nome nuova liquidazione *
            </label>
            <input
              autoFocus
              value={nome}
              onChange={e => setNome(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700
                         text-white text-sm placeholder-slate-500
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
            />
          </div>

          {/* Gruppi */}
          {dettagli.length === 0 ? (
            <p className="text-slate-500 text-sm py-4 text-center">
              Questa liquidazione non contiene gruppi.
            </p>
          ) : (
            <div className="rounded-lg border border-slate-800 overflow-hidden">
              <div className="px-3 py-2 bg-slate-800/50 border-b border-slate-800 flex justify-between items-center">
                <span className="text-xs text-slate-400">
                  Gruppi da copiare ({selected.size}/{dettagli.length})
                </span>
                <button type="button" onClick={toggleAll}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition">
                  {selected.size === dettagli.length ? 'Deseleziona tutti' : 'Seleziona tutti'}
                </button>
              </div>
              <div className="divide-y divide-slate-800/50">
                {dettagli.map(d => {
                  const nNoms = countNoms(d.id)
                  return (
                    <label key={d.id}
                      className="flex items-center gap-3 px-3 py-2.5 cursor-pointer
                                 hover:bg-slate-800/30 transition select-none">
                      <input type="checkbox"
                        checked={selected.has(d.id)}
                        onChange={() => toggle(d.id)}
                        className="w-4 h-4 rounded border-slate-600 accent-indigo-500 shrink-0" />
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: d.colore ?? '#6366f1' }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-slate-200 text-sm truncate">
                          {d.nomeDescrittivo || 'Gruppo senza nome'}
                        </p>
                        <p className="text-slate-500 text-xs mt-0.5 font-mono">
                          {d.voce || '—'} · {d.capitolo || '—'} · {d.competenzaLiquidazione || '—'}
                        </p>
                      </div>
                      <span className="text-xs text-slate-600 shrink-0"
                        title="Nominativi nella sorgente — NON verranno copiati">
                        {nNoms} nom.
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          <p className="text-slate-500 text-xs">
            Vengono copiati tutti i dati dei gruppi (voce, capitolo, competenza, provvedimento,
            scorporo, note…). Nominativi, comunicazioni e protocollo NON vengono copiati.
          </p>
        </div>

        {/* Footer */}
        <div className="flex-none flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-800"
             style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-800 text-sm transition">
            Annulla
          </button>
          <button type="button"
            disabled={creating || selected.size === 0 || !nome.trim()}
            onClick={handleCreate}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white
                       text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed
                       flex items-center gap-2">
            {creating && (
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            )}
            Crea copia{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
