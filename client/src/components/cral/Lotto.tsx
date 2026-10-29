// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · lotto di variazioni da validare
//
// Lo stesso per l'aggiornamento massivo (T6) e per l'archivio di un altro
// ambiente: per ogni record nuovo, modificato o in conflitto si vede
// «qui → in arrivo», si accetta o si scarta (una modifica anche un campo
// alla volta) e poi si applica. Le variazioni delicate (cambi di stato,
// nuovi ID, avvisi) non entrano in «accetta tutte»: si confermano una per
// una. Le bloccate non si possono accettare.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { cralApi } from '../../api/endpoints'
import type { Db, Lotto, SezioneLotto, Variazione } from './tipi'
import { MESI, MODI_QUOTA, STATI, TIPOLOGIE, fmtData, fmtEuro, nomeDi, sedeNome } from './logica'
import {
  Conferma, D, Ico, Pill, avviso, btnPiccolo, btnPiccoloSec, btnPrimario, btnSecondario, cardCls, chipCls, etichettaCls,
  messaggioErrore, useCral, type Tono,
} from './ui'

export const NOMI_SEZIONI: Record<SezioneLotto, string> = { sedi: 'Sedi', tabelle: 'Parametri e tabelle', soci: 'Soci e familiari', quote: 'Quote associative', eventi: 'Eventi' }
const TIPI: Record<Variazione['tipo'], [string, Tono]> = { NUOVO: ['Nuovo', 'nuovo'], MODIFICA: ['Modificato', 'cyan'], CONFLITTO: ['Conflitto', 'err'] }
const ESITI: Record<Variazione['esito'], [string, Tono]> = {
  ATTESA: ['Da decidere', 'warn'], ACCETTATA: ['Accettata', 'ok'], SCARTATA: ['Scartata', 'neutro'], APPLICATA: ['Applicata', 'ok'], ERRORE: ['Errore', 'err'],
}
const PASSO = 200

/** Un valore del lotto in italiano: stato, sede, mesi, date, importi… */
export function fmtValore(db: Db, campo: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (campo === 'stato' || campo === 'azioneStato') {
    const o = v as { stato?: string; azione?: string | null; data?: string; cessatoIl?: string | null; eliminatoIl?: string | null }
    if (o.azione !== undefined) {
      return o.azione === 'cessa' ? `Cessato dal ${fmtData(o.data)}` : o.azione === 'elimina' ? `Eliminato dal ${fmtData(o.data)}`
        : o.azione === 'ripristina' ? 'Ripristinato (stato di prima)' : o.azione === 'riattiva' ? 'Attivo' : STATI[o.stato as keyof typeof STATI] ?? String(o.stato)
    }
    const st = STATI[o.stato as keyof typeof STATI] ?? String(o.stato ?? '—')
    return o.stato === 'CESSATO' ? `${st} il ${fmtData(o.cessatoIl)}` : o.stato === 'ELIMINATO' ? `${st} il ${fmtData(o.eliminatoIl)}` : st
  }
  if (campo === 'sede') return sedeNome(db, String(v))
  if (campo === 'tipo' && typeof v === 'string' && v in TIPOLOGIE) return TIPOLOGIE[v as keyof typeof TIPOLOGIE][0]
  if (campo === 'modo' && typeof v === 'string' && v in MODI_QUOTA) return MODI_QUOTA[v as keyof typeof MODI_QUOTA]
  if (campo === 'mesi' && Array.isArray(v)) { const m = (v as boolean[]).flatMap((x, k) => (x ? [MESI[k]] : [])); return m.length ? m.join(' ') : 'nessuno' }
  if (campo === 'importo') return fmtEuro(Number(v))
  if (campo === 'quota') return fmtEuro(Number(v))
  if (campo === 'legami' && Array.isArray(v)) return (v as Array<{ socio: string }>).map(l => nomeDi(db, l.socio)).join(', ')
  if (campo === 'storicoTessere' && Array.isArray(v)) return (v as Array<{ tessera: string }>).map(t => t.tessera).join(', ')
  if (typeof v === 'boolean') return v ? 'Sì' : 'No'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtData(v)
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—'
  return String(v)
}

