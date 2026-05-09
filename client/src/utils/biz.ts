// ============================================================
// PAYROLL GANG SUITE — Business Logic Utilities
// Scorporo, CSV export HR, totali
// ============================================================

import type {
  Nominativo,
  DettaglioLiquidazione,
  CsvExportRow,
  CoefficienteScorporo,
} from '../types'
import { CSV_FIXED } from '../constants/csvDefaults'
import { isRuoloScorporabile } from '../constants/scorporoCoefficients'

// ── Scorporo ─────────────────────────────────────────────────

/**
 * Calcola l'importo da inserire nel CSV.
 * Se flagScorporo && ruolo scorporabile → applica formula netto.
 * Altrimenti → importo lordo invariato.
 */
export function calcolaImportoCSV(
  nominativo: Nominativo,
  dettaglio:  DettaglioLiquidazione,
  coefficienti: CoefficienteScorporo,
): number {
  if (!dettaglio.flagScorporo || !isRuoloScorporabile(nominativo.ruolo)) {
    return nominativo.importoLordo
  }
  const coeff = coefficienti[nominativo.ruolo as keyof CoefficienteScorporo]
  if (coeff === undefined) return nominativo.importoLordo
  return Math.round((nominativo.importoLordo / (1 + coeff / 100)) * 100) / 100
}

// ── CSV Export ────────────────────────────────────────────────

/**
 * Costruisce le righe CSV HR (24 colonne, separatore ;).
 * Per ogni DettaglioLiquidazione genera una riga per ogni Nominativo associato.
 */
export function buildCsvRows(
  dettagli:     DettaglioLiquidazione[],
  nominativi:   Nominativo[],
  coefficienti: CoefficienteScorporo,
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
        importo:                     calcolaImportoCSV(nom, det, coefficienti),
        codiceDivisa:                CSV_FIXED.codiceDivisa,
        codiceEnte:                  CSV_FIXED.codiceEnte,
        codiceCapitolo:              det.capitolo,
        codiceCentroDiCosto:         det.centroCosto,
        riferimento:                 det.riferimentoCedolino,
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
  return [CSV_HEADER, ...dataRows].join('\r\n') + '\r\n'
}

/**
 * Trigger download CSV nel browser con BOM UTF-8 (per compatibilità Excel italiano).
 */
export function downloadCsv(content: string, filename: string): void {
  const BOM  = '\uFEFF'
  const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8;' })
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
  dettagli:     DettaglioLiquidazione[],
  nominativi:   Nominativo[],
  coefficienti: CoefficienteScorporo,
): TotaliLiquidazione {
  const perDettaglio = dettagli.map(det => {
    const noms       = nominativi.filter(n => n.dettaglioId === det.id)
    const totaleLordo = noms.reduce((s, n) => s + n.importoLordo, 0)
    const totaleCSV   = noms.reduce((s, n) => s + calcolaImportoCSV(n, det, coefficienti), 0)
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
