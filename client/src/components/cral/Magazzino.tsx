// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · modalità MAGAZZINO (biglietti cinema)
// Carichi con data, richieste con data, consegne che scalano la giacenza,
// coda per data di richiesta, registro di magazzino.
// ============================================================

import { useState } from 'react'
import { cralApi } from '../../api/endpoints'
import type { Iniziativa, Persona, Richiesta } from './tipi'
import {
  catPersona, codaRichieste, contiMagazzino, destinatari, etichettaPers, fmtData, fmtEuro, importoRichiesta, lordoRichiesta, movimentiMagazzino,
  nomeDi, nominativo, norm, oggi, ordineRichieste, persona, regolaCat,
} from './logica'
import { ScontoPersonaleModal } from './Sconti'
import { Campo, D, Ico, Modale, Origine, Pill, avviso, btnPiccolo, btnPiccoloSec, btnPrimario, btnSecondario, cardCls, inputCls, thCls, useCral, type Tono } from './ui'

export const STATI_RIC: Record<Richiesta['stato'], [string, Tono]> = { ATTESA: ['In attesa', 'warn'], CONSEGNATA: ['Consegnata', 'ok'], ANNULLATA: ['Annullata', 'neutro'] }
export const MODI_CONS: Record<Richiesta['modo'], string> = { MANO: 'A mano', EMAIL: 'Digitale via email' }

