// ============================================================
// PAYROLL GANG SUITE — Certificato dagli AGGREGATI del liquidato
// Percorso "solido e sicuro": invece di riclassificare voce-per-voce
// (mappa ruolo-dipendente, fragile), il certificato viene alimentato dalle
// voci AGGREGATE che il liquidato CINECA espone e che sono INDIPENDENTI
// dal ruolo (ND/PO/…). Vedi CERTIFICATO_DA_API.md.
//
// Aritmetica con decimal.js (ROUND_HALF_UP, 2 decimali) — MAI float binari.
// Nessun dato personale in questo file.
// ============================================================

import Decimal from 'decimal.js'
import type { CertificatoCalcolato, ExtraerarialeRiga } from '../cedolino/types.js'
import type { LiquidatoVoce } from '../verificaLiquidato/types.js'

Decimal.set({ rounding: Decimal.ROUND_HALF_UP })

// --- Codici voce AGGREGATO (role-independent) -------------------------------
export const VOCE_LORDO         = '01096' // imponibile / lordo
export const VOCE_PREVIDENZIALI = '00990' // ritenute previdenziali (dipendente)
export const VOCE_FISCALI       = '00991' // ritenute fiscali nette
export const VOCE_EXTRAERARIALI = '00994' // ritenute extraerariali
export const VOCE_NETTO         = '03003' // netto in busta corrente (quadratura)
// Inglobamenti d'ufficio
export const VOCE_ABB_TFR       = '01323' // Abb.TFR (2,5% su 80% imponibile) → previdenziali
export const VOCI_ADDIZIONALI: readonly string[] = ['00816', '01797', '02787'] // → fiscali

// Etichette extraerariali note (solo per il dettaglio righe, non per il calcolo)
const DESCR_EXTRA: Record<string, string> = {
  '00850': 'Cessione del quinto',
  '04891': 'Rimborso prestito',
  '00854': 'CRAL',
  '14386': 'Trattenuta sindacale',
  '00713': 'Contributo assistenziale',
}

const money = (d: Decimal): number | null => (d.isFinite() ? d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber() : null)

export interface OpzioniAggregati {
  /** Capitolo principale del mese corrente. Default '000100'. */
  capitolo?: string
  /** flagc del mese corrente. Default '0' (esclude gli arretrati flagc '1'/…). */
  flagcCorrente?: string
}

export interface RigaRetribuzione { codice: string; descrizione: string; valore: number }

export interface RisultatoCertificatoAggregati {
  certificato: CertificatoCalcolato
  /** Netto in busta esposto dal liquidato (voce 03003) nello scope. */
  nettoCedolino: number | null
  /** true se netto_a_pagare calcolato ≈ voce 03003 (tolleranza 1 cent). */
  quadratura: boolean
  /** Competenze del mese corrente, per la tabella RETRIBUZIONE (informativo). */
  retribuzione: RigaRetribuzione[]
  /** Componenti aggregate individuali — per costruire un CedolinoParsed coerente. */
  componenti: {
    lordo:            number   // 01096
    fiscaliNette:     number   // 00991
    addizionali:      number   // Σ 00816/01797/02787
    addizionaliRighe: { codice: string; valore: number }[]
    previdenziali:    number   // 00990
    abbTfr:           number   // 01323
    extraerariali:    number   // 00994
  }
  scope: { capitolo: string; flagc: string }
}

function scadenza(rif: string | null): string | null {
  const m = rif?.match(/DF@(\d{2}\/\d{2}\/\d{4})@/)
  return m ? m[1] : null
}

/**
 * Costruisce il certificato dagli aggregati del liquidato per il mese corrente.
 * @param dettaglio righe del liquidato (`/liquidazioni/liquidato/dettaglio`)
 * @param descrizioniCompetenze mappa opzionale codice→descrizione per la tabella
 *        RETRIBUZIONE (ruolo-aware). Non influenza i numeri del certificato.
 */
