// ============================================================
// PAYROLL GANG SUITE — Versamenti enti · costruzione dell'EML
//
// Lo stesso messaggio del Java GestioneSaldiEnti, migliorato:
//   · X-Unsent: 1 → Outlook lo apre come bozza da inviare;
//   · piu' destinatari nel campo A:;
//   · testo e HTML in multipart/alternative (nel Java l'HTML era vuoto e
//     finiva tra gli allegati), UTF-8, oggetto codificato RFC 2047;
//   · allegati CSV e PDF secondo il modello.
// Il mittente e' facoltativo: senza, Outlook usa l'account di chi apre.
// ============================================================

import type { Allegato } from './versamentiAllegati'

/** SMTP header injection: niente a capo nei valori delle intestazioni. */
const pulisci = (v: string) => v.replace(/[\r\n\t]/g, ' ').trim()

export function base64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
const base64Utf8 = (s: string) => base64(new TextEncoder().encode(s))
const a76 = (s: string) => s.match(/.{1,76}/g)?.join('\r\n') ?? ''

/** Oggetto con accenti → encoded-word UTF-8, spezzate sotto i 75 caratteri. */
export function codificaOggetto(s: string): string {
  const v = pulisci(s)
  if (/^[\x20-\x7e]*$/.test(v)) return v
  const parti: string[] = []; let buf = ''
  const enc = new TextEncoder()
  for (const ch of v) {
    if (enc.encode(buf + ch).length > 42) { parti.push(buf); buf = '' }
    buf += ch
  }
  if (buf) parti.push(buf)
  return parti.map(p => `=?UTF-8?B?${base64Utf8(p)}?=`).join('\r\n ')
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export function corpoHtml(testo: string): string {
  return `<html><head><meta charset="UTF-8"></head><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#000">${escHtml(testo).replace(/\n/g, '<br>\n')}</body></html>`
}

export interface MessaggioVersamento {
  da?:       string
  a:         string[]
  oggetto:   string
  testo:     string
  allegati:  Allegato[]
  data?:     Date
}

export function costruisciEml(m: MessaggioVersamento): string {
  const seme = Math.random().toString(36).slice(2, 10)
  const mix = `=_PGS_mix_${seme}`, alt = `=_PGS_alt_${seme}`
  const nomeSicuro = (n: string) => pulisci(n).replace(/"/g, '')
  const L: string[] = ['MIME-Version: 1.0', 'X-Unsent: 1']
  if (m.da?.trim()) L.push(`From: ${pulisci(m.da)}`)
  L.push(
    `To: ${m.a.map(pulisci).join(', ')}`,
    `Subject: ${codificaOggetto(m.oggetto)}`,
    `Date: ${(m.data ?? new Date()).toUTCString().replace('GMT', '+0000')}`,
    `Content-Type: multipart/mixed; boundary="${mix}"`, '',
    `--${mix}`, `Content-Type: multipart/alternative; boundary="${alt}"`, '',
    `--${alt}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    a76(base64Utf8(m.testo.replace(/\r?\n/g, '\r\n'))), '',
    `--${alt}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    a76(base64Utf8(corpoHtml(m.testo))), '',
    `--${alt}--`, '',
  )
  for (const x of m.allegati) {
    const n = nomeSicuro(x.nome)
    L.push(
      `--${mix}`,
      `Content-Type: ${x.tipo}${x.charset ? `; charset=${x.charset}` : ''}; name="${n}"`,
      `Content-Disposition: attachment; filename="${n}"`,
      'Content-Transfer-Encoding: base64', '',
      a76(base64(x.bytes)), '',
    )
  }
  L.push(`--${mix}--`, '')
  return L.join('\r\n')
}

/** Download dal browser (PGS gira in una pagina normale: il link funziona). */
export function scaricaFile(nome: string, contenuto: BlobPart, tipo: string): void {
  const url = URL.createObjectURL(new Blob([contenuto], { type: tipo }))
  const a = Object.assign(document.createElement('a'), { href: url, download: nome })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}
