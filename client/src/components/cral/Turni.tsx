// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · modalità TURNI (campi estivi)
// Settimane a quota piena con sconti per tipologia della persona di
// riferimento (bloccata all'iscrizione). Prima il socio o dipendente,
// sotto i suoi iscritti, con il totale della famiglia.
// ============================================================

import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { cralApi } from '../../api/endpoints'
import type { Iniziativa, PatchScelta, Persona, StatoPeriodo } from './tipi'
import {
  CAT_SCONTO_1, GRUPPI, RELAZIONI, TIPOLOGIE, aCaricoDi, agganciaPersona, catSconto, contiTurni, dovutoTurni, etichettaPers, fmtData,
  fmtEuro, fmtImp, fmtSconto, ggmm, haSconto, iscrittoTurni, nominativo, norm, normNome, occupati, oggi, pagaPer, parseEuro, periodiDovuti,
  persDi, persona, quotaDi, regolaCat, regolaTurni, relDi, riassuntoSconti, rifAutomatico, rifDi, sociDi, statoPer,
} from './logica'
import { ScontoPersonaleModal } from './Sconti'
import { SceltaFile, useFoglio } from './ImportEvento'
import { D, Ico, Modale, Origine, Pill, avviso, btnPrimario, btnSecondario, cardCls, etichettaCls, inputCls, inputW, thCls, useCral } from './ui'

const STATI_PER: Record<StatoPeriodo, [string, string]> = {
  '': ['—', 'text-slate-500'], P: ['Prenotata', 'text-indigo-300 border-indigo-700'], F: ['Frequentata', 'text-emerald-300 border-emerald-700'], T: ['Tolta', 'text-red-300 border-red-900 line-through'],
}
export type NomeCella = (s: Persona, o?: { rientro?: boolean; sotto?: ReactNode }) => ReactNode

