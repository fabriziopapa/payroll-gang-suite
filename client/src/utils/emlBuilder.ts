// ============================================================
// PAYROLL GANG SUITE — EML Builder utilities
// Estratto da ComunicazioneModal — logica pura, nessun hook React
// ============================================================

import type { Comunicazione, DettaglioLiquidazione, Nominativo, CoefficienteScorporo } from '../types'
import { buildPdfBase64, buildPdfFilename } from './pdfBuilder'

/** SMTP Header Injection prevention: rimuove \r \n \t dai valori header MIME. */
export function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n\t]/g, ' ').trim()
}

export function buildEml(com: Comunicazione, pdfB64: string, pdfFilename = 'allegato.pdf'): string {
  const boundary   = `=_PGS_${Date.now()}`
  const date       = new Date().toUTCString()
  const toHdr      = com.destinatari
    .map(d => `${sanitizeHeader(d.nome)} <${sanitizeHeader(d.email)}>`)
    .join(', ')
  const b64w       = pdfB64.match(/.{1,76}/g)?.join('\r\n') ?? pdfB64
  const safeFilename = sanitizeHeader(pdfFilename)

  return [
    `MIME-Version: 1.0`,
    `X-Unsent: 1`,
    `From: Payroll Gang Suite <noreply@payrollgang.local>`,
    `To: ${toHdr}`,
    `Subject: ${sanitizeHeader(com.oggetto)}`,
    `Date: ${date}`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    com.corpo,
    ``,
    `--${boundary}`,
    `Content-Type: application/pdf; name="${safeFilename}"`,
    `Content-Disposition: attachment; filename="${safeFilename}"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    b64w,
    ``,
    `--${boundary}--`,
  ].join('\r\n')
}

export async function downloadEml(
  com: Comunicazione,
  ctx: { det: DettaglioLiquidazione; noms: Nominativo[]; descVoce: string; descCapitolo: string; coefficienti: CoefficienteScorporo; bozzaNome?: string },
): Promise<void> {
  const pdfFilename = buildPdfFilename(ctx.bozzaNome, ctx.det.nomeDescrittivo)
  const pdfB64      = await buildPdfBase64({ ...ctx, campi: com.campiAllegato })
  const eml         = buildEml(com, pdfB64, pdfFilename)
  const blob        = new Blob([eml], { type: 'message/rfc822' })
  const url         = URL.createObjectURL(blob)
  // Nome EML = stesso base del PDF (senza estensione)
  const emlName     = pdfFilename.replace(/\.pdf$/, '')
  const a           = Object.assign(document.createElement('a'), { href: url, download: `${emlName}.eml` })
  a.click()
  URL.revokeObjectURL(url)
}
