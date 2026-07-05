// ============================================================
// PAYROLL GANG SUITE — Anagrafiche (Fase 2)
// ============================================================

import React, { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'
import { anagraficheApi } from '../api/endpoints'
import Pagination from '../components/Pagination'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { usePageLoad } from '../hooks/usePageLoad'

export default function AnagrafichePage() {
  const { anagrafiche, setAnagrafiche } = useStore()
  const [lastImport, setLastImport] = useState<string | null>(null)
  const [importingXlsx, setImportingXlsx]         = useState(false)
  const [importResult, setImportResult]           = useState<string | null>(null)
  const [confirmImportXlsx, setConfirmImportXlsx] = useState<File | null>(null)
  const [search, setSearch]     = useState('')
  const [page, setPage]         = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const { isLoading, loadError } = usePageLoad(
    async () => {
      const [data, li] = await Promise.all([anagraficheApi.list(), anagraficheApi.lastImport()])
      setAnagrafiche(data)
      setLastImport(li.lastImport)
    },
    [setAnagrafiche],
    'Impossibile caricare le anagrafiche. Controlla la connessione e riprova.',
  )

  function handleImportXlsx(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setConfirmImportXlsx(file)
  }

  /** Legge un File come stringa base64 via FileReader — safe su file di qualsiasi dimensione */
  function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload  = () => resolve((reader.result as string).split(',')[1] ?? '')
      reader.onerror = () => reject(new Error('Lettura file fallita'))
      reader.readAsDataURL(file)
    })
  }

  async function doImportXlsx(file: File) {
    setConfirmImportXlsx(null)
    setImportingXlsx(true)
    setImportResult(null)
    try {
      const base64  = await readFileAsBase64(file)
      const result  = await anagraficheApi.importXlsx(base64, file.name)
      setImportResult(
        `✓ Import SGE: ${result.inserted} inseriti, ${result.updated} aggiornati, ${result.skipped} invariati` +
        (result.errors.length ? `, ${result.errors.length} errori` : '') + `.`,
      )
      const [data, li] = await Promise.all([anagraficheApi.list(), anagraficheApi.lastImport()])
      setAnagrafiche(data)
      setLastImport(li.lastImport)
    } catch (err: unknown) {
      setImportResult(`Errore import XLSX: ${(err as Error).message}`)
    } finally {
      setImportingXlsx(false)
    }
  }

  // Filtra + raggruppa per matricola → 1 riga per persona, N ruoli come badge
  const grouped = React.useMemo(() => {
    const map = new Map<string, { record: typeof anagrafiche[0]; ruoli: string[] }>()
    for (const a of anagrafiche) {
      const q = search.toLowerCase()
      const match = !search ||
        (a.matricola ?? '').includes(search) ||
        (a.cognNome ?? '').toLowerCase().includes(q) ||
        (a.ruolo ?? '').toLowerCase().includes(q) ||
        (a.druolo ?? '').toLowerCase().includes(q)
      if (!match) continue

      if (!map.has(a.matricola)) {
        map.set(a.matricola, { record: a, ruoli: [a.ruolo] })
      } else {
        const g = map.get(a.matricola)!
        if (!g.ruoli.includes(a.ruolo)) g.ruoli.push(a.ruolo)
      }
    }
    return Array.from(map.values())
  }, [anagrafiche, search])

  // Reset pagina se cambia la ricerca o il pageSize
  useEffect(() => { setPage(1) }, [search, pageSize])

  const pageSlice = grouped.slice((page - 1) * pageSize, page * pageSize)

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">Anagrafiche</h2>
          <p className="text-slate-400 text-sm mt-0.5">
            Personale importato da XLSX SGE
            {lastImport && ` · Ultimo import: ${new Date(lastImport).toLocaleDateString('it-IT')}`}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {/* Import XLSX SGE */}
          <label className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer
            ${importingXlsx ? 'bg-slate-700 text-slate-400' : 'bg-emerald-700 hover:bg-emerald-600 text-white'}
            text-sm font-medium transition`}>
            {importingXlsx ? (
              <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>Caricamento…</>
            ) : (
              <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
              </svg>Importa XLSX SGE</>
            )}
            <input type="file" accept=".xlsx" className="hidden" onChange={handleImportXlsx} disabled={importingXlsx}/>
          </label>
          {/* Import XML HR — rimosso: SGE XLSX è fonte autoritativa */}
        </div>
      </div>

      {importResult && (
        <div className="mb-4 p-3 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-300">
          {importResult}
        </div>
      )}

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Cerca per matricola, nome o ruolo…"
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
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          {grouped.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-sm">
              {anagrafiche.length === 0
                ? 'Nessuna anagrafica. Importa un file XLSX SGE.'
                : 'Nessun risultato per la ricerca.'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Matricola</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Cognome Nome</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Ruolo/i attivi</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium hidden md:table-cell">Dal</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium hidden lg:table-cell">Agg.</th>
                </tr>
              </thead>
              <tbody>
                {pageSlice.map(({ record: a, ruoli }) => (
                  <tr key={a.matricola} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition">
                    <td className="px-4 py-2.5 text-slate-300 font-mono text-xs">{a.matricola}</td>
                    <td className="px-4 py-2.5 text-white">{a.cognNome}</td>
                    <td className="px-4 py-2.5">
                      {/* Badge per ogni ruolo distinto — inline su stessa riga */}
                      <span className="flex flex-wrap gap-1 items-center">
                        {ruoli.map(r => (
                          <span key={r} className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                            {r}
                          </span>
                        ))}
                        {a.druolo && ruoli.length === 1 && (
                          <span className="text-slate-500 text-xs hidden lg:inline">{a.druolo}</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs hidden md:table-cell font-mono">
                      {a.decorInq}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs hidden lg:table-cell">
                      {new Date(a.dataAggiornamento).toLocaleDateString('it-IT')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {grouped.length > 0 && (
            <Pagination
              total={grouped.length}
              pageSize={pageSize}
              page={page}
              onPageChange={setPage}
              onPageSizeChange={s => { setPageSize(s); setPage(1) }}
            />
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmImportXlsx}
        title="Importa XLSX SGE"
        message={`Il file "${confirmImportXlsx?.name}" verrà importato nel database (import differenziale). I record invariati saranno saltati. Continuare?`}
        danger
        confirmLabel="Importa XLSX"
        onConfirm={() => { if (confirmImportXlsx) doImportXlsx(confirmImportXlsx) }}
        onCancel={() => setConfirmImportXlsx(null)}
      />
    </div>
  )
}
