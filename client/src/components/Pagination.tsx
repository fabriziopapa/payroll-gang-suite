// ============================================================
// PAYROLL GANG SUITE — Componente Paginazione riusabile
// ============================================================

interface PaginationProps {
  total:            number
  pageSize:         number
  page:             number
  onPageChange:     (p: number) => void
  onPageSizeChange: (s: number) => void
}

function getPageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const set = new Set<number>()
  set.add(1)
  set.add(total)
  for (let i = Math.max(1, current - 1); i <= Math.min(total, current + 1); i++) set.add(i)
  const sorted = [...set].sort((a, b) => a - b)
  const result: (number | '...')[] = []
  let prev = 0
  for (const p of sorted) {
    if (p - prev > 1) result.push('...')
    result.push(p)
    prev = p
  }
  return result
}

export default function Pagination({
  total, pageSize, page, onPageChange, onPageSizeChange,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to   = Math.min(page * pageSize, total)

  function handleSizeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Math.max(1, Math.min(500, parseInt(e.target.value) || 1))
    onPageSizeChange(v)
  }

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3
                    border-t border-slate-800 flex-wrap gap-y-2 text-xs">

      {/* Righe per pagina */}
      <div className="flex items-center gap-2 text-slate-400">
        <span className="whitespace-nowrap">Righe per pagina:</span>
        <input
          type="number"
          min={1}
          max={500}
          value={pageSize}
          onChange={handleSizeChange}
          className="w-14 px-2 py-1 rounded-md bg-slate-800 border border-slate-700
                     text-white text-xs text-center
                     focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-transparent"
        />
      </div>

      {/* Contatore */}
      <span className="text-slate-500 whitespace-nowrap">
        {from}–{to} di {total}
      </span>

      {/* Paginatore */}
      <div className="flex items-center gap-1">
        {/* Precedente */}
        <button
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="px-2 py-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800
                     disabled:opacity-30 disabled:cursor-not-allowed transition"
          aria-label="Pagina precedente"
        >
          ‹
        </button>

        {/* Numeri */}
        {getPageNumbers(page, totalPages).map((p, i) =>
          p === '...' ? (
            <span key={`e-${i}`} className="px-1 text-slate-600 select-none">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`min-w-[2rem] px-2 py-1 rounded-md transition
                ${p === page
                  ? 'bg-indigo-600 text-white font-medium'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
            >
              {p}
            </button>
          )
        )}

        {/* Successiva */}
        <button
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="px-2 py-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800
                     disabled:opacity-30 disabled:cursor-not-allowed transition"
          aria-label="Pagina successiva"
        >
          ›
        </button>
      </div>
    </div>
  )
}
