// ============================================================
// PAYROLL GANG SUITE — Estrazione testo da regioni PDF (region/bbox-based)
//
// Strategia INDIPENDENTE dal parser cedolino dinamico (cedolino/parser.ts):
// qui le coordinate sono FISSE (template salvato dall'utente), non ancore
// testuali di sezione. Riusa SOLO l'infrastruttura pdfjs-dist legacy build
// già in uso server-side (extractLines) e le stesse opzioni di sicurezza
// anti-DoS/anti-DOM.
//
// Conversione coordinate: RegionRect è in percentuale (0..1) della pagina
// COSÌ COME RESA dal viewport (rotazione inclusa) — esattamente lo spazio
// in cui l'editor client disegna le regioni sul canvas
// (page.getViewport({scale, rotation})). Il server replica lo stesso
// viewport (scale:1, rotation:pageGeometry.rotation) e converte le
// coordinate testo (transform[4..5], spazio PDF nativo) in spazio-viewport
// via viewport.convertToViewportPoint — stesso sistema di riferimento dei
// due lati, indipendente da zoom/DPI del client che ha creato il template.
//
// SEC: stessi limiti anti-DoS di extractLines (PDF non fidato, max 8MB —
// vincolo applicato a livello route/Zod).
// ============================================================

import type { PageGeometry, RegionRect, ParteTemplate, AdattatoreError } from './types.js'

const MAX_PAGES = 40        // mirror cedolino/parser.ts
const MAX_ITEMS = 60_000    // mirror cedolino/parser.ts
const Y_TOL     = 2         // px in spazio-viewport — frammenti entro 2px = stessa riga

export type RegionRuolo = 'descrizione' | 'importo' | 'anagrafica'

/** Testo grezzo estratto per UNA regione del template ('' = nessun frammento trovato). */
export interface RegionTesto {
  parteId: string
  ruolo:   RegionRuolo
  testo:   string
}

export interface RegionExtractionResult {
  testi:  RegionTesto[]
  /** Solo problemi STRUTTURALI/geometrici (pagina fuori range). Le valutazioni
   *  di merito sul contenuto (regione vuota, importo non parsabile, ...) sono
   *  competenza dell'adapter — qui restiamo un livello "dumb" estrazione. */
  errors: AdattatoreError[]
}

interface Richiesta { parteId: string; ruolo: RegionRuolo; regione: RegionRect }

/** Punto in spazio-viewport: origine top-left, Y crescente verso il basso (= canvas). */
interface ItemPos { x: number; y: number; str: string }

