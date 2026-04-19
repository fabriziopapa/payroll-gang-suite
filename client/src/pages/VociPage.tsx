// ============================================================
// PAYROLL GANG SUITE — Voci HR
// ============================================================

import React, { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'
import { vociApi, type VoceApi } from '../api/endpoints'
import { sendXmlInChunks, type ChunkProgress } from '../utils/xmlChunker'
import Pagination from '../components/Pagination'
import { usePageLoad } from '../hooks/usePageLoad'

export default function VociPage() {
  const { voci, setVoci } = useStore()
  const [lastImport, setLastImport] = useState<string | null>(null)
  const [importing, setImporting]     = useState(false)
  const [progress, setProgress]       = useState<ChunkProgress | null>(null)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [search, setSearch]         = useState('')
  const [expanded, setExpanded]     = useState<number | null>(null)
  const [page, setPage]             = useState(1)
  const [pageSize, setPageSize]     = useState(20)

  const { isLoading, loadError } = usePageLoad(
    async () => {
      const [data, li] = await Promise.all([vociApi.active(), vociApi.lastImport()])
      setVoci(data)
      setLastImport(li.lastImport)
    },
    [setVoci],
    'Impossibile caricare le voci. Controlla la connessione e riprova.',
  )

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
        80,                                          // 80 righe per batch
        chunk => vociApi.importXml(chunk),
        p => setProgress(p),
      )
      setImportResult(
        `✓ Import completato: ${result.inserted} inserite, ${result.updated} aggiornate` +
        (result.errors.length ? `, ${result.errors.length} errori` : '') + '.',
      )
      const [data, li] = await Promise.all([vociApi.active(), vociApi.lastImport()])
      setVoci(data)
      setLastImport(li.lastImport)
    } catch (err: unknown) {
      setImportResult(`Errore: ${(err as Error).message}`)
    } finally {
      setImporting(false)
      setProgress(null)
      e.target.value = ''
    }
  }

  const filtered = voci.filter(v =>
    !search ||
    v.codice.includes(search) ||
    v.descrizione.toLowerCase().includes(search.toLowerCase()),
  )

  useEffect(() => { setPage(1) }, [search, pageSize])

  const pageSlice = filtered.slice((page - 1) * pageSize, page * pageSize)

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">Voci HR</h2>
          <p className="text-slate-400 text-sm mt-0.5">
            {voci.length} voci attive
            {lastImport && ` · Ultimo import: ${new Date(lastImport).toLocaleDateString('it-IT')}`}
          </p>
        </div>
        <label className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer
          ${importing ? 'bg-slate-700 text-slate-400' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}
          text-sm font-medium transition shrink-0`}>
          {importing ? (
            <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>{progress ? `Batch ${progress.current}/${progress.total}…` : 'Importazione…'}</>
          ) : (
            <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
            </svg>Importa XML</>
          )}
          <input type="file" accept=".xml" className="hidden" onChange={handleImport} disabled={importing}/>
        </label>
      </div>

      {/* Progress bar chunked upload */}
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

      <div className="mb-4">
        <input
          type="text"
          placeholder="Cerca per codice o descrizione…"
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
              {voci.length === 0 ? 'Nessuna voce. Importa un file XML HR.' : 'Nessun risultato.'}
            </div>
          ) : (
            <>
              {pageSlice.map(v => (
                <VoceRow
                  key={v.id}
                  voce={v}
                  expanded={expanded === v.id}
                  onToggle={() => setExpanded(expanded === v.id ? null : v.id)}
                />
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

function VoceRow({ voce, expanded, onToggle }: {
  voce: VoceApi; expanded: boolean; onToggle: () => void
}) {
  const isIllimitata = voce.dataFin === '22220202'
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-800/50 transition"
      >
        <span className="font-mono text-sm text-indigo-400 shrink-0 w-16">{voce.codice}</span>
        <span className="text-white text-sm flex-1 truncate">{voce.descrizione}</span>
        <span className="text-xs text-slate-500 shrink-0 hidden sm:block">
          {voce.dataIn.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}
          {!isIllimitata && ` → ${voce.dataFin.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}`}
        </span>
        {voce.capitoli.length > 0 && (
          <span className="text-xs text-slate-400 shrink-0">
            {voce.capitoli.length} cap.
          </span>
        )}
        <svg
          className={`w-4 h-4 text-slate-500 transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
        </svg>
      </button>
      {expanded && voce.capitoli.length > 0 && (
        <div className="border-t border-slate-800 px-4 py-2 space-y-1">
          {voce.capitoli.map(c => (
            <div key={c.codice} className="flex items-center gap-3 py-1">
              <span className="font-mono text-xs text-slate-400 w-20">{c.codice}</span>
              <span className="text-slate-300 text-sm">{c.descrizione ?? '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
