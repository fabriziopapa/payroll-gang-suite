// ============================================================
// PAYROLL GANG SUITE — Versamenti enti · Consultazione
//
// Ricerca, raggruppamento per persona, selezione, somme ed esportazione
// dei versamenti della stampa CSA. Tutto nel browser, come il resto del
// modulo: le righe sono quelle di `elabora` e non lasciano la pagina.
// Al server va solo l'evento d'audit con i conteggi.
//
// Le righe si indicano con il loro INDICE nell'array di `elabora`: la
// selezione e' un Set di numeri e sopravvive ai cambi di filtro.
// Gli importi sono centesimi interi: le somme sono esatte.
// ============================================================

import type { RigaVersamento } from './versamentiCsv'
import { csvBytes, type AllegatiConfig, type ChiaveEstesa } from './versamentiAllegati'

/** Minuscolo e senza accenti: «Nicolò» si trova anche scrivendo «nicolo». */
export const normalizza = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Una persona: matricola + nominativo (come contaFontiNascita). */
export const chiavePersona = (r: RigaVersamento): string => `${r.matr}|${r.nome}`

/** Il testo su cui si cerca, una volta sola per file. */
export const chiaviRicerca = (righe: readonly RigaVersamento[]): string[] =>
  righe.map(r => normalizza(`${r.nome} ${r.matr} ${r.cf}`))

export interface Filtro {
  mesi:  ReadonlySet<string>
  /** Vuoto = tutti gli enti. */
  enti:  ReadonlySet<string>
  voce:  string
  testo: string
}

/** Gli indici delle righe che passano il filtro. Piu' parole: devono esserci tutte. */
export function filtra(righe: readonly RigaVersamento[], chiavi: readonly string[], f: Filtro): number[] {
  const parole = normalizza(f.testo.trim()).split(/\s+/).filter(Boolean)
  const out: number[] = []
  for (let i = 0; i < righe.length; i++) {
    const r = righe[i]!
    if (!f.mesi.has(r.mese)) continue
    if (f.enti.size && !f.enti.has(r.ente)) continue
    if (f.voce && r.voce !== f.voce) continue
    if (parole.length && !parole.every(p => chiavi[i]!.includes(p))) continue
    out.push(i)
  }
  return out
}

export interface EnteConsultazione { codice: string; descr: string; righe: number; persone: number; cents: number }

/** Gli enti del file nei mesi scelti, con righe, persone e totale. */
export function entiDelFile(righe: readonly RigaVersamento[], mesi: ReadonlySet<string>): EnteConsultazione[] {
  const m = new Map<string, { descr: string; righe: number; persone: Set<string>; cents: number }>()
  for (const r of righe) {
    if (!mesi.has(r.mese)) continue
    let e = m.get(r.ente)
    if (!e) { e = { descr: r.descr, righe: 0, persone: new Set(), cents: 0 }; m.set(r.ente, e) }
    e.righe++; e.persone.add(chiavePersona(r)); e.cents += r.cents
  }
  return [...m].map(([codice, e]) => ({ codice, descr: e.descr, righe: e.righe, persone: e.persone.size, cents: e.cents }))
}

export interface Persona {
  k:       string
  matr:    string
  nome:    string
  cf:      string
  nascita: RigaVersamento['nascita']
  enti:    string[]
  mesi:    string[]
  idx:     number[]
  cents:   number
}

export function raggruppaPersone(righe: readonly RigaVersamento[], idx: readonly number[]): Persona[] {
  const m = new Map<string, Persona & { e: Set<string>; ms: Set<string> }>()
  for (const i of idx) {
    const r = righe[i]!, k = chiavePersona(r)
    let p = m.get(k)
    if (!p) { p = { k, matr: r.matr, nome: r.nome, cf: r.cf, nascita: r.nascita, enti: [], mesi: [], idx: [], cents: 0, e: new Set(), ms: new Set() }; m.set(k, p) }
    p.idx.push(i); p.cents += r.cents; p.e.add(r.ente); p.ms.add(r.mese)
    if (!p.cf && r.cf) p.cf = r.cf
    if (!p.nascita.ok && r.nascita.ok) p.nascita = r.nascita
  }
  return [...m.values()].map(({ e, ms, ...p }) => ({ ...p, enti: [...e].sort(), mesi: [...ms].sort() }))
}

export interface Somme { righe: number; persone: number; enti: number; cents: number }

export function somme(righe: readonly RigaVersamento[], idx: Iterable<number>): Somme {
  const persone = new Set<string>(), enti = new Set<string>()
  let n = 0, cents = 0
  for (const i of idx) {
    const r = righe[i]
    if (!r) continue
    n++; cents += r.cents; persone.add(chiavePersona(r)); enti.add(r.ente)
  }
  return { righe: n, persone: persone.size, enti: enti.size, cents }
}

export interface Riepilogo {
  perEnte: Array<{ codice: string; descr: string; righe: number; persone: number; cents: number }>
  perMese: Array<{ mese: string; righe: number; cents: number }>
}

