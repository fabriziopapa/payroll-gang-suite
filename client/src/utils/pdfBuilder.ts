// ============================================================
// PAYROLL GANG SUITE — PDF Builder utilities
// Estratto da ComunicazioneModal — logica pura, nessun hook React
// ============================================================

import type { DettaglioLiquidazione, Nominativo, CoefficienteScorporo } from '../types'
import { formatEur, calcolaImportoCSV } from './biz'

// ── Tipi esportati ────────────────────────────────────────────

export interface PdfContext {
  det:          DettaglioLiquidazione
  noms:         Nominativo[]
  campi:        string[]
  descVoce:     string
  descCapitolo: string
  coefficienti: CoefficienteScorporo
  /** Nome della bozza/liquidazione padre (top-level) */
  bozzaNome?:   string
}

// ── Utility nomi file ─────────────────────────────────────────

/** Rimuove accenti e caratteri illegali per nomi file FAT32/NTFS/ext4. */
function sanitizeSegment(s: string, maxLen = 80): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip accent diacritics (è→e, à→a …)
    .replace(/[^a-zA-Z0-9_\-]/g, '_') // solo alfanumerici + _ -
    .replace(/_+/g, '_')              // collassa underscore multipli
    .replace(/^_+|_+$/g, '')          // trim underscores perimetrali
    .slice(0, maxLen)
    || 'file'
}

/** Compone il nome file PDF: {bozzaNome}_{gruppoNome}.pdf */
export function buildPdfFilename(bozzaNome?: string, gruppoNome?: string): string {
  const a = sanitizeSegment(bozzaNome  ?? '', 80)
  const b = sanitizeSegment(gruppoNome ?? '', 80)
  const name = (a && b) ? `${a}_${b}` : (a || b || 'allegato')
  return `${name}.pdf`
}

// ── Utility di sicurezza ──────────────────────────────────────

