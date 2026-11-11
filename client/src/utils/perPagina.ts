// ============================================================
// PAYROLL GANG SUITE — quante righe per pagina (26.11.11.3)
//
// Usato dalla Dashboard: il numero di liquidazioni per pagina si scrive a
// mano (1–200, iniziale 10) e si ricorda in questo browser (localStorage:
// solo il numero). I numeri delle pagine, se sono tante, si accorciano.
// ============================================================

export const PER_PAGINA_INIZIALE = 10
export const PER_PAGINA_MAX = 200

/** Testo scritto nel campo → numero valido: oltre 200 → 200, decimali arrotondati, vuoto/zero/non numerico → iniziale. */
export function normalizzaPerPagina(v: unknown): number {
  const n = Math.round(Number(String(v ?? '').trim()))
  if (!Number.isFinite(n) || n < 1) return PER_PAGINA_INIZIALE
  return Math.min(n, PER_PAGINA_MAX)
}

type Memoria = Pick<Storage, 'getItem' | 'setItem'>
const mem = (): Memoria | null => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }
export function leggiPerPagina(chiave: string, m: Memoria | null = mem()): number {
  try { const v = m?.getItem(`pgs.perPagina.${chiave}`); return v == null ? PER_PAGINA_INIZIALE : normalizzaPerPagina(v) } catch { return PER_PAGINA_INIZIALE }
}
export function scriviPerPagina(chiave: string, n: number, m: Memoria | null = mem()): void {
  try { m?.setItem(`pgs.perPagina.${chiave}`, String(normalizzaPerPagina(n))) } catch { /* niente */ }
}

/** Numeri delle pagine da mostrare: tutti fino a 7, altrimenti 1 … vicine … ultima. */
export function numeriPagina(totale: number, corrente: number): Array<number | '…'> {
  if (totale <= 7) return Array.from({ length: totale }, (_, i) => i + 1)
  const c = Math.min(Math.max(1, corrente), totale)
  const vicine = [c - 1, c, c + 1].filter(p => p > 1 && p < totale)
  const out: Array<number | '…'> = [1]
  if (vicine[0]! > 2) out.push('…')
  out.push(...vicine)
  if (vicine[vicine.length - 1]! < totale - 1) out.push('…')
  out.push(totale)
  return out
}
