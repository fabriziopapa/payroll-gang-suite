// ============================================================
// PAYROLL GANG SUITE — Generatore DOCX certificato (server-side)
// Porting di genera_certificato.js con la lib `docx`. Consuma template-dato
// + output parser → Buffer DOCX fedele al prototipo dell'ufficio.
// ============================================================

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, WidthType, BorderStyle, PageBreak,
  Header, ImageRun, HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom,
  TextWrappingType,
} from 'docx'
import type { CedolinoParsed } from '../cedolino/types.js'
import type { CertificatoTemplate, CertificatoMeta } from './types.js'
import { computeRiassunto } from '../cedolino/calculator.js'
import { prepareData, resolve, eur, getByPath } from './merge.js'

const FONT = 'Times New Roman'

// ── Carta intestata Uniparthenope (da "Carta Intestata Uniparthenope - MODELLO.docx"):
// immagine A4 full-page dietro al testo, replicata su ogni pagina via header.
// Asset copiato in dist dal build; fallback su src per ambienti senza copia.
let _cartaIntestata: Buffer | null | undefined // undefined = non ancora caricata

function loadCartaIntestata(): Buffer | null {
  if (_cartaIntestata !== undefined) return _cartaIntestata
  for (const rel of ['./assets/carta-intestata.jpg', '../../../src/services/certificato/assets/carta-intestata.jpg']) {
    try {
      _cartaIntestata = readFileSync(fileURLToPath(new URL(rel, import.meta.url)))
      return _cartaIntestata
    } catch { /* tenta il path successivo */ }
  }
  _cartaIntestata = null // asset assente: il certificato esce senza grafica (non bloccante)
  return _cartaIntestata
}

/** Header con la carta intestata full-page (A4 @96dpi = 794×1123 px) ancorata
 *  alla pagina, dietro il testo — replica il watermark del MODELLO ufficio. */
