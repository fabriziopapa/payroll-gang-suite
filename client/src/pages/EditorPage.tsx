// ============================================================
// PAYROLL GANG SUITE — EditorPage
// Orchestratore editor liquidazione: gruppi, nominativi,
// salvataggio bozza, export CSV HR
// ============================================================

import { useState, useMemo, useRef } from 'react'
import { useStore } from '../store/useStore'
import { bozzeApi } from '../api/endpoints'
import { buildCsvRows, serializeCsv, downloadCsv } from '../utils/biz'
import DettaglioCard       from '../components/editor/DettaglioCard'
import DettaglioFormModal  from '../components/editor/DettaglioFormModal'
import NominativoFormModal from '../components/editor/NominativoFormModal'
import TotaliSidebar       from '../components/editor/TotaliSidebar'
import type { DettaglioLiquidazione } from '../types'

export default function EditorPage() {
  const {
    dettagli, nominativi, settings,
    currentBozzaId, currentBozzaNome, protocolloDisplay, isDirty,
    upsertBozza, markSaved,
    setCurrentBozzaNome,
  } = useStore()

  // ── Modal state ───────────────────────────────────────────
  const [dettaglioModal, setDettaglioModal] = useState<{
    open: boolean
    existing?: DettaglioLiquidazione
  }>({ open: false })

  const [nominativoModal, setNominativoModal] = useState<{
    open: boolean
    dettaglio?: DettaglioLiquidazione
  }>({ open: false })

  // ── UI state ──────────────────────────────────────────────
  const [saving, setSaving]         = useState(false)
  const [saveError, setSaveError]   = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [editingNome, setEditingNome] = useState(false)
  const [tempNome, setTempNome]     = useState(currentBozzaNome)
  const savingRef                   = useRef(false)

  // ── Salva bozza ───────────────────────────────────────────
  async function handleSave() {
    if (savingRef.current) return   // guard against concurrent calls
    savingRef.current = true
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      // Read currentBozzaId from live store state, not stale closure
      const liveId = useStore.getState().currentBozzaId
      const { nominativi: liveNoms, dettagli: liveDets, protocolloDisplay: liveProt, comunicazioni: liveCom, currentBozzaNome: liveNome } = useStore.getState()
      const dati = { nominativi: liveNoms, dettagli: liveDets, protocolloDisplay: liveProt, comunicazioni: liveCom }
      let saved
      if (liveId) {
        saved = await bozzeApi.update(liveId, {
          nome: liveNome,
          dati,
          ...(liveProt ? { protocolloDisplay: liveProt } : {}),
        })
      } else {
        saved = await bozzeApi.create(liveNome, dati, liveProt || undefined)
      }
      upsertBozza(saved)
      markSaved(saved.id)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err: unknown) {
      setSaveError((err as Error).message ?? 'Errore durante il salvataggio.')
    } finally {
      setSaving(false)
      savingRef.current = false
    }
  }

  // ── Export CSV ────────────────────────────────────────────
  function handleExportCsv() {
    const rows     = buildCsvRows(dettagli, nominativi, settings.coefficienti, settings.coefficientiContoTerzi)
    const csv      = serializeCsv(rows)
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const nomePart = currentBozzaNome.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30)
    downloadCsv(csv, `liquidazione_${nomePart}_${datePart}.csv`)
  }

  // ── Export TXT matricole per ruolo (tutti i gruppi) ──────
  function handleDownloadMatricoleTxt() {
    const byRuolo: Record<string, Set<string>> = {}
    for (const nom of nominativi) {
      if (!byRuolo[nom.ruolo]) byRuolo[nom.ruolo] = new Set()
      byRuolo[nom.ruolo]!.add(nom.matricola)
    }
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const nomePart = currentBozzaNome.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30)
    Object.entries(byRuolo).forEach(([ruolo, matricole], i) => {
      setTimeout(() => {
        const blob = new Blob([[...matricole].join('\n') + '\n'], { type: 'text/plain;charset=utf-8' })
        const url  = URL.createObjectURL(blob)
        const a    = Object.assign(document.createElement('a'), {
          href: url, download: `matricole_${nomePart}_${ruolo}_${datePart}.txt`,
        })
        a.click()
        URL.revokeObjectURL(url)
      }, i * 150)
    })
  }

  // ── Rinomina bozza ────────────────────────────────────────
  function commitNome() {
    const n = tempNome.trim()
    if (n && n !== currentBozzaNome) setCurrentBozzaNome(n)
    setEditingNome(false)
  }

  const totalNoms = nominativi.length
  const canExport = dettagli.length > 0 && totalNoms > 0
  const csvRows   = useMemo(
    () => canExport ? buildCsvRows(dettagli, nominativi, settings.coefficienti, settings.coefficientiContoTerzi) : [],
    [dettagli, nominativi, settings.coefficienti, settings.coefficientiContoTerzi, canExport],
  )

  return (
    <div className="flex gap-0 min-h-full">

      {/* ── Area principale ─────────────────────────────────── */}
      <div className="flex-1 min-w-0 p-4 lg:p-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0 flex-1">

            {/* Titolo bozza editabile */}
            {editingNome ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={tempNome}
                  onChange={e => setTempNome(e.target.value)}
                  onBlur={commitNome}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitNome()
                    if (e.key === 'Escape') setEditingNome(false)
                  }}
                  className="text-xl font-bold bg-transparent text-white border-b border-indigo-500
                             outline-none pb-0.5 min-w-0 flex-1"
                />
              </div>
            ) : (
              <button
                onClick={() => { setTempNome(currentBozzaNome); setEditingNome(true) }}
                className="group flex items-center gap-2 text-left"
              >
                <h2 className="text-xl font-bold text-white truncate">
                  {currentBozzaNome || 'Nuova liquidazione'}
                </h2>
                <svg
                  className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition shrink-0"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5
                       m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                </svg>
              </button>
            )}

            <div className="flex items-center gap-2 mt-1 text-sm text-slate-500 flex-wrap">
              <span>{dettagli.length} gruppo/i</span>
              <span>·</span>
              <span>{totalNoms} nominativo/i</span>
              {protocolloDisplay && (
                <>
                  <span>·</span>
                  <span className="font-mono text-xs">{protocolloDisplay}</span>
                </>
              )}
            </div>
          </div>

          {/* Azioni header */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleExportCsv}
              disabled={!canExport}
              title={!canExport ? 'Aggiungi almeno un gruppo con nominativi' : 'Esporta CSV HR'}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm
                         bg-emerald-700/30 text-emerald-400 border border-emerald-800/50
                         hover:bg-emerald-700/50 transition
                         disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
              </svg>
              <span className="hidden sm:inline">CSV HR</span>
            </button>

            <button
              onClick={handleDownloadMatricoleTxt}
              disabled={!canExport}
              title={!canExport ? 'Aggiungi almeno un gruppo con nominativi' : 'Scarica matricole TXT per ruolo — tutti i gruppi'}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm
                         bg-emerald-700/30 text-emerald-400 border border-emerald-800/50
                         hover:bg-emerald-700/50 transition
                         disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586
                     a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              <span className="hidden sm:inline">TXT Ruoli</span>
            </button>

            <button
              onClick={handleSave}
              disabled={saving || (!isDirty && !!currentBozzaId)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium
                         bg-indigo-600 hover:bg-indigo-500 text-white transition
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? (
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10"
                          stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3
                       m-4 0V3m0 4a2 2 0 11-4 0 2 2 0 014 0z"/>
                </svg>
              )}
              <span className="hidden sm:inline">
                {saving ? 'Salvataggio…' : 'Salva bozza'}
              </span>
            </button>
          </div>
        </div>

        {/* Feedback salvataggio */}
        {saveSuccess && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-900/40 border border-emerald-800/50
                          text-emerald-300 text-sm flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
            </svg>
            Bozza salvata correttamente.
          </div>
        )}
        {saveError && (
          <div className="mb-4 p-3 rounded-lg bg-red-900/40 border border-red-800/50
                          text-red-300 text-sm flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            {saveError}
          </div>
        )}

        {/* Lista dettagli / empty state */}
        {dettagli.length === 0 ? (
          <EmptyState onAdd={() => setDettaglioModal({ open: true })} />
        ) : (
          <div className="space-y-3">
            {dettagli.map(det => (
              <DettaglioCard
                key={det.id}
                dettaglio={det}
                onEdit={() => setDettaglioModal({ open: true, existing: det })}
                onAddNominativo={() => setNominativoModal({ open: true, dettaglio: det })}
              />
            ))}

            {/* Aggiungi gruppo */}
            <button
              onClick={() => setDettaglioModal({ open: true })}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl
                         border-2 border-dashed border-slate-700 text-slate-500
                         hover:border-indigo-700 hover:text-indigo-400 transition text-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
              </svg>
              Aggiungi gruppo liquidazione
            </button>
          </div>
        )}

        {/* Banner info export */}
        {canExport && (
          <CsvInfoBanner
            rows={csvRows.length}
            onExport={handleExportCsv}
          />
        )}
      </div>

      {/* ── Sidebar totali (solo xl+) ────────────────────────── */}
      <TotaliSidebar />

      {/* ── Modali ──────────────────────────────────────────── */}
      {dettaglioModal.open && (
        <DettaglioFormModal
          existing={dettaglioModal.existing}
          onClose={() => setDettaglioModal({ open: false })}
        />
      )}

      {nominativoModal.open && nominativoModal.dettaglio && (
        <NominativoFormModal
          dettaglio={nominativoModal.dettaglio}
          onClose={() => setNominativoModal({ open: false })}
        />
      )}
    </div>
  )
}