/** Campi accettabili di una variazione (non bloccati). */
const liberi = (v: Variazione) => v.campi.filter(c => !c.blocco).map(c => c.campo)
const accettabile = (v: Variazione) => !v.bloccata && (v.tipo !== 'MODIFICA' || liberi(v).length > 0)

export function LottoView({ id, onChiuso }: { id: string; onChiuso?: () => void }) {
  const { db, ricarica } = useCral()
  const [dati, setDati] = useState<{ lotto: Lotto; variazioni: Variazione[] } | null>(null)
  const [sez, setSez] = useState<SezioneLotto | null>(null)
  const [filtro, setFiltro] = useState<string>('')
  const [quanti, setQuanti] = useState(PASSO)
  const [occupato, setOccupato] = useState(false)
  const [scarta, setScarta] = useState(false)
  const carica = useCallback(async () => {
    try { setDati(await cralApi.lotto(id)) } catch (e) { avviso(messaggioErrore(e), 'error') }
  }, [id])
  useEffect(() => { void carica() }, [carica])

  const vs = useMemo(() => dati?.variazioni ?? [], [dati])
  const sezioni = useMemo(() => (Object.keys(NOMI_SEZIONI) as SezioneLotto[]).filter(s => vs.some(v => v.sezione === s)), [vs])
  const corrente = sez && sezioni.includes(sez) ? sez : sezioni[0] ?? null
  if (!dati) return <div className={`${cardCls} p-5 text-sm text-slate-400`}>Caricamento del lotto…</div>
  const { lotto } = dati
  const aperto = lotto.stato === 'APERTO'
  const diSez = vs.filter(v => v.sezione === corrente)
  const FILTRI: Array<[string, string, (v: Variazione) => boolean]> = [
    ['', 'Tutte', () => true], ['ATTESA', 'Da decidere', v => v.esito === 'ATTESA'], ['ACCETTATA', 'Accettate', v => v.esito === 'ACCETTATA'],
    ['SCARTATA', 'Scartate', v => v.esito === 'SCARTATA'], ['APPLICATA', 'Applicate', v => v.esito === 'APPLICATA'], ['ERRORE', 'In errore', v => v.esito === 'ERRORE'],
    ['delicate', 'Da guardare una per una', v => v.delicata && !v.bloccata], ['bloccate', 'Bloccate', v => !!v.bloccata],
    ['NUOVO', 'Nuovi', v => v.tipo === 'NUOVO'], ['MODIFICA', 'Modificati', v => v.tipo === 'MODIFICA'], ['CONFLITTO', 'Conflitti', v => v.tipo === 'CONFLITTO'],
  ]
  const f = FILTRI.find(x => x[0] === filtro) ?? FILTRI[0]!
  const visibili = diSez.filter(f[2])
  const accettate = vs.filter(v => v.esito === 'ACCETTATA').length
  const attesa = vs.filter(v => v.esito === 'ATTESA').length

  /** Decisione su una variazione: subito a video, poi sul server. */
  async function decidi(v: Variazione, esito: 'ACCETTATA' | 'SCARTATA' | 'ATTESA', campi?: string[]) {
    const acc = esito !== 'ACCETTATA' ? [] : v.tipo !== 'MODIFICA' ? ['*'] : (campi ?? liberi(v)).filter(c => liberi(v).includes(c))
    const finale = esito === 'ACCETTATA' && v.tipo === 'MODIFICA' && !acc.length ? 'ATTESA' : esito
    setDati(d => d && ({ ...d, variazioni: d.variazioni.map(x => x.id === v.id ? { ...x, esito: finale, accettati: acc, nota: '' } : x) }))
    try { await cralApi.decidi(id, { voci: [{ id: v.id, esito: finale, ...(finale === 'ACCETTATA' ? { accettati: acc } : {}) }] }) }
    catch (e) { avviso(messaggioErrore(e), 'error'); void carica() }
  }
  async function inBlocco(azione: 'accettaTutte' | 'scartaTutte' | 'azzera') {
    if (!corrente) return
    setOccupato(true)
    try {
      const r = await cralApi.decidi(id, { sezione: corrente, azione })
      await carica()
      avviso(azione === 'accettaTutte' ? `${r.fatte} variazioni accettate${diSez.some(v => v.esito === 'ATTESA' && v.delicata) ? ' · le delicate restano da guardare una per una' : ''}` : `${r.fatte} variazioni aggiornate`, 'info')
    } catch (e) { avviso(messaggioErrore(e), 'error') }
    setOccupato(false)
  }
  async function applica() {
    setOccupato(true)
    try {
      const { esito } = await cralApi.applicaLotto(id)
      await Promise.all([carica(), ricarica()])
      avviso(`Applicate ${esito.applicate} variazioni${esito.errori ? ` · ${esito.errori} in errore (vedi «In errore»)` : ''}${esito.campiSaltati ? ` · ${esito.campiSaltati} campi saltati` : ''}${esito.chiuso ? ' · lotto chiuso' : ''}`, esito.errori ? 'warning' : 'success')
      if (esito.chiuso) onChiuso?.()
    } catch (e) { avviso(messaggioErrore(e), 'error') }
    setOccupato(false)
  }

  const esiti = (lotto.riepilogo['esiti'] ?? {}) as Record<string, Record<string, number>>
  return (
    <div className="flex flex-col gap-4">
      <div className={`${cardCls} p-5 flex flex-wrap gap-4 items-start`}>
        <div className="w-10 h-10 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center shrink-0"><Ico d={D.doc} cls="w-5 h-5" /></div>
        <div className="flex-1 min-w-[240px]">
          <p className="text-white font-medium">{lotto.origine === 'T6' ? 'Aggiornamento dati (T6)' : `Archivio da «${lotto.ambiente}»`} · <span className="font-mono text-sm text-slate-300">{lotto.file}</span></p>
          <p className="text-xs text-slate-500 mt-0.5">
            Caricato il {fmtData(lotto.creatoIl)}{lotto.creatoDa ? ` da ${lotto.creatoDa}` : ''}{lotto.esportato ? ` · esportato il ${fmtData(lotto.esportato)}` : ''}
            {lotto.stato !== 'APERTO' && ` · ${lotto.stato === 'CHIUSO' ? 'chiuso' : 'scartato'} il ${fmtData(lotto.chiusoIl)}${lotto.chiusoDa ? ` da ${lotto.chiusoDa}` : ''}`}</p>
          {lotto.riepilogo['stessoAmbiente'] === true && <p className="text-xs text-amber-400 mt-1">L'archivio viene da questo stesso ambiente: le differenze sono le modifiche fatte dopo l'export.</p>}
        </div>
        {aperto && <div className="flex flex-wrap gap-2">
          <button className={btnSecondario} disabled={occupato} onClick={() => setScarta(true)}>Scarta il lotto</button>
          <button className={btnPrimario} disabled={occupato || !accettate} onClick={() => void applica()}><Ico d={D.check} />Applica le accettate ({accettate})</button>
        </div>}
      </div>

      {!aperto && <div className={`${cardCls} p-5 text-sm text-slate-300`}>
        <p>Lotto {lotto.stato === 'CHIUSO' ? 'applicato e chiuso' : 'scartato'}. I dati copiati nel lotto sono stati cancellati: restano i conteggi.</p>
        <ul className="mt-2 text-xs text-slate-400 space-y-0.5">{Object.entries(esiti).map(([s, e]) => <li key={s}>{NOMI_SEZIONI[s as SezioneLotto] ?? s}: {Object.entries(e).map(([k, n]) => `${n} ${(ESITI[k as Variazione['esito']]?.[0] ?? k).toLowerCase()}`).join(', ')}</li>)}</ul>
      </div>}

      {aperto && vs.length > 0 && <>
        <div className="flex flex-wrap gap-1 border-b border-slate-800">
          {sezioni.map(s => {
            const n = vs.filter(v => v.sezione === s), da = n.filter(v => v.esito === 'ATTESA').length
            return <button key={s} onClick={() => { setSez(s); setFiltro(''); setQuanti(PASSO) }} className={`whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px ${s === corrente ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
              {NOMI_SEZIONI[s]} <span className="text-xs text-slate-500">{n.length}</span>{da > 0 && <span className="ml-1.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-900/50 text-amber-400 border border-amber-800">{da}</span>}</button>
          })}
        </div>
        <div className={`${cardCls} overflow-hidden`}>
          <div className="px-5 py-3 border-b border-slate-800 flex flex-wrap gap-2 items-center">
            {FILTRI.map(([k, l, fn]) => { const n = diSez.filter(fn).length; return (n > 0 || k === '') ? <button key={k} className={chipCls(filtro === k)} onClick={() => { setFiltro(k); setQuanti(PASSO) }}>{l} <span className="text-slate-500">{n}</span></button> : null })}
            <span className="flex-1" />
            <button className={btnPiccolo + ' bg-emerald-700/80 hover:bg-emerald-600 text-white'} disabled={occupato} onClick={() => void inBlocco('accettaTutte')} title="Tranne le delicate (stati, nuovi ID, avvisi) e le bloccate"><Ico d={D.check} cls="w-3.5 h-3.5" />Accetta tutte</button>
            <button className={btnPiccoloSec} disabled={occupato} onClick={() => void inBlocco('scartaTutte')}>Scarta tutte</button>
            <button className={btnPiccoloSec} disabled={occupato} onClick={() => void inBlocco('azzera')}>Rimetti da decidere</button>
          </div>
          <div className="divide-y divide-slate-800/70">
            {visibili.slice(0, quanti).map(v => <RigaVariazione key={v.id} db={db} v={v} onDecidi={(e, c) => void decidi(v, e, c)} />)}
            {!visibili.length && <p className="px-5 py-8 text-center text-sm text-slate-500">Nessuna variazione con questo filtro.</p>}
          </div>
          {visibili.length > quanti && <div className="px-5 py-3 border-t border-slate-800 text-center"><button className={btnPiccoloSec} onClick={() => setQuanti(q => q + PASSO)}>Mostra altre {Math.min(PASSO, visibili.length - quanti)} (di {visibili.length - quanti})</button></div>}
          <p className="px-5 py-3 border-t border-slate-800 text-xs text-slate-500">
            Nulla si cancella: un record che qui c'è e nel file no resta com'è, un valore vuoto non svuota. All'applicazione ogni variazione accettata si scrive solo se qui il valore è ancora quello mostrato in «Qui»; altrimenti quel campo si salta. {attesa > 0 ? `${attesa} variazioni ancora da decidere: il lotto resta aperto (anche da «Da validare») finché non sono tutte decise.` : 'Quando tutto è deciso e applicato il lotto si chiude e i dati copiati si cancellano.'}</p>
        </div>
      </>}
      {aperto && !vs.length && <div className={`${cardCls} p-5 text-sm text-slate-400`}>Nessuna differenza: qui è già tutto come nel file.</div>}
      {scarta && <Conferma testo="Scartare il lotto?" etichetta="Scarta il lotto" pericolo onClose={() => setScarta(false)}
        dettaglio={`Nessuna delle variazioni ancora da applicare viene scritta${vs.some(v => v.esito === 'APPLICATA') ? ' (quelle già applicate restano)' : ''}. I dati copiati nel lotto si cancellano.`}
        onOk={() => { void cralApi.scartaLotto(id).then(async () => { await Promise.all([carica(), ricarica()]); avviso('Lotto scartato', 'info'); onChiuso?.() }).catch(e => avviso(messaggioErrore(e), 'error')) }} />}
    </div>
  )
}

function RigaVariazione({ db, v, onDecidi }: { db: Db; v: Variazione; onDecidi: (esito: 'ACCETTATA' | 'SCARTATA' | 'ATTESA', campi?: string[]) => void }) {
  const [tl, tt] = TIPI[v.tipo]
  const [el, et] = ESITI[v.esito]
  const fatto = v.esito === 'APPLICATA'
  const modifica = v.tipo === 'MODIFICA'
  const ok = accettabile(v)
  const scelti = new Set(v.esito === 'ACCETTATA' ? v.accettati : [])
  const toggle = (campo: string) => {
    const n = new Set(v.esito === 'ACCETTATA' ? v.accettati : [])
    if (n.has(campo)) n.delete(campo); else n.add(campo)
    onDecidi(n.size ? 'ACCETTATA' : 'ATTESA', [...n])
  }
  return (
    <div className={`px-5 py-3 flex flex-col gap-2 ${v.esito === 'SCARTATA' ? 'opacity-60' : ''} ${v.bloccata ? 'bg-red-950/10' : v.delicata && v.esito === 'ATTESA' ? 'bg-amber-950/10' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-100 font-medium">{v.etichetta}</span>
        <span className="font-mono text-[11px] text-slate-500">{v.chiave.replace('|', ' · ')}</span>
        <Pill tono={tt}>{tl}</Pill>
        {v.delicata && !v.bloccata && <Pill tono="warn" title="Non entra in «Accetta tutte»: si conferma una per una">una per una</Pill>}
        {v.bloccata && <Pill tono="err">bloccata</Pill>}
        <span className="flex-1" />
        <Pill tono={et}>{el}</Pill>
        {!fatto && <div className="flex gap-1.5">
          <button className={btnPiccolo + ' bg-emerald-700/80 hover:bg-emerald-600 text-white'} disabled={!ok} title={!ok ? 'Non si può accettare' : undefined} onClick={() => onDecidi('ACCETTATA')}><Ico d={D.check} cls="w-3.5 h-3.5" />{modifica ? 'Accetta tutto' : 'Accetta'}</button>
          <button className={btnPiccoloSec} onClick={() => onDecidi('SCARTATA')}>Scarta</button>
          {v.esito !== 'ATTESA' && <button className="text-xs text-slate-500 hover:text-slate-300 px-1" onClick={() => onDecidi('ATTESA')}>annulla</button>}
        </div>}
      </div>
      {v.bloccata && <p className="text-xs text-red-300">{v.bloccata}</p>}
      {v.avviso && <p className="text-xs text-amber-300">{v.avviso}</p>}
      {v.campi.length > 0 && <div className="overflow-x-auto"><table className="text-xs">
        <thead><tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
          {modifica && !fatto && <th className="pr-2 py-1 font-semibold w-6" />}<th className="pr-4 py-1 font-semibold">Campo</th>{!(v.tipo === 'NUOVO') && <th className="pr-4 py-1 font-semibold">Qui</th>}<th className="pr-4 py-1 font-semibold">{v.tipo === 'NUOVO' ? 'Valore' : 'In arrivo'}</th><th className="py-1" />
        </tr></thead>
        <tbody>{v.campi.map(c => (
          <tr key={c.campo} className="align-top">
            {modifica && !fatto && <td className="pr-2 py-0.5"><input type="checkbox" className="accent-emerald-500" disabled={!!c.blocco || !!v.bloccata} checked={scelti.has(c.campo)} onChange={() => toggle(c.campo)} aria-label={`Accetta ${c.etichetta}`} /></td>}
            <td className="pr-4 py-0.5 text-slate-400 whitespace-nowrap">{c.etichetta}</td>
            {v.tipo !== 'NUOVO' && <td className="pr-4 py-0.5 text-slate-500 max-w-[280px]">{fmtValore(db, c.campo, c.prima)}</td>}
            <td className={`pr-4 py-0.5 max-w-[320px] ${c.blocco ? 'text-slate-500 line-through' : 'text-slate-100'}`}>{fmtValore(db, c.campo, c.dopo)}</td>
            <td className="py-0.5 text-red-300/90">{c.blocco ?? ''}</td>
          </tr>))}</tbody>
      </table></div>}
      {v.nota && <p className={`text-xs ${v.esito === 'ERRORE' ? 'text-red-300' : 'text-slate-400'}`}>{v.nota}</p>}
    </div>
  )
}

/** Elenco dei lotti (aperti in evidenza, chiusi in fondo): per la scheda «Da validare». */
export function ElencoLotti() {
  const { lotti } = useCral()
  const [aperto, setAperto] = useState<string | null>(null)
  const aperti = lotti.filter(l => l.stato === 'APERTO')
  const chiusi = lotti.filter(l => l.stato !== 'APERTO').slice(0, 10)
  if (!lotti.length) return null
  const riga = (l: Lotto) => {
    const c = l.conteggi ?? {}
    return (
      <button key={l.id} onClick={() => setAperto(aperto === l.id ? null : l.id)} className={`w-full text-left px-5 py-3 hover:bg-slate-800/40 flex flex-wrap items-center gap-3 ${aperto === l.id ? 'bg-slate-800/40' : ''}`}>
        <Pill tono={l.origine === 'T6' ? 'cyan' : 'nuovo'}>{l.origine === 'T6' ? 'T6' : 'Archivio'}</Pill>
        <span className="text-sm text-slate-100 flex-1 min-w-[200px]">{l.origine === 'T6' ? 'Aggiornamento dati' : `Da «${l.ambiente}»`} · <span className="font-mono text-xs text-slate-400">{l.file}</span></span>
        <span className="text-xs text-slate-500 tabular-nums">{fmtData(l.creatoIl)}{l.creatoDa ? ` · ${l.creatoDa}` : ''}</span>
        {l.stato === 'APERTO'
          ? <span className="text-xs text-slate-400">{c['ATTESA'] ? <span className="text-amber-400">{c['ATTESA']} da decidere</span> : 'tutto deciso'}{c['ACCETTATA'] ? ` · ${c['ACCETTATA']} da applicare` : ''}{c['ERRORE'] ? <span className="text-red-300"> · {c['ERRORE']} in errore</span> : ''}</span>
          : <Pill>{l.stato === 'CHIUSO' ? 'chiuso' : 'scartato'}</Pill>}
        <span className="text-xs text-indigo-400">{aperto === l.id ? 'chiudi' : 'apri'}</span>
      </button>)
  }
  return (
    <section className={`${cardCls} overflow-hidden`}>
      <div className="px-5 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2"><h3 className="text-white font-semibold">Lotti di variazioni da validare</h3><span className="text-xs text-slate-500 tabular-nums">{aperti.length}</span></div>
        <p className="text-xs text-slate-400 mt-1 max-w-[80ch]">Arrivano dall'aggiornamento massivo (T6) e dagli archivi esportati da un altro ambiente (Importazione). Nulla si scrive finché non accetti e applichi. Si può validare una parte, chiudere e riprendere più tardi.</p>
      </div>
      <div className="divide-y divide-slate-800/70">
        {aperti.map(riga)}
        {!aperti.length && <p className="px-5 py-3 text-sm text-slate-500">Nessun lotto aperto.</p>}
        {chiusi.length > 0 && <details className="px-5 py-2 text-sm"><summary className={`${etichettaCls} cursor-pointer select-none py-1`}>Chiusi di recente ({chiusi.length})</summary><div className="divide-y divide-slate-800/70 -mx-5">{chiusi.map(riga)}</div></details>}
      </div>
      {aperto && <div className="border-t border-slate-800 p-4 bg-slate-950/30"><LottoView key={aperto} id={aperto} /></div>}
    </section>
  )
}

