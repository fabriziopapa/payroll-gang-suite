// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · scheda Da validare
// Soci esterni ed esterni: si correggono (tipologia, sede, tessera,
// nominativo, nascita), si validano, si rifiutano o si trovano in PGS.
// ============================================================

import { useState } from 'react'
import { cralApi } from '../../api/endpoints'
import type { Persona } from './tipi'
import { TIPOLOGIE, fmtData, nominativo, tesseraDaTesto, tesseraDoppia } from './logica'
import { CercaAnagrafica } from './SociTab'
import {
  Campo, Conferma, D, Ico, Modale, Origine, Pill, avviso, btnPiccolo, btnPiccoloSec, btnPrimario, btnSecondario, cardCls, inputCls, inputW, thCls, useCral,
} from './ui'

export function ValidareTab() {
  const { db, esegui } = useCral()
  const [collega, setCollega] = useState<Persona | null>(null)
  const [rifiuta, setRifiuta] = useState<Persona | null>(null)
  const rifiutati = db.soci.filter(s => s.stato === 'RIFIUTATO')
  return (
    <div className="flex flex-col gap-6">
      <SezioneValidazione tipo="SE" onCollega={setCollega} onRifiuta={setRifiuta}
        titolo="Soci esterni da validare"
        spiega="Diventano soci a tutti gli effetti: entrano nell'elenco soci con la tessera del libro soci (non si assegna in automatico: se manca la scrivi qui), negli eventi per gruppi «soci esterni» e possono avere familiari. Se in realtà è un dipendente, «Trova in anagrafica PGS» lo trasforma in socio dipendente con la sua matricola." />
      <SezioneValidazione tipo="EST" onCollega={setCollega} onRifiuta={setRifiuta}
        titolo="Esterni da validare"
        spiega="Non diventano soci: niente tessera, niente elenco soci. Con la validazione possono partecipare agli eventi aperti agli esterni o a cui vengono aggiunti. Se è un dipendente non iscritto, «Trova in anagrafica PGS» gli dà la matricola e resta esterno." />
      {rifiutati.length > 0 && <details className={`${cardCls} px-5 py-3 text-sm`}><summary className="cursor-pointer text-slate-300 select-none">Rifiutati ({rifiutati.length})</summary>
        <div className="mt-3 divide-y divide-slate-800">{rifiutati.map(s => <div key={s.id} className="py-2 flex items-center gap-3"><span className="font-mono text-xs text-slate-500">{s.id}</span><span className="flex-1 text-slate-300">{nominativo(s)}</span><Origine s={s} />
          <button className={btnPiccoloSec} onClick={() => void esegui(() => cralApi.cambiaStato([s.id], 'rimetti'), 'Rimesso in attesa', 'info')}>Rimetti in attesa</button></div>)}</div></details>}
      {collega && <Modale titolo={`Trova ${nominativo(collega)} in anagrafica PGS`} sotto={collega.tipo === 'SE' ? 'Diventa socio dipendente: ID = matricola. Sede, tessera, familiari, scelte e ordini restano.' : 'Resta esterno, con la matricola come ID. Scelte e ordini restano.'} onClose={() => setCollega(null)}>
        <CercaAnagrafica onScegli={a => {
          const p = collega
          void esegui(() => cralApi.collega(p.id, a.matricola), `${p.id} trovato in anagrafica PGS: ora è ${TIPOLOGIE[p.tipo === 'SE' ? 'SD' : 'EST'][0].toLowerCase()} con matricola ${a.matricola}`)
            .then(r => { if (r) setCollega(null) })
        }} />
      </Modale>}
      {rifiuta && <Conferma testo={`Rifiutare ${nominativo(rifiuta)}?`} etichetta="Rifiuta" pericolo onClose={() => setRifiuta(null)}
        dettaglio={rifiuta.tipo === 'SE' ? 'Non diventa socio. Resta tra i rifiutati e può essere rimesso in attesa.' : 'Non potrà partecipare agli eventi. Resta tra i rifiutati e può essere rimesso in attesa.'}
        onOk={() => { void esegui(() => cralApi.cambiaStato([rifiuta.id], 'rifiuta'), 'Rifiutato', 'info') }} />}
    </div>
  )
}

