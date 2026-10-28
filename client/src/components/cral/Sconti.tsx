// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · sconti
// Regola per tipologia (nella maschera dell'evento) e sconto personale
// (sulla persona o sulla richiesta): percentuale, importo fisso o nessuno.
// ============================================================

import { useState } from 'react'
import type { CatSconto, Modalita, ScontoPers, ScontoRegola, Sconti } from './tipi'
import { CAT_SC, applicaSconto, catDiModo, fmtEuro, fmtImp, fmtSconto, parseEuro, unitaSconto } from './logica'
import { Campo, Modale, btnPiccoloSec, btnPrimario, btnSecondario, etichettaCls, inputCls, inputW, sceltaCls } from './ui'

export type ScontiTxt = Partial<Record<CatSconto, { tipo: '' | '%' | '€'; val: string }>>
export const scontiInTxt = (sc: Sconti): ScontiTxt =>
  Object.fromEntries(Object.entries(sc).filter(([, r]) => r?.val).map(([k, r]) => [k, { tipo: r!.tipo, val: r!.tipo === '%' ? String(r!.val) : fmtImp(r!.val) }]))
export const scontiDaTxt = (t: ScontiTxt, mod: Modalita): Sconti => {
  const out: Sconti = {}
  for (const k of catDiModo(mod)) {
    const r = t[k]; if (!r || !r.tipo || !r.val.trim()) continue
    const val = r.tipo === '%' ? parseInt(r.val, 10) : parseEuro(r.val)
    if (val && val > 0) out[k] = { tipo: r.tipo, val }
  }
  return out
}
export const scontiTxtOk = (t: ScontiTxt): boolean => Object.values(t).every(r => !r || !r.tipo || !r.val.trim() ||
  (r.tipo === '%' ? /^\d{1,3}$/.test(r.val.trim()) && +r.val >= 1 && +r.val <= 100 : (parseEuro(r.val) ?? 0) > 0))

/** Regole di sconto per tipologia, nella maschera dell'evento. */
export function ScontiTipologia({ mod, valori, onChange }: { mod: Modalita; valori: ScontiTxt; onChange: (v: ScontiTxt) => void }) {
  const cats = catDiModo(mod)
  const set = (k: CatSconto, p: Partial<{ tipo: '' | '%' | '€'; val: string }>) => onChange({ ...valori, [k]: { tipo: '', val: '', ...valori[k], ...p } })
  const primo = cats[0]!
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-800 p-4">
      <div><span className={etichettaCls}>Sconti per tipologia</span><p className="text-xs text-slate-500 mt-1">Percentuale o importo fisso ({unitaSconto(mod)}), diverso per ogni tipologia se serve. Per un caso singolo c'è lo sconto personale sulla riga della persona{mod === 'MAGAZZINO' ? ' o della richiesta' : ''}.{mod === 'TURNI' ? " Nei campi la tipologia è quella del socio o dipendente di riferimento, bloccata all'iscrizione." : ' Un familiare ha la regola «Familiari».'}</p></div>
      <div className="grid sm:grid-cols-2 gap-2">{cats.map(k => {
        const r = valori[k] ?? { tipo: '', val: '' }
        return (
          <div key={k} className="flex items-center gap-2 rounded-lg border border-slate-800 px-3 py-2"><span className="text-sm text-slate-200 flex-1">{CAT_SC[k]}</span>
            <select className={inputW + ' py-1 text-xs w-28'} value={r.tipo} onChange={e => set(k, { tipo: e.target.value as '' | '%' | '€' })}><option value="">nessuno</option><option value="%">%</option><option value="€">€ fisso</option></select>
            <input disabled={!r.tipo} inputMode="decimal" className={inputW + ' py-1 text-xs w-20 text-right tabular-nums disabled:opacity-40'} value={r.val} placeholder={r.tipo === '%' ? '50' : '0,00'} onChange={e => set(k, { val: e.target.value })} /></div>)
      })}</div>
      <div className="flex flex-wrap gap-2"><button className={btnPiccoloSec} onClick={() => { const p = valori[primo] ?? { tipo: '', val: '' }; onChange(Object.fromEntries(cats.map(k => [k, { ...p }]))) }}>Come «{CAT_SC[primo]}» per tutte</button>
        <button className={btnPiccoloSec} onClick={() => onChange(Object.fromEntries(cats.map(k => [k, { tipo: '', val: '' }])))}>Nessuno sconto</button></div>
    </div>
  )
}

