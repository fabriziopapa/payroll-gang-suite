// ============================================================
// PAYROLL GANG SUITE — Generatore DOCX certificato (server-side)
// Porting di genera_certificato.js con la lib `docx`. Consuma template-dato
// + output parser → Buffer DOCX fedele al prototipo dell'ufficio.
// ============================================================

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, WidthType, BorderStyle,
} from 'docx'
import type { CedolinoParsed } from '../cedolino/types.js'
import type { CertificatoTemplate, CertificatoMeta } from './types.js'
import { prepareData, resolve, eur } from './merge.js'

const FONT = 'Times New Roman'

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

  const children: (Paragraph | Table)[] = []

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

  // --- bollo (alto a destra) ---
  for (const l of tpl.bollo.testo.split('\n')) {
    children.push(para(run(R(l), { size: 18, bold: true }), { align: AlignmentType.RIGHT, after: 0 }))
  }
  children.push(para(run('', { size: 12 }), { after: 120 }))

  // --- protocollo / posizione ---
  children.push(para(run(R(tpl.intestazione.protocollo), { bold: true }), { align: AlignmentType.RIGHT, after: 0 }))
  children.push(para(run(R(tpl.intestazione.posizione), { italics: true }), { align: AlignmentType.RIGHT, after: 240 }))

  // --- titolo ---
  children.push(para(run(R(tpl.titolo), { bold: true, size: 26 }), { align: AlignmentType.CENTER, after: 240 }))

  // --- corpo ---
  for (const p of tpl.corpo) children.push(para(run(R(p))))

  // --- tabella emolumenti ---
  const W = 9360, c0 = 5400, c1 = 1080, c2 = 2880
  const resolveSrc = { teo: ctx.teo, cert: parsed.certificato } as unknown as Record<string, Record<string, unknown>>
  const emolRows = tpl.tabellaEmolumenti.map(r => {
    const val = r.src.split('.').reduce<unknown>(
      (o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), resolveSrc)
    return new TableRow({
      children: [
        cell(r.voce, c0, { bold: r.bold }),
        cell(r.segno, c1, { align: AlignmentType.CENTER, bold: r.bold }),
        cell(eur(val as number | null), c2, { align: AlignmentType.RIGHT, bold: r.bold }),
      ],
    })
  })
  children.push(new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [c0, c1, c2], rows: emolRows }))
  children.push(para(run(''), { after: 120 }))

  // --- extra-erariali ---
  children.push(para(run(R(tpl.testoExtraerariali))))
  const ec0 = 3960, ec1 = 1800, ec2 = 1800, ec3 = 1800
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
      cell(e.decorrenza, ec1, { align: AlignmentType.CENTER }),
      cell(e.scadenza, ec2, { align: AlignmentType.CENTER }),
      cell(e.importo, ec3, { align: AlignmentType.RIGHT }),
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

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children,
    }],
  })

  return Packer.toBuffer(doc)
}
