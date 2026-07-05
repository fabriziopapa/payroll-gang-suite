// ============================================================
// PAYROLL GANG SUITE — Ricalcolo certificato (regole Excel ufficio)
// Porting di compute_certificato() da cedolino_parser.py.
// Aritmetica con decimal.js (ROUND_HALF_UP, 2 decimali) — MAI float binari.
// Verificato al centesimo sul campione A anonimizzato (vedi calculator.test).
// ============================================================

import Decimal from 'decimal.js'
import type {
  VoceTeorica,
  VoceDettaglio,
  RiepilogoCedolino,
  CertificatoCalcolato,
  ExtraerarialeRiga,
  RiassuntoGruppo,
  RiassuntoRiga,
} from './types.js'

// HALF_UP coerente con ROUND_HALF_UP di Python Decimal
Decimal.set({ rounding: Decimal.ROUND_HALF_UP })

/** Arrotonda a 2 decimali HALF_UP e restituisce number (o null).
 *  SEC: rifiuta valori non finiti (NaN/Infinity) — un PDF/JSON malevolo non
 *  deve produrre silenziosamente importi non validi su un documento ufficiale. */
function money(d: Decimal | null | undefined): number | null {
  if (d === null || d === undefined) return null
  if (!d.isFinite()) return null
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
  // + abbattimenti (Abb.TFR DPCM 20.12.99 / L.335/95): nel certificato l'ufficio
  // li ingloba nelle ritenute previdenziali ed assistenziali (regola Excel).
  const abbTfr = sumVoci(voci, v => v.sezione === 'abbattimenti' && !v.arretrato)
  let prev = sumVoci(voci, v => v.sezione === 'contributi' && !v.arretrato)
  if (prev.isZero() && riepilogo.contributi != null) {
    const arr = sumVoci(voci, v => v.sezione === 'contributi' && v.arretrato)
    prev = new Decimal(riepilogo.contributi).minus(arr)
  }
  prev = prev.plus(abbTfr.isZero() && riepilogo.abbattimenti != null ? riepilogo.abbattimenti : abbTfr)

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

/**
 * Tabella riassuntiva di verifica (replica il foglio Excel dell'ufficio):
 * per ogni voce mostra il valore CEDOLINO e quello esposto nel CERTIFICATO,
 * rendendo controllabili gli inglobamenti (addizionali → fiscali, Abb.TFR →
 * previdenziali). Allegata al DOCX per la verifica del dirigente.
 */
export function computeRiassunto(
  teoriche:  VoceTeorica[],
  voci:      VoceDettaglio[],
  riepilogo: RiepilogoCedolino,
): RiassuntoGruppo[] {
  const c = computeCertificato(teoriche, voci, riepilogo)

  const retribuzione: RiassuntoRiga[] = teoriche
    .filter(t => !t.totale)
    .map(t => ({ voce: t.descrizione, segno: '+', cedolino: t.valore, certificato: t.valore }))
  if (!teoriche.some(hasVacanzaIvc)) {
    const ivc = money(sumVoci(voci, v => v.sezione === 'retribuzioni' && v.descrizione.toLowerCase().includes('vacanza')))
    if (ivc) retribuzione.push({ voce: 'I.V.C. / Elemento perequativo', segno: '+', cedolino: ivc, certificato: ivc })
  }

  const fiscaliCorrenti = money(sumVoci(voci, v => v.sezione === 'fiscali_correnti' && !v.arretrato))
  const contributi      = money(sumVoci(voci, v => v.sezione === 'contributi' && !v.arretrato))
  const abbTfr          = money(sumVoci(voci, v => v.sezione === 'abbattimenti' && !v.arretrato))

  const ritenuteLegge: RiassuntoRiga[] = [
    { voce: 'Ritenute fiscali',                        segno: '-', cedolino: fiscaliCorrenti, certificato: c.ritenute_fiscali },
    { voce: 'Ritenute previdenziali ed assistenziali', segno: '-', cedolino: contributi,      certificato: c.ritenute_previdenziali },
  ]
  if (abbTfr) {
    ritenuteLegge.push({ voce: 'Abb. T.F.R. (inglobato nelle previdenziali)', segno: '-', cedolino: abbTfr, certificato: 0 })
  }
  ritenuteLegge.push({ voce: 'Ritenute extraerariali', segno: '-', cedolino: null, certificato: c.extraerariali_totale })

  const addizionali: RiassuntoRiga[] = voci
    .filter(v => v.sezione === 'fiscali_conguaglio')
    .map(v => ({ voce: v.descrizione + ' (inglobata nelle fiscali)', segno: '-', cedolino: v.valore, certificato: 0 }))

  const extraerariali: RiassuntoRiga[] = c.extraerariali_righe.map(r => ({
    voce: r.descrizione, segno: '-', cedolino: r.valore, certificato: r.valore,
  }))

  const gruppi: RiassuntoGruppo[] = [
    { titolo: 'RETRIBUZIONE',      righe: retribuzione },
    { titolo: 'RITENUTE DI LEGGE', righe: ritenuteLegge },
  ]
  if (addizionali.length) gruppi.push({ titolo: 'ADDIZIONALI', righe: addizionali })
  gruppi.push(
    { titolo: 'NETTO RITENUTE DI LEGGE', righe: [
      { voce: 'Netto ritenute di legge', segno: '=', cedolino: c.netto_ritenute_legge, certificato: c.netto_ritenute_legge },
    ]},
    { titolo: 'EXTRAERARIALI', righe: extraerariali },
    { titolo: 'NETTO A PAGARE', righe: [
      { voce: 'Netto a pagare', segno: '=', cedolino: c.netto_a_pagare, certificato: c.netto_a_pagare },
    ]},
    { titolo: 'LIMITI DI CESSIONE (su netto ritenute di legge)', righe: [
      { voce: 'Quinto cedibile (1/5)',  segno: '=', cedolino: null, certificato: c.quinto },
      { voce: 'Settimo cedibile (1/7)', segno: '=', cedolino: null, certificato: c.settimo },
    ]},
  )
  return gruppi
}
