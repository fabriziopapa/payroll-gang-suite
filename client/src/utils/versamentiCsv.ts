// ============================================================
// PAYROLL GANG SUITE — Versamenti enti · lettura della stampa CSA
//
// Legge STAMPA_VERSAMENTI_*.CSV interamente nel browser: nessuna riga
// arriva al server. Riconosce le colonne dall'intestazione (come il Java
// GestioneSaldiEnti), anche con piu' mesi nello stesso file.
//
// Data di nascita: prima DATA_NASC del CSV; se manca o non si legge si
// ricava dal codice fiscale, quando il file ha COD_FISC.
// ============================================================

export const RICHIESTE = ['ENTE', 'ENTE_DESCR', 'VOCE', 'MATRICOLA', 'NOME', 'IMP_TOT'] as const
export const OPZIONALI = ['DATA_NASC', 'COD_FISC'] as const

/** Nomi plausibili della colonna del mese, in ordine di preferenza. */
const COLONNE_MESE = [
  'ANNO_MESE', 'MESE_ANNO', 'AAAAMM', 'PERIODO', 'COMPETENZA', 'MESE_COMP', 'MESE_COMPETENZA',
  'MESE_RIF', 'MESE_LIQ', 'DATA_COMPETENZA', 'DT_COMPETENZA', 'DATA_LIQ', 'DT_LIQ', 'MESE',
]
/** Valore speciale della colonna del mese: due colonne, ANNO e MESE. */
export const ANNO_PIU_MESE = 'ANNO+MESE'

const MESI3 = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']

// ── Lettura del file ──────────────────────────────────────────

/** UTF-8 se valido, altrimenti Windows-1252 (l'export CSA tipico). */
export function decodificaCsv(buf: ArrayBuffer): { testo: string; codifica: 'UTF-8' | 'Windows-1252' } {
  try {
    return { testo: new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''), codifica: 'UTF-8' }
  } catch {
    return { testo: new TextDecoder('windows-1252').decode(buf), codifica: 'Windows-1252' }
  }
}

export function rilevaSeparatore(testo: string): string {
  const prima = testo.split(/\r?\n/, 1)[0] ?? ''
  const conta = (ch: string) => prima.split(ch).length - 1
  return [';', ',', '\t'].sort((a, b) => conta(b) - conta(a))[0] ?? ';'
}

/** CSV con campi tra virgolette (il Java faceva solo split su ';'). Righe vuote scartate. */
export function parseCsv(testo: string, sep: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], f = '', q = false
  for (let i = 0; i < testo.length; i++) {
    const c = testo[i]!
    if (q) {
      if (c === '"') { if (testo[i + 1] === '"') { f += '"'; i++ } else q = false }
      else f += c
    } else if (c === '"') q = true
    else if (c === sep) { row.push(f); f = '' }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = '' }
    else if (c !== '\r') f += c
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row) }
  return rows.filter(r => r.some(x => x.trim() !== ''))
}

export const normalizzaIntestazione = (h: string) => h.trim().toUpperCase().replace(/\s+/g, '_')

// ── Mese ──────────────────────────────────────────────────────

export function colonnaMeseAuto(headers: string[]): string {
  if (headers.includes('ANNO') && headers.includes('MESE')) return ANNO_PIU_MESE
  return COLONNE_MESE.find(n => headers.includes(n)) ?? ''
}

const ym = (a: number, m: number | null): string | null =>
  (m !== null && a >= 1990 && a <= 2100 && m >= 1 && m <= 12) ? `${a}-${String(m).padStart(2, '0')}` : null
const meseDaNome = (s: string): number | null => {
  const i = MESI3.indexOf(s.trim().toLowerCase().slice(0, 3))
  return i >= 0 ? i + 1 : null
}

