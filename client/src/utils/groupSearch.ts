// ============================================================
// PAYROLL GANG SUITE — Ricerca sui gruppi liquidazione
// Logica condivisa tra Dashboard e Ricerca.
// Client-side, memoizzabile, insensibile a maiuscole/accenti,
// token AND. A questa scala (decine/centinaia di gruppi) è
// istantanea; l'indice si costruisce una volta via useMemo.
// ============================================================

import type { DettaglioLiquidazione } from '../types'

/** lowercase + rimozione diacritici: "Utènze" → "utenze". */
export function normalizeText(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export interface GroupSearchCriteria {
  /** Testo libero: match su titolo gruppo, voce, capitolo, ID provvedimento, centro di costo, note. */
  text:     string
  /** Range su data competenza voce (ISO YYYY-MM-DD), estremi inclusi. */
  compFrom: string
  compTo:   string
}

export const EMPTY_CRITERIA: GroupSearchCriteria = { text: '', compFrom: '', compTo: '' }

export function hasCriteria(c: GroupSearchCriteria): boolean {
  return !!(c.text.trim() || c.compFrom || c.compTo)
}

/** Concatena i campi testuali ricercabili del gruppo, già normalizzati. */
export function dettaglioHaystack(det: DettaglioLiquidazione): string {
  return normalizeText([
    det.nomeDescrittivo,
    det.voce,
    det.capitolo,
    det.identificativoProvvedimento,
    det.centroCosto,
    det.note,
  ].filter(Boolean).join('  '))
}

/** Un gruppo soddisfa i criteri? (range date + tutti i token presenti). */
export function dettaglioMatches(det: DettaglioLiquidazione, c: GroupSearchCriteria, hay?: string): boolean {
  // Range su data competenza voce (confronto lessicografico su ISO = confronto cronologico)
  if (c.compFrom) {
    if (!det.dataCompetenzaVoce || det.dataCompetenzaVoce < c.compFrom) return false
  }
  if (c.compTo) {
    if (!det.dataCompetenzaVoce || det.dataCompetenzaVoce > c.compTo) return false
  }
  const q = normalizeText(c.text.trim())
  if (!q) return true
  const h = hay ?? dettaglioHaystack(det)
  return q.split(/\s+/).every(tok => h.includes(tok))
}

/** true se almeno un gruppo della bozza soddisfa i criteri. */
export function bozzaMatchesGroups(
  dettagli: DettaglioLiquidazione[] | undefined,
  c: GroupSearchCriteria,
): boolean {
  if (!hasCriteria(c)) return true
  if (!dettagli || dettagli.length === 0) return false
  return dettagli.some(det => dettaglioMatches(det, c))
}
