// ============================================================
// PAYROLL GANG SUITE — KeyValueMapEditor
// Editor riusabile per mappe chiave→valore (inquadramentoMap, extraRename).
// Coppie chiave/valore in righe; segnala chiavi duplicate (vince l'ultima
// in JSON) e scarta — solo in emissione — le righe a chiave vuota
// (un Record non può rappresentarle senza collisione).
//
// Contratto: lista locale seminata UNA SOLA VOLTA da `value` al mount —
// niente ri-sincronizzazione successiva (altrimenti una riga a chiave
// vuota "in scrittura" sparirebbe ad ogni keystroke). Il genitore deve
// smontare/rimontare (prop `key=`) per cambiare contesto.
// ============================================================

import { useState } from 'react'

interface Row { id: string; k: string; v: string }

interface Props {
  label:             string
  hint?:             string
  value:             Record<string, string>
  onChange:          (next: Record<string, string>) => void
  keyPlaceholder?:   string
  valuePlaceholder?: string
  addLabel?:         string
}

export default function KeyValueMapEditor({
  label, hint, value, onChange,
  keyPlaceholder = 'chiave (es. valore RUOLO/INQUADR)',
  valuePlaceholder = 'etichetta da mostrare nel certificato',
  addLabel = 'Aggiungi voce',
}: Props) {
  const [rows, setRows] = useState<Row[]>(() =>
    Object.entries(value).map(([k, v]) => ({ id: crypto.randomUUID(), k, v })))

  function emit(next: Row[]) {
    setRows(next)
    const obj: Record<string, string> = {}
    for (const r of next) {
      const k = r.k.trim()
      if (k) obj[k] = r.v
    }
    onChange(obj)
  }
  function updateKey(i: number, k: string) {
    emit(rows.map((r, idx) => idx === i ? { ...r, k } : r))
  }
  function updateVal(i: number, v: string) {
    emit(rows.map((r, idx) => idx === i ? { ...r, v } : r))
  }
  function remove(i: number) {
    emit(rows.filter((_, idx) => idx !== i))
  }
  function add() {
    emit([...rows, { id: crypto.randomUUID(), k: '', v: '' }])
  }

  // Chiavi duplicate (a parità di chiave un Record tiene solo l'ultima — avviso)
  const counts = new Map<string, number>()
  for (const r of rows) {
    const k = r.k.trim()
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const dupKeys = new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k))

  return (
    <div className="space-y-1.5">
      <div>
        <span className="text-xs text-slate-500">{label}</span>
        {hint && <p className="text-[11px] text-slate-600">{hint}</p>}
      </div>

      <div className="space-y-1.5">
        {rows.map((r, i) => {
          const trimmed = r.k.trim()
          const isDup   = trimmed !== '' && dupKeys.has(trimmed)
          return (
            <div key={r.id} className="flex gap-1.5 items-center">
              <input
                value={r.k}
                placeholder={keyPlaceholder}
                onChange={e => updateKey(i, e.target.value)}
                className={`input flex-1 text-sm font-mono ${isDup ? 'border-amber-600/70 focus:ring-amber-500' : ''}`}
              />
              <span className="text-slate-600 text-xs shrink-0">→</span>
              <input
                value={r.v}
                placeholder={valuePlaceholder}
                onChange={e => updateVal(i, e.target.value)}
                className="input flex-1 text-sm"
              />
              <button type="button" onClick={() => remove(i)} aria-label="Rimuovi voce"
                className="p-1.5 rounded text-slate-600 hover:text-red-400 hover:bg-red-950/30 transition shrink-0">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
          )
        })}
        {rows.length === 0 && (
          <p className="text-xs text-slate-600 italic">Mappa vuota — nessuna voce.</p>
        )}
      </div>

      {dupKeys.size > 0 && (
        <p className="text-xs text-amber-400">
          Chiave ripetuta ({[...dupKeys].join(', ')}): al salvataggio resta solo l'ultima riga.
        </p>
      )}
      <p className="text-[11px] text-slate-600">Le righe con chiave vuota non vengono salvate.</p>

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
