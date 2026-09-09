// ============================================================
// PAYROLL GANG SUITE — Adapter regioni→CedolinoParsed (Strada A pura)
//
// PASSTHROUGH IDENTITÀ: ParteVoce.sezione È GIÀ un SezioneCedolino — zero
// mapping/traduzione verso il calcolatore esistente. computeCertificato,
// merge.ts, docx.ts restano INVARIATI (collasso Strada A, Gate 1).
//
// Differenze strutturali vs estrazione dinamica (cedolino/parser.ts), tutte
// dichiarate via warning in ExtractPreviewResult — mai silenti:
//  • voci_teoriche è SEMPRE [] — non esiste una regione "tabella teorici" nel
//    template (solo voci puntuali) → TEO_MANCANTE sempre presente.
//  • riepilogo_cedolino è SEMPRE sintetizzato (somma voci_dettaglio per
//    sezione), mai estratto — niente ancore stabili di riepilogo nel layout
//    arbitrario del template → RIEPILOGO_SINTETIZZATO sempre presente.
//    Resta editabile in anteprima prima della generazione.
// ============================================================

import Decimal from 'decimal.js'
import { computeCertificato } from '../cedolino/calculator.js'
import { toNum } from '../cedolino/parser.js'
import type {
  CedolinoParsed, AnagraficaCedolino, VoceDettaglio, RiepilogoCedolino, SezioneCedolino,
} from '../cedolino/types.js'
import type {
  ParteTemplate, AdattatoreWarning, AdattatoreError, ExtractPreviewResult,
} from './types.js'
import type { RegionExtractionResult, RegionTesto, RegionRuolo } from './extractor.js'

Decimal.set({ rounding: Decimal.ROUND_HALF_UP })

export function adaptToParsed(
  extraction: RegionExtractionResult,
  parti:      ParteTemplate[],
): ExtractPreviewResult {
  const warnings: AdattatoreWarning[] = []
  const errors:   AdattatoreError[]   = [...extraction.errors]

  const byParte = groupByParte(extraction.testi)

  const anagrafica     = buildAnagrafica(parti, byParte, errors)
  const voci_dettaglio = buildVociDettaglio(parti, byParte, warnings, errors)
  const riepilogo_cedolino = synthesizeRiepilogo(voci_dettaglio)

  warnings.push({
    tipo:      'RIEPILOGO_SINTETIZZATO',
    messaggio: 'Riepilogo per sezione calcolato sommando le voci individuate dalle regioni (non estratto dal PDF) — verificare in anteprima prima di generare.',
  })
  warnings.push({
    tipo:      'TEO_MANCANTE',
    messaggio: 'Voci teoriche non disponibili in estrazione da regioni — il calcolo del lordo teorico si basa solo sulle voci di dettaglio individuate.',
  })

  const certificato = computeCertificato([], voci_dettaglio, riepilogo_cedolino)

  const parsed: CedolinoParsed = {
    anagrafica,
    voci_teoriche: [],
    voci_dettaglio,
    riepilogo_cedolino,
    certificato,
  }

  return { parsed, warnings, errors }
}

// ── helpers ──────────────────────────────────────────────────

function groupByParte(testi: RegionTesto[]): Map<string, Map<RegionRuolo, string>> {
  const m = new Map<string, Map<RegionRuolo, string>>()
  for (const t of testi) {
    const inner = m.get(t.parteId) ?? new Map<RegionRuolo, string>()
    inner.set(t.ruolo, t.testo)
    m.set(t.parteId, inner)
  }
  return m
}

const ANAGRAFICA_VUOTA: AnagraficaCedolino = {
  periodo_retribuzione: null, matricola: null, cognome: null, nome: null,
  codice_fiscale: null, data_nascita: null, luogo_nascita: null,
  inquadramento: null, area_profilo: null, ruolo: null,
  inizio_rapporto: null, anzianita_servizio: null, afferenza: null, sede: null,
}

/**
 * Costruisce l'anagrafica dalle ParteAnagrafica del template.
 * PRIVACY: stesso sottoinsieme di campi del parser dinamico (no IBAN/CF
 * nucleo) — il template non può aggirarlo: AnagraficaRuolo è un'enum chiusa.
 */
function buildAnagrafica(
  parti:   ParteTemplate[],
  byParte: Map<string, Map<RegionRuolo, string>>,
  errors:  AdattatoreError[],
): AnagraficaCedolino {
  const anagrafica: AnagraficaCedolino = { ...ANAGRAFICA_VUOTA }

  for (const p of parti) {
    if (p.kind !== 'anagrafica') continue
    const testo = (byParte.get(p.id)?.get('anagrafica') ?? '').trim()
    if (!testo) {
      errors.push({
        tipo:      'REGIONE_VUOTA',
        parteId:   p.id,
        messaggio: `Nessun testo individuato nella regione anagrafica "${p.label}".`,
      })
      continue
    }
    switch (p.ruolo) {
      case 'matricola':
        anagrafica.matricola = testo
        break
      case 'periodo_retribuzione':
        anagrafica.periodo_retribuzione = testo
        break
      case 'cognome_nome': {
        const { cognome, nome } = splitCognomeNome(testo)
        anagrafica.cognome = cognome
        anagrafica.nome    = nome
        break
      }
      default:
        // Campi 1:1 — il valore del ruolo È il nome del campo AnagraficaCedolino
        // (codice_fiscale, data_nascita, luogo_nascita, inquadramento, area_profilo,
        //  ruolo, inizio_rapporto, anzianita_servizio, afferenza, sede).
        anagrafica[p.ruolo] = testo
        break
    }
  }

  if (!anagrafica.matricola && !anagrafica.cognome) {
    errors.push({
      tipo:      'ANAGRAFICA_INCOMPLETA',
      messaggio: 'Né matricola né cognome individuati dalle regioni anagrafica — identificazione minima del dipendente assente, impossibile procedere.',
    })
  }

  return anagrafica
}

