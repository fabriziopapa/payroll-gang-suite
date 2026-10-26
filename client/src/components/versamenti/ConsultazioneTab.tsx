// ============================================================
// PAYROLL GANG SUITE — Versamenti enti · scheda Consultazione
//
// Enti a sinistra, persone e versamenti a destra: ricerca, due viste
// (per persona / per versamento), selezione, somme, esportazione dei
// soli selezionati in CSV o PDF (un file unico o uno per ente in uno ZIP)
// ed EML dei soli selezionati.
//
// PRIVACY. Lavora sulle righe gia' elaborate nel browser: nominativi,
// codici fiscali e importi non vanno al server. Prima di ogni download si
// registra nell'audit l'evento con i soli conteggi; se l'audit non si
// scrive, il file non si scarica.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { versamentiApi, type VersamentoEnteApi } from '../../api/endpoints'
import { showToast } from '../ToastManager'
import { aggregaEnti, type EnteAggregato, type RigaVersamento } from '../../utils/versamentiCsv'
import { COLDEF, nomeFile, pdfBytes } from '../../utils/versamentiAllegati'
import { fmtEuro, meseBreve, meseLabel, periodoBreve, periodoFile, type ModelloVersamento } from '../../utils/versamentiModelli'
import { scaricaFile } from '../../utils/versamentiEml'
import { zipStore, type VoceZip } from '../../utils/zipStore'
import {
  COLONNE_EXPORT, cfgExport, chiaviRicerca, csvSelezione, entiDelFile, filtra, opzioniExportDefault, ordinaPersone,
  ordinaRighe, perEnte, raggruppaPersone, riepilogo, somme,
  type ColonnaPersona, type ColonnaRiga, type OpzioniExport, type Ordine,
} from '../../utils/versamentiConsultazione'
import { Finestra } from './Modali'
import { IconaDownload, Pill, btnPiccolo, btnPrimario, btnSecondario, cardCls, inputCls, messaggioErrore } from './ui'

const PAG = 50
type Vista = 'persona' | 'riga'
type FiltroEnti = 'tutti' | 'abil' | 'mail' | 'senza'
type Esporta = 'csv' | 'pdf' | 'eml'
type Stato = 'si' | 'no' | 'parte'

const fmtData = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const chipCls = (on: boolean) =>
  `px-2.5 py-1 rounded-full text-xs font-medium border ${on ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`
const btnBarra = `${btnPiccolo} bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700`

function statoDi(idx: readonly number[], sel: ReadonlySet<number>): Stato {
  let n = 0
  for (const i of idx) if (sel.has(i)) n++
  return n === 0 ? 'no' : n === idx.length ? 'si' : 'parte'
}

function Spunta({ stato, onChange, label, id }: { stato: Stato; onChange: (on: boolean) => void; label: string; id?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = stato === 'parte' }, [stato])
  return (
    <input ref={ref} id={id} type="checkbox" checked={stato === 'si'} onChange={e => onChange(e.target.checked)} aria-label={label}
      className="accent-indigo-500 w-4 h-4 align-middle cursor-pointer" />
  )
}