function cartaIntestataHeader(): Header | null {
  const img = loadCartaIntestata()
  if (!img) return null
  return new Header({
    children: [new Paragraph({
      children: [new ImageRun({
        type: 'jpg',
        data: img,
        transformation: { width: 794, height: 1123 },
        floating: {
          horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
          verticalPosition:   { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
          behindDocument: true,
          allowOverlap:   true,
          wrap: { type: TextWrappingType.NONE },
        },
        altText: { title: 'Carta intestata', description: 'Carta intestata Università Parthenope', name: 'carta-intestata' },
      })],
    })],
  })
}

/** Sanifica una stringa estratta prima del rendering (PDF non fidato):
 *  rimuove caratteri di controllo C0/C1 che corromperebbero l'XML del DOCX. */
function clean(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
}

/**
 * Costruisce il documento DOCX e ritorna il Buffer.
 * `parsed` = output parser; `tpl` = strutturaJson; `meta` = dati operatore.
 */
export async function buildCertificatoDocx(
  parsed: CedolinoParsed,
  tpl: CertificatoTemplate,
  meta: CertificatoMeta,
): Promise<Buffer> {
  const ctx = prepareData(parsed, meta, tpl)
  const R = (s: string): string => clean(resolve(s, ctx.flat, ctx.sesso))

  const run = (text: string, o: { size?: number; bold?: boolean; italics?: boolean } = {}) =>
    new TextRun({ text, font: FONT, size: o.size ?? 22, bold: o.bold, italics: o.italics })

  const para = (
    runs: TextRun | TextRun[],
    o: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number } = {},
  ) => new Paragraph({
    alignment: o.align ?? AlignmentType.JUSTIFIED,
    spacing: { after: o.after ?? 120 },
    children: Array.isArray(runs) ? runs : [runs],
  })

  const border = { style: BorderStyle.SINGLE, size: 1, color: '000000' }
  const borders = { top: border, bottom: border, left: border, right: border }

  const cell = (
    text: string, w: number,
    o: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; bold?: boolean; italics?: boolean } = {},
  ) => new TableCell({
    borders, width: { size: w, type: WidthType.DXA },
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: o.align ?? AlignmentType.LEFT,
      children: [new TextRun({ text: text || '', font: FONT, size: 20, bold: o.bold, italics: o.italics })],
    })],
  })

  // Geometria pagina dal MODELLO carta intestata: A4, margine alto 5cm (fascia
  // logo), basso 3cm (fascia P.IVA), laterali 2cm → contenuto 9632 DXA.
  const W = 9632

  // Una copia completa del certificato. Costruita come funzione perché il
  // documento finale ne contiene DUE (originale per bollo + copia per ufficio):
  // gli oggetti docx non vanno riusati tra sezioni, ogni copia è ricostruita.
  const buildCopia = (): (Paragraph | Table)[] => {
    const children: (Paragraph | Table)[] = []

    // --- bollo (alto a SINISTRA, incorniciato) — modalità scelta alla
    // generazione, fallback template. Box: tabella a cella singola con bordi
    // continui, allineata al margine sinistro (lato opposto al protocollo).
    const bolloLines = (meta.bollo_testo ?? tpl.bollo.testo).split('\n')
    const BOLLO_W = 3800
    children.push(new Table({
      width: { size: BOLLO_W, type: WidthType.DXA },
      columnWidths: [BOLLO_W],
      rows: [new TableRow({
        children: [new TableCell({
          borders,
          width: { size: BOLLO_W, type: WidthType.DXA },
          margins: { top: 100, bottom: 100, left: 160, right: 160 },
          children: bolloLines.map(l => new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [run(R(l), { size: 18, bold: true })],
          })),
        })],
      })],
    }))
    children.push(para(run('', { size: 12 }), { after: 120 }))

    // --- protocollo / posizione ---
    children.push(para(run(R(tpl.intestazione.protocollo), { bold: true }), { align: AlignmentType.RIGHT, after: 0 }))
    children.push(para(run(R(tpl.intestazione.posizione), { italics: true }), { align: AlignmentType.RIGHT, after: 240 }))

    // --- titolo ---
    children.push(para(run(R(tpl.titolo), { bold: true, size: 26 }), { align: AlignmentType.CENTER, after: 240 }))

    // --- corpo ---
    for (const p of tpl.corpo) children.push(para(run(R(p))))

    // --- tabella emolumenti ---
    const c0 = 5672, c1 = 1080, c2 = 2880
    const resolveSrc = { teo: ctx.teo, cert: parsed.certificato }
    const emolRows = tpl.tabellaEmolumenti.flatMap(r => {
      const val = getByPath(resolveSrc, r.src) as number | null // SEC: blocklist prototype
      // Nel certificato compaiono SOLO le voci valorizzate (come il modello
      // dell'ufficio): righe nulle/zero vengono omesse, tranne i totali (=).
      if ((val == null || val === 0) && !r.segno.includes('=')) return []
      return [new TableRow({
        children: [
          cell(r.voce, c0, { bold: r.bold }),
          cell(r.segno, c1, { align: AlignmentType.CENTER, bold: r.bold }),
          cell(eur(val), c2, { align: AlignmentType.RIGHT, bold: r.bold }),
        ],
      })]
    })
    children.push(new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [c0, c1, c2], rows: emolRows }))
    children.push(para(run(''), { after: 120 }))

    // --- extra-erariali ---
    children.push(para(run(R(tpl.testoExtraerariali))))
    const ec0 = 4232, ec1 = 1800, ec2 = 1800, ec3 = 1800
    const exHeader = new TableRow({
      children: [
        cell('', ec0),
        cell('decorrenza', ec1, { align: AlignmentType.CENTER, italics: true }),
        cell('scadenza', ec2, { align: AlignmentType.CENTER, italics: true }),
        cell('importo rata', ec3, { align: AlignmentType.CENTER, italics: true }),
      ],
    })
    const exRows = ctx.extra.map(e => new TableRow({
      children: [
        cell(clean(e.voce), ec0),
        cell(clean(e.decorrenza), ec1, { align: AlignmentType.CENTER }),
        cell(clean(e.scadenza), ec2, { align: AlignmentType.CENTER }),
        cell(clean(e.importo), ec3, { align: AlignmentType.RIGHT }),
      ],
    }))
    children.push(new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [ec0, ec1, ec2, ec3], rows: [exHeader, ...exRows] }))
    children.push(para(run(''), { after: 120 }))

    // --- netto / chiusura / data ---
    children.push(para(run(R(tpl.testoNetto), { bold: true })))
    children.push(para(run(R(tpl.chiusura), { italics: true }), { after: 240 }))
    children.push(para(run(R(tpl.luogoData)), { after: 360 }))

    // --- firma ---
    tpl.firma.forEach((l, i) =>
      children.push(para(run(R(l), { italics: i === tpl.firma.length - 1 }), { align: AlignmentType.CENTER, after: 0 })))
    children.push(para(run('_________________________'), { align: AlignmentType.CENTER }))

    return children
  }

  // Tabella riassuntiva del calcolo (replica foglio Excel): allegata in coda
  // per la verifica del dirigente — NON fa parte del certificato.
  const buildRiassunto = (): (Paragraph | Table)[] => {
    const gruppi = computeRiassunto(parsed.voci_teoriche, parsed.voci_dettaglio, parsed.riepilogo_cedolino)
    const ana = parsed.anagrafica
    const intest = [ana.matricola, [ana.cognome, ana.nome].filter(Boolean).join(' ')]
      .filter(Boolean).join(' - ')

    const children: (Paragraph | Table)[] = [
      para(run('TABELLA RIASSUNTIVA DEL CALCOLO', { bold: true, size: 26 }), { align: AlignmentType.CENTER, after: 60 }),
      para(run('(verifica interna — non costituisce parte del certificato)', { italics: true, size: 20 }), { align: AlignmentType.CENTER, after: 240 }),
      para(run(clean(`${intest} — cedolino ${ana.periodo_retribuzione ?? ''}`), { bold: true }), { after: 180 }),
    ]

    const rc0 = 5192, rc1 = 720, rc2 = 1860, rc3 = 1860
    const rows: TableRow[] = [new TableRow({
      children: [
        cell('VOCE', rc0, { bold: true }),
        cell('', rc1, { align: AlignmentType.CENTER, bold: true }),
        cell('CEDOLINO', rc2, { align: AlignmentType.RIGHT, bold: true }),
        cell('CERTIFICATO', rc3, { align: AlignmentType.RIGHT, bold: true }),
      ],
    })]
    for (const g of gruppi) {
      rows.push(new TableRow({
        children: [cell(g.titolo, rc0, { bold: true, italics: true }), cell('', rc1), cell('', rc2), cell('', rc3)],
      }))
      for (const r of g.righe) {
        const bold = r.segno === '='
        rows.push(new TableRow({
          children: [
            cell(clean(r.voce), rc0, { bold }),
            cell(`(${r.segno})`, rc1, { align: AlignmentType.CENTER, bold }),
            cell(r.cedolino == null ? '' : eur(r.cedolino), rc2, { align: AlignmentType.RIGHT, bold }),
            cell(r.certificato == null ? '' : eur(r.certificato), rc3, { align: AlignmentType.RIGHT, bold }),
          ],
        }))
      }
    }
    children.push(new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [rc0, rc1, rc2, rc3], rows }))
    return children
  }

  const pageBreak = (): Paragraph => new Paragraph({ children: [new PageBreak()] })

  const children: (Paragraph | Table)[] = [
    ...buildCopia(),          // originale (marca da bollo)
    pageBreak(),
    ...buildCopia(),          // copia per l'ufficio
    pageBreak(),
    ...buildRiassunto(),      // verifica calcoli per il dirigente
  ]

  const header = cartaIntestataHeader()
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          // A4 + margini del MODELLO carta intestata (top 5cm, bottom 3cm, lati 2cm)
          size: { width: 11900, height: 16840 },
          margin: { top: 2835, right: 1134, bottom: 1701, left: 1134, header: 708, footer: 708 },
        },
      },
      ...(header ? { headers: { default: header } } : {}),
      children,
    }],
  })

  return Packer.toBuffer(doc)
}