export function riepilogo(righe: readonly RigaVersamento[], idx: Iterable<number>): Riepilogo {
  const e = new Map<string, { descr: string; righe: number; persone: Set<string>; cents: number }>()
  const m = new Map<string, { righe: number; cents: number }>()
  for (const i of idx) {
    const r = righe[i]
    if (!r) continue
    const x = e.get(r.ente) ?? { descr: r.descr, righe: 0, persone: new Set<string>(), cents: 0 }
    x.righe++; x.persone.add(chiavePersona(r)); x.cents += r.cents; e.set(r.ente, x)
    const y = m.get(r.mese) ?? { righe: 0, cents: 0 }
    y.righe++; y.cents += r.cents; m.set(r.mese, y)
  }
  return {
    perEnte: [...e].map(([codice, x]) => ({ codice, descr: x.descr, righe: x.righe, persone: x.persone.size, cents: x.cents }))
      .sort((a, b) => (a.descr || a.codice).localeCompare(b.descr || b.codice)),
    perMese: [...m].map(([mese, y]) => ({ mese, ...y })).sort((a, b) => a.mese.localeCompare(b.mese)),
  }
}

// ── Ordinamento ─────────────────────────────────────────────
export type ColonnaPersona = 'nome' | 'matr' | 'nascita' | 'enti' | 'n' | 'cents'
export type ColonnaRiga = 'nome' | 'matr' | 'ente' | 'mese' | 'voce' | 'cents'
export interface Ordine<K extends string> { k: K; dir: 1 | -1 }

const confronta = (x: string | number, y: string | number) =>
  typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))

export function ordinaPersone(p: readonly Persona[], o: Ordine<ColonnaPersona>): Persona[] {
  const v: Record<ColonnaPersona, (x: Persona) => string | number> = {
    nome: x => x.nome, matr: x => x.matr, nascita: x => (x.nascita.ok ? x.nascita.iso : ''),
    enti: x => x.enti.length, n: x => x.idx.length, cents: x => x.cents,
  }
  return [...p].sort((a, b) => confronta(v[o.k](a), v[o.k](b)) * o.dir || a.nome.localeCompare(b.nome))
}

export function ordinaRighe(righe: readonly RigaVersamento[], idx: readonly number[], o: Ordine<ColonnaRiga>): number[] {
  const v: Record<ColonnaRiga, (r: RigaVersamento) => string | number> = {
    nome: r => r.nome, matr: r => r.matr, ente: r => r.descr || r.ente, mese: r => r.mese, voce: r => r.voce, cents: r => r.cents,
  }
  return [...idx].sort((a, b) => {
    const ra = righe[a]!, rb = righe[b]!
    return confronta(v[o.k](ra), v[o.k](rb)) * o.dir || ra.nome.localeCompare(rb.nome) || ra.mese.localeCompare(rb.mese)
  })
}

// ── Esportazione ────────────────────────────────────────────
export const COLONNE_EXPORT: readonly ChiaveEstesa[] = ['ENTE', 'DESCR_ENTE', 'NOME', 'DATA_NASCITA', 'MATRICOLA', 'COD_FISC', 'MESE', 'VOCE', 'IMPORTO']
const INTESTAZIONE_CSV: Record<ChiaveEstesa, string> = {
  ENTE: 'codice_ente', DESCR_ENTE: 'ente', NOME: 'nominativo', DATA_NASCITA: 'data_nascita', MATRICOLA: 'matricola',
  COD_FISC: 'codice_fiscale', MESE: 'mese', VOCE: 'voce', IMPORTO: 'importo',
}
const INTESTAZIONE_PDF: Record<ChiaveEstesa, string> = {
  ENTE: 'Cod.', DESCR_ENTE: 'Ente', NOME: 'Nominativo', DATA_NASCITA: 'Data di nascita', MATRICOLA: 'Matricola',
  COD_FISC: 'Codice fiscale', MESE: 'Mese', VOCE: 'Voce', IMPORTO: 'Importo',
}

export interface OpzioniExport {
  colonne:  ChiaveEstesa[]
  sep:      ';' | ',' | 'tab'
  codifica: 'w1252' | 'utf8bom'
}

export const opzioniExportDefault = (): OpzioniExport => ({
  colonne: ['ENTE', 'DESCR_ENTE', 'NOME', 'DATA_NASCITA', 'MATRICOLA', 'MESE', 'VOCE', 'IMPORTO'], sep: ';', codifica: 'w1252',
})

/**
 * La configurazione degli allegati per un file di esportazione: stesso
 * motore di CSV e PDF degli EML (F-10 compresa), righe ordinate per ente,
 * subtotale di ogni ente nel PDF. Le colonne seguono l'ordine fisso di
 * COLONNE_EXPORT, qualunque sia l'ordine in cui sono state spuntate.
 */
export function cfgExport(o: OpzioniExport, nomeAllegati = 'versamenti'): AllegatiConfig {
  const scelte = new Set(o.colonne)
  return {
    nomeEml: 'email', nomeAllegati, ordine: 'ente',
    csv: { attivo: true, sep: o.sep, decimali: 'virgola', codifica: o.codifica, intestazione: true },
    pdf: { attivo: true, titolo: 'Versamenti selezionati', orient: 'l', subtotali: false, totale: true },
    colonne: COLONNE_EXPORT.filter(k => scelte.has(k)).map(k => ({ k, csv: INTESTAZIONE_CSV[k], pdf: INTESTAZIONE_PDF[k], on: true })),
  }
}

export function csvSelezione(righe: readonly RigaVersamento[], o: OpzioniExport): Uint8Array<ArrayBuffer> {
  return csvBytes(righe, cfgExport(o), true)
}

/** Le righe selezionate, divise per ente (per «un file per ente» e per gli EML). */
export function perEnte(righe: readonly RigaVersamento[], idx: Iterable<number>): Map<string, RigaVersamento[]> {
  const m = new Map<string, RigaVersamento[]>()
  for (const i of idx) {
    const r = righe[i]
    if (!r) continue
    const a = m.get(r.ente)
    if (a) a.push(r); else m.set(r.ente, [r])
  }
  return m
}
