// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · scheda Report
// Interruttori per colonna, anteprima, CSV (punto e virgola, UTF-8 con
// BOM, si apre in Excel) e PDF A4. Tutto nel browser.
// ============================================================

import { Fragment, useMemo, useState } from 'react'
import type { Richiesta } from './tipi'
import { GRUPPI, TIPOLOGIE, creaCsv, fmtData, oggi, sedeBreve } from './logica'
import { MODI_QUOTA, STATI_RIC_ETICH, costruisciReport, creaPdf, tipiAmmessi, type CfgReport } from './report'
import { Campo, D, Ico, Interruttore, avviso, btnPrimario, btnSecondario, cardCls, chipCls, etichettaCls, inputCls, scarica, sceltaCls, useCral } from './ui'

export function ReportTab() {
  const { db, utente } = useCral()
  const prima = db.iniziative.find(i => i.stato === 'APERTA' && !i.archiviata)?.id ?? db.iniziative[0]?.id ?? ''
  const [cfg, setCfg] = useState<CfgReport>({
    tipo: 'riepilogo', ini: prima, sedi: [], origine: '', pred: true, tessera: true, consegnato: true, pagato: true, note: true, firma: false,
    colSoci: { sede: true, id: true, nom: true }, sedeScelte: true, ordinaPer: 'nom', paginaPerSede: true, soloMancanti: false, inclusiVuoti: false,
    soloDaPagare: false, soloSaldo: false, includiTolte: false, presenze: true, aCarico: true, perRif: true, eta: false, anno: +oggi().slice(0, 4), qmodo: '', mesi: true, statoRic: '',
  })
  const [pdfInCorso, setPdfInCorso] = useState(false)
  const oggiIso = oggi()
  const rep = useMemo(() => costruisciReport(db, cfg, oggiIso), [db, cfg, oggiIso])
  const ini = db.iniziative.find(i => i.id === cfg.ini)
  const set = (p: Partial<CfgReport>) => setCfg({ ...cfg, ...p })
  const senzaIni = cfg.tipo === 'soci' || cfg.tipo === 'quote'
  const nomeBase = `CRAL_${cfg.tipo === 'soci' ? 'soci' : cfg.tipo === 'quote' ? `quote_${cfg.anno}` : (ini?.titolo ?? '').replace(/\W+/g, '_')}_${cfg.tipo}_${oggiIso}`
  const ord = ini?.modalita === 'ORDINE'
  const modR = ini?.modalita
  const turniMag = !senzaIni && (modR === 'TURNI' || modR === 'MAGAZZINO')
  const TIPI_REP = tipiAmmessi(ini)
  const csv = () => creaCsv(rep.intest, rep.righe)
  async function pdf() {
    setPdfInCorso(true)
    try { scarica(`${nomeBase}.pdf`, await creaPdf(rep, cfg, utente, oggiIso)) }
    catch { avviso('PDF non generato: riprova.', 'error') }
    finally { setPdfInCorso(false) }
  }
  const anni = [...db.quoteAnno].sort((a, b) => b.anno - a.anno)
  return (
    <div className="grid lg:grid-cols-[320px_minmax(0,1fr)] gap-4 items-start">
      <div className={`${cardCls} p-5 flex flex-col gap-4`}>
        <div className="flex flex-col gap-2"><span className={etichettaCls}>Report</span>
          {TIPI_REP.map(([k, t, d]) => <button key={k} onClick={() => set({ tipo: k })} className={sceltaCls(cfg.tipo === k)}><p className="text-sm font-medium text-white">{t}</p><p className="text-xs text-slate-500">{d}</p></button>)}</div>
        {!senzaIni && <Campo label="Evento"><select className={inputCls} value={cfg.ini} onChange={e => { const n = db.iniziative.find(i => i.id === e.target.value); const ammessi = tipiAmmessi(n).map(x => x[0]); set({ ini: e.target.value, tipo: ammessi.includes(cfg.tipo) ? cfg.tipo : 'riepilogo' }) }}>{db.iniziative.map(i => <option key={i.id} value={i.id}>{i.titolo}{i.archiviata ? ' (archiviato)' : ''}</option>)}</select></Campo>}
        {!turniMag && <div><span className={etichettaCls}>Sedi</span>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <button onClick={() => set({ sedi: [] })} className={chipCls(!cfg.sedi.length)}>Tutte</button>
            {db.sedi.map(s => { const on = cfg.sedi.includes(s.id); return <button key={s.id} onClick={() => set({ sedi: on ? cfg.sedi.filter(x => x !== s.id) : [...cfg.sedi, s.id] })} className={chipCls(on)}>{sedeBreve(s.nome)}</button> })}
            <button onClick={() => { const on = cfg.sedi.includes('__NOSEDE'); set({ sedi: on ? cfg.sedi.filter(x => x !== '__NOSEDE') : [...cfg.sedi, '__NOSEDE'] }) }} className={chipCls(cfg.sedi.includes('__NOSEDE'))}>Senza sede</button>
          </div></div>}
        {(senzaIni || (cfg.tipo === 'scelte' && modR !== 'MAGAZZINO')) && <div className="grid grid-cols-2 gap-3">
          <Campo label="Tipologia"><select className={inputCls} value={cfg.origine} onChange={e => set({ origine: e.target.value })}><option value="">Tutte</option>{(senzaIni ? ['SD', 'SE'] as const : GRUPPI).map(g => <option key={g} value={g}>{TIPOLOGIE[g][0]}</option>)}</select></Campo>
          <Campo label="Ordina per"><select className={inputCls} value={cfg.ordinaPer} onChange={e => set({ ordinaPer: e.target.value as CfgReport['ordinaPer'] })}><option value="nom">Nominativo</option><option value="tessera">Tessera</option><option value="id">ID</option><option value="tip">Tipologia</option></select></Campo>
        </div>}
        {!senzaIni && modR === 'TURNI' && <div className="flex flex-col gap-2.5">
          {cfg.tipo === 'scelte' && <Interruttore on={cfg.soloSaldo} onChange={v => set({ soloSaldo: v })} label="Solo chi ha un saldo da versare" />}
          {cfg.tipo === 'settimane' && <Interruttore on={cfg.includiTolte} onChange={v => set({ includiTolte: v })} label="Includi le settimane tolte" />}
          {cfg.tipo !== 'riepilogo' && <><span className={etichettaCls + ' pt-1'}>Colonne</span>
            <Interruttore on={cfg.perRif} onChange={v => set({ perRif: v })} label={cfg.tipo === 'scelte' ? 'Raggruppa per socio/dipendente (con totale famiglia)' : 'Ordina per socio/dipendente, poi iscritto'} />
            {!(cfg.tipo === 'scelte' && cfg.perRif) && <Interruttore on={cfg.aCarico} onChange={v => set({ aCarico: v })} label="Colonna Riferimento (socio o dipendente)" />}
            {cfg.tipo === 'settimane' && <Interruttore on={cfg.presenze} onChange={v => set({ presenze: v })} label="Presenze Lun–Ven (da compilare)" />}
            {cfg.tipo === 'scelte' && <Interruttore on={cfg.note} onChange={v => set({ note: v })} label="Note" />}
            <Interruttore on={cfg.firma} onChange={v => set({ firma: v })} label="Firma" />
            {cfg.tipo === 'settimane' && <Interruttore on={cfg.paginaPerSede} onChange={v => set({ paginaPerSede: v })} label="PDF: una pagina per settimana" />}</>}
        </div>}
        {!senzaIni && modR === 'MAGAZZINO' && cfg.tipo === 'scelte' && <div className="flex flex-col gap-2.5">
          <Campo label="Stato"><select className={inputCls} value={cfg.statoRic} onChange={e => set({ statoRic: e.target.value as CfgReport['statoRic'] })}><option value="">Tutte</option>{(Object.keys(STATI_RIC_ETICH) as Array<Richiesta['stato']>).map(k => <option key={k} value={k}>{STATI_RIC_ETICH[k]}</option>)}</select></Campo>
          <Interruttore on={cfg.firma} onChange={v => set({ firma: v })} label="Firma per ricevuta" />
        </div>}
        {cfg.tipo === 'quote' && <div className="flex flex-col gap-2.5">
          <div className="grid grid-cols-2 gap-3"><Campo label="Anno"><select className={inputCls} value={cfg.anno} onChange={e => set({ anno: +e.target.value })}>{anni.map(q => <option key={q.anno} value={q.anno}>{q.anno}</option>)}</select></Campo>
            <Campo label="Modalità"><select className={inputCls} value={cfg.qmodo} onChange={e => set({ qmodo: e.target.value as CfgReport['qmodo'] })}><option value="">Tutte</option>{(Object.keys(MODI_QUOTA) as Array<keyof typeof MODI_QUOTA>).map(k => <option key={k} value={k}>{MODI_QUOTA[k]}</option>)}</select></Campo></div>
          <Interruttore on={cfg.soloSaldo} onChange={v => set({ soloSaldo: v })} label="Solo chi ha un saldo da versare" />
          <span className={etichettaCls + ' pt-1'}>Colonne</span>
          <Interruttore on={cfg.mesi} onChange={v => set({ mesi: v })} label="Mesi pagati (Gen … Dic)" />
          <Interruttore on={cfg.tessera} onChange={v => set({ tessera: v })} label="Tessera" />
          <Interruttore on={cfg.note} onChange={v => set({ note: v })} label="Note" />
          <Interruttore on={cfg.firma} onChange={v => set({ firma: v })} label="Firma" />
          <p className="text-[11px] text-slate-500">Il confronto con le trattenute in busta paga verrà dopo (voci da individuare): questo report è la base.</p>
        </div>}
        {cfg.tipo !== 'quote' && (cfg.tipo === 'soci' || !turniMag) && <div className="flex flex-col gap-2.5">
          {cfg.tipo !== 'soci' && !ord && !!ini?.predefinita && <Interruttore on={cfg.pred} onChange={v => set({ pred: v })} label="Chi non ha scelto → opzione predefinita" />}
          {cfg.tipo === 'scelte' && !ord && modR === 'SCELTA' && <Interruttore on={cfg.soloMancanti} onChange={v => set({ soloMancanti: v })} label="Solo chi non ha scelto (per i solleciti)" />}
          {cfg.tipo === 'scelte' && ord && <>
            <Interruttore on={cfg.inclusiVuoti} onChange={v => set({ inclusiVuoti: v })} label="Includi chi non ha ordinato (foglio da compilare)" />
            <Interruttore on={cfg.soloDaPagare} onChange={v => set({ soloDaPagare: v })} label="Solo chi deve ancora pagare" />
          </>}
          {(cfg.tipo === 'soci' || cfg.tipo === 'scelte') && <span className={etichettaCls + ' pt-1'}>Colonne</span>}
          {cfg.tipo === 'soci' && <>
            <Interruttore on={cfg.colSoci.sede} onChange={v => set({ colSoci: { ...cfg.colSoci, sede: v } })} label="Sede (raggruppa per sede, poi ordina)" />
            <Interruttore on={cfg.colSoci.id} onChange={v => set({ colSoci: { ...cfg.colSoci, id: v } })} label="ID socio" />
          </>}
          {cfg.tipo === 'scelte' && <Interruttore on={cfg.sedeScelte} onChange={v => set({ sedeScelte: v })} label="Sede (raggruppa per sede, poi ordina)" />}
          {(cfg.tipo === 'soci' || cfg.tipo === 'scelte') && <Interruttore on={cfg.tessera} onChange={v => set({ tessera: v })} label="Tessera" />}
          {cfg.tipo === 'soci' && <Interruttore on={cfg.colSoci.nom} onChange={v => set({ colSoci: { ...cfg.colSoci, nom: v } })} label="Nominativo" />}
          {cfg.tipo === 'scelte' && ord && <Interruttore on={cfg.pagato} onChange={v => set({ pagato: v })} label="Pagato (Sì/No)" />}
          {cfg.tipo === 'scelte' && <Interruttore on={cfg.consegnato} onChange={v => set({ consegnato: v })} label="Consegnato (Sì/No)" />}
          {cfg.tipo === 'scelte' && ord && <Interruttore on={cfg.note} onChange={v => set({ note: v })} label="Note" />}
          {(cfg.tipo === 'soci' || cfg.tipo === 'scelte') && <Interruttore on={cfg.firma} onChange={v => set({ firma: v })} label="Firma" />}
          {((cfg.tipo === 'soci' && cfg.colSoci.sede) || (cfg.tipo === 'scelte' && cfg.sedeScelte)) && <Interruttore on={cfg.paginaPerSede} onChange={v => set({ paginaPerSede: v })} label="PDF: una pagina per sede" />}
        </div>}
        {(['soci', 'scelte', 'settimane', 'quote'].includes(cfg.tipo)) && <div className="flex flex-col gap-1"><Interruttore on={cfg.eta} onChange={v => set({ eta: v })} label="Colonna Età" />
          <p className="text-[11px] text-slate-500 pl-11">{senzaIni ? `Anni compiuti a oggi (${fmtData(oggiIso)})` : modR === 'MAGAZZINO' ? 'Anni compiuti alla data della richiesta' : `Anni compiuti alla data dell'evento (${fmtData(ini?.data)})`}, dalla data di nascita. Vuota se manca.</p></div>}
        <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-800">
          <button className={btnPrimario} disabled={!rep.righe.length} onClick={() => scarica(`${nomeBase}.csv`, new Blob([csv()], { type: 'text/csv;charset=utf-8' }))}><Ico d={D.download} />CSV</button>
          <button className={btnPrimario} disabled={!rep.righe.length || pdfInCorso} onClick={() => void pdf()}><Ico d={D.download} />{pdfInCorso ? 'PDF…' : 'PDF'}</button>
          <button className={btnSecondario} disabled={!rep.righe.length} onClick={() => { navigator.clipboard?.writeText(csv().slice(1)).then(() => avviso('CSV copiato negli appunti')).catch(() => avviso('Copia non consentita dal browser.', 'warning')) }}><Ico d={D.copy} />Copia</button>
        </div>
        <p className="text-[11px] text-slate-500">CSV con punto e virgola, UTF-8 con BOM: si apre direttamente in Excel. PDF A4, {rep.intest.length > 5 ? 'orizzontale' : 'verticale'}.</p>
      </div>
      <div className={`${cardCls} overflow-hidden min-w-0`}>
        <div className="px-5 py-3 border-b border-slate-800 flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-white flex-1">{rep.titolo}</p><span className="text-xs text-slate-500 tabular-nums">{rep.totale ? Math.max(0, rep.righe.length - 1) : rep.righe.length} righe</span></div>
        <div className="overflow-x-auto max-h-[640px] overflow-y-auto"><table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-900 text-left text-[11px] uppercase tracking-wider text-slate-500">
            {rep.sopra && <tr>{(() => {
              const out: Array<{ t: string; n: number }> = []
              rep.sopra.forEach(l => { const u = out[out.length - 1]; if (l && u && u.t === l) u.n++; else out.push({ t: l, n: 1 }) })
              return out.map((c, k) => <th key={k} colSpan={c.n} className={`px-3 pt-2 pb-1 font-semibold text-center ${c.t ? 'text-pink-300/90 border-b border-slate-800' : ''}`}>{c.t}</th>)
            })()}</tr>}
            <tr>{(rep.breve ?? rep.intest).map((h, k) => <th key={k} className={`px-3 py-2.5 font-semibold whitespace-nowrap ${rep.sopra?.[k] ? 'normal-case tracking-normal' : ''} ${k === 0 ? 'pl-5' : ''} ${(rep.totale && k > 0) || rep.numCols?.has(k) ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-800/70 tabular-nums">
            {rep.righe.slice(0, 500).map((r, i) => {
              const nuovoGruppo = rep.gruppi && (i === 0 || rep.righe[i - 1]?.[0] !== r[0])
              return (
                <Fragment key={i}>
                  {nuovoGruppo && <tr className="bg-slate-800/40"><td colSpan={rep.intest.length} className="px-5 py-1.5 text-xs font-semibold text-indigo-300">{r[0]} <span className="text-slate-500 font-normal">· {rep.righe.filter((x, j) => x[0] === r[0] && !rep.bold?.has(j)).length}</span></td></tr>}
                  <tr className={(rep.totale && i === rep.righe.length - 1) || rep.bold?.has(i) ? 'font-semibold bg-slate-800/40' : ''}>{r.map((c, k) => <td key={k} className={`px-3 py-1.5 whitespace-nowrap ${k === 0 ? 'pl-5' : ''} ${rep.gruppi && k === 0 ? 'text-slate-600 text-xs' : 'text-slate-200'} ${(rep.totale && k > 0) || rep.numCols?.has(k) ? 'text-right' : ''} ${c === 'Non indicata' ? 'text-amber-400' : ''}`}>{rep.gruppi && k === 0 ? '' : (c === '' && rep.intest[k]?.startsWith('Firma') ? <span className="inline-block w-32 border-b border-slate-700" /> : c)}</td>)}</tr>
                </Fragment>)
            })}
            {!rep.righe.length && <tr><td colSpan={rep.intest.length || 1} className="px-5 py-10 text-center text-slate-500">{rep.vuoto ?? 'Nessun dato con questi filtri.'}</td></tr>}
          </tbody>
        </table></div>
        {rep.righe.length > 500 && <p className="px-5 py-2 border-t border-slate-800 text-xs text-slate-500">Anteprima delle prime 500 righe: CSV e PDF le contengono tutte.</p>}
      </div>
    </div>
  )
}
