// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · scheda Importazione (libro soci, T1)
//
// Il file va al server, che lo legge (xlsx/xls/csv) e abbina i nominativi
// all'anagrafica PGS con la regola di Emolumenti. Qui l'operatore decide i
// casi incerti, la sede, la tessera e i soci assenti dal file; alla
// conferma il server scrive tutto in una transazione.
// ============================================================

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { cralApi, type CralAbbinamentoApi, type CralOperazioneApi } from '../../api/endpoints'
import type { AnagraficaPgs, Db, Persona } from './tipi'
import {
  eSocio, fmtData, leggiData, nominativo, norm, numBase, oggi, risolvi, simNome, spezzaNominativo, tesseraDaTesto, trovaIntestazione,
} from './logica'
import {
  Campo, D, Ico, Interruttore, Origine, Pill, PersonaPgs, avviso, btnPiccolo, btnPiccoloSec, btnPrimario, btnSecondario, cardCls,
  etichettaCls, fileBase64, inputCls, inputW, messaggioErrore, thCls, useCral, type Tono,
} from './ui'

const RUOLI_COL: Array<[string, string, RegExp]> = [
  ['nominativo', 'Nominativo', /^(nominativo|cognome\s*e?\s*nome|nome\s*e?\s*cognome)$/i],
  ['cognome', 'Cognome', /^cognome$/i],
  ['nome', 'Nome', /^nome$/i],
  ['matricola', 'Matricola PGS', /matricola/i],
  ['sede', 'Sede di consegna', /sede/i],
  ['email', 'Email', /mail/i],
  ['nascita', 'Data di nascita', /nasc/i],
  ['tessera', 'Tessera CRAL (N.ISCR.SOCIO)', /tessera|n\.?\s*socio|iscr/i],
  ['tipologia', 'Esterni / tipologia', /^esterni?$|tipolog|categoria/i],
]
type Esito = 'trovato' | 'parziale' | 'ambiguo' | 'non-trovato' | 'VUOTA'
const ESITI: Record<Esito, [string, Tono, string]> = {
  trovato:       ['Trovato', 'ok', 'Una sola persona in anagrafica con questo nominativo (o con la matricola del file)'],
  parziale:      ['Da verificare', 'warn', 'Un solo candidato, ma con nomi in più: es. «Bianchi Giulia» → «BIANCHI GIULIA MARIA»'],
  ambiguo:       ['Omonimi', 'warn', 'Più persone corrispondono: scegli tu'],
  'non-trovato': ['Non in anagrafica', 'cf', 'Nessuna corrispondenza: esterno, oppure cerca a mano'],
  VUOTA:         ['Scartata', 'err', 'Riga senza nominativo né matricola'],
}
const EMAIL_OK = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[A-Za-z]{2,}$/
const TESSERA_OK = /^[A-Za-z0-9 ._/-]{0,30}$/

interface Base {
  i: number; nomin: string; mat: string; sedeTesto: string; sede: string | null | undefined; email: string; tessera: string
  tipoRich: '' | 'SE' | 'EST' | 'FAM'; atipico: boolean; nascita: string | null
}
interface Analisi extends Base {
  esito: Esito; cand: AnagraficaPgs[]; via: string; matIgnota?: string; nascitaDiversa?: string; esitoEst?: Persona; inAttesa?: boolean
}
interface Decisione { matricola?: string | null; come?: string | null; esterno?: boolean; ignora?: boolean; sede?: string }
type Risultato =
  | { tipo: 'ignora'; fam?: boolean }
  | { tipo: 'aperto'; motivo: string }
  | { tipo: 'esterno' }
  | { tipo: 'pgs'; anag: AnagraficaPgs; come: string }
  | { tipo: 'socio'; socio: Persona; anag?: AnagraficaPgs; come: string; assoc?: boolean }

function mappaSede(db: Db, testo: string): string | null | undefined {
  const t = norm(testo); if (!t) return null
  const s = db.sedi.find(x => norm(x.nome) === t) ?? db.sedi.find(x => t.includes(norm(x.nome).replace(/^SEDE (DI|DEL) /, '')))
  return s ? s.id : undefined // undefined = testo presente ma sede sconosciuta
}