/** "ROSSI Mario" → { cognome: 'ROSSI', nome: 'Mario' } — euristica ultima-parola=nome
 *  (replica la convenzione COGN_NOME "COGNOME Nome" usata nell'import anagrafiche HR). */
function splitCognomeNome(testo: string): { cognome: string | null; nome: string | null } {
  const t = testo.replace(/\s+/g, ' ').trim()
  if (!t) return { cognome: null, nome: null }
  const idx = t.lastIndexOf(' ')
  if (idx === -1) return { cognome: t, nome: null }
  return { cognome: t.slice(0, idx).trim() || null, nome: t.slice(idx + 1).trim() || null }
}

/**
 * Costruisce le VoceDettaglio dalle ParteVoce. Regole di derivazione (Strada A):
 *  • descrizione: testo letto, fallback al label del template se vuoto
 *  • valore: |importo letto| con segno applicato da `sign` — il template è la
 *    fonte di verità sul segno (l'operatore lo dichiara guardando il PDF),
 *    non il testo grezzo (più robusto di un parsing del segno da stringa:
 *    formati colonna/parentesi non uniformi fra layout diversi)
 *  • numeri_riga: [] — non ricostruibile da estrazione per regione (nessuna
 *    riga-PDF di riferimento), puramente informativo, mai consumato dal
 *    calcolatore (verificato — vedi note Gate 3 ricerca)
 *  • conguaglio: derivato da sezione (== 'fiscali_conguaglio') — anch'esso
 *    informativo, mai consumato da computeCertificato
 */
function buildVociDettaglio(
  parti:    ParteTemplate[],
  byParte:  Map<string, Map<RegionRuolo, string>>,
  warnings: AdattatoreWarning[],
  errors:   AdattatoreError[],
): VoceDettaglio[] {
  const voci: VoceDettaglio[] = []

  for (const p of parti) {
    if (p.kind !== 'voce') continue
    const testi = byParte.get(p.id)
    const descrizioneLetta = (testi?.get('descrizione') ?? '').trim()
    const importoLetto     = (testi?.get('importo')     ?? '').trim()

    if (!descrizioneLetta) {
      errors.push({
        tipo:      'REGIONE_VUOTA',
        parteId:   p.id,
        messaggio: `Nessun testo individuato nella regione descrizione di "${p.label}".`,
      })
    }

    let valoreAssoluto: number
    if (importoLetto === '') {
      warnings.push({
        tipo:      'IMPORTO_NON_LETTO',
        parteId:   p.id,
        campo:     'regioneImporto',
        messaggio: `Importo non individuato per "${p.label}" — impostato a 0, correggere in anteprima.`,
      })
      valoreAssoluto = 0
    } else {
      const n = toNum(importoLetto)
      if (n === null) {
        errors.push({
          tipo:      'IMPORTO_NON_PARSABILE',
          parteId:   p.id,
          messaggio: `Testo "${importoLetto}" non interpretabile come importo per "${p.label}" — correggere la regione o il template.`,
        })
        continue // SEC: niente valori inventati su un documento ufficiale — esclude la voce
      }
      valoreAssoluto = Math.abs(n)
    }

    voci.push({
      sezione:     p.sezione,
      descrizione: descrizioneLetta || p.label,
      valore:      p.sign === '-' ? -valoreAssoluto : valoreAssoluto,
      numeri_riga: [],
      arretrato:   p.isArretrato,
      conguaglio:  p.sezione === 'fiscali_conguaglio',
      decorrenza:  p.decorrenza ?? null,
      scadenza:    p.scadenza   ?? null,
    })
  }

  return voci
}

/**
 * Sintetizza il riepilogo per sezione sommando le voci individuate (Decimal,
 * mai float binari — coerente con calculator.ts). null per sezioni assenti
 * dal template (computeCertificato gestisce dinamicamente gli assenti).
 * netto_cedolino: non ricostruibile in modo affidabile da somma-sezioni
 * (richiede aggregati che il template non cattura) — lasciato null/editabile.
 */
function synthesizeRiepilogo(voci: VoceDettaglio[]): RiepilogoCedolino {
  const sommaSezioni = (...sezioni: SezioneCedolino[]): number | null => {
    const vs = voci.filter(v => v.sezione !== null && sezioni.includes(v.sezione))
    if (vs.length === 0) return null
    return moneyFromVoci(vs)
  }

  return {
    retribuzioni:   sommaSezioni('retribuzioni'),
    accessorie:     sommaSezioni('accessorie'),
    abbattimenti:   sommaSezioni('abbattimenti'),
    contributi:     sommaSezioni('contributi'),
    fiscali_totali: sommaSezioni('fiscali_correnti', 'fiscali_conguaglio'),
    altre_ritenute: sommaSezioni('sindacali', 'altre_ritenute'),
    netto_cedolino: null,
  }
}

function moneyFromVoci(voci: VoceDettaglio[]): number {
  const tot = voci.reduce((acc, v) => acc.plus(v.valore), new Decimal(0))
  return tot.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
}
