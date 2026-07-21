// ============================================================
// PAYROLL GANG SUITE — Business Logic Utilities
// Scorporo, CSV export HR, totali
// ============================================================

import type {
  Nominativo,
  DettaglioLiquidazione,
  CsvExportRow,
  ScorporoMap,
} from '../types'
import { CSV_FIXED } from '../constants/csvDefaults'
import { isRuoloScorporabile } from '../constants/scorporoCoefficients'

// ── Scorporo ─────────────────────────────────────────────────

/**
 * Calcola l'importo da inserire nel CSV.
 * Se flagScorporo && ruolo scorporabile → applica formula netto.
 * tipoScorporo 'contoterzi' → usa coefficientiContoTerzi se disponibile.
 * Altrimenti → importo lordo invariato.
 *
 * Formula: lordo ÷ (1 + coeff/100)
 */
export function calcolaImportoCSV(
  nominativo:              Nominativo,
  dettaglio:               DettaglioLiquidazione,
  coefficienti:            ScorporoMap,
  coefficientiContoTerzi?: ScorporoMap,
): number {
  if (!dettaglio.flagScorporo) return nominativo.importoLordo

  // Scegli la mappa in base al tipo di scorporo
  const useContoTerzi = dettaglio.tipoScorporo === 'contoterzi' && !!coefficientiContoTerzi
  const map = useContoTerzi ? coefficientiContoTerzi! : coefficienti

  if (!isRuoloScorporabile(nominativo.ruolo, map)) return nominativo.importoLordo

  const coeff = map[nominativo.ruolo]
  if (coeff === undefined) return nominativo.importoLordo
  return Math.round((nominativo.importoLordo / (1 + coeff / 100)) * 100) / 100
}

// ── CSV Export ────────────────────────────────────────────────

/**
 * Costruisce le righe CSV HR (24 colonne, separatore ;).
 * Per ogni DettaglioLiquidazione genera una riga per ogni Nominativo associato.
 */
export function buildCsvRows(
  dettagli:                DettaglioLiquidazione[],
  nominativi:              Nominativo[],
  coefficienti:            ScorporoMap,
  coefficientiContoTerzi?: ScorporoMap,
): CsvExportRow[] {
  const rows: CsvExportRow[] = []

  for (const det of dettagli) {
    const noms = nominativi.filter(n => n.dettaglioId === det.id)
    const [anno, mese] = parseCompetenza(det.competenzaLiquidazione)

    for (const nom of noms) {
      rows.push({
        matricola:                   nom.matricola,
        comparto:                    CSV_FIXED.comparto,
        ruolo:                       nom.ruolo,
        codiceVoce:                  det.voce,
        identificativoProvvedimento: det.identificativoProvvedimento,
        tipoProvvedimento:           '',
        numeroProvvedimento:         '',
        dataProvvedimento:           det.dataProvvedimento,
        annoCompetenzaLiquidazione:  anno,
        meseCompetenzaLiquidazione:  mese,
        dataCompetenzaVoce:          det.dataCompetenzaVoce,
        codiceStatoVoce:             CSV_FIXED.codiceStatoVoce,
        aliquota:                    det.aliquota,
        parti:                       det.parti,
        importo:                     calcolaImportoCSV(nom, det, coefficienti, coefficientiContoTerzi),
        codiceDivisa:                CSV_FIXED.codiceDivisa,
        codiceEnte:                  CSV_FIXED.codiceEnte,
        codiceCapitolo:              det.capitolo,
        codiceCentroDiCosto:         det.centroCosto,
        // Riferimento per-nominativo (tag WD/WE con CF) vince su quello del
        // gruppo (TL). Backward compat: nominativi senza il campo → gruppo.
        riferimento:                 nom.riferimentoCedolino || det.riferimentoCedolino,
        codiceRiferimentoVoce:       CSV_FIXED.codiceRiferimentoVoce,
        flagAdempimenti:             det.flagAdempimenti,
        idContrattoCSA:              det.idContrattoCSA,
        nota:                        det.note,
      })
    }
  }

  return rows
}

/** Header CSV HR (24 colonne) */
const CSV_HEADER = [
  'matricola', 'comparto', 'ruolo', 'codiceVoce',
  'identificativoProvvedimento', 'tipoProvvedimento', 'numeroProvvedimento',
  'dataProvvedimento', 'annoCompetenzaLiquidazione', 'meseCompetenzaLiquidazione',
  'dataCompetenzaVoce', 'codiceStatoVoce', 'aliquota', 'parti',
  'importo', 'codiceDivisa', 'codiceEnte', 'codiceCapitolo',
  'codiceCentroDiCosto', 'riferimento', 'codiceRiferimentoVoce',
  'flagAdempimenti', 'idContrattoCSA', 'nota',
].join(';')