export function MagazzinoCorpo({ ini, chiusa }: { ini: Iniziativa; chiusa: boolean }) {
  const { db, esegui, richiesta } = useCral()
  const [car, setCar] = useState({ art: ini.articoli[0]?.id ?? '', qta: '', data: oggi(), note: '' })
  const [nuova, setNuova] = useState(false)
  const [spRic, setSpRic] = useState<Richiesta | null>(null)
  const [stato, setStato] = useState('ATTESA')
  const [art, setArt] = useState('')
  const [movOn, setMovOn] = useState(false)
  const conti = contiMagazzino(ini); const coda = codaRichieste(ini)
  const artNome = (id: string) => ini.articoli.find(a => a.id === id)?.nome ?? id
  const lista = ini.richieste.filter(r => (!stato || r.stato === stato) && (!art || r.art === art)).sort(ordineRichieste)
  async function carica() {
    const q = parseInt(car.qta, 10); if (!(q > 0)) { avviso('Quantità non valida', 'error'); return }
    const r = await esegui(() => cralApi.carico(ini.id, { art: car.art, qta: q, data: car.data || oggi(), note: car.note.trim() }), `Caricati ${q} biglietti ${artNome(car.art)}`)
    if (r) setCar({ ...car, qta: '', note: '' })
  }
  async function consegna(r: Richiesta) {
    const c = conti[r.art]
    if (!c || c.giac < r.qta) { avviso(`Giacenza insufficiente per ${artNome(r.art)}: ${c?.giac ?? 0} disponibili, ne servono ${r.qta}.`, 'error'); return }
    const prima = ini.richieste.filter(x => x.stato === 'ATTESA' && x.art === r.art && x.id !== r.id && ordineRichieste(x, r) < 0)
    const restano = c.giac - r.qta, scoperte = prima.filter(x => x.qta > restano).length
    if (await richiesta(ini.id, r.id, { stato: 'CONSEGNATA', dataCons: oggi() })) {
      if (coda[r.id] === 'coda' && scoperte) avviso(`Consegnati ${r.qta} biglietti a ${nomeDi(db, r.persona)} saltando la coda: ${scoperte} richieste precedenti restano senza biglietti.`, 'warning')
      else avviso(`Consegnati ${r.qta} biglietti ${artNome(r.art)} a ${nomeDi(db, r.persona)}`)
    }
  }
  return (
    <>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {ini.articoli.map(a => {
          const c = conti[a.id]!
          return (
            <div key={a.id} className={`${cardCls} px-4 py-3 flex flex-col gap-1`}>
              <div className="flex items-center"><p className="text-sm font-medium text-white flex-1">{a.nome}</p><span className="text-xs text-slate-500 tabular-nums">{fmtEuro(a.prezzo)} al socio</span></div>
              <p className="text-2xl font-semibold tabular-nums text-white">{c.giac} <span className="text-sm font-normal text-slate-500">in giacenza</span></p>
              <p className="text-xs text-slate-400 tabular-nums">caricati {c.car} · consegnati {c.con} · in attesa {c.att} · <span className={c.disp < 0 ? 'text-amber-400' : ''}>{c.disp < 0 ? `mancano ${-c.disp}` : `liberi ${c.disp}`}</span></p>
            </div>)
        })}
      </div>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <div className={`${cardCls} overflow-hidden`}>
          <div className="px-5 py-3 border-b border-slate-800"><p className="text-sm font-medium text-white">Carichi</p><p className="text-xs text-slate-500">Biglietti arrivati al CRAL, con la data di carico.</p></div>
          {!chiusa && <div className="px-5 py-3 border-b border-slate-800 grid grid-cols-2 sm:grid-cols-[1.4fr_80px_140px] gap-2 items-end">
            <Campo label="Articolo"><select className={inputCls} value={car.art} onChange={e => setCar({ ...car, art: e.target.value })}>{ini.articoli.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}</select></Campo>
            <Campo label="Quantità"><input inputMode="numeric" className={inputCls + ' text-right tabular-nums'} value={car.qta} onChange={e => setCar({ ...car, qta: e.target.value.replace(/\D/g, '') })} /></Campo>
            <Campo label="Data carico"><input type="date" className={inputCls} value={car.data} onChange={e => setCar({ ...car, data: e.target.value })} /></Campo>
            <div className="col-span-2 sm:col-span-3 flex gap-2"><input className={inputCls} maxLength={300} placeholder="Note (es. lotto, scadenza dei biglietti)" value={car.note} onChange={e => setCar({ ...car, note: e.target.value })} /><button className={btnPrimario + ' whitespace-nowrap'} disabled={!car.qta || !car.art} onClick={() => void carica()}><Ico d={D.plus} />Carica</button></div>
          </div>}
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-800/70">
            {ini.carichi.slice().sort((a, b) => b.data.localeCompare(a.data)).map(c => <div key={c.id} className="px-5 py-2 flex items-center gap-3 text-sm"><span className="text-slate-400 tabular-nums w-20">{fmtData(c.data)}</span><span className="flex-1 text-slate-200">{artNome(c.art)}{c.note && <span className="text-xs text-slate-500"> · {c.note}</span>}</span><span className="text-emerald-300 tabular-nums">+{c.qta}</span></div>)}
            {!ini.carichi.length && <p className="px-5 py-6 text-sm text-slate-500">Nessun carico.</p>}
          </div>
        </div>
        <div className={`${cardCls} overflow-hidden`}>
          <div className="px-5 py-3 border-b border-slate-800 flex items-center"><div className="flex-1"><p className="text-sm font-medium text-white">Registro di magazzino</p><p className="text-xs text-slate-500">Carichi e consegne in ordine di data, con la giacenza che scala.</p></div><button className={btnPiccoloSec} onClick={() => setMovOn(!movOn)}>{movOn ? 'Nascondi' : 'Mostra'}</button></div>
          {movOn && <div className="max-h-72 overflow-y-auto"><table className="w-full text-sm"><tbody className="divide-y divide-slate-800/70 tabular-nums">
            {movimentiMagazzino(db, ini).map((m, k) => <tr key={k}><td className="px-5 py-1.5 text-slate-400 w-24">{fmtData(m.data)}</td><td className="px-2 py-1.5 text-slate-300">{artNome(m.art)}</td><td className="px-2 py-1.5 text-xs text-slate-500">{m.desc}</td><td className={`px-2 py-1.5 text-right ${m.q > 0 ? 'text-emerald-300' : 'text-red-300'}`}>{m.q > 0 ? `+${m.q}` : m.q}</td><td className="px-5 py-1.5 text-right text-white">{m.giac}</td></tr>)}
          </tbody></table></div>}
        </div>
      </div>

      <div className={`${cardCls} overflow-hidden`}>
        <div className="px-5 py-3 border-b border-slate-800 flex flex-wrap gap-3 items-end">
          <p className="text-sm font-medium text-white flex-1 self-center">Richieste</p>
          <select className={inputCls + ' sm:w-44'} value={stato} onChange={e => setStato(e.target.value)}><option value="">Tutte</option>{(Object.keys(STATI_RIC) as Array<Richiesta['stato']>).map(k => <option key={k} value={k}>{STATI_RIC[k][0]}</option>)}</select>
          <select className={inputCls + ' sm:w-48'} value={art} onChange={e => setArt(e.target.value)}><option value="">Tutti gli articoli</option>{ini.articoli.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}</select>
          {!chiusa && <button className={btnPrimario} onClick={() => setNuova(true)}><Ico d={D.plus} />Nuova richiesta</button>}
        </div>
        <div className="overflow-x-auto max-h-[520px] overflow-y-auto"><table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-900 text-left text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-2.5 font-semibold">Richiesta il</th><th className={thCls}>Persona</th><th className={thCls}>Articolo</th><th className={thCls + ' text-right'}>Q.tà</th><th className={thCls + ' text-right'}>Importo</th><th className={thCls}>Stato</th><th className={thCls}>Consegna</th><th className={thCls + ' text-center'}>Pagato</th><th className="px-5 py-2.5 font-semibold text-right">Azioni</th></tr></thead>
          <tbody className="divide-y divide-slate-800/70">
            {lista.map(r => {
              const [sl, st] = STATI_RIC[r.stato]; const imp = importoRichiesta(db, ini, r), lordo = lordoRichiesta(ini, r)
              return (
                <tr key={r.id} className="hover:bg-slate-800/30">
                  <td className="px-5 py-2 text-slate-400 tabular-nums whitespace-nowrap">{fmtData(r.dataRich)}</td>
                  <td className="px-3 py-2 text-slate-100 whitespace-nowrap">{nomeDi(db, r.persona)}</td>
                  <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{artNome(r.art)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-white">{r.qta}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-300 whitespace-nowrap">{imp !== lordo && <div className="text-[11px] text-slate-500 line-through">{fmtEuro(lordo)}</div>}{fmtEuro(imp)}
                    <div><button disabled={chiusa || r.stato === 'ANNULLATA'} className={`text-[11px] ${r.sconto ? 'text-amber-300' : 'text-slate-500 hover:text-slate-300'}`} onClick={() => setSpRic(r)}>{etichettaPers(r.sconto, regolaCat(ini, catPersona(persona(db, r.persona))))}</button></div></td>
                  <td className="px-3 py-2 whitespace-nowrap"><Pill tono={st}>{sl}</Pill>{r.stato === 'ATTESA' && <span className={`ml-2 text-[11px] ${coda[r.id] === 'pronta' ? 'text-emerald-300' : 'text-amber-400'}`}>{coda[r.id] === 'pronta' ? 'consegnabile' : 'in coda: mancano biglietti'}</span>}</td>
                  <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">{r.stato === 'CONSEGNATA' ? `${fmtData(r.dataCons)} · ${MODI_CONS[r.modo]}` : <select disabled={chiusa || r.stato !== 'ATTESA'} className="bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-xs" value={r.modo} onChange={e => void richiesta(ini.id, r.id, { modo: e.target.value as Richiesta['modo'] })}>{(Object.keys(MODI_CONS) as Array<Richiesta['modo']>).map(k => <option key={k} value={k}>{MODI_CONS[k]}</option>)}</select>}</td>
                  <td className="px-3 py-2 text-center"><input type="checkbox" className="accent-emerald-500 w-4 h-4" disabled={chiusa || r.stato === 'ANNULLATA'} checked={r.pagato} onChange={e => void richiesta(ini.id, r.id, { pagato: e.target.checked })} aria-label={`Pagato da ${nomeDi(db, r.persona)}`} /></td>
                  <td className="px-5 py-2"><div className="flex justify-end gap-1.5">
                    {r.stato === 'ATTESA' && !chiusa && <><button className={btnPiccolo + ' bg-emerald-700/80 hover:bg-emerald-600 text-white'} onClick={() => void consegna(r)}>Consegna</button><button className={btnPiccoloSec} onClick={() => void richiesta(ini.id, r.id, { stato: 'ANNULLATA', dataCons: null })}>Annulla</button></>}
                    {r.stato !== 'ATTESA' && !chiusa && <button className={btnPiccoloSec} onClick={() => void richiesta(ini.id, r.id, { stato: 'ATTESA', dataCons: null })}>{r.stato === 'CONSEGNATA' ? 'Storna consegna' : 'Ripristina'}</button>}
                  </div></td>
                </tr>)
            })}
            {!lista.length && <tr><td colSpan={9} className="px-5 py-10 text-center text-slate-500">Nessuna richiesta con questi filtri.</td></tr>}
          </tbody>
        </table></div>
        <p className="px-5 py-3 border-t border-slate-800 text-xs text-slate-500">Le richieste in attesa si servono in ordine di data: «consegnabile» se la giacenza basta. «Consegna» scala la giacenza con la data di oggi; «Storna consegna» la rimette in magazzino. L'importo tiene conto degli sconti: regola della tipologia (€ a biglietto) o sconto personale sulla richiesta.</p>
      </div>
      {spRic && <ScontoPersonaleModal titolo={`Sconto · ${nomeDi(db, spRic.persona)}`} sotto={`${spRic.qta} biglietti · sulla richiesta intera`} regola={regolaCat(ini, catPersona(persona(db, spRic.persona)))} valore={spRic.sconto} lordo={lordoRichiesta(ini, spRic)} onClose={() => setSpRic(null)}
        onSalva={v => { const r = spRic; setSpRic(null); void richiesta(ini.id, r.id, { sconto: v }).then(ok => { if (ok) avviso(v ? 'Sconto personale salvato' : 'Sconto automatico') }) }} />}
      {nuova && <NuovaRichiestaModal ini={ini} onClose={() => setNuova(false)} />}
    </>
  )
}

function NuovaRichiestaModal({ ini, onClose }: { ini: Iniziativa; onClose: () => void }) {
  const { db, esegui } = useCral()
  const [ric, setRic] = useState<{ persona: Persona | null; art: string; qta: string; dataRich: string; modo: Richiesta['modo'] }>({ persona: null, art: ini.articoli[0]?.id ?? '', qta: '2', dataRich: oggi(), modo: 'MANO' })
  const [q, setQ] = useState('')
  const dest = destinatari(db, ini)
  const n = norm(q)
  const ris = n.length < 2 ? [] : dest.filter(s => norm(`${nominativo(s)} ${s.id} ${s.tessera}`).includes(n)).slice(0, 8)
  const ok = !!ric.persona && parseInt(ric.qta, 10) > 0 && !!ric.dataRich && !!ric.art
  async function salva() {
    if (!ric.persona) return
    const p = ric.persona, qta = parseInt(ric.qta, 10)
    const r = await esegui(() => cralApi.richiesta(ini.id, { persona: p.id, art: ric.art, qta, dataRich: ric.dataRich, modo: ric.modo, note: '' }),
      `Richiesta di ${qta} biglietti per ${nominativo(p)}`)
    if (r) onClose()
  }
  return (
    <Modale titolo="Nuova richiesta di biglietti" sotto={`Da «${ini.titolo}»: tra i partecipanti dell'evento`} onClose={onClose} piedi={<><button className={btnSecondario} onClick={onClose}>Annulla</button><button className={btnPrimario} disabled={!ok} onClick={() => void salva()}>Registra richiesta</button></>}>
      <div className="flex flex-col gap-4">
        {ric.persona ? <div className="flex items-center gap-3 rounded-lg border border-slate-700 px-3 py-2"><span className="font-mono text-xs text-slate-400">{ric.persona.id}</span><span className="text-slate-100 text-sm flex-1">{nominativo(ric.persona)}</span><Origine s={ric.persona} /><button className={btnPiccoloSec} onClick={() => setRic({ ...ric, persona: null })}>Cambia</button></div>
          : <div className="flex flex-col gap-2"><input autoFocus className={inputCls} placeholder="Chi chiede: cognome, ID o tessera" value={q} onChange={e => setQ(e.target.value)} />
            {n.length >= 2 && <div className="border border-slate-800 rounded-lg divide-y divide-slate-800 max-h-56 overflow-y-auto">{ris.map(s => <button key={s.id} className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-3 text-sm" onClick={() => setRic({ ...ric, persona: s })}><span className="font-mono text-xs text-slate-400 w-20">{s.id}</span><span className="text-slate-100 flex-1">{nominativo(s)}</span><Origine s={s} /></button>)}{!ris.length && <p className="px-3 py-3 text-sm text-slate-500">Nessuno tra i partecipanti.</p>}</div>}</div>}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="col-span-2"><Campo label="Articolo"><select className={inputCls} value={ric.art} onChange={e => setRic({ ...ric, art: e.target.value })}>{ini.articoli.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}</select></Campo></div>
          <Campo label="Quantità"><input inputMode="numeric" className={inputCls + ' text-right'} value={ric.qta} onChange={e => setRic({ ...ric, qta: e.target.value.replace(/\D/g, '') })} /></Campo>
          <Campo label="Data richiesta"><input type="date" className={inputCls} value={ric.dataRich} onChange={e => setRic({ ...ric, dataRich: e.target.value })} /></Campo>
        </div>
        <Campo label="Consegna"><select className={inputCls} value={ric.modo} onChange={e => setRic({ ...ric, modo: e.target.value as Richiesta['modo'] })}>{(Object.keys(MODI_CONS) as Array<Richiesta['modo']>).map(k => <option key={k} value={k}>{MODI_CONS[k]}</option>)}</select></Campo>
      </div>
    </Modale>
  )
}