/** '202503', '2025-03', '03/2025', '15/03/2025', '2025-03-15', 'MAR 2025' → '2025-03'. */
export function parseMese(v: string): string | null {
  const s = v.trim()
  let r: RegExpMatchArray | null
  if ((r = s.match(/^(\d{4})[-/]?(\d{2})$/)))               return ym(+r[1]!, +r[2]!)
  if ((r = s.match(/^(\d{4})-(\d{2})-(\d{2})/)))            return ym(+r[1]!, +r[2]!)
  if ((r = s.match(/^(\d{1,2})[-/.](\d{4})$/)))             return ym(+r[2]!, +r[1]!)
  if ((r = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) return ym(+r[3]!, +r[2]!)
  if ((r = s.match(/^([A-Za-z]{3,})[\s\-/]*(\d{4})$/)))      return ym(+r[2]!, meseDaNome(r[1]!))
  return null
}

export function parseAnnoMese(anno: string, mese: string): string | null {
  const m = mese.trim()
  return ym(+anno.trim(), /^\d{1,2}$/.test(m) ? +m : meseDaNome(m))
}

/**
 * L'anno della stampa dal nome del file: l'ultimo anno a quattro cifre che
 * non fa parte di una data (STAMPA_VERSAMENTI_20260706_GEN_DIC_2025 → 2025);
 * in mancanza, l'anno della data di stampa. Serve quando la colonna MESE
 * contiene solo il numero del mese, come nella stampa CSA.
 */
export function annoDaNomeFile(nome: string): string {
  const anni = [...nome.matchAll(/(?<!\d)((?:19|20)\d{2})(?!\d)/g)].map(m => m[1]!)
  if (anni.length) return anni[anni.length - 1]!
  const d = nome.match(/(?<!\d)(20\d{2})\d{4}(?!\d)/)
  return d ? d[1]! : ''
}

const MESI_NOME = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC']

/**
 * Il periodo «da … a …» scritto nel nome del file (STAMPA_VERSAMENTI_…_GEN_DIC_2025
 * → 2025-01 … 2025-12; …_NOV_2025 → solo novembre). Serve quando la stampa e'
 * fatta SENZA «Suddivisione per mese»: allora non c'e' la colonna MESE e gli
 * importi sono la somma del periodo.
 */
export function periodoDaNomeFile(nome: string): { da: string; a: string } | null {
  const anno = annoDaNomeFile(nome)
  const mesi = [...nome.toUpperCase().matchAll(/(?<![A-Z])(GEN|FEB|MAR|APR|MAG|GIU|LUG|AGO|SET|OTT|NOV|DIC)(?![A-Z])/g)]
    .map(m => MESI_NOME.indexOf(m[1]!) + 1)
  if (!/^\d{4}$/.test(anno) || !mesi.length) return null
  const da = ym(+anno, mesi[0]!), a = ym(+anno, mesi[1] ?? mesi[0]!)
  return da && a ? { da, a: a < da ? da : a } : null
}

/** Tutti i mesi da `da` ad `a` compresi ('AAAA-MM'). Fuori ordine o non validi → solo `da`. */
export function espandiMesi(da: string, a: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(da)) return []
  if (!/^\d{4}-\d{2}$/.test(a) || a < da) return [da]
  const out: string[] = []
  let y = +da.slice(0, 4), m = +da.slice(5, 7)
  for (let i = 0; i < 240; i++) {
    const k = `${y}-${String(m).padStart(2, '0')}`
    out.push(k)
    if (k === a) break
    if (++m > 12) { m = 1; y++ }
  }
  return out
}

/** Dal nome STAMPA_VERSAMENTI_20260706_... il mese precedente alla data di stampa. */
export function meseDaNomeFile(nome: string): string {
  const r = nome.match(/(20\d{2})(\d{2})(\d{2})/)
  if (!r) return ''
  let a = +r[1]!, m = +r[2]! - 1
  if (m === 0) { m = 12; a -= 1 }
  return ym(a, m) ?? ''
}

// ── Importo ───────────────────────────────────────────────────

/** '1.234,56' | '1234,56' | '1234.56' | '-12,5' → centesimi interi. Non numerico → null. */
export function parseImporto(v: string): number | null {
  let s = v.trim().replace(/[\s€]/g, '')
  if (!s) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  return Math.round(parseFloat(s) * 100)
}

// ── Data di nascita ───────────────────────────────────────────

const OMO: Record<string, string> = { L: '0', M: '1', N: '2', P: '3', Q: '4', R: '5', S: '6', T: '7', U: '8', V: '9' }
const MESE_CF = 'ABCDEHLMPRST'
const CF_RE = /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/
const DISPARI: Record<string, number> = {
  0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
  N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
}

/** Carattere di controllo del codice fiscale (16° carattere) dai primi 15. */
export function cfCarattereControllo(c15: string): string {
  let s = 0
  for (let i = 0; i < 15; i++) {
    const ch = c15[i]!
    s += i % 2 === 0 ? (DISPARI[ch] ?? 0) : (/\d/.test(ch) ? +ch : ch.charCodeAt(0) - 65)
  }
  return String.fromCharCode(65 + (s % 26))
}

