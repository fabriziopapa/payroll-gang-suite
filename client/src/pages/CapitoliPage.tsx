// ============================================================
// PAYROLL GANG SUITE — Capitoli Anagrafica
// Import da Capitoli_STAMPA.xml (standard) e
//           Capitoli_Locali_STAMPA.xml (locali)
// ============================================================

import React, { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'
import { capitoliApi, type CapitoloSorgente, type CapitoloAnagApi } from '../api/endpoints'
import { sendXmlInChunks, type ChunkProgress } from '../utils/xmlChunker'
import Pagination from '../components/Pagination'
import { usePageLoad } from '../hooks/usePageLoad'

type TabSorgente = CapitoloSorgente

export default function CapitoliPage() {
  const { capitoliAnag, setCapitoliAnag } = useStore()
  const [tab, setTab]             = useState<TabSorgente>('standard')
  const [lastImport, setLastImport] = useState<{ standard: string | null; locali: string | null }>({
    standard: null, locali: null,
  })
  const [importing, setImporting] = useState(false)
  const [progress, setProgress]   = useState<ChunkProgress | null>(null)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [search, setSearch]       = useState('')
  const [page, setPage]           = useState(1)
  const [pageSize, setPageSize]   = useState(20)

  const { isLoading, loadError } = usePageLoad(
    async () => {
      const [data, dates] = await Promise.all([capitoliApi.list(), capitoliApi.lastImport()])
      setCapitoliAnag(data)
      setLastImport(dates)
    },
    [setCapitoliAnag],
    'Impossibile caricare i capitoli. Controlla la connessione e riprova.',
  )

  // Filtra per tab + search
  const visibili = capitoliAnag.filter(c => c.sorgente === tab)
  const filtered = visibili.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      c.codice.includes(q) ||
      (c.descrizione ?? '').toLowerCase().includes(q) ||
      (c.breve ?? '').toLowerCase().includes(q)
    )
  })

  useEffect(() => { setPage(1) }, [search, tab, pageSize])

  const pageSlice = filtered.slice((page - 1) * pageSize, page * pageSize)

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportResult(null)
    setProgress(null)
    try {
      const xml    = await file.text()
      const result = await sendXmlInChunks(
        xml,
        100,
        chunk => capitoliApi.importXml(chunk, tab),
        p => setProgress(p),
      )
      setImportResult(
        `✓ Import ${tab} completato: ${result.inserted} inseriti, ${result.updated} aggiornati` +
        (result.errors.length ? `, ${result.errors.length} errori` : '') + '.',
      )
      // Ricarica tutto
      const [data, dates] = await Promise.all([capitoliApi.list(), capitoliApi.lastImport()])
      setCapitoliAnag(data)
      setLastImport(dates)
    } catch (err: unknown) {
      setImportResult(`Errore: ${(err as Error).message}`)
    } finally {
      setImporting(false)
      setProgress(null)
      e.target.value = ''
    }
  }

  const lastDate = lastImport[tab]
    ? new Date(lastImport[tab]!).toLocaleDateString('it-IT')
    : null

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-xl font-bold text-white">Capitoli HR</h2>
          <p className="text-slate-400 text-sm mt-0.5">
            {visibili.length} capitoli {tab}
            {lastDate && ` · Ultimo import: ${lastDate}`}
          </p>
        </div>

        {/* Bottone import */}
        <label className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer shrink-0
          ${importing
            ? 'bg-slate-700 text-slate-400'
            : 'bg-indigo-600 hover:bg-indigo-500 text-white'}
          text-sm font-medium transition`}
        >
          {importing ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              {progress ? `Batch ${progress.current}/${progress.total}…` : 'Importazione…'}
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
              </svg>
              Importa XML {tab}
            </>
          )}
          <input
            type="file"
            accept=".xml"
            className="hidden"
            onChange={handleImport}
            disabled={importing}
          />
        </label>
      </div>

      {/* Progress bar */}
      {progress && (
        <div className="mb-4 p-3 rounded-lg bg-slate-800 border border-slate-700">
          <div className="flex justify-between text-xs text-slate-400 mb-1.5">
            <span>Batch {progress.current} di {progress.total}</span>
            <span>{progress.rowsDone} / {progress.rowsTotal} righe</span>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-1.5">
            <div
              className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${Math.round((progress.rowsDone / progress.rowsTotal) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {importResult && (
        <div className="mb-4 p-3 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-300">
          {importResult}
        </div>
      )}

      {/* Tabs sorgente */}
      <div className="flex gap-0.5 mb-4 bg-slate-800/50 p-1 rounded-lg w-fit">
        {(['standard', 'locali'] as TabSorgente[]).map(s => (
          <button
            key={s}
            onClick={() => { setTab(s); setSearch('') }}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition
              ${tab === s
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-white'}`}
          >
            {s === 'standard' ? 'Standard' : 'Locali'}
            <span className="ml-2 text-xs text-slate-500">
              ({capitoliAnag.filter(c => c.sorgente === s).length})
            </span>
          </button>
        ))}
      </div>

      {/* File hint */}
      <div className="mb-4 p-3 rounded-lg bg-slate-900/50 border border-slate-800 text-xs text-slate-500 flex items-center gap-2">
        <svg className="w-3.5 h-3.5 text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        File atteso per questa tab:{' '}
        <code className="text-indigo-400">
          {tab === 'standard' ? 'Capitoli_STAMPA.xml' : 'Capitoli_Locali_STAMPA.xml'}
        </code>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Cerca per codice, descrizione o breve…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-sm px-3 py-2 rounded-lg bg-slate-800 border border-slate-700
                     text-white placeholder-slate-500 text-sm
                     focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
      </div>

      {loadError && (
        <div className="mb-4 p-3 rounded-lg bg-red-900/40 border border-red-800/50 text-red-300 text-sm">
          {loadError}
        </div>
      )}

      {/* Lista */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <svg className="animate-spin w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl py-12 text-center text-slate-500 text-sm">
              {visibili.length === 0
                ? `Nessun capitolo ${tab}. Importa il file XML HR.`
                : 'Nessun risultato per la ricerca corrente.'}
            </div>
          ) : (
            <>
              {pageSlice.map(c => (
                <CapitoloRow key={c.id} capitolo={c} />
              ))}
              {filtered.length > 0 && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mt-1">
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
        </div>
      )}
    </div>
  )
}

// ── Riga capitolo ─────────────────────────────────────────────

function CapitoloRow({ capitolo: c }: { capitolo: CapitoloAnagApi }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl
                    flex items-center gap-3 px-4 py-3 hover:bg-slate-800/50 transition">
      {/* Codice */}
      <span className="font-mono text-sm text-indigo-400 shrink-0 w-18">{c.codice}</span>

      {/* Descrizione */}
      <div className="flex-1 min-w-0">
        <span className="text-white text-sm">{c.descrizione ?? '—'}</span>
        {c.breve && c.breve !== c.descrizione && (
          <span className="ml-2 text-slate-500 text-xs">({c.breve})</span>
        )}
      </div>

      {/* Tipo liquidazione */}
      {c.tipoLiq && (
        <span className="shrink-0 text-xs px-1.5 py-0.5 rounded bg-slate-700/60
                         border border-slate-700 text-slate-400 font-mono hidden sm:inline">
          T{c.tipoLiq}
        </span>
      )}

      {/* Data modifica */}
      {c.dataMod && (
        <span className="shrink-0 text-xs text-slate-600 hidden lg:inline">
          {c.dataMod.slice(0, 10)}
        </span>
      )}
    </div>
  )
}
