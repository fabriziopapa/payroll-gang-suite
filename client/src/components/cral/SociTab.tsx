// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · scheda Soci
// Soci dipendenti, soci esterni ed esterni; i familiari stanno sotto i
// loro soci. Scheda della persona, familiari, nuova persona.
// ============================================================

import { Fragment, useEffect, useState } from 'react'
import { cralApi, type CralNuovaPersonaApi } from '../../api/endpoints'
import type { AnagraficaPgs, Legame, Persona, Relazione, TipoPersona } from './tipi'
import {
  RELAZIONI, TIPOLOGIE, destinatari, eSocio, eta, familiariDi, fmtData, nominativo, norm, prossimaTessera, relDi,
  rifAttivo, sedeNome, sociDi, tesseraDoppia, tesseraRiammissione,
} from './logica'
import {
  Campo, Conferma, D, DiChi, Ico, Modale, Origine, Pill, StatoSocio, avviso, btnPiccolo, btnPiccoloSec, btnPrimario, btnSecondario,
  cardCls, etichettaCls, inputCls, inputW, messaggioErrore, sceltaCls, thCls, useCral,
} from './ui'

export function SociTab() {
  const { db } = useCral()
  const [cerca, setCerca] = useState('')
  const [sede, setSede] = useState('')
  const [tip, setTip] = useState('')
  const [stato, setStato] = useState('ATTIVO')
  const [modifica, setModifica] = useState<string | null>(null)
  const [nuovo, setNuovo] = useState(false)
  const [aperti, setAperti] = useState<Set<string>>(new Set())
  const q = norm(cerca)
  // L'elenco mostra soci dipendenti, soci esterni ed esterni. I familiari stanno sotto i loro soci.
  const famDi = (s: Persona) => eSocio(s) ? familiariDi(db, s.id).filter(x => x.stato !== 'RIFIUTATO') : []
  const famTrovati = (s: Persona) => q ? famDi(s).filter(x => norm(`${x.cognome} ${x.nome} ${x.id}`).includes(q)) : []
  const lista = db.soci.filter(s => s.tipo !== 'FAM' &&
    (!q || norm(`${s.cognome} ${s.nome} ${s.id} ${s.tessera} ${s.email}`).includes(q) || famTrovati(s).length > 0) &&
    (!sede || (sede === '__NOSEDE' ? !s.sede : s.sede === sede)) &&
    (!tip || (tip === 'CONFAM' ? famDi(s).some(x => x.stato === 'ATTIVO') : s.tipo === tip)) && (!stato || s.stato === stato),
  ).sort((a, b) => nominativo(a).localeCompare(nominativo(b)))
  const espanso = (s: Persona) => aperti.has(s.id) || famTrovati(s).length > 0 || tip === 'CONFAM'
  const conFam = lista.filter(s => famDi(s).length)
  const tuttiAperti = conFam.length > 0 && conFam.every(espanso)
  const apri = (id: string) => setAperti(a => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const attivi = db.soci.filter(s => s.stato === 'ATTIVO')
  const daValidare = db.soci.filter(s => s.stato === 'DA_VALIDARE').length
  const senzaSede = attivi.filter(s => eSocio(s) && !s.sede).length
  const nFamAttivi = attivi.filter(s => s.tipo === 'FAM' && rifAttivo(db, s)).length
  const riquadri: Array<[string, number, string]> = [
    ['Soci dipendenti', attivi.filter(s => s.tipo === 'SD').length, 'SD'], ['Soci esterni', attivi.filter(s => s.tipo === 'SE').length, 'SE'],
    ['Esterni', attivi.filter(s => s.tipo === 'EST').length, 'EST'], ['Familiari', nFamAttivi, 'CONFAM'], ['Da validare', daValidare, ''],
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {riquadri.map(([l, n, k]) => (
          <button key={l} onClick={() => { setTip(k); setStato(k ? 'ATTIVO' : 'DA_VALIDARE') }} className={`${cardCls} px-4 py-3 text-left hover:border-slate-700 transition-colors`}>
            <p className={etichettaCls}>{l}</p><p className={`text-2xl font-semibold tabular-nums mt-1 ${!k && n ? 'text-amber-400' : k === 'CONFAM' ? 'text-pink-300' : 'text-white'}`}>{n}</p>
            {k === 'CONFAM' && <p className="text-[11px] text-slate-500">sotto i loro soci</p>}</button>
        ))}
      </div>
      {senzaSede > 0 && <p className="text-xs text-amber-400 -mt-1">{senzaSede === 1 ? '1 socio attivo' : `${senzaSede} soci attivi`} senza sede di consegna.</p>}
      <div className={`${cardCls} p-4 flex flex-wrap gap-3 items-end`}>
        <div className="flex-1 min-w-[200px]"><Campo label="Cerca"><input className={inputCls} placeholder="Nominativo, ID, tessera, email… anche di un familiare" value={cerca} onChange={e => setCerca(e.target.value)} /></Campo></div>
        <div className="w-full sm:w-56"><Campo label="Sede di consegna"><select className={inputCls} value={sede} onChange={e => setSede(e.target.value)}><option value="">Tutte</option>{db.sedi.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}<option value="__NOSEDE">— Non indicata</option></select></Campo></div>
        <div className="w-[calc(50%-6px)] sm:w-48"><Campo label="Tipologia"><select className={inputCls} value={tip} onChange={e => setTip(e.target.value)}><option value="">Tutte</option><option value="SD">Soci dipendenti</option><option value="SE">Soci esterni</option><option value="EST">Esterni</option><option value="CONFAM">Soci con familiari</option></select></Campo></div>
        <div className="w-[calc(50%-6px)] sm:w-40"><Campo label="Stato"><select className={inputCls} value={stato} onChange={e => setStato(e.target.value)}><option value="">Tutti</option><option value="ATTIVO">Attivi</option><option value="DA_VALIDARE">Da validare</option><option value="CESSATO">Cessati</option><option value="RIFIUTATO">Rifiutati</option></select></Campo></div>
        <button className={btnPrimario} onClick={() => setNuovo(true)}><Ico d={D.plus} />Nuova persona</button>
      </div>
      <div className={`${cardCls} overflow-hidden`}>
        <div className="px-5 py-3 border-b border-slate-800 flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span className="flex-1">{lista.length} persone{conFam.length ? ` · ${conFam.length} con familiari` : ''}</span>
          {conFam.length > 0 && <button className="text-indigo-400 hover:text-indigo-300" onClick={() => setAperti(tuttiAperti ? new Set() : new Set(conFam.map(s => s.id)))}>{tuttiAperti ? 'Comprimi i familiari' : 'Mostra tutti i familiari'}</button>}
        </div>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 bg-slate-900/60">
            <th className="px-5 py-2.5 font-semibold">ID</th><th className={thCls}>Nominativo</th><th className={thCls}>Tipologia</th><th className={thCls}>Tessera CRAL</th><th className={thCls}>Sede di consegna</th><th className={thCls}>Stato</th><th className="px-5 py-2.5 font-semibold">Dal</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-800/70">
            {lista.map(s => {
              const fam = famDi(s); const exp = espanso(s); const evid = new Set(famTrovati(s).map(x => x.id))
              return (
                <Fragment key={s.id}>
                  <tr className="hover:bg-slate-800/40 cursor-pointer" onClick={() => setModifica(s.id)}>
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-300 whitespace-nowrap">{s.id}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap"><span className="text-slate-100">{nominativo(s)}</span>{s.atipico && <span className="ml-1.5"><Pill tono="warn" title="ATIPICO nel libro soci: etichetta provvisoria">ATIPICO</Pill></span>}
                      {fam.length > 0 && <button onClick={e => { e.stopPropagation(); apri(s.id) }} className="ml-2 inline-flex items-center gap-1 text-xs text-pink-300 hover:text-pink-200 rounded px-1.5 py-0.5 border border-pink-900/60 hover:border-pink-700" aria-expanded={exp} title={exp ? 'Nascondi i familiari' : 'Mostra i familiari'}>
                        <span className={`inline-block transition-transform ${exp ? 'rotate-90' : ''}`}>›</span>{fam.length} {fam.length === 1 ? 'familiare' : 'familiari'}</button>}</td>
                    <td className="px-3 py-2.5"><Origine s={s} /></td>
                    <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{s.tessera ? <span className="text-slate-200">{s.tessera}</span> : <span className="text-slate-600">—</span>}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{s.sede ? <span className="text-slate-300">{sedeNome(db, s.sede)}</span> : eSocio(s) ? <Pill tono="warn">Da indicare</Pill> : <span className="text-slate-600">—</span>}</td>
                    <td className="px-3 py-2.5"><StatoSocio s={s} /></td>
                    <td className="px-5 py-2.5 text-slate-400 tabular-nums whitespace-nowrap">{fmtData(s.iscrittoIl)}</td>
                  </tr>
                  {exp && fam.map(x => {
                    const altri = sociDi(db, x).filter(l => l.socio !== s.id); const rel = relDi(x, s.id)
                    return (
                      <tr key={`${s.id}-${x.id}`} className={`cursor-pointer bg-pink-950/[0.07] hover:bg-pink-950/20 ${evid.has(x.id) ? 'ring-1 ring-inset ring-pink-700/60' : ''}`} onClick={() => setModifica(x.id)}>
                        <td className="pl-9 pr-3 py-2 font-mono text-[11px] text-slate-500 whitespace-nowrap">{x.id}</td>
                        <td className="px-3 py-2 whitespace-nowrap"><span className="text-slate-500 mr-1.5">↳</span><span className={x.stato === 'ATTIVO' ? 'text-slate-200' : 'text-slate-500 line-through'}>{nominativo(x)}</span>
                          {rel && <span className="ml-2 text-xs text-pink-300">{RELAZIONI[rel]}</span>}
                          {altri.length > 0 && <span className="ml-2 text-[11px] text-slate-500">anche di {altri.map(l => nominativo(l.s)).join(', ')}</span>}</td>
                        <td className="px-3 py-2"><Origine s={x} /></td>
                        <td className="px-3 py-2 text-slate-600 text-xs">—</td>
                        <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">{x.sede && x.sede !== s.sede ? sedeNome(db, x.sede) : <span className="text-slate-600">come il socio</span>}</td>
                        <td className="px-3 py-2">{x.stato === 'ATTIVO' ? (rifAttivo(db, x) ? <Pill tono="ok">Attivo</Pill> : <Pill title="Nessun socio collegato è attivo">Sospeso</Pill>) : <StatoSocio s={x} />}</td>
                        <td className="px-5 py-2 text-slate-500 tabular-nums whitespace-nowrap text-xs">{fmtData(x.iscrittoIl)}</td>
                      </tr>)
                  })}
                </Fragment>)
            })}
            {!lista.length && <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-500">Nessuna persona con questi filtri.</td></tr>}
          </tbody>
        </table></div>
      </div>
      {modifica && <SocioModal key={modifica} id={modifica} onClose={() => setModifica(null)} onApri={setModifica} />}
      {nuovo && <NuovoSocioModal onClose={() => setNuovo(false)} />}
    </div>
  )
}

/** Familiari di un socio: elenco, nuovi familiari, collegamento di familiari già presenti (es. figlio di due soci). */
function FamiliariSocio({ socio, onApri }: { socio: Persona; onApri: (id: string) => void }) {
  const { db, esegui } = useCral()
  const fam = familiariDi(db, socio.id).filter(x => x.stato !== 'RIFIUTATO')
  const [f, setF] = useState<{ cognome: string; nome: string; nascita: string; relazione: Relazione } | null>(null)
  const [col, setCol] = useState<{ q: string; relazione: Relazione } | null>(null)
  const ok = !!f && !!f.cognome.trim() && !!f.nome.trim()
  async function aggiungi() {
    if (!f) return
    const r = await esegui(() => cralApi.creaPersona({ tipo: 'FAM', cognome: f.cognome.trim(), nome: f.nome.trim(), nascita: f.nascita || null, sede: socio.sede, legami: [{ socio: socio.id, relazione: f.relazione }] }),
      `${RELAZIONI[f.relazione]} aggiunto/a ai familiari di ${nominativo(socio)}`)
    if (r) setF(null)
  }
  const n = norm(col?.q ?? '')
  const candidati = n.length < 2 ? [] : db.soci.filter(x => x.tipo === 'FAM' && x.stato === 'ATTIVO' && !x.legami.some(l => l.socio === socio.id) && norm(`${nominativo(x)} ${x.id}`).includes(n)).slice(0, 6)
  async function collega(x: Persona) {
    if (!col) return
    const r = await esegui(() => cralApi.legami(x.id, [...x.legami, { socio: socio.id, relazione: col.relazione }]), `${nominativo(x)} ora è familiare anche di ${nominativo(socio)}`)
    if (r) setCol(null)
  }
  function scollega(x: Persona) {
    if (x.legami.length <= 1) { avviso("È l'unico socio collegato: per toglierlo disattiva il familiare dalla sua scheda.", 'warning'); return }
    void esegui(() => cralApi.legami(x.id, x.legami.filter(l => l.socio !== socio.id)), `${nominativo(x)} scollegato da ${nominativo(socio)}`)
  }
  return (
    <div className="rounded-lg border border-pink-900/50 bg-pink-950/10 p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2"><span className={etichettaCls + ' flex-1'}>Familiari ({fam.filter(x => x.stato === 'ATTIVO').length})</span>
        {!f && !col && <><button className={btnPiccoloSec} onClick={() => setCol({ q: '', relazione: 'FIGLIO' })}><Ico d={D.link} cls="w-3.5 h-3.5" />Collega familiare già presente</button>
          <button className={btnPiccoloSec} onClick={() => setF({ cognome: socio.cognome, nome: '', nascita: '', relazione: 'CONIUGE' })}><Ico d={D.plus} cls="w-3.5 h-3.5" />Aggiungi familiare</button></>}</div>
      {fam.length > 0 && <div className="divide-y divide-slate-800 rounded-md border border-slate-800">
        {fam.map(x => {
          const altri = sociDi(db, x).filter(l => l.socio !== socio.id); const rel = relDi(x, socio.id)
          return (
            <div key={x.id} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-mono text-xs text-slate-500 w-20">{x.id}</span><span className={`flex-1 min-w-[140px] ${x.stato === 'ATTIVO' ? 'text-slate-100' : 'text-slate-500 line-through'}`}>{nominativo(x)}</span>
              {rel && <span className="text-xs text-pink-300">{RELAZIONI[rel]}</span>}
              {altri.length > 0 && <span className="text-xs text-slate-500">anche {altri.map(l => `${RELAZIONI[l.relazione].toLowerCase()} di ${nominativo(l.s)}`).join(', ')}</span>}
              <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={() => onApri(x.id)}>apri</button>
              <button className="text-xs text-slate-500 hover:text-red-400 disabled:opacity-40" disabled={x.legami.length <= 1} title={x.legami.length <= 1 ? "È l'unico socio collegato: per toglierlo disattiva il familiare dalla sua scheda" : 'Scollega da questo socio'} onClick={() => scollega(x)}>scollega</button>
            </div>)
        })}
      </div>}
      {!fam.length && !f && !col && <p className="text-xs text-slate-500">Nessun familiare. Un familiare può essere legato a più soci (es. figlio di due soci).</p>}
      {f && <div className="grid sm:grid-cols-[1fr_1fr_150px_160px] gap-3 items-end">
        <Campo label="Cognome"><input className={inputCls} value={f.cognome} onChange={e => setF({ ...f, cognome: e.target.value })} /></Campo>
        <Campo label="Nome"><input autoFocus className={inputCls} value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} /></Campo>
        <Campo label="Data di nascita"><input type="date" className={inputCls} value={f.nascita} onChange={e => setF({ ...f, nascita: e.target.value })} /></Campo>
        <Campo label="Relazione"><select className={inputCls} value={f.relazione} onChange={e => setF({ ...f, relazione: e.target.value as Relazione })}>{Object.entries(RELAZIONI).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Campo>
        <div className="sm:col-span-4 flex justify-end gap-2"><button className={btnPiccoloSec} onClick={() => setF(null)}>Annulla</button><button className={btnPiccolo + ' bg-indigo-600 hover:bg-indigo-500 text-white'} disabled={!ok} onClick={() => void aggiungi()}>Aggiungi</button></div>
      </div>}
      {col && <div className="flex flex-col gap-2">
        <div className="grid sm:grid-cols-[1fr_160px] gap-3 items-end">
          <Campo label="Familiare già in anagrafica"><input autoFocus className={inputCls} placeholder="Cognome, nome o FAM-nnnn" value={col.q} onChange={e => setCol({ ...col, q: e.target.value })} /></Campo>
          <Campo label={`Relazione con ${socio.nome}`}><select className={inputCls} value={col.relazione} onChange={e => setCol({ ...col, relazione: e.target.value as Relazione })}>{Object.entries(RELAZIONI).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Campo>
        </div>
        {n.length >= 2 && <div className="border border-slate-800 rounded-lg divide-y divide-slate-800 max-h-48 overflow-y-auto">
          {candidati.map(x => <button key={x.id} onClick={() => void collega(x)} className="w-full text-left px-3 py-2 hover:bg-slate-800 text-sm flex items-center gap-3"><span className="font-mono text-xs text-slate-400 w-20">{x.id}</span><span className="text-slate-100">{nominativo(x)}</span><DiChi db={db} s={x} /></button>)}
          {!candidati.length && <p className="px-3 py-2 text-sm text-slate-500">Nessun familiare trovato. Se è nuovo usa «Aggiungi familiare».</p>}
        </div>}
        <div className="flex justify-end"><button className={btnPiccoloSec} onClick={() => setCol(null)}>Annulla</button></div>
      </div>}
    </div>
  )
}

/** Soci a cui è legato un familiare: uno o più, ciascuno con la sua relazione. */
function LegamiFamiliare({ legami, onChange, onApri }: { legami: Legame[]; onChange: (l: Legame[]) => void; onApri: (id: string) => void }) {
  const { db } = useCral()
  const [cerca, setCerca] = useState(false)
  return (
    <div className="rounded-lg border border-pink-900/50 bg-pink-950/10 p-4 flex flex-col gap-2">
      <div className="flex items-center"><span className={etichettaCls + ' flex-1'}>Familiare di ({legami.length})</span>
        {!cerca && <button className={btnPiccoloSec} onClick={() => setCerca(true)}><Ico d={D.plus} cls="w-3.5 h-3.5" />Collega a un altro socio</button>}</div>
      {legami.map((l, k) => {
        const so = db.perId.get(l.socio)
        return (
          <div key={l.socio} className="flex flex-wrap items-center gap-2">
            <button className="flex-1 min-w-[200px] text-left text-sm text-slate-100 hover:text-indigo-300" onClick={() => onApri(l.socio)}>{so ? nominativo(so) : l.socio} <span className="font-mono text-xs text-slate-500">{l.socio}</span> {so && <Origine s={so} />}{so && so.stato !== 'ATTIVO' && <span className="ml-1"><StatoSocio s={so} /></span>}</button>
            <select className={inputW + ' w-44 py-1.5'} value={l.relazione} onChange={e => onChange(legami.map((x, j) => j === k ? { ...x, relazione: e.target.value as Relazione } : x))}>{Object.entries(RELAZIONI).map(([key, lab]) => <option key={key} value={key}>{lab}</option>)}</select>
            <button disabled={legami.length <= 1} title={legami.length <= 1 ? 'Serve almeno un socio' : 'Scollega'} className="p-1.5 text-slate-500 hover:text-red-400 disabled:opacity-30" onClick={() => onChange(legami.filter((_, j) => j !== k))}><Ico d={D.x} /></button>
          </div>)
      })}
      {cerca && <div className="flex flex-col gap-2 pt-1"><CercaSocio escludi={legami.map(l => l.socio)} onScegli={so => { onChange([...legami, { socio: so.id, relazione: 'FIGLIO' }]); setCerca(false) }} /><button className={btnPiccoloSec + ' self-end'} onClick={() => setCerca(false)}>Annulla</button></div>}
      <p className="text-xs text-slate-500">Partecipa agli eventi finché almeno uno di questi soci è attivo.</p>
    </div>
  )
}

/** La riga dell'anagrafica PGS di una matricola (per la scheda e i controlli sulla data di nascita). */
export function useAnagraficaDi(matricola: string | null): AnagraficaPgs | null {
  const [a, setA] = useState<AnagraficaPgs | null>(null)
  useEffect(() => {
    let vivo = true
    if (!matricola) { setA(null); return }
    cralApi.anagrafica(matricola).then(r => { if (vivo) setA(r.risultati.find(x => x.matricola === matricola) ?? null) }).catch(() => undefined)
    return () => { vivo = false }
  }, [matricola])
  return a
}

function SocioModal({ id, onClose, onApri }: { id: string; onClose: () => void; onApri: (id: string) => void }) {
  const { db, esegui } = useCral()
  const s = db.perId.get(id)
  const [f, setF] = useState(() => ({ tipo: s?.tipo ?? 'SD', legami: s?.legami ?? [], tessera: s?.tessera ?? '', sede: s?.sede ?? '', email: s?.email ?? '', nascita: s?.nascita ?? '', note: s?.note ?? '' }))
  const [conferma, setConferma] = useState(false)
  const [riammetti, setRiammetti] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const a = useAnagraficaDi(s?.matricola ?? null)
  if (!s) return null
  const conTessera = f.tipo === 'SD' || f.tipo === 'SE'
  const doppia = conTessera && tesseraDoppia(db, id, f.tessera.trim())
  // chi ha la matricola è socio dipendente o esterno; chi non ce l'ha è socio esterno o esterno
  const ammesse: TipoPersona[] = s.tipo === 'FAM' ? ['FAM'] : s.matricola ? ['SD', 'EST'] : ['SE', 'EST']
  async function salva() {
    if (!s || doppia) return
    setSalvo(true)
    const r = await esegui(async () => {
      await cralApi.modificaPersona(id, {
        ...(s.tipo !== 'FAM' && f.tipo !== s.tipo ? { tipo: f.tipo as 'SD' | 'SE' | 'EST' } : {}),
        tessera: conTessera ? f.tessera.trim() : '', sede: f.sede || null, email: f.email.trim(), nascita: f.nascita || null, note: f.note,
      })
      if (s.tipo === 'FAM' && JSON.stringify(f.legami) !== JSON.stringify(s.legami)) await cralApi.legami(id, f.legami)
      return true
    }, `${nominativo(s)}: dati salvati`)
    setSalvo(false)
    if (r) onClose()
  }
  const iniz = db.iniziative.filter(i => !i.archiviata && destinatari(db, i).some(x => x.id === id))
  const ria = eSocio(s) ? tesseraRiammissione(db.tessera, s) : null
  return (
    <Modale largo titolo={nominativo(s)} sotto={<span className="font-mono">{s.id}</span>} onClose={onClose} piedi={<>
      {s.stato === 'ATTIVO' && <button className={btnSecondario + ' mr-auto'} onClick={() => setConferma(true)}>{eSocio(s) ? 'Cessa iscrizione' : 'Disattiva'}</button>}
      {s.stato === 'CESSATO' && <button className={btnSecondario + ' mr-auto'} onClick={() => setRiammetti(true)}>{eSocio(s) ? 'Riammetti' : 'Riattiva'}</button>}
      <button className={btnSecondario} onClick={onClose}>Annulla</button>
      <button className={btnPrimario} disabled={doppia || salvo || (s.tipo === 'FAM' && !f.legami.length)} onClick={() => void salva()}>Salva</button>
    </>}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2 items-center"><Origine s={s} /><StatoSocio s={s} />{s.atipico && <Pill tono="warn" title="ATIPICO nel libro soci: etichetta provvisoria">ATIPICO</Pill>}
          {s.matricola && <span className="text-xs text-slate-400">Matricola PGS <span className="font-mono text-slate-200">{s.matricola}</span>{a ? ` · ${a.ruolo ?? ''} ${a.druolo ?? ''}` : ''}</span>}
          {!s.matricola && s.provenienza && <span className="text-xs text-slate-400">{s.provenienza}</span>}
        </div>
        {s.tipo === 'FAM' ? <LegamiFamiliare legami={f.legami} onChange={legami => setF({ ...f, legami })} onApri={onApri} /> :
          <Campo label="Tipologia" hint={f.tipo === 'EST' ? "Esterno: non è socio, niente tessera, non compare nell'elenco soci." : undefined}>
            <select className={inputCls} value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value as TipoPersona })}>{ammesse.map(k => <option key={k} value={k}>{TIPOLOGIE[k][0]}</option>)}</select></Campo>}
        <div className="grid sm:grid-cols-2 gap-4">
          {conTessera && <Campo label="Tessera CRAL (n. socio)" hint={doppia ? <span className="text-red-400">Tessera già assegnata a un altro socio.</span> : `Prossimo progressivo: ${prossimaTessera(db.tessera)}`}>
            <div className="flex gap-2"><input className={inputCls + ' font-mono'} value={f.tessera} onChange={e => setF({ ...f, tessera: e.target.value })} placeholder="Nessuna" />
              {!f.tessera && <button type="button" className={btnPiccoloSec + ' whitespace-nowrap'} onClick={() => setF({ ...f, tessera: prossimaTessera(db.tessera) })}>Assegna</button>}</div>
          </Campo>}
          <Campo label="Sede di consegna" hint={s.tipo === 'FAM' ? 'Di norma quella del socio' : undefined}><select className={inputCls} value={f.sede} onChange={e => setF({ ...f, sede: e.target.value })}><option value="">— Da indicare</option>{db.sedi.filter(x => x.attiva || x.id === f.sede).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></Campo>
          <Campo label="Email" hint="Serve ad agganciare le risposte del modulo"><input className={inputCls} value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Campo>
          <Campo label="Data di nascita" hint={a?.nascita ? (a.nascita === f.nascita ? 'Come in anagrafica PGS' : <span className="text-amber-400">In anagrafica PGS: {fmtData(a.nascita)}</span>) : f.nascita ? `${eta(f.nascita)} anni` : 'Al posto del codice fiscale: distingue gli omonimi'}>
            <input type="date" className={inputCls} value={f.nascita} disabled={!!a?.nascita && a.nascita === s.nascita} onChange={e => setF({ ...f, nascita: e.target.value })} /></Campo>
          <Campo label="Dal"><input className={inputCls} value={fmtData(s.iscrittoIl)} disabled /></Campo>
        </div>
        {(s.storicoTessere.length > 0 || s.stato === 'CESSATO') && eSocio(s) && <div className="text-xs text-slate-400 rounded-lg border border-slate-800 px-3 py-2 flex flex-col gap-0.5">
          <span className={etichettaCls}>Storico iscrizione</span>
          {s.storicoTessere.map(h => <span key={h.tessera + h.al}>Tessera <span className="font-mono text-slate-200">{h.tessera}</span> dal {fmtData(h.dal)} al {fmtData(h.al)}</span>)}
          {s.stato === 'CESSATO' && <span>Cessato il {fmtData(s.cessatoIl)} · tessera <span className="font-mono text-slate-200">{s.tessera || '—'}</span>{ria && ('errore' in ria ? <span className="text-red-300"> · {ria.errore}</span> : <> · se rientra: <span className="font-mono text-emerald-300">{ria.tessera}</span></>)}</span>}
          {s.stato !== 'CESSATO' && <span>Tessera attuale <span className="font-mono text-slate-200">{s.tessera || '—'}</span> dal {fmtData(s.iscrittoIl)}</span>}
        </div>}
        {eSocio(s) && <FamiliariSocio socio={s} onApri={onApri} />}
        {iniz.length > 0 && <p className="text-xs text-slate-400">Tra i partecipanti di: {iniz.map(i => i.titolo).join(' · ')}</p>}
        <Campo label="Note"><textarea rows={2} className={inputCls} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Campo>
        <div className="text-xs text-slate-500 border-t border-slate-800 pt-3 flex flex-col gap-0.5">
          <span>Creato{s.creatoDa ? <> da <span className="text-slate-300">{s.creatoDa}</span></> : ''} il {fmtData(s.creatoIl)}</span>
          {s.validatoIl && <span>Validato{s.validatoDa ? <> da <span className="text-slate-300">{s.validatoDa}</span></> : ''} il {fmtData(s.validatoIl)}</span>}
          {s.modificatoIl && <span>Modificato{s.modificatoDa ? <> da <span className="text-slate-300">{s.modificatoDa}</span></> : ''} il {fmtData(s.modificatoIl)}</span>}
        </div>
      </div>
      {conferma && <Conferma testo={eSocio(s) ? "Cessare l'iscrizione?" : 'Disattivare?'} etichetta={eSocio(s) ? 'Cessa iscrizione' : 'Disattiva'} pericolo
        dettaglio={`${nominativo(s)} non comparirà più tra i partecipanti dei nuovi eventi. Scelte e ordini già registrati restano.${eSocio(s) ? ' Anche i suoi familiari escono dagli eventi, finché il socio non torna attivo.' : ''}`}
        onClose={() => setConferma(false)} onOk={() => { void esegui(() => cralApi.cambiaStato([id], 'cessa'), eSocio(s) ? 'Iscrizione cessata' : 'Disattivato').then(r => { if (r) onClose() }) }} />}
      {riammetti && <Conferma testo={eSocio(s) ? `Riammettere ${nominativo(s)}?` : `Riattivare ${nominativo(s)}?`} etichetta={eSocio(s) ? 'Riammetti' : 'Riattiva'} onClose={() => setRiammetti(false)}
        dettaglio={!ria ? 'Torna attivo.' : 'errore' in ria ? ria.errore : ria.nuovoNumero
          ? `Torna attivo con un nuovo numero di tessera: ${ria.tessera} (Parametri › Tessera: riammissione con nuovo numero).`
          : `Torna attivo con la stessa tessera e il suffisso: ${ria.tessera}. La tessera precedente ${s.tessera} resta nello storico.`}
        onOk={() => {
          if (ria && 'errore' in ria) return
          void esegui(async () => eSocio(s) ? (await cralApi.riammetti(id)).socio.tessera : (await cralApi.cambiaStato([id], 'riattiva'), ''),
            t => eSocio(s) ? `${nominativo(s)} riammesso con tessera ${t}` : 'Riattivato').then(r => { if (r !== null) onClose() })
        }} />}
    </Modale>
  )
}

/** Ricerca nell'anagrafica PGS (sul server: nome, cognome o matricola; cessati compresi). */
export function CercaAnagrafica({ onScegli, escludiSoci = true }: { onScegli: (a: AnagraficaPgs) => void; escludiSoci?: boolean }) {
  const { db } = useCral()
  const [q, setQ] = useState('')
  const [ris, setRis] = useState<AnagraficaPgs[] | null>(null)
  const soci = new Set(db.soci.filter(s => s.matricola).map(s => s.matricola))
  useEffect(() => {
    const t = q.trim()
    if (t.length < 2) { setRis(null); return }
    let vivo = true
    const timer = setTimeout(() => {
      cralApi.anagrafica(t).then(r => { if (vivo) setRis(r.risultati) }).catch(e => { if (vivo) { setRis([]); console.warn(messaggioErrore(e)) } })
    }, 250)
    return () => { vivo = false; clearTimeout(timer) }
  }, [q])
  const visibili = (ris ?? []).filter(a => !escludiSoci || !soci.has(a.matricola)).slice(0, 10)
  return (
    <div className="flex flex-col gap-2">
      <div className="relative"><span className="absolute left-3 top-2.5 text-slate-500"><Ico d={D.search} /></span>
        <input autoFocus className={inputCls + ' pl-9'} placeholder="Cognome, nome o matricola" value={q} onChange={e => setQ(e.target.value)} /></div>
      {ris && <div className="border border-slate-800 rounded-lg divide-y divide-slate-800 max-h-64 overflow-y-auto">
        {visibili.map(a => (
          <button key={a.matricola} className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-3" onClick={() => onScegli(a)}>
            <span className="font-mono text-xs text-slate-400 w-16">{a.matricola}</span><span className="text-slate-100 text-sm flex-1">{a.cognome} {a.nome}</span>{a.nascita && <span className="text-xs text-slate-500 tabular-nums">{fmtData(a.nascita)}</span>}<span className="text-xs text-slate-500">{a.ruolo}</span>{a.finRap && <Pill>cessato {a.finRap.slice(0, 4)}</Pill>}
          </button>))}
        {!visibili.length && <p className="px-3 py-3 text-sm text-slate-500">Nessuno in anagrafica PGS{escludiSoci ? ' (o è già presente nel CRAL)' : ''}.</p>}
      </div>}
    </div>
  )
}

/** Cerca un socio (dipendente o esterno) attivo: per collegare un familiare. */
export function CercaSocio({ onScegli, escludi = [] }: { onScegli: (s: Persona) => void; escludi?: string[] }) {
  const { db } = useCral()
  const [q, setQ] = useState('')
  const n = norm(q)
  const ris = n.length < 2 ? [] : db.soci.filter(s => eSocio(s) && s.stato === 'ATTIVO' && !escludi.includes(s.id) && norm(`${nominativo(s)} ${s.id} ${s.tessera}`).includes(n)).slice(0, 8)
  return (
    <div className="flex flex-col gap-2">
      <div className="relative"><span className="absolute left-3 top-2.5 text-slate-500"><Ico d={D.search} /></span>
        <input autoFocus className={inputCls + ' pl-9'} placeholder="Socio di riferimento: cognome, ID o tessera" value={q} onChange={e => setQ(e.target.value)} /></div>
      {n.length >= 2 && <div className="border border-slate-800 rounded-lg divide-y divide-slate-800 max-h-56 overflow-y-auto">
        {ris.map(s => <button key={s.id} className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-3 text-sm" onClick={() => onScegli(s)}><span className="font-mono text-xs text-slate-400 w-20">{s.id}</span><span className="text-slate-100 flex-1">{nominativo(s)}</span><Origine s={s} /></button>)}
        {!ris.length && <p className="px-3 py-3 text-sm text-slate-500">Nessun socio attivo con questo nome. Il familiare deve essere legato a un socio dipendente o a un socio esterno.</p>}
      </div>}
    </div>
  )
}

/** Nuova persona di una delle quattro tipologie. Con `perIniziativa` la aggiunge anche ai partecipanti di quell'evento. */
export function NuovoSocioModal({ onClose, perIniziativa, tipoIniziale }: { onClose: () => void; perIniziativa?: string; tipoIniziale?: TipoPersona }) {
  const { db, esegui } = useCral()
  const [tipo, setTipo] = useState<TipoPersona>(tipoIniziale ?? 'SD')
  const [estDaPgs, setEstDaPgs] = useState(false)
  const [scelto, setScelto] = useState<AnagraficaPgs | null>(null)
  const [rifs, setRifs] = useState<Array<{ s: Persona; relazione: Relazione }>>([])
  const [f, setF] = useState({ cognome: '', nome: '', nascita: '', email: '', sede: '', tessera: '', note: '' })
  const [salvo, setSalvo] = useState(false)
  const daAnagrafica = tipo === 'SD' || (tipo === 'EST' && estDaPgs)
  const conTessera = tipo === 'SD' || tipo === 'SE'
  const doppia = conTessera && tesseraDoppia(db, null, f.tessera.trim())
  const ok = (daAnagrafica ? !!scelto : !!f.cognome.trim() && !!f.nome.trim()) && (tipo !== 'FAM' || rifs.length > 0) && !doppia && !salvo
  async function crea() {
    setSalvo(true)
    const base: CralNuovaPersonaApi = { tipo, sede: f.sede || null, email: f.email.trim(), note: f.note, ...(perIniziativa ? { perIniziativa } : {}) }
    const body: CralNuovaPersonaApi = tipo === 'FAM'
      ? { ...base, cognome: f.cognome.trim(), nome: f.nome.trim(), nascita: f.nascita || null, sede: f.sede || rifs[0]?.s.sede || null, legami: rifs.map(r => ({ socio: r.s.id, relazione: r.relazione })) }
      : daAnagrafica && scelto ? { ...base, matricola: scelto.matricola, tessera: conTessera ? f.tessera.trim() : '' }
        : { ...base, cognome: f.cognome.trim(), nome: f.nome.trim(), nascita: f.nascita || null, tessera: conTessera ? f.tessera.trim() : '' }
    const daValidare = !daAnagrafica && tipo !== 'FAM'
    const r = await esegui(() => cralApi.creaPersona(body),
      daValidare ? `${TIPOLOGIE[tipo][0]} creato: resta «Da validare» finché qualcuno non lo valida` : `${TIPOLOGIE[tipo][0]} aggiunto`, daValidare ? 'warning' : 'success')
    setSalvo(false)
    if (r) onClose()
  }
  return (
    <Modale largo titolo={perIniziativa ? 'Nuovo partecipante' : 'Nuova persona'} onClose={onClose} piedi={<><button className={btnSecondario} onClick={onClose}>Annulla</button><button className={btnPrimario} disabled={!ok} onClick={() => void crea()}>Aggiungi</button></>}>
      <div className="flex flex-col gap-4">
        <div><p className={etichettaCls + ' mb-2'}>Tipologia</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {(Object.keys(TIPOLOGIE) as TipoPersona[]).map(k => (
              <button key={k} onClick={() => { setTipo(k); setScelto(null) }} className={sceltaCls(tipo === k)}>
                <p className="text-sm font-medium text-white">{TIPOLOGIE[k][0]}</p><p className="text-xs text-slate-500">{TIPOLOGIE[k][2]}</p></button>))}
          </div></div>
        {tipo === 'EST' && <div className="flex gap-2">
          {([[false, 'Persona esterna', 'Nuovo ID EXT, da validare'], [true, 'Dipendente non socio', "Dall'anagrafica PGS, con la matricola"]] as Array<[boolean, string, string]>).map(([v, t, d]) =>
            <button key={t} onClick={() => { setEstDaPgs(v); setScelto(null) }} className={`flex-1 ${sceltaCls(estDaPgs === v)}`}><p className="text-sm text-white">{t}</p><p className="text-xs text-slate-500">{d}</p></button>)}
        </div>}
        {tipo === 'FAM' && <div className="flex flex-col gap-2">
          <p className={etichettaCls}>Familiare di (uno o più soci)</p>
          {rifs.map((r, k) => <div key={r.s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 px-3 py-2">
            <span className="font-mono text-xs text-slate-400">{r.s.id}</span><span className="text-slate-100 text-sm flex-1">{nominativo(r.s)}</span><Origine s={r.s} />
            <select className={inputW + ' w-44 py-1'} value={r.relazione} onChange={e => setRifs(rifs.map((x, j) => j === k ? { ...x, relazione: e.target.value as Relazione } : x))}>{Object.entries(RELAZIONI).map(([key, l]) => <option key={key} value={key}>{l}</option>)}</select>
            <button className="p-1 text-slate-500 hover:text-red-400" onClick={() => setRifs(rifs.filter((_, j) => j !== k))} aria-label="Togli"><Ico d={D.x} /></button></div>)}
          <CercaSocio key={rifs.length} escludi={rifs.map(r => r.s.id)} onScegli={so => { setRifs([...rifs, { s: so, relazione: rifs.length ? 'FIGLIO' : 'CONIUGE' }]); if (!rifs.length) setF({ ...f, cognome: f.cognome || so.cognome, sede: so.sede ?? '' }) }} />
          {rifs.length > 0 && <p className="text-xs text-slate-500">Puoi aggiungere un altro socio: per esempio il figlio di due soci.</p>}
        </div>}
        {daAnagrafica && (scelto
          ? <div className="flex items-center gap-3 rounded-lg border border-slate-700 px-3 py-2"><span className="font-mono text-xs text-slate-400">{scelto.matricola}</span><span className="text-slate-100 text-sm flex-1">{scelto.cognome} {scelto.nome}</span><button className={btnPiccoloSec} onClick={() => setScelto(null)}>Cambia</button></div>
          : <CercaAnagrafica onScegli={setScelto} />)}
        {!daAnagrafica && <div className="grid gap-4 sm:grid-cols-[1fr_1fr_170px]">
          <Campo label="Cognome"><input className={inputCls} value={f.cognome} onChange={e => setF({ ...f, cognome: e.target.value })} /></Campo>
          <Campo label="Nome"><input className={inputCls} value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} /></Campo>
          <Campo label="Data di nascita"><input type="date" className={inputCls} value={f.nascita} onChange={e => setF({ ...f, nascita: e.target.value })} /></Campo>
        </div>}
        {daAnagrafica && scelto && <p className="text-xs text-slate-500">Data di nascita dall'anagrafica PGS: <span className="text-slate-300 tabular-nums">{fmtData(scelto.nascita)}</span>. Il codice fiscale non si raccoglie.</p>}
        <div className="grid sm:grid-cols-2 gap-4">
          <Campo label="Sede di consegna"><select className={inputCls} value={f.sede} onChange={e => setF({ ...f, sede: e.target.value })}><option value="">— Da indicare</option>{db.sedi.filter(x => x.attiva).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></Campo>
          {conTessera && <Campo label="Tessera CRAL" hint={doppia ? <span className="text-red-400">Tessera già assegnata.</span> : undefined}>
            <div className="flex gap-2"><input className={inputCls + ' font-mono'} value={f.tessera} placeholder={tipo === 'SE' ? 'Anche alla validazione' : 'Facoltativa'} onChange={e => setF({ ...f, tessera: e.target.value })} />
              <button type="button" className={btnPiccoloSec + ' whitespace-nowrap'} onClick={() => setF({ ...f, tessera: prossimaTessera(db.tessera) })}>{prossimaTessera(db.tessera)}</button></div>
          </Campo>}
          <Campo label="Email"><input className={inputCls} value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Campo>
          <Campo label="Note"><input className={inputCls} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Campo>
        </div>
        {(tipo === 'SE' || (tipo === 'EST' && !estDaPgs)) && <p className="text-xs text-amber-400/90">{tipo === 'SE' ? 'Il socio esterno' : "L'esterno"} resta fuori da eventi e report finché non viene validato nella scheda «Da validare»{perIniziativa ? ", anche se è già aggiunto all'evento" : ''}.</p>}
        {tipo === 'FAM' && <p className="text-xs text-slate-500">Il familiare non si valida a parte: vale finché almeno uno dei suoi soci è attivo.</p>}
      </div>
    </Modale>
  )
}