export function ImportTab() {
  const { db, esegui, vaiA } = useCral()
  const [file, setFile] = useState<{ nome: string; fogli: Record<string, string[][]> } | null>(null)
  const [foglio, setFoglio] = useState('')
  const [map, setMap] = useState<Record<string, string>>({})
  const [dec, setDec] = useState<Record<number, Decisione>>({})
  const [filtro, setFiltro] = useState('')
  const [aperta, setAperta] = useState<number | null>(null)
  const [fatto, setFatto] = useState<{ nuoviPgs: number; nuoviEsterni: number; aggiornati: number; tessere: number; cessati: number } | null>(null)
  const [lettura, setLettura] = useState(false)
  const [trascina, setTrascina] = useState(false)
  const [hdr, setHdr] = useState(0)
  const [decAss, setDecAss] = useState<Record<string, 'CESSA' | 'RESTA' | number>>({})
  const [aggTess, setAggTess] = useState(true)
  const [abb, setAbb] = useState<Map<number, CralAbbinamentoApi> | null>(null)
  const [anag, setAnag] = useState<Map<string, AnagraficaPgs>>(new Map())
  const [invio, setInvio] = useState(false)
  const inp = useRef<HTMLInputElement>(null)

  function scegliFoglio(f: { fogli: Record<string, string[][]> }, nome: string) {
    const righe = f.fogli[nome] ?? []
    const h = trovaIntestazione(righe); setHdr(h); setDecAss({})
    setFoglio(nome)
    const intest = righe[h] ?? []
    const m: Record<string, string> = {}
    for (const [k, , re] of RUOLI_COL) { const idx = intest.findIndex(x => re.test(x.trim())); m[k] = idx >= 0 ? String(idx) : '' }
    if (m['nominativo'] !== '') { m['cognome'] = ''; m['nome'] = '' }
    setMap(m); setDec({}); setAperta(null); setAbb(null)
  }
  async function apriFile(f: File) {
    setFatto(null); setDec({}); setFiltro(''); setAperta(null); setLettura(true)
    try {
      const { fogli } = await cralApi.leggiFile(f.name, await fileBase64(f))
      const nomi = Object.keys(fogli)
      if (!nomi.length) { avviso('Il file non contiene fogli.', 'error'); return }
      const ff = { nome: f.name, fogli }
      setFile(ff); scegliFoglio(ff, nomi[0]!)
    } catch (e) { avviso(messaggioErrore(e), 'error') }
    finally { setLettura(false) }
  }

  const rows = useMemo(() => file?.fogli[foglio] ?? [], [file, foglio])
  const intest = rows[hdr] ?? []
  const eIntest = (r: string[] | undefined) => !!r && r.length > 0 && intest.some(h => h.trim()) && intest.every((h, j) => (r[j] ?? '').trim() === h.trim())
  const numRiga = useMemo(() => rows.map((_, j) => j).filter(j => j > hdr && !eIntest(rows[j])), [rows, hdr])
  const ripetute = rows.filter((r, j) => j > hdr && eIntest(r)).length
  const colCf = intest.findIndex(h => /fiscale|^c\.?\s*f\.?$/i.test(h.trim()))
  const pronto = map['nominativo'] !== '' || (map['cognome'] !== '' && map['nome'] !== '') || map['matricola'] !== ''

  // Lettura delle righe: niente codice fiscale, anche se nel file c'è
  const basi = useMemo<Base[]>(() => !file || !pronto ? [] : numRiga.map((j, i) => {
    const r = rows[j] ?? []
    const val = (k: string) => { const c = map[k]; return c !== '' && c != null ? String(r[+c] ?? '').trim() : '' }
    const nomin = val('nominativo') || [val('cognome'), val('nome')].filter(Boolean).join(' ')
    const mat = val('matricola').replace(/\D/g, '')
    const sedeTesto = val('sede')
    // Colonna ESTERNI del libro soci: vuota = socio da cercare in PGS · ESTERNO = socio esterno · ATIPICO = etichetta
    const t = norm(val('tipologia'))
    const tipoRich: Base['tipoRich'] = /FAMIL/.test(t) ? 'FAM' : /NON SOCIO|PARTECIP/.test(t) ? 'EST' : /ESTERN/.test(t) ? 'SE' : ''
    const tt = val('tessera')
    const tessera = tipoRich === 'EST' || tipoRich === 'FAM' ? '' : tesseraDaTesto(db.tessera, tt)
    const nascita = map['nascita'] ? leggiData(r[+map['nascita']]) : null
    return { i, nomin, mat, sedeTesto, sede: mappaSede(db, sedeTesto), email: val('email'), tessera, tipoRich, atipico: /ATIPIC/.test(t), nascita }
  }), [file, pronto, numRiga, rows, map, db])

  // Abbinamento sul server (non scrive nulla)
  useEffect(() => {
    setAbb(null)
    const daCercare = basi.filter(b => (norm(b.nomin) || b.mat) && !(b.tipoRich === 'SE' && !b.mat) && b.tipoRich !== 'FAM')
    if (!daCercare.length) { setAbb(new Map()); return }
    let vivo = true
    const t = setTimeout(() => {
      cralApi.abbina(daCercare.map(b => ({ i: b.i, nominativo: b.nomin, ...(b.mat ? { matricola: b.mat } : {}), ...(b.nascita ? { nascita: b.nascita } : {}) })))
        .then(r => {
          if (!vivo) return
          setAbb(new Map(r.esiti.map(e => [e.i, e])))
          setAnag(prima => { const n = new Map(prima); r.esiti.forEach(e => e.candidati.forEach(c => n.set(c.matricola, c))); return n })
        })
        .catch(e => { if (vivo) { avviso(messaggioErrore(e), 'error'); setAbb(new Map()) } })
    }, 200)
    return () => { vivo = false; clearTimeout(t) }
  }, [basi])

  const esterniCral = useMemo(() => db.soci.filter(s => !s.matricola && s.tipo !== 'FAM'), [db])
  const esiti = useMemo<Analisi[]>(() => basi.map(b => {
    if (!norm(b.nomin) && !b.mat) return { ...b, esito: 'VUOTA', cand: [], via: '' }
    const est = () => esterniCral.find(s => (b.tipoRich !== 'SE' || eSocio(s)) && risolvi(b.nomin, [s]).esito === 'trovato')
    if (b.tipoRich === 'SE' && !b.mat) { const x = est(); return { ...b, esito: 'non-trovato', cand: [], via: 'ESTERNO nel file', ...(x ? { esitoEst: x } : {}) } }
    if (b.tipoRich === 'FAM') return { ...b, esito: 'non-trovato', cand: [], via: '' }
    const a = abb?.get(b.i)
    if (!a) return { ...b, esito: 'non-trovato', cand: [], via: '', inAttesa: true }
    const out: Analisi = { ...b, esito: a.esito, cand: a.candidati, via: a.via, ...(a.matricolaIgnota ? { matIgnota: a.matricolaIgnota } : {}), ...(a.nascitaDiversa ? { nascitaDiversa: a.nascitaDiversa } : {}) }
    if (a.esito === 'non-trovato') { const x = est(); if (x) out.esitoEst = x }
    return out
  }), [basi, abb, esterniCral])
  const inAttesa = esiti.some(e => e.inAttesa)

  const d = (i: number): Decisione => dec[i] ?? {}
  const patch = (i: number, p: Decisione) => setDec(x => ({ ...x, [i]: { ...(x[i] ?? {}), ...p } }))
  const conAnag = (a: AnagraficaPgs) => setAnag(prima => new Map(prima).set(a.matricola, a))
  const sociPerMatricola = useMemo(() => new Map(db.soci.filter(s => s.matricola).map(s => [s.matricola!, s])), [db])

  /** Che cosa succede alla riga se confermi adesso. */
  function risultato(e: Analisi): Risultato {
    const x = d(e.i)
    if (e.esito === 'VUOTA' || x.ignora) return { tipo: 'ignora' }
    if (e.tipoRich === 'FAM') return { tipo: 'ignora', fam: true }
    if (e.inAttesa) return { tipo: 'aperto', motivo: 'abbinamento in corso' }
    let m = x.matricola ?? undefined, come = x.come ?? ''
    if (!m && !x.esterno && (e.esito === 'trovato' || e.esito === 'parziale') && e.cand[0]) {
      m = e.cand[0].matricola
      come = e.via === 'matricola' ? 'matricola del file' : e.via === 'nominativo e data di nascita' ? e.via : e.esito === 'trovato' ? 'nominativo' : 'nominativo parziale'
    }
    if (m) {
      const a = anag.get(m); if (!a) return { tipo: 'aperto', motivo: `matricola ${m} non in anagrafica` }
      const socio = sociPerMatricola.get(m)
      return socio ? { tipo: 'socio', socio, anag: a, come } : { tipo: 'pgs', anag: a, come }
    }
    if (!x.esterno && e.esitoEst) return { tipo: 'socio', socio: e.esitoEst, come: 'esterno già nel CRAL' }
    if (x.esterno || e.esito === 'non-trovato') return { tipo: 'esterno' }
    return { tipo: 'aperto', motivo: 'scegli fra gli omonimi' }
  }
  const sedeFinale = (e: Analisi): string => { const s = d(e.i).sede; return s !== undefined ? s : (e.sede ?? '') }
  const ris0 = esiti.map(risultato)
  const nb = (t: string | null | undefined) => numBase(db.tessera, t)
  // Soci attivi che il file non trova: forse usciti, forse con il nome scritto male. Decide l'operatore.
  const presenti = new Set(ris0.flatMap(r => r.tipo === 'socio' ? [r.socio.id] : r.tipo === 'pgs' ? [r.anag.matricola] : []))
  const assenti = esiti.length && !inAttesa ? db.soci.filter(s => eSocio(s) && s.stato === 'ATTIVO' && !presenti.has(s.id)).sort((a, b) => nominativo(a).localeCompare(nominativo(b))) : []
  const associabili = esiti.filter((e, k) => ['esterno', 'aperto', 'pgs'].includes(ris0[k]!.tipo) && !d(e.i).ignora)
  const suggerisci = (s: Persona): { e: Analisi; perche: string } | null => {
    const t = associabili.find(e => e.tessera && s.tessera && nb(e.tessera) === nb(s.tessera)); if (t) return { e: t, perche: 'stesso numero di iscrizione' }
    let best: { e: Analisi; x: number } | null = null
    for (const e of associabili) { const x = simNome(nominativo(s), e.nomin); if (x >= 0.75 && (!best || x > best.x)) best = { e, x } }
    return best ? { e: best.e, perche: `nome simile al ${Math.round(best.x * 100)}%` } : null
  }
  const sugg = Object.fromEntries(assenti.map(s => [s.id, suggerisci(s)]))
  const rigaAss: Record<number, Persona> = {}
  for (const [sid, v] of Object.entries(decAss)) { const p = assenti.find(x => x.id === sid); if (typeof v === 'number' && p) rigaAss[v] = p }
  const ris: Risultato[] = esiti.map((e, k) => rigaAss[e.i] ? { tipo: 'socio', socio: rigaAss[e.i]!, come: 'associato a mano (nome diverso nel file)', assoc: true } : ris0[k]!)
  const assNonDecisi = assenti.filter(s => decAss[s.id] === undefined).length
  const quanti = (t: Risultato['tipo']) => ris.filter(r => r.tipo === t).length
  const aperti = quanti('aperto')
  const daVerificare = esiti.filter((e, k) => e.esito === 'parziale' && !d(e.i).matricola && !d(e.i).esterno && ris[k]!.tipo !== 'ignora').length
  const tessDiv = (e: Analisi, r: Risultato) => r.tipo === 'socio' && !!e.tessera && !!r.socio.tessera && r.socio.tessera !== e.tessera && nb(r.socio.tessera) !== nb(e.tessera)
  const tessNuova = (e: Analisi, r: Risultato) => r.tipo === 'socio' && !!e.tessera && !r.socio.tessera
  const nTessDiv = esiti.filter((e, k) => tessDiv(e, ris[k]!)).length

  // Tessere che finirebbero doppie: nel file stesso o già di un'altra persona
  const conflitti = useMemo(() => {
    const out = new Map<number, string>(); const viste = new Map<string, number>()
    esiti.forEach((e, k) => {
      const r = ris[k]!
      const usa = r.tipo === 'pgs' || r.tipo === 'esterno' ? (r.tipo === 'pgs' || e.tipoRich !== 'EST' ? e.tessera : '')
        : r.tipo === 'socio' && (tessNuova(e, r) || (aggTess && tessDiv(e, r))) ? e.tessera : ''
      if (!usa) return
      if (!TESSERA_OK.test(usa)) { out.set(e.i, `tessera «${usa}» non valida`); return }
      const chi = r.tipo === 'socio' ? r.socio.id : null
      const altro = db.soci.find(x => x.id !== chi && x.tessera && norm(x.tessera) === norm(usa))
      if (altro) out.set(e.i, `tessera ${usa} già di ${nominativo(altro)}`)
      const p = viste.get(norm(usa)); if (p !== undefined) out.set(e.i, `tessera ${usa} ripetuta nel file (riga ${(numRiga[p] ?? 0) + 1})`); else viste.set(norm(usa), e.i)
    })
    return out
  }, [esiti, ris, aggTess, db, decAss])
  const visibili = esiti.filter((e, k) => !filtro || (filtro === 'aperto' ? ris[k]!.tipo === 'aperto' : filtro === 'tessera' ? tessDiv(e, ris[k]!) : filtro === 'conflitto' ? conflitti.has(e.i) : e.esito === filtro))

  async function conferma() {
    if (!file) return
    const ops: CralOperazioneApi[] = []
    const nuoveMat = new Set<string>()
    const pulisciEmail = (s: string) => (EMAIL_OK.test(s) ? s : '')
    esiti.forEach((e, k) => {
      const r = ris[k]!; const sede = sedeFinale(e) || null
      if (r.tipo === 'socio') {
        const op: Extract<CralOperazioneApi, { op: 'aggiorna' }> = { op: 'aggiorna', socio: r.socio.id }
        const note: string[] = []
        if (sede && sede !== r.socio.sede) op.sede = sede
        if (e.atipico && !r.socio.atipico) op.atipico = true
        if (r.assoc) note.push(`Nel libro soci come «${e.nomin}»`)
        if (tessNuova(e, r)) op.tessera = e.tessera
        else if (aggTess && tessDiv(e, r)) { op.tessera = e.tessera; note.push(`Tessera ${r.socio.tessera || '—'} → ${e.tessera} (import ${fmtData(oggi())})`) }
        if (note.length) op.nota = note.join(' · ')
        if (Object.keys(op).length > 2) ops.push(op)
      } else if (r.tipo === 'pgs') {
        if (nuoveMat.has(r.anag.matricola)) return
        nuoveMat.add(r.anag.matricola)
        ops.push({
          op: 'nuovoPgs', matricola: r.anag.matricola, tipo: e.tipoRich === 'EST' ? 'EST' : 'SD', cognome: r.anag.cognome || e.nomin, nome: r.anag.nome,
          nascita: r.anag.nascita ?? e.nascita, email: pulisciEmail(e.email), sede, tessera: e.tipoRich === 'EST' ? '' : e.tessera, atipico: e.atipico,
          nota: [r.come === 'nominativo parziale' || r.come === 'scelta a mano' ? `Abbinato a mano dall'import (nel file: «${e.nomin}»)` : '', e.atipico ? 'ATIPICO nel libro soci' : ''].filter(Boolean).join(' · '),
        })
      } else if (r.tipo === 'esterno') {
        const [cognome, nome] = spezzaNominativo(e.nomin)
        const tipo = e.tipoRich === 'EST' ? 'EST' : 'SE'
        ops.push({
          op: 'nuovoEsterno', tipo, cognome: cognome || e.nomin.toUpperCase(), nome, nascita: e.nascita, email: pulisciEmail(e.email), sede,
          tessera: tipo === 'SE' ? e.tessera : '', atipico: e.atipico,
          nota: [e.atipico ? 'ATIPICO nel libro soci' : '', e.nomin === e.nomin.toUpperCase() && e.nomin.trim().split(/\s+/).length > 2 ? 'Nominativo tutto maiuscolo: controlla dove finisce il cognome' : ''].filter(Boolean).join(' · '),
        })
      }
    })
    for (const s of assenti) if (decAss[s.id] === 'CESSA') ops.push({ op: 'cessa', socio: s.id, nota: `Non presente nel libro soci (${file.nome})` })
    if (!ops.length) { avviso('Niente da importare: tutto è già allineato.', 'info'); return }
    setInvio(true)
    const r = await esegui(() => cralApi.confermaImport(file.nome, ops), x => {
      const v = x.esito
      return `Import completato: ${v.nuoviPgs} dall'anagrafica PGS, ${v.nuoviEsterni} da validare, ${v.aggiornati} aggiornati, ${v.tessere} tessere${v.cessati ? `, ${v.cessati} cessati` : ''}`
    })
    setInvio(false)
    if (r) { setFatto(r.esito); setFile(null) }
  }

  const chip = (k: string, l: string, n: number) => <button key={k} onClick={() => setFiltro(k)} className={`${btnPiccolo} border ${filtro === k ? 'bg-indigo-600/20 text-indigo-300 border-indigo-700' : 'bg-slate-800 text-slate-300 border-slate-700'}`}>{l} <span className="text-slate-500">{n}</span></button>

  return (
    <div className="flex flex-col gap-4">
      {fatto && <div className={`${cardCls} p-5 flex flex-wrap items-center gap-4 border-emerald-800/60`}>
        <div className="w-10 h-10 rounded-lg bg-emerald-600/20 text-emerald-400 flex items-center justify-center"><Ico d={D.check} cls="w-5 h-5" /></div>
        <div className="flex-1 min-w-[200px]"><p className="text-white font-medium">Importazione completata</p><p className="text-sm text-slate-400">{fatto.nuoviPgs} nuovi dall'anagrafica PGS · {fatto.nuoviEsterni} nuovi da validare (soci esterni o esterni) · {fatto.aggiornati} aggiornati · {fatto.tessere} tessere assegnate o aggiornate{fatto.cessati ? ` · ${fatto.cessati} soci segnati cessati` : ''}</p></div>
        {fatto.nuoviEsterni > 0 && <button className={btnPrimario} onClick={() => vaiA('validare')}>Vai a «Da validare»</button>}
      </div>}

      <div className={`${cardCls} p-5 flex flex-col gap-3`}>
        <div role="button" tabIndex={0} onClick={() => inp.current?.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inp.current?.click() }}
          onDragOver={e => { e.preventDefault(); setTrascina(true) }} onDragLeave={() => setTrascina(false)}
          onDrop={e => { e.preventDefault(); setTrascina(false); const f = e.dataTransfer.files[0]; if (f) void apriFile(f) }}
          className={`flex flex-col sm:flex-row sm:items-center gap-4 border-2 border-dashed rounded-xl px-5 py-5 cursor-pointer transition-colors ${trascina ? 'border-indigo-500 bg-indigo-950/20' : 'border-slate-700 hover:border-indigo-500'}`}>
          <div className="w-10 h-10 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center shrink-0"><Ico d={D.upload} cls="w-5 h-5" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white">{lettura ? 'Lettura del file sul server…' : "Trascina qui il libro soci o l'elenco iscritti (.xlsx, .xls, .csv) oppure fai clic per sceglierlo"}</p>
            <p className="text-xs text-slate-500 mt-0.5">Il file va al server, che lo legge e abbina i nominativi all'anagrafica PGS. Non si salva nulla finché non confermi. Il codice fiscale, se c'è, non si usa e non si salva.</p>
          </div>
          <input ref={inp} type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) void apriFile(f); e.target.value = '' }} />
        </div>
        <details className="text-xs text-slate-400"><summary className="cursor-pointer select-none text-slate-300">Come avviene l'abbinamento</summary>
          <ol className="mt-2 ml-4 list-decimal space-y-1 max-w-3xl">
            <li>Se la riga ha la <b>matricola</b>, si usa quella: l'ID del socio è la matricola già presente in PGS.</li>
            <li>Se la matricola manca, si confronta il <b>nominativo</b> con le anagrafiche PGS, con la stessa regola di Emolumenti. L'ordine delle parole non conta, così come maiuscole, accenti e apostrofi: «DANGELO», «D ANGELO» e «D'ANGELO» si trovano fra loro.</li>
            <li>Prima i nominativi <b>identici</b>, poi quelli <b>contenuti</b> (es. «Bianchi Giulia» dentro «BIANCHI GIULIA MARIA»). Quest'ultimo caso è segnato «da verificare».</li>
            <li>Più candidati: <b>scegli tu</b>, il programma non indovina mai. La <b>data di nascita</b> del file, se c'è, decide fra gli omonimi.</li>
            <li>Nessuno: diventa un socio esterno (o esterno) <span className="font-mono">EXT-nnnn</span> da validare, a meno che tu non lo abbini a mano.</li>
            <li>L'anagrafica comprende anche i cessati: un ex dipendente in pensione riprende la sua matricola.</li>
          </ol>
          <p className="mt-2"><button type="button" className="text-indigo-400 hover:text-indigo-300" onClick={() => vaiA('guide')}>Tracciato record T1 · Libro soci →</button></p></details>
      </div>

      {file && <>
        <div className={`${cardCls} p-5 flex flex-col gap-4`}>
          <div className="flex flex-wrap items-center gap-2"><Ico d={D.doc} cls="w-4 h-4 text-slate-400" /><span className="text-sm text-white font-medium">{file.nome}</span>
            <span className="text-xs text-slate-500">· {numRiga.length} righe nel foglio{hdr > 0 ? ` · intestazione alla riga ${hdr + 1}` : ''}{ripetute ? ` · ${ripetute === 1 ? '1 intestazione ripetuta saltata' : `${ripetute} intestazioni ripetute saltate`}` : ''}</span>
            <button className="ml-auto text-xs text-slate-400 hover:text-white" onClick={() => setFile(null)}>Chiudi file</button></div>
          {Object.keys(file.fogli).length > 1 && <div className="flex flex-wrap items-center gap-2"><span className={etichettaCls}>Foglio</span>
            {Object.keys(file.fogli).map(n => <button key={n} onClick={() => scegliFoglio(file, n)} className={`${btnPiccolo} border ${n === foglio ? 'bg-indigo-600/20 text-indigo-300 border-indigo-700' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}`}>{n} <span className="text-slate-500">{Math.max(0, (file.fogli[n]?.length ?? 0) - 1 - trovaIntestazione(file.fogli[n]))}</span></button>)}</div>}
          {hdr > 0 && <p className="text-xs text-slate-500">Le righe sopra l'intestazione sono un titolo e si ignorano: «{(rows[0] ?? []).filter(x => x.trim()).join(' · ')}».</p>}
          {colCf >= 0 && <p className="text-xs text-slate-400">La colonna «{intest[colCf]}» c'è ma <b>non si usa e non si salva</b>: il modulo non raccoglie il codice fiscale.</p>}
          <div>
            <p className={etichettaCls + ' mb-2'}>Colonne</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {RUOLI_COL.map(([k, l]) => (
                <Campo key={k} label={l}><select className={inputCls} value={map[k] ?? ''} onChange={e => { setMap({ ...map, [k]: e.target.value }); setDec({}); setAperta(null) }}>
                  <option value="">— Nessuna</option>{intest.map((h, i) => i === colCf ? null : <option key={i} value={String(i)}>{h || `Colonna ${i + 1}`}</option>)}</select></Campo>))}
            </div>
            {!pronto && <p className="text-sm text-amber-400 mt-3">Indica la colonna del nominativo (o cognome e nome), oppure quella della matricola.</p>}
          </div>
        </div>

        {pronto && <div className={`${cardCls} overflow-hidden`}>
          <div className="px-5 py-3 border-b border-slate-800 flex flex-wrap gap-2 items-center">
            <button onClick={() => setFiltro('')} className={`${btnPiccolo} border ${!filtro ? 'bg-indigo-600/20 text-indigo-300 border-indigo-700' : 'bg-slate-800 text-slate-300 border-slate-700'}`}>Tutte <span className="text-slate-500">{esiti.length}</span></button>
            {aperti > 0 && chip('aperto', 'Da decidere', aperti)}
            {(Object.keys(ESITI) as Esito[]).map(k => { const n = esiti.filter(e => e.esito === k && !e.inAttesa).length; return n > 0 ? chip(k, ESITI[k][0], n) : null })}
            {nTessDiv > 0 && chip('tessera', 'Tessera diversa', nTessDiv)}
            {conflitti.size > 0 && chip('conflitto', 'Tessera doppia', conflitti.size)}
            {inAttesa && <span className="text-xs text-slate-400 ml-2">Abbinamento sul server…</span>}
          </div>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-slate-900"><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
              <th className="px-5 py-2.5 font-semibold">Riga</th><th className={thCls}>Nel file</th><th className={thCls}>Esito</th><th className={thCls}>Abbinato a</th><th className={thCls}>Sede di consegna</th><th className="px-5 py-2.5 font-semibold">Risultato</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-800/70">
              {visibili.map(e => {
                const k = esiti.indexOf(e); const r = ris[k]!; const [l, tono, spieg] = ESITI[e.esito]
                const primoAperto = ris.findIndex(x => x.tipo === 'aperto')
                const espansa = aperta === e.i || (r.tipo === 'aperto' && !e.inAttesa && aperta === null && k === primoAperto)
                const apribile = e.esito !== 'VUOTA' && !e.inAttesa
                const sospetto = !('assoc' in r && r.assoc) && ['esterno', 'aperto', 'pgs'].includes(r.tipo) ? assenti.find(x => sugg[x.id]?.e === e && decAss[x.id] === undefined) : undefined
                return (
                  <Fragment key={e.i}>
                    <tr className={`${r.tipo === 'ignora' ? 'opacity-50' : ''} ${r.tipo === 'aperto' ? 'bg-amber-950/10' : ''} ${apribile ? 'cursor-pointer hover:bg-slate-800/30' : ''}`} onClick={() => { if (apribile) setAperta(espansa ? -1 : e.i) }}>
                      <td className="px-5 py-2 text-slate-500 tabular-nums">{(numRiga[e.i] ?? 0) + 1}</td>
                      <td className="px-3 py-2 whitespace-nowrap"><span className="text-slate-100">{e.nomin || <span className="text-slate-600">—</span>}</span>{e.mat && <span className="ml-2 font-mono text-xs text-slate-500">mat. {e.mat}</span>}{e.tessera && <span className="ml-2 font-mono text-xs text-slate-500">n. {e.tessera}</span>}{e.tipoRich === 'SE' && <span className="ml-2"><Pill tono="cf">ESTERNO</Pill></span>}{e.atipico && <span className="ml-2"><Pill tono="warn" title="Per ora: socio cercato in PGS, con l'etichetta">ATIPICO</Pill></span>}{e.nascita && <span className="ml-2 text-xs text-slate-500 tabular-nums">nato/a {fmtData(e.nascita)}</span>}{e.nascitaDiversa && <div className="text-[11px] text-amber-400">in PGS nato/a il {fmtData(e.nascitaDiversa)}: verifica</div>}</td>
                      <td className="px-3 py-2">{e.inAttesa ? <span className="text-xs text-slate-500">…</span> : <Pill tono={tono} title={spieg}>{l}</Pill>}{e.matIgnota && <div className="text-[11px] text-red-300 mt-0.5">matricola {e.matIgnota} inesistente</div>}</td>
                      <td className="px-3 py-2 text-xs">
                        {(r.tipo === 'pgs' || (r.tipo === 'socio' && r.anag)) && <div className="flex flex-col gap-0.5"><PersonaPgs a={r.anag!} /><span className="text-[11px] text-slate-500">per {r.come}</span></div>}
                        {r.tipo === 'socio' && !r.anag && !r.assoc && <span className="text-slate-300"><span className="font-mono text-violet-300">{r.socio.id}</span> {nominativo(r.socio)}</span>}
                        {r.tipo === 'aperto' && <span className="text-amber-300">{e.cand.length ? `${e.cand.length} candidati · ` : ''}{r.motivo}</span>}
                        {r.tipo === 'esterno' && <span className="text-violet-300">nessuno · nuovo {e.tipoRich === 'EST' ? 'esterno' : 'socio esterno'}</span>}
                        {r.tipo === 'socio' && r.assoc && <span className="text-emerald-300"><span className="font-mono">{r.socio.id}</span> {nominativo(r.socio)} · associato a mano</span>}
                        {sospetto && <div className="text-[11px] text-amber-300 mt-0.5">forse è {nominativo(sospetto)} ({sugg[sospetto.id]?.perche}): vedi sotto</div>}
                        {conflitti.has(e.i) && <div className="text-[11px] text-red-300 mt-0.5">{conflitti.get(e.i)}</div>}
                      </td>
                      <td className="px-3 py-2" onClick={ev => ev.stopPropagation()}>
                        {e.esito === 'VUOTA' ? <span className="text-slate-600 text-xs">—</span> :
                          <div className="flex flex-col gap-0.5"><select className={inputCls + ' py-1 text-xs min-w-[190px]'} value={sedeFinale(e)} onChange={ev => patch(e.i, { sede: ev.target.value })}>
                            <option value="">— Da indicare</option>{db.sedi.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select>
                            {e.sede === undefined && d(e.i).sede === undefined && <span className="text-[11px] text-amber-400">«{e.sedeTesto.trim()}» non riconosciuta</span>}</div>}
                      </td>
                      <td className="px-5 py-2 whitespace-nowrap">
                        {r.tipo === 'pgs' && <Pill tono={e.tipoRich === 'EST' ? 'cyan' : 'nuovo'}>{e.tipoRich === 'EST' ? 'Nuovo esterno (dipendente)' : 'Nuovo socio dipendente'}</Pill>}
                        {r.tipo === 'socio' && <Pill>{sedeFinale(e) && sedeFinale(e) !== r.socio.sede ? 'Già nel CRAL · aggiorna sede' : 'Già nel CRAL'}</Pill>}
                        {tessNuova(e, r) && <span className="ml-1.5"><Pill tono="ok" title="Non aveva la tessera: prende il numero del libro soci">tessera {e.tessera}</Pill></span>}
                        {tessDiv(e, r) && r.tipo === 'socio' && <span className="ml-1.5"><Pill tono="warn" title={aggTess ? 'Alla conferma prende il numero del file' : 'Il numero resta quello di PGS'}>tessera {r.socio.tessera || '—'} → {e.tessera}</Pill></span>}
                        {r.tipo === 'esterno' && <Pill tono={e.tipoRich === 'EST' ? 'cyan' : 'cf'}>{e.tipoRich === 'EST' ? 'Esterno da validare' : 'Socio esterno da validare'}</Pill>}
                        {r.tipo === 'aperto' && <Pill tono="warn">Da decidere</Pill>}
                        {r.tipo === 'ignora' && (r.fam ? <Pill tono="fam" title="I familiari si inseriscono dalla scheda del socio">Familiare: a mano</Pill> : <Pill tono="err">Ignorata</Pill>)}
                        {apribile && <span className="ml-2 text-xs text-indigo-400">{espansa ? 'chiudi' : 'cambia'}</span>}
                      </td>
                    </tr>
                    {espansa && apribile && <tr><td colSpan={6} className="p-0"><PannelloAbbinamento e={e} r={r} d={d(e.i)} patch={p => patch(e.i, p)} onAnag={conAnag} onFatto={() => setAperta(-1)} /></td></tr>}
                  </Fragment>)
              })}
            </tbody>
          </table></div>
          {(assenti.length > 0 || nTessDiv > 0) && <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/40 flex flex-col gap-3">
            {nTessDiv > 0 && <div className="flex flex-wrap items-center gap-3"><p className="text-sm text-slate-300 flex-1 min-w-[220px]"><b className="text-white tabular-nums">{nTessDiv}</b> {nTessDiv === 1 ? 'socio ha' : 'soci hanno'} nel file un numero di tessera diverso da PGS.</p><Interruttore on={aggTess} onChange={setAggTess} label="Prendi il numero del file (resta nelle note)" /></div>}
            {assenti.length > 0 && <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2"><p className="text-sm text-slate-300 flex-1 min-w-[260px]"><b className="text-white tabular-nums">{assenti.length}</b> soci attivi in PGS <b>non si trovano nel file</b>{assNonDecisi > 0 ? <span className="text-amber-400"> · {assNonDecisi} da decidere</span> : <span className="text-emerald-300"> · tutti decisi</span>}. Forse sono usciti, forse nel file il nome è scritto male: decidi tu, uno per uno.</p>
                <button className={btnPiccoloSec} onClick={() => setDecAss(x => ({ ...x, ...Object.fromEntries(assenti.filter(s => x[s.id] === undefined).map(s => [s.id, 'RESTA' as const])) }))}>Restanti: restano attivi</button>
                <button className={btnPiccoloSec} onClick={() => setDecAss(x => ({ ...x, ...Object.fromEntries(assenti.filter(s => x[s.id] === undefined).map(s => [s.id, 'CESSA' as const])) }))}>Restanti: cessati</button></div>
              <div className="overflow-x-auto rounded-lg border border-slate-800"><table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 bg-slate-900/60"><th className="px-3 py-2 font-semibold">Tessera</th><th className="px-3 py-2 font-semibold">Socio in PGS</th><th className="px-3 py-2 font-semibold">Possibile riga del file</th><th className="px-3 py-2 font-semibold">Decisione</th></tr></thead>
                <tbody className="divide-y divide-slate-800/70">{assenti.map(s => {
                  const v = decAss[s.id], sg = sugg[s.id]
                  const set1 = (val: 'CESSA' | 'RESTA' | number | undefined) => setDecAss(x => { const n = { ...x }; if (val === undefined) delete n[s.id]; else n[s.id] = val; return n })
                  const prese = new Set(Object.entries(decAss).filter(([k, w]) => k !== s.id && typeof w === 'number').map(([, w]) => w))
                  return (
                    <tr key={s.id} className={v === undefined ? 'bg-amber-950/10' : ''}>
                      <td className="px-3 py-2 font-mono text-xs text-slate-400">{s.tessera || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap"><span className="text-slate-100">{nominativo(s)}</span> <Origine s={s} />{s.nascita && <span className="ml-1.5 text-xs text-slate-500 tabular-nums">{fmtData(s.nascita)}</span>}</td>
                      <td className="px-3 py-2 text-xs">{sg ? <button disabled={prese.has(sg.e.i)} className="text-left text-amber-300 hover:text-amber-200 disabled:opacity-40" onClick={() => set1(sg.e.i)}>«{sg.e.nomin}» · riga {(numRiga[sg.e.i] ?? 0) + 1}<div className="text-slate-500">{sg.perche} · clic per associare</div></button> : <span className="text-slate-600">nessuna riga simile</span>}</td>
                      <td className="px-3 py-2"><div className="flex flex-wrap items-center gap-1.5">
                        {([['CESSA', 'Cessato', 'border-red-800 text-red-300 bg-red-950/30'], ['RESTA', 'Resta attivo', 'border-emerald-800 text-emerald-300 bg-emerald-950/30']] as Array<['CESSA' | 'RESTA', string, string]>).map(([kk, ll, c]) => <button key={kk} onClick={() => set1(kk)} className={`${btnPiccolo} border ${v === kk ? c : 'border-slate-700 bg-slate-800 text-slate-300'}`}>{ll}</button>)}
                        <select className={`${inputCls} py-1 text-xs w-56 ${typeof v === 'number' ? 'border-indigo-600 text-indigo-200' : ''}`} value={typeof v === 'number' ? String(v) : ''} onChange={e => set1(e.target.value === '' ? undefined : +e.target.value)}>
                          <option value="">È nel file come…</option>{associabili.filter(e => !prese.has(e.i)).map(e => <option key={e.i} value={e.i}>riga {(numRiga[e.i] ?? 0) + 1} · {e.nomin}{e.tessera ? ` (n. ${e.tessera})` : ''}</option>)}</select>
                      </div></td>
                    </tr>)
                })}</tbody>
              </table></div>
              <p className="text-xs text-slate-500">«Cessato»: alla conferma diventa Cessato con la data di oggi (se rientra prende un nuovo numero). «Resta attivo»: non cambia nulla (va bene se il file è solo una parte dei soci). «È nel file come…»: la riga scelta non crea un nuovo socio, aggiorna questo (tessera compresa) e il nome del file resta nelle note.</p>
            </div>}
          </div>}
          <div className="px-5 py-4 border-t border-slate-800 flex flex-wrap items-center gap-3">
            <p className="text-sm text-slate-400 flex-1 min-w-[220px]">
              {aperti > 0 && <span className="text-amber-400">{aperti} righe da decidere: scegli la persona, crea un esterno o ignora. </span>}
              {assNonDecisi > 0 && <span className="text-amber-400">{assNonDecisi} soci assenti dal file da decidere. </span>}
              {conflitti.size > 0 && <span className="text-red-300">{conflitti.size} tessere doppie da sistemare (o righe da ignorare). </span>}
              {daVerificare > 0 && <span className="text-amber-300/80">{daVerificare} abbinamenti parziali da guardare. </span>}
              {quanti('pgs')} nuovi dall'anagrafica PGS · {quanti('esterno')} esterni · {quanti('socio')} già nel CRAL · {quanti('ignora')} ignorate.
            </p>
            <button className={btnPrimario} disabled={invio || inAttesa || aperti > 0 || assNonDecisi > 0 || conflitti.size > 0 || !(quanti('pgs') + quanti('esterno') + quanti('socio'))} onClick={() => void conferma()}><Ico d={D.check} />Conferma importazione</button>
          </div>
        </div>}
      </>}
    </div>
  )
}

/** Pannello sotto la riga, come in Emolumenti: candidati, ricerca, matricola a mano, esterno, ignora. */
function PannelloAbbinamento({ e, r, d, patch, onAnag, onFatto }: {
  e: Analisi; r: Risultato; d: Decisione; patch: (p: Decisione) => void; onAnag: (a: AnagraficaPgs) => void; onFatto: () => void
}) {
  const [cerca, setCerca] = useState('')
  const [mano, setMano] = useState('')
  const [suggeriti, setSuggeriti] = useState<AnagraficaPgs[]>([])
  useEffect(() => {
    const t = cerca.trim(); if (t.length < 2) { setSuggeriti([]); return }
    let vivo = true
    const timer = setTimeout(() => { cralApi.anagrafica(t).then(x => { if (vivo) setSuggeriti(x.risultati.slice(0, 8)) }).catch(() => undefined) }, 250)
    return () => { vivo = false; clearTimeout(timer) }
  }, [cerca])
  const scegli = (a: AnagraficaPgs, come: string) => { onAnag(a); patch({ matricola: a.matricola, come, esterno: false, ignora: false }); onFatto() }
  async function usaMano() {
    const m = mano.padStart(6, '0')
    try {
      const x = await cralApi.anagrafica(mano)
      const a = x.risultati.find(y => y.matricola === m || y.matricola === mano)
      if (a) scegli(a, 'matricola scritta a mano'); else avviso(`La matricola ${m} non è in anagrafica.`, 'error')
    } catch (err) { avviso(messaggioErrore(err), 'error') }
  }
  const attuale = r.tipo === 'pgs' || r.tipo === 'socio' ? r.anag?.matricola : undefined
  return (
    <div className="px-5 py-4 bg-amber-950/20 border-y border-amber-900/30 flex flex-col gap-3">
      {e.esito === 'parziale' && !d.matricola && !d.esterno && e.cand[0] && <p className="text-xs text-amber-300/90">Corrispondenza parziale: nel file «{e.nomin}», in anagrafica «{e.cand[0].cognome} {e.cand[0].nome}». È la stessa persona? Se sì, lascia così. Se no, scegli sotto.</p>}
      {e.cand.length > 1 && <>
        <p className="text-xs text-amber-300/90">Scegli la persona giusta: «{e.nomin}» corrisponde a {e.cand.length} anagrafiche.</p>
        <div className="flex flex-wrap gap-2">
          {e.cand.map(c => <button key={c.matricola} onClick={() => scegli(c, 'scelta fra omonimi')} className={`px-3 py-1.5 rounded-lg text-sm transition-colors border ${attuale === c.matricola ? 'bg-indigo-600/30 border-indigo-600 text-white' : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'}`}><PersonaPgs a={c} />{c.nascita && <span className="ml-2 text-xs text-slate-500">{fmtData(c.nascita)}</span>}</button>)}
        </div></>}
      <p className="text-xs text-amber-300/90">{e.cand.length ? 'Nessuno dei candidati è quello giusto? Cerca in anagrafiche:' : 'Nessuna corrispondenza automatica. Cerca in anagrafiche:'}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input value={cerca} onChange={ev => setCerca(ev.target.value)} placeholder="Cognome, nome o matricola" className={inputW + ' py-1.5 flex-1 min-w-[14rem]'} />
        <span className="text-xs text-slate-500">oppure matricola a mano</span>
        <input value={mano} onChange={ev => setMano(ev.target.value.replace(/\D/g, ''))} placeholder="000000" className={inputW + ' py-1.5 w-28 font-mono'} />
        <button className={btnPiccoloSec} disabled={!mano} onClick={() => void usaMano()}>Usa</button>
      </div>
      {suggeriti.length > 0 && <div className="rounded-lg border border-slate-800 divide-y divide-slate-800 max-h-56 overflow-auto bg-slate-950/60">
        {suggeriti.map(a => <button key={a.matricola} onClick={() => scegli(a, 'scelta a mano')} className="w-full text-left px-3 py-2 hover:bg-slate-800 text-sm"><PersonaPgs a={a} />{a.nascita && <span className="ml-2 text-xs text-slate-500">{fmtData(a.nascita)}</span>}</button>)}</div>}
      <div className="flex flex-wrap gap-2 pt-1">
        <button className={btnPiccolo + ' bg-violet-900/40 text-violet-200 border border-violet-800 hover:bg-violet-900/60'} onClick={() => { patch({ matricola: null, esterno: true, ignora: false }); onFatto() }}>Crea come esterno da validare</button>
        {(d.matricola || d.esterno) && <button className={btnPiccoloSec} onClick={() => { patch({ matricola: null, esterno: false, come: null }); onFatto() }}>Torna all'abbinamento automatico</button>}
        <button className={btnPiccolo + ' text-red-300 border border-red-900/60 hover:bg-red-950/40'} onClick={() => { patch({ ignora: !d.ignora }); onFatto() }}>{d.ignora ? 'Non ignorare' : 'Ignora la riga'}</button>
        <button className={btnSecondario + ' ml-auto py-1.5'} onClick={onFatto}>Chiudi</button>
      </div>
    </div>
  )
}