/**
 * Converte data ISO YYYY-MM-DD → GG/MM/YYYY per il CSV HR Suite.
 * Stringa non ISO o vuota → ritorna invariata.
 */
export function formatCsvDate(isoDate: string): string {
  if (!isoDate) return ''
  const parts = isoDate.split('-')
  if (parts.length !== 3) return isoDate
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

/**
 * Serializza righe CsvExportRow in stringa CSV (RFC 4180, BOM UTF-8 gestito in download).
 * Date ISO → GG/MM/YYYY per compatibilità HR Suite.
 * Termina con \r\n (riga finale inclusa).
 */
export function serializeCsv(rows: CsvExportRow[]): string {
  const dataRows = rows.map(r =>
    [
      csvEscape(r.matricola),
      csvEscape(r.comparto),
      csvEscape(r.ruolo),
      csvEscape(r.codiceVoce),
      csvEscape(r.identificativoProvvedimento),
      csvEscape(r.tipoProvvedimento),
      csvEscape(r.numeroProvvedimento),
      csvEscape(r.dataProvvedimento),
      csvEscape(r.annoCompetenzaLiquidazione),
      csvEscape(r.meseCompetenzaLiquidazione),
      csvEscape(formatCsvDate(r.dataCompetenzaVoce)),
      csvEscape(r.codiceStatoVoce),
      String(r.aliquota),
      String(r.parti),
      String(r.importo),
      csvEscape(r.codiceDivisa),
      csvEscape(r.codiceEnte),
      csvEscape(r.codiceCapitolo),
      csvEscape(r.codiceCentroDiCosto),
      csvEscape(r.riferimento),
      csvEscape(r.codiceRiferimentoVoce),
      String(r.flagAdempimenti),
      csvEscape(r.idContrattoCSA),
      csvEscape(r.nota),
    ].join(';'),
  )
  // Termina con \r\n dopo l'ultima riga (richiesto da HR Suite)
  //return [CSV_HEADER, ...dataRows].join('\r\n') + '\r\n'
  return [CSV_HEADER, ...dataRows].join('\n') + '\n'
}

// ── Codifica Windows-1252 (ANSI) ──────────────────────────────
// HR Suite legge il CSV in ANSI: un Blob da stringa JS è sempre UTF-8,
// quindi "à", "°", "€" ecc. diventerebbero 2-3 byte e verrebbero corrotti.
// Codifichiamo a mano: Latin-1 coincide col codepoint; il range 0x80–0x9F
// di CP1252 (€, virgolette tipografiche, trattini…) va mappato a parte.

const CP1252_EXTRA: Record<number, number> = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
  0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
  0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
  0x017E: 0x9E, 0x0178: 0x9F,
}

/** Stringa → byte Windows-1252. Caratteri non rappresentabili → '?'. */
export function encodeWindows1252(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) {
    const cp = s.charCodeAt(i)
    if (cp <= 0x7F || (cp >= 0xA0 && cp <= 0xFF)) out[i] = cp
    else out[i] = CP1252_EXTRA[cp] ?? 0x3F  // '?'
  }
  return out
}

/**
 * Trigger download CSV nel browser in ANSI Windows-1252 SENZA BOM
 * (richiesto da HR Suite — niente UTF-8, niente BOM).
 */
