// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · quote versate (tracciato T7)
//
// Due forme dello stesso file, riconosciute dalle intestazioni:
//   · una riga per socio: colonne Gen … Dic, Unica, Pagata il (è la forma
//     di «Quote associative › Esporta Excel»);
//   · una riga per versamento: Mese (1–12 o UNICA), Importo, Data (è la
//     forma degli elenchi delle trattenute, e domani di CINECA).
// Si registra l'importo versato: se copre la rata il mese è pagato, se un
// versamento copre la quota dell'anno è pagato tutto l'anno. Le rate già
// pagate non si tolgono da file (decisione del 29/10): solo a mano.
// ============================================================

import { useMemo, useRef, useState } from 'react'
import { cralApi, type CralRigaT7 } from '../../api/endpoints'
import type { Persona, QuotaSocio } from './tipi'
import { MESI, fmtData, leggiData, nominativo, norm, oggi, parseEuro, trovaIntestazione } from './logica'
import { LottoView } from './Lotto'
import { aggancia } from './ImportDati'
import {
  Campo, D, Ico, Origine, Pill, avviso, btnPiccolo, btnPiccoloSec, btnPrimario, cardCls, etichettaCls, fileBase64, inputCls, inputW,
  messaggioErrore, thCls, useCral,
} from './ui'

const pulisci = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
const MESI_RE = [/^gen(naio)?$/i, /^feb(braio)?$/i, /^mar(zo)?$/i, /^apr(ile)?$/i, /^mag(gio)?$/i, /^giu(gno)?$/i, /^lug(lio)?$/i, /^ago(sto)?$/i, /^set(tembre)?$/i, /^ott(obre)?$/i, /^nov(embre)?$/i, /^dic(embre)?$/i]
const RUOLI: Array<[string, string, RegExp]> = [
  ['id', 'ID (matricola, EXT-)', /^(id|id socio|matricola)$/i],
  ['tesseraKey', 'Tessera', /^tessera/i],
  ['nominativo', 'Nominativo', /^(nominativo|cognome\s*e?\s*nome)$/i],
  ['cognome', 'Cognome', /^cognome$/i],
  ['nome', 'Nome', /^nome$/i],
  ['nascita', 'Data di nascita', /nasc/i],
  ['anno', 'Anno', /^anno$/i],
  ['modo', 'Modalità', /^modalit/i],
  ['mese', 'Mese (una riga per versamento)', /^mese$/i],
  ['importo', 'Importo', /^importo/i],
  ['data', 'Data versamento', /^data\s*(versamento|pagamento)?$/i],
  ['unica', 'Unica soluzione', /^unica/i],
  ['pagataIl', 'Pagata il', /^pagat/i],
  ['note', 'Note', /^note$/i],
]
const ruoliMesi = MESI.map((m, k) => [`m${k + 1}`, m, MESI_RE[k]!] as [string, string, RegExp])

/** «X», «SI», «✓» = la rata (o la quota per l'unica); un numero = euro versati. */
function importoDa(t: string): number | 'X' | 'TOGLI' | 'ERR' | null {
  const x = norm(t)
  if (!x) return null
  if (x === '-') return 'TOGLI'
  if (['X', 'SI', 'S', 'OK', 'PAGATO', 'PAGATA'].includes(x) || t.trim() === '✓') return 'X'
  const c = parseEuro(t)
  return c === null ? 'ERR' : c === 0 ? null : c
}
function modoDa(t: string): QuotaSocio['modo'] | undefined {
  const x = norm(t)
  return /UNIC/.test(x) ? 'UNICA' : /MENS/.test(x) ? 'MENSILE' : /TRATT|BUSTA/.test(x) ? 'TRATTENUTA' : undefined
}

interface Letta { i: number; riga: number; chiave: string; socio: Persona | null; come: string; candidati: Persona[]; dati: Omit<CralRigaT7, 'socio' | 'riga'> | null; errori: string[]; note: string[] }