export function TurniCorpo({ ini, chiusa, nomeCella }: { ini: Iniziativa; chiusa: boolean; nomeCella: NomeCella }) {
  const { db, scelta } = useCral()
  const [cerca, setCerca] = useState('')
  const [solo, setSolo] = useState(ini.modoPart === 'SINGOLI' ? '' : 'iscritti')
  const [ord, setOrd] = useState('nom')
  const [vista, setVista] = useState('rif')
  const [rifPer, setRifPer] = useState<Persona | null>(null)
  const [spPer, setSpPer] = useState<Persona | null>(null)
  const c = useMemo(() => contiTurni(db, ini), [db, ini])
  const q = norm(cerca)
  const ver = (s: Persona) => ini.scelte[s.id]?.versato ?? 0
  const saldo = (s: Persona) => dovutoTurni(db, ini, s) - ver(s)
  const cmp = (a: Persona, b: Persona) => (ord === 'saldo' ? saldo(b) - saldo(a) : ord === 'tip' ? GRUPPI.indexOf(a.tipo) - GRUPPI.indexOf(b.tipo) : 0) || nominativo(a).localeCompare(nominativo(b))
  const lista = c.dest.filter(s => (!q || norm(`${nominativo(s)} ${s.id} ${aCaricoDi(db, ini, s)}`).includes(q)) &&
    (!solo || (solo === 'iscritti' ? iscrittoTurni(ini, s.id) : solo === 'saldo' ? saldo(s) > 0 : solo === 'forzati' ? !!persDi(ini, s.id) : pagaPer(statoPer(ini, s.id, solo))))).sort(cmp)
  // Raggruppamento: prima il dipendente/socio di riferimento, sotto i suoi familiari iscritti
  const mappa = new Map<string, { k: string; r: Persona | null; membri: Persona[] }>()
  for (const s of lista) { const r = rifDi(db, ini, s); const k = r?.id ?? '__NONE'; const g = mappa.get(k) ?? { k, r, membri: [] }; g.membri.push(s); mappa.set(k, g) }
  const somma = (g: { membri: Persona[] }, f: (s: Persona) => number) => g.membri.reduce((a, s) => a + f(s), 0)
  const gruppi = [...mappa.values()].sort((a, b) => (Number(a.k === '__NONE') - Number(b.k === '__NONE')) || (ord === 'saldo' ? somma(b, saldo) - somma(a, saldo) : 0) || (a.r && b.r ? nominativo(a.r).localeCompare(nominativo(b.r)) : 0))
  const aggiorna = (sid: string, patch: PatchScelta) => scelta(ini.id, sid, patch)
  function setPer(s: Persona, pid: string, v: StatoPeriodo) {
    const p = ini.periodi.find(x => x.id === pid); if (!p) return
    const prima = statoPer(ini, s.id, pid)
    if (pagaPer(v) && !pagaPer(prima) && p.posti && occupati(db, ini, pid) >= p.posti) { avviso(`${p.nome} è al completo (${p.posti} posti).`, 'error'); return }
    // alla prima settimana prenotata si blocca la categoria per lo sconto (data d'iscrizione)
    const iscr = ini.scelte[s.id]?.iscr ?? (pagaPer(v) ? { data: oggi(), cat: catSconto(rifDi(db, ini, s)) } : undefined)
    aggiorna(s.id, { per: { ...(ini.scelte[s.id]?.per ?? {}), [pid]: v }, ...(iscr ? { iscr } : {}) })
  }
  const nPer = ini.periodi.length
  const pillCat = (cat: ReturnType<typeof catSconto>) => { const r = regolaCat(ini, cat); return r ? <Pill tono="ok">sconto {fmtSconto(r)}</Pill> : <Pill>quota piena</Pill> }
  const sottoRiga = (s: Persona) => {
    const r = rifDi(db, ini, s); const rel = s.tipo === 'FAM' && r ? relDi(s, r.id) : undefined; const isc = ini.scelte[s.id]?.iscr
    return <div className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap mt-0.5">
      {vista === 'elenco' ? (r && r.id !== s.id ? <span>rif. {nominativo(r)} · {CAT_SCONTO_1[catSconto(r)]}</span> : !r ? <span>nessun riferimento</span> : null) : (rel ? <span>{RELAZIONI[rel]}</span> : r?.id === s.id ? <span>partecipa in prima persona</span> : null)}
      {isc && <span title={`Categoria bloccata: ${CAT_SCONTO_1[isc.cat]}`}>iscritto il {fmtData(isc.data)}</span>}
      {!chiusa && <button className="text-indigo-300 hover:text-indigo-200 underline-offset-2 hover:underline" onClick={() => setRifPer(s)}>cambia riferimento</button>}
    </div>
  }
  const riga = (s: Persona, rientro: boolean) => {
    const sc1 = ini.scelte[s.id]; const dov = dovutoTurni(db, ini, s); const v = ver(s); const pers = persDi(ini, s.id)
    const oggiCat = catSconto(rifDi(db, ini, s))
    return (
      <tr key={s.id} className="hover:bg-slate-800/30">
        {nomeCella(s, { rientro, sotto: sottoRiga(s) })}
        <td className="px-3 py-1.5 whitespace-nowrap">
          <div className={`text-xs tabular-nums ${haSconto(db, ini, s) ? 'text-emerald-300' : 'text-slate-200'}`} title={sc1?.iscr ? `Sconto deciso all'iscrizione del ${fmtData(sc1.iscr.data)}: ${CAT_SCONTO_1[sc1.iscr.cat]}` : ''}>{fmtEuro(quotaDi(db, ini, s))}</div>
          {sc1?.iscr && oggiCat !== sc1.iscr.cat && <div className="text-[10px] text-amber-400" title="Lo sconto resta quello del giorno d'iscrizione">oggi: {CAT_SCONTO_1[oggiCat]}</div>}
          <button disabled={chiusa} title="Automatico = regola della tipologia del riferimento" className={`mt-0.5 rounded border text-[11px] px-1.5 py-0.5 ${pers ? 'border-amber-700 text-amber-300' : 'border-slate-800 text-slate-500 hover:text-slate-300'}`} onClick={() => setSpPer(s)}>{etichettaPers(pers, regolaTurni(db, ini, s))}</button>
        </td>
        {ini.periodi.map(p => {
          const st = statoPer(ini, s.id, p.id)
          return <td key={p.id} className="px-1.5 py-1.5 text-center">
            <select disabled={chiusa} aria-label={`${p.nome} · ${nominativo(s)}`} className={`rounded-md bg-slate-950 border text-xs px-1.5 py-1 ${st ? STATI_PER[st][1] : 'border-slate-800 text-slate-500'}`} value={st} onChange={e => setPer(s, p.id, e.target.value as StatoPeriodo)}>
              <option value="">—</option><option value="P">Prenotata</option><option value="F">Frequentata</option><option value="T">Tolta</option></select></td>
        })}
        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-slate-100">{dov ? fmtEuro(dov) : <span className="text-slate-600">—</span>}</td>
        <td className="px-3 py-1.5 text-right"><input inputMode="decimal" disabled={chiusa} className={inputW + ' py-1 w-24 text-right tabular-nums'} defaultValue={v ? fmtImp(v) : ''} key={`${s.id}-${v}`} placeholder="0,00"
          onBlur={e => { const x = parseEuro(e.target.value || '0'); if (x === null) { avviso('Importo non valido', 'error'); return } if (x !== v) aggiorna(s.id, { versato: x || null }) }} /></td>
        <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${dov - v > 0 ? 'text-amber-400' : dov - v < 0 ? 'text-cyan-300' : 'text-slate-500'}`}>{dov || v ? fmtEuro(dov - v) : '—'}</td>
        <td className="px-3 py-1.5"><input disabled={chiusa} className={inputCls + ' py-1 text-xs min-w-[140px]'} defaultValue={sc1?.note ?? ''} key={`${s.id}-n-${sc1?.note ?? ''}`} maxLength={500} placeholder={iscrittoTurni(ini, s.id) ? 'Es. allungamento richiesto' : ''}
          onBlur={e => { if (e.target.value !== (sc1?.note ?? '')) aggiorna(s.id, { note: e.target.value || null }) }} /></td>
      </tr>)
  }
  const testaGruppo = (g: { k: string; r: Persona | null; membri: Persona[] }) => {
    const dov = somma(g, s => dovutoTurni(db, ini, s)), v = somma(g, ver)
    const n = g.membri.length === 1 ? '1 iscritto' : `${g.membri.length} iscritti`
    return (
      <tr key={`g-${g.k}`} className="bg-slate-800/50 border-t border-slate-700">
        <td colSpan={2 + nPer} className="px-5 py-2">
          {g.r ? <span className="inline-flex items-center gap-2 flex-wrap"><span className="text-white font-semibold">{nominativo(g.r)}</span><Origine s={g.r} />{g.r.tipo === 'EST' && g.r.matricola && <Pill title="Dipendente con matricola PGS, non iscritto al CRAL">dipendente non socio</Pill>}{pillCat(catSconto(g.r))}<span className="text-xs text-slate-500">{n}</span></span>
            : <span className="inline-flex items-center gap-2 flex-wrap"><span className="text-slate-300 font-semibold">Senza socio o dipendente di riferimento</span>{pillCat('EST')}<span className="text-xs text-slate-500">{n}</span></span>}
        </td>
        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-white font-medium">{dov ? fmtEuro(dov) : '—'}</td>
        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-slate-300">{v ? fmtEuro(v) : '—'}</td>
        <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium ${dov - v > 0 ? 'text-amber-400' : dov - v < 0 ? 'text-cyan-300' : 'text-slate-500'}`}>{dov || v ? fmtEuro(dov - v) : '—'}</td>
        <td className="px-3 py-2 text-xs text-slate-500">{g.membri.length > 1 ? 'totale famiglia' : ''}</td>
      </tr>)
  }
  const riquadri: Array<[string, string, string]> = [['Iscritti', String(c.isc.length), 'text-white'], ['Settimane', String(c.settimane), 'text-white'], ['Dovuto', fmtEuro(c.dovuto), 'text-white'], ['Versato', fmtEuro(c.versato), 'text-emerald-300'], ['Da incassare', fmtEuro(Math.max(0, c.dovuto - c.versato)), c.dovuto > c.versato ? 'text-amber-400' : 'text-white']]
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {riquadri.map(([l, n, k]) => <div key={l} className={`${cardCls} px-4 py-3`}><p className={etichettaCls}>{l}</p><p className={`text-xl font-semibold tabular-nums mt-1 ${k}`}>{n}</p></div>)}
      </div>
      <div className={`${cardCls} px-5 py-3 flex flex-wrap gap-x-6 gap-y-2 items-center text-sm`}>
        <span className="text-slate-400">Quota piena <b className="text-white tabular-nums">{fmtEuro(ini.quota)}</b> a settimana</span>
        <span className="text-slate-400">Sconti: <b className="text-emerald-300">{riassuntoSconti(ini) || 'nessuno'}</b></span>
        <span className="text-xs text-slate-500 flex-1 min-w-[240px]">Per i familiari conta il socio o il dipendente di riferimento, come era il giorno dell'iscrizione. Lo sconto personale sulla riga sostituisce la regola e vale sul totale.</span>
      </div>
      <div className={`${cardCls} overflow-hidden`}>
        <div className="px-5 py-3 border-b border-slate-800"><p className="text-sm font-medium text-white">Riepilogo per settimana</p></div>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 bg-slate-900/60"><th className="px-5 py-2.5 font-semibold">Settimana</th><th className={thCls}>Dal – al</th><th className={thCls + ' text-right'}>Prenotate</th><th className={thCls + ' text-right'}>Frequentate</th><th className={thCls + ' text-right'}>Tolte</th><th className={thCls + ' text-right'}>Posti</th><th className="px-5 py-2.5 font-semibold text-right">Importo</th></tr></thead>
          <tbody className="divide-y divide-slate-800/70 tabular-nums">
            {ini.periodi.map(p => {
              const n = (k: StatoPeriodo) => c.dest.filter(s => statoPer(ini, s.id, p.id) === k).length; const occ = n('P') + n('F')
              const imp = c.dest.filter(s => pagaPer(statoPer(ini, s.id, p.id))).reduce((a, s) => a + quotaDi(db, ini, s), 0)
              return (
                <tr key={p.id}><td className="px-5 py-2 text-slate-100">{p.nome}</td><td className="px-3 py-2 text-slate-400">{fmtData(p.dal)} – {fmtData(p.al)}</td><td className="px-3 py-2 text-right text-indigo-300">{n('P')}</td><td className="px-3 py-2 text-right text-emerald-300">{n('F')}</td><td className="px-3 py-2 text-right text-red-300/80">{n('T')}</td>
                  <td className={`px-3 py-2 text-right ${p.posti && occ >= p.posti ? 'text-amber-400' : 'text-slate-400'}`}>{p.posti ? `${occ}/${p.posti}` : occ}</td><td className="px-5 py-2 text-right text-white">{fmtEuro(imp)}</td></tr>)
            })}
          </tbody></table></div>
      </div>
      <div className={`${cardCls} overflow-hidden`}>
        <div className="px-5 py-3 border-b border-slate-800 flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[180px]"><input className={inputCls} placeholder="Cerca iscritto, socio o dipendente di riferimento…" value={cerca} onChange={e => setCerca(e.target.value)} /></div>
          <select className={inputCls + ' sm:w-60'} value={vista} onChange={e => setVista(e.target.value)}><option value="rif">Vista: per socio/dipendente</option><option value="elenco">Vista: elenco unico</option></select>
          <select className={inputCls + ' sm:w-56'} value={solo} onChange={e => setSolo(e.target.value)}>
            <option value="">Tutti i partecipanti</option><option value="iscritti">Solo iscritti</option><option value="saldo">Con saldo da versare</option><option value="forzati">Con sconto personale</option>
            {ini.periodi.map(p => <option key={p.id} value={p.id}>Iscritti a {p.nome}</option>)}</select>
          <select className={inputCls + ' sm:w-56'} value={ord} onChange={e => setOrd(e.target.value)}><option value="nom">Ordina: Nominativo</option><option value="tip">Ordina: Tipologia</option><option value="saldo">Ordina: Saldo (maggiore prima)</option></select>
        </div>
        <div className="overflow-x-auto max-h-[620px] overflow-y-auto"><table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-900 z-10 text-left text-[11px] uppercase tracking-wider text-slate-500"><tr>
            <th className="px-5 py-2.5 font-semibold">{vista === 'rif' ? 'Socio / dipendente › iscritto' : 'Iscritto'}</th><th className={thCls}>Quota</th>
            {ini.periodi.map(p => <th key={p.id} className="px-2 py-2 font-semibold text-center normal-case tracking-normal whitespace-nowrap">{p.nome}<div className="font-normal text-slate-600 tabular-nums">{ggmm(p.dal)}–{ggmm(p.al)}</div></th>)}
            <th className={thCls + ' text-right'}>Dovuto</th><th className={thCls + ' text-right'}>Versato €</th><th className={thCls + ' text-right'}>Saldo</th><th className={thCls}>Note</th></tr></thead>
          <tbody className="divide-y divide-slate-800/70">
            {vista === 'rif' ? gruppi.map(g => <Fragment key={g.k}>{testaGruppo(g)}{g.membri.map(s => riga(s, true))}</Fragment>) : lista.map(s => riga(s, false))}
            {!lista.length && <tr><td colSpan={20} className="px-5 py-10 text-center text-slate-500">{ini.modoPart === 'SINGOLI' ? 'Nessun iscritto: usa «Nuovo partecipante» o «Importa iscrizioni».' : 'Nessuno con questi filtri.'}</td></tr>}
          </tbody>
        </table></div>
        <p className="px-5 py-3 border-t border-slate-800 text-xs text-slate-500">Prenotata e Frequentata si pagano per intero, anche con pochi giorni di presenza. «Tolta» = settimana prenotata ma non fatta: non si paga. Un allungamento è una settimana in più messa a «Prenotata». La quota è piena o scontata secondo la tipologia della persona di riferimento; il pulsante sotto la quota mette uno sconto personale (percentuale, importo fisso o nessuno) per un solo iscritto. Saldo negativo = versato in più (da restituire o compensare).</p>
      </div>
      {spPer && <ScontoPersonaleModal titolo={`Sconto · ${nominativo(spPer)}`} sotto={`${periodiDovuti(ini, spPer.id)} settimane · quota piena ${fmtEuro(ini.quota)}`} regola={regolaTurni(db, ini, spPer)} valore={persDi(ini, spPer.id)} lordo={periodiDovuti(ini, spPer.id) * ini.quota} onClose={() => setSpPer(null)}
        onSalva={v => { aggiorna(spPer.id, { scontoPers: v }); setSpPer(null); avviso(v ? 'Sconto personale salvato' : 'Sconto automatico') }} />}
      {rifPer && <RiferimentoModal ini={ini} s={rifPer} onClose={() => setRifPer(null)} onScegli={v => {
        const nr = v ? persona(db, v) ?? null : v === '' ? null : rifAutomatico(db, ini, rifPer); const pr = ini.scelte[rifPer.id]?.iscr
        aggiorna(rifPer.id, { rif: v, ...(pr ? { iscr: { ...pr, cat: catSconto(nr) } } : {}) }); setRifPer(null)
        avviso(v === null ? 'Riferimento automatico' : v ? 'Riferimento aggiornato' : 'Nessun riferimento: quota piena')
      }} />}
    </>
  )
}

