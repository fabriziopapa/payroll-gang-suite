// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · scheda Quote associative
// Quota per anno solare, dovuta per intero anche da chi entra a novembre
// o recede prima. Unica soluzione, mensile o trattenuta in busta paga.
// ============================================================

import { useState } from 'react'
import { cralApi } from '../../api/endpoints'
import type { Persona, QuotaSocio } from './tipi'
import { MESI, MODI_QUOTA, fmtData, fmtEuro, nominativo, norm, oggi, quotaAnno, quotaSocio, rataMese, sociQuota, versatoQuota } from './logica'
import { esportaQuoteExcel } from './ImportDati'
import { Campo, D, Ico, Origine, btnSecondario, cardCls, etichettaCls, inputCls, inputW, thCls, useCral } from './ui'

export function QuoteTab() {
  const { db, esegui, quota, vaiA } = useCral()
  const anni = db.quoteAnno.map(q => q.anno).sort((a, b) => b - a)
  const annoOggi = +oggi().slice(0, 4)
  const [anno, setAnno] = useState(anni.includes(annoOggi) ? annoOggi : anni[0] ?? annoOggi)
  const [cerca, setCerca] = useState('')
  const [modo, setModo] = useState('')
  const [solo, setSolo] = useState('')
  const [meseTr, setMeseTr] = useState(Math.max(0, +oggi().slice(5, 7) - 1))
  if (!anni.length) return <div className={`${cardCls} p-6 text-sm text-slate-400`}>Nessun anno impostato: aggiungilo in Parametri › Quota associativa.</div>
  const imp = quotaAnno(db, anno)
  const tutti = sociQuota(db, anno)
  const q = norm(cerca)
  const lista = tutti.filter(s => (!q || norm(`${nominativo(s)} ${s.id} ${s.tessera}`).includes(q)) && (!modo || quotaSocio(db, anno, s).modo === modo) &&
    (!solo || (solo === 'saldo' ? versatoQuota(db, anno, s) < imp : versatoQuota(db, anno, s) >= imp))).sort((a, b) => nominativo(a).localeCompare(nominativo(b)))
  const dovuto = tutti.length * imp, versato = tutti.reduce((a, s) => a + versatoQuota(db, anno, s), 0)
  const agg = (s: Persona, patch: Partial<QuotaSocio>) => quota(anno, s.id, quotaSocio(db, anno, s), patch)
  const conTratt = tutti.filter(s => quotaSocio(db, anno, s).modo === 'TRATTENUTA')
  const riquadri: Array<[string, string, string]> = [['Soci tenuti', String(tutti.length), 'text-white'], ['Dovuto', fmtEuro(dovuto), 'text-white'], ['Versato', fmtEuro(versato), 'text-emerald-300'], ['Da incassare', fmtEuro(dovuto - versato), dovuto > versato ? 'text-amber-400' : 'text-white']]
  return (
    <div className="flex flex-col gap-4">
      <div className={`${cardCls} p-5 flex flex-wrap gap-4 items-end`}>
        <div className="w-32"><Campo label="Anno"><select className={inputCls} value={anno} onChange={e => setAnno(+e.target.value)}>{anni.map(a => <option key={a} value={a}>{a}</option>)}</select></Campo></div>
        <p className="text-sm text-slate-300 flex-1 min-w-[260px]">Quota {anno}: <b className="text-white tabular-nums">{fmtEuro(imp)}</b> per l'anno solare, oppure 12 rate da <b className="text-white tabular-nums">{fmtEuro(rataMese(imp, 0))}</b>. Si deve <b>per intero</b> anche da chi entra a novembre o recede prima. <button className="text-indigo-400 hover:text-indigo-300" onClick={() => vaiA('parametri')}>Cambia l'importo in Parametri</button></p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {riquadri.map(([l, n, k]) => <div key={l} className={`${cardCls} px-4 py-3`}><p className={etichettaCls}>{l}</p><p className={`text-xl font-semibold tabular-nums mt-1 ${k}`}>{n}</p></div>)}
      </div>
      <div className={`${cardCls} px-5 py-3 flex flex-wrap gap-3 items-center`}>
        <p className="text-sm text-slate-300 flex-1 min-w-[240px]">Trattenute in busta paga: {conTratt.length} soci. Finché il confronto con i cedolini non è pronto, la rata del mese si registra qui.</p>
        <select className={inputW + ' w-32'} value={meseTr} onChange={e => setMeseTr(+e.target.value)}>{MESI.map((m, k) => <option key={m} value={k}>{m} {anno}</option>)}</select>
        <button className={btnSecondario} disabled={!conTratt.length} onClick={() => void esegui(() => cralApi.trattenuta(anno, meseTr + 1, conTratt.map(s => s.id)), `Trattenuta di ${MESI[meseTr]!.toLowerCase()} ${anno} registrata per ${conTratt.length} soci`)}><Ico d={D.check} />Registra la trattenuta del mese</button>
      </div>
      <div className={`${cardCls} overflow-hidden`}>
        <div className="px-5 py-3 border-b border-slate-800 flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[180px]"><input className={inputCls} placeholder="Cerca socio, matricola o tessera…" value={cerca} onChange={e => setCerca(e.target.value)} /></div>
          <button className={btnSecondario} title="Excel con le colonne del T7: si corregge e si ricarica da Importazione › Quote versate (T7)" onClick={() => void esportaQuoteExcel(anno, lista.map(s => s.id))}><Ico d={D.download} />Esporta Excel</button>
          <select className={inputCls + ' sm:w-56'} value={modo} onChange={e => setModo(e.target.value)}><option value="">Tutte le modalità</option>{(Object.keys(MODI_QUOTA) as Array<QuotaSocio['modo']>).map(k => <option key={k} value={k}>{MODI_QUOTA[k]}</option>)}</select>
          <select className={inputCls + ' sm:w-48'} value={solo} onChange={e => setSolo(e.target.value)}><option value="">Tutti</option><option value="saldo">Con saldo da versare</option><option value="ok">In regola</option></select>
        </div>
        <div className="overflow-x-auto max-h-[620px] overflow-y-auto"><table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-900 z-10 text-left text-[11px] uppercase tracking-wider text-slate-500"><tr>
            <th className="px-5 py-2.5 font-semibold">Tessera</th><th className={thCls}>Socio</th><th className={thCls}>Modalità</th><th className={thCls}>Pagamenti</th><th className={thCls + ' text-right'}>Versato</th><th className={thCls + ' text-right'}>Saldo</th><th className={thCls}>Note</th></tr></thead>
          <tbody className="divide-y divide-slate-800/70">
            {lista.map(s => {
              const qs = quotaSocio(db, anno, s), v = versatoQuota(db, anno, s)
              const entra = s.iscrittoIl.slice(0, 10) >= `${anno}-01-01`, esce = s.stato === 'CESSATO' || s.stato === 'ELIMINATO'
              return (
                <tr key={s.id} className="hover:bg-slate-800/30">
                  <td className="px-5 py-2 font-mono text-xs text-slate-400">{s.tessera || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><span className="text-slate-100">{nominativo(s)}</span> {s.tipo === 'SE' && <Origine s={s} />}
                    {(entra || esce) && <div className="text-[11px] text-amber-300/90">{entra ? `entrato il ${fmtData(s.iscrittoIl)}` : ''}{entra && esce ? ' · ' : ''}{esce ? (s.stato === 'ELIMINATO' ? `eliminato il ${fmtData(s.eliminatoIl)} (dovuta per gli anni prima)` : `cessato il ${fmtData(s.cessatoIl)}`) : ''} · quota intera</div>}</td>
                  <td className="px-3 py-1.5"><select className={inputW + ' py-1 text-xs w-48'} value={qs.modo} onChange={e => agg(s, { modo: e.target.value as QuotaSocio['modo'] })}>{(Object.keys(MODI_QUOTA) as Array<QuotaSocio['modo']>).map(k => <option key={k} value={k} disabled={k === 'TRATTENUTA' && !s.matricola}>{MODI_QUOTA[k]}</option>)}</select></td>
                  <td className="px-3 py-1.5">{qs.modo === 'UNICA'
                    ? <label className="inline-flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" className="accent-emerald-500" checked={!!qs.pagataIl} onChange={e => agg(s, { pagataIl: e.target.checked ? oggi() : null })} />{qs.pagataIl ? <>pagata il <input type="date" className="bg-transparent border-b border-slate-700 text-slate-200 text-xs" value={qs.pagataIl} onChange={e => { if (e.target.value) agg(s, { pagataIl: e.target.value }) }} /></> : (v > 0 ? <span className="text-amber-300">versati {fmtEuro(v)} su {fmtEuro(imp)}</span> : 'da pagare')}</label>
                    : <div className="flex gap-0.5">{MESI.map((m, k) => {
                      // importo registrato (T7): pieno = verde, parziale = ambra
                      const v = qs.importi?.[k] ?? 0, parziale = v > 0 && !qs.mesi[k]
                      return <button key={m} title={`${m} ${anno}: rata ${fmtEuro(rataMese(imp, k))}${v ? ` · versati ${fmtEuro(v)}` : ''}${parziale ? ' (da completare)' : ''}`} onClick={() => { const mesi = [...qs.mesi]; mesi[k] = !mesi[k]; agg(s, { mesi }) }}
                        className={`w-7 h-7 rounded text-[10px] font-semibold border ${qs.mesi[k] ? 'bg-emerald-700/70 border-emerald-600 text-white' : parziale ? 'bg-amber-900/50 border-amber-700 text-amber-200' : 'bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-600'}`}>{m.slice(0, 1)}</button>
                    })}</div>}</td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-slate-200">{fmtEuro(v)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${imp - v > 0 ? 'text-amber-400' : 'text-slate-500'}`}>{fmtEuro(imp - v)}</td>
                  <td className="px-3 py-1.5"><input maxLength={300} className={inputCls + ' py-1 text-xs min-w-[130px]'} defaultValue={qs.note} key={`${s.id}-${qs.note}`} onBlur={e => { if (e.target.value !== qs.note) agg(s, { note: e.target.value }) }} /></td>
                </tr>)
            })}
            {!lista.length && <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-500">Nessun socio con questi filtri.</td></tr>}
          </tbody></table></div>
        <p className="px-5 py-3 border-t border-slate-800 text-xs text-slate-500">Tenuti alla quota: soci dipendenti e soci esterni iscritti entro il 31/12 e non cessati prima del 1/1. Gli eliminati non la devono dall'anno dell'eliminazione (gli anni prima restano dovuti, e quelli passati da eliminati restano esenti anche dopo il ripristino). Esterni e familiari non sono soci e non la pagano. «Trattenuta in busta paga» solo per chi ha la matricola. Il versato è la somma degli importi registrati: un mese è pagato quando l'importo copre la rata (in ambra se parziale), un solo versamento della quota annua paga tutto l'anno. A mano: un clic sul mese registra la rata o la toglie. In massa: Importazione › Quote versate (T7). Il confronto con le trattenute dei cedolini è tra i lavori da fare (voci da individuare).</p>
      </div>
    </div>
  )
}
