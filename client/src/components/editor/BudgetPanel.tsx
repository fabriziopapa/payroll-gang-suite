// ============================================================
// PAYROLL GANG SUITE — BudgetPanel
// Pannello badge flottante per scomposizione importo
// ============================================================

import { useState, useEffect, useRef } from 'react'
import type { ImportoBudgetItem } from '../../types'

interface BudgetDraft {
  id:          string
  descrizione: string
  importoStr:  string
}

interface Props {
  initialItems:  ImportoBudgetItem[]
  initialSingle: number
  anchorEl:      HTMLElement | null
  onConfirm:     (total: number, items: ImportoBudgetItem[]) => void
  onClose:       () => void
}

export default function BudgetPanel({ initialItems, initialSingle, anchorEl, onConfirm, onClose }: Props) {
  const [items, setItems] = useState<BudgetDraft[]>(() => {
    if (initialItems.length > 0) {
      return initialItems.map(b => ({
        id:          b.id,
        descrizione: b.descrizione,
        importoStr:  b.importo > 0 ? String(b.importo) : '',
      }))
    }
    return [{ id: crypto.randomUUID(), descrizione: '', importoStr: initialSingle > 0 ? String(initialSingle) : '' }]
  })

  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({
    position: 'fixed', top: 0, left: 0, opacity: 0, zIndex: 9999,
  })
  const panelRef = useRef<HTMLDivElement>(null)

  // Posiziona vicino al pulsante ancora
  useEffect(() => {
    if (!anchorEl) return
    const rect    = anchorEl.getBoundingClientRect()
    const panelW  = 296
    const panelH  = 280  // stima altezza
    let left = rect.right - panelW
    let top  = rect.bottom + 6
    if (left < 8) left = 8
    if (left + panelW > window.innerWidth - 8) left = window.innerWidth - panelW - 8
    if (top + panelH > window.innerHeight - 8) top = rect.top - panelH - 6
    setPanelStyle({ position: 'fixed', top, left, zIndex: 9999, opacity: 1 })
  }, [anchorEl])

  // Chiudi su click esterno
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        anchorEl && !anchorEl.contains(e.target as Node)
      ) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [anchorEl, onClose])

  // Chiudi su Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const total = items.reduce(
    (s, b) => s + (parseFloat(b.importoStr.replace(',', '.')) || 0), 0,
  )

  function addRow() {
    setItems(prev => [...prev, { id: crypto.randomUUID(), descrizione: '', importoStr: '' }])
  }

  function update(id: string, field: 'descrizione' | 'importoStr', value: string) {
    setItems(prev => prev.map(b => b.id === id ? { ...b, [field]: value } : b))
  }

  function remove(id: string) {
    setItems(prev => prev.filter(b => b.id !== id))
  }

  function handleConfirm() {
    const resolved: ImportoBudgetItem[] = items.map(b => ({
      id:          b.id,
      descrizione: b.descrizione,
      importo:     parseFloat(b.importoStr.replace(',', '.')) || 0,
    }))
    onConfirm(total, resolved)
  }

  return (
    <div
      ref={panelRef}
      style={panelStyle}
      className="w-[296px] rounded-xl border border-indigo-800/70 bg-slate-900
                 shadow-2xl shadow-black/60 p-3 space-y-2 transition-opacity duration-100"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wide">
          Badge importo
        </span>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-white text-xs transition leading-none"
          aria-label="Chiudi"
        >✕</button>
      </div>

      {/* Voci */}
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {items.map((b, idx) => (
          <div key={b.id} className="flex gap-1.5 items-center">
            <span className="text-xs text-slate-600 w-4 shrink-0 text-right select-none">{idx + 1}.</span>
            <input
              type="text"
              value={b.descrizione}
              onChange={e => update(b.id, 'descrizione', e.target.value)}
              placeholder="Descrizione"
              className="flex-1 px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700
                         text-white text-xs placeholder-slate-600
                         focus:outline-none focus:ring-1 focus:ring-indigo-500 min-w-0"
            />
            <input
              autoFocus={idx === items.length - 1}
              type="number"
              step="0.01"
              value={b.importoStr}
              onChange={e => update(b.id, 'importoStr', e.target.value)}
              onKeyDown={e => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault()
                if (e.key === 'Enter') handleConfirm()
              }}
              placeholder="0.00"
              className="w-24 px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700
                         text-white text-xs text-right font-mono shrink-0
                         focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button
              onClick={() => remove(b.id)}
              disabled={items.length === 1}
              className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-red-950/30
                         transition shrink-0 disabled:opacity-0 disabled:pointer-events-none"
              aria-label="Rimuovi voce"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1.5 border-t border-slate-800">
        <button
          onClick={addRow}
          className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
          </svg>
          Aggiungi voce
        </button>
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-sm font-bold text-white">
            {total.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
          </span>
          <button
            onClick={handleConfirm}
            className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500
                       text-white text-xs font-medium transition"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
