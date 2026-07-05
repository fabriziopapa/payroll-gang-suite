// ============================================================
// PAYROLL GANG SUITE — Download DOCX da base64
// Stesso pattern di downloadCsv/downloadEml: Blob + anchor click.
// ============================================================

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Converte base64 → Uint8Array (senza dipendenze). */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const len = bin.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Trigger download di un DOCX ricevuto come base64. */
export function downloadDocx(base64: string, filename: string): void {
  const blob = new Blob([base64ToBytes(base64).buffer as ArrayBuffer], { type: DOCX_MIME })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}
