// ============================================================
// PAYROLL GANG SUITE — sorting (helper condivisi editor/viewer)
// Ordinamento "solo vista" (snapshot) + ricerca: logica pura.
// Estratto da DettaglioCard per riuso in ViewerPage (archivio).
// ============================================================

import type { Nominativo } from '../types'

/** Snapshot di ordinamento: colonna, direzione e ordine congelato degli id. */
export type SortState = { col: SortCol; dir: 'asc' | 'desc'; ids: string[] }

export type SortCol = 'nominativo' | 'matricola' | 'ruolo' | 'lordo' | 'parti'

const sortCollator = new Intl.Collator('it', { sensitivity: 'base', numeric: true })

export function compareNomBy(col: SortCol, a: Nominativo, b: Nominativo): number {
  switch (col) {
    case 'nominativo': return sortCollator.compare(a.cognomeNome, b.cognomeNome)
    case 'matricola':  return sortCollator.compare(a.matricola, b.matricola)
    case 'ruolo':      return sortCollator.compare(a.ruolo, b.ruolo)
    case 'lordo':      return a.importoLordo - b.importoLordo
    case 'parti':      return (a.parti ?? 0) - (b.parti ?? 0)
  }
}

/** lowercase + rimozione diacritici: "Buonì" matcha "buoni" */
export function normalizeSearch(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function SortableTh({ label, col, sort, onSort, align = 'left', className = '' }: {
  label:     string
  col:       SortCol
  sort:      { col: SortCol; dir: 'asc' | 'desc' } | null
  onSort:    (col: SortCol) => void
  align?:    'left' | 'right'
  className?: string
}) {
  const active = sort?.col === col
  const arrow  = active ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'
  return (
    <th
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={`p-0 ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        title="Ordina la vista — non modifica l'ordine salvato"
        className={`w-full flex items-center gap-1 px-4 py-2 text-xs font-medium transition
          focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded
          ${align === 'right' ? 'justify-end' : ''}
          ${active ? 'text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
      >
        {align === 'right' && <span className={`text-[10px] ${active ? '' : 'text-slate-700'}`} aria-hidden="true">{arrow}</span>}
        {label}
        {align === 'left' && <span className={`text-[10px] ${active ? '' : 'text-slate-700'}`} aria-hidden="true">{arrow}</span>}
      </button>
    </th>
  )
}
