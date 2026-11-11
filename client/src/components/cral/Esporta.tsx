// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · esportazione a scelta
// Chi esporta decide colonne (e ordine), chi entra, formato; un insieme
// di scelte si salva come modello, condiviso fra gli amministratori.
// Il numero di telefono esce solo per chi ha dato il consenso: per la
// manutenzione dei dati c'è «Esporta Excel» (tracciato T6).
// Il catalogo delle colonne è lo STESSO del server (services/cral/esporta.ts).
// ============================================================

import { useState } from 'react'
import { cralApi } from '../../api/endpoints'
import type { ModelloExport } from './tipi'
import { contattabile, perWhatsapp } from './contatti'
import { scaricaBase64 } from './ImportDati'
import { Campo, D, Ico, Interruttore, Modale, avviso, btnPiccoloSec, btnPrimario, btnSecondario, chipCls, etichettaCls, inputCls, messaggioErrore, sceltaCls, useCral } from './ui'

type Gruppo = 'Persona' | 'Iscrizione' | 'Telefono e WhatsApp' | 'Alimentari'
export const COLONNE: Array<{ id: string; nome: string; gruppo: Gruppo }> = [
  { id: 'cognome', nome: 'Cognome', gruppo: 'Persona' }, { id: 'nome', nome: 'Nome', gruppo: 'Persona' },
  { id: 'nominativo', nome: 'Nominativo', gruppo: 'Persona' }, { id: 'nascita', nome: 'Data di nascita', gruppo: 'Persona' },
  { id: 'email', nome: 'Email', gruppo: 'Persona' }, { id: 'familiareDi', nome: 'Familiare di', gruppo: 'Persona' }, { id: 'note', nome: 'Note', gruppo: 'Persona' },
  { id: 'id', nome: 'ID', gruppo: 'Iscrizione' }, { id: 'matricola', nome: 'Matricola', gruppo: 'Iscrizione' }, { id: 'tessera', nome: 'Tessera', gruppo: 'Iscrizione' },
  { id: 'tipologia', nome: 'Tipologia', gruppo: 'Iscrizione' }, { id: 'stato', nome: 'Stato', gruppo: 'Iscrizione' },
  { id: 'sede', nome: 'Sede', gruppo: 'Iscrizione' }, { id: 'sedeNome', nome: 'Sede (nome)', gruppo: 'Iscrizione' }, { id: 'iscrittoIl', nome: 'Iscritto il', gruppo: 'Iscrizione' },
  { id: 'waId', nome: 'wa_id', gruppo: 'Telefono e WhatsApp' }, { id: 'telefono', nome: 'Telefono', gruppo: 'Telefono e WhatsApp' },
  { id: 'telefonoLeggibile', nome: 'Telefono (leggibile)', gruppo: 'Telefono e WhatsApp' }, { id: 'whatsapp', nome: 'WhatsApp', gruppo: 'Telefono e WhatsApp' },
  { id: 'consensoIl', nome: 'Data consenso', gruppo: 'Telefono e WhatsApp' }, { id: 'consensoOrigine', nome: 'Origine consenso', gruppo: 'Telefono e WhatsApp' },
  { id: 'esigenze', nome: 'Esigenze alimentari', gruppo: 'Alimentari' }, { id: 'allergie', nome: 'Allergie', gruppo: 'Alimentari' },
]
const GRUPPI: Gruppo[] = ['Persona', 'Iscrizione', 'Telefono e WhatsApp', 'Alimentari']
const nomeCol = (id: string) => COLONNE.find(c => c.id === id)?.nome ?? id

/** Modelli pronti: non si cancellano. Quelli salvati stanno nei parametri del modulo. */
export const MODELLI_PRONTI: ModelloExport[] = [
  { id: 'pronto-whatsapp', nome: 'Lista WhatsApp', colonne: ['waId', 'telefono', 'nome', 'cognome', 'sedeNome'], solo: 'WHATSAPP', formato: 'csv', separatore: ',' },
  { id: 'pronto-rubrica', nome: 'Rubrica telefonica', colonne: ['cognome', 'nome', 'telefonoLeggibile', 'whatsapp', 'email', 'sedeNome'], solo: 'CONTATTABILI', formato: 'xlsx', separatore: ';' },
  { id: 'pronto-alimentari', nome: 'Esigenze alimentari', colonne: ['cognome', 'nome', 'esigenze', 'allergie', 'sedeNome'], solo: 'ALIMENTARI', formato: 'xlsx', separatore: ';' },
  { id: 'pronto-elenco', nome: 'Elenco con email', colonne: ['id', 'tessera', 'cognome', 'nome', 'tipologia', 'email', 'sedeNome'], solo: 'TUTTI', formato: 'xlsx', separatore: ';' },
]
const SOLO: Record<ModelloExport['solo'], string> = {
  TUTTI: 'Tutti', CONTATTABILI: 'Chi ha dato il consenso al numero',
  WHATSAPP: 'Consenso al numero e WhatsApp sì o da verificare', ALIMENTARI: 'Chi ha esigenze alimentari o allergie',
}