function SezioneValidazione({ tipo, titolo, spiega, onCollega, onRifiuta }: {
  tipo: 'SE' | 'EST'; titolo: string; spiega: string; onCollega: (p: Persona) => void; onRifiuta: (p: Persona) => void
}) {
  const { db, esegui } = useCral()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [mod, setMod] = useState<Persona | null>(null)
  const [tTxt, setTTxt] = useState<Record<string, string>>({})
  const lista = db.soci.filter(s => s.stato === 'DA_VALIDARE' && s.tipo === tipo).sort((a, b) => nominativo(a).localeCompare(nominativo(b)))
  const tutti = lista.length > 0 && lista.every(s => sel.has(s.id))
  const socio = tipo === 'SE'
  const senzaTessera = socio ? lista.filter(s => !s.tessera).length : 0
  const aggiorna = (s: Persona, p: Parameters<typeof cralApi.modificaPersona>[1], ok?: string) => esegui(() => cralApi.modificaPersona(s.id, p), ok, 'info')
  function salvaTessera(s: Persona, txt: string) {
    const v = tesseraDaTesto(db.tessera, txt)
    setTTxt(x => { const n = { ...x }; delete n[s.id]; return n })
    if (v === s.tessera) return
    if (tesseraDoppia(db, s.id, v)) { avviso(`La tessera ${v} è già di un altro socio`, 'error'); return }
    void aggiorna(s, { tessera: v }, v ? `Tessera ${v} a ${nominativo(s)}` : undefined)
  }
  function valida(ids: string[]) {
    // la tessera NON si assegna qui: arriva dal libro soci (N.ISCR.SOCIO) o si scrive a mano nella riga
    const nt = socio ? lista.filter(s => ids.includes(s.id) && !s.tessera).length : 0
    void esegui(() => cralApi.cambiaStato(ids, 'valida'),
      `${ids.length} ${socio ? (ids.length === 1 ? 'socio esterno validato' : 'soci esterni validati') : (ids.length === 1 ? 'esterno validato' : 'esterni validati')}${nt ? ` · ${nt} ancora senza tessera` : ''}`,
      nt ? 'warning' : 'success').then(r => { if (r) setSel(new Set()) })
  }
  return (
    <section className={`${cardCls} overflow-hidden`}>
      <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap gap-3 items-start">
        <div className="flex-1 min-w-[260px]"><div className="flex items-center gap-2"><Origine s={{ tipo }} /><h3 className="text-white font-semibold">{titolo}</h3><span className="text-xs text-slate-500 tabular-nums">{lista.length}</span></div>
          <p className="text-xs text-slate-400 mt-1 max-w-[80ch]">{spiega}</p>
          {senzaTessera > 0 && <p className="text-xs text-amber-400 mt-1">{senzaTessera === 1 ? '1 socio esterno senza tessera' : `${senzaTessera} soci esterni senza tessera`}: scrivi il numero del libro soci nella colonna Tessera (si può validare anche senza, e aggiungerla dopo).</p>}</div>
        <button className={btnPrimario} disabled={!sel.size} onClick={() => valida([...sel])}><Ico d={D.check} />Valida selezionati {sel.size ? `(${sel.size})` : ''}</button>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 bg-slate-900/60">
          <th className="pl-5 pr-2 py-2.5"><input type="checkbox" className="accent-indigo-500" checked={tutti} onChange={() => setSel(tutti ? new Set() : new Set(lista.map(s => s.id)))} aria-label="Seleziona tutti" /></th>
          <th className={thCls}>Nominativo</th><th className={thCls}>Tipologia</th><th className={thCls}>Sede</th>{socio && <th className={thCls}>Tessera</th>}<th className="px-5 py-2.5 font-semibold text-right">Azioni</th></tr></thead>
        <tbody className="divide-y divide-slate-800/70">
          {lista.map(s => {
            const tv = tTxt[s.id] ?? s.tessera
            return (
              <tr key={s.id} className="hover:bg-slate-800/30 align-top">
                <td className="pl-5 pr-2 py-2.5"><input type="checkbox" className="accent-indigo-500" checked={sel.has(s.id)} onChange={() => { const n = new Set(sel); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); setSel(n) }} aria-label={`Seleziona ${nominativo(s)}`} /></td>
                <td className="px-3 py-2 max-w-[260px]"><span className="text-slate-100">{nominativo(s)}</span>{s.atipico && <span className="ml-1.5"><Pill tono="warn">ATIPICO</Pill></span>}
                  <div className="text-xs text-slate-500"><span className="font-mono text-violet-300/80">{s.id}</span>{s.nascita ? ` · nato/a il ${fmtData(s.nascita)}` : ' · data di nascita mancante'}</div>
                  <div className="text-[11px] text-slate-600">{s.provenienza ?? ''} · {fmtData(s.creatoIl)}{s.creatoDa ? ` · ${s.creatoDa}` : ''}</div>
                  {s.note && <div className="text-[11px] text-slate-500 whitespace-normal">{s.note}</div>}</td>
                <td className="px-3 py-2"><select className={inputW + ' py-1 text-xs w-32'} value={s.tipo} onChange={e => { const nuovo = e.target.value as 'SE' | 'EST'; void aggiorna(s, { tipo: nuovo }, `${nominativo(s)} spostato tra ${nuovo === 'SE' ? 'i soci esterni' : 'gli esterni'} da validare`) }}><option value="SE">Socio esterno</option><option value="EST">Esterno</option></select></td>
                <td className="px-3 py-2"><select className={`${inputCls} py-1 text-xs w-40 ${!s.sede && socio ? 'border-amber-700' : ''}`} value={s.sede ?? ''} onChange={e => void aggiorna(s, { sede: e.target.value || null })}><option value="">— Da indicare</option>{db.sedi.filter(x => x.attiva || x.id === s.sede).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></td>
                {socio && <td className="px-3 py-2"><input className={`${inputCls} py-1 text-xs font-mono w-24 ${!s.tessera ? 'border-amber-700' : ''}`} value={tv} placeholder="n. iscr." onChange={e => setTTxt(x => ({ ...x, [s.id]: e.target.value }))} onBlur={e => salvaTessera(s, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} /></td>}
                <td className="px-5 py-2 min-w-[300px]"><div className="flex justify-end gap-1.5 flex-wrap [&>button]:whitespace-nowrap">
                  <button className={btnPiccoloSec} onClick={() => setMod(s)}><Ico d={D.edit} cls="w-3.5 h-3.5" />Modifica</button>
                  <button className={btnPiccolo + ' bg-emerald-700/80 hover:bg-emerald-600 text-white'} onClick={() => valida([s.id])}><Ico d={D.check} cls="w-3.5 h-3.5" />Valida</button>
                  <button className={btnPiccoloSec} onClick={() => onCollega(s)}><Ico d={D.search} cls="w-3.5 h-3.5" />Trova in anagrafica PGS</button>
                  <button className={btnPiccolo + ' text-red-300 hover:bg-red-950/40 border border-red-900/60'} onClick={() => onRifiuta(s)}>Rifiuta</button>
                </div></td>
              </tr>)
          })}
          {!lista.length && <tr><td colSpan={8} className="px-5 py-8 text-center text-slate-500">Nessuno in attesa. Arrivano dall'importazione, da «Nuova persona» o dall'aggiunta a un evento.</td></tr>}
        </tbody>
      </table></div>
      {mod && <ModificaDaValidare s={mod} onClose={() => setMod(null)} />}
    </section>
  )
}

/** Correzione dei dati prima della validazione: nominativo (es. cognome composto letto male dal file), nascita, email, tipologia, sede, tessera. */
function ModificaDaValidare({ s, onClose }: { s: Persona; onClose: () => void }) {
  const { db, esegui } = useCral()
  const [f, setF] = useState({ cognome: s.cognome, nome: s.nome, nascita: s.nascita ?? '', email: s.email, tipo: s.tipo as 'SE' | 'EST', sede: s.sede ?? '', tessera: s.tessera, note: s.note })
  const tes = tesseraDaTesto(db.tessera, f.tessera)
  const dop = f.tipo === 'SE' && tesseraDoppia(db, s.id, tes)
  const ok = !!f.cognome.trim() && !!f.nome.trim() && !dop
  async function salva() {
    const r = await esegui(() => cralApi.modificaPersona(s.id, {
      cognome: f.cognome.trim(), nome: f.nome.trim(), nascita: f.nascita || null, email: f.email.trim(),
      ...(f.tipo !== s.tipo ? { tipo: f.tipo } : {}), sede: f.sede || null, tessera: f.tipo === 'SE' ? tes : '', note: f.note,
    }), `${f.cognome.trim().toUpperCase()} ${f.nome.trim()}: dati corretti`)
    if (r) onClose()
  }
  const tuttoMaiuscolo = /^[A-Z' ]+$/.test(`${s.cognome} ${s.nome}`) && `${s.cognome} ${s.nome}`.trim().split(/\s+/).length > 2
  return (
    <Modale titolo={`Correggi ${nominativo(s)}`} sotto={<span>Prima della validazione · <span className="font-mono">{s.id}</span>{s.provenienza ? ` · ${s.provenienza}` : ''}</span>} onClose={onClose}
      piedi={<><button className={btnSecondario} onClick={onClose}>Annulla</button><button className={btnPrimario} disabled={!ok} onClick={() => void salva()}>Salva</button></>}>
      <div className="flex flex-col gap-4">
        {tuttoMaiuscolo && <p className="text-xs text-amber-400">Dal file è arrivato tutto maiuscolo: controlla dove finisce il cognome (es. «DE LUCA» + «MARIA ROSA»).</p>}
        <div className="grid sm:grid-cols-2 gap-4">
          <Campo label="Cognome"><input className={inputCls} value={f.cognome} onChange={e => setF({ ...f, cognome: e.target.value })} /></Campo>
          <Campo label="Nome"><input className={inputCls} value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} /></Campo>
          <Campo label="Data di nascita" hint="Al posto del codice fiscale"><input type="date" className={inputCls} value={f.nascita} onChange={e => setF({ ...f, nascita: e.target.value })} /></Campo>
          <Campo label="Email"><input className={inputCls} value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Campo>
          <Campo label="Tipologia" hint={f.tipo === 'EST' ? 'Esterno: non è socio, niente tessera.' : "Socio esterno: entra nell'elenco soci con la sua tessera."}><select className={inputCls} value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value as 'SE' | 'EST' })}><option value="SE">Socio esterno</option><option value="EST">Esterno</option></select></Campo>
          <Campo label="Sede di consegna"><select className={inputCls} value={f.sede} onChange={e => setF({ ...f, sede: e.target.value })}><option value="">— Da indicare</option>{db.sedi.filter(x => x.attiva || x.id === f.sede).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></Campo>
          {f.tipo === 'SE' && <Campo label="Tessera (N.ISCR.SOCIO del libro soci)" hint={dop ? <span className="text-red-400">Già assegnata a un altro socio.</span> : tes && tes !== f.tessera.trim() ? `Diventa ${tes}` : 'Facoltativa: si può aggiungere dopo'}><input className={inputCls + ' font-mono'} value={f.tessera} onChange={e => setF({ ...f, tessera: e.target.value })} /></Campo>}
        </div>
        <Campo label="Note"><input className={inputCls} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Campo>
      </div>
    </Modale>
  )
}
