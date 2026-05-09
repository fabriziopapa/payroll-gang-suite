// ============================================================
// PAYROLL GANG SUITE — ViewerPage
// Visualizzazione sola lettura di una liquidazione archiviata
// ============================================================

import { useMemo, useEffect } from 'react'
import { useStore, type BozzaDati } from '../store/useStore'
import {
  calcolaImportoCSV, calcolaTotali, buildCsvRows,
  serializeCsv, downloadCsv, formatEur,
} from '../utils/biz'
import type { DettaglioLiquidazione, Nominativo } from '../types'

export default function ViewerPage() {
  const { viewerBozza, navigate, settings } = useStore()

  // Guard: nessuna bozza in viewer → torna alla dashboard
  useEffect(() => {
    if (!viewerBozza) navigate('dashboard')
  }, [viewerBozza, navigate])

  if (!viewerBozza) return null

  const dati     = (viewerBozza.dati ?? {}) as Partial<BozzaDati>
  const dettagli  = dati.dettagli      ?? []
  const nominativi = dati.nominativi   ?? []
  const protocollo = dati.protocolloDisplay ?? viewerBozza.protocolloDisplay ?? ''

  const updatedAt = new Date(viewerBozza.updatedAt).toLocaleDateString('it-IT', {
    day: '2-digit', month: 'short', year: 'numeric',
  })

  // ── Export CSV HR ────────────────────────────────────────────
  function handleExportCsv() {
    const rows    = buildCsvRows(dettagli, nominativi, settings.coefficienti)
    const csv     = serializeCsv(rows)
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const nomePart = viewerBozza!.nome.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30)
    downloadCsv(csv, `liquidazione_${nomePart}_${datePart}.csv`)
  }

  // ── Export TXT matricole per ruolo ───────────────────────────
  function handleDownloadMatricoleTxt() {
    const byRuolo: Record<string, Set<string>> = {}
    for (const nom of nominativi) {
      if (!byRuolo[nom.ruolo]) byRuolo[nom.ruolo] = new Set()
      byRuolo[nom.ruolo]!.add(nom.matricola)
    }
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const nomePart = viewerBozza!.nome.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30)
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

  const canExport = dettagli.length > 0 && nominativi.length > 0

  return (
    <div className="flex gap-0 min-h-full">

      {/* ── Area principale ─────────────────────────────────── */}
      <div className="flex-1 min-w-0 p-4 lg:p-6">

        {/* Banner sola lettura */}
        <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg
                        bg-slate-800/60 border border-slate-700 text-slate-400 text-sm">
          <svg className="w-4 h-4 shrink-0 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          Liquidazione archiviata — sola lettura
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-white truncate">{viewerBozza.nome}</h2>
            <div className="flex items-center gap-2 mt-1 text-sm text-slate-500 flex-wrap">
              <span>{dettagli.length} gruppo/i</span>
              <span>·</span>
              <span>{nominativi.length} nominativo/i</span>
              {protocollo && (
                <>
                  <span>·</span>
                  <span className="font-mono text-xs">{protocollo}</span>
                </>
              )}
              <span>·</span>
              <span>Archiviata {updatedAt}</span>
            </div>
          </div>

          {/* Azioni export */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleExportCsv}
              disabled={!canExport}
              title={!canExport ? 'Nessun dato da esportare' : 'Esporta CSV HR'}
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
              title={!canExport ? 'Nessun dato da esportare' : 'Scarica matricole TXT per ruolo — tutti i gruppi'}
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
          </div>
        </div>

        {/* Gruppi */}
        {dettagli.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-slate-500 text-sm">Nessun gruppo in questa liquidazione</p>
          </div>
        ) : (
          <div className="space-y-4">
            {dettagli.map((det, idx) => (
              <ViewerDettaglioCard
                key={det.id}
                det={det}
                idx={idx}
                nominativi={nominativi.filter(n => n.dettaglioId === det.id)}
                coefficienti={settings.coefficienti}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Sidebar totali ───────────────────────────────────── */}
      <ViewerSidebar
        dettagli={dettagli}
        nominativi={nominativi}
        coefficienti={settings.coefficienti}
      />
    </div>
  )
}

// ── ViewerDettaglioCard ───────────────────────────────────────

function ViewerDettaglioCard({ det, idx, nominativi, coefficienti }: {
  det:          DettaglioLiquidazione
  idx:          number
  nominativi:   Nominativo[]
  coefficienti: Record<string, number>
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      {/* Header gruppo */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
        <span
          className="w-3 h-3 rounded-full shrink-0"
          style={{ backgroundColor: det.colore }}
        />
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium text-sm truncate">
            {det.nomeDescrittivo || `Gruppo ${idx + 1}`}
          </p>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500 flex-wrap">
            {det.voce && <span>Voce <span className="font-mono text-slate-400">{det.voce}</span></span>}
            {det.capitolo && <span>Cap. <span className="font-mono text-slate-400">{det.capitolo}</span></span>}
            {det.competenzaLiquidazione && <span>Competenza <span className="text-slate-400">{det.competenzaLiquidazione}</span></span>}
            {det.dataCompetenzaVoce && <span>Data voce <span className="text-slate-400">{det.dataCompetenzaVoce}</span></span>}
          </div>
        </div>
        <span className="shrink-0 text-xs text-slate-500">{nominativi.length} nom.</span>
      </div>

      {/* Tabella nominativi */}
      {nominativi.length === 0 ? (
        <p className="px-4 py-3 text-xs text-slate-600 italic">Nessun nominativo</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500">
                <th className="px-4 py-2 text-left font-medium">Matricola</th>
                <th className="px-4 py-2 text-left font-medium">Cognome Nome</th>
                <th className="px-4 py-2 text-left font-medium">Ruolo</th>
                <th className="px-4 py-2 text-right font-medium">Importo lordo</th>
                {det.flagScorporo && (
                  <th className="px-4 py-2 text-right font-medium text-indigo-400">Lordo benef.</th>
                )}
              </tr>
            </thead>
            <tbody>
              {nominativi.map(nom => {
                const csv = calcolaImportoCSV(nom, det, coefficienti as Parameters<typeof calcolaImportoCSV>[2])
                return (
                  <tr key={nom.id} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition">
                    <td className="px-4 py-2 font-mono text-slate-300">{nom.matricola}</td>
                    <td className="px-4 py-2 text-slate-300">{nom.cognomeNome}</td>
                    <td className="px-4 py-2">
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                        {nom.ruolo}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-slate-300">
                      {formatEur(nom.importoLordo)}
                    </td>
                    {det.flagScorporo && (
                      <td className="px-4 py-2 text-right font-mono text-indigo-400">
                        {formatEur(csv)}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── ViewerSidebar ─────────────────────────────────────────────

import type { CoefficienteScorporo } from '../types'

function ViewerSidebar({ dettagli, nominativi, coefficienti }: {
  dettagli:     DettaglioLiquidazione[]
  nominativi:   Nominativo[]
  coefficienti: CoefficienteScorporo
}) {
  const totali     = useMemo(
    () => calcolaTotali(dettagli, nominativi, coefficienti),
    [dettagli, nominativi, coefficienti],
  )
  const hasScorporo = dettagli.some(d => d.flagScorporo)

  return (
    <aside className="w-72 shrink-0 hidden xl:flex flex-col gap-3 sticky top-14 self-start
                      max-h-[calc(100vh-3.5rem)] overflow-y-auto pb-6 pt-6 pr-4">

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">Riepilogo</p>
        <div className="space-y-2">
          <SRow label="Nominativi" value={String(totali.totaleNominativi)} />
          <SRow label="Gruppi"     value={String(dettagli.length)} />
          <div className="border-t border-slate-800 my-2" />
          <SRow label="Totale lordo"  value={formatEur(totali.totaleImportoLordo)} className="text-white font-medium" />
          {hasScorporo && (
            <SRow label="Totale lordo benef." value={formatEur(totali.totaleImportoCSV)} className="text-indigo-400 font-medium" />
          )}
        </div>
      </div>

      {totali.perDettaglio.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">Per gruppo</p>
          <div className="space-y-4">
            {totali.perDettaglio.map((d, idx) => {
              const det  = dettagli.find(x => x.id === d.id)
              const noms = nominativi.filter(n => n.dettaglioId === d.id)
              const perRuolo = new Map<string, { lordo: number; csv: number; count: number }>()
              for (const nom of noms) {
                const key  = nom.ruolo || '—'
                const prev = perRuolo.get(key) ?? { lordo: 0, csv: 0, count: 0 }
                const csv  = det ? calcolaImportoCSV(nom, det, coefficienti) : nom.importoLordo
                perRuolo.set(key, { lordo: prev.lordo + nom.importoLordo, csv: prev.csv + csv, count: prev.count + 1 })
              }
              const ruoliEntries = Array.from(perRuolo.entries()).sort((a, b) => b[1].lordo - a[1].lordo)

              return (
                <div key={d.id}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: det?.colore ?? '#6366f1' }} />
                    <span className="text-slate-300 text-xs truncate flex-1">{d.nome || `Gruppo ${idx + 1}`}</span>
                    <span className="text-slate-500 text-xs shrink-0">{d.count} nom.</span>
                  </div>
                  <div className="pl-4 space-y-0.5 mb-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Lordo</span>
                      <span className="text-slate-300 font-mono">{formatEur(d.totaleLordo)}</span>
                    </div>
                    {det?.flagScorporo && d.totaleCSV !== d.totaleLordo && (
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Lordo benef.</span>
                        <span className="text-indigo-400 font-mono">{formatEur(d.totaleCSV)}</span>
                      </div>
                    )}
                  </div>
                  {ruoliEntries.length >= 2 && (
                    <div className="pl-4 mt-1.5">
                      <p className="text-xs text-slate-600 uppercase tracking-wide mb-1">per ruolo</p>
                      <div className="space-y-1">
                        {ruoliEntries.map(([ruolo, val]) => (
                          <div key={ruolo} className="flex items-center justify-between gap-2 bg-slate-800/40 rounded px-2 py-1">
                            <span className="font-mono text-xs text-slate-400 shrink-0 w-8">{ruolo}</span>
                            <span className="text-slate-600 text-xs shrink-0">{val.count}</span>
                            <span className="text-slate-300 text-xs font-mono ml-auto">{formatEur(Math.round(val.lordo * 100) / 100)}</span>
                            {det?.flagScorporo && val.csv !== val.lordo && (
                              <span className="text-indigo-400 text-xs font-mono">{formatEur(Math.round(val.csv * 100) / 100)}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {idx < totali.perDettaglio.length - 1 && <div className="border-t border-slate-800/50 mt-3" />}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {hasScorporo && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3">
          <p className="text-xs text-slate-500">
            <span className="text-indigo-400 font-medium">Lordo beneficiario</span> = importo dopo scorporo
            <br /><span className="font-mono text-xs">lordo ÷ (1 + coeff/100)</span>
          </p>
        </div>
      )}
    </aside>
  )
}

function SRow({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-400 text-sm">{label}</span>
      <span className={`text-sm ${className || 'text-slate-300'}`}>{value}</span>
    </div>
  )
}
