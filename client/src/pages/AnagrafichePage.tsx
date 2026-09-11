// ============================================================
// PAYROLL GANG SUITE — Anagrafiche (Fase 2)
// ============================================================

import React, { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'
import { anagraficheApi } from '../api/endpoints'
import type { ImportXlsxResult } from '../api/endpoints'
import { downloadCsv } from '../utils/biz'
import Pagination from '../components/Pagination'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { usePageLoad } from '../hooks/usePageLoad'

// Area del conto su cui CSA paga. Non e' l'IBAN e non lo contiene: e' solo la
// classificazione calcolata in fase di estrazione SGE.
const AREA_CONTO_LABEL: Record<string, string> = {
  IT:       'IT',
  SEPA:     'SEPA',
  EXTRA_UE: 'Extra-UE',
  NON_NOTO: 'n.d.',
}
const AREA_CONTO_STYLE: Record<string, string> = {
  IT:       'bg-slate-800 text-slate-300',
  SEPA:     'bg-sky-900/50 text-sky-300',
  EXTRA_UE: 'bg-amber-900/50 text-amber-300',
  NON_NOTO: 'bg-slate-800/60 text-slate-500',
}

/**
 * L'estrazione da cui nasce questo elenco. Sta scritta a schermo e non solo
 * nella documentazione perche' e' l'unica cosa che, sbagliata, rende sbagliato
 * tutto il resto: un file prodotto da una query diversa puo' sembrare valido,
 * importarsi senza errori e far rispondere a PGS il ruolo sbagliato.
 */
const QUERY_SGE = {
  codice:      'RU_TAB',
  descrizione: 'Tabella ru verifica tipo iban @papa',
  dove:        'Esse3 → Elaborazioni query',
} as const

export default function AnagrafichePage() {
  const { anagrafiche, setAnagrafiche } = useStore()
  const [lastImport, setLastImport] = useState<string | null>(null)
  const [importingXlsx, setImportingXlsx]         = useState(false)
  const [importResult, setImportResult]           = useState<string | null>(null)
  // Il referto per intero: senza, gli errori si possono solo contare.
  const [importErrori, setImportErrori]           = useState<ImportXlsxResult['errors']>([])
  const [importNomeFile, setImportNomeFile]       = useState<string>('')
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
    setImportErrori([])
    setImportNomeFile(file.name)
    try {
      const base64  = await readFileAsBase64(file)
      const result  = await anagraficheApi.importXlsx(base64, file.name)
      setImportErrori(result.errors)
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

  /** Gli errori come CSV, per poterli guardare uno per uno invece che contarli.
   *  `downloadCsv` scrive in Windows-1252 come il resto dell'applicazione: il
   *  file si apre in Excel senza passare dalla procedura di importazione. */
  function scaricaErrori() {
    if (importErrori.length === 0) return
    const righe = [
      'riga;messaggio',
      ...importErrori.map(e => `${e.row};"${(e.message ?? '').replace(/"/g, '""')}"`),
    ]
    const base  = importNomeFile.replace(/\.xlsx$/i, '') || 'import'
    const oggi  = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    downloadCsv(righe.join('\r\n') + '\r\n', `errori_import_${base}_${oggi}.csv`)
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
        (a.druolo ?? '').toLowerCase().includes(q) ||
        (a.areaConto ?? '').toLowerCase().includes(q)
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
          <p className="text-slate-500 text-xs mt-2 leading-relaxed">
            Il file va prodotto <span className="text-slate-400">sempre</span> con la query
            {' '}<span className="font-mono text-slate-300">{QUERY_SGE.codice}</span>
            {' '}— «{QUERY_SGE.descrizione}» — in {QUERY_SGE.dove}.
            <br />
            Un&rsquo;estrazione fatta con una query diversa puo&rsquo; importarsi senza errori
            e far rispondere a PGS il ruolo sbagliato.
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
        <div className={`mb-4 p-3 rounded-lg border text-sm ${
          importErrori.length > 0
            ? 'bg-amber-950/30 border-amber-800/60 text-amber-200'
            : 'bg-slate-800 border-slate-700 text-slate-300'
        }`}>
          <div className="flex items-start gap-3">
            <span className="flex-1">{importResult}</span>
            {importErrori.length > 0 && (
              <button
                onClick={scaricaErrori}
                title="Scarica l'elenco completo degli errori in CSV"
                className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium
                           bg-amber-900/50 border border-amber-700/60 text-amber-100
                           hover:bg-amber-900/80 transition"
              >
                Scarica gli errori ({importErrori.length})
              </button>
            )}
          </div>

          {importErrori.length > 0 && (
            <>
              {/* Le prime a schermo: spesso bastano a capire di che si tratta.
                  Le altre stanno nel CSV, che e' il posto giusto per leggerle. */}
              <ul className="mt-2 space-y-0.5 text-xs text-amber-300/90">
                {importErrori.slice(0, 5).map((e, i) => (
                  <li key={i}>
                    <span className="font-mono text-amber-400/80">riga {e.row}</span>
                    {' · '}{e.message}
                  </li>
                ))}
              </ul>
              {importErrori.length > 5 && (
                <p className="mt-1 text-xs text-amber-500/70">
                  e altri {importErrori.length - 5}: sono tutti nel file.
                </p>
              )}
              <p className="mt-2 text-xs text-amber-500/70">
                Le righe in errore <span className="text-amber-300">non sono state importate</span>.
                Per quelle con chiave duplicata (stessa matricola e stessa decorrenza) in anagrafica
                ne resta una sola: l&rsquo;altra va guardata a mano.
              </p>
            </>
          )}
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
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Conto</th>
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
                    <td className="px-4 py-2.5">
                      {a.areaConto ? (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${AREA_CONTO_STYLE[a.areaConto] ?? 'bg-slate-800 text-slate-400'}`}>
                          {AREA_CONTO_LABEL[a.areaConto] ?? a.areaConto}
                        </span>
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
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