/** Sceglie la persona di riferimento di un iscritto al campo: decide lo sconto e lo raggruppa sotto di lei. */
function RiferimentoModal({ ini, s, onScegli, onClose }: { ini: Iniziativa; s: Persona; onScegli: (v: string | null) => void; onClose: () => void }) {
  const { db } = useCral()
  const [q, setQ] = useState('')
  const n = norm(q)
  const att = ini.scelte[s.id]?.rif
  const legati = sociDi(db, s)
  const ris = n.length < 2 ? [] : db.soci.filter(x => x.tipo !== 'FAM' && x.id !== s.id && x.stato === 'ATTIVO' && norm(`${nominativo(x)} ${x.id} ${x.tessera}`).includes(n)).slice(0, 8)
  const voce = (x: Persona, extra: string) => {
    const rg = regolaCat(ini, catSconto(x))
    return <button key={x.id} className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-3 text-sm" onClick={() => onScegli(x.id)}>
      <span className="font-mono text-xs text-slate-400 w-20">{x.id}</span><span className="text-slate-100 flex-1">{nominativo(x)}{extra && <span className="text-xs text-slate-500"> · {extra}</span>}</span><Origine s={x} />
      {rg ? <Pill tono="ok">sconto {fmtSconto(rg)}</Pill> : <Pill>quota piena</Pill>}</button>
  }
  const oggiR = rifDi(db, ini, s)
  return (
    <Modale titolo={`Riferimento di ${nominativo(s)}`} sotto="Il socio o il dipendente da cui dipende l'iscritto: decide lo sconto e il gruppo in cui compare." onClose={onClose}
      piedi={<><button className={btnSecondario + ' mr-auto'} onClick={() => onScegli(null)} disabled={att === undefined}>Torna all'automatico</button><button className={btnSecondario} onClick={() => onScegli('')}>Nessun riferimento (quota piena)</button></>}>
      <div className="flex flex-col gap-3">
        {legati.length > 0 && <div><p className={etichettaCls + ' mb-1.5'}>Soci collegati in anagrafica</p><div className="border border-slate-800 rounded-lg divide-y divide-slate-800">{legati.map(l => voce(l.s, `${RELAZIONI[l.relazione]}${l.s.stato !== 'ATTIVO' ? ' · non attivo' : ''}`))}</div></div>}
        <div><p className={etichettaCls + ' mb-1.5'}>Cerca fra soci ed esterni (anche dipendenti non iscritti)</p>
          <div className="relative"><span className="absolute left-3 top-2.5 text-slate-500"><Ico d={D.search} /></span>
            <input autoFocus className={inputCls + ' pl-9'} placeholder="Cognome, matricola, ID o tessera" value={q} onChange={e => setQ(e.target.value)} /></div>
          {n.length >= 2 && <div className="mt-2 border border-slate-800 rounded-lg divide-y divide-slate-800 max-h-56 overflow-y-auto">
            {ris.map(x => voce(x, x.tipo === 'EST' && x.matricola ? 'dipendente non socio' : ''))}
            {!ris.length && <p className="px-3 py-3 text-sm text-slate-500">Nessuno con questo nome. Un genitore che non è nel CRAL non serve: lascia «nessun riferimento» e scrivilo nelle note.</p>}
          </div>}</div>
        <p className="text-xs text-slate-500">Oggi: {oggiR ? `${nominativo(oggiR)} (${CAT_SCONTO_1[catSconto(oggiR)]})` : 'nessun riferimento'}{att === undefined ? ' · scelto in automatico' : ' · scelto a mano'}. Un familiare legato a due soci compare sotto il primo socio attivo; qui puoi spostarlo sotto l'altro.</p>
      </div>
    </Modale>
  )
}

/** Iscrizioni a un campo da file (tracciato T5): persona + una colonna per settimana (X = prenotata). */
export function IscrizioniImportModal({ ini, onClose }: { ini: Iniziativa; onClose: () => void }) {
  const { db, esegui } = useCral()
  const { righe, apri, leggo } = useFoglio()
  const [manuali, setManuali] = useState<Record<number, string>>({})
  const pool = useMemo(() => db.soci.filter(s => s.stato === 'ATTIVO' || s.stato === 'DA_VALIDARE'), [db])
  const per = ini.periodi
  const esiti = useMemo(() => {
    if (!righe) return []
    const h = righe[0] ?? []; const ci = (re: RegExp) => h.findIndex(x => re.test(x))
    const cId = ci(/matricola|^id|tessera/i), cEm = ci(/mail/i), cNom = ci(/nominativo|cognome/i), cVer = ci(/versato/i), cNote = ci(/^note$/i), cRif = ci(/riferimento|genitore|a carico/i)
    const adulti = db.soci.filter(x => x.tipo !== 'FAM' && x.stato === 'ATTIVO')
    const colP = per.map(p => [p, h.findIndex(x => normNome(x) === normNome(p.nome))] as const)
    const v = (r: string[], j: number) => (j >= 0 ? (r[j] ?? '').trim() : '')
    return righe.slice(1).map((r, i) => {
      const [s, via] = agganciaPersona(pool, v(r, cId), v(r, cEm), v(r, cNom))
      const sett = colP.filter(([, c]) => c >= 0 && /^(X|SI|SÌ|1|P)$/i.test(v(r, c))).map(([p]) => p.id)
      const rifTxt = v(r, cRif)
      const [rif] = rifTxt ? agganciaPersona(adulti, /^[\dA-Z-]+$/i.test(rifTxt) && /\d/.test(rifTxt) ? rifTxt : '', '', rifTxt) : [null]
      return { i, s, via, rifTxt, rif, nom: v(r, cNom) || v(r, cId), sett, versato: cVer >= 0 ? parseEuro(v(r, cVer) || '0') ?? 0 : 0, note: v(r, cNote) }
    }).filter(e => e.sett.length)
  }, [righe, pool, per, db])
  const finale = (e: (typeof esiti)[number]) => e.s ?? pool.find(x => x.id === manuali[e.i])
  const pronte = esiti.filter(e => finale(e))
  async function applica() {
    const voci = pronte.map(e => {
      const p = finale(e)!; const prima = ini.scelte[p.id] ?? {}
      const dati: PatchScelta = {
        per: { ...(prima.per ?? {}), ...Object.fromEntries(e.sett.map(x => [x, 'P' as const])) },
        versato: (prima.versato ?? 0) + e.versato || null, note: (e.note || prima.note || '').slice(0, 500) || null,
        ...(e.rif ? { rif: e.rif.id } : {}),
        iscr: prima.iscr ?? { data: oggi(), cat: catSconto(e.rif ?? rifDi(db, ini, p)) },
      }
      return { socio: p.id, dati }
    })
    const r = await esegui(async () => {
      if (ini.modoPart === 'SINGOLI') await cralApi.partecipanti(ini.id, [...new Set(voci.map(x => x.socio))])
      return cralApi.scelteInBlocco(ini.id, voci, 'modulo')
    }, `${voci.length} iscrizioni registrate`)
    if (r) onClose()
  }
  return (
    <Modale largo titolo="Importa iscrizioni" sotto="Una riga per persona, una colonna per settimana con X (tracciato T5)." onClose={onClose}
      piedi={righe && <><span className="text-sm text-slate-400 mr-auto self-center">{pronte.length} da registrare · {esiti.filter(e => !e.s).length} non agganciate</span><button className={btnSecondario} onClick={onClose}>Annulla</button><button className={btnPrimario} disabled={!pronte.length} onClick={() => void applica()}>Registra {pronte.length} iscrizioni</button></>}>
      {!righe ? <SceltaFile apri={apri} leggo={leggo} spiega="Le settimane del file si aggiungono a quelle già prenotate (allungamenti compresi). Il versato si somma." /> :
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500"><th className="px-3 py-2 font-semibold">Nel file</th>{per.map(p => <th key={p.id} className="px-2 py-2 font-semibold text-center normal-case tracking-normal">{p.nome}</th>)}<th className="px-3 py-2 font-semibold">Persona</th><th className="px-3 py-2 font-semibold">Riferimento</th></tr></thead>
          <tbody className="divide-y divide-slate-800/70">{esiti.map(e => (
            <tr key={e.i}><td className="px-3 py-2 text-xs text-slate-300 whitespace-nowrap">{e.nom}</td>
              {per.map(p => <td key={p.id} className="px-2 py-2 text-center">{e.sett.includes(p.id) ? <span className="text-indigo-300">●</span> : <span className="text-slate-700">·</span>}</td>)}
              <td className="px-3 py-2">{e.s ? <span className="inline-flex items-center gap-2 text-slate-100 whitespace-nowrap">{nominativo(e.s)} <Origine s={e.s} /></span> :
                <div className="flex items-center gap-2"><Pill tono="warn">Non agganciata</Pill><select className={inputCls + ' py-1 text-xs'} value={manuali[e.i] ?? ''} onChange={ev => setManuali({ ...manuali, [e.i]: ev.target.value })}><option value="">Assegna a…</option>{pool.slice().sort((a, b) => nominativo(a).localeCompare(nominativo(b))).map(x => <option key={x.id} value={x.id}>{nominativo(x)} ({TIPOLOGIE[x.tipo][0]})</option>)}</select></div>}</td>
              <td className="px-3 py-2 text-xs whitespace-nowrap">{e.rif ? <span className="text-slate-200">{nominativo(e.rif)} <span className="text-slate-500">· {CAT_SCONTO_1[catSconto(e.rif)]}</span></span> : e.rifTxt ? <span className="text-amber-400">«{e.rifTxt}» non trovato: automatico</span> : <span className="text-slate-600">automatico</span>}</td></tr>))}</tbody>
        </table></div>}
    </Modale>
  )
}
