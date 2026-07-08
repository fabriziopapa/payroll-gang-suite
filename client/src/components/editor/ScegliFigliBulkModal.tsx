// ============================================================
// PAYROLL GANG SUITE — ScegliFigliBulkModal
// Scelta manuale del figlio (tag WE, scelta automatica DISATTIVA) per tutti
// i nominativi di un gruppo. Recupera i figli dal CSA-WS in blocco e mostra
// l'età di ciascun figlio calcolata a una data as-of (default: data
// riferimento figli del gruppo, altrimenti data competenza voce).
// ============================================================

import { useState, useEffect, useMemo, useRef, useId, useCallback } from 'react'
import { cinecaApi, type FamiliareApi } from '../../api/endpoints'
import type { DettaglioLiquidazione, Nominativo } from '../../types'
import { etaAllaData } from '../../utils/biz'
import { showToast } from '../ToastManager'
import { useModalKeyboard } from '../../hooks/useFocusTrap'

interface Props {
  dettaglio: DettaglioLiquidazione
  targets:   Nominativo[]           // nominativi senza riferimento cedolino
  onClose:   () => void
  /** cf scelto per ciascun nominativo (chiave = nom.id) */
  onConfirm: (scelte: Record<string, string>) => void
}

export default function ScegliFigliBulkModal({ dettaglio, targets, onClose, onConfirm }: Props) {
  const titleId   = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalKeyboard(dialogRef, onClose)

  const [loading, setLoading]     = useState(true)
  const [figliMap, setFigliMap]   = useState<Record<string, FamiliareApi[]>>({})
  // Scelta CF per nominativo (chiave = nom.id)
  const [scelte, setScelte]       = useState<Record<string, string>>({})
  // Data as-of per il calcolo età: default dal gruppo, sovrascrivibile qui
  const [asOf, setAsOf]           = useState(
    dettaglio.dataRiferimentoFigli || dettaglio.dataCompetenzaVoce || '',
  )

  // Recupero figli via endpoint `familiari` (uno per matricola, chunked) —
  // stesso endpoint del singolo, così NON serve il redeploy del server.
  const loadFigli = useCallback(async (): Promise<void> => {
    setLoading(true)
    // Deduplica le matricole (più nominativi possono condividere la stessa)
    const matricole = [...new Set(targets.map(n => n.matricola))]
    const map: Record<string, FamiliareApi[]> = {}
    const CHUNK = 8
    let errori = 0
    for (let i = 0; i < matricole.length; i += CHUNK) {
      const chunk = matricole.slice(i, i + CHUNK)
      await Promise.all(chunk.map(async m => {
        try {
          const { familiari } = await cinecaApi.familiari(m)
          map[m] = familiari
            .filter(f => f.rapportoParentela.toUpperCase() === 'FG')
            .sort((a, b) => (b.dataNasc ?? '').localeCompare(a.dataNasc ?? ''))  // giovane→anziano
        } catch {
          map[m] = []
          errori++
        }
      }))
    }
    setFigliMap(map)
    // Preseleziona il figlio più giovane (primo dopo l'ordinamento)
    const pre: Record<string, string> = {}
    for (const n of targets) {
      const figli = map[n.matricola] ?? []
      if (figli.length >= 1) pre[n.id] = figli[0]!.codFisc
    }
    setScelte(pre)
    setLoading(false)
    if (errori > 0) showToast(`${errori} matricole senza risposta da CINECA`, 'warning')
  }, [targets])

  useEffect(() => { void loadFigli() }, [loadFigli])

  const conFigli   = useMemo(
    () => targets.filter(n => (figliMap[n.matricola]?.length ?? 0) > 0).length,
    [targets, figliMap],
  )
  const sceltiCount = Object.values(scelte).filter(Boolean).length

  function labelFiglio(f: FamiliareApi): string {
    const eta  = etaAllaData(f.dataNasc, asOf)
    const nome = `${f.cognome ?? ''} ${f.nome ?? ''}`.trim() || f.codFisc
    const etaTxt = eta != null ? ` — ${eta} anni` : ''
    const natoTxt = f.dataNasc ? ` (${f.dataNasc})` : ''
    return `${nome} · ${f.codFisc}${natoTxt}${etaTxt}`
  }

  function handleConfirm() {
    const finali = Object.fromEntries(Object.entries(scelte).filter(([, cf]) => cf))
    onConfirm(finali)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
      role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div ref={dialogRef} className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl
                      max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="min-w-0">
            <h2 id={titleId} className="text-white font-semibold">Scelta figlio (WE)</h2>
            <p className="text-slate-500 text-xs mt-0.5 truncate">
              {dettaglio.nomeDescrittivo || 'Gruppo senza nome'} · {targets.length} nominativi
            </p>
          </div>
          <button onClick={onClose} aria-label="Chiudi"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Barra data as-of */}
        <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-3 flex-wrap">
          <label className="text-sm text-slate-300">Età alla data</label>
          <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm
                       focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <button type="button" onClick={() => void loadFigli()} disabled={loading}
            title="Ricarica i figli da CINECA e ricalcola l'età alla data indicata"
            className="px-3 py-1.5 rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-700/50
                       hover:bg-indigo-600/40 transition text-sm shrink-0 disabled:opacity-40">
            {loading ? 'Ricarico…' : '↻ Ricarica'}
          </button>
          <span className="text-xs text-slate-500">
            default: {dettaglio.dataRiferimentoFigli || dettaglio.dataCompetenzaVoce || '—'}
          </span>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {loading ? (
            <p className="text-center text-slate-500 text-sm py-8">Recupero figli da CINECA…</p>
          ) : targets.map(n => {
            const figli = figliMap[n.matricola] ?? []
            return (
              <div key={n.id} className="flex items-center gap-3 p-2 rounded-lg bg-slate-800/40 border border-slate-700/60">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-200 truncate">{n.cognomeNome}</p>
                  <p className="font-mono text-xs text-slate-500">{n.matricola}</p>
                </div>
                {figli.length === 0 ? (
                  <span className="text-xs text-amber-400 shrink-0">nessun figlio — inserire a mano</span>
                ) : (
                  <select
                    value={scelte[n.id] ?? ''}
                    onChange={e => setScelte(prev => ({ ...prev, [n.id]: e.target.value }))}
                    className="max-w-xs w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700
                               text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">— non impostare —</option>
                    {figli.map(f => (
                      <option key={f.codFisc} value={f.codFisc}>{labelFiglio(f)}</option>
                    ))}
                  </select>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-slate-800">
          <span className="text-xs text-slate-500">
            {loading ? '…' : `${conFigli}/${targets.length} con figli · ${sceltiCount} selezionati`}
          </span>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-800 text-sm transition">
              Annulla
            </button>
            <button type="button" onClick={handleConfirm} disabled={loading || sceltiCount === 0}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500
                         text-white text-sm font-medium transition disabled:opacity-40">
              Applica{sceltiCount > 0 ? ` (${sceltiCount})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
