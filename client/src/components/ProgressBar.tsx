// ============================================================
// PAYROLL GANG SUITE — ProgressBar
// Barra di avanzamento determinata (x/N), accessibile e annullabile.
// Pattern stato-arte 2026: role=progressbar + aria-live, tasto Annulla.
// ============================================================

interface Props {
  value:    number
  max:      number
  label?:   string
  /** Se presente mostra il tasto Annulla */
  onCancel?: () => void
}

export default function ProgressBar({ value, max, label, onCancel }: Props) {
  const safeMax = Math.max(1, max)
  const pct     = Math.min(100, Math.round((value / safeMax) * 100))

  return (
    <div className="p-3 rounded-lg bg-slate-800 border border-slate-700" aria-live="polite">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-xs text-slate-300 truncate">{label ?? 'Elaborazione…'}</span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-slate-400 font-mono tabular-nums">{value}/{max}</span>
          {onCancel && (
            <button type="button" onClick={onCancel}
              className="text-xs text-slate-400 hover:text-red-400 transition">
              Annulla
            </button>
          )}
        </div>
      </div>
      <div
        className="w-full bg-slate-700 rounded-full h-1.5 overflow-hidden"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div
          className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