/** XSS / HTML Template Injection prevention. Escapa i 5 caratteri HTML speciali. */
export function esc(value: string | undefined | null): string {
  if (!value) return ''
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

// ── Frammento HTML per il PDF ─────────────────────────────────

export function buildPdfFragment(ctx: PdfContext): string {
  const { det, noms, campi, descVoce, descCapitolo, coefficienti } = ctx

  const rows: string[] = []
  const addRow = (label: string, value: string) =>
    rows.push(`
      <tr>
        <td style="padding:6px 16px 6px 0;font-weight:600;color:#374151;
                   white-space:nowrap;font-size:13px;vertical-align:top">${label}</td>
        <td style="padding:6px 0;color:#111827;font-size:13px">${value}</td>
      </tr>`)

  if (campi.includes('nomeDescrittivo') && det.nomeDescrittivo)
    addRow('Descrizione', esc(det.nomeDescrittivo))

  if (campi.includes('voce') && det.voce && campi.includes('descVoce') && descVoce)
    addRow('Voce HR', `<span style="font-family:monospace">${esc(det.voce)}</span> — ${esc(descVoce)}`)
  else if (campi.includes('voce') && det.voce)
    addRow('Voce HR', `<span style="font-family:monospace">${esc(det.voce)}</span>`)
  else if (campi.includes('descVoce') && descVoce)
    addRow('Voce HR', esc(descVoce))

  if (campi.includes('capitolo') && det.capitolo && campi.includes('descCapitolo') && descCapitolo)
    addRow('Capitolo', `<span style="font-family:monospace">${esc(det.capitolo)}</span> — ${esc(descCapitolo)}`)
  else if (campi.includes('capitolo') && det.capitolo)
    addRow('Capitolo', `<span style="font-family:monospace">${esc(det.capitolo)}</span>`)
  else if (campi.includes('descCapitolo') && descCapitolo)
    addRow('Capitolo', esc(descCapitolo))

  if (campi.includes('competenzaLiquidazione') && det.competenzaLiquidazione)
    addRow('Competenza', esc(det.competenzaLiquidazione))
  if (campi.includes('dataCompetenzaVoce') && det.dataCompetenzaVoce)
    addRow('Data competenza voce', esc(det.dataCompetenzaVoce))
  if (campi.includes('provvedimento'))
    addRow('Provvedimento', `n.\u00a0${esc(det.numeroProvvedimento) || '—'} del ${esc(det.dataProvvedimento) || '—'}`)
  if (campi.includes('riferimentoCedolino') && det.riferimentoCedolino)
    addRow('Rif. cedolino', esc(det.riferimentoCedolino))

  const infoTable = rows.length > 0 ? `
    <table style="border-collapse:collapse;width:100%;margin-bottom:20px">
      <tbody>${rows.join('')}</tbody>
    </table>` : ''

  const showScorporo      = campi.includes('importiScorporo') && det.flagScorporo
  const showNominativo    = campi.includes('nomColNominativo')
  const showMatricola     = campi.includes('nomColMatricola')
  const showRuolo         = campi.includes('nomColRuolo')
  const showInquadramento = campi.includes('nomColInquadramento')
  const showRuoloCol      = showRuolo || showInquadramento
  const descCols = [showNominativo, showMatricola, showRuoloCol].filter(Boolean).length

  const padR = (hasNext: boolean) => hasNext ? '12px' : '0'

  let nomSection = ''
  if (campi.includes('nominativi') && noms.length > 0) {
    const nomRows = noms.map(n => {
      const importoCSV = calcolaImportoCSV(n, det, coefficienti)
      const scorporato = showScorporo && importoCSV !== n.importoLordo
      return `
      <tr style="border-bottom:1px solid #e5e7eb">
        ${showNominativo ? `
        <td style="padding:5px ${padR(showMatricola || showRuoloCol)};font-size:12px;color:#111827">
          ${esc(n.cognomeNome)}
        </td>` : ''}
        ${showMatricola ? `
        <td style="padding:5px ${padR(showRuoloCol)};font-size:11px;font-family:monospace;color:#6b7280">
          ${esc(n.matricola)}
        </td>` : ''}
        ${showRuoloCol ? `
        <td style="padding:5px 12px 5px 0;font-size:11px;color:#374151">
          ${showRuolo ? `<span style="font-family:monospace;font-weight:600">${esc(n.ruolo)}</span>` : ''}
          ${showInquadramento && n.druolo
            ? `${showRuolo ? '<br>' : ''}<span style="color:#6b7280;font-size:10px">${esc(n.druolo)}</span>`
            : ''}
        </td>` : ''}
        <td style="padding:5px ${showScorporo ? '12px' : '0'} 5px 0;font-size:12px;
                   text-align:right;font-family:monospace;color:#111827">
          ${formatEur(n.importoLordo)}
        </td>
        ${showScorporo ? `
        <td style="padding:5px 0;font-size:12px;text-align:right;font-family:monospace;
                   color:${scorporato ? '#4338ca' : '#9ca3af'}">
          ${scorporato ? formatEur(importoCSV) : '—'}
        </td>` : ''}
      </tr>`
    }).join('')

    const totLordo = noms.reduce((s, n) => s + n.importoLordo, 0)
    const totCSV   = showScorporo
      ? noms.reduce((s, n) => s + calcolaImportoCSV(n, det, coefficienti), 0)
      : 0

    const totRow = noms.length > 1 ? `
      <tr style="border-top:2px solid #d1d5db;background:#f9fafb">
        ${descCols > 0 ? `
        <td colspan="${descCols}" style="padding:5px 12px 5px 0;font-size:12px;font-weight:600;color:#374151">
          Totale (${noms.length})
        </td>` : ''}
        <td style="padding:5px ${showScorporo ? '12px' : '0'} 5px 0;font-size:12px;
                   text-align:right;font-family:monospace;font-weight:700;color:#111827">
          ${formatEur(Math.round(totLordo * 100) / 100)}
        </td>
        ${showScorporo ? `
        <td style="padding:5px 0;font-size:12px;text-align:right;font-family:monospace;
                   font-weight:700;color:#4338ca">
          ${formatEur(Math.round(totCSV * 100) / 100)}
        </td>` : ''}
      </tr>` : ''

    const thStyle = (align: 'left' | 'right', pr: string) =>
      `text-align:${align};padding:4px ${pr} 6px 0;font-size:11px;color:#6b7280;font-weight:600`

    nomSection = `
      <h3 style="margin:0 0 8px;font-size:13px;font-weight:600;color:#374151;
                 border-top:1px solid #e5e7eb;padding-top:16px">Nominativi</h3>
      <table style="border-collapse:collapse;width:100%">
        <thead>
          <tr style="border-bottom:2px solid #d1d5db">
            ${showNominativo ? `<th style="${thStyle('left', padR(showMatricola || showRuoloCol))}">Cognome Nome</th>` : ''}
            ${showMatricola  ? `<th style="${thStyle('left', padR(showRuoloCol))}">Matricola</th>` : ''}
            ${showRuoloCol   ? `<th style="${thStyle('left', '12px')}">Ruolo / Inquadramento</th>` : ''}
            <th style="${thStyle('right', showScorporo ? '12px' : '0')}">Importo lordo</th>
            ${showScorporo ? `
            <th style="text-align:right;padding:4px 0 6px;font-size:11px;color:#4338ca;font-weight:600">
              Lordo beneficiario
            </th>` : ''}
          </tr>
        </thead>
        <tbody>${nomRows}</tbody>
        ${totRow ? `<tfoot>${totRow}</tfoot>` : ''}
      </table>`
  }

  let totaleSection = ''
  if (campi.includes('totaleLordo') && noms.length > 0 && !campi.includes('nominativi')) {
    const tot = noms.reduce((s, n) => s + n.importoLordo, 0)
    totaleSection = `
      <p style="margin:12px 0 0;font-size:13px;color:#111827">
        <strong>Totale lordo:</strong>
        <span style="font-family:monospace">${formatEur(Math.round(tot * 100) / 100)}</span>
      </p>`
  }

  let noteSection = ''
  if (campi.includes('note') && det.note)
    noteSection = `
      <p style="margin:16px 0 0;font-size:12px;color:#4b5563;font-style:italic;
                border-left:3px solid #d1d5db;padding-left:10px">${esc(det.note)}</p>`

  const scorporoBadge = det.flagScorporo
    ? `<span style="display:inline-block;margin-left:8px;padding:2px 8px;
                    background:#ede9fe;color:#4338ca;border-radius:12px;
                    font-size:10px;font-weight:600;vertical-align:middle">Scorporo</span>`
    : ''

  const title = esc(det.nomeDescrittivo || 'Comunicazione')

  return `
<div style="font-family:Arial,Helvetica,sans-serif;color:#111827;
            background:#ffffff;padding:32px 40px;width:714px;box-sizing:border-box">

  <!-- intestazione -->
  <div style="border-bottom:3px solid #1e3a5f;padding-bottom:12px;margin-bottom:20px">
    <p style="margin:0 0 4px;font-size:10px;color:#6b7280;letter-spacing:.05em;text-transform:uppercase">
      Payroll Gang Suite — Liquidazione
    </p>
    <h1 style="margin:0;font-size:20px;font-weight:700;color:#1e3a5f">
      ${title}${scorporoBadge}
    </h1>
  </div>

  <!-- dati liquidazione -->
  ${infoTable}

  <!-- nominativi -->
  ${nomSection}

  <!-- totale separato (solo se nominativi non visibili) -->
  ${totaleSection}

  <!-- note -->
  ${noteSection}

  <!-- footer -->
  <p style="margin:28px 0 0;font-size:10px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:8px">
    Generato il ${new Date().toLocaleDateString('it-IT', { day:'2-digit', month:'long', year:'numeric' })}
    &nbsp;&middot;&nbsp; Payroll Gang Suite
  </p>
</div>`
}

// ── Rendering PDF ─────────────────────────────────────────────

export async function buildPdfDoc(ctx: PdfContext) {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ])

  const container = document.createElement('div')
  container.style.cssText = [
    'position:absolute',
    'top:-99999px',
    'left:0',
    'width:794px',
    'background:#ffffff',
    'overflow:visible',
  ].join(';')
  container.innerHTML = buildPdfFragment(ctx)
  document.body.appendChild(container)

  try {
    const canvas = await html2canvas(container, {
      scale:           2,
      useCORS:         true,
      logging:         false,
      backgroundColor: '#ffffff',
      width:           794,
      windowWidth:     794,
      scrollY:         -window.scrollY,
    })

    if (canvas.width === 0 || canvas.height === 0) {
      throw new Error('html2canvas ha prodotto un canvas vuoto')
    }

    const pdf       = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
    const pageW     = pdf.internal.pageSize.getWidth()
    const pageH     = pdf.internal.pageSize.getHeight()
    const margin    = 14
    const imgW      = pageW - margin * 2
    const pageImgH  = pageH - margin * 2
    const sliceH_px = pageImgH * (canvas.width / imgW)

    let srcY  = 0
    let first = true
    const sliceCanvases: HTMLCanvasElement[] = []

    try {
      while (srcY < canvas.height) {
        if (!first) pdf.addPage()
        first = false

        const actualSlice   = Math.min(sliceH_px, canvas.height - srcY)
        const sliceCanvas   = document.createElement('canvas')
        sliceCanvases.push(sliceCanvas)
        sliceCanvas.width   = canvas.width
        sliceCanvas.height  = actualSlice
        sliceCanvas.getContext('2d')!
          .drawImage(canvas, 0, srcY, canvas.width, actualSlice, 0, 0, canvas.width, actualSlice)

        pdf.addImage(
          sliceCanvas.toDataURL('image/jpeg', 0.95),
          'JPEG',
          margin,
          margin,
          imgW,
          (actualSlice / canvas.width) * imgW,
        )

        srcY += sliceH_px
      }
    } finally {
      sliceCanvases.forEach(c => { c.width = 0; c.height = 0 })
      canvas.width  = 0
      canvas.height = 0
    }

    return pdf

  } finally {
    document.body.removeChild(container)
  }
}

export async function downloadPdf(ctx: PdfContext): Promise<void> {
  const pdf  = await buildPdfDoc(ctx)
  pdf.save(buildPdfFilename(ctx.bozzaNome, ctx.det.nomeDescrittivo))
}

export async function buildPdfBase64(ctx: PdfContext): Promise<string> {
  const pdf     = await buildPdfDoc(ctx)
  const dataUri = pdf.output('datauristring')
  return dataUri.split(',')[1] ?? ''
}