export async function extractRegions(
  buffer:       Buffer,
  pageGeometry: PageGeometry[],
  parti:        ParteTemplate[],
): Promise<RegionExtractionResult> {
  // Import dinamico del legacy build (compatibile Node, niente DOM/worker) — mirror extractLines
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(buffer)
  // SEC: stesse opzioni anti-DOM/anti-DoS di extractLines — niente filesystem
  // font dell'host, niente eval, niente fetch da worker.
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts:  false,
    disableFontFace: true,
    isEvalSupported: false,
    useWorkerFetch:  false,
  } as Parameters<typeof pdfjs.getDocument>[0])

  const testi:  RegionTesto[]     = []
  const errors: AdattatoreError[] = []
  let itemCount = 0

  try {
    const doc = await loadingTask.promise
    const numPages = Math.min(doc.numPages, MAX_PAGES)

    // Raggruppa le richieste-regione per pagina → 1 sola getTextContent/pagina
    const richiesteByPage = collectRichieste(parti)

    for (const [pageIndex, richieste] of richiesteByPage) {
      if (pageIndex < 0 || pageIndex >= numPages) {
        for (const r of richieste) {
          errors.push({
            tipo:      'PAGINA_FUORI_RANGE',
            parteId:   r.parteId,
            messaggio: `Pagina ${pageIndex + 1} fuori range (il PDF caricato ne ha ${doc.numPages}) — parte "${r.parteId}".`,
          })
          testi.push({ parteId: r.parteId, ruolo: r.ruolo, testo: '' })
        }
        continue
      }
      if (itemCount >= MAX_ITEMS) break // SEC: cap globale frammenti — interrompe l'intera estrazione

      // Geometria pagina dal template; se assente (template incoerente) usiamo
      // rotazione neutra — il viewport calcolato dal PDF reale resta comunque
      // la verità per width/height (la coerenza puntuale è demandata alla
      // revisione manuale dell'anteprima, mai automatica — vincolo Gate 0).
      const geom = pageGeometry.find(g => g.pageIndex === pageIndex)
      const page = await doc.getPage(pageIndex + 1) // pdfjs è 1-based
      const viewport = page.getViewport({ scale: 1, rotation: geom?.rotation ?? 0 })
      const tc = await page.getTextContent()

      const items: ItemPos[] = []
      for (const it of tc.items as any[]) {
        if (typeof it.str !== 'string' || !it.str.trim()) continue
        if (++itemCount > MAX_ITEMS) break // SEC: cap frammenti totali
        const [vx, vy] = viewport.convertToViewportPoint(it.transform[4], it.transform[5])
        items.push({ x: vx, y: vy, str: it.str })
      }

      for (const r of richieste) {
        const rect = {
          x0: r.regione.x * viewport.width,
          y0: r.regione.y * viewport.height,
          x1: (r.regione.x + r.regione.width)  * viewport.width,
          y1: (r.regione.y + r.regione.height) * viewport.height,
        }
        const dentro = items.filter(it => it.x >= rect.x0 && it.x <= rect.x1 && it.y >= rect.y0 && it.y <= rect.y1)
        testi.push({ parteId: r.parteId, ruolo: r.ruolo, testo: joinReadingOrder(dentro) })
      }
    }
  } finally {
    await loadingTask.destroy()
  }

  return { testi, errors }
}

// ── helpers ──────────────────────────────────────────────────

/** Raggruppa le regioni-da-leggere per pagina, marcandole col ruolo (descrizione/importo/anagrafica). */
function collectRichieste(parti: ParteTemplate[]): Map<number, Richiesta[]> {
  const byPage = new Map<number, Richiesta[]>()
  const push = (r: Richiesta) => {
    const arr = byPage.get(r.regione.pageIndex) ?? []
    arr.push(r)
    byPage.set(r.regione.pageIndex, arr)
  }
  for (const p of parti) {
    if (p.kind === 'anagrafica') {
      push({ parteId: p.id, ruolo: 'anagrafica', regione: p.regione })
    } else {
      push({ parteId: p.id, ruolo: 'descrizione', regione: p.regioneDescrizione })
      push({ parteId: p.id, ruolo: 'importo',     regione: p.regioneImporto })
    }
  }
  return byPage
}

/**
 * Ricompone il testo dei frammenti in ordine di lettura: righe top→bottom
 * (Y crescente in spazio-viewport — opposto a extractLines, che lavora in
 * spazio PDF nativo con Y crescente verso l'alto), frammenti left→right.
 * Esportata (come toNum in cedolino/parser.ts) per unit test isolato dalla
 * pipeline pdfjs — vedi extractor.test.ts.
 */
export function joinReadingOrder(items: ItemPos[]): string {
  if (items.length === 0) return ''
  const rows: Array<{ y: number; parts: ItemPos[] }> = []
  for (const it of items) {
    let row = rows.find(r => Math.abs(r.y - it.y) <= Y_TOL)
    if (!row) { row = { y: it.y, parts: [] }; rows.push(row) }
    row.parts.push(it)
  }
  rows.sort((a, b) => a.y - b.y)
  for (const r of rows) r.parts.sort((a, b) => a.x - b.x)
  return rows.map(r => r.parts.map(p => p.str).join(' ')).join(' ').replace(/\s+/g, ' ').trim()
}
