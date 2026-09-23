// ============================================================
// PAYROLL GANG SUITE — ModaleContiCsa
//
// "Verifica conti da CSA" nella lavorazione Emolumenti: quale liquidazione
// leggere. Anno e mese sono quelli della liquidazione (proposti dalla data di
// liquidazione della lavorazione, se c'e'), i ruoli sono quelli presenti
// nelle righe, il comparto e' 1. Il progressivo e' facoltativo: serve a
// leggere UNA liquidazione precisa — per esempio quella "a mazza secca" fatta
// apposta per sapere su quale conto CSA paga ciascuno — invece di tutte
// quelle del mese.
//
// Il modale raccoglie i parametri e basta: la chiamata la fa il chiamante.
// ============================================================

import { useEffect, useState } from 'react'

export interface ParametriContiCsa {
  anno:               number
  mese:               number
  ruoli:              string[]
  progrLiquidazione?: string
}

interface Props {
  /** Ruoli presenti nelle righe della lavorazione (proposti tutti). */
  ruoli:       string[]
  /** 'AAAA-MM-GG' della liquidazione, se la lavorazione ce l'ha. */
  dataLiquidazione: string | null
  leggendo:    boolean
  onConferma:  (p: ParametriContiCsa) => void
  onChiudi:    () => void
}

export default function ModaleContiCsa({ ruoli, dataLiquidazione, leggendo, onConferma, onChiudi }: Props) {
  const oggi = new Date()
  const [anno, setAnno]   = useState(dataLiquidazione ? dataLiquidazione.slice(0, 4) : String(oggi.getFullYear()))
  const [mese, setMese]   = useState(dataLiquidazione ? String(Number(dataLiquidazione.slice(5, 7))) : String(oggi.getMonth() + 1))
  const [progr, setProgr] = useState('')
  const [scelti, setScelti] = useState<Set<string>>(new Set(ruoli))

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !leggendo) onChiudi() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onChiudi, leggendo])

  const annoN = Number(anno), meseN = Number(mese)
  const progrOk = progr.trim() === '' || /^\d{1,3}$/.test(progr.trim())
  const valido = Number.isInteger(annoN) && annoN >= 1990 && annoN <= 2100
              && Number.isInteger(meseN) && meseN >= 1 && meseN <= 12
              && scelti.size > 0 && progrOk

  function conferma() {
    if (!valido || leggendo) return
    const p = progr.trim()
    onConferma({
      anno: annoN, mese: meseN, ruoli: [...scelti].sort(),
      ...(p ? { progrLiquidazione: p.padStart(3, '0') } : {}),
    })
  }

  function alterna(r: string) {
    setScelti(prev => {
      const n = new Set(prev)
      if (n.has(r)) n.delete(r); else n.add(r)
      return n
    })
  }

  const campo = `w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100
                 text-sm font-mono focus:outline-none focus:border-indigo-500`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
         role="dialog" aria-modal="true">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl">

        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <h2 className="text-white font-semibold">Verifica conti da CSA</h2>
            <p className="text-slate-500 text-xs mt-0.5">
              Legge le testate della liquidazione e dice su quale conto CSA ha pagato ciascuno.
            </p>
          </div>
          <button onClick={onChiudi} disabled={leggendo} aria-label="Chiudi"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs text-slate-400">Anno liquidazione</span>
              <input value={anno} onChange={e => setAnno(e.target.value)} inputMode="numeric" className={campo} />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Mese</span>
              <input value={mese} onChange={e => setMese(e.target.value)} inputMode="numeric" className={campo} />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Progressivo</span>
              <input value={progr} onChange={e => setProgr(e.target.value)} placeholder="tutti"
                     inputMode="numeric" className={campo} />
            </label>
          </div>

          <div>
            <span className="text-xs text-slate-400">Ruoli (comparto 1)</span>
            <div className="flex flex-wrap gap-2 mt-1">
              {ruoli.length === 0 && <span className="text-xs text-red-400">Nessun ruolo nelle righe.</span>}
              {ruoli.map(r => (
                <button key={r} type="button" onClick={() => alterna(r)}
                        className={`px-2.5 py-1 rounded-lg border text-xs font-mono transition-colors ${
                          scelti.has(r)
                            ? 'bg-indigo-950/60 border-indigo-700 text-indigo-200'
                            : 'bg-slate-950 border-slate-800 text-slate-500'}`}>
                  {r}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Il risultato si salva sulle righe della lavorazione e resta anche se poi la
            liquidazione in CSA si cancella. Ogni differenza con quello che la riga ha già
            si conferma una per una.
            {!progrOk && <span className="block text-red-400 mt-1">Il progressivo sono tre cifre (es. 040).</span>}
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-800">
          <button onClick={onChiudi} disabled={leggendo}
                  className="text-slate-400 hover:text-slate-200 text-sm">Annulla</button>
          <button onClick={conferma} disabled={!valido || leggendo}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white
                             hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed">
            {leggendo ? 'Lettura da CSA…' : 'Leggi da CSA'}
          </button>
        </div>
      </div>
    </div>
  )
}
