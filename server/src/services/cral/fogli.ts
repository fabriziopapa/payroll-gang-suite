// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · lettura dei file caricati
//
// Libro soci, risposte del modulo, ordini, iscrizioni: .xlsx, .xls o
// .csv. Si leggono SUL SERVER (decisione del 27/10, come l'import delle
// anagrafiche) e tornano al browser come testo, una matrice per foglio,
// senza scrivere nulla: l'abbinamento e la conferma sono passi separati.
// ============================================================

import * as XLSX from 'xlsx'
import { MAX_COLONNE, MAX_RIGHE_FOGLIO, pulisciFoglio } from '../../lib/cral.js'

export const MAX_BYTE_FILE = 5 * 1024 * 1024
export const MAX_FOGLI = 20

/** Un CSV da Excel italiano è spesso Windows-1252: se non è UTF-8 valido, si decodifica così. */
export function decodificaTesto(buf: Buffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '') }
  catch { return new TextDecoder('windows-1252').decode(buf) }
}

/** Il separatore di un CSV: quello più frequente nella prima riga fra ; , e tabulazione. */
function separatore(testo: string): string {
  const prima = testo.split(/\r?\n/, 1)[0] ?? ''
  const conta = (c: string) => prima.split(c).length - 1
  return [';', ',', '\t'].sort((a, b) => conta(b) - conta(a))[0] ?? ';'
}

/** Una cella come testo: le date in gg/mm/aaaa (giorno di calendario, senza fuso). */
export function testoCella(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // SheetJS crea la data a mezzanotte locale: si arrotonda al giorno piu' vicino
    const d = new Date(v.getTime() + 12 * 3600_000)
    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
  }
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6)
  return String(v ?? '')
}

export function leggiFogli(nome: string, buf: Buffer): Record<string, string[][]> {
  if (buf.byteLength > MAX_BYTE_FILE) throw new Error('FILE_TROPPO_GRANDE')
  const csv = /\.(csv|txt)$/i.test(nome)
  const zip = buf[0] === 0x50 && buf[1] === 0x4b
  const ole = buf[0] === 0xd0 && buf[1] === 0xcf
  if (!csv && !zip && !ole) throw new Error('FORMATO_NON_SUPPORTATO')
  const wb = csv
    ? (() => { const t = decodificaTesto(buf); return XLSX.read(t, { type: 'string', FS: separatore(t), raw: true, dense: true }) })()
    : XLSX.read(buf, { type: 'buffer', cellDates: true, dense: true })
  const out: Record<string, string[][]> = {}
  for (const n of wb.SheetNames.slice(0, MAX_FOGLI)) {
    const ws = wb.Sheets[n]
    if (!ws) continue
    // Valori grezzi, non il testo formattato da Excel: una data diventa
    // gg/mm/aaaa (il formato di cella americano darebbe «11/3/84»), un
    // numero resta un numero (10, 1.5) e non «10,00 €».
    const righe = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', blankrows: false, raw: true })
      .slice(0, MAX_RIGHE_FOGLIO).map(r => (r as unknown[]).slice(0, MAX_COLONNE).map(testoCella))
    out[n.slice(0, 80)] = pulisciFoglio(righe)
  }
  return out
}
