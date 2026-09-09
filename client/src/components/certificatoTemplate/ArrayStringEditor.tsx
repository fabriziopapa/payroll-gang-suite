// ============================================================
// PAYROLL GANG SUITE — ArrayStringEditor
// Editor riusabile per liste ordinate di stringhe (corpo, firma…).
// Righe riordinabili (▲▼), rimuovibili, con aggiunta in coda.
//
// Contratto: il componente mantiene una lista locale (id stabile per
// riga, niente salti del focus su rimozione/riordino) seminata UNA
// SOLA VOLTA da `value` al mount — non si ri-sincronizza in seguito.
// Il genitore deve smontare/rimontare (prop `key=`) per cambiare
// contesto, es. selezione di un template diverso.
// ============================================================

import { useState } from 'react'

interface Row { id: string; text: string }

interface Props {
  label:        string
  hint?:        string
  value:        string[]
  onChange:     (next: string[]) => void
  placeholder?: string
  multiline?:   boolean
  rows?:        number
  addLabel?:    string
}

export default function ArrayStringEditor({
  label, hint, value, onChange, placeholder, multiline, rows: taRows = 2, addLabel = 'Aggiungi riga',
}: Props) {
  const [rows, setRows] = useState<Row[]>(() => value.map(text => ({ id: crypto.randomUUID(), text })))

  function emit(next: Row[]) {
    setRows(next)
    onChange(next.map(r => r.text))
  }
  function update(i: number, text: string) {
    emit(rows.map((r, idx) => idx === i ? { ...r, text } : r))
  }
  function remove(i: number) {
    emit(rows.filter((_, idx) => idx !== i))
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    const a = rows[i]; const b = rows[j]
    if (!a || !b) return
    const next = [...rows]
    next[i] = b; next[j] = a
    emit(next)
  }
  function add() {
    emit([...rows, { id: crypto.randomUUID(), text: '' }])
  }

  return (
    <div className="space-y-1.5">
      <div>
        <span className="text-xs text-slate-500">{label}</span>
        {hint && <p className="text-[11px] text-slate-600">{hint}</p>}
      </div>

      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={r.id} className="flex gap-1.5 items-start">
            <span className="text-xs text-slate-600 w-5 shrink-0 text-right select-none pt-2">{i + 1}.</span>
            {multiline ? (
              <textarea
                rows={taRows}
                value={r.text}
                placeholder={placeholder}
                onChange={e => update(i, e.target.value)}
                className="input flex-1 font-mono text-xs leading-relaxed resize-y"
              />
            ) : (
              <input
                value={r.text}
                placeholder={placeholder}
                onChange={e => update(i, e.target.value)}
                className="input flex-1 text-sm"
              />
            )}
            <div className="flex flex-col shrink-0">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                aria-label="Sposta su"
                className="px-1 leading-none text-slate-600 hover:text-white disabled:opacity-20 disabled:pointer-events-none transition">▲</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1}
                aria-label="Sposta giù"
                className="px-1 leading-none text-slate-600 hover:text-white disabled:opacity-20 disabled:pointer-events-none transition">▼</button>
            </div>
            <button type="button" onClick={() => remove(i)} aria-label="Rimuovi riga"
              className="p-1.5 rounded text-slate-600 hover:text-red-400 hover:bg-red-950/30 transition shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-xs text-slate-600 italic">Nessuna riga.</p>
        )}
      </div>

      <button type="button" onClick={add}
        className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
        </svg>
        {addLabel}
      </button>
    </div>
  )
}
