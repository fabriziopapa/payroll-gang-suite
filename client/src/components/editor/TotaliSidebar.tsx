// ============================================================
// PAYROLL GANG SUITE — Totali Sidebar
// Riepilogo real-time: totali generali + per gruppo + per ruolo
// ============================================================

import { useStore } from '../../store/useStore'
import { calcolaTotali, calcolaImportoCSV, formatEur } from '../../utils/biz'

export default function TotaliSidebar() {
  const { dettagli, nominativi, settings } = useStore()

  const totali     = calcolaTotali(dettagli, nominativi, settings.coefficienti, settings.coefficientiContoTerzi)
  const hasScorporo = dettagli.some(d => d.flagScorporo)

  return (
    <aside className="w-72 shrink-0 hidden xl:flex flex-col gap-3 sticky top-14 self-start
                      max-h-[calc(100vh-3.5rem)] overflow-y-auto pb-6 pt-6 pr-4">

      {/* Totale generale */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">Riepilogo</p>
        <div className="space-y-2">
          <Row label="Nominativi" value={String(totali.totaleNominativi)} />
          <Row label="Gruppi"     value={String(dettagli.length)} />
          <div className="border-t border-slate-800 my-2" />
          <Row
            label="Totale lordo"
            value={formatEur(totali.totaleImportoLordo)}
            className="text-white font-medium"
          />
          {hasScorporo && (
            <Row
              label="Totale lordo benef."
              value={formatEur(totali.totaleImportoCSV)}
              className="text-indigo-400 font-medium"
            />
          )}
        </div>
      </div>

      {/* Per gruppo */}
      {totali.perDettaglio.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">Per gruppo</p>
          <div className="space-y-4">
            {totali.perDettaglio.map((d, idx) => {
              const det   = dettagli.find(x => x.id === d.id)
              const noms  = nominativi.filter(n => n.dettaglioId === d.id)

              // Totali per ruolo
              const perRuolo = new Map<string, { lordo: number; csv: number; count: number }>()
              for (const nom of noms) {
                const key  = nom.ruolo || '—'
                const prev = perRuolo.get(key) ?? { lordo: 0, csv: 0, count: 0 }
                const csv  = det ? calcolaImportoCSV(nom, det, settings.coefficienti, settings.coefficientiContoTerzi) : nom.importoLordo
                perRuolo.set(key, {
                  lordo: prev.lordo + nom.importoLordo,
                  csv:   prev.csv  + csv,
                  count: prev.count + 1,
                })
              }
              const ruoliEntries = Array.from(perRuolo.entries())
                .sort((a, b) => b[1].lordo - a[1].lordo)

              return (
                <div key={d.id}>
                  {/* Header gruppo */}
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: det?.colore ?? '#6366f1' }}
                    />
                    <span className="text-slate-300 text-xs truncate flex-1">
                      {d.nome || `Gruppo ${idx + 1}`}
                    </span>
                    <span className="text-slate-500 text-xs shrink-0">{d.count} nom.</span>
                  </div>

                  {/* Totale gruppo */}
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

                  {/* Per ruolo (solo se ci sono ≥ 2 ruoli distinti) */}
                  {ruoliEntries.length >= 2 && (
                    <div className="pl-4 mt-1.5">
                      <p className="text-xs text-slate-600 uppercase tracking-wide mb-1">per ruolo</p>
                      <div className="space-y-1">
                        {ruoliEntries.map(([ruolo, val]) => (
                          <div key={ruolo}
                            className="flex items-center justify-between gap-2
                                       bg-slate-800/40 rounded px-2 py-1">
                            <span className="font-mono text-xs text-slate-400 shrink-0 w-8">{ruolo}</span>
                            <span className="text-slate-600 text-xs shrink-0">{val.count}</span>
                            <span className="text-slate-300 text-xs font-mono ml-auto">
                              {formatEur(Math.round(val.lordo * 100) / 100)}
                            </span>
                            {det?.flagScorporo && val.csv !== val.lordo && (
                              <span className="text-indigo-400 text-xs font-mono">
                                {formatEur(Math.round(val.csv * 100) / 100)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {idx < totali.perDettaglio.length - 1 && (
                    <div className="border-t border-slate-800/50 mt-3" />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Legenda scorporo */}
      {hasScorporo && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3">
          <p className="text-xs text-slate-500">
            <span className="text-indigo-400 font-medium">Lordo beneficiario</span> = importo dopo scorporo
            <br />
            <span className="font-mono text-xs">lordo ÷ (1 + coeff/100)</span>
          </p>
        </div>
      )}
    </aside>
  )
}

// ── Helper ────────────────────────────────────────────────────

function Row({ label, value, className = '' }: {
  label: string; value: string; className?: string
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-400 text-sm">{label}</span>
      <span className={`text-sm ${className || 'text-slate-300'}`}>{value}</span>
    </div>
  )
}