const isoData = (a: number, m: number, g: number): string | null => {
  const d = new Date(Date.UTC(a, m - 1, g))
  if (a < 1900 || d.getUTCFullYear() !== a || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== g) return null
  return `${a}-${String(m).padStart(2, '0')}-${String(g).padStart(2, '0')}`
}

/** '12/03/1968', '12-03-1968', '12.03.1968', '1968-03-12', '19680312' → '1968-03-12'. */
export function parseData(v: string): string | null {
  const s = v.trim()
  let r: RegExpMatchArray | null
  if ((r = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/))) return isoData(+r[3]!, +r[2]!, +r[1]!)
  if ((r = s.match(/^(\d{4})-(\d{2})-(\d{2})/)))               return isoData(+r[1]!, +r[2]!, +r[3]!)
  if ((r = s.match(/^(\d{4})(\d{2})(\d{2})$/)))                 return isoData(+r[1]!, +r[2]!, +r[3]!)
  return null
}

/**
 * Data di nascita dal codice fiscale, omocodia compresa. Il secolo: un
 * dipendente ha almeno 14 anni, quindi un anno che lo farebbe piu' giovane
 * e' del Novecento.
 */
export function nascitaDaCf(cfGrezzo: string, oggi = new Date()): string | null {
  const cf = cfGrezzo.trim().toUpperCase()
  if (!CF_RE.test(cf) || cfCarattereControllo(cf.slice(0, 15)) !== cf[15]) return null
  const d = (i: number) => OMO[cf[i]!] ?? cf[i]!
  const yy = +(d(6) + d(7))
  const mm = MESE_CF.indexOf(cf[8]!) + 1
  let gg = +(d(9) + d(10))
  if (gg > 40) gg -= 40
  let anno = 2000 + yy
  if (anno > oggi.getFullYear() - 14) anno = 1900 + yy
  return isoData(anno, mm, gg)
}

export type FonteNascita = 'csv' | 'cf'
export type Nascita =
  | { ok: true; iso: string; fonte: FonteNascita }
  | { ok: false; motivo: string }

export function nascitaDa(dataCsv: string, cf: string): Nascita {
  const d = parseData(dataCsv)
  if (d) return { ok: true, iso: d, fonte: 'csv' }
  const c = cf ? nascitaDaCf(cf) : null
  if (c) return { ok: true, iso: c, fonte: 'cf' }
  return { ok: false, motivo: dataCsv ? 'DATA_NASC non leggibile' : cf ? 'codice fiscale non valido' : 'non disponibile' }
}

// ── Elaborazione ──────────────────────────────────────────────

export interface RigaVersamento {
  ente:     string
  descr:    string
  voce:     string
  matr:     string
  nome:     string
  cf:       string
  cents:    number
  /** 'AAAA-MM' */
  mese:     string
  nascita:  Nascita
}

export interface RigaScartata {
  riga:    number
  motivo:  string
  testo:   string
}

export interface FileVersamenti {
  nome:      string
  codifica:  string
  sep:       string
  headers:   string[]
  records:   string[][]
}

export interface EsitoElaborazione {
  mancanti:  string[]
  righe:     RigaVersamento[]
  scartate:  RigaScartata[]
  /** Mesi presenti nel file, ordinati. */
  mesi:      string[]
  /** La colonna del mese contiene solo il numero del mese: l'anno viene da `anno`. */
  serveAnno: boolean
  /**
   * File SENZA colonna del mese: il periodo che gli importi coprono (da … a …).
   * Le righe hanno tutte `mese` = primo mese del periodo. null con la colonna.
   */
  periodo:   string[] | null
}

export function leggiFile(nome: string, testo: string, codifica: string): FileVersamenti {
  const sep = rilevaSeparatore(testo)
  const rows = parseCsv(testo, sep)
  return { nome, codifica, sep, headers: (rows[0] ?? []).map(normalizzaIntestazione), records: rows.slice(1) }
}

/**
 * Dalle righe grezze alle righe valide. `colMese`: ANNO_PIU_MESE, il nome di
 * una colonna, oppure '' (file di un solo mese: vale `meseManuale`). Se la
 * colonna contiene solo il numero del mese ('01'…'12') l'anno e' `anno`.
 */
