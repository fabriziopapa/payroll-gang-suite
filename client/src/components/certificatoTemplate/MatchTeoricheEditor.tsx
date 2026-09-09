// ============================================================
// PAYROLL GANG SUITE — MatchTeoricheEditor
// Editor riusabile per le regole di matching voci teoriche → campo
// (matchTeoriche: { field, keywords[] }[]).
// Ogni riga: nome campo derivato (usato poi come "teo.<field>" nei
// segnaposto/src) + parole chiave separate da virgola che, se trovate
// nella descrizione di una voce teorica del cedolino, valorizzano il campo.
//
// Contratto: lista locale seminata UNA SOLA VOLTA da `value` al mount,
// passthrough 1:1 in emissione (anche righe incomplete: la validazione
// stretta è lato server/salvataggio). Il genitore deve smontare/
// rimontare (prop `key=`) per cambiare contesto.
// ============================================================

import { useState } from 'react'
import type { MatchTeorica } from '../../types'

interface Row { id: string; field: string; keywordsText: string }

interface Props {
  label:    string
  hint?:    string
  value:    MatchTeorica[]
  onChange: (next: MatchTeorica[]) => void
  addLabel?: string
}

function toKeywords(text: string): string[] {
  return text.split(',').map(s => s.trim()).filter(Boolean)
}

export default function MatchTeoricheEditor({ label, hint, value, onChange, addLabel = 'Aggiungi regola' }: Props) {
  const [rows, setRows] = useState<Row[]>(() =>
    value.map(r => ({ id: crypto.randomUUID(), field: r.field, keywordsText: r.keywords.join(', ') })))

  function emit(next: Row[]) {
    setRows(next)
    onChange(next.map(r => ({ field: r.field, keywords: toKeywords(r.keywordsText) })))
  }
  function updateField(i: number, field: string) {
    emit(rows.map((r, idx) => idx === i ? { ...r, field } : r))
  }
  function updateKeywords(i: number, keywordsText: string) {
    emit(rows.map((r, idx) => idx === i ? { ...r, keywordsText } : r))
  }
  function remove(i: number) {
    emit(rows.filter((_, idx) => idx !== i))
  }
  function add() {
    emit([...rows, { id: crypto.randomUUID(), field: '', keywordsText: '' }])
  }

  return (
    <div className="space-y-1.5">
      <div>
        <span className="text-xs text-slate-500">{label}</span>
        {hint && <p className="text-[11px] text-slate-600">{hint}</p>}
      </div>

      <div className="space-y-2">
        {rows.map((r, i) => {
          const kws = toKeywords(r.keywordsText)
          return (
            <div key={r.id} className="rounded-lg border border-slate-800 bg-slate-900/50 p-2.5 space-y-1.5">
              <div className="flex gap-1.5 items-center">
                <span className="text-xs text-slate-600 w-5 shrink-0 text-right select-none">{i + 1}.</span>
                <label className="flex-1 flex items-center gap-2">
                  <span className="text-[11px] text-slate-500 shrink-0">campo</span>
                  <input
                    value={r.field}
                    placeholder="es. stipendio"
                    onChange={e => updateField(i, e.target.value)}
                    className="input flex-1 text-sm font-mono"
                  />
                </label>
                <button type="button" onClick={() => remove(i)} aria-label="Rimuovi regola"
                  className="p-1.5 rounded text-slate-600 hover:text-red-400 hover:bg-red-950/30 transition shrink-0">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              </div>
              <label className="flex items-center gap-2 pl-[26px]">
                <span className="text-[11px] text-slate-500 shrink-0">parole chiave</span>
                <input
                  value={r.keywordsText}
                  placeholder="es. stipendio classe, scatti di anzianità"
                  onChange={e => updateKeywords(i, e.target.value)}
                  className="input flex-1 text-sm"
                />
              </label>
              {r.field.trim() && (
                <p className="text-[11px] text-slate-600 pl-[26px]">
                  Disponibile come <code className="text-indigo-300">{`{{teo.${r.field.trim()}}}`}</code> e come <code className="text-indigo-300">{`teo.${r.field.trim()}`}</code> in "src" tabella emolumenti
                  {kws.length > 0 && <> — riconosciuto da {kws.length} parola/e chiave</>}.
                </p>
              )}
            </div>
          )
        })}
        {rows.length === 0 && (
          <p className="text-xs text-slate-600 italic">Nessuna regola — nessuna voce teorica verrà riconosciuta.</p>
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
