// ============================================================
// PAYROLL GANG SUITE — Versamenti enti · import della rubrica
//
// Legge un CSV codice;descrizione;email;abilitato (es. esportato dal Java
// GestioneSaldiEnti) e calcola l'anteprima con la STESSA regola del server
// (server/src/lib/versamenti.ts → pianoImport):
//   · ente che non c'e'          → si crea con email e abilitazione del file;
//   · ente presente senza email  → prende email e abilitazione del file;
//   · ente presente con email    → non si tocca;
//   · niente email e stessa abilitazione → invariato (reimportare non riscrive).
// ============================================================

import { decodificaCsv, normalizzaIntestazione, parseCsv, rilevaSeparatore } from './versamentiCsv'

export interface RigaRubrica {
  codice:      string
  descrizione: string
  email:       string
  abilitato:   boolean
}

// Stessa regola del server (server/src/lib/versamenti.ts): solo ASCII,
// niente omografi; un dominio con accenti va scritto nella forma xn--.
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/
const CODICE_RE = /^[A-Za-z0-9._-]{1,20}$/

const COLONNE = {
  codice:      ['CODICE', 'ENTE', 'CODICE_ENTE'],
  descrizione: ['DESCRIZIONE', 'ENTE_DESCR', 'DESCR'],
  email:       ['EMAIL', 'MAIL', 'E-MAIL', 'INDIRIZZI'],
  abilitato:   ['ABILITATO', 'ATTIVO'],
} as const

/** '1', 'true', 'si', 'sì', 'x', vuoto → abilitato; '0', 'false', 'no' → disabilitato. */
export function leggiAbilitato(v: string): boolean | null {
  const s = v.trim().toLowerCase()
  if (['', '1', 'true', 'si', 'sì', 's', 'x', 'yes'].includes(s)) return true
  if (['0', 'false', 'no', 'n'].includes(s)) return false
  return null
}

export function separaEmail(v: string): string[] {
  return [...new Set(v.split(/[,;]/).map(s => s.trim().toLowerCase()).filter(Boolean))]
}

export interface LetturaRubrica {
  righe:   RigaRubrica[]
  errori:  Array<{ riga: number; motivo: string }>
  mancanti: string[]
}

export function leggiRubricaCsv(buf: ArrayBuffer): LetturaRubrica {
  const { testo } = decodificaCsv(buf)
  const sep = rilevaSeparatore(testo)
  const rows = parseCsv(testo, sep)
  const h = (rows[0] ?? []).map(normalizzaIntestazione)
  const ix = (nomi: readonly string[]) => h.findIndex(x => nomi.includes(x))
  const iC = ix(COLONNE.codice), iD = ix(COLONNE.descrizione), iE = ix(COLONNE.email), iA = ix(COLONNE.abilitato)
  const mancanti = [iC < 0 ? 'codice' : '', iE < 0 ? 'email' : ''].filter(Boolean)
  if (mancanti.length) return { righe: [], errori: [], mancanti }
  const righe: RigaRubrica[] = [], errori: LetturaRubrica['errori'] = []
  rows.slice(1).forEach((r, n) => {
    const g = (i: number) => (i >= 0 ? (r[i] ?? '') : '').trim()
    const riga = n + 2
    const codice = g(iC)
    if (!CODICE_RE.test(codice)) { errori.push({ riga, motivo: `codice ente non valido: «${codice}»` }); return }
    const email = separaEmail(g(iE))
    const errata = email.find(x => x.length > 254 || !EMAIL_RE.test(x))
    if (errata) { errori.push({ riga, motivo: `${codice}: indirizzo non valido «${errata.replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}»` }); return }
    if (email.length > 20) { errori.push({ riga, motivo: `${codice}: più di 20 indirizzi` }); return }
    const abilitato = iA >= 0 ? leggiAbilitato(g(iA)) : true
    if (abilitato === null) { errori.push({ riga, motivo: `${codice}: abilitato non leggibile «${g(iA)}»` }); return }
    righe.push({ codice, descrizione: g(iD).slice(0, 200), email: email.join(', '), abilitato })
  })
  return { righe, errori, mancanti: [] }
}

export interface AnteprimaImport {
  nuovi:       RigaRubrica[]
  aggiorna:    RigaRubrica[]
  saltati:     string[]
  invariati:   string[]
  /** Fra nuovi e aggiornati: quanti portano almeno un indirizzo, quanti arrivano disabilitati. */
  conEmail:    number
  disabilitati: number
}

export function anteprimaImport(righe: readonly RigaRubrica[], enti: ReadonlyArray<{ codice: string; email: readonly string[]; abilitato: boolean }>): AnteprimaImport {
  const esistenti = new Map(enti.map(e => [e.codice, e]))
  const visti = new Set<string>()
  const a: AnteprimaImport = { nuovi: [], aggiorna: [], saltati: [], invariati: [], conEmail: 0, disabilitati: 0 }
  for (const r of righe) {
    if (visti.has(r.codice)) continue
    visti.add(r.codice)
    const e = esistenti.get(r.codice)
    if (!e) a.nuovi.push(r)
    else if (e.email.length) a.saltati.push(r.codice)
    else if (!r.email && r.abilitato === e.abilitato) a.invariati.push(r.codice)
    else a.aggiorna.push(r)
  }
  for (const r of [...a.nuovi, ...a.aggiorna]) { if (r.email) a.conEmail++; if (!r.abilitato) a.disabilitati++ }
  return a
}