export function elabora(f: FileVersamenti, colMese: string, meseManuale: string, anno = '', meseManualeA = ''): EsitoElaborazione {
  const ix = (n: string) => f.headers.indexOf(n)
  const mancanti = RICHIESTE.filter(n => ix(n) < 0)
  if (mancanti.length) return { mancanti, righe: [], scartate: [], mesi: [], serveAnno: false, periodo: null }
  let serveAnno = false
  const iA = ix('ANNO'), iM = ix('MESE')
  const iC = colMese && colMese !== ANNO_PIU_MESE ? ix(colMese) : -1
  const righe: RigaVersamento[] = [], scartate: RigaScartata[] = []
  const mesi = new Set<string>()
  f.records.forEach((r, n) => {
    const g = (i: number) => (i >= 0 ? (r[i] ?? '') : '').trim()
    const ente = g(ix('ENTE'))
    const cents = parseImporto(g(ix('IMP_TOT')))
    const vMese = iC >= 0 ? g(iC) : ''
    const soloMese = iC >= 0 && /^\d{1,2}$/.test(vMese)
    if (soloMese) serveAnno = true
    const mese = colMese === ANNO_PIU_MESE ? parseAnnoMese(g(iA), g(iM))
      : soloMese ? parseAnnoMese(anno, vMese)
      : iC >= 0 ? parseMese(vMese)
      : (meseManuale || null)
    const motivo = !ente ? 'ENTE vuoto'
      : cents === null ? `IMP_TOT non numerico: «${g(ix('IMP_TOT'))}»`
      : !mese ? (soloMese && !/^\d{4}$/.test(anno) ? 'mese senza anno: indica l\'anno' : colMese ? 'mese non riconosciuto' : 'mese non indicato')
      : null
    if (motivo || cents === null || !mese) { scartate.push({ riga: n + 2, motivo: motivo ?? '', testo: r.join(f.sep) }); return }
    const cf = g(ix('COD_FISC')).toUpperCase()
    righe.push({
      ente, descr: g(ix('ENTE_DESCR')), voce: g(ix('VOCE')), matr: g(ix('MATRICOLA')), nome: g(ix('NOME')),
      cf, cents, mese, nascita: nascitaDa(g(ix('DATA_NASC')), cf),
    })
    mesi.add(mese)
  })
  const periodo = !colMese && meseManuale ? espandiMesi(meseManuale, meseManualeA || meseManuale) : null
  return { mancanti: [], righe, scartate, mesi: [...mesi].sort(), serveAnno, periodo: periodo?.length ? periodo : null }
}

export interface EnteAggregato {
  codice:  string
  descr:   string
  righe:   RigaVersamento[]
  cents:   number
  /** Mesi in cui l'ente compare (la suddivisione per mese degli allegati). */
  mesi:    string[]
  /** Il periodo da scrivere nella mail: i mesi, o il «da … a …» di un file senza colonna del mese. */
  periodo: string[]
}

/** Raggruppa per ente le righe dei mesi selezionati. */
export function aggregaEnti(righe: RigaVersamento[], mesiSel: ReadonlySet<string>, periodo: string[] | null = null): EnteAggregato[] {
  const m = new Map<string, Omit<EnteAggregato, 'mesi' | 'periodo'> & { mesiSet: Set<string> }>()
  for (const r of righe) {
    if (!mesiSel.has(r.mese)) continue
    let e = m.get(r.ente)
    if (!e) { e = { codice: r.ente, descr: r.descr, righe: [], cents: 0, mesiSet: new Set() }; m.set(r.ente, e) }
    e.righe.push(r); e.cents += r.cents; e.mesiSet.add(r.mese)
  }
  return [...m.values()].map(({ mesiSet, ...e }) => {
    const mesi = [...mesiSet].sort()
    return { ...e, mesi, periodo: periodo ?? mesi }
  })
}

/** Persone distinte (matricola + nome) per fonte della data di nascita. */
export function contaFontiNascita(righe: RigaVersamento[]): { csv: number; cf: number; no: number; persone: number } {
  const viste = new Map<string, Nascita>()
  for (const r of righe) { const k = r.matr + '|' + r.nome; if (!viste.has(k)) viste.set(k, r.nascita) }
  const n = { csv: 0, cf: 0, no: 0, persone: viste.size }
  for (const x of viste.values()) { if (x.ok) n[x.fonte]++; else n.no++ }
  return n
}
