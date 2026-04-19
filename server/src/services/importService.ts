// ============================================================
// PAYROLL GANG SUITE — ImportService
// Parsing XML DATAPACKET HR 2.0 → upsert su DB
// Formato supportato: Elenchi_del_personale_v2.xml (campo INQUADR)
// ============================================================

import type {
  IAnagraficheRepository,
  IVociRepository,
  ICapitoliAnagRepository,
  ImportResult,
  AnagraficaInput,
  VoceInput,
  CapitoloAnagInput,
  CapitoloSorgente,
} from '../db/IRepository.js'

// ------------------------------------------------------------
// Parser XML minimale (senza dipendenze esterne)
// Il formato DATAPACKET usa solo attributi su tag <ROW ... />
// ------------------------------------------------------------

function parseDatapacketRows(xmlContent: string): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = []
  const rowRegex = /<ROW\s+([^>]*?)\/>/gs

  let match: RegExpExecArray | null
  while ((match = rowRegex.exec(xmlContent)) !== null) {
    const attrString  = match[1] ?? ''
    const attrRegex   = /(\w+)="([^"]*)"/g
    const attributes: Record<string, string> = {}

    let attrMatch: RegExpExecArray | null
    while ((attrMatch = attrRegex.exec(attrString)) !== null) {
      const key = attrMatch[1]
      const val = attrMatch[2]
      if (key && val !== undefined && key !== 'RowState') {
        attributes[key] = val
          .replace(/&apos;/g, "'")
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
      }
    }

    if (Object.keys(attributes).length > 0) rows.push(attributes)
  }

  return rows
}

// ------------------------------------------------------------
// Import Anagrafiche — formato v2 (Elenchi_del_personale_v2.xml)
// ------------------------------------------------------------

/**
 * Mapping descrizione ruolo → codice breve.
 * Fallback: primi 10 caratteri uppercase della descrizione.
 */
const RUOLO_V2_MAP: Record<string, string> = {
  'Professori Ordinari':               'PO',
  'Professori Associati':              'PA',
  'Ricercatori Universitari':          'RU',
  'Ricercatori Legge 240/10 - t.det.': 'RD',
  'Ricercatori Legge 240/10 - t.ind.': 'RD',
  'Personale non docente':             'ND',
  'NON DOCENTI A TEMPO DET. (TESORO)': 'ND',
  'Dirigente':                         'DI',
  'Dirigente a contratto':             'DI',
}

function mapRuoloCod(desc: string): string {
  return RUOLO_V2_MAP[desc] ?? desc.slice(0, 10).toUpperCase().trim()
}

