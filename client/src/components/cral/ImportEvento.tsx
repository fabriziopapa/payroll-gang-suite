// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · importazioni dentro un evento
// T2 risposte del modulo (scelte) · T3 ordini (anche fogli senza
// intestazione, es. le mele) · T4 partecipanti singoli.
// Il file lo legge il server (/cral/file/leggi): qui solo l'aggancio.
// ============================================================

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { cralApi } from '../../api/endpoints'
import type { Db, Iniziativa, PatchScelta, Persona } from './tipi'
import {
  TIPOLOGIE, agganciaPersona, destinatari, fmtEuro, fmtQ, nominativo, norm, normNome, parseEuro, prodLabel, spezzaNominativo, tipNome,
} from './logica'
import { Campo, D, Ico, Interruttore, Modale, Origine, Pill, avviso, btnPrimario, btnSecondario, fileBase64, inputCls, messaggioErrore, useCral } from './ui'

/** Primo foglio di un file letto dal server. */
export function useFoglio() {
  const [righe, setRighe] = useState<string[][] | null>(null)
  const [leggo, setLeggo] = useState(false)
  async function apri(f: File) {
    setLeggo(true)
    try {
      const { fogli } = await cralApi.leggiFile(f.name, await fileBase64(f))
      const primo = Object.values(fogli)[0]
      if (!primo?.length) avviso('Il file è vuoto.', 'error'); else setRighe(primo)
    } catch (e) { avviso(messaggioErrore(e), 'error') }
    finally { setLeggo(false) }
  }
  return { righe, apri, leggo }
}

export function SceltaFile({ apri, leggo, spiega }: { apri: (f: File) => Promise<void>; leggo: boolean; spiega: ReactNode }) {
  const inp = useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
      <button className={btnPrimario} disabled={leggo} onClick={() => inp.current?.click()}><Ico d={D.upload} />{leggo ? 'Lettura…' : 'Scegli il file'}</button>
      <input ref={inp} type="file" accept=".csv,.xlsx,.xls" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) void apri(f); e.target.value = '' }} />
      <p className="text-xs text-slate-500">{spiega}</p>
    </div>
  )
}

const ordinaNomi = (xs: Persona[]) => xs.slice().sort((a, b) => nominativo(a).localeCompare(nominativo(b)))