export function ImportT7() {
  const { db, ricarica } = useCral()
  const anni = db.quoteAnno.map(a => a.anno).sort((a, b) => b - a)
  const [anno, setAnno] = useState(anni.includes(+oggi().slice(0, 4)) ? +oggi().slice(0, 4) : anni[0] ?? +oggi().slice(0, 4))
  const [file, setFile] = useState<{ nome: string; fogli: Record<string, string[][]> } | null>(null)
  const [foglio, setFoglio] = useState('')
  const [map, setMap] = useState<Record<string, string>>({})
  const [scelte, setScelte] = useState<Record<number, string | null>>({})
  const [cerca, setCerca] = useState<Record<number, string>>({})
  const [lettura, setLettura] = useState(false)
  const [invio, setInvio] = useState(false)
  const [lotto, setLotto] = useState<string | null>(null)
  const inp = useRef<HTMLInputElement>(null)

  function scegliFoglio(f: { fogli: Record<string, string[][]> }, nome: string) {
    const righe = f.fogli[nome] ?? []
    const intest = righe[trovaIntestazione(righe)] ?? []
    const m: Record<string, string> = {}
    for (const [k, , re] of [...RUOLI, ...ruoliMesi]) { const idx = intest.findIndex(x => re.test(x.trim())); m[k] = idx >= 0 ? String(idx) : '' }
    if (m['nominativo'] !== '') { m['cognome'] = ''; m['nome'] = '' }
    setFoglio(nome); setMap(m); setScelte({}); setLotto(null)
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
  const perVersamento = map['mese'] !== '' && map['mese'] !== undefined
  const conMesi = ruoliMesi.some(([k]) => map[k])
  const perTessera = useMemo(() => new Map(db.soci.filter(s => s.tessera).map(s => [norm(s.tessera), s])), [db])
  const pronto = (map['id'] !== '' || map['tesseraKey'] !== '' || map['nominativo'] !== '' || (map['cognome'] !== '' && map['nome'] !== '')) && (perVersamento || conMesi || map['unica'] !== '')

  const lette = useMemo<Letta[]>(() => !file || !pronto ? [] : rows.slice(hdr + 1).map((r, i) => {
    const val = (k: string) => { const c = map[k]; return c !== '' && c != null ? pulisci(String(r[+c] ?? '')) : '' }
    const errori: string[] = [], note: string[] = []
    const id = val('id'), tk = val('tesseraKey'), nomin = val('nominativo') || [val('cognome'), val('nome')].filter(Boolean).join(' ')
    const nascita = val('nascita') ? leggiData(val('nascita')) : null
    const { socio, come, candidati, errore } = aggancia(db, perTessera, id, tk, nomin, nascita)
    if (errore) errori.push(errore)
    const at = val('anno'), an = at ? parseInt(at, 10) : anno
    if (at && !(an >= 2000 && an <= 2100)) errori.push(`anno «${at}» non valido`)
    const d: Omit<CralRigaT7, 'socio' | 'riga'> = { anno: an }
    const mt = val('modo'); if (mt) { const m = modoDa(mt); if (m) d.modo = m; else errori.push(`modalità «${mt}» sconosciuta`) }
    const nt = val('note'); if (nt && nt !== '-') d.note = nt.slice(0, 300)
    const mesi: Record<string, number | 'X'> = {}
    const usaImporto = (testo: string, dove: string, fn: (v: number | 'X') => void) => {
      const v = importoDa(testo)
      if (v === 'TOGLI') note.push(`${dove}: le rate si tolgono solo a mano`)
      else if (v === 'ERR') errori.push(`${dove}: importo «${testo}» non valido`)
      else if (v !== null) fn(v)
    }
    if (perVersamento) {
      const ms = norm(val('mese')), it = val('importo'), dt = val('data')
      const data = dt ? leggiData(dt) : null
      if (dt && !data) errori.push(`data «${dt}» non valida`)
      if (/^UNIC/.test(ms) || ms === 'U') usaImporto(it || 'X', 'unica soluzione', v => { d.unica = { importo: v, ...(data ? { data } : {}) } })
      else if (/^\d{1,2}$/.test(ms) && +ms >= 1 && +ms <= 12) usaImporto(it || 'X', MESI[+ms - 1]!, v => { mesi[String(+ms)] = v })
      else { const k = MESI_RE.findIndex(re => re.test(ms.toLowerCase())); if (k >= 0) usaImporto(it || 'X', MESI[k]!, v => { mesi[String(k + 1)] = v }); else if (ms) errori.push(`mese «${val('mese')}» non valido`) }
    } else {
      for (const [k, m] of ruoliMesi) { const t = val(k); if (t) usaImporto(t, m, v => { mesi[k.slice(1)] = v }) }
      const ut = val('unica'), pt = val('pagataIl'), data = pt ? leggiData(pt) : null
      if (pt && !data) errori.push(`data «${pt}» non valida`)
      if (ut) usaImporto(ut, 'unica soluzione', v => { d.unica = { importo: v, ...(data ? { data } : {}) } })
      else if (data) d.unica = { importo: 'X', data }
    }
    if (Object.keys(mesi).length) d.mesi = mesi
    const vuota = !d.mesi && !d.unica && !d.modo && !d.note
    return { i, riga: hdr + i + 2, chiave: id || tk || nomin, socio, come, candidati, dati: vuota ? null : d, errori, note }
  }).filter(r => r.chiave), [file, pronto, rows, hdr, map, db, perTessera, anno, perVersamento])

  const finale = (r: Letta): Persona | null => { const s = scelte[r.i]; return s === undefined ? r.socio : s === null ? null : db.perId.get(s) ?? null }
  const agganciate = lette.filter(r => finale(r) && r.dati)
  const nonAgg = lette.filter(r => !finale(r) && scelte[r.i] !== null && r.dati)
  const daGuardare = lette.filter(r => (!finale(r) && scelte[r.i] !== null && r.dati) || r.errori.length || r.note.length)

  async function prepara() {
    if (!file) return
    setInvio(true)
    try {
      const righe: CralRigaT7[] = agganciate.map(r => ({ socio: finale(r)!.id, riga: r.riga, ...r.dati! }))
      const r = await cralApi.lottoT7(file.nome, righe)
      if (!r.id) avviso('Nessuna differenza: i versamenti del file sono già registrati.', 'info')
      else { await ricarica(); setLotto(r.id); avviso(`${r.variazioni} ${r.variazioni === 1 ? 'quota' : 'quote'} con variazioni da validare`, 'info') }
    } catch (e) { avviso(messaggioErrore(e), 'error') } finally { setInvio(false) }
  }

  if (!anni.length) return <div className={`${cardCls} p-6 text-sm text-slate-400`}>Nessun anno impostato: aggiungilo in Parametri › Quota associativa.</div>
  if (lotto) return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2"><button className={btnPiccoloSec} onClick={() => setLotto(null)}><Ico d={D.back} cls="w-3.5 h-3.5" />Torna al file</button><span className="text-xs text-slate-500">Il lotto resta anche in «Da validare».</span></div>
      <LottoView id={lotto} onChiuso={() => { setLotto(null); setFile(null) }} />
    </div>
  )
  return (
    <div className="flex flex-col gap-4">
      <div className={`${cardCls} p-5 flex flex-col gap-3`}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-32"><Campo label="Anno (se il file non lo dice)"><select className={inputCls} value={anno} onChange={e => setAnno(+e.target.value)}>{anni.map(a => <option key={a} value={a}>{a}</option>)}</select></Campo></div>
          <p className="text-xs text-slate-500 flex-1 min-w-[260px]">Il modo più semplice: «Quote associative › Esporta Excel», scrivi gli importi versati e ricarica qui. Va bene anche un elenco con una riga per versamento (Mese, Importo, Data), come quello delle trattenute.</p>
        </div>
        <div role="button" tabIndex={0} onClick={() => inp.current?.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inp.current?.click() }}
          onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void apri(f) }}
          className="flex flex-col sm:flex-row sm:items-center gap-4 border-2 border-dashed rounded-xl px-5 py-5 cursor-pointer border-slate-700 hover:border-indigo-500">
          <div className="w-10 h-10 rounded-lg bg-emerald-600/20 text-emerald-300 flex items-center justify-center shrink-0"><Ico d={D.upload} cls="w-5 h-5" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white">{lettura ? 'Lettura del file sul server…' : 'Trascina qui il file delle quote versate (.xlsx, .xls, .csv) o fai clic per sceglierlo'}</p>
            <p className="text-xs text-slate-500 mt-0.5">Importo che copre la rata = mese pagato; la quota dell'anno in un versamento = anno pagato; importo minore = registrato e da completare. Le rate già pagate non si tolgono da file. Niente si scrive finché non validi il lotto.</p>
          </div>
          <input ref={inp} type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) void apri(f); e.target.value = '' }} />
        </div>
      </div>
      {file && <div className={`${cardCls} p-5 flex flex-col gap-4`}>
        <div className="flex flex-wrap items-center gap-2"><Ico d={D.doc} cls="w-4 h-4 text-slate-400" /><span className="text-sm text-white font-medium">{file.nome}</span>
          <span className="text-xs text-slate-500">· {Math.max(0, rows.length - hdr - 1)} righe · {perVersamento ? 'una riga per versamento' : 'una riga per socio'}</span>
          <button className="ml-auto text-xs text-slate-400 hover:text-white" onClick={() => setFile(null)}>Chiudi file</button></div>
        {Object.keys(file.fogli).length > 1 && <div className="flex flex-wrap items-center gap-2"><span className={etichettaCls}>Foglio</span>{Object.keys(file.fogli).map(n => <button key={n} onClick={() => scegliFoglio(file, n)} className={`${btnPiccolo} border ${n === foglio ? 'bg-indigo-600/20 text-indigo-300 border-indigo-700' : 'bg-slate-800 text-slate-300 border-slate-700'}`}>{n}</button>)}</div>}
        <div>
          <p className={etichettaCls + ' mb-2'}>Colonne</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {RUOLI.filter(([k]) => perVersamento ? !['unica', 'pagataIl'].includes(k) : !['importo', 'data'].includes(k)).map(([k, l]) => (
              <Campo key={k} label={l}><select className={inputCls} value={map[k] ?? ''} onChange={e => setMap({ ...map, [k]: e.target.value })}><option value="">— Nessuna</option>{intest.map((h, i) => <option key={i} value={String(i)}>{h || `Colonna ${i + 1}`}</option>)}</select></Campo>))}
          </div>
          {!perVersamento && <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-12 gap-2 mt-3">
            {ruoliMesi.map(([k, l]) => <Campo key={k} label={l}><select className={inputW + ' w-full px-1 text-xs'} value={map[k] ?? ''} onChange={e => setMap({ ...map, [k]: e.target.value })}><option value="">—</option>{intest.map((h, i) => <option key={i} value={String(i)}>{h || `Col. ${i + 1}`}</option>)}</select></Campo>)}
          </div>}
          <p className="text-xs text-slate-500 mt-2">Importi in euro (5 · 5,00 · 4,50); «X» o «SI» = la rata intera (o la quota per l'unica soluzione); vuoto = non cambia. «Versato» e «Saldo» dell'export si ignorano. «-» non toglie nulla: le rate si tolgono solo a mano.</p>
          {!pronto && <p className="text-sm text-amber-400 mt-2">Indica la colonna per agganciare il socio (ID, tessera o nominativo) e quelle dei versamenti (mesi, unica, oppure Mese e Importo).</p>}
        </div>
      </div>}
      {file && pronto && <div className={`${cardCls} overflow-hidden`}>
        <div className="px-5 py-3 border-b border-slate-800 flex flex-wrap gap-3 items-center text-sm text-slate-300">
          <span><b className="text-white tabular-nums">{agganciate.length}</b> righe con versamenti agganciate</span>
          {nonAgg.length > 0 && <span className="text-amber-400">{nonAgg.length} non agganciate</span>}
          {lette.some(r => r.errori.length) && <span className="text-red-300">{lette.filter(r => r.errori.length).length} con celle scartate</span>}
          <span className="flex-1" />
          <button className={btnPrimario} disabled={invio || !agganciate.length} onClick={() => void prepara()}><Ico d={D.check} />Prepara le variazioni</button>
        </div>
        {daGuardare.length > 0 && <div className="overflow-x-auto max-h-[420px] overflow-y-auto"><table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-900 text-left text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-2 font-semibold">Riga</th><th className={thCls}>Nel file</th><th className={thCls}>Socio</th><th className="px-5 py-2 font-semibold">Note</th></tr></thead>
          <tbody className="divide-y divide-slate-800/70">
            {daGuardare.slice(0, 300).map(r => {
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
                  <td className="px-5 py-2 text-xs"><span className="text-red-300">{r.errori.join(' · ')}</span>{r.note.length > 0 && <span className="text-amber-300"> {r.note.join(' · ')}</span>}
                    {scelte[r.i] !== undefined && <button className="ml-2 text-slate-400 hover:text-white" onClick={() => setScelte(s => { const n = { ...s }; delete n[r.i]; return n })}>annulla scelta</button>}</td>
                </tr>)
            })}
          </tbody></table></div>}
        <p className="px-5 py-3 border-t border-slate-800 text-xs text-slate-500">«Prepara le variazioni» confronta con le quote registrate e crea un lotto: per ogni socio vedi i versamenti prima → dopo. Gli importi diversi dalla rata si confermano uno per uno; chi non deve la quota di quell'anno (esterni, familiari, eliminati, iscritti dopo) è bloccato.</p>
      </div>}
    </div>
  )
}
