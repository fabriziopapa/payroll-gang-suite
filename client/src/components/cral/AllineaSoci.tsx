// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · «Allinea soci» (26.11.14.3)
//
// I soci tenuti alla quota di un anno non sono una lista salvata: si
// ricavano dall'anagrafica (iscritto entro il 31/12, non cessato prima del
// 1/1). Qui si corregge a mano, anno per anno, la quota di chi non deve
// pagare:
//   · Esente      socio vero che il CRAL non fa pagare: resta in elenco;
//   · Non dovuta  inserito per errore: esce dall'elenco di quell'anno.
// La persona non cambia in Soci e negli eventi, e i versamenti gia'
// registrati restano. Nulla si scrive finche' non si approvano le
// differenze; «Dovuta» rimette tutto com'era.
// ============================================================

import { useState } from 'react'
import { cralApi } from '../../api/endpoints'
import type { Persona, StatoQuota } from './tipi'
import { STATI_QUOTA, differenzeQuote, fmtEuro, motivoQuota, nominativo, norm, noteQuota, quotaAnno, sociAnno, statoQuota, versatoQuota } from './logica'
import { Modale, Origine, Scorrevole, btnPiccoloSec, btnPrimario, btnSecondario, chipCls, etichettaCls, inputCls, thCls, useCral } from './ui'

const ORDINE: StatoQuota[] = ['DOVUTA', 'ESENTE', 'NON_DOVUTA']
const SPIEGA: Record<StatoQuota, string> = {
  DOVUTA: 'Il caso normale: il socio deve la quota di quest\'anno',
  ESENTE: 'Socio che quest\'anno non paga: resta in elenco, non entra nel dovuto',
  NON_DOVUTA: 'Inserito per errore: esce dall\'elenco e dal dovuto di quest\'anno',
}
type Vista = 'guardare' | 'tutti' | 'fuori'

