// ============================================================
// PAYROLL GANG SUITE — RicercaPage
// Ricerca full-text su tutte le liquidazioni + report avanzati
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { useStore, type BozzaDati } from '../store/useStore'
import { bozzeApi, type BozzaApi } from '../api/endpoints'
import { calcolaImportoCSV, formatEur } from '../utils/biz'
import Pagination from '../components/Pagination'

// ── Tipi interni ──────────────────────────────────────────────

interface SearchRow {
  bozzaId:      string
  bozzaNome:    string
  bozzaStato:   'bozza' | 'archiviata'
  dettaglioId:  string
  detNome:      string
  voce:         string
  competenza:   string
  matricola:    string
  cognomeNome:  string
  ruolo:        string
  importoLordo: number
  importoCSV:   number
}

type TabId = 'ricerca' | 'report'
type ReportMode = 'matricola' | 'voce' | 'periodo'

// ── Helper: flat join bozze → SearchRow[] ────────────────────

function buildSearchRows(bozze: BozzaApi[], coefficienti: Record<string, number>): SearchRow[] {
  const rows: SearchRow[] = []
  for (const bozza of bozze) {
    const dati      = (bozza.dati ?? {}) as Partial<BozzaDati>
    const dettagli  = dati.dettagli  ?? []
    const nominativi = dati.nominativi ?? []
    for (const det of dettagli) {
      const noms = nominativi.filter(n => n.dettaglioId === det.id)
      for (const nom of noms) {
        const importoCSV = calcolaImportoCSV(
          nom, det, coefficienti as Parameters<typeof calcolaImportoCSV>[2],
        )
        rows.push({
          bozzaId:      bozza.id,
          bozzaNome:    bozza.nome,
          bozzaStato:   bozza.stato,
          dettaglioId:  det.id,
          detNome:      det.nomeDescrittivo,
          voce:         det.voce,
          competenza:   det.competenzaLiquidazione,
          matricola:    nom.matricola,
          cognomeNome:  nom.cognomeNome,
          ruolo:        nom.ruolo,
          importoLordo: nom.importoLordo,
          importoCSV,
        })
      }
    }
  }
  return rows
}

// ── Helper: download CSV generico ────────────────────────────

function downloadPlainCsv(content: string, filename: string) {
  const BOM  = '﻿'
  const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}

// ── Componente principale ─────────────────────────────────────