export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([encodeWindows1252(content)], { type: 'text/csv;charset=windows-1252' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}

// ── Date helpers ──────────────────────────────────────────────

/** "MM/YYYY" → ["YYYY", "MM"] */
function parseCompetenza(competenza: string): [string, string] {
  const parts = competenza.split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return ['', '']
  const [mm = '', yyyy = ''] = parts
  if (!/^\d{2}$/.test(mm) || !/^\d{4}$/.test(yyyy)) return ['', '']
  return [yyyy, mm]
}

/**
 * Calcola l'ultimo giorno del mese per dataCompetenzaVoce default.
 * Input: "MM/YYYY" → Output: "YYYY-MM-DD"
 */
export function lastDayOfMonth(competenza: string): string {
  const [mm, yyyy] = competenza.split('/')
  if (!mm || !yyyy) return ''
  // giorno 0 del mese successivo = ultimo giorno del mese corrente
  const d   = new Date(parseInt(yyyy), parseInt(mm), 0)
  // Usa metodi locali: toISOString() converte in UTC e in timezone UTC+1/+2
  // restituirebbe il giorno prima (es. 31/03 → "2024-03-30")
  const y   = d.getFullYear()
  const mon = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${mon}-${day}`
}

/**
 * ISO date → "DD/MM/YYYY" (campo dataProvvedimento CSV).
 * Parse date-only ISO strings as local time to avoid UTC midnight offset bug.
 */
export function formatDateItalian(isoDate: string): string {
  const parts = isoDate.split('-')
  if (parts.length === 3) {
    const y = parseInt(parts[0]!, 10)
    const m = parseInt(parts[1]!, 10) - 1
    const d = parseInt(parts[2]!, 10)
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      const date = new Date(y, m, d)
      return date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
    }
  }
  // Fallback for datetime strings
  const dt = new Date(isoDate)
  if (isNaN(dt.getTime())) return isoDate
  return dt.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/**
 * Escaping CSV: avvolge in virgolette se contiene ; " o newline.
 */
function csvEscape(value: string): string {
  if (!value) return ''
  if (value.includes(';') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

// ── Totalizzatori ─────────────────────────────────────────────

export interface TotaliLiquidazione {
  totaleNominativi:  number
  totaleImportoLordo: number
  totaleImportoCSV:   number
  perDettaglio: Array<{
    id:           string
    nome:         string
    count:        number
    totaleLordo:  number
    totaleCSV:    number
  }>
}

export function calcolaTotali(
  dettagli:                DettaglioLiquidazione[],
  nominativi:              Nominativo[],
  coefficienti:            ScorporoMap,
  coefficientiContoTerzi?: ScorporoMap,
): TotaliLiquidazione {
  const perDettaglio = dettagli.map(det => {
    const noms       = nominativi.filter(n => n.dettaglioId === det.id)
    const totaleLordo = noms.reduce((s, n) => s + n.importoLordo, 0)
    const totaleCSV   = noms.reduce((s, n) => s + calcolaImportoCSV(n, det, coefficienti, coefficientiContoTerzi), 0)
    return {
      id:          det.id,
      nome:        det.nomeDescrittivo,
      count:       noms.length,
      totaleLordo: round2(totaleLordo),
      totaleCSV:   round2(totaleCSV),
    }
  })

  return {
    totaleNominativi:   nominativi.length,
    totaleImportoLordo: round2(perDettaglio.reduce((s, d) => s + d.totaleLordo, 0)),
    totaleImportoCSV:   round2(perDettaglio.reduce((s, d) => s + d.totaleCSV,   0)),
    perDettaglio,
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** Formatta numero come valuta italiana: "1.234,56 €" */
export function formatEur(n: number): string {
  return n.toLocaleString('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' €'
}

/**
 * Ritorna la data fine rapporto formattata DD/MM/YYYY se è precedente
 * alla data di competenza voce, null altrimenti.
 * Confronto lessicografico su ISO date (YYYY-MM-DD) — sicuro e O(1).
 * Usata sia nell'anteprima di aggiunta (NominativoFormModal, warning ambra)
 * sia nella lista nominativi (DettaglioCard, badge rosso cessazione).
 */
export function finRapWarn(
  finRap:         string | null | undefined,
  dataCompetenza: string | undefined,
): string | null {
  if (!finRap || !dataCompetenza) return null
  if (finRap >= dataCompetenza) return null
  const [y, m, d] = finRap.split('-')
  return `${d ?? '??'}/${m ?? '??'}/${y ?? '??'}`
}

/**
 * Età in anni compiuti alla data `asOf` per una data di nascita ISO (YYYY-MM-DD).
 * Ritorna null se una delle date manca o è malformata.
 * Usata nella scelta del figlio per il riferimento cedolino WE.
 */
export function etaAllaData(
  dataNasc: string | null | undefined,
  asOf:     string | null | undefined,
): number | null {
  if (!dataNasc || !asOf) return null
  const nascParts = dataNasc.slice(0, 10).split('-').map(Number)
  const asOfParts = asOf.slice(0, 10).split('-').map(Number)
  if (nascParts.length !== 3 || asOfParts.length !== 3) return null
  const [ny, nm, nd] = nascParts as [number, number, number]
  const [ay, am, ad] = asOfParts as [number, number, number]
  if ([ny, nm, nd, ay, am, ad].some(n => !Number.isFinite(n))) return null
  let eta = ay - ny
  // Non ancora compiuto il compleanno alla data as-of → sottrai 1
  if (am < nm || (am === nm && ad < nd)) eta--
  return eta < 0 ? null : eta
}
