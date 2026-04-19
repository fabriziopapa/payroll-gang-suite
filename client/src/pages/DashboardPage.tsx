// ============================================================
// PAYROLL GANG SUITE — Dashboard (lista bozze)
// ============================================================

import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { bozzeApi, type BozzaApi } from '../api/endpoints'
import { showToast } from '../components/ToastManager'
import { ConfirmDialog } from '../components/ConfirmDialog'

export default function DashboardPage() {
  const {
    bozze, setBozze, upsertBozza, removeBozza,
    newLiquidazione, loadBozzaInEditor,
    setLoading, isLoading,
    user,
  } = useStore()

  const [filter, setFilter] = useState<'tutte' | 'bozza' | 'archiviata'>('bozza')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [archiving, setArchiving] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Carica bozze al mount
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

  const filtered = bozze.filter(b =>
    filter === 'tutte' ? true : b.stato === filter,
  )

  const countBozze     = bozze.filter(b => b.stato === 'bozza').length
  const countArchiviate = bozze.filter(b => b.stato === 'archiviata').length

  async function handleArchive(b: BozzaApi) {
    setArchiving(b.id)
    try {
      const updated = b.stato === 'bozza'
        ? await bozzeApi.archive(b.id)
        : await bozzeApi.restore(b.id)
      upsertBozza(updated)
    } catch { showToast('Errore durante l\'operazione', 'error') }
    finally { setArchiving(null) }
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    try {
      await bozzeApi.delete(id)
      removeBozza(id)
    } catch { showToast('Errore eliminazione bozza', 'error') }
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
      ) : filtered.length === 0 ? (
        <EmptyState onNew={() => newLiquidazione()} filter={filter} />
      ) : (
        <div className="space-y-2">
          {filtered.map(b => (
            <BozzaCard
              key={b.id}
              bozza={b}
              isOwn={b.createdBy === user?.id}
              createdByUsername={b.createdByUsername}
              onOpen={() => loadBozzaInEditor(b)}
              onArchive={() => handleArchive(b)}
              onDelete={() => setConfirmDeleteId(b.id)}
              isArchiving={archiving === b.id}
              isDeleting={deleting === b.id}
            />
          ))}
        </div>
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
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────

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

function BozzaCard({ bozza, isOwn, createdByUsername, onOpen, onArchive, onDelete, isArchiving, isDeleting }: {
  bozza:              BozzaApi
  isOwn:              boolean
  createdByUsername:  string | null
  onOpen:             () => void
  onArchive:          () => void
  onDelete:           () => void
  isArchiving:        boolean
  isDeleting:         boolean
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
                    flex items-center gap-4 group hover:border-slate-700 transition">

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
        </div>
      </div>

      {/* Badge stato */}
      <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0
        ${isArchiviata
          ? 'text-slate-400 border-slate-700 bg-slate-800/50'
          : 'text-indigo-400 border-indigo-800 bg-indigo-900/30'}`}>
        {isArchiviata ? 'Archiviata' : 'Bozza'}
      </span>

      {/* Azioni
          - Bozza attiva: visibili solo su hover (opacity-0 → group-hover:opacity-100)
          - Archiviata:   sempre visibili (Ripristina + Elimina chiaramente accessibili) */}
      <div className={`flex items-center gap-1 transition
                       ${isArchiviata ? '' : 'opacity-0 group-hover:opacity-100'}`}>
        {!isArchiviata && (
          <button
            onClick={onOpen}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Apri editor"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        )}
        {/* Ripristina / Archivia */}
        <button
          onClick={onArchive}
          disabled={isArchiving}
          className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-amber-950/30 transition disabled:opacity-50"
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
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-950/30 transition disabled:opacity-50"
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