export default function ConsultazioneTab({ file, righe, mesi, periodo, mesiSel, onMese, entiMap, modelloDi, modo, setModo, generando, onGeneraEml }: {
  file: string
  righe: RigaVersamento[]
  mesi: string[]
  /** Il «da … a …» di un file senza colonna del mese. */
  periodo: string[] | null
  mesiSel: ReadonlySet<string>
  onMese: (m: string) => void
  entiMap: ReadonlyMap<string, VersamentoEnteApi>
  modelloDi: (codice: string) => ModelloVersamento | null
  modo: 'unico' | 'mese'
  setModo: (m: 'unico' | 'mese') => void
  generando: boolean
  onGeneraEml: (lista: EnteAggregato[]) => Promise<void>
}) {
  const [entiSel, setEntiSel]       = useState<Set<string>>(new Set())
  const [entiCerca, setEntiCerca]   = useState('')
  const [entiFiltro, setEntiFiltro] = useState<FiltroEnti>('tutti')
  const [testo, setTesto]           = useState('')
  const [cercato, setCercato]       = useState('')
  const [voce, setVoce]             = useState('')
  const [vista, setVista]           = useState<Vista>('persona')
  const [ordP, setOrdP]             = useState<Ordine<ColonnaPersona>>({ k: 'nome', dir: 1 })
  const [ordR, setOrdR]             = useState<Ordine<ColonnaRiga>>({ k: 'nome', dir: 1 })
  const [pag, setPag]               = useState(0)
  const [aperti, setAperti]         = useState<Set<string>>(new Set())
  const [sel, setSel]               = useState<Set<number>>(new Set())
  const [mostraCf, setMostraCf]     = useState(false)
  const [riep, setRiep]             = useState(false)
  const [exp, setExp]               = useState<Esporta | null>(null)
  const [opz, setOpz]               = useState<OpzioniExport>(opzioniExportDefault)
  const [come, setCome]             = useState<'unico' | 'ente'>('unico')
  const [lavoro, setLavoro]         = useState(false)

  // Nuovo file (o nuova lettura del mese): gli indici cambiano, la selezione riparte.
  useEffect(() => {
    setSel(new Set()); setAperti(new Set()); setEntiSel(new Set()); setVoce(''); setPag(0); setRiep(false)
  }, [righe])
  // Ricerca: si filtra quando si smette di scrivere (89.000 righe in un anno).
  useEffect(() => { const t = setTimeout(() => { setCercato(testo); setPag(0) }, 150); return () => clearTimeout(t) }, [testo])

  const descrEnte = (c: string, ripiego = c) => entiMap.get(c)?.descrizione ?? ripiego
  const chiavi    = useMemo(() => chiaviRicerca(righe), [righe])
  const voci      = useMemo(() => [...new Set(righe.map(r => r.voce))].sort(), [righe])
  const entiFile  = useMemo(() => entiDelFile(righe, mesiSel)
    .map(e => ({ ...e, descr: entiMap.get(e.codice)?.descrizione ?? e.descr }))
    .sort((a, b) => a.descr.localeCompare(b.descr)), [righe, mesiSel, entiMap])
  const qe = entiCerca.trim().toLowerCase()
  const entiVisibili = entiFile.filter(e => {
    const r = entiMap.get(e.codice)
    if (entiFiltro === 'abil' && !r?.abilitato) return false
    if (entiFiltro === 'mail' && !r?.email.length) return false
    if (entiFiltro === 'senza' && r?.email.length) return false
    return !qe || e.codice.toLowerCase().includes(qe) || e.descr.toLowerCase().includes(qe)
  })

  const idx = useMemo(() => filtra(righe, chiavi, { mesi: mesiSel, enti: entiSel, voce, testo: cercato }), [righe, chiavi, mesiSel, entiSel, voce, cercato])
  const visibili = useMemo(() => new Set(idx), [idx])
  const persone  = useMemo(() => (vista === 'persona' ? ordinaPersone(raggruppaPersone(righe, idx), ordP) : []), [vista, righe, idx, ordP])
  const ordinate = useMemo(() => (vista === 'riga' ? ordinaRighe(righe, idx, ordR) : []), [vista, righe, idx, ordR])
  const totFiltro = useMemo(() => somme(righe, idx), [righe, idx])
  const totSel    = useMemo(() => somme(righe, sel), [righe, sel])
  const nascosti  = useMemo(() => { let n = 0; for (const i of sel) if (!visibili.has(i)) n++; return n }, [sel, visibili])
  const dettaglio = useMemo(() => (riep && sel.size ? riepilogo(righe, sel) : null), [riep, righe, sel])

  const nItems = vista === 'persona' ? persone.length : ordinate.length
  const pagine = Math.max(1, Math.ceil(nItems / PAG))
  const p0 = Math.min(pag, pagine - 1)
  const pagPersone = persone.slice(p0 * PAG, p0 * PAG + PAG)
  const pagRighe   = ordinate.slice(p0 * PAG, p0 * PAG + PAG)

  function segna(lista: Iterable<number>, on: boolean) {
    setSel(prev => {
      const s = new Set(prev)
      for (const i of lista) { if (on) s.add(i); else s.delete(i) }
      return s
    })
  }
  function cambiaEnte(c: string, on: boolean) {
    setEntiSel(prev => { const s = new Set(prev); if (on) s.add(c); else s.delete(c); return s }); setPag(0)
  }
  function ordinaPer(k: ColonnaPersona | ColonnaRiga) {
    const giu = k === 'cents' || k === 'n' || k === 'enti'
    if (vista === 'persona') setOrdP(o => (o.k === k ? { k, dir: o.dir === 1 ? -1 : 1 } : { k: k as ColonnaPersona, dir: giu ? -1 : 1 }))
    else setOrdR(o => (o.k === k ? { k, dir: o.dir === 1 ? -1 : 1 } : { k: k as ColonnaRiga, dir: giu ? -1 : 1 }))
  }
  const etichettaMese = (m: string) => (periodo ? periodoBreve(periodo) : meseBreve(m))
  const pronto = (c: string) => { const e = entiMap.get(c); return !e ? 'non in rubrica' : !e.abilitato ? 'disabilitato' : !e.email.length ? 'senza email' : null }

  // ── Esportazione ──────────────────────────────────────────
  async function scarica() {
    if (!exp || !sel.size) return
    const tutte = [...sel].sort((a, b) => a - b).map(i => righe[i]!).filter(Boolean)
    const gruppi = perEnte(righe, sel)
    const periodoDi = (rs: readonly RigaVersamento[]) => periodo ?? [...new Set(rs.map(r => r.mese))].sort()
    if (exp === 'eml') {
      const lista = aggregaEnti(tutte, new Set(mesi), periodo).filter(a => !pronto(a.codice))
      if (!lista.length) { showToast('Nessun ente della selezione è pronto: servono abilitazione ed email in rubrica.', 'warning'); return }
      setExp(null)
      await onGeneraEml(lista)
      return
    }
    setLavoro(true)
    try {
      const cfg = cfgExport(opz)
      const unico = come === 'unico' || gruppi.size === 1
      const pf = periodoFile(periodoDi(tutte))
      const voci: VoceZip[] = []
      if (unico) {
        const sotto = gruppi.size === 1 ? descrEnte([...gruppi.keys()][0]!, tutte[0]!.descr) : `${totSel.enti} enti · ${totSel.persone} persone · ${totSel.righe} versamenti`
        const bytes = exp === 'csv' ? csvSelezione(tutte, opz) : await pdfBytes('', sotto, tutte, periodoDi(tutte), cfg, periodoDi(tutte))
        voci.push({ nome: `versamenti_selezione_${pf}.${exp}`, bytes })
      } else {
        for (const [c, rs] of gruppi) {
          const p = periodoDi(rs)
          const bytes = exp === 'csv' ? csvSelezione(rs, opz) : await pdfBytes(c, descrEnte(c, rs[0]!.descr), rs, p, cfg, p)
          voci.push({ nome: nomeFile('versamenti_{CODICE_ENTE}_{PERIODO_FILE}', { CODICE_ENTE: c, PERIODO_FILE: periodoFile(p) }, exp, false), bytes })
        }
      }
      // Audit prima del download: se non si registra, non si scarica.
      await versamentiApi.eventoEsportazione({
        file, formato: exp, modo: unico ? 'unico' : 'ente', enti: [...gruppi.keys()],
        righe: totSel.righe, persone: totSel.persone, file_generati: voci.length, codiceFiscale: opz.colonne.includes('COD_FISC'),
      })
      if (voci.length === 1) scaricaFile(voci[0]!.nome, voci[0]!.bytes, exp === 'csv' ? 'text/csv' : 'application/pdf')
      else scaricaFile(`versamenti_selezione_${gruppi.size}_enti_${pf}.zip`, zipStore(voci), 'application/zip')
      showToast(voci.length === 1 ? `Scaricato ${voci[0]!.nome}` : `Scaricato lo ZIP con ${voci.length} file`, 'success')
      setExp(null)
    } catch (err) {
      showToast(`Esportazione non riuscita: ${messaggioErrore(err)}`, 'error')
    } finally { setLavoro(false) }
  }

  // ── Render ────────────────────────────────────────────────
  const th = (k: ColonnaPersona | ColonnaRiga, t: string, cls = '') => {
    const o = vista === 'persona' ? ordP : ordR
    const on = o.k === k
    return (
      <th className={`px-3 py-2.5 font-semibold ${cls}`} aria-sort={on ? (o.dir === 1 ? 'ascending' : 'descending') : undefined}>
        <button type="button" onClick={() => ordinaPer(k)} className={`inline-flex items-center gap-1 hover:text-slate-200 uppercase ${on ? 'text-indigo-300' : ''}`}>
          {t}<span className="text-[10px] w-2">{on ? (o.dir === 1 ? '▲' : '▼') : ''}</span>
        </button>
      </th>
    )
  }
  const statoTutti: Stato = idx.length ? statoDi(idx, sel) : 'no'
  const nEnti = entiFile.length

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-3 items-start border border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-400 bg-slate-900/50">
        <svg className="w-4 h-4 text-indigo-400 shrink-0 mt-px" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
        <p>I dati di <span className="font-mono text-slate-300 break-all">{file}</span> restano in questa pagina: ricerca, selezione e somme si calcolano nel browser.
          All'esportazione PGS registra nell'audit solo i conteggi (enti, righe, persone), mai nomi o codici fiscali.</p>
      </div>

      <div className="grid lg:grid-cols-[290px_minmax(0,1fr)] gap-5 items-start">
        {/* Enti */}
        <aside className={`${cardCls} flex flex-col min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-10rem)]`}>
          <div className="p-4 border-b border-slate-800 flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-white">Enti</h3>
              <span className="text-xs text-slate-500 text-right">{entiSel.size ? `${entiSel.size} selezionati di ${nEnti}` : `${nEnti} · nessuno scelto = tutti`}</span>
            </div>
            <input type="search" value={entiCerca} onChange={e => setEntiCerca(e.target.value)} placeholder="Cerca codice o descrizione…" aria-label="Cerca ente" className={`${inputCls} !py-1.5`} />
            <div className="flex flex-wrap gap-1.5">
              {([['tutti', 'Tutti'], ['abil', 'Abilitati'], ['mail', 'Con email'], ['senza', 'Senza email']] as const).map(([k, t]) => (
                <button key={k} type="button" onClick={() => setEntiFiltro(k)} aria-pressed={entiFiltro === k} className={chipCls(entiFiltro === k)}>{t}</button>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="button" className={btnBarra} onClick={() => { setEntiSel(prev => new Set([...prev, ...entiVisibili.map(e => e.codice)])); setPag(0) }}>Seleziona i visibili</button>
              <button type="button" className={`${btnPiccolo} text-slate-400 hover:text-slate-200`} onClick={() => { setEntiSel(new Set()); setPag(0) }}>Nessuno</button>
            </div>
          </div>
          <div className="overflow-y-auto divide-y divide-slate-800/70 min-h-0">
            {entiVisibili.length ? entiVisibili.map(e => {
              const r = entiMap.get(e.codice)
              const on = entiSel.has(e.codice)
              return (
                <label key={e.codice} className={`flex gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-800/40 ${on ? 'bg-indigo-950/40' : ''}`}>
                  <input type="checkbox" checked={on} onChange={ev => cambiaEnte(e.codice, ev.target.checked)} className="accent-indigo-500 w-4 h-4 mt-0.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-slate-100 truncate" title={e.descr}>{e.descr}</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 mt-0.5">
                      <span className="font-mono">{e.codice}</span>
                      <span className="tabular-nums">{e.persone} pers. · {e.righe.toLocaleString('it-IT')} righe</span>
                      {r && !r.abilitato && <Pill tono="neutro">DISABILITATO</Pill>}
                      {r?.abilitato && !r.email.length && <Pill tono="warn">SENZA EMAIL</Pill>}
                    </span>
                  </span>
                  <span className="text-xs tabular-nums text-slate-200 whitespace-nowrap mt-0.5">{fmtEuro(e.cents)} €</span>
                </label>
              )
            }) : <p className="px-4 py-6 text-sm text-slate-500 text-center">Nessun ente con questi filtri.</p>}
          </div>
        </aside>

        {/* Persone e versamenti */}
        <div className="flex flex-col gap-4 min-w-0">
          <div className={`${cardCls} p-4 flex flex-col gap-3`}>
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs text-slate-500 mr-1">Mesi</span>
              <button type="button" onClick={() => onMese('*')}
                className={`px-3 py-1 rounded-full text-xs font-medium border ${mesiSel.size === mesi.length ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}>Tutti</button>
              {mesi.map(m => (
                <button key={m} type="button" aria-pressed={mesiSel.has(m)} onClick={() => { onMese(m); setPag(0) }}
                  className={`px-3 py-1 rounded-full text-xs font-medium border tabular-nums ${mesiSel.has(m) ? 'bg-indigo-600/25 border-indigo-500 text-indigo-200' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'}`}>{etichettaMese(m)}</button>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[15rem]">
                <svg className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
                <input type="search" value={testo} onChange={e => setTesto(e.target.value)} placeholder="Cerca nominativo, matricola o codice fiscale…" aria-label="Cerca persone" className={`${inputCls} !pl-9`} />
              </div>
              <select value={voce} onChange={e => { setVoce(e.target.value); setPag(0) }} aria-label="Voce" className={`${inputCls} !w-auto`}>
                <option value="">Tutte le voci</option>
                {voci.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <div className="inline-flex rounded-lg overflow-hidden border border-slate-700" role="group" aria-label="Vista">
                {([['persona', 'Per persona'], ['riga', 'Per versamento']] as const).map(([k, t]) => (
                  <button key={k} type="button" aria-pressed={vista === k} onClick={() => { setVista(k); setPag(0) }}
                    className={`px-3 py-1.5 text-xs font-medium ${vista === k ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>{t}</button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                <input type="checkbox" checked={mostraCf} onChange={e => setMostraCf(e.target.checked)} className="accent-indigo-500" /> Mostra codice fiscale
              </label>
            </div>
          </div>

          <div className={`${cardCls} overflow-hidden`}>
            <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <Spunta stato={statoTutti} onChange={on => segna(idx, on)} label="Seleziona tutti i risultati" />
                Tutti i risultati <span className="tabular-nums text-slate-500">({idx.length.toLocaleString('it-IT')} versamenti{vista === 'persona' ? `, ${persone.length.toLocaleString('it-IT')} persone` : ''})</span>
              </label>
              <button type="button" className="text-xs text-indigo-400 hover:text-indigo-300"
                onClick={() => segna(vista === 'persona' ? pagPersone.flatMap(p => p.idx) : pagRighe, true)}>Seleziona questa pagina</button>
              <div className="flex-1" />
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <button type="button" className={btnBarra} disabled={p0 === 0} onClick={() => setPag(p0 - 1)} aria-label="Pagina precedente">‹</button>
                <span className="tabular-nums">Pagina {p0 + 1} di {pagine}</span>
                <button type="button" className={btnBarra} disabled={p0 >= pagine - 1} onClick={() => setPag(p0 + 1)} aria-label="Pagina successiva">›</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] tracking-wider text-slate-500">
                  {vista === 'persona' ? (
                    <tr><th className="pl-4 pr-1 py-2.5 w-8" /><th className="w-8" />{th('nome', 'Nominativo')}{th('matr', 'Matricola')}{th('nascita', 'Nascita')}
                      {mostraCf && <th className="px-3 py-2.5 font-semibold uppercase">Codice fiscale</th>}{th('enti', 'Enti')}
                      <th className="px-3 py-2.5 font-semibold uppercase">Mesi</th>{th('n', 'Vers.', 'text-right')}{th('cents', 'Totale', 'text-right pr-4')}</tr>
                  ) : (
                    <tr><th className="pl-4 pr-1 py-2.5 w-8" />{th('nome', 'Nominativo')}{th('matr', 'Matricola')}
                      {mostraCf && <th className="px-3 py-2.5 font-semibold uppercase">Codice fiscale</th>}{th('ente', 'Ente')}{th('mese', 'Mese')}{th('voce', 'Voce')}{th('cents', 'Importo', 'text-right pr-4')}</tr>
                  )}
                </thead>
                <tbody>
                  {nItems === 0 && <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-500">Nessun versamento con questi filtri.</td></tr>}
                  {vista === 'persona' && pagPersone.map(p => {
                    const st = statoDi(p.idx, sel), aperto = aperti.has(p.k)
                    const enti = p.enti.map(c => descrEnte(c, righe[p.idx[0]!]!.descr))
                    return [
                      <tr key={p.k} className={`border-t border-slate-800 hover:bg-slate-800/30 ${st !== 'no' ? 'bg-indigo-950/30' : ''}`}>
                        <td className="pl-4 pr-1 py-2"><Spunta stato={st} onChange={on => segna(p.idx, on)} label={`Seleziona ${p.nome}`} /></td>
                        <td className="px-1 py-2">
                          <button type="button" aria-expanded={aperto} aria-label="Dettaglio" className="w-6 h-6 rounded hover:bg-slate-700 text-slate-400"
                            onClick={() => setAperti(prev => { const s = new Set(prev); if (s.has(p.k)) s.delete(p.k); else s.add(p.k); return s })}>{aperto ? '▾' : '▸'}</button>
                        </td>
                        <td className="px-3 py-2 text-slate-100">{p.nome}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-400">{p.matr}</td>
                        <td className="px-3 py-2 tabular-nums text-slate-300 whitespace-nowrap">{p.nascita.ok ? fmtData(p.nascita.iso) : '—'}{p.nascita.ok && p.nascita.fonte === 'cf' && <span className="ml-1 text-[10px] text-violet-300">CF</span>}</td>
                        {mostraCf && <td className="px-3 py-2 font-mono text-xs text-slate-400">{p.cf || '—'}</td>}
                        <td className="px-3 py-2 text-xs text-slate-400"><span title={enti.join(', ')}>{p.enti.length === 1 ? enti[0] : `${p.enti.length} enti`}</span></td>
                        <td className="px-3 py-2 text-xs text-slate-400 tabular-nums whitespace-nowrap">{periodo ? periodoBreve(periodo) : p.mesi.length === 1 ? meseBreve(p.mesi[0]!) : `${meseBreve(p.mesi[0]!)} – ${meseBreve(p.mesi[p.mesi.length - 1]!)}`}</td>
                        <td className="px-3 py-2 tabular-nums text-right text-slate-400">{p.idx.length}</td>
                        <td className="px-4 py-2 tabular-nums text-right text-slate-100 whitespace-nowrap">{fmtEuro(p.cents)} €</td>
                      </tr>,
                      aperto && (
                        <tr key={`${p.k}#d`} className="bg-slate-950/60"><td /><td colSpan={mostraCf ? 9 : 8} className="px-3 pb-3 pt-1">
                          <table className="w-full text-xs"><tbody>
                            {[...p.idx].sort((a, b) => righe[a]!.mese.localeCompare(righe[b]!.mese) || righe[a]!.ente.localeCompare(righe[b]!.ente)).map(i => {
                              const r = righe[i]!
                              return (
                                <tr key={i} className="border-t border-slate-800/70">
                                  <td className="py-1.5 pr-2 w-6"><Spunta stato={sel.has(i) ? 'si' : 'no'} onChange={on => segna([i], on)} label="Seleziona versamento" /></td>
                                  <td className="py-1.5 pr-3 text-slate-300">{descrEnte(r.ente, r.descr)} <span className="font-mono text-slate-500">{r.ente}</span></td>
                                  <td className="py-1.5 pr-3 tabular-nums text-slate-400">{periodo ? periodoBreve(periodo) : meseLabel(r.mese)}</td>
                                  <td className="py-1.5 pr-3 font-mono text-slate-500">{r.voce}</td>
                                  <td className="py-1.5 tabular-nums text-right text-slate-200 whitespace-nowrap">{fmtEuro(r.cents)} €</td>
                                </tr>
                              )
                            })}
                          </tbody></table>
                        </td></tr>
                      ),
                    ]
                  })}
                  {vista === 'riga' && pagRighe.map(i => {
                    const r = righe[i]!, on = sel.has(i)
                    return (
                      <tr key={i} className={`border-t border-slate-800 hover:bg-slate-800/30 ${on ? 'bg-indigo-950/30' : ''}`}>
                        <td className="pl-4 pr-1 py-2"><Spunta stato={on ? 'si' : 'no'} onChange={v => segna([i], v)} label="Seleziona versamento" /></td>
                        <td className="px-3 py-2 text-slate-100">{r.nome}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-400">{r.matr}</td>
                        {mostraCf && <td className="px-3 py-2 font-mono text-xs text-slate-400">{r.cf || '—'}</td>}
                        <td className="px-3 py-2 text-xs text-slate-300 max-w-[14rem] truncate" title={descrEnte(r.ente, r.descr)}>{descrEnte(r.ente, r.descr)}</td>
                        <td className="px-3 py-2 text-xs tabular-nums text-slate-400 whitespace-nowrap">{etichettaMese(r.mese)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-500">{r.voce}</td>
                        <td className={`px-4 py-2 tabular-nums text-right whitespace-nowrap ${r.cents < 0 ? 'text-amber-300' : 'text-slate-100'}`}>{fmtEuro(r.cents)} €</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Somme e azioni */}
      <div className="sticky bottom-0 z-10 pb-3">
        <div className="bg-slate-900/95 backdrop-blur border border-slate-700 rounded-xl px-4 py-3 shadow-2xl shadow-black/50">
          {dettaglio && (
            <div className="grid md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-start gap-4 border-b border-slate-700 pb-3 mb-3 max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="text-slate-500"><tr><th className="text-left py-1 font-semibold">Ente</th><th className="text-right font-semibold">Pers.</th><th className="text-right font-semibold">Righe</th><th className="text-right font-semibold">Totale</th></tr></thead>
                <tbody>
                  {dettaglio.perEnte.map(e => (
                    <tr key={e.codice} className="border-t border-slate-800">
                      <td className="py-1 pr-2 text-slate-300">{descrEnte(e.codice, e.descr)} <span className="font-mono text-slate-500">{e.codice}</span></td>
                      <td className="text-right tabular-nums text-slate-400">{e.persone}</td>
                      <td className="text-right tabular-nums text-slate-400">{e.righe}</td>
                      <td className="text-right tabular-nums text-slate-100 whitespace-nowrap">{fmtEuro(e.cents)} €</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-600 font-semibold">
                    <td className="py-1 text-slate-200">Totale</td><td className="text-right tabular-nums">{totSel.persone}</td>
                    <td className="text-right tabular-nums">{totSel.righe}</td><td className="text-right tabular-nums text-white whitespace-nowrap">{fmtEuro(totSel.cents)} €</td>
                  </tr>
                </tbody>
              </table>
              <table className="w-full text-xs">
                <thead className="text-slate-500"><tr><th className="text-left py-1 font-semibold">Mese</th><th className="text-right font-semibold">Totale</th></tr></thead>
                <tbody>{dettaglio.perMese.map(m => (
                  <tr key={m.mese} className="border-t border-slate-800">
                    <td className="py-1 text-slate-300">{periodo ? periodoBreve(periodo) : meseLabel(m.mese)}</td>
                    <td className="text-right tabular-nums text-slate-100 whitespace-nowrap">{fmtEuro(m.cents)} €</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="text-xs text-slate-400 leading-5">
              <div className="uppercase tracking-wider text-[10px] text-slate-500">Risultati del filtro</div>
              <span className="tabular-nums text-slate-200">{totFiltro.righe.toLocaleString('it-IT')}</span> vers. · <span className="tabular-nums text-slate-200">{totFiltro.persone}</span> pers. · <span className="tabular-nums text-slate-100 font-medium">{fmtEuro(totFiltro.cents)} €</span>
            </div>
            <div className="text-xs text-slate-400 leading-5" aria-live="polite">
              <div className="uppercase tracking-wider text-[10px] text-indigo-300">Selezionati</div>
              <span className="tabular-nums text-slate-200">{totSel.righe.toLocaleString('it-IT')}</span> vers. · <span className="tabular-nums text-slate-200">{totSel.persone}</span> pers. · <span className="tabular-nums text-slate-200">{totSel.enti}</span> enti · <span className="tabular-nums text-lg font-semibold text-white">{fmtEuro(totSel.cents)} €</span>
            </div>
            {nascosti > 0 && (
              <div className="text-xs text-amber-300">
                {nascosti} selezionati non visibili con i filtri attuali{' '}
                <button type="button" className="underline hover:text-amber-200" onClick={() => setSel(prev => new Set([...prev].filter(i => visibili.has(i))))}>togli</button>
              </div>
            )}
            <div className="flex-1" />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnBarra} disabled={!sel.size} aria-expanded={riep} onClick={() => setRiep(v => !v)}>{riep ? 'Chiudi riepilogo' : 'Riepilogo'}</button>
              <button type="button" className={`${btnPiccolo} text-slate-400 hover:text-slate-200`} disabled={!sel.size} onClick={() => { setSel(new Set()); setRiep(false) }}>Svuota</button>
              <button type="button" className={btnBarra} disabled={!sel.size} onClick={() => setExp('csv')}><IconaDownload /> CSV</button>
              <button type="button" className={btnBarra} disabled={!sel.size} onClick={() => setExp('pdf')}><IconaDownload /> PDF</button>
              <button type="button" className={`${btnPiccolo} bg-indigo-600 hover:bg-indigo-500 text-white`} disabled={!sel.size || generando} onClick={() => setExp('eml')}><IconaDownload /> EML dei selezionati</button>
            </div>
          </div>
        </div>
      </div>

      {exp && (
        <Finestra
          titolo={<h3 className="text-base font-semibold text-white">{{ csv: 'Esporta in CSV', pdf: 'Esporta in PDF', eml: 'EML dei soli selezionati' }[exp]}</h3>}
          onChiudi={() => { if (!lavoro) setExp(null) }}
          piede={<>
            <button type="button" className={btnSecondario} disabled={lavoro} onClick={() => setExp(null)}>Annulla</button>
            <button type="button" className={btnPrimario} disabled={lavoro || generando || (exp !== 'eml' && !opz.colonne.length)} onClick={() => void scarica()}>
              <IconaDownload /> {lavoro ? 'Preparo…' : 'Scarica'}
            </button>
          </>}
        >
          <div className="px-6 py-5 flex flex-col gap-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              {([['Enti', String(totSel.enti)], ['Persone', String(totSel.persone)], ['Versamenti', totSel.righe.toLocaleString('it-IT')], ['Totale', `${fmtEuro(totSel.cents)} €`]] as const).map(([k, v]) => (
                <div key={k} className="bg-slate-950 border border-slate-800 rounded-lg py-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">{k}</div>
                  <div className="tabular-nums text-sm text-white">{v}</div>
                </div>
              ))}
            </div>
            {exp === 'eml' ? (
              <EmlSelezione righe={righe} sel={sel} entiMap={entiMap} modelloDi={modelloDi} pronto={pronto} descrEnte={descrEnte} modo={modo} setModo={setModo} />
            ) : (
              <>
                <div className="grid sm:grid-cols-2 gap-2">
                  <Scelta on={come === 'unico'} onClick={() => setCome('unico')} titolo="Un file unico" sotto={`${totSel.enti} ${totSel.enti === 1 ? 'ente' : 'enti'} nello stesso ${exp.toUpperCase()}, ordinati per ente`} />
                  <Scelta on={come === 'ente'} onClick={() => setCome('ente')} titolo="Un file per ente" sotto={`${totSel.enti} file in uno ZIP`} />
                </div>
                <fieldset>
                  <legend className="text-xs text-slate-500 mb-2">Colonne</legend>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
                    {COLONNE_EXPORT.map(k => {
                      const on = opz.colonne.includes(k)
                      return (
                        <label key={k} className={`flex items-center gap-2 text-sm cursor-pointer ${k === 'COD_FISC' && on ? 'text-amber-300' : 'text-slate-300'}`}>
                          <input type="checkbox" checked={on} className="accent-indigo-500"
                            onChange={e => setOpz(o => ({ ...o, colonne: e.target.checked ? [...o.colonne, k] : o.colonne.filter(x => x !== k) }))} />
                          {COLDEF[k].nome}
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
                {opz.colonne.includes('COD_FISC') && (
                  <p className="text-xs text-amber-300 border border-amber-800 bg-amber-950/30 rounded-lg px-3 py-2">Il codice fiscale è un dato personale in più: includilo solo se chi riceve il file ne ha bisogno.</p>
                )}
                {exp === 'csv' ? (
                  <div className="flex flex-wrap gap-4 text-sm text-slate-300">
                    <label className="flex items-center gap-2">Separatore
                      <select value={opz.sep} onChange={e => setOpz(o => ({ ...o, sep: e.target.value as OpzioniExport['sep'] }))} className={`${inputCls} !w-auto !py-1`}>
                        <option value=";">;</option><option value=",">,</option><option value="tab">TAB</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2">Codifica
                      <select value={opz.codifica} onChange={e => setOpz(o => ({ ...o, codifica: e.target.value as OpzioniExport['codifica'] }))} className={`${inputCls} !w-auto !py-1`}>
                        <option value="w1252">Windows-1252 (Excel)</option><option value="utf8bom">UTF-8 con BOM</option>
                      </select>
                    </label>
                  </div>
                ) : <p className="text-xs text-slate-500">PDF A4 orizzontale, con il subtotale di ogni ente e il totale generale.</p>}
              </>
            )}
          </div>
        </Finestra>
      )}
    </div>
  )
}

function Scelta({ on, onClick, titolo, sotto }: { on: boolean; onClick: () => void; titolo: string; sotto: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`text-left flex gap-2.5 items-start p-3 rounded-lg border ${on ? 'border-indigo-500 bg-indigo-950/30' : 'border-slate-700 hover:border-slate-600'}`}>
      <span className={`mt-0.5 w-3.5 h-3.5 rounded-full border shrink-0 ${on ? 'border-indigo-400 bg-indigo-500 ring-2 ring-indigo-500/30' : 'border-slate-500'}`} />
      <span><span className="block text-sm text-slate-100">{titolo}</span><span className="block text-xs text-slate-500 mt-0.5">{sotto}</span></span>
    </button>
  )
}

function EmlSelezione({ righe, sel, entiMap, modelloDi, pronto, descrEnte, modo, setModo }: {
  righe: RigaVersamento[]; sel: ReadonlySet<number>; entiMap: ReadonlyMap<string, VersamentoEnteApi>
  modelloDi: (c: string) => ModelloVersamento | null; pronto: (c: string) => string | null; descrEnte: (c: string, ripiego?: string) => string
  modo: 'unico' | 'mese'; setModo: (m: 'unico' | 'mese') => void
}) {
  const gruppi = [...perEnte(righe, sel)].sort((a, b) => descrEnte(a[0], a[1][0]!.descr).localeCompare(descrEnte(b[0], b[1][0]!.descr)))
  const ok = gruppi.filter(([c]) => !pronto(c)).length
  return (
    <>
      <p className="text-sm text-slate-300">Un EML per ente, con il modello dell'ente: testo, CSV e PDF contengono <b className="text-white">solo i versamenti selezionati</b>; totale e numero di righe si ricalcolano su quelli.</p>
      <div className="grid sm:grid-cols-2 gap-2">
        <Scelta on={modo === 'unico'} onClick={() => setModo('unico')} titolo="Uno per ente" sotto="tutti i mesi della selezione in un EML" />
        <Scelta on={modo === 'mese'} onClick={() => setModo('mese')} titolo="Uno per ente per mese" sotto="un EML per ciascun mese" />
      </div>
      <div className="border border-slate-800 rounded-lg divide-y divide-slate-800 max-h-56 overflow-y-auto text-sm">
        {gruppi.map(([c, rs]) => {
          const motivo = pronto(c)
          return (
            <div key={c} className={`flex items-center gap-3 px-3 py-2 ${motivo ? 'opacity-60' : ''}`}>
              <span className="flex-1 min-w-0 truncate text-slate-200">{descrEnte(c, rs[0]!.descr)} <span className="font-mono text-xs text-slate-500">{c}</span></span>
              <span className="text-xs tabular-nums text-slate-400">{rs.length} vers.</span>
              <span className="text-xs tabular-nums text-slate-100 w-24 text-right whitespace-nowrap">{fmtEuro(rs.reduce((s, r) => s + r.cents, 0))} €</span>
              {motivo ? <Pill tono="warn">{motivo.toUpperCase()}</Pill>
                : <span className="text-xs text-slate-500 truncate max-w-[9rem]" title={modelloDi(c)?.nome}>{modelloDi(c)?.nome ?? '—'}</span>}
            </div>
          )
        })}
      </div>
      <p className="text-xs text-slate-500">
        {ok} {ok === 1 ? 'ente pronto' : 'enti pronti'}{gruppi.length > ok ? `, ${gruppi.length - ok} esclusi (disabilitati o senza email: si sistemano in Rubrica enti)` : ''}.
        {entiMap.size === 0 ? ' Rubrica non caricata.' : ''}
      </p>
    </>
  )
}
