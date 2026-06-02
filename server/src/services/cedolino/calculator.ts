// ============================================================
// PAYROLL GANG SUITE — Ricalcolo certificato (regole Excel ufficio)
// Porting di compute_certificato() da cedolino_parser.py.
// Aritmetica con decimal.js (ROUND_HALF_UP, 2 decimali) — MAI float binari.
// Verificato al centesimo sul campione Pino (vedi calculator.test).
// ============================================================

import Decimal from 'decimal.js'
import type {
  VoceTeorica,
  VoceDettaglio,
  RiepilogoCedolino,
  CertificatoCalcolato,
  ExtraerarialeRiga,
} from './types.js'

// HALF_UP coerente con ROUND_HALF_UP di Python Decimal
Decimal.set({ rounding: Decimal.ROUND_HALF_UP })

/** Arrotonda a 2 decimali HALF_UP e restituisce number (o null). */
function money(d: Decimal | null | undefined): number | null {
  if (d === null || d === undefined) return null
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
}

/** Somma i `valore` delle voci che soddisfano il predicato. */
function sumVoci(voci: VoceDettaglio[], pred: (v: VoceDettaglio) => boolean): Decimal {
  return voci.reduce((acc, v) => (pred(v) ? acc.plus(v.valore) : acc), new Decimal(0))
}

/** Somma una lista di number|null ignorando i null. */
function sumList(lst: Array<number | null>): Decimal {
  return lst.reduce<Decimal>((acc, x) => (x === null ? acc : acc.plus(x)), new Decimal(0))
}

/**
 * Classifica una voce extra-erariale: esclude "debiti vari" / voci marcate "esclus".
 * Regola modificabile — replica classify_extraerariale() del riferimento.
 */
export function classifyExtraerariale(desc: string): boolean {
  const d = desc.toLowerCase()
  if (d.includes('debiti vari') || d.includes('esclus')) return false
  return true
}

const hasVacanzaIvc = (t: VoceTeorica): boolean => {
  const d = t.descrizione.toLowerCase()
  return d.includes('vacanza') || d.includes('i.v.c')
}

/**
 * Ricalcola il certificato per CATEGORIA (aggregati) a partire dalle voci
 * classificate per sezione. Dinamico: voci assenti non rompono il calcolo.
 */
export function computeCertificato(
  teoriche:  VoceTeorica[],
  voci:      VoceDettaglio[],
  riepilogo: RiepilogoCedolino,
): CertificatoCalcolato {
  // Lordo teorico = somma voci teoriche (escluso TOTALE) + IVC
  let lordo = sumList(teoriche.filter(t => !t.totale).map(t => t.valore))
  if (!teoriche.some(hasVacanzaIvc)) {
    lordo = lordo.plus(
      sumVoci(voci, v => v.sezione === 'retribuzioni' && v.descrizione.toLowerCase().includes('vacanza')),
    )
  }

  // Ritenute fiscali = correnti (NO arretrati) + conguagli addizionali
  const fiscaliCorrenti = sumVoci(voci, v => v.sezione === 'fiscali_correnti' && !v.arretrato)
  const conguagli       = sumVoci(voci, v => v.sezione === 'fiscali_conguaglio')
  const fiscali         = fiscaliCorrenti.plus(conguagli)

  // Ritenute previdenziali = contributi correnti (NO arretrati)
  let prev = sumVoci(voci, v => v.sezione === 'contributi' && !v.arretrato)
  if (prev.isZero() && riepilogo.contributi != null) {
    const arr = sumVoci(voci, v => v.sezione === 'contributi' && v.arretrato)
    prev = new Decimal(riepilogo.contributi).minus(arr)
  }

  const nettoLegge = lordo.minus(fiscali).minus(prev)

  // Extra-erariali = sindacali + altre ritenute (escluse "debiti vari")
  const extra = sumVoci(voci, v => v.sezione === 'sindacali')
    .plus(sumVoci(voci, v => v.sezione === 'altre_ritenute' && classifyExtraerariale(v.descrizione)))

  const nettoPagare = nettoLegge.minus(extra)

  const extraRows: ExtraerarialeRiga[] = voci
    .filter(v => (v.sezione === 'sindacali' || v.sezione === 'altre_ritenute') && classifyExtraerariale(v.descrizione))
    .map(v => ({
      descrizione: v.descrizione,
      decorrenza:  v.decorrenza,
      scadenza:    v.scadenza,
      valore:      money(new Decimal(v.valore)),
    }))

  return {
    lordo_teorico:          money(lordo),
    ritenute_fiscali:       money(fiscali),
    ritenute_previdenziali: money(prev),
    netto_ritenute_legge:   money(nettoLegge),
    extraerariali_totale:   money(extra),
    extraerariali_righe:    extraRows,
    netto_a_pagare:         money(nettoPagare),
    quinto:                 money(nettoLegge.div(5)),
    settimo:                money(nettoLegge.div(7)),
  }
}