export function AllineaSoci({ anno, onClose }: { anno: number; onClose: () => void }) {
  const { db, esegui } = useCral()
  const [scelte, setScelte] = useState<Record<string, StatoQuota>>({})
  // motivo ripreso dall'anno prima per chi viene riproposto esente
  const [motivi, setMotivi] = useState<Record<string, string>>({})
  const [motivo, setMotivo] = useState('')
  const [cerca, setCerca] = useState('')
  const [vista, setVista] = useState<Vista>('guardare')
  const imp = quotaAnno(db, anno)
  const soci = sociAnno(db, anno)
  const corrente = (s: Persona) => statoQuota(db, anno, s)
  const scelto = (s: Persona) => scelte[s.id] ?? corrente(s)
  const guardare = (s: Persona) => noteQuota(db, anno, s).length > 0 || corrente(s) !== 'DOVUTA' || s.id in scelte
  const fuori = (s: Persona) => scelto(s) !== 'DOVUTA' || s.id in scelte
  const q = norm(cerca)
  // con un nome scritto si cerca fra tutti i soci dell'anno, qualunque sia la vista
  const lista = soci.filter(s => (q ? norm(`${nominativo(s)} ${s.id} ${s.tessera}`).includes(q) : vista === 'tutti' || (vista === 'fuori' ? fuori(s) : guardare(s))))
    .sort((a, b) => nominativo(a).localeCompare(nominativo(b)))
  const exEsenti = soci.filter(s => scelto(s) === 'DOVUTA' && statoQuota(db, anno - 1, s) === 'ESENTE')

  const scegli = (s: Persona, st: StatoQuota) => {
    const { [s.id]: _tolta, ...resto } = scelte
    setScelte(st === corrente(s) ? resto : { ...resto, [s.id]: st })
    if (st !== 'ESENTE' && s.id in motivi) { const { [s.id]: _m, ...altri } = motivi; setMotivi(altri) }
  }
  const riproponi = () => {
    setScelte({ ...scelte, ...Object.fromEntries(exEsenti.map(s => [s.id, 'ESENTE' as StatoQuota])) })
    setMotivi({ ...motivi, ...Object.fromEntries(exEsenti.map(s => [s.id, motivoQuota(db, anno - 1, s)]).filter(([, m]) => m)) })
    setVista('fuori')
  }

  const { diff, prima, dopo } = differenzeQuote(db, anno, scelte)
  const motivoDi = (id: string, st: StatoQuota) => (st === 'DOVUTA' ? '' : (motivi[id] || motivo.trim()))
  const manca = diff.some(x => x.dopo !== 'DOVUTA' && !motivoDi(x.s.id, x.dopo))
  const serveMotivo = diff.some(x => x.dopo !== 'DOVUTA' && !motivi[x.s.id])
  const delta = (dopo - prima) * imp
  const approva = () => {
    void esegui(() => cralApi.allineaQuote(anno, diff.map(x => ({ socio: x.s.id, stato: x.dopo, motivo: motivoDi(x.s.id, x.dopo) }))),
      r => `Quote ${anno}: ${r.fatte === 1 ? '1 differenza applicata' : `${r.fatte} differenze applicate`}`).then(r => { if (r !== null) onClose() })
  }
  const VISTE: Array<[Vista, string, number]> = [['guardare', 'Da guardare', soci.filter(guardare).length], ['fuori', 'Esenti e non dovute', soci.filter(fuori).length], ['tutti', `Tutti i soci del ${anno}`, soci.length]]

  return (
    <Modale largo titolo={`Allinea soci · quota ${anno}`} sotto={`Quota ${fmtEuro(imp)}. Segna la quota di chi quest'anno non deve pagare: la persona resta com'è in Soci e negli eventi.`} onClose={onClose}
      piedi={<><button className={btnSecondario} onClick={onClose}>Annulla</button><button className={btnPrimario} disabled={!diff.length || manca} onClick={approva}>{diff.length === 1 ? 'Approva 1 differenza' : `Approva ${diff.length} differenze`}</button></>}>
      <div className="flex flex-col gap-3">
        <ul className="text-xs text-slate-400 space-y-0.5">
          <li><b className="text-slate-200">Esente</b>: socio vero che il CRAL non fa pagare. Resta nell'elenco dell'anno, non entra nel dovuto.</li>
          <li><b className="text-slate-200">Non dovuta</b>: inserito per errore, quell'anno non andava contato. Esce dall'elenco e dal dovuto.</li>
          <li>Vale solo per il {anno}. I versamenti già registrati restano dove sono. «Dovuta» rimette tutto com'era.</li>
        </ul>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex-1 min-w-[180px]"><input className={inputCls} placeholder="Cerca socio, matricola o tessera fra tutti i soci dell'anno…" value={cerca} onChange={e => setCerca(e.target.value)} /></div>
          {VISTE.map(([k, l, n]) => <button key={k} className={chipCls(!q && vista === k)} aria-pressed={!q && vista === k} onClick={() => { setVista(k); setCerca('') }}>{l} <span className="text-slate-500 tabular-nums">{n}</span></button>)}
        </div>
        {exEsenti.length > 0 && <div className="rounded-lg border border-slate-800 px-3 py-2 flex flex-wrap gap-3 items-center">
          <p className="text-xs text-slate-300 flex-1 min-w-[220px]">{exEsenti.length === 1 ? '1 socio era esente' : `${exEsenti.length} soci erano esenti`} nel {anno - 1} e nel {anno} {exEsenti.length === 1 ? 'risulta' : 'risultano'} con la quota dovuta.</p>
          <button className={btnPiccoloSec} onClick={riproponi}>Riproponi come esenti, col motivo del {anno - 1}</button>
        </div>}
        <div className="rounded-lg border border-slate-800 overflow-hidden">
          <Scorrevole className="max-h-[340px]"><table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900 z-10 text-left text-[11px] uppercase tracking-wider text-slate-500"><tr>
              <th className="px-4 py-2.5 font-semibold">Tessera</th><th className={thCls}>Socio</th><th className={thCls + ' text-right'}>Versato</th><th className={thCls}>Quota {anno}</th></tr></thead>
            <tbody className="divide-y divide-slate-800/70">
              {lista.map(s => {
                const cur = corrente(s), sc = scelto(s), note = noteQuota(db, anno, s), v = versatoQuota(db, anno, s), mot = motivoQuota(db, anno, s)
                return (
                  <tr key={s.id} className={s.id in scelte ? 'bg-indigo-950/30' : 'hover:bg-slate-800/30'}>
                    <td className="px-4 py-2 font-mono text-xs text-slate-400">{s.tessera || '—'}</td>
                    <td className="px-3 py-2"><span className="text-slate-100">{nominativo(s)}</span> {s.tipo === 'SE' && <Origine s={s} />}
                      {note.length > 0 && <div className="text-[11px] text-amber-300/90">{note.join(' · ')}</div>}
                      {cur !== 'DOVUTA' && <div className="text-[11px] text-slate-400">oggi {STATI_QUOTA[cur].toLowerCase()}{mot ? `: ${mot}` : ''}</div>}</td>
                    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${v > 0 ? 'text-slate-200' : 'text-slate-600'}`}>{fmtEuro(v)}</td>
                    <td className="px-3 py-1.5"><div className="flex flex-wrap gap-1" role="group" aria-label={`Quota ${anno} di ${nominativo(s)}`}>
                      {ORDINE.map(st => <button key={st} className={chipCls(sc === st)} aria-pressed={sc === st} title={SPIEGA[st]} onClick={() => scegli(s, st)}>{STATI_QUOTA[st]}</button>)}</div></td>
                  </tr>)
              })}
              {!lista.length && <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-500">{q ? `Nessun socio del ${anno} con questo nome.` : vista === 'guardare' ? `Nessun caso da guardare: nessuno è entrato o uscito nel ${anno}. Passa a «Tutti i soci del ${anno}» o cerca un nome.` : vista === 'fuori' ? `Nessuna quota esente o non dovuta nel ${anno}.` : `Nessun socio tenuto alla quota ${anno}.`}</td></tr>}
            </tbody></table></Scorrevole>
        </div>
        <div className="rounded-lg border border-slate-800 p-4 flex flex-col gap-3">
          <span className={etichettaCls}>Differenze da approvare</span>
          {!diff.length ? <p className="text-sm text-slate-500">Nessuna: scegli «Esente», «Non dovuta» o «Dovuta» accanto a un socio.</p> : <>
            <ul className="text-sm space-y-1">
              {diff.map(x => <li key={x.s.id} className="flex flex-wrap gap-x-2 items-baseline">
                <span className="text-slate-100">{nominativo(x.s)}</span>
                <span className="text-slate-400">{STATI_QUOTA[x.prima]} → <b className="text-white">{STATI_QUOTA[x.dopo]}</b></span>
                {motivi[x.s.id] && x.dopo !== 'DOVUTA' && <span className="text-xs text-slate-500">motivo del {anno - 1}: {motivi[x.s.id]}</span>}
                {x.versato > 0 && x.dopo !== 'DOVUTA' && <span className="text-xs text-red-300">ha già versato {fmtEuro(x.versato)}: l'importo resta registrato</span>}
                <button className="text-xs text-slate-500 hover:text-slate-300" onClick={() => scegli(x.s, x.prima)}>annulla</button>
              </li>)}
            </ul>
            <p className="text-sm text-slate-300 tabular-nums">Quote dovute: <b className="text-white">{prima}</b> → <b className="text-white">{dopo}</b> · Dovuto {anno}: <b className={delta < 0 ? 'text-amber-400' : 'text-white'}>{delta > 0 ? '+' : delta < 0 ? '−' : ''}{fmtEuro(Math.abs(delta))}</b></p>
            {serveMotivo && <label className="flex flex-col gap-1"><span className={etichettaCls}>Motivo (obbligatorio)</span>
              <input className={inputCls} maxLength={200} placeholder="Es. inserita per errore, non si è mai iscritta · socio onorario, delibera del direttivo" value={motivo} onChange={e => setMotivo(e.target.value)} />
              {manca && <span className="text-xs text-red-300">Scrivi il motivo: resta sulla quota e si vede nell'elenco.</span>}</label>}
          </>}
        </div>
      </div>
    </Modale>
  )
}
