// ============================================================
// PAYROLL GANG SUITE — TabellaEmolumentiEditor
// Editor riusabile per le righe della tabella emolumenti del certificato
// (tabellaEmolumenti: { voce, segno, src, bold? }[]).
// "src" è il path nel contesto di risoluzione: "teo.<campo>" (voce
// teorica derivata da matchTeoriche) oppure "cert.<campo>" (dato diretto
// dal cedolino, es. cert.netto_a_pagare). La palette segnaposto (vedi
// header pagina) elenca i path "cert.*" disponibili.
//
// Contratto: lista locale seminata UNA SOLA VOLTA da `value` al mount,
// passthrough 1:1 in emissione. Il genitore deve smontare/rimontare
// (prop `key=`) per cambiare contesto (es. cambio template selezionato).
// ============================================================

import { useState } from 'react'
import type { RigaEmolumento } from '../../types'

interface Row extends RigaEmolumento { id: string }

interface Props {
  label:    string
  hint?:    string
  value:    RigaEmolumento[]
  onChange: (next: RigaEmolumento[]) => void
  addLabel?: string
}

const SEGNO_SUGGESTIONI = ['(+)', '(-)', '(=)']

export default function TabellaEmolumentiEditor({ label, hint, value, onChange, addLabel = 'Aggiungi riga' }: Props) {
  const [rows, setRows] = useState<Row[]>(() =>
    value.map(r => ({ id: crypto.randomUUID(), ...r })))

  function emit(next: Row[]) {
    setRows(next)
    onChange(next.map(({ id: _id, ...r }) => r))
  }
  function patch(i: number, p: Partial<RigaEmolumento>) {
    emit(rows.map((r, idx) => idx === i ? { ...r, ...p } : r))
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
    emit([...rows, { id: crypto.randomUUID(), voce: '', segno: '(+)', src: '', bold: false }])
  }

  return (
    <div className="space-y-1.5">
      <div>
        <span className="text-xs text-slate-500">{label}</span>
        {hint && <p className="text-[11px] text-slate-600">{hint}</p>}
      </div>

      <datalist id="segno-suggerimenti">
        {SEGNO_SUGGESTIONI.map(s => <option key={s} value={s} />)}
      </datalist>

      {rows.length > 0 && (
        <div className="grid grid-cols-[1.5rem_1fr_4.5rem_1fr_3.5rem_2rem] gap-1.5 px-1 text-[11px] text-slate-600">
          <span/><span>Voce (etichetta)</span><span>Segno</span><span>Sorgente (src)</span><span className="text-center">Grassetto</span><span/>
        </div>
      )}
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={r.id} className="grid grid-cols-[1.5rem_1fr_4.5rem_1fr_3.5rem_2rem] gap-1.5 items-center">
            <span className="text-xs text-slate-600 text-right select-none">{i + 1}.</span>
            <input value={r.voce} placeholder="es. Stipendio annuo lordo"
              onChange={e => patch(i, { voce: e.target.value })}
              className="input text-sm" />
            <input value={r.segno} list="segno-suggerimenti" placeholder="(+)"
              onChange={e => patch(i, { segno: e.target.value })}
              className="input text-sm text-center font-mono" />
            <input value={r.src} placeholder="teo.stipendio / cert.netto_a_pagare"
              onChange={e => patch(i, { src: e.target.value })}
              className="input text-sm font-mono" />
            <span className="flex justify-center">
              <input type="checkbox" checked={!!r.bold} onChange={e => patch(i, { bold: e.target.checked })}
                className="w-4 h-4 accent-indigo-600" aria-label="Grassetto" />
            </span>
            <span className="flex justify-center">
              <button type="button" onClick={() => remove(i)} aria-label="Rimuovi riga"
                className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-red-950/30 transition">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </span>
            <span className="col-span-5 flex items-center gap-1 -mt-1">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                aria-label="Sposta su"
                className="px-1 leading-none text-xs text-slate-600 hover:text-white disabled:opacity-20 disabled:pointer-events-none transition">▲ su</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1}
                aria-label="Sposta giù"
                className="px-1 leading-none text-xs text-slate-600 hover:text-white disabled:opacity-20 disabled:pointer-events-none transition">▼ giù</button>
            </span>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-xs text-slate-600 italic">Nessuna riga — la tabella emolumenti risulterà vuota nel certificato.</p>
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
