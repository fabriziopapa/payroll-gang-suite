// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · aggiornamento dati (T6) e archivio
//
// T6: un Excel (anche quello di «Soci › Esporta Excel», corretto a mano)
// con persone GIA' presenti: si agganciano per ID, tessera o nominativo e
// data di nascita, e dalle colonne scelte nasce un lotto di variazioni
// prima → dopo da validare. Cella vuota = non cambia, «-» = svuota.
//
// Archivio: il file JSON esportato da un altro ambiente (produzione ↔
// pre-produzione). Si scelgono le sezioni; il server lo confronta con i
// dati di qui e prepara il lotto. Niente si cancella in arrivo.
// ============================================================

import { agganciaRiga } from './aggancio'
import { leggiConsenso, leggiEsigenze, leggiOrigine, leggiSiNo, leggiTelefono, leggiWhatsapp } from './contatti'
import { useMemo, useRef, useState } from 'react'
import { cralApi, type CralRigaT6 } from '../../api/endpoints'
import type { ArchivioTestata, Db, Persona, SezioneLotto } from './tipi'
import { STATI, fmtData, leggiData, nominativo, norm, oggi, tesseraDaTesto, trovaIntestazione } from './logica'
import { LottoView, NOMI_SEZIONI } from './Lotto'
import {
  Campo, D, Ico, Origine, Pill, avviso, btnPiccolo, btnPiccoloSec, btnPrimario, cardCls, etichettaCls, fileBase64, inputCls, inputW,
  messaggioErrore, scarica, thCls, useCral, Scorrevole
} from './ui'

const EMAIL_OK = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[A-Za-z]{2,}$/
const pulisci = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()

/** Nome del file con ambiente e data: cral-soci_PRE_2026-10-29.xlsx */
export function nomeFile(base: string, ambiente: string, est: string): string {
  const a = ambiente.replace(/^pre\./i, 'PRE.').replace(/[^A-Za-z0-9.-]+/g, '-').slice(0, 40) || 'PGS'
  return `${base}_${a}_${oggi()}.${est}`
}

/** Base64 → file scaricato. */
export function scaricaBase64(nome: string, b64: string, tipo: string) {
  const bin = atob(b64); const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  scarica(nome, new Blob([buf], { type: tipo }))
}
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export interface VoceModello { etichetta: string; tracciato: Parameters<typeof cralApi.modello>[0]['tracciato']; iniziativa?: string; ids?: string[]; anno?: number; titolo?: string }
/** Scarica il modello Excel di un tracciato (per gli eventi è costruito sull'evento). */
export async function scaricaModello(v: VoceModello): Promise<void> {
  try {
    const r = await cralApi.modello({ tracciato: v.tracciato, ...(v.iniziativa ? { iniziativa: v.iniziativa } : {}), ...(v.ids?.length ? { ids: v.ids } : {}), ...(v.anno ? { anno: v.anno } : {}) })
    scaricaBase64(r.file, r.base64, XLSX_MIME)
    avviso(v.ids?.length ? `Modello con ${v.ids.length} persone: completa le colonne e ricaricalo. Contiene nomi: non lasciarlo in giro.` : 'Modello scaricato: il primo foglio è da compilare, «Esempio» mostra come.', 'info')
  } catch (e) { avviso(messaggioErrore(e), 'error') }
}
/** I pulsanti dei modelli, accanto a dove si sceglie il file. */
export function Modelli({ voci, nota }: { voci: VoceModello[]; nota?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
      <span>Non hai ancora il file?</span>
      {voci.map(v => <button key={v.etichetta} type="button" className={btnPiccoloSec} title={v.titolo} onClick={() => void scaricaModello(v)}><Ico d={D.download} cls="w-3.5 h-3.5" />{v.etichetta}</button>)}
      {nota && <span>{nota}</span>}
    </div>
  )
}

/** Esporta le quote dell'anno dei soci indicati nell'Excel del T7. */
export async function esportaQuoteExcel(anno: number, ids: string[]): Promise<void> {
  try {
    const r = await cralApi.esportaQuote(anno, ids)
    scaricaBase64(nomeFile(`cral-quote-${anno}`, r.ambiente, 'xlsx'), r.base64, XLSX_MIME)
    avviso(`Esportate le quote ${anno} di ${ids.length} soci. Correggi gli importi e ricarica da Importazione › Quote versate (T7).`, 'info')
  } catch (e) { avviso(messaggioErrore(e), 'error') }
}

