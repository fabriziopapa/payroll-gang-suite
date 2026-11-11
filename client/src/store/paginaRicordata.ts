// ============================================================
// PAYROLL GANG SUITE — pagina da riaprire dopo un aggiornamento del browser
//
// Aggiornando il browser l'app ripristina la sessione e, finora, tornava
// sempre alla dashboard. Qui si ricorda la pagina aperta nella memoria
// della SCHEDA del browser (sessionStorage): sparisce chiudendola, e
// contiene solo il nome della pagina, nessun dato.
//
// Si riaprono solo le pagine di PAGINE_RICORDATE: quelle che non dipendono
// da qualcosa di aperto (l'editor e il viewer vogliono una bozza, e senza
// non funzionano). Il login vero porta sempre alla dashboard.
// ============================================================

import type { PageId } from './useStore'

const CHIAVE = 'pgs.pagina'
/** Pagine che si riaprono, con il requisito per vederle. */
export const PAGINE_RICORDATE: Partial<Record<PageId, 'admin' | 'tutti'>> = { cral: 'admin' }

type Memoria = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const memoria = (): Memoria | null => {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage } catch { return null }
}

/** Da chiamare a ogni cambio di pagina: una pagina fuori elenco cancella il ricordo. */
export function ricordaPagina(pagina: PageId, m: Memoria | null = memoria()): void {
  try {
    if (!m) return
    if (PAGINE_RICORDATE[pagina]) m.setItem(CHIAVE, pagina)
    else m.removeItem(CHIAVE)
  } catch { /* memoria del browser non disponibile: si torna alla dashboard */ }
}

/** La pagina da riaprire al ripristino della sessione, o null (dashboard). */
export function paginaRicordata(isAdmin: boolean, m: Memoria | null = memoria()): PageId | null {
  try {
    const p = m?.getItem(CHIAVE) as PageId | null | undefined
    const req = p ? PAGINE_RICORDATE[p] : undefined
    if (!p || !req) return null
    return req === 'admin' && !isAdmin ? null : p
  } catch { return null }
}

/** Ricordo generico di un valore della pagina (es. la scheda del CRAL), con l'elenco dei valori ammessi. */
export function ricordaValore(chiave: string, valore: string, m: Memoria | null = memoria()): void {
  try { m?.setItem(`pgs.${chiave}`, valore) } catch { /* niente */ }
}
export function valoreRicordato<T extends string>(chiave: string, ammessi: readonly T[], m: Memoria | null = memoria()): T | null {
  try { const v = m?.getItem(`pgs.${chiave}`); return v && (ammessi as readonly string[]).includes(v) ? v as T : null } catch { return null }
}
