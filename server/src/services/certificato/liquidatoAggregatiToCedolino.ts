// ============================================================
// PAYROLL GANG SUITE — Adapter: liquidato (AGGREGATI) → CedolinoParsed
// Costruisce un CedolinoParsed COERENTE a partire dalle voci aggregate del
// liquidato (01096/00990/00991/00994 + Abb.TFR 01323 + addizionali), così:
//  - il corpo del certificato usa `certificato` (numeri validati 4/4);
//  - la tabella di verifica (computeRiassunto → computeCertificato su
//    voci_dettaglio/riepilogo) riproduce gli STESSI numeri.
// Nessuna matematica reinventata: il certificato finale è computeCertificato().
// ============================================================

import type {
  CedolinoParsed, AnagraficaCedolino, VoceDettaglio, VoceTeorica, RiepilogoCedolino,
} from '../cedolino/types.js'
import { computeCertificato } from '../cedolino/calculator.js'
import type { LiquidatoVoce } from '../verificaLiquidato/types.js'
import { certificatoDaAggregati, type OpzioniAggregati } from './certificatoDaAggregati.js'

/** Descrizioni competenza ruolo-aware (solo per la tabella RETRIBUZIONE). */
export const DESCRIZIONI_COMPETENZE: Record<string, string> = {
  '00010': 'Stipendio',
  '01251': 'I.I.S.',
  '00055': 'I.I.S.',
  '00265': 'I.V.C. + Elemento perequativo',
  '00017': 'Assegno ad personam',
  '10265': 'Differenziale indiv. Stipendio',
  '10266': 'Differenziale indiv. I.I.S.',
  '00060': 'Assegno aggiuntivo',
  '00012': 'Classi e scatti',
  // ⚠ 00050 escluso di proposito: per i PO duplica lo stipendio base (00010).
}

const LABEL_ADDIZIONALE: Record<string, string> = {
  '00816': 'Addizionale regionale',
  '01797': 'Addizionale comunale',
  '02787': 'Acconto addizionale comunale',
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

function det(sezione: VoceDettaglio['sezione'], descrizione: string, valore: number,
            extra: Partial<VoceDettaglio> = {}): VoceDettaglio {
  return {
    sezione, descrizione, valore, numeri_riga: [],
    arretrato: false, conguaglio: false, scadenza: null, decorrenza: null, ...extra,
  }
}

export interface OpzioniAdapterAggregati extends OpzioniAggregati {
  anagrafica: AnagraficaCedolino
  descrizioniCompetenze?: Record<string, string>
}

export interface RisultatoAdapterAggregati {
  parsed: CedolinoParsed
  quadratura: boolean
  nettoCedolino: number | null
}

/**
 * Costruisce il CedolinoParsed del mese corrente dagli aggregati del liquidato.
 * Le voci di competenza servono solo per la tabella RETRIBUZIONE; i totali
 * derivano dagli aggregati (indipendenti dal ruolo).
 */
export function liquidatoAggregatiToCedolino(
  dettaglio: LiquidatoVoce[],
  opts: OpzioniAdapterAggregati,
): RisultatoAdapterAggregati {
  const descr = opts.descrizioniCompetenze ?? DESCRIZIONI_COMPETENZE
  const agg = certificatoDaAggregati(dettaglio, opts, descr)
  const c = agg.componenti

  // ── voci teoriche (RETRIBUZIONE) — bilanciate al lordo 01096 ─────────────
  const voci_teoriche: VoceTeorica[] = agg.retribuzione.map(r => ({
    descrizione: r.descrizione, valore: r.valore, totale: false,
  }))
  const sommaTeoriche = round2(voci_teoriche.reduce((a, t) => a + (t.valore ?? 0), 0))
  const deltaLordo = round2(c.lordo - sommaTeoriche)
  if (voci_teoriche.length === 0) {
    voci_teoriche.push({ descrizione: 'Retribuzione lorda', valore: c.lordo, totale: false })
  } else if (Math.abs(deltaLordo) >= 0.01) {
    voci_teoriche.push({ descrizione: 'Altre competenze', valore: deltaLordo, totale: false })
  }

  // ── voci di dettaglio (guidano la tabella di verifica) ───────────────────
  const voci_dettaglio: VoceDettaglio[] = []
  for (const t of voci_teoriche) voci_dettaglio.push(det('retribuzioni', t.descrizione, t.valore ?? 0))
  voci_dettaglio.push(det('fiscali_correnti', 'Ritenute fiscali', c.fiscaliNette))
  for (const a of c.addizionaliRighe)
    voci_dettaglio.push(det('fiscali_conguaglio', LABEL_ADDIZIONALE[a.codice] ?? `Addizionale ${a.codice}`, a.valore))
  voci_dettaglio.push(det('contributi', 'Ritenute previdenziali ed assistenziali', c.previdenziali))
  if (c.abbTfr !== 0) voci_dettaglio.push(det('abbattimenti', 'Abb. T.F.R.', c.abbTfr))

  // extraerariali: righe note + eventuale conguaglio a pareggio di 00994
  const extraRighe = agg.certificato.extraerariali_righe
  const sommaExtraNote = round2(extraRighe.reduce((a, r) => a + (r.valore ?? 0), 0))
  for (const r of extraRighe)
    voci_dettaglio.push(det('altre_ritenute', r.descrizione, r.valore ?? 0,
      { scadenza: r.scadenza, decorrenza: r.decorrenza }))
  const deltaExtra = round2(c.extraerariali - sommaExtraNote)
  if (Math.abs(deltaExtra) >= 0.01)
    voci_dettaglio.push(det('altre_ritenute', 'Altre ritenute extraerariali', deltaExtra))

  const riepilogo_cedolino: RiepilogoCedolino = {
    retribuzioni:   c.lordo,
    accessorie:     0,
    abbattimenti:   c.abbTfr,
    contributi:     c.previdenziali,
    fiscali_totali: round2(c.fiscaliNette + c.addizionali),
    altre_ritenute: c.extraerariali,
    netto_cedolino: agg.nettoCedolino,
  }

  // Certificato finale: matematica INVARIATA (stessa del percorso PDF).
  const certificato = computeCertificato(voci_teoriche, voci_dettaglio, riepilogo_cedolino)

  return {
    parsed: { anagrafica: opts.anagrafica, voci_teoriche, voci_dettaglio, riepilogo_cedolino, certificato },
    quadratura: agg.quadratura,
    nettoCedolino: agg.nettoCedolino,
  }
}