/** Esporta le persone indicate (e i loro familiari) nell'Excel del T6. */
export async function esportaSociExcel(ids: string[]): Promise<void> {
  try {
    const r = await cralApi.esportaSoci(ids)
    scaricaBase64(nomeFile('cral-soci', r.ambiente, 'xlsx'), r.base64, XLSX_MIME)
    avviso(`Esportate ${ids.length} persone (con i loro familiari). Il file contiene dati personali: non lasciarlo in giro.`, 'info')
  } catch (e) { avviso(messaggioErrore(e), 'error') }
}

// ── T6 ───────────────────────────────────────────────────────
type CampoT6 = 'sede' | 'nascita' | 'email' | 'tessera' | 'note' | 'tipo' | 'stato' | 'telefono' | 'consensoTel' | 'whatsapp' | 'consensoAlim' | 'esigenze' | 'allergie'
const RUOLI: Array<[string, string, RegExp, boolean]> = [
  // chiave, etichetta, intestazione, è un campo da aggiornare
  ['id', 'ID (matricola, EXT-, FAM-)', /^(id|id socio|matricola)$/i, false],
  ['tesseraKey', 'Tessera (per agganciare)', /(?!)/, false],
  ['nominativo', 'Nominativo', /^(nominativo|cognome\s*e?\s*nome)$/i, false],
  ['cognome', 'Cognome', /^cognome$/i, false],
  ['nome', 'Nome', /^nome$/i, false],
  ['nascita', 'Data di nascita', /nasc/i, true],
  ['sede', 'Sede (codice o nome)', /^sede$/i, true],
  ['email', 'Email', /mail/i, true],
  ['tessera', 'Tessera', /^tessera/i, true],
  ['note', 'Note', /^note$/i, true],
  ['tipo', 'Tipologia', /^tipolog/i, true],
  ['stato', 'Stato', /^stato$/i, true],
  ['dataStato', 'Data stato', /^data\s*stato$/i, false],
  // 0025: telefono, consensi, WhatsApp, dati alimentari
  ['telefono', 'Telefono', /^((n|num|numero|recapito)\.?( di)? )?(tel|telefono|telefonico|cell|cellulare|mobile)\.?$/i, true],
  ['consensoTel', 'Consenso telefono', /^consenso( all.uso del)? (tel|numero|cell)|^gdpr|^privacy/i, true],
  ['consensoIl', 'Data consenso', /^data( del)? consenso$/i, false],
  ['origine', 'Origine consenso', /^origine|^raccolto/i, false],
  ['revocatoIl', 'Data revoca', /^data( della)? revoca/i, false],
  ['whatsapp', 'WhatsApp', /^(su )?(whatsapp|wa)$/i, true],
  ['waId', 'WA ID', /^wa[ _]?id$/i, false],
  ['consensoAlim', 'Consenso dati alimentari', /^consenso( ai)?( dati)? aliment/i, true],
  ['esigenze', 'Esigenze alimentari', /esigenz|^dieta|regime alimentare/i, true],
  ['allergie', 'Allergie', /allerg|intolleranz/i, true],
]

function sedeDaTesto(db: Db, t: string): string | undefined {
  const x = norm(t)
  const s = db.sedi.find(z => z.id === t.trim().toUpperCase()) ?? db.sedi.find(z => norm(z.nome) === x) ?? db.sedi.find(z => x && norm(z.nome).replace(/^SEDE (DI|DEL) /, '') === x.replace(/^SEDE (DI|DEL) /, ''))
  return s?.id
}
function tipoDaTesto(t: string): 'SD' | 'SE' | 'EST' | 'FAM' | undefined {
  const x = norm(t)
  if (x === 'SD' || /SOCIO DIPENDENTE/.test(x)) return 'SD'
  if (x === 'SE' || /SOCIO ESTERNO/.test(x)) return 'SE'
  if (x === 'EST' || x === 'ESTERNO') return 'EST'
  if (x === 'FAM' || /FAMILIAR/.test(x)) return 'FAM'
  return undefined
}
function statoDaTesto(t: string): Persona['stato'] | undefined {
  const m: Record<string, Persona['stato']> = {
    ATTIVO: 'ATTIVO', ATTIVA: 'ATTIVO', ATTIVI: 'ATTIVO', CESSATO: 'CESSATO', CESSATA: 'CESSATO', CESSATI: 'CESSATO',
    ELIMINATO: 'ELIMINATO', ELIMINATA: 'ELIMINATO', ELIMINATI: 'ELIMINATO', 'DA VALIDARE': 'DA_VALIDARE', DA_VALIDARE: 'DA_VALIDARE',
    RIFIUTATO: 'RIFIUTATO', RIFIUTATA: 'RIFIUTATO',
  }
  return m[norm(t)]
}

