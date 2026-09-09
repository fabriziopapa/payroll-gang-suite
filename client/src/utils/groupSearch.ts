// ============================================================
// PAYROLL GANG SUITE — Ricerca liquidazioni / gruppi
// Logica condivisa tra Dashboard e Ricerca.
// Due modalità combinabili (in AND):
//  · full-text (token AND, insensibile a maiuscole/accenti) su
//    nome liquidazione + tutti i campi del gruppo;
//  · mirata per singolo campo (titolo gruppo, voce, capitolo,
//    ID provvedimento, centro di costo, note) + range data competenza.
// Client-side e memoizzabile: istantanea alla scala del dato.
// ============================================================

import type { DettaglioLiquidazione } from '../types'

/** lowercase + rimozione diacritici: "Utènze" → "utenze". */
export function normalizeText(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Sottostringa normalizzata: needle vuoto = sempre vero. */
export function includesNorm(hay: string, needle: string): boolean {
  const n = normalizeText(needle.trim())
  if (!n) return true
  return normalizeText(hay).includes(n)
}

/** Token AND: tutti i token del testo presenti nell'haystack. Vuoto = vero. */
export function tokenMatch(hay: string, text: string): boolean {
  const toks = normalizeText(text.trim()).split(/\s+/).filter(Boolean)
  if (toks.length === 0) return true
  const h = normalizeText(hay)
  return toks.every(t => h.includes(t))
}

export interface GroupSearchCriteria {
  /** full-text su nome liquidazione + tutti i campi del gruppo */
  text:        string
  // ── mirate (per singolo campo) ──
  titolo:      string   // titolo gruppo (nomeDescrittivo)
  voce:        string
  capitolo:    string
  idProv:      string   // identificativoProvvedimento (9 cifre)
  centroCosto: string
  note:        string
  /** range su data competenza voce (ISO YYYY-MM-DD), estremi inclusi */
  compFrom:    string
  compTo:      string
}

export const EMPTY_CRITERIA: GroupSearchCriteria = {
  text: '', titolo: '', voce: '', capitolo: '', idProv: '',
  centroCosto: '', note: '', compFrom: '', compTo: '',
}

/** true se almeno un criterio mirato/data è attivo (esclude il full-text). */
export function hasTargeted(c: GroupSearchCriteria): boolean {
  return !!(c.titolo.trim() || c.voce.trim() || c.capitolo.trim() || c.idProv.trim()
    || c.centroCosto.trim() || c.note.trim() || c.compFrom || c.compTo)
}

export function hasCriteria(c: GroupSearchCriteria): boolean {
  return !!c.text.trim() || hasTargeted(c)
}

/** Campi ricercabili di una "riga" (gruppo o riga Ricerca). */
export interface SearchableFields {
  titolo:       string
  voce:         string
  capitolo:     string
  idProv:       string
  centroCosto:  string
  note:         string
  dataCompVoce: string
  /** haystack per il full-text (nome liquidazione + tutti i campi) */
  fulltext:     string
}

/** Costruisce i campi ricercabili da un gruppo (+ nome liquidazione per il full-text). */
export function dettaglioToFields(det: DettaglioLiquidazione, bozzaNome: string): SearchableFields {
  return {
    titolo:       det.nomeDescrittivo,
    voce:         det.voce,
    capitolo:     det.capitolo,
    idProv:       det.identificativoProvvedimento,
    centroCosto:  det.centroCosto,
    note:         det.note,
    dataCompVoce: det.dataCompetenzaVoce,
    fulltext: [
      bozzaNome, det.nomeDescrittivo, det.voce, det.capitolo,
      det.identificativoProvvedimento, det.centroCosto, det.note,
      det.competenzaLiquidazione,
    ].filter(Boolean).join('  '),
  }
}

/** Verifica un set di campi contro i criteri (mirati + range + full-text). */
export function fieldsMatch(f: SearchableFields, c: GroupSearchCriteria): boolean {
  if (c.compFrom && (!f.dataCompVoce || f.dataCompVoce < c.compFrom)) return false
  if (c.compTo   && (!f.dataCompVoce || f.dataCompVoce > c.compTo))   return false
  if (!includesNorm(f.titolo,      c.titolo))      return false
  if (!includesNorm(f.voce,        c.voce))        return false
  if (!includesNorm(f.capitolo,    c.capitolo))    return false
  if (!includesNorm(f.idProv,      c.idProv))      return false
  if (!includesNorm(f.centroCosto, c.centroCosto)) return false
  if (!includesNorm(f.note,        c.note))        return false
  if (!tokenMatch(f.fulltext, c.text)) return false
  return true
}

/** true se la bozza soddisfa i criteri (almeno un gruppo, o solo-nome se senza gruppi). */
export function bozzaMatchesGroups(
  bozzaNome: string,
  dettagli: DettaglioLiquidazione[] | undefined,
  c: GroupSearchCriteria,
): boolean {
  if (!hasCriteria(c)) return true
  if (!dettagli || dettagli.length === 0) {
    // senza gruppi può ancora matchare il solo full-text sul nome liquidazione
    return !hasTargeted(c) && tokenMatch(bozzaNome, c.text)
  }
  return dettagli.some(det => fieldsMatch(dettaglioToFields(det, bozzaNome), c))
}