// ── T2 · risposte del modulo ─────────────────────────────────
export function ModuloRisposteModal({ ini, onClose }: { ini: Iniziativa; onClose: () => void }) {
  const { db, esegui } = useCral()
  const { righe, apri, leggo } = useFoglio()
  const [manuali, setManuali] = useState<Record<number, string>>({})
  const dest = useMemo(() => destinatari(db, ini), [db, ini])
  const esiti = useMemo(() => {
    if (!righe) return []
    const h = righe[0] ?? []
    const ci = (re: RegExp) => h.findIndex(x => re.test(x))
    const cEmail = ci(/mail/i), cNom = ci(/nominativo|cognome/i), cId = ci(/matricola|id socio|tessera/i)
    const cScelta = h.findIndex((x, k) => k !== cEmail && k !== cNom && k !== cId && !/cronolog|^data|^ora/i.test(x) && x.trim())
    return righe.slice(1).map((r, i) => {
      const email = cEmail >= 0 ? (r[cEmail] ?? '').trim() : ''
      const nom = cNom >= 0 ? (r[cNom] ?? '').trim() : ''
      const testo = cScelta >= 0 ? (r[cScelta] ?? '') : ''
      const opz = ini.opzioni.find(o => norm(o.etichetta) === norm(testo)) ?? ini.opzioni.find(o => !!norm(testo) && (norm(o.etichetta).includes(norm(testo)) || norm(testo).includes(norm(o.etichetta))))
      const [socio, via] = agganciaPersona(dest, cId >= 0 ? (r[cId] ?? '') : '', email, nom)
      return { i, email, nom, testo, opz, socio, via }
    }).filter(e => e.email || e.nom || e.testo.trim())
  }, [righe, dest, ini])
  const finale = (e: (typeof esiti)[number]) => e.socio ?? dest.find(s => s.id === manuali[e.i])
  const pronte = esiti.filter(e => finale(e) && e.opz)
  const nonAgg = esiti.filter(e => !e.socio)
  async function applica() {
    const voci = new Map<string, PatchScelta>()
    for (const e of pronte) voci.set(finale(e)!.id, { opz: e.opz!.id })
    const r = await esegui(() => cralApi.scelteInBlocco(ini.id, [...voci].map(([socio, dati]) => ({ socio, dati })), 'modulo'), `${voci.size} scelte registrate dal modulo`)
    if (r) onClose()
  }
  return (
    <Modale largo titolo="Importa risposte del modulo" sotto="Export del modulo online (CSV o XLSX): data/ora, scelta, email e, se c'è, nominativo (tracciato T2)." onClose={onClose}
      piedi={righe && <><span className="text-sm text-slate-400 mr-auto self-center">{pronte.length} da registrare · {nonAgg.length} non agganciate</span><button className={btnSecondario} onClick={onClose}>Annulla</button><button className={btnPrimario} disabled={!pronte.length} onClick={() => void applica()}>Registra {pronte.length} scelte</button></>}>
      {!righe ? <SceltaFile apri={apri} leggo={leggo} spiega="Aggancio: matricola/tessera, poi email, poi nominativo. Le righe non agganciate si assegnano a mano." /> :
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500"><th className="px-3 py-2 font-semibold">Email / nominativo nel file</th><th className="px-3 py-2 font-semibold">Scelta nel file</th><th className="px-3 py-2 font-semibold">Persona</th></tr></thead>
          <tbody className="divide-y divide-slate-800/70">{esiti.map(e => (
            <tr key={e.i}>
              <td className="px-3 py-2 text-xs text-slate-300">{e.email || <span className="text-slate-500">senza email</span>}{e.nom && <div className="text-slate-500">{e.nom}</div>}</td>
              <td className="px-3 py-2 text-xs">{e.opz ? <span className="text-slate-200">{e.opz.etichetta}</span> : <span className="text-red-300">«{e.testo}» non è tra le opzioni</span>}</td>
              <td className="px-3 py-2">{e.socio ? <span className="text-sm text-slate-100">{nominativo(e.socio)} <Pill tono="ok">per {e.via}</Pill></span> :
                <div className="flex items-center gap-2"><Pill tono="warn">Non agganciata</Pill>
                  <select className={inputCls + ' py-1 text-xs'} value={manuali[e.i] ?? ''} onChange={ev => setManuali({ ...manuali, [e.i]: ev.target.value })}><option value="">Assegna a…</option>{ordinaNomi(dest).map(s => <option key={s.id} value={s.id}>{nominativo(s)}</option>)}</select></div>}</td>
            </tr>))}</tbody>
        </table></div>}
    </Modale>
  )
}

// ── T3 · ordini (anche senza intestazione) ───────────────────
const ruoliPos = (db: Db, ini: Iniziativa): Array<[string, string]> => [['', 'Ignora'], ['cog', 'Cognome'], ['nome', 'Nome'], ['nom', 'Nominativo (cognome e nome)'], ['id', 'Matricola / ID / tessera'], ['email', 'Email'],
  ...ini.prodotti.map(p => [`q:${p.id}`, `Quantità · ${prodLabel(db, p)}`] as [string, string]), ['imp', 'Importo € (solo controllo)'], ['pag', 'Pagato'], ['note', 'Note']]
/** Ipotesi per un file senza intestazione: colonne di testo = cognome, nome; colonne di numeri = quantità, importo. */
function posIniziale(righe: string[][], ini: Iniziativa): string[] {
  const nCol = Math.max(0, ...righe.map(r => r.length)); const testo: number[] = [], numeri: number[] = []
  for (let j = 0; j < nCol; j++) {
    const v = righe.map(r => r[j] ?? '').filter(x => x.trim() !== ''); if (!v.length) continue
    ;(v.filter(x => /^\d+([.,]\d+)?$/.test(x.trim())).length > v.length / 2 ? numeri : testo).push(j)
  }
  const pos = Array<string>(nCol).fill('')
  if (testo.length >= 2) { pos[testo[0]!] = 'cog'; pos[testo[1]!] = 'nome' } else if (testo.length === 1) pos[testo[0]!] = 'nom'
  if (numeri[0] != null && ini.prodotti[0]) pos[numeri[0]] = `q:${ini.prodotti[0].id}`
  if (numeri[1] != null) pos[numeri[1]] = 'imp'
  return pos
}