export function certificatoDaAggregati(
  dettaglio: LiquidatoVoce[],
  opts: OpzioniAggregati = {},
  descrizioniCompetenze: Record<string, string> = {},
): RisultatoCertificatoAggregati {
  const capitolo = opts.capitolo ?? '000100'
  const flagc    = opts.flagcCorrente ?? '0'

  // RUN PRINCIPALE del mese = il progrLiquidazione con il 01096 (lordo) più alto
  // sul capitolo principale + flagc corrente. Serve a distinguere la liquidazione
  // ORDINARIA da eventuali CONGUAGLI/arretrati che ricadono sullo STESSO
  // capitolo/flagc (es. luglio: run "007" ordinaria + run "087" conguaglio, entrambe
  // su 000100/flagc=0 → senza questo filtro le competenze si raddoppiano).
  const baseRows = dettaglio.filter(
    v => v.flVoce === true && v.capitolo === capitolo && v.flagc === flagc && v.voce === VOCE_LORDO,
  )
  const runPrincipale: string | undefined = baseRows.length
    ? baseRows.reduce((best, v) => (v.importoTotale > best.importoTotale ? v : best)).progrLiquidazione
    : undefined
  const stessaRun = (v: LiquidatoVoce) => runPrincipale === undefined || v.progrLiquidazione === runPrincipale

  // Scope BASE = capitolo principale (000100) + mese corrente (flagc=0) + run principale:
  // lordo, previdenziali, fiscali nette, extraerariali, competenze, extra-righe.
  // Esclude i capitoli-doppione (es. 001277 che replica le competenze), i run
  // arretrati/conguagli e gli straordinari su altri capitoli (flagc!=0).
  const inScope = (v: LiquidatoVoce) =>
    v.flVoce === true && v.capitolo === capitolo && v.flagc === flagc && stessaRun(v)
  const righe   = dettaglio.filter(inScope)
  const sumVoce = (code: string) =>
    righe.filter(v => v.voce === code).reduce((a, v) => a.plus(v.importoTotale), new Decimal(0))

  // Scope MESE = mese corrente (flagc=0) + run principale, su QUALSIASI capitolo. Serve per:
  //  - le ADDIZIONALI (stanno sul capitolo accessorio 000103, non su 000100);
  //  - il NETTO in busta 03003, ripartito (000100 al lordo, 000103 che sottrae le
  //    addizionali) → la somma dà il netto reale del cedolino ordinario.
  // Restano fuori arretrati (flagc!=0) e conguagli (altra run).
  const righeMese   = dettaglio.filter(v => v.flVoce === true && v.flagc === flagc && stessaRun(v))
  const sumMese     = (code: string) =>
    righeMese.filter(v => v.voce === code).reduce((a, v) => a.plus(v.importoTotale), new Decimal(0))
  const sumMeseMany = (codes: readonly string[]) =>
    codes.reduce((a, c) => a.plus(sumMese(c)), new Decimal(0))

  const lordo         = sumVoce(VOCE_LORDO)
  const fiscaliNette  = sumVoce(VOCE_FISCALI)
  const previdenziali = sumVoce(VOCE_PREVIDENZIALI)
  const abbTfr        = sumVoce(VOCE_ABB_TFR)
  const extra         = sumVoce(VOCE_EXTRAERARIALI)
  const addizionali   = sumMeseMany(VOCI_ADDIZIONALI)   // inglobate nelle fiscali
  const fisc  = fiscaliNette.plus(addizionali)
  const prev  = previdenziali.plus(abbTfr)
  const nettoLegge  = lordo.minus(fisc).minus(prev)
  const nettoPagare = nettoLegge.minus(extra)

  // Netto in busta = Σ 03003 del mese corrente su tutti i capitoli.
  const nettoCedDec   = sumMese(VOCE_NETTO)
  const nettoCedolino = righeMese.some(v => v.voce === VOCE_NETTO) ? money(nettoCedDec) : null
  const quadratura    = nettoCedolino !== null && nettoPagare.minus(nettoCedolino).abs().lte(0.01)

  // Dettaglio extraerariali (per il template): righe note che compongono 00994.
  const extraRows: ExtraerarialeRiga[] = righe
    .filter(v => v.voce in DESCR_EXTRA && v.importoTotale !== 0)
    .map(v => ({
      descrizione: DESCR_EXTRA[v.voce],
      decorrenza:  null,
      scadenza:    scadenza(v.riferimento),
      valore:      money(new Decimal(v.importoTotale)),
    }))

  // Tabella RETRIBUZIONE (informativa, ruolo-aware via mappa descrizioni).
  const retribuzione: RigaRetribuzione[] = Object.entries(
    righe.reduce<Record<string, Decimal>>((acc, v) => {
      if (v.voce in descrizioniCompetenze) acc[v.voce] = (acc[v.voce] ?? new Decimal(0)).plus(v.importoTotale)
      return acc
    }, {}),
  ).map(([codice, tot]) => ({ codice, descrizione: descrizioniCompetenze[codice], valore: money(tot) ?? 0 }))

  const certificato: CertificatoCalcolato = {
    lordo_teorico:          money(lordo),
    ritenute_fiscali:       money(fisc),
    ritenute_previdenziali: money(prev),
    netto_ritenute_legge:   money(nettoLegge),
    extraerariali_totale:   money(extra),
    extraerariali_righe:    extraRows,
    netto_a_pagare:         money(nettoPagare),
    quinto:                 money(nettoLegge.div(5)),
    settimo:                money(nettoLegge.div(7)),
  }

  const componenti = {
    lordo:         money(lordo) ?? 0,
    fiscaliNette:  money(fiscaliNette) ?? 0,
    addizionali:   money(addizionali) ?? 0,
    addizionaliRighe: VOCI_ADDIZIONALI
      .map(c => ({ codice: c, valore: money(sumMese(c)) ?? 0 }))
      .filter(r => r.valore !== 0),
    previdenziali: money(previdenziali) ?? 0,
    abbTfr:        money(abbTfr) ?? 0,
    extraerariali: money(extra) ?? 0,
  }

  return { certificato, nettoCedolino, quadratura, retribuzione, componenti, scope: { capitolo, flagc } }
}