export default function RicercaPage() {
  const { bozze, setBozze, settings, loadBozzaInEditor, loadBozzaInViewer } = useStore()

  const [tab, setTab]             = useState<TabId>('ricerca')
  const [loading, setLoading]     = useState(false)
  const [query, setQuery]         = useState('')
  const [modoFulltext, setModoFulltext] = useState(false)
  const [filtroStato, setFiltroStato]   = useState<'tutte' | 'bozza' | 'archiviata'>('tutte')
  const [filtroAnno, setFiltroAnno]     = useState('')
  const [page, setPage]           = useState(1)
  const [pageSize, setPageSize]   = useState(20)
  const [reportMode, setReportMode] = useState<ReportMode>('matricola')

  // Carica bozze (con dati completi) ad ogni mount della pagina
  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const data = await bozzeApi.list()
        setBozze(data)
      } catch { /* usa dati già in store */ }
      finally { setLoading(false) }
    }
    load()
  }, [setBozze])

  // Flat join di tutte le bozze
  const allRows = useMemo(
    () => buildSearchRows(bozze, settings.coefficienti as Record<string, number>),
    [bozze, settings.coefficienti],
  )

  // ── Anni disponibili per filtro ──────────────────────────────
  const anniDisponibili = useMemo(() => {
    const set = new Set<string>()
    for (const r of allRows) {
      const anno = r.competenza.split('/')[1]
      if (anno) set.add(anno)
    }
    return [...set].sort().reverse()
  }, [allRows])

  // ── Filtro risultati ─────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allRows.filter(r => {
      if (filtroStato !== 'tutte' && r.bozzaStato !== filtroStato) return false
      if (filtroAnno && !r.competenza.endsWith(`/${filtroAnno}`)) return false
      if (!q) return true
      if (!modoFulltext) {
        return r.bozzaNome.toLowerCase().includes(q)
      }
      // fulltext: cerca su tutti i campi stringa
      return (
        r.bozzaNome.toLowerCase().includes(q)     ||
        r.detNome.toLowerCase().includes(q)       ||
        r.matricola.toLowerCase().includes(q)     ||
        r.cognomeNome.toLowerCase().includes(q)   ||
        r.voce.toLowerCase().includes(q)          ||
        r.competenza.toLowerCase().includes(q)    ||
        r.ruolo.toLowerCase().includes(q)
      )
    })
  }, [allRows, query, modoFulltext, filtroStato, filtroAnno])

  // Reset pagina su cambio filtri
  useEffect(() => { setPage(1) }, [query, modoFulltext, filtroStato, filtroAnno, tab, reportMode])

  const pagedRows = filtered.slice((page - 1) * pageSize, page * pageSize)

  // ── Export ricerca ───────────────────────────────────────────
  function handleExportRicerca() {
    const header = 'Liquidazione;Stato;Gruppo;Matricola;Cognome Nome;Ruolo;Voce;Competenza;Importo Lordo;Importo CSV\r\n'
    const body   = filtered.map(r =>
      [r.bozzaNome, r.bozzaStato, r.detNome, r.matricola, r.cognomeNome,
       r.ruolo, r.voce, r.competenza,
       r.importoLordo.toFixed(2), r.importoCSV.toFixed(2)].join(';'),
    ).join('\r\n')
    downloadPlainCsv(header + body, `ricerca_${new Date().toISOString().slice(0,10)}.csv`)
  }

  // ── Dati report ──────────────────────────────────────────────
  const reportRows = useMemo(() => {
    const source = filtroStato === 'tutte' ? allRows
      : allRows.filter(r => r.bozzaStato === filtroStato)
    const filtered2 = filtroAnno
      ? source.filter(r => r.competenza.endsWith(`/${filtroAnno}`))
      : source

    if (reportMode === 'matricola') {
      const map = new Map<string, { cognomeNome: string; ruolo: string; count: number; lordo: number; csv: number; bozze: Set<string> }>()
      for (const r of filtered2) {
        const prev = map.get(r.matricola) ?? { cognomeNome: r.cognomeNome, ruolo: r.ruolo, count: 0, lordo: 0, csv: 0, bozze: new Set() }
        prev.count++; prev.lordo += r.importoLordo; prev.csv += r.importoCSV; prev.bozze.add(r.bozzaId)
        map.set(r.matricola, prev)
      }
      return [...map.entries()]
        .sort((a, b) => b[1].lordo - a[1].lordo)
        .map(([key, v]) => ({ key, label: `${key} — ${v.cognomeNome}`, sub: v.ruolo, count: v.count, lordo: v.lordo, csv: v.csv, nBozze: v.bozze.size }))
    }

    if (reportMode === 'voce') {
      const map = new Map<string, { count: number; lordo: number; csv: number; bozze: Set<string> }>()
      for (const r of filtered2) {
        const prev = map.get(r.voce) ?? { count: 0, lordo: 0, csv: 0, bozze: new Set() }
        prev.count++; prev.lordo += r.importoLordo; prev.csv += r.importoCSV; prev.bozze.add(r.bozzaId)
        map.set(r.voce, prev)
      }
      return [...map.entries()]
        .sort((a, b) => b[1].lordo - a[1].lordo)
        .map(([key, v]) => ({ key, label: key, sub: '', count: v.count, lordo: v.lordo, csv: v.csv, nBozze: v.bozze.size }))
    }

    // periodo
    const map = new Map<string, { count: number; lordo: number; csv: number; bozze: Set<string> }>()
    for (const r of filtered2) {
      const prev = map.get(r.competenza) ?? { count: 0, lordo: 0, csv: 0, bozze: new Set() }
      prev.count++; prev.lordo += r.importoLordo; prev.csv += r.importoCSV; prev.bozze.add(r.bozzaId)
      map.set(r.competenza, prev)
    }
    return [...map.entries()]
      .sort((a, b) => {
        const [ma='0', ya='0'] = a[0].split('/'); const [mb='0', yb='0'] = b[0].split('/')
        return Number(yb)*12+Number(mb) - (Number(ya)*12+Number(ma))
      })
      .map(([key, v]) => ({ key, label: key, sub: '', count: v.count, lordo: v.lordo, csv: v.csv, nBozze: v.bozze.size }))
  }, [allRows, reportMode, filtroStato, filtroAnno])

  const pagedReport = reportRows.slice((page - 1) * pageSize, page * pageSize)

  function handleExportReport() {
    const modeLabel = reportMode === 'matricola' ? 'Matricola;Nominativo;Ruolo'
      : reportMode === 'voce' ? 'Voce' : 'Periodo'
    const header = `${modeLabel};N. Righe;N. Liquidazioni;Importo Lordo;Importo CSV\r\n`
    const body   = reportRows.map(r =>
      [r.label, r.sub, r.count, r.nBozze,
       r.lordo.toFixed(2), r.csv.toFixed(2)].filter((_, i) => reportMode === 'matricola' || i !== 1).join(';'),
    ).join('\r\n')
    downloadPlainCsv(header + body, `report_${reportMode}_${new Date().toISOString().slice(0,10)}.csv`)
  }

  // ── Riga risultato: apre viewer o editor ─────────────────────
  function handleOpenRow(row: SearchRow) {
    const bozza = bozze.find(b => b.id === row.bozzaId)
    if (!bozza) return
    if (bozza.stato === 'archiviata') loadBozzaInViewer(bozza)
    else loadBozzaInEditor(bozza)
  }

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">Ricerca</h2>
          <p className="text-slate-400 text-sm mt-0.5">
            {loading ? 'Caricamento…' : `${allRows.length} righe totali in ${bozze.length} liquidazioni`}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-slate-800/50 p-1 rounded-lg w-fit">
        {(['ricerca', 'report'] as TabId[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition
              ${tab === t ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            {t === 'ricerca' ? 'Ricerca' : 'Report'}
          </button>
        ))}
      </div>

      {/* ── TAB RICERCA ───────────────────────────────────────── */}
      {tab === 'ricerca' && (
        <>
          {/* Barra di ricerca */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500"
                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={modoFulltext ? 'Cerca in tutti i campi…' : 'Cerca per nome liquidazione…'}
                className="w-full pl-9 pr-4 py-2 rounded-lg bg-slate-800 border border-slate-700
                           text-white text-sm placeholder:text-slate-500
                           focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {/* Toggle fulltext */}
            <button
              onClick={() => setModoFulltext(v => !v)}
              className={`px-3 py-2 rounded-lg text-sm border transition shrink-0
                ${modoFulltext
                  ? 'bg-indigo-600/20 text-indigo-400 border-indigo-700'
                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'}`}
              title={modoFulltext ? 'Modalità: fulltext avanzata' : 'Modalità: solo nome liquidazione'}
            >
              {modoFulltext ? 'Fulltext' : 'Per nome'}
            </button>
          </div>

          {/* Filtri */}
          <div className="flex flex-wrap gap-3 mb-4 text-sm">
            <div className="flex gap-1 bg-slate-800/50 p-1 rounded-lg">
              {(['tutte', 'bozza', 'archiviata'] as const).map(s => (
                <button key={s}
                  onClick={() => setFiltroStato(s)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition
                    ${filtroStato === s ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  {s === 'tutte' ? 'Tutte' : s === 'bozza' ? 'Bozze' : 'Archiviate'}
                </button>
              ))}
            </div>

            <select
              value={filtroAnno}
              onChange={e => setFiltroAnno(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700
                         text-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">Tutti gli anni</option>
              {anniDisponibili.map(a => <option key={a} value={a}>{a}</option>)}
            </select>

            {filtered.length > 0 && (
              <button
                onClick={handleExportRicerca}
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                           bg-emerald-700/30 text-emerald-400 border border-emerald-800/50
                           hover:bg-emerald-700/50 transition"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                </svg>
                Esporta CSV ({filtered.length})
              </button>
            )}
          </div>

          {/* Tabella risultati */}
          {loading ? (
            <LoadingSpinner />
          ) : filtered.length === 0 ? (
            <EmptyResults query={query} />
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-500">
                      <th className="px-3 py-2.5 text-left font-medium">Liquidazione</th>
                      <th className="px-3 py-2.5 text-left font-medium">Gruppo</th>
                      <th className="px-3 py-2.5 text-left font-medium">Matricola</th>
                      <th className="px-3 py-2.5 text-left font-medium">Nominativo</th>
                      <th className="px-3 py-2.5 text-left font-medium">Ruolo</th>
                      <th className="px-3 py-2.5 text-left font-medium">Voce</th>
                      <th className="px-3 py-2.5 text-left font-medium">Competenza</th>
                      <th className="px-3 py-2.5 text-right font-medium">Importo</th>
                      <th className="px-3 py-2.5 text-left font-medium">Stato</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRows.map((r, i) => (
                      <tr
                        key={`${r.bozzaId}-${r.dettaglioId}-${r.matricola}-${i}`}
                        onClick={() => handleOpenRow(r)}
                        className="border-b border-slate-800/50 hover:bg-slate-800/40 transition cursor-pointer"
                      >
                        <td className="px-3 py-2 text-slate-300 max-w-[140px] truncate">{r.bozzaNome}</td>
                        <td className="px-3 py-2 text-slate-400 max-w-[120px] truncate">{r.detNome || '—'}</td>
                        <td className="px-3 py-2 font-mono text-slate-300">{r.matricola}</td>
                        <td className="px-3 py-2 text-slate-300 max-w-[140px] truncate">{r.cognomeNome}</td>
                        <td className="px-3 py-2">
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">{r.ruolo}</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-400">{r.voce || '—'}</td>
                        <td className="px-3 py-2 text-slate-400">{r.competenza || '—'}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-300">{formatEur(r.importoLordo)}</td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 rounded-full border text-xs
                            ${r.bozzaStato === 'archiviata'
                              ? 'text-slate-400 border-slate-700 bg-slate-800/50'
                              : 'text-indigo-400 border-indigo-800 bg-indigo-900/30'}`}>
                            {r.bozzaStato === 'archiviata' ? 'Arch.' : 'Bozza'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                total={filtered.length}
                pageSize={pageSize}
                page={page}
                onPageChange={setPage}
                onPageSizeChange={s => { setPageSize(s); setPage(1) }}
              />
            </div>
          )}
        </>
      )}

      {/* ── TAB REPORT ───────────────────────────────────────── */}
      {tab === 'report' && (
        <>
          {/* Controlli report */}
          <div className="flex flex-wrap items-center gap-3 mb-5">
            <div className="flex gap-1 bg-slate-800/50 p-1 rounded-lg">
              {(['matricola', 'voce', 'periodo'] as ReportMode[]).map(m => (
                <button key={m}
                  onClick={() => setReportMode(m)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition
                    ${reportMode === m ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  {m === 'matricola' ? 'Per matricola' : m === 'voce' ? 'Per voce HR' : 'Per periodo'}
                </button>
              ))}
            </div>

            <div className="flex gap-1 bg-slate-800/50 p-1 rounded-lg">
              {(['tutte', 'bozza', 'archiviata'] as const).map(s => (
                <button key={s}
                  onClick={() => setFiltroStato(s)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition
                    ${filtroStato === s ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  {s === 'tutte' ? 'Tutte' : s === 'bozza' ? 'Bozze' : 'Archiviate'}
                </button>
              ))}
            </div>

            <select
              value={filtroAnno}
              onChange={e => setFiltroAnno(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700
                         text-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">Tutti gli anni</option>
              {anniDisponibili.map(a => <option key={a} value={a}>{a}</option>)}
            </select>

            {reportRows.length > 0 && (
              <button
                onClick={handleExportReport}
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                           bg-emerald-700/30 text-emerald-400 border border-emerald-800/50
                           hover:bg-emerald-700/50 transition"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                </svg>
                Esporta CSV
              </button>
            )}
          </div>

          {/* Totali report */}
          {reportRows.length > 0 && (
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
                <p className="text-xs text-slate-500 mb-1">
                  {reportMode === 'matricola' ? 'Matricole' : reportMode === 'voce' ? 'Voci' : 'Periodi'}
                </p>
                <p className="text-2xl font-bold text-white">{reportRows.length}</p>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
                <p className="text-xs text-slate-500 mb-1">Totale lordo</p>
                <p className="text-lg font-bold text-white font-mono">
                  {formatEur(reportRows.reduce((s, r) => s + r.lordo, 0))}
                </p>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
                <p className="text-xs text-slate-500 mb-1">N. righe</p>
                <p className="text-2xl font-bold text-indigo-400">
                  {reportRows.reduce((s, r) => s + r.count, 0)}
                </p>
              </div>
            </div>
          )}

          {/* Tabella report */}
          {loading ? (
            <LoadingSpinner />
          ) : reportRows.length === 0 ? (
            <EmptyResults query="" />
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-500">
                      <th className="px-3 py-2.5 text-left font-medium">
                        {reportMode === 'matricola' ? 'Matricola / Nominativo'
                          : reportMode === 'voce' ? 'Voce HR' : 'Periodo'}
                      </th>
                      {reportMode === 'matricola' && (
                        <th className="px-3 py-2.5 text-left font-medium">Ruolo</th>
                      )}
                      <th className="px-3 py-2.5 text-right font-medium">N. righe</th>
                      <th className="px-3 py-2.5 text-right font-medium">Liquidazioni</th>
                      <th className="px-3 py-2.5 text-right font-medium">Importo lordo</th>
                      <th className="px-3 py-2.5 text-right font-medium">Importo CSV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedReport.map(r => (
                      <tr key={r.key} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition">
                        <td className="px-3 py-2 text-slate-300 font-mono">{r.label}</td>
                        {reportMode === 'matricola' && (
                          <td className="px-3 py-2">
                            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">{r.sub}</span>
                          </td>
                        )}
                        <td className="px-3 py-2 text-right text-slate-400">{r.count}</td>
                        <td className="px-3 py-2 text-right text-slate-400">{r.nBozze}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-300">{formatEur(Math.round(r.lordo * 100) / 100)}</td>
                        <td className="px-3 py-2 text-right font-mono text-indigo-400">{formatEur(Math.round(r.csv * 100) / 100)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                total={reportRows.length}
                pageSize={pageSize}
                page={page}
                onPageChange={setPage}
                onPageSizeChange={s => { setPageSize(s); setPage(1) }}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <svg className="animate-spin w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  )
}

function EmptyResults({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center mb-4">
        <svg className="w-6 h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <p className="text-slate-300 font-medium">
        {query ? 'Nessun risultato' : 'Nessun dato disponibile'}
      </p>
      <p className="text-slate-500 text-sm mt-1">
        {query ? `Nessuna corrispondenza per "${query}"` : 'Le liquidazioni appariranno qui'}
      </p>
    </div>
  )
}