export function OrdiniImportModal({ ini, onClose }: { ini: Iniziativa; onClose: () => void }) {
  const { db, esegui } = useCral()
  const { righe, apri, leggo } = useFoglio()
  const [manuali, setManuali] = useState<Record<number, string>>({})
  const [pos, setPos] = useState<string[] | null>(null)
  const [diffSconto, setDiffSconto] = useState(true)
  const dest = useMemo(() => destinatari(db, ini), [db, ini])
  const unico = (nome: string) => ini.prodotti.filter(x => normNome(x.nome) === normNome(nome)).length === 1
  const eProd = (x: string, p: Iniziativa['prodotti'][number]) => normNome(x) === normNome(`${tipNome(db, p.tipologia)} ${p.nome}`) || (unico(p.nome) && normNome(x) === normNome(p.nome))
  const senza = !!righe && !(righe[0] ?? []).some(x => /nominativo|cognome|^nome$|matricola|mail|tessera|^id/i.test(x.trim()) || ini.prodotti.some(p => eProd(x, p)))
  const posEff = righe && senza ? (pos ?? posIniziale(righe, ini)) : null
  const calcolo = useMemo(() => {
    if (!righe) return { esiti: [], colProd: [] as Array<[Iniziativa['prodotti'][number], number]>, mancanti: [] as string[], nTot: 0, cImp: -1 }
    let c: { id: number; email: number; nom: number; cog: number; nome: number; pag: number; note: number; imp: number; prod: Array<[Iniziativa['prodotti'][number], number]> }
    if (senza && posEff) {
      const k = (r: string) => posEff.indexOf(r)
      c = { id: k('id'), email: k('email'), nom: k('nom'), cog: k('cog'), nome: k('nome'), pag: k('pag'), note: k('note'), imp: k('imp'), prod: ini.prodotti.map(p => [p, k(`q:${p.id}`)]) }
    } else {
      const h = righe[0] ?? []; const ci = (re: RegExp) => h.findIndex(x => re.test(x.trim()))
      c = { id: ci(/matricola|id socio|tessera/i), email: ci(/mail/i), nom: ci(/nominativo|cognome\s*e\s*nome/i), cog: ci(/^cognome$/i), nome: ci(/^nome$/i), pag: ci(/^pagato$/i), note: ci(/^note$/i), imp: ci(/importo|^totale|euro|€/i), prod: ini.prodotti.map(p => [p, h.findIndex(x => eProd(x, p))]) }
    }
    const v = (r: string[], j: number) => (j >= 0 ? (r[j] ?? '').trim() : '')
    let nTot = 0
    const esiti = (senza ? righe : righe.slice(1)).map((r, i) => ({ r, i })).filter(({ r }) => {
      const nom = v(r, c.nom) || [v(r, c.cog), v(r, c.nome)].filter(Boolean).join(' ')
      if (nom || v(r, c.id) || v(r, c.email)) return true
      if (r.some(x => x.trim() !== '')) nTot++ // riga senza persona ma con numeri: il totale in fondo al foglio
      return false
    }).map(({ r, i }) => {
      const nom = v(r, c.nom) || [v(r, c.cog), v(r, c.nome)].filter(Boolean).join(' ')
      const [socio, via] = agganciaPersona(dest, v(r, c.id), v(r, c.email), nom)
      const q: Record<string, number> = {}; const errori: string[] = []
      for (const [p, j] of c.prod) {
        if (j < 0) continue
        const t = v(r, j); if (!t) continue
        const okT = p.unita === 'kg' ? /^\d+([.,]\d{1,2})?$/.test(t) : /^\d+$/.test(t)
        if (!okT) { errori.push(`«${t}» non è una quantità valida (${prodLabel(db, p)})`); continue }
        const n = +t.replace(',', '.')
        if (p.max && n > p.max) errori.push(`${p.nome}: ${n} oltre il massimo di ${p.max}`); else if (n) q[p.id] = n
      }
      const calc = ini.prodotti.reduce((a, p) => a + Math.round((q[p.id] ?? 0) * p.prezzo), 0)
      const impFile = c.imp >= 0 && v(r, c.imp) ? parseEuro(v(r, c.imp)) : null
      const avviso2 = impFile !== null && impFile !== calc ? `importo nel file ${fmtEuro(impFile)}, calcolato ${fmtEuro(calc)}` : ''
      return { i, socio, via, q, errori, calc, impFile, avviso: avviso2, nomeFile: nom || v(r, c.email) || v(r, c.id) || '—', pagato: c.pag >= 0 && /^(SI|SÌ|S|X|1|TRUE)$/i.test(v(r, c.pag)), note: v(r, c.note) }
    })
    return { esiti, colProd: c.prod, mancanti: c.prod.filter(([, j]) => j < 0).map(([p]) => prodLabel(db, p)), nTot, cImp: c.imp }
  }, [righe, posEff?.join('|'), senza, dest, ini, db])
  const { esiti, colProd, mancanti, nTot, cImp } = calcolo
  const finale = (e: (typeof esiti)[number]) => e.socio ?? dest.find(s => s.id === manuali[e.i])
  const pronte = esiti.filter(e => finale(e) && !e.errori.length && Object.keys(e.q).length)
  const nAvvisi = esiti.filter(e => e.avviso).length
  async function applica() {
    const voci = pronte.map(e => {
      const id = finale(e)!.id
      const comeSconto = diffSconto && !!e.avviso && e.impFile !== null && e.impFile < e.calc
      const nota = [e.note || ini.scelte[id]?.note || '', e.avviso && !comeSconto ? `Nel file: ${fmtEuro(e.impFile ?? 0)} (calcolato ${fmtEuro(e.calc)})` : ''].filter(Boolean).join(' · ').slice(0, 500)
      const dati: PatchScelta = {
        q: e.q, pagato: e.pagato || !!ini.scelte[id]?.pagato, note: nota,
        scontoPers: comeSconto ? { tipo: '€', val: e.calc - (e.impFile ?? 0), nota: `dal file: ${fmtEuro(e.impFile ?? 0)} invece di ${fmtEuro(e.calc)}` } : null,
      }
      return { socio: id, dati }
    })
    const r = await esegui(() => cralApi.scelteInBlocco(ini.id, voci, 'modulo'), `${voci.length} ordini registrati${nAvvisi ? ` · ${nAvvisi} con importo diverso` : ''}`)
    if (r) onClose()
  }
  const nCol = righe ? Math.max(0, ...righe.map(r => r.length)) : 0
  return (
    <Modale largo titolo="Importa ordini" sotto="Una riga per persona, una colonna per prodotto con la quantità (tracciato T3). Va bene anche un foglio senza intestazione." onClose={onClose}
      piedi={righe && <><span className="text-sm text-slate-400 mr-auto self-center">{pronte.length} da registrare · {esiti.filter(e => e.errori.length).length} con errori · {esiti.filter(e => !e.socio).length} non agganciate{nAvvisi ? ` · ${nAvvisi} con importo diverso` : ''}{nTot ? ` · ${nTot === 1 ? 'riga di totale ignorata' : `${nTot} righe senza persona ignorate`}` : ''}</span><button className={btnSecondario} onClick={onClose}>Annulla</button><button className={btnPrimario} disabled={!pronte.length} onClick={() => void applica()}>Registra {pronte.length} ordini</button></>}>
      {!righe ? <SceltaFile apri={apri} leggo={leggo} spiega="Un ordine importato sostituisce quello già presente per la stessa persona." /> : <div className="flex flex-col gap-3">
        {senza && posEff && <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 flex flex-col gap-2">
          <p className="text-xs text-slate-300">Il file <b>non ha la riga di intestazione</b>: indica cosa c'è in ogni colonna. L'ipotesi viene dai contenuti (testo = cognome e nome, numeri = quantità e importo).</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: nCol }).map((_, j) => {
            const es = righe.map(r => r[j] ?? '').find(x => x.trim() !== '')
            return (
              <Campo key={j} label={`Colonna ${String.fromCharCode(65 + j)} · es. «${(es ?? '').slice(0, 14)}»`}><select className={inputCls + ' py-1.5 text-sm'} value={posEff[j] ?? ''} onChange={e => { const n = [...posEff]; n[j] = e.target.value; setPos(n) }}>{ruoliPos(db, ini).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Campo>)
          })}</div>
        </div>}
        {mancanti.length > 0 && <p className="text-xs text-amber-400">Colonne non trovate nel file (quantità 0): {mancanti.join(' · ')}.{!senza && " L'intestazione deve essere «Tipologia - Prodotto», es. «LECCINO - ALU DA 5 LT»."}</p>}
        {cImp >= 0 && <div className="flex flex-col gap-1.5"><p className="text-xs text-slate-400">La colonna dell'importo serve da <b>controllo</b>: il totale si calcola da quantità × prezzo. Se nel file l'importo è più basso, la differenza è uno sconto.</p>
          {nAvvisi > 0 && <Interruttore on={diffSconto} onChange={setDiffSconto} label="Registra le differenze in meno come sconto personale (€)" />}</div>}
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500"><th className="px-3 py-2 font-semibold">Nel file</th>{colProd.map(([p]) => <th key={p.id} className="px-3 py-2 font-semibold text-right normal-case tracking-normal">{prodLabel(db, p)}</th>)}<th className="px-3 py-2 font-semibold text-right">Totale</th>{cImp >= 0 && <th className="px-3 py-2 font-semibold text-right">Nel file €</th>}<th className="px-3 py-2 font-semibold">Persona</th></tr></thead>
          <tbody className="divide-y divide-slate-800/70">{esiti.map(e => (
            <tr key={e.i} className={e.errori.length ? 'bg-red-950/20' : e.avviso ? 'bg-amber-950/10' : ''}>
              <td className="px-3 py-2 text-xs text-slate-300 whitespace-nowrap">{e.nomeFile}{e.pagato && <span className="ml-2"><Pill tono="ok">pagato</Pill></span>}</td>
              {colProd.map(([p]) => <td key={p.id} className="px-3 py-2 text-right tabular-nums text-slate-200">{e.q[p.id] != null ? fmtQ(e.q[p.id]!) : <span className="text-slate-600">0</span>}</td>)}
              <td className="px-3 py-2 text-right tabular-nums text-white whitespace-nowrap">{fmtEuro(e.calc)}</td>
              {cImp >= 0 && <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${e.avviso ? 'text-amber-400' : 'text-slate-500'}`} title={e.avviso}>{e.impFile !== null ? fmtEuro(e.impFile) : '—'}{e.avviso && ' ≠'}</td>}
              <td className="px-3 py-2">{e.errori.length ? <span className="text-xs text-red-300">{e.errori.join(' · ')}</span> : e.socio ? <span className="text-sm text-slate-100 whitespace-nowrap">{nominativo(e.socio)} <Pill tono="ok">per {e.via}</Pill></span> :
                <div className="flex items-center gap-2"><Pill tono="warn">Non agganciata</Pill>
                  <select className={inputCls + ' py-1 text-xs'} value={manuali[e.i] ?? ''} onChange={ev => setManuali({ ...manuali, [e.i]: ev.target.value })}><option value="">Assegna a…</option>{ordinaNomi(dest).map(s => <option key={s.id} value={s.id}>{nominativo(s)}</option>)}</select></div>}</td>
            </tr>))}</tbody>
        </table></div></div>}
    </Modale>
  )
}

// ── T4 · partecipanti singoli ─────────────────────────────────
const EMAIL_OK = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[A-Za-z]{2,}$/
export function PartecipantiImportModal({ ini, onClose }: { ini: Iniziativa; onClose: () => void }) {
  const { db, esegui } = useCral()
  const { righe, apri, leggo } = useFoglio()
  const [scelte, setScelte] = useState<Record<number, string>>({})
  const pool = useMemo(() => db.soci.filter(s => s.stato === 'ATTIVO' || s.stato === 'DA_VALIDARE'), [db])
  const gia = new Set(ini.partecipanti)
  const esiti = useMemo(() => {
    if (!righe) return []
    const h = righe[0] ?? []; const ci = (re: RegExp) => h.findIndex(x => re.test(x))
    const cId = ci(/matricola|^id|tessera/i), cEmail = ci(/mail/i), cNom = ci(/nominativo|cognome/i)
    return righe.slice(1).map((r, i) => {
      const nom = cNom >= 0 ? (r[cNom] ?? '').trim() : '', email = cEmail >= 0 ? (r[cEmail] ?? '').trim() : ''
      const [p, via] = agganciaPersona(pool, cId >= 0 ? (r[cId] ?? '').trim() : '', email, nom)
      return { i, nom, email, p, via }
    }).filter(e => e.nom || e.email || e.p)
  }, [righe, pool])
  const azione = (e: (typeof esiti)[number]) => scelte[e.i] ?? (e.p ? (gia.has(e.p.id) ? 'gia' : 'aggiungi') : e.nom ? 'esterno' : 'ignora')
  const n = (k: string) => esiti.filter(e => azione(e) === k).length
  async function applica() {
    const ids = new Set<string>(); const nuovi: Array<{ cognome: string; nome: string; email: string }> = []
    for (const e of esiti) {
      const a = azione(e)
      if (a === 'aggiungi' && e.p) ids.add(e.p.id)
      else if (a.startsWith('id:')) ids.add(a.slice(3))
      else if (a === 'esterno') { const [cognome, nome] = spezzaNominativo(e.nom); nuovi.push({ cognome: cognome || e.nom.toUpperCase(), nome, email: EMAIL_OK.test(e.email) ? e.email : '' }) }
    }
    const r = await esegui(async () => {
      if (ids.size) await cralApi.partecipanti(ini.id, [...ids])
      for (const x of nuovi) await cralApi.creaPersona({ tipo: 'EST', ...x, perIniziativa: ini.id })
      return ids.size
    }, k => `${k} partecipanti aggiunti${nuovi.length ? `, ${nuovi.length === 1 ? '1 nuovo esterno' : `${nuovi.length} nuovi esterni`} da validare` : ''}`)
    if (r !== null) onClose()
  }
  return (
    <Modale largo titolo="Importa partecipanti" sotto="Una riga per persona: matricola o ID, email, nominativo (tracciato T4)." onClose={onClose}
      piedi={righe && <><span className="text-sm text-slate-400 mr-auto self-center">{n('aggiungi')} da aggiungere · {n('gia')} già presenti · {n('esterno')} nuovi esterni</span><button className={btnSecondario} onClick={onClose}>Annulla</button><button className={btnPrimario} onClick={() => void applica()}>Aggiungi all'evento</button></>}>
      {!righe ? <SceltaFile apri={apri} leggo={leggo} spiega="Chi non si aggancia diventa un nuovo esterno da validare, oppure lo assegni a mano." /> :
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500"><th className="px-3 py-2 font-semibold">Nel file</th><th className="px-3 py-2 font-semibold">Persona</th><th className="px-3 py-2 font-semibold">Cosa succede</th></tr></thead>
          <tbody className="divide-y divide-slate-800/70">{esiti.map(e => (
            <tr key={e.i}>
              <td className="px-3 py-2 text-xs text-slate-300">{e.nom || e.email || '—'}</td>
              <td className="px-3 py-2">{e.p ? <span className="inline-flex items-center gap-2 flex-wrap text-slate-100">{nominativo(e.p)} <Origine s={e.p} /><span className="text-[11px] text-slate-500">per {e.via}</span></span> : <Pill tono="warn">Non agganciata</Pill>}</td>
              <td className="px-3 py-2"><select className={inputCls + ' py-1 text-xs'} value={azione(e)} onChange={ev => setScelte({ ...scelte, [e.i]: ev.target.value })}>
                {e.p && <option value={gia.has(e.p.id) ? 'gia' : 'aggiungi'}>{gia.has(e.p.id) ? 'Già partecipante' : 'Aggiungi'}</option>}
                {!e.p && e.nom && <option value="esterno">Crea nuovo esterno (da validare)</option>}
                {!e.p && ordinaNomi(pool).map(s => <option key={s.id} value={`id:${s.id}`}>Assegna a {nominativo(s)} ({TIPOLOGIE[s.tipo][0]})</option>)}
                <option value="ignora">Ignora</option></select></td>
            </tr>))}</tbody>
        </table></div>}
    </Modale>
  )
}