// ── Empty State ────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700
                      flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586
               a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
      </div>
      <h3 className="text-white font-semibold mb-1">Nessun gruppo di liquidazione</h3>
      <p className="text-slate-400 text-sm max-w-sm mb-5">
        Crea il primo gruppo per iniziare. Ogni gruppo corrisponde a una voce HR
        e raccoglie i nominativi da liquidare.
      </p>
      <button
        onClick={onAdd}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600
                   hover:bg-indigo-500 text-white text-sm font-medium transition"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
        </svg>
        Nuovo gruppo liquidazione
      </button>
    </div>
  )
}

// ── CSV Info Banner ────────────────────────────────────────────

function CsvInfoBanner({ rows, onExport }: { rows: number; onExport: () => void }) {
  return (
    <div className="mt-6 p-4 rounded-xl bg-slate-900 border border-slate-800
                    flex items-center justify-between gap-4">
      <div>
        <p className="text-white text-sm font-medium">Pronto per l&apos;esportazione</p>
        <p className="text-slate-400 text-xs mt-0.5">
          {rows} righe CSV HR · separatore{' '}
          <code className="text-indigo-400">;</code> · BOM UTF-8
        </p>
      </div>
      <button
        onClick={onExport}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium
                   bg-emerald-700/40 text-emerald-300 hover:bg-emerald-700/60 transition shrink-0"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
        </svg>
        Esporta CSV
      </button>
    </div>
  )
}