/** `ids`: le persone da cui partire (l'elenco filtrato, i selezionati, i partecipanti di un evento). */
export function EsportaElenco({ ids, familiari = [], titolo, onClose, iniziale = 'pronto-whatsapp' }: { ids: string[]; familiari?: string[]; titolo: string; onClose: () => void; iniziale?: string }) {
  const { db, esegui } = useCral()
  const modelli = [...MODELLI_PRONTI, ...db.modelliExport]
  const [m, setM] = useState<ModelloExport>(() => ({ ...(modelli.find(x => x.id === iniziale) ?? MODELLI_PRONTI[0]!) }))
  const [nome, setNome] = useState('')
  const [lavoro, setLavoro] = useState(false)
  const [conFam, setConFam] = useState(false)
  const pers = [...ids, ...(conFam ? familiari.filter(x => !ids.includes(x)) : [])].flatMap(id => { const p = db.perId.get(id); return p && p.stato !== 'ELIMINATO' ? [p] : [] })
  const dentro = pers.filter(p => m.solo === 'CONTATTABILI' ? contattabile(p.contatti) : m.solo === 'WHATSAPP' ? perWhatsapp(p.contatti) : m.solo === 'ALIMENTARI' ? p.alimentari.esigenze.length > 0 || !!p.alimentari.allergie : true)
  const conTel = m.colonne.some(c => COLONNE.find(x => x.id === c)?.gruppo === 'Telefono e WhatsApp')
  const senzaConsenso = conTel ? dentro.filter(p => !contattabile(p.contatti)).length : 0
  const sposta = (i: number, d: -1 | 1) => { const c = [...m.colonne]; const j = i + d; if (j < 0 || j >= c.length) return; [c[i], c[j]] = [c[j]!, c[i]!]; setM({ ...m, colonne: c }) }
  const salvato = db.modelliExport.find(x => x.id === m.id)
  async function scaricaFile() {
    setLavoro(true)
    try {
      const r = await cralApi.esportaElenco({ ids: pers.map(p => p.id), colonne: m.colonne, solo: m.solo, formato: m.formato, separatore: m.separatore, titolo: (m.nome || titolo).slice(0, 60) })
      const base = `cral-${(m.nome || titolo).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'elenco'}`
      scaricaBase64(`${base}_${new Date().toISOString().slice(0, 10)}.${m.formato}`, r.base64, m.formato === 'csv' ? 'text/csv;charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      avviso(`Esportate ${r.righe} persone. Il file contiene dati personali: usalo solo per lo scopo per cui è stato dato il consenso.`, 'info')
      onClose()
    } catch (e) { avviso(messaggioErrore(e), 'error') }
    setLavoro(false)
  }
  async function salvaModello() {
    const n = nome.trim(); if (!n) return
    const id = salvato && salvato.nome === n ? salvato.id : `m-${Date.now().toString(36)}`
    const nuovo: ModelloExport = { ...m, id, nome: n }
    const r = await esegui(() => cralApi.salvaModelliExport([...db.modelliExport.filter(x => x.id !== id), nuovo]), `Modello «${n}» salvato`)
    if (r !== null) { setM(nuovo); setNome('') }
  }
  return (
    <Modale largo titolo="Esporta elenco" sotto={`${titolo} · ${pers.length} persone di partenza`} onClose={onClose} piedi={<>
      <span className="mr-auto text-xs text-slate-400 self-center">{dentro.length} {dentro.length === 1 ? 'persona' : 'persone'} nel file{senzaConsenso ? ` · ${senzaConsenso} senza consenso: le colonne del telefono restano vuote` : ''}</span>
      <button className={btnSecondario} onClick={onClose}>Annulla</button>
      <button className={btnPrimario} disabled={lavoro || !dentro.length || !m.colonne.length} onClick={() => void scaricaFile()}><Ico d={D.download} />Scarica {m.formato === 'csv' ? 'CSV' : 'Excel'}</button></>}>
      <div className="flex flex-col gap-5">
        <div><p className={etichettaCls + ' mb-2'}>Modello</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">{modelli.map(x => (
            <button key={x.id} className={sceltaCls(m.id === x.id)} onClick={() => { setM({ ...x }); setNome('') }}>
              <span className="block text-sm text-slate-100">{x.nome}</span>
              <span className="block text-[11px] text-slate-500 truncate">{x.colonne.length} colonne · {x.formato === 'csv' ? 'CSV' : 'Excel'}{x.id.startsWith('pronto-') ? '' : ' · salvato'}</span></button>))}</div></div>
        <div className="grid lg:grid-cols-[1fr_1fr] gap-5">
          <div><p className={etichettaCls + ' mb-2'}>Colonne disponibili</p>
            <div className="flex flex-col gap-2.5">{GRUPPI.map(g => (
              <div key={g}><p className="text-[11px] text-slate-500 mb-1">{g}{g === 'Telefono e WhatsApp' ? ' — solo per chi ha dato il consenso' : g === 'Alimentari' ? ' — esistono solo col consenso' : ''}</p>
                <div className="flex flex-wrap gap-1.5">{COLONNE.filter(c => c.gruppo === g).map(c => { const on = m.colonne.includes(c.id); return (
                  <button key={c.id} aria-pressed={on} className={chipCls(on)} onClick={() => setM({ ...m, id: m.id.startsWith('pronto-') ? 'libero' : m.id, colonne: on ? m.colonne.filter(x => x !== c.id) : [...m.colonne, c.id] })}>{c.nome}</button>) })}</div></div>))}</div></div>
          <div><p className={etichettaCls + ' mb-2'}>Nel file, in quest'ordine ({m.colonne.length})</p>
            {m.colonne.length ? <ol className="rounded-lg border border-slate-800 divide-y divide-slate-800">{m.colonne.map((c, i) => (
              <li key={c} className="px-3 py-1.5 flex items-center gap-2 text-sm"><span className="w-5 text-xs text-slate-500 tabular-nums">{i + 1}</span><span className="flex-1 text-slate-200">{nomeCol(c)}</span>
                <button className="px-1.5 text-slate-400 hover:text-white disabled:opacity-30" disabled={i === 0} aria-label={`Sposta su ${nomeCol(c)}`} onClick={() => sposta(i, -1)}>↑</button>
                <button className="px-1.5 text-slate-400 hover:text-white disabled:opacity-30" disabled={i === m.colonne.length - 1} aria-label={`Sposta giù ${nomeCol(c)}`} onClick={() => sposta(i, 1)}>↓</button>
                <button className="px-1.5 text-slate-500 hover:text-red-400" aria-label={`Togli ${nomeCol(c)}`} onClick={() => setM({ ...m, colonne: m.colonne.filter(x => x !== c) })}>×</button></li>))}</ol>
              : <p className="text-sm text-slate-500">Scegli almeno una colonna.</p>}</div>
        </div>
        <div className="grid sm:grid-cols-[2fr_1fr_1fr] gap-4">
          <Campo label="Chi entra"><select className={inputCls} value={m.solo} onChange={e => setM({ ...m, solo: e.target.value as ModelloExport['solo'] })}>{(Object.keys(SOLO) as Array<ModelloExport['solo']>).map(k => <option key={k} value={k}>{SOLO[k]}</option>)}</select></Campo>
          <Campo label="Formato"><select className={inputCls} value={m.formato} onChange={e => setM({ ...m, formato: e.target.value as 'xlsx' | 'csv' })}><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV (testo)</option></select></Campo>
          {m.formato === 'csv' ? <Campo label="Separatore del CSV" hint="Virgola per gli strumenti di invio WhatsApp; punto e virgola per Excel in italiano"><select className={inputCls} value={m.separatore} onChange={e => setM({ ...m, separatore: e.target.value as ';' | ',' })}><option value=",">Virgola ( , )</option><option value=";">Punto e virgola ( ; )</option></select></Campo> : <div />}
        </div>
        {familiari.length > 0 && <Interruttore on={conFam} onChange={setConFam} label={`Aggiungi i familiari attivi di queste persone (${familiari.length})`} />}
        <div className="flex flex-wrap items-end gap-2 border-t border-slate-800 pt-4">
          <div className="flex-1 min-w-[200px]"><Campo label="Salva queste scelte come modello" hint="I modelli salvati li vedono tutti gli amministratori"><input className={inputCls} maxLength={60} placeholder={salvato ? salvato.nome : 'Nome del modello'} value={nome} onChange={e => setNome(e.target.value)} /></Campo></div>
          <button className={btnPiccoloSec + ' mb-6'} disabled={!nome.trim() || !m.colonne.length || db.modelliExport.length >= 30} onClick={() => void salvaModello()}>Salva modello</button>
          {salvato && <button className={btnPiccoloSec + ' mb-6 text-red-300'} onClick={() => { void esegui(() => cralApi.salvaModelliExport(db.modelliExport.filter(x => x.id !== salvato.id)), `Modello «${salvato.nome}» eliminato`, 'info').then(r => { if (r !== null) setM({ ...MODELLI_PRONTI[0]! }) }) }}>Elimina «{salvato.nome}»</button>}
        </div>
      </div>
    </Modale>
  )
}
