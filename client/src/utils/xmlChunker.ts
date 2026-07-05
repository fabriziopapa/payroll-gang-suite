// ============================================================
// PAYROLL GANG SUITE — XML Chunker
// Divide un file XML DATAPACKET HR in batch da N righe
// e li invia sequenzialmente per evitare timeout Cloudflare
// ============================================================

export interface ChunkProgress {
  current:   number   // batch corrente (1-based)
  total:     number   // totale batch
  rowsDone:  number   // righe processate finora
  rowsTotal: number   // totale righe
}

export interface ChunkResult {
  inserted: number
  updated:  number
  skipped:  number
  errors:   Array<{ row: number; message: string }>
}

/**
 * Estrae le stringhe <ROW ... /> dal contenuto XML.
 */
function extractRows(xmlContent: string): string[] {
  const rows: string[] = []
  const re = /<ROW\s[^>]*\/>/gs
  let m: RegExpExecArray | null
  while ((m = re.exec(xmlContent)) !== null) {
    rows.push(m[0])
  }
  return rows
}

/**
 * Avvolge un array di stringhe <ROW .../> in un mini-DATAPACKET valido.
 * Il parser server-side usa solo i tag ROW, quindi il wrapper è minimale.
 */
function wrapRows(rows: string[]): string {
  return [
    '<?xml version="1.0" standalone="yes"?>',
    '<DATAPACKET Version="2.0"><METADATA/><ROWDATA>',
    rows.join('\n'),
    '</ROWDATA></DATAPACKET>',
  ].join('\n')
}

/**
 * Invia un file XML HR in chunk.
 *
 * @param xmlContent  - Contenuto completo del file XML
 * @param chunkSize   - Righe per batch (default 80)
 * @param sender      - Funzione che invia un singolo chunk XML e restituisce ImportResult
 * @param onProgress  - Callback chiamata dopo ogni batch
 */
export async function sendXmlInChunks(
  xmlContent:  string,
  chunkSize:   number,
  sender:      (xml: string) => Promise<ChunkResult>,
  onProgress?: (p: ChunkProgress) => void,
): Promise<ChunkResult> {
  const rows  = extractRows(xmlContent)
  const total = Math.ceil(rows.length / chunkSize) || 1

  const aggregate: ChunkResult = { inserted: 0, updated: 0, skipped: 0, errors: [] }

  if (rows.length === 0) return aggregate

  for (let i = 0; i < rows.length; i += chunkSize) {
    const batch      = rows.slice(i, i + chunkSize)
    const chunkXml   = wrapRows(batch)
    const current    = Math.floor(i / chunkSize) + 1

    onProgress?.({
      current,
      total,
      rowsDone:  i,
      rowsTotal: rows.length,
    })

    const res = await sender(chunkXml)

    aggregate.inserted += res.inserted
    aggregate.updated  += res.updated
    aggregate.skipped  += res.skipped
    // Aggiusta i numeri di riga per i chunk successivi al primo
    aggregate.errors.push(
      ...res.errors.map(e => ({ ...e, row: e.row + i })),
    )
  }

  // Progress finale
  onProgress?.({
    current:   total,
    total,
    rowsDone:  rows.length,
    rowsTotal: rows.length,
  })

  return aggregate
}