/** Sconto personale: automatico (regola della tipologia), nessuno, percentuale o importo fisso, con una nota. */
export function ScontoPersonaleModal({ titolo, sotto, regola, valore, lordo, onSalva, onClose }: {
  titolo: string; sotto: string; regola: ScontoRegola | null; valore: ScontoPers | null; lordo: number
  onSalva: (v: ScontoPers | null) => void; onClose: () => void
}) {
  const [m, setM] = useState<'AUTO' | 'NO' | '%' | '€'>(!valore ? 'AUTO' : valore.tipo)
  const [v, setV] = useState(valore && valore.tipo !== 'NO' ? (valore.tipo === '%' ? String(valore.val) : fmtImp(valore.val)) : '')
  const [nota, setNota] = useState(valore?.nota ?? '')
  const pe = parseEuro(v)
  const val = m === '%' ? (/^\d{1,3}$/.test(v.trim()) && +v > 0 && +v <= 100 ? +v : null) : m === '€' ? (pe && pe > 0 ? pe : null) : 0
  const ok = m === 'AUTO' || m === 'NO' || val !== null
  const anteprima = m === 'AUTO' ? applicaSconto(lordo, regola) : m === 'NO' ? lordo : val !== null ? applicaSconto(lordo, { tipo: m, val }) : null
  const n = nota.trim()
  const scelte: Array<['AUTO' | 'NO' | '%' | '€', string, string]> = [
    ['AUTO', 'Automatico', regola ? `Regola della tipologia: ${fmtSconto(regola)}` : 'Nessuna regola per questa tipologia'],
    ['NO', 'Nessuno sconto', 'Prezzo pieno, anche se la tipologia ha la regola'], ['%', 'Percentuale', 'Es. 10% sul totale'], ['€', 'Importo fisso', 'Es. 5,00 € in meno sul totale'],
  ]
  return (
    <Modale titolo={titolo} sotto={sotto} onClose={onClose} piedi={<><button className={btnSecondario} onClick={onClose}>Annulla</button>
      <button className={btnPrimario} disabled={!ok} onClick={() => onSalva(m === 'AUTO' ? null : m === 'NO' ? { tipo: 'NO', ...(n ? { nota: n } : {}) } : { tipo: m, val: val ?? 0, ...(n ? { nota: n } : {}) })}>Salva</button></>}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2">
          {scelte.map(([k, t, d]) => <button key={k} onClick={() => setM(k)} className={sceltaCls(m === k)}><p className="text-sm font-medium text-white">{t}</p><p className="text-xs text-slate-500">{d}</p></button>)}
        </div>
        {(m === '%' || m === '€') && <div className="grid grid-cols-2 gap-3"><Campo label={m === '%' ? 'Sconto %' : 'Sconto €'}><input autoFocus inputMode="decimal" className={inputCls + ' text-right tabular-nums'} value={v} placeholder={m === '%' ? '10' : '5,00'} onChange={e => setV(e.target.value)} /></Campo>
          <Campo label="Motivo (facoltativo)"><input className={inputCls} value={nota} maxLength={200} placeholder="Es. accordo col fornitore" onChange={e => setNota(e.target.value)} /></Campo></div>}
        {m === 'NO' && <Campo label="Motivo (facoltativo)"><input className={inputCls} value={nota} maxLength={200} onChange={e => setNota(e.target.value)} /></Campo>}
        <p className="text-sm text-slate-300 tabular-nums">Lordo {fmtEuro(lordo)} → <b className="text-white">{anteprima === null ? '…' : fmtEuro(anteprima)}</b></p>
      </div>
    </Modale>
  )
}