/** Aggancio di una riga a una persona già presente: ID (anche l'ex matricola), tessera, nominativo (la data di nascita decide fra gli omonimi). */
export function aggancia(db: Db, _perTessera: Map<string, Persona>, id: string, tk: string, nomin: string, nascita: string | null, telefono = '', email = ''):
  { socio: Persona | null; come: string; candidati: Persona[]; errore?: string } {
  // un solo motore per tutte le importazioni (aggancio.ts): ID → tessera → telefono → email → nominativo (+ data di nascita)
  const e = agganciaRiga(db.soci, { id, tessera: tk, telefono, email, nominativo: nomin, nascita }, { prefisso: db.prefissoTel, parziale: true, tessera: db.tessera })
  return { socio: e.socio, come: e.via, candidati: e.candidati, ...(e.socio ? {} : e.motivo ? { errore: e.motivo } : {}) }
}

interface RigaLetta { i: number; riga: number; chiave: string; socio: Persona | null; come: string; candidati: Persona[]; valori: CralRigaT6['valori']; errori: string[] }

export function ImportT6() {
  const { db, ricarica } = useCral()
  const [file, setFile] = useState<{ nome: string; fogli: Record<string, string[][]> } | null>(null)
  const [foglio, setFoglio] = useState('')
  const [map, setMap] = useState<Record<string, string>>({})
  const [usa, setUsa] = useState<Set<CampoT6>>(new Set())
  const [scelte, setScelte] = useState<Record<number, string | null>>({})
  const [lettura, setLettura] = useState(false)
  const [invio, setInvio] = useState(false)
  const [lotto, setLotto] = useState<string | null>(null)
  const [cerca, setCerca] = useState<Record<number, string>>({})
  const inp = useRef<HTMLInputElement>(null)

  function scegliFoglio(f: { fogli: Record<string, string[][]> }, nome: string) {
    const righe = f.fogli[nome] ?? []
    const intest = righe[trovaIntestazione(righe)] ?? []
    const m: Record<string, string> = {}
    for (const [k, , re] of RUOLI) { const idx = intest.findIndex(x => re.test(x.trim())); m[k] = idx >= 0 ? String(idx) : '' }
    if (m['nominativo'] !== '') { m['cognome'] = ''; m['nome'] = '' }
    setFoglio(nome); setMap(m); setScelte({}); setLotto(null)
    // di default si aggiornano solo sede, email, note: gli altri si accendono a mano
    setUsa(new Set((['sede', 'email', 'note', 'telefono', 'consensoTel', 'whatsapp', 'consensoAlim', 'esigenze', 'allergie'] as CampoT6[]).filter(k => m[k] !== '')))
  }
  async function apri(f: File) {
    setLettura(true); setLotto(null)
    try {
      const { fogli } = await cralApi.leggiFile(f.name, await fileBase64(f))
      const nomi = Object.keys(fogli)
      if (!nomi.length) { avviso('Il file non contiene fogli.', 'error'); return }
      const ff = { nome: f.name, fogli }; setFile(ff); scegliFoglio(ff, nomi[0]!)
    } catch (e) { avviso(messaggioErrore(e), 'error') } finally { setLettura(false) }
  }

  const rows = useMemo(() => file?.fogli[foglio] ?? [], [file, foglio])
  const hdr = trovaIntestazione(rows)
  const intest = rows[hdr] ?? []
  const perTessera = useMemo(() => new Map(db.soci.filter(s => s.tessera).map(s => [norm(s.tessera), s])), [db])
  const pronto = map['id'] !== '' || map['tesseraKey'] !== '' || map['nominativo'] !== '' || (map['cognome'] !== '' && map['nome'] !== '') || map['telefono'] !== '' || map['email'] !== ''

  const lette = useMemo<RigaLetta[]>(() => !file || !pronto ? [] : rows.slice(hdr + 1).map((r, i) => {
    const val = (k: string) => { const c = map[k]; return c !== '' && c != null ? pulisci(String(r[+c] ?? '')) : '' }
    const errori: string[] = []
    const id = val('id'), tk = val('tesseraKey'), nomin = val('nominativo') || [val('cognome'), val('nome')].filter(Boolean).join(' ')
    const nascitaTxt = val('nascita'), nascita = nascitaTxt && nascitaTxt !== '-' ? leggiData(nascitaTxt) : null
    // qui telefono ed email sono dati da aggiornare: fanno da chiave solo se la riga non ha altro (né ID, né tessera, né nominativo)
    const soloContatti = !id && !tk && !nomin
    const { socio, come, candidati, errore } = aggancia(db, perTessera, id, tk, nomin, nascita, soloContatti ? val('telefono') : '', soloContatti ? val('email') : '')
    if (errore) errori.push(errore)
    const valori: CralRigaT6['valori'] = {}
    const svuota = (t: string) => t === '-'
    if (usa.has('sede')) { const t = val('sede'); if (t) { if (svuota(t)) valori.sede = null; else { const s = sedeDaTesto(db, t); if (s) valori.sede = s; else errori.push(`sede «${t}» sconosciuta`) } } }
    if (usa.has('nascita') && nascitaTxt) { if (svuota(nascitaTxt)) valori.nascita = null; else if (nascita) valori.nascita = nascita; else errori.push(`data di nascita «${nascitaTxt}» non valida`) }
    if (usa.has('email')) { const t = val('email'); if (t) { if (svuota(t)) valori.email = null; else if (EMAIL_OK.test(t)) valori.email = t; else errori.push(`email «${t}» non valida`) } }
    if (usa.has('tessera')) { const t = val('tessera'); if (t) { if (svuota(t)) valori.tessera = null; else { const x = tesseraDaTesto(db.tessera, t); if (/^[A-Za-z0-9 ._/-]{1,30}$/.test(x)) valori.tessera = x; else errori.push(`tessera «${t}» non valida`) } } }
    if (usa.has('note')) { const t = val('note'); if (t) valori.note = svuota(t) ? null : t.slice(0, 1000) }
    if (usa.has('tipo')) { const t = val('tipo'); if (t) { const x = tipoDaTesto(t); if (!x) errori.push(`tipologia «${t}» sconosciuta`); else if (x !== 'FAM') valori.tipo = x } }
    if (usa.has('stato')) {
      const t = val('stato')
      if (t) {
        const x = statoDaTesto(t)
        if (!x) errori.push(`stato «${t}» sconosciuto`)
        else if (x === 'ATTIVO' || x === 'CESSATO' || x === 'ELIMINATO') {
          valori.stato = x
          const ds = val('dataStato'); if (ds) { const d = leggiData(ds); if (d) valori.dataStato = d; else errori.push(`data stato «${ds}» non valida`) }
        } else if (socio && socio.stato !== x) errori.push(`«${STATI[x]}» non si imposta da file`)
      }
    }
    const dataDi = (k: string, cosa: string): string | undefined => { const t = val(k); if (!t) return undefined; const d = leggiData(t); if (!d) errori.push(`${cosa} «${t}» non valida`); return d ?? undefined }
    const c: NonNullable<CralRigaT6['valori']['contatti']> = {}
    if (usa.has('telefono') && !soloContatti) {
      const t = val('telefono')
      if (t) { if (svuota(t)) c.telefono = ''; else { const n = leggiTelefono(t, db.prefissoTel); if (n && 'e164' in n) c.telefono = n.e164; else errori.push(`telefono «${t}»: ${n && 'errore' in n ? n.errore : 'non valido'}`) } }
    }
    if (usa.has('consensoTel')) {
      const t = val('consensoTel')
      if (t) {
        const x = leggiConsenso(t)
        if (!x) errori.push(`consenso «${t}» non riconosciuto (Sì, No, Revocato)`)
        else {
          c.consenso = x
          if (x === 'SI') { const d = dataDi('consensoIl', 'data del consenso'); if (d) c.consensoIl = d; const o = val('origine'); if (o) { const oo = leggiOrigine(o); if (oo) c.origine = oo; else errori.push(`origine «${o}» non riconosciuta (cartaceo, online, email, a voce)`) } }
          if (x === 'REVOCATO') { const d = dataDi('revocatoIl', 'data della revoca'); if (d) c.revocatoIl = d }
        }
      }
    }
    if (usa.has('whatsapp')) {
      const t = val('whatsapp'); if (t) { const x = leggiWhatsapp(t); if (x) c.whatsapp = x; else errori.push(`WhatsApp «${t}» non riconosciuto (Sì, No, Non verificato)`) }
      const w = val('waId').replace(/\D/g, ''); if (w && /^[1-9]\d{6,14}$/.test(w)) c.waId = w
    }
    if (Object.keys(c).length) valori.contatti = c
    const al: NonNullable<CralRigaT6['valori']['alimentari']> = {}
    if (usa.has('consensoAlim')) { const t = val('consensoAlim'); if (t) { const x = leggiSiNo(t); if (x === null) errori.push(`consenso ai dati alimentari «${t}» non riconosciuto (Sì, No)`); else al.consenso = x } }
    if (usa.has('esigenze')) { const t = val('esigenze'); if (t) { const x = leggiEsigenze(svuota(t) ? '' : t); al.esigenze = x.esigenze; if (x.ignote.length) errori.push(`esigenza «${x.ignote.join(', ')}» non in elenco: scrivila fra le allergie`) } }
    if (usa.has('allergie')) { const t = val('allergie'); if (t) al.allergie = svuota(t) ? '' : t.slice(0, 300) }
    if (Object.keys(al).length) valori.alimentari = al
    return { i, riga: hdr + i + 2, chiave: id || tk || nomin || val('telefono') || val('email'), socio, come, candidati, valori, errori }
  }).filter(r => r.chiave), [file, pronto, rows, hdr, map, usa, db, perTessera])

  const finale = (r: RigaLetta): Persona | null => {
    const s = scelte[r.i]
    return s === undefined ? r.socio : s === null ? null : db.perId.get(s) ?? null
  }
  const agganciate = lette.filter(r => finale(r))
  const nonAgg = lette.filter(r => !finale(r) && scelte[r.i] !== null)
  const doppie = (() => { const v = new Map<string, number>(); for (const r of agganciate) { const id = finale(r)!.id; v.set(id, (v.get(id) ?? 0) + 1) } return [...v.values()].filter(n => n > 1).length })()
  const conValori = agganciate.filter(r => Object.keys(r.valori).length)
  const conErrori = lette.filter(r => r.errori.length)

  async function prepara() {
    if (!file) return
    setInvio(true)
    try {
      const righe: CralRigaT6[] = conValori.map(r => ({ socio: finale(r)!.id, riga: r.riga, valori: r.valori }))
      const r = await cralApi.lottoT6(file.nome, righe)
      if (!r.id) avviso('Nessuna differenza: i dati del file sono già quelli di qui.', 'info')
      else { await ricarica(); setLotto(r.id); avviso(`${r.variazioni} ${r.variazioni === 1 ? 'persona' : 'persone'} con variazioni da validare`, 'info') }
    } catch (e) { avviso(messaggioErrore(e), 'error') } finally { setInvio(false) }
  }

  if (lotto) return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2"><button className={btnPiccoloSec} onClick={() => setLotto(null)}><Ico d={D.back} cls="w-3.5 h-3.5" />Torna al file</button><span className="text-xs text-slate-500">Il lotto resta anche in «Da validare»: puoi chiudere e riprendere più tardi.</span></div>
      <LottoView id={lotto} onChiuso={() => { setLotto(null); setFile(null) }} />
    </div>
  )
  return (
    <div className="flex flex-col gap-4">
      <div className={`${cardCls} p-5 flex flex-col gap-3`}>
        <div role="button" tabIndex={0} onClick={() => inp.current?.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inp.current?.click() }}
          onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void apri(f) }}
          className="flex flex-col sm:flex-row sm:items-center gap-4 border-2 border-dashed rounded-xl px-5 py-5 cursor-pointer border-slate-700 hover:border-indigo-500">
          <div className="w-10 h-10 rounded-lg bg-cyan-600/20 text-cyan-300 flex items-center justify-center shrink-0"><Ico d={D.upload} cls="w-5 h-5" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white">{lettura ? 'Lettura del file sul server…' : 'Trascina qui il file di aggiornamento (.xlsx, .xls, .csv) o fai clic per sceglierlo'}</p>
            <p className="text-xs text-slate-500 mt-0.5">Persone già presenti: si agganciano per ID, tessera o nominativo (con la data di nascita fra gli omonimi); una riga col solo telefono o la sola email si aggancia con quelli. Il modo più semplice: «Soci › Esporta Excel», correggi, ricarica qui. Niente si scrive finché non validi il lotto.</p>
          </div>
          <input ref={inp} type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) void apri(f); e.target.value = '' }} />
        </div>
      </div>
      {file && <div className={`${cardCls} p-5 flex flex-col gap-4`}>
        <div className="flex flex-wrap items-center gap-2"><Ico d={D.doc} cls="w-4 h-4 text-slate-400" /><span className="text-sm text-white font-medium">{file.nome}</span><span className="text-xs text-slate-500">· {Math.max(0, rows.length - hdr - 1)} righe</span><button className="ml-auto text-xs text-slate-400 hover:text-white" onClick={() => setFile(null)}>Chiudi file</button></div>
        {Object.keys(file.fogli).length > 1 && <div className="flex flex-wrap items-center gap-2"><span className={etichettaCls}>Foglio</span>{Object.keys(file.fogli).map(n => <button key={n} onClick={() => scegliFoglio(file, n)} className={`${btnPiccolo} border ${n === foglio ? 'bg-indigo-600/20 text-indigo-300 border-indigo-700' : 'bg-slate-800 text-slate-300 border-slate-700'}`}>{n}</button>)}</div>}
        <div>
          <p className={etichettaCls + ' mb-2'}>Colonne · per agganciare e da aggiornare (spunta quelle da applicare)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {RUOLI.map(([k, l, , agg]) => (
              <Campo key={k} label={<span className="inline-flex items-center gap-1.5">{agg && <input type="checkbox" className="accent-emerald-500" disabled={map[k] === ''} checked={usa.has(k as CampoT6)} onChange={() => setUsa(u => { const n = new Set(u); if (n.has(k as CampoT6)) n.delete(k as CampoT6); else n.add(k as CampoT6); return n })} aria-label={`Aggiorna ${l}`} />}{l}</span>}>
                <select className={inputCls} value={map[k] ?? ''} onChange={e => setMap({ ...map, [k]: e.target.value })}><option value="">— Nessuna</option>{intest.map((h, i) => <option key={i} value={String(i)}>{h || `Colonna ${i + 1}`}</option>)}</select>
              </Campo>))}
          </div>
          <p className="text-xs text-slate-500 mt-2">Cella vuota = non cambia · «-» = svuota il campo. Telefono: scritto come si vuole, si salva come +39…; consenso Sì / No / Revocato (dopo una revoca il «Sì» vuole una nuova «Data consenso»); esigenze e allergie entrano solo col consenso ai dati alimentari. Data di nascita di chi ha la matricola: si scrive solo se in PGS manca. Stato: Attivo, Cessato o Eliminato (con «Data stato», altrimenti oggi); i cambi di stato si confermano uno per uno.</p>
          {!pronto && <p className="text-sm text-amber-400 mt-2">Indica almeno una colonna per agganciare: ID, tessera, nominativo, telefono o email.</p>}
        </div>
      </div>}
      {file && pronto && <div className={`${cardCls} overflow-hidden`}>
        <div className="px-5 py-3 border-b border-slate-800 flex flex-wrap gap-3 items-center text-sm text-slate-300">
          <span><b className="text-white tabular-nums">{agganciate.length}</b> agganciate</span>
          <span><b className="text-white tabular-nums">{conValori.length}</b> con valori da confrontare</span>
          {nonAgg.length > 0 && <span className="text-amber-400">{nonAgg.length} non agganciate</span>}
          {conErrori.length > 0 && <span className="text-red-300">{conErrori.length} con celle scartate</span>}
          {doppie > 0 && <span className="text-amber-400">{doppie} persone in più righe: vale la prima</span>}
          <span className="flex-1" />
          <button className={btnPrimario} disabled={invio || !conValori.length || !usa.size} onClick={() => void prepara()}><Ico d={D.check} />Prepara le variazioni</button>
        </div>
        {(nonAgg.length > 0 || conErrori.length > 0) && <Scorrevole className="max-h-[420px]"><table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-900 text-left text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-2 font-semibold">Riga</th><th className={thCls}>Nel file</th><th className={thCls}>Persona</th><th className="px-5 py-2 font-semibold">Note</th></tr></thead>
          <tbody className="divide-y divide-slate-800/70">
            {lette.filter(r => !finale(r) || r.errori.length).slice(0, 300).map(r => {
              const p = finale(r), q = norm(cerca[r.i] ?? '')
              const trovati = q.length >= 2 ? db.soci.filter(s => norm(`${nominativo(s)} ${s.id} ${s.tessera}`).includes(q)).slice(0, 6) : r.candidati.slice(0, 6)
              return (
                <tr key={r.i} className="align-top">
                  <td className="px-5 py-2 text-slate-500 tabular-nums">{r.riga}</td>
                  <td className="px-3 py-2 text-slate-200 whitespace-nowrap">{r.chiave}</td>
                  <td className="px-3 py-2">{p ? <span className="text-slate-100"><span className="font-mono text-xs text-slate-400">{p.id}</span> {nominativo(p)} <Origine s={p} /> {r.come && <span className="text-[11px] text-slate-500">per {r.come}</span>}</span>
                    : scelte[r.i] === null ? <Pill>ignorata</Pill>
                      : <div className="flex flex-col gap-1">
                        <div className="flex gap-2"><input className={inputW + ' py-1 text-xs w-56'} placeholder="Cerca: cognome, ID, tessera" value={cerca[r.i] ?? ''} onChange={e => setCerca(c => ({ ...c, [r.i]: e.target.value }))} /><button className={btnPiccoloSec} onClick={() => setScelte(s => ({ ...s, [r.i]: null }))}>Ignora</button></div>
                        {trovati.length > 0 && <div className="flex flex-wrap gap-1">{trovati.map(s => <button key={s.id} className={btnPiccoloSec + ' text-xs'} onClick={() => setScelte(x => ({ ...x, [r.i]: s.id }))}>{s.id} {nominativo(s)}{s.nascita ? ` · ${fmtData(s.nascita)}` : ''}</button>)}</div>}
                      </div>}</td>
                  <td className="px-5 py-2 text-xs text-red-300">{r.errori.join(' · ')}{scelte[r.i] !== undefined && <button className="ml-2 text-slate-400 hover:text-white" onClick={() => setScelte(s => { const n = { ...s }; delete n[r.i]; return n })}>annulla scelta</button>}</td>
                </tr>)
            })}
          </tbody></table></Scorrevole>}
        <p className="px-5 py-3 border-t border-slate-800 text-xs text-slate-500">«Prepara le variazioni» confronta i valori con quelli di qui e crea un lotto: per ogni persona vedi prima → dopo, accetti o scarti (anche un campo alla volta) e applichi. Le righe non agganciate si ignorano.</p>
      </div>}
    </div>
  )
}