/** Converte data YYYYMMDD → YYYY-MM-DD. Ritorna undefined se mancante/malformata. */
function parseDateV2(s: string | undefined): string | undefined {
  if (!s || s.length !== 8) return undefined
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

export async function importAnagrafiche(
  xmlContent:        string,
  repo:              IAnagraficheRepository,
  dataAggiornamento: Date = new Date(),
): Promise<ImportResult> {
  const rows  = parseDatapacketRows(xmlContent)
  const items: AnagraficaInput[] = []
  const errors: ImportResult['errors'] = []

  rows.forEach((row, index) => {
    if (!row['MATRICOLA'] || !row['COGN_NOME'] || !row['RUOLO']) {
      errors.push({ row: index + 1, message: 'Campi obbligatori mancanti: MATRICOLA, COGN_NOME, RUOLO' })
      return
    }

    const ruoloDesc = row['RUOLO'].trim()
    const decorInq  = parseDateV2(row['DECOR_INQ'])
      ?? dataAggiornamento.toISOString().slice(0, 10)
    const finRap    = parseDateV2(row['FIN_RAP'])

    items.push({
      matricola:         row['MATRICOLA'].trim(),
      cognNome:          row['COGN_NOME'].trim(),
      ruolo:             mapRuoloCod(ruoloDesc),
      // druolo: INQUADR se presente (qualifica dettagliata), fallback descrizione ruolo
      druolo:            row['INQUADR']?.trim() || ruoloDesc,
      decorInq,
      finRap,
      dataAggiornamento,
    })
  })

  if (items.length === 0 && errors.length === rows.length) {
    return { inserted: 0, updated: 0, skipped: 0, errors, processedAt: new Date() }
  }
  const result = await repo.upsertMany(items)
  return { ...result, errors: [...result.errors, ...errors] }
}

// ------------------------------------------------------------
// Import Voci e Capitoli
// ------------------------------------------------------------

export async function importVoci(
  xmlContent: string,
  repo:       IVociRepository,
): Promise<ImportResult> {
  const rows = parseDatapacketRows(xmlContent)

  const vociMap = new Map<string, VoceInput>()
  const errors: ImportResult['errors'] = []

  rows.forEach((row, index) => {
    if (!row['COD_DESCR']) {
      errors.push({ row: index + 1, message: 'COD_DESCR mancante' })
      return
    }

    const match = row['COD_DESCR'].match(/^(\d+)\s*-\s*(.+)$/)
    if (!match) {
      errors.push({ row: index + 1, message: `COD_DESCR formato non riconosciuto: ${row['COD_DESCR']}` })
      return
    }

    const codice      = match[1]?.trim() ?? ''
    const descrizione = match[2]?.trim() ?? ''
    const dataIn      = row['DATA_IN'] ?? '19000101'
    const key         = `${codice}|${dataIn}`

    if (!vociMap.has(key)) {
      const voceItem: VoceInput = {
        codice,
        descrizione,
        dataIn,
        dataFin:  row['DATA_FIN'] ?? '22220202',
        capitoli: [],
      }
      const tipo       = row['TIPO']?.trim()
      const personale  = row['PERSONALE']?.trim()
      const immissione = row['IMMISSIONE']?.trim()
      const conguaglio = row['CONGUAGLIO']?.trim()
      if (tipo)       voceItem.tipo       = tipo
      if (personale)  voceItem.personale  = personale
      if (immissione) voceItem.immissione = immissione
      if (conguaglio) voceItem.conguaglio = conguaglio
      vociMap.set(key, voceItem)
    }

    if (row['COD_CAP']) {
      const voce    = vociMap.get(key)!
      const capCode = row['COD_CAP'].trim()
      if (!voce.capitoli.some(c => c.codice === capCode)) {
        const cap: { codice: string; descrizione?: string } = { codice: capCode }
        const descr = row['DESCR_CAP']?.trim()
        if (descr) cap.descrizione = descr
        voce.capitoli.push(cap)
      }
    }
  })

  const items = Array.from(vociMap.values())

  if (items.length === 0) {
    return { inserted: 0, updated: 0, skipped: 0, errors, processedAt: new Date() }
  }

  const result = await repo.upsertMany(items)
  return { ...result, errors: [...result.errors, ...errors] }
}

// ------------------------------------------------------------
// Import Capitoli Anagrafica
// Compatibile con Capitoli_STAMPA.xml E Capitoli_Locali_STAMPA.xml
// ------------------------------------------------------------

export async function importCapitoli(
  xmlContent: string,
  sorgente:   CapitoloSorgente,
  repo:       ICapitoliAnagRepository,
): Promise<ImportResult> {
  const rows  = parseDatapacketRows(xmlContent)
  const items: CapitoloAnagInput[] = []
  const errors: ImportResult['errors'] = []

  rows.forEach((row, index) => {
    const codice = row['CAPITOLO']?.trim()
    if (!codice) {
      errors.push({ row: index + 1, message: 'Campo CAPITOLO mancante o vuoto' })
      return
    }

    const item: CapitoloAnagInput = {
      codice,
      sorgente,
      descrizione: row['DESCR']?.trim()      || undefined,
      breve:       row['BREVE']?.trim()      || undefined,
      tipoLiq:     row['TIPO_LIQ']?.trim()   || undefined,
      fCapitolo:   row['F_CAPITOLO']?.trim() || undefined,
      dataIns:     row['DATA_INS']?.trim()   || undefined,
      dataMod:     row['DATA_MOD']?.trim()   || undefined,
      operatore:   row['OPERATORE']?.trim()  || undefined,
    }
    items.push(item)
  })

  if (items.length === 0) {
    return { inserted: 0, updated: 0, skipped: 0, errors, processedAt: new Date() }
  }

  const result = await repo.upsertMany(items)
  return { ...result, errors: [...result.errors, ...errors] }
}
