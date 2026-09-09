// ============================================================
// PAYROLL GANG SUITE — Dashboard (lista bozze)
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { bozzeApi, type BozzaApi } from '../api/endpoints'
import { showToast } from '../components/ToastManager'
import { ConfirmDialog } from '../components/ConfirmDialog'
import CopiaLiquidazioneModal from '../components/CopiaLiquidazioneModal'
import { useDebounce } from '../hooks/useDebounce'
import { hasCriteria, hasTargeted, EMPTY_CRITERIA, type GroupSearchCriteria } from '../utils/groupSearch'
import ArchiviaLiquidazioneModal from '../components/ArchiviaLiquidazioneModal'

const PAGE_SIZE = 6

export default function DashboardPage() {
  const {
    bozze, setBozze, upsertBozza, removeBozza,
    newLiquidazione, loadBozzaInEditor, loadBozzaInViewer,
    setLoading, isLoading,
    user,
  } = useStore()

  const [filter, setFilter]               = useState<'tutte' | 'bozza' | 'archiviata'>('bozza')
  const [page, setPage]                   = useState(1)
  const [deleting, setDeleting]           = useState<string | null>(null)
  const [archiving, setArchiving]         = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  // Bozza sorgente per la copia — caricata completa (con dati) via getById
  const [copiaSource, setCopiaSource]     = useState<BozzaApi | null>(null)
  const [copying, setCopying]             = useState<string | null>(null)
  // Bozza in attesa dei dati di archiviazione (data liquidazione + ID CSA)
  const [archiviaTarget, setArchiviaTarget] = useState<BozzaApi | null>(null)

  // ── Ricerca liquidazioni / gruppi ─────────────────────────
  const [crit, setCrit]           = useState<GroupSearchCriteria>(EMPTY_CRITERIA)
  const [advanced, setAdvanced]   = useState(false)
  const setField = (k: keyof GroupSearchCriteria) => (v: string) =>
    setCrit(c => ({ ...c, [k]: v }))
  // Debounce dell'intera criteria (serializzata) per non rifiltrare a ogni tasto
  const debKey   = useDebounce(JSON.stringify(crit), 250)
  const criteria = useMemo(() => JSON.parse(debKey) as GroupSearchCriteria, [debKey])
  const searchActive = hasCriteria(criteria)
  // Ricerca lato server: i campi dei gruppi vivono nel JSONB `dati` (non nella
  // lista leggera). Il server filtra e ritorna solo i riepiloghi → nessun `dati`
  // sul filo, Dashboard sempre leggera.
  const [searchResults, setSearchResults] = useState<BozzaApi[] | null>(null)
  const [searching, setSearching] = useState(false)
  // Bump per rieseguire la ricerca dopo una mutazione (archivia/elimina/copia)
  const [refreshTick, setRefreshTick] = useState(0)
  const bumpSearch = () => setRefreshTick(t => t + 1)

  // Carica bozze al mount (lista leggera, per conteggi e vista di default)
  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const data = await bozzeApi.list()
        setBozze(data)
      } catch {
        // silently fail — array rimane []
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [setBozze, setLoading])

  // Ricerca server-side (criteria già debounced). Nessun loading-flag nelle deps
  // → l'effetto non si auto-annulla.
  useEffect(() => {
    if (!searchActive) { setSearchResults(null); setSearching(false); return }
    let cancelled = false
    setSearching(true)
    bozzeApi.search({
      stato:       filter === 'tutte' ? undefined : filter,
      text:        criteria.text,
      titolo:      criteria.titolo,
      voce:        criteria.voce,
      capitolo:    criteria.capitolo,
      idProv:      criteria.idProv,
      centroCosto: criteria.centroCosto,
      note:        criteria.note,
      from:        criteria.compFrom,
      to:          criteria.compTo,
    })
      .then(res => { if (!cancelled) setSearchResults(res) })
      .catch(() => { if (!cancelled) setSearchResults([]) })
      .finally(() => { if (!cancelled) setSearching(false) })
    return () => { cancelled = true }
  }, [searchActive, criteria, filter, refreshTick])

  const filtered = useMemo(() => {
    if (searchActive) return searchResults ?? []
    return bozze.filter(b => filter === 'tutte' ? true : b.stato === filter)
  }, [searchActive, searchResults, bozze, filter])

  const totalPages  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pagedItems  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const countBozze      = bozze.filter(b => b.stato === 'bozza').length
  const countArchiviate = bozze.filter(b => b.stato === 'archiviata').length

  // reset page on filter change
  useEffect(() => { setPage(1) }, [filter, criteria])

  // FIX H-1: GET /bozze lista non include `dati` JSONB.
  // Prima del caricamento in editor/viewer, fetcha bozza completa via GET /bozze/:id.
  async function handleOpenEditor(b: BozzaApi) {
    try {
      const full = await bozzeApi.getById(b.id)
      loadBozzaInEditor(full)
    } catch { showToast("Errore nell'apertura della liquidazione", 'error') }
  }

  async function handleOpenViewer(b: BozzaApi) {
    try {
      const full = await bozzeApi.getById(b.id)
      loadBozzaInViewer(full)
    } catch { showToast("Errore nell'apertura dell'anteprima", 'error') }
  }

  // Bozza attiva → apre il modal dati archiviazione; archiviata → ripristino diretto
  async function handleArchive(b: BozzaApi) {
    if (b.stato === 'bozza') { setArchiviaTarget(b); return }
    setArchiving(b.id)
    try {
      upsertBozza(await bozzeApi.restore(b.id))
      if (searchActive) bumpSearch()
    } catch { showToast('Errore durante l\'operazione', 'error') }
    finally { setArchiving(null) }
  }

  // GET /bozze lista non include `dati` — fetch completo prima del modal copia
  async function handleCopia(b: BozzaApi) {
    setCopying(b.id)
    try {
      const full = await bozzeApi.getById(b.id)
      setCopiaSource(full)
    } catch { showToast('Errore nel caricamento della liquidazione da copiare', 'error') }
    finally { setCopying(null) }
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    try {
      await bozzeApi.delete(id)
      removeBozza(id)
      if (searchActive) bumpSearch()
    } catch { showToast("Errore durante l'eliminazione della bozza", 'error') }
    finally { setDeleting(null) }
  }

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">Dashboard</h2>
          <p className="text-slate-400 text-sm mt-0.5">Gestione liquidazioni variabili</p>
        </div>
        <button
          onClick={() => newLiquidazione()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600
                     hover:bg-indigo-500 text-white text-sm font-medium transition shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nuova liquidazione
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <StatCard label="Bozze attive"    value={countBozze}     color="indigo" />
        <StatCard label="Archiviate"      value={countArchiviate} color="slate" />
      </div>

      {/* Ricerca liquidazioni / gruppi */}
      <div className="mb-4 space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500"
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={crit.text}
              onChange={e => setField('text')(e.target.value)}
              placeholder="Cerca ovunque: nome liquidazione, titolo gruppo, voce, capitolo, ID provvedimento, centro di costo, note…"
              className="w-full pl-9 pr-9 py-2 rounded-lg bg-slate-800 border border-slate-700
                         text-white text-sm placeholder:text-slate-500
                         focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-transparent"
            />
            {searchActive && (
              <button
                onClick={() => setCrit(EMPTY_CRITERIA)}
                title="Azzera ricerca"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-500 hover:text-white hover:bg-slate-700 transition"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            )}
          </div>
          <button
            onClick={() => setAdvanced(v => !v)}
            title="Ricerca mirata per campo"
            className={`px-3 py-2 rounded-lg text-sm border transition shrink-0
              ${advanced || hasTargeted(criteria)
                ? 'bg-indigo-600/20 text-indigo-400 border-indigo-700'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'}`}
          >
            Ricerca mirata
          </button>
        </div>

        {(advanced || hasTargeted(criteria)) && (
          <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            <FieldMini label="Titolo gruppo"    value={crit.titolo}      onChange={setField('titolo')} />
            <FieldMini label="Voce"             value={crit.voce}        onChange={setField('voce')} />
            <FieldMini label="Capitolo"         value={crit.capitolo}    onChange={setField('capitolo')} />
            <FieldMini label="ID provvedimento" value={crit.idProv}      onChange={setField('idProv')} mono />
            <FieldMini label="Centro di costo"  value={crit.centroCosto} onChange={setField('centroCosto')} />
            <FieldMini label="Note"             value={crit.note}        onChange={setField('note')} />
            <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-slate-500">Data competenza voce:</span>
              <label className="flex items-center gap-1.5 text-slate-400 text-sm">
                dal
                <input type="date" value={crit.compFrom} onChange={e => setField('compFrom')(e.target.value)}
                  className="px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-sm
                             [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </label>
              <label className="flex items-center gap-1.5 text-slate-400 text-sm">
                al
                <input type="date" value={crit.compTo} onChange={e => setField('compTo')(e.target.value)}
                  className="px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-sm
                             [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </label>
            </div>
          </div>
        )}

        {searchActive && (
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            {searching ? (
              <>
                <svg className="animate-spin w-3.5 h-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Ricerca in corso…
              </>
            ) : `${filtered.length} liquidazioni corrispondono`}
          </p>
        )}
      </div>

      {/* Filtri */}
      <div className="flex gap-1 mb-4 bg-slate-800/50 p-1 rounded-lg w-fit">
        {(['bozza', 'archiviata', 'tutte'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition
              ${filter === f
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-white'}`}
          >
            {f === 'bozza' ? 'Bozze' : f === 'archiviata' ? 'Archiviate' : 'Tutte'}
          </button>
        ))}
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <svg className="animate-spin w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : searchActive && searching && filtered.length === 0 ? (
        <div className="space-y-2" aria-busy="true" aria-label="Ricerca in corso">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 && searchActive ? (
        <div className="text-center py-16 text-slate-500 text-sm">
          Nessuna liquidazione corrisponde alla ricerca.
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState onNew={() => newLiquidazione()} filter={filter} />
      ) : (
        <>
          <div className="space-y-2">
            {pagedItems.map(b => (
              <BozzaCard
                key={b.id}
                bozza={b}
                isOwn={b.createdBy === user?.id}
                createdByUsername={b.createdByUsername}
                onOpen={() => handleOpenEditor(b)}
                onView={() => handleOpenViewer(b)}
                onArchive={() => handleArchive(b)}
                onDelete={() => setConfirmDeleteId(b.id)}
                onCopy={() => handleCopia(b)}
                isArchiving={archiving === b.id}
                isDeleting={deleting === b.id}
                isCopying={copying === b.id}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 px-1 text-sm text-slate-400">
              <span>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} di {filtered.length}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="min-w-[2.5rem] min-h-[2.5rem] px-2 rounded-md hover:bg-slate-800
                             transition disabled:opacity-30 disabled:cursor-not-allowed
                             flex items-center justify-center"
                >‹</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`min-w-[2.5rem] min-h-[2.5rem] px-2 rounded-md transition
                      flex items-center justify-center font-medium
                      ${p === page ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800'}`}
                  >{p}</button>
                ))}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="min-w-[2.5rem] min-h-[2.5rem] px-2 rounded-md hover:bg-slate-800
                             transition disabled:opacity-30 disabled:cursor-not-allowed
                             flex items-center justify-center"
                >›</button>
              </div>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Elimina liquidazione"
        message={(() => {
          const b = bozze.find(x => x.id === confirmDeleteId)
          return b?.stato === 'archiviata'
            ? `Eliminare definitivamente «${b.nome}»? La liquidazione è archiviata e verrà rimossa in modo permanente. L'operazione non può essere annullata.`
            : "Eliminare definitivamente questa liquidazione? L'operazione non può essere annullata."
        })()}
        danger
        confirmLabel="Elimina"
        onConfirm={() => { if (confirmDeleteId) handleDelete(confirmDeleteId); setConfirmDeleteId(null) }}
        onCancel={() => setConfirmDeleteId(null)}
      />

      {archiviaTarget && (
        <ArchiviaLiquidazioneModal
          mode="archivia"
          nome={archiviaTarget.nome}
          initialData={archiviaTarget}
          onConfirm={async info => {
            try {
              const updated = await bozzeApi.archive(archiviaTarget.id, info)
              upsertBozza(updated)
              if (searchActive) bumpSearch()
              setArchiviaTarget(null)
              showToast(`«${updated.nome}» archiviata`, 'success')
            } catch { showToast("Errore durante l'archiviazione", 'error') }
          }}
          onClose={() => setArchiviaTarget(null)}
        />
      )}

      {copiaSource && (
        <CopiaLiquidazioneModal
          bozza={copiaSource}
          onClose={() => setCopiaSource(null)}
          onCreated={nuova => {
            upsertBozza(nuova)
            setCopiaSource(null)
            showToast(`Creata «${nuova.nome}»`, 'success')
          }}
        />
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4 animate-pulse">
      <div className="w-9 h-9 rounded-lg bg-slate-800 shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="h-3.5 bg-slate-800 rounded w-2/3" />
        <div className="h-2.5 bg-slate-800/70 rounded w-1/3" />
      </div>
      <div className="w-16 h-5 rounded-full bg-slate-800 shrink-0" />
    </div>
  )
}

function FieldMini({ label, value, onChange, mono }: {
  label: string; value: string; onChange: (v: string) => void; mono?: boolean
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-slate-500 mb-1">{label}</span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`w-full px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700
                    text-white text-sm placeholder:text-slate-600
                    focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-transparent
                    ${mono ? 'font-mono' : ''}`}
      />
    </label>
  )
}

function StatCard({ label, value, color }: {
  label: string; value: number; color: 'indigo' | 'slate'
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${color === 'indigo' ? 'text-indigo-400' : 'text-slate-300'}`}>
        {value}
      </p>
    </div>
  )
}

function BozzaCard({ bozza, isOwn, createdByUsername, onOpen, onView, onArchive, onDelete, onCopy, isArchiving, isDeleting, isCopying }: {
  bozza:              BozzaApi
  isOwn:              boolean
  createdByUsername:  string | null
  onOpen:             () => void
  onView:             () => void
  onArchive:          () => void
  onDelete:           () => void
  onCopy:             () => void
  isArchiving:        boolean
  isDeleting:         boolean
  isCopying:          boolean
}) {
  const isArchiviata = bozza.stato === 'archiviata'
  const createdAt    = new Date(bozza.createdAt).toLocaleDateString('it-IT', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
  const updatedAt    = new Date(bozza.updatedAt).toLocaleDateString('it-IT', {
    day: '2-digit', month: 'short', year: 'numeric',
  })

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4
                    flex items-center gap-4 hover:border-slate-700 transition">

      {/* Icona stato */}
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0
                       ${isArchiviata ? 'bg-slate-800' : 'bg-indigo-600/20'}`}>
        {isArchiviata ? (
          <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-white font-medium text-sm truncate">{bozza.nome}</p>
          {/* Badge creatore */}
          {createdByUsername && (
            <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded border font-medium
              ${isOwn
                ? 'bg-indigo-900/30 border-indigo-800/60 text-indigo-400'
                : 'bg-violet-900/40 border-violet-700/50 text-violet-400'}`}
            >
              {isOwn ? 'Tu' : createdByUsername}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          {bozza.protocolloDisplay && (
            <span className="text-xs text-slate-500 truncate">{bozza.protocolloDisplay}</span>
          )}
          <span className="text-xs text-slate-600">
            {createdAt !== updatedAt ? `Modificato ${updatedAt}` : `Creato ${createdAt}`}
          </span>
          {isArchiviata && bozza.dataLiquidazione && (
            <span className="text-xs text-amber-500/80">
              Liquidata {new Date(bozza.dataLiquidazione).toLocaleDateString('it-IT', {
                day: '2-digit', month: 'short', year: 'numeric',
              })}
            </span>
          )}
          {isArchiviata && bozza.idLiquidazioneCsa && (
            <span className="text-xs font-mono text-slate-500 truncate" title="ID liquidazione CSA">
              {bozza.idLiquidazioneCsa}
            </span>
          )}
        </div>
      </div>

      {/* Badge stato */}
      <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0
        ${isArchiviata
          ? 'text-slate-400 border-slate-700 bg-slate-800/50'
          : 'text-indigo-400 border-indigo-800 bg-indigo-900/30'}`}>
        {isArchiviata ? 'Archiviata' : 'Bozza'}
      </span>

      {/* Azioni — sempre visibili, touch target ≥ 44px su mobile */}
      <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
        {!isArchiviata ? (
          <button
            onClick={onOpen}
            className="p-2 sm:p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Apri editor"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        ) : (
          <button
            onClick={onView}
            className="p-2 sm:p-1.5 rounded-lg text-slate-400 hover:text-sky-400 hover:bg-sky-950/30 transition"
            title="Visualizza (sola lettura)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </button>
        )}
        {/* Copia liquidazione — tutti gli utenti, anche su archiviate */}
        <button
          onClick={onCopy}
          disabled={isCopying}
          className="p-2 sm:p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-emerald-950/30 transition disabled:opacity-50"
          title="Copia liquidazione (senza nominativi)"
        >
          {isCopying ? (
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          )}
        </button>
        {/* Ripristina / Archivia */}
        <button
          onClick={onArchive}
          disabled={isArchiving}
          className="p-2 sm:p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-amber-950/30 transition disabled:opacity-50"
          title={isArchiviata ? 'Ripristina' : 'Archivia'}
        >
          {isArchiving ? (
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : isArchiviata ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
          )}
        </button>
        {/* Elimina — solo il proprietario; per le archiviate sempre visibile */}
        {isOwn && (
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="p-2 sm:p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-950/30 transition disabled:opacity-50"
            title="Elimina definitivamente"
          >
            {isDeleting ? (
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  )
}

function EmptyState({ onNew, filter }: { onNew: () => void; filter: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center mb-4">
        <svg className="w-6 h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <p className="text-slate-300 font-medium">
        {filter === 'archiviata' ? 'Nessuna bozza archiviata' : 'Nessuna bozza'}
      </p>
      <p className="text-slate-500 text-sm mt-1">
        {filter === 'archiviata'
          ? 'Le bozze archiviate appariranno qui'
          : 'Crea la tua prima liquidazione per iniziare'}
      </p>
      {filter !== 'archiviata' && (
        <button
          onClick={onNew}
          className="mt-4 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500
                     text-white text-sm font-medium transition"
        >
          Nuova liquidazione
        </button>
      )}
    </div>
  )
}