// ── Archivio fra ambienti ────────────────────────────────────
const SEZ: SezioneLotto[] = ['sedi', 'tabelle', 'soci', 'quote', 'eventi']
const contaSez = (a: ArchivioTestata, s: SezioneLotto): number =>
  s === 'tabelle' ? (a.tabelle?.tipi?.length ?? 0) + (a.tabelle?.tipologie?.length ?? 0) + (a.tabelle?.quoteAnno?.length ?? 0) + (a.tabelle ? 1 : 0)
    : (a[s] as unknown[] | undefined)?.length ?? 0

export function EsportaArchivio() {
  const [sez, setSez] = useState<Set<SezioneLotto>>(new Set(SEZ))
  const [occupato, setOccupato] = useState(false)
  async function esporta() {
    setOccupato(true)
    try {
      const a = await cralApi.esportaArchivio(SEZ.filter(s => sez.has(s)))
      scarica(nomeFile('cral-archivio', a.ambiente, 'json'), new Blob([JSON.stringify(a)], { type: 'application/json' }))
      avviso(`Archivio esportato: ${a.soci?.length ?? 0} persone, ${a.eventi?.length ?? 0} eventi. Contiene dati personali: tienilo fuori dalla cartella del repository e cancellalo dopo l'uso.`, 'warning')
    } catch (e) { avviso(messaggioErrore(e), 'error') } finally { setOccupato(false) }
  }
  return (
    <div className={`${cardCls} p-5 flex flex-col gap-3`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center shrink-0"><Ico d={D.download} cls="w-5 h-5" /></div>
        <div className="flex-1 min-w-[240px]"><p className="text-white font-medium">Esporta l'archivio CRAL di questo ambiente</p>
          <p className="text-xs text-slate-500 mt-0.5 max-w-[80ch]">Un file da caricare in un altro ambiente (produzione ↔ pre-produzione) con «Carica un archivio». I dati personali viaggiano così come sono: l'export resta nell'audit (chi, quando, quanti record).</p></div>
        <button className={btnPrimario} disabled={occupato || !sez.size} onClick={() => void esporta()}><Ico d={D.download} />Esporta archivio</button>
      </div>
      <div className="flex flex-wrap gap-3">{SEZ.map(s => <label key={s} className="inline-flex items-center gap-1.5 text-sm text-slate-300"><input type="checkbox" className="accent-indigo-500" checked={sez.has(s)} onChange={() => setSez(x => { const n = new Set(x); if (n.has(s)) n.delete(s); else n.add(s); return n })} />{NOMI_SEZIONI[s]}</label>)}</div>
    </div>
  )
}

export function ImportArchivio() {
  const { ricarica } = useCral()
  const [file, setFile] = useState<{ nome: string; a: ArchivioTestata } | null>(null)
  const [sez, setSez] = useState<Set<SezioneLotto>>(new Set())
  const [invio, setInvio] = useState(false)
  const [lotto, setLotto] = useState<string | null>(null)
  const inp = useRef<HTMLInputElement>(null)
  async function apri(f: File) {
    setLotto(null)
    if (f.size > 40 * 1024 * 1024) { avviso('Archivio troppo grande (massimo 40 MB).', 'error'); return }
    try {
      const a = JSON.parse(await f.text()) as ArchivioTestata
      if (a?.formato !== 'pgs-cral-archivio') { avviso('Non è un archivio CRAL esportato da PGS.', 'error'); return }
      setFile({ nome: f.name, a }); setSez(new Set(a.sezioni.filter(s => SEZ.includes(s))))
    } catch { avviso('File non leggibile: serve il .json esportato da «Esporta archivio».', 'error') }
  }
  async function prepara() {
    if (!file) return
    setInvio(true)
    try {
      const r = await cralApi.lottoArchivio(file.nome, SEZ.filter(s => sez.has(s)), file.a)
      await ricarica()
      setLotto(r.id)
      avviso(r.variazioni ? `${r.variazioni} variazioni da validare` : 'Nessuna differenza con i dati di qui', 'info')
    } catch (e) { avviso(messaggioErrore(e), 'error') } finally { setInvio(false) }
  }
  if (lotto) return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2"><button className={btnPiccoloSec} onClick={() => setLotto(null)}><Ico d={D.back} cls="w-3.5 h-3.5" />Torna all'archivio</button><span className="text-xs text-slate-500">Il lotto resta anche in «Da validare».</span></div>
      <LottoView id={lotto} onChiuso={() => { setLotto(null); setFile(null) }} />
    </div>
  )
  return (
    <div className="flex flex-col gap-4">
      <EsportaArchivio />
      <div className={`${cardCls} p-5 flex flex-col gap-3`}>
        <div role="button" tabIndex={0} onClick={() => inp.current?.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inp.current?.click() }}
          onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void apri(f) }}
          className="flex flex-col sm:flex-row sm:items-center gap-4 border-2 border-dashed rounded-xl px-5 py-5 cursor-pointer border-slate-700 hover:border-indigo-500">
          <div className="w-10 h-10 rounded-lg bg-violet-600/20 text-violet-300 flex items-center justify-center shrink-0"><Ico d={D.upload} cls="w-5 h-5" /></div>
          <div className="min-w-0 flex-1"><p className="text-sm font-medium text-white">Carica un archivio esportato da un altro ambiente (.json)</p>
            <p className="text-xs text-slate-500 mt-0.5">Scegli le sezioni: il server le confronta con i dati di qui e prepara un lotto da validare. Niente si cancella in arrivo, un valore vuoto non svuota, cambi di stato e nuovi ID si confermano uno per uno.</p></div>
          <input ref={inp} type="file" accept=".json,application/json" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) void apri(f); e.target.value = '' }} />
        </div>
        {file && <div className="flex flex-col gap-3 border-t border-slate-800 pt-3">
          <p className="text-sm text-slate-300"><span className="font-mono text-slate-200">{file.nome}</span> · da <b className="text-white">{file.a.ambiente}</b> · esportato il {fmtData(file.a.esportato)} · PGS {file.a.app || '—'}</p>
          <div className="flex flex-wrap gap-3">{SEZ.map(s => {
            const presente = file.a.sezioni.includes(s)
            return <label key={s} className={`inline-flex items-center gap-1.5 text-sm ${presente ? 'text-slate-300' : 'text-slate-600'}`}><input type="checkbox" className="accent-indigo-500" disabled={!presente} checked={sez.has(s)} onChange={() => setSez(x => { const n = new Set(x); if (n.has(s)) n.delete(s); else n.add(s); return n })} />{NOMI_SEZIONI[s]} <span className="text-xs text-slate-500">{presente ? contaSez(file.a, s) : 'non nel file'}</span></label>
          })}</div>
          <p className="text-xs text-slate-500">Quote ed eventi richiedono che le persone ci siano qui o arrivino con la sezione Soci; le persone, che le sedi ci siano o arrivino con la sezione Sedi (altrimenti entrano senza sede).</p>
          <div className="flex justify-end gap-2"><button className={btnPiccoloSec} onClick={() => setFile(null)}>Chiudi</button><button className={btnPrimario} disabled={invio || !sez.size} onClick={() => void prepara()}><Ico d={D.check} />{invio ? 'Confronto in corso…' : 'Prepara il lotto'}</button></div>
        </div>}
      </div>
    </div>
  )
}

