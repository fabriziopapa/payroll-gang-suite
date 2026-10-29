// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · regole pure
//
// Validazione dei dati che il client manda (config degli eventi, dati
// delle scelte, sconti), formato della tessera, abbinamento dei nominativi
// del libro soci all'anagrafica PGS. Nessuna dipendenza da db o rete:
// testabile da sola (lib/cral.test.ts).
// ============================================================

import { z } from 'zod'
import { grafie, normalizza, risolviNominativo, type AnagraficaPerRicerca } from '../services/emolumenti/nominativi.js'

// ── Valori ammessi ───────────────────────────────────────────
export const TIPI_PERSONA   = ['SD', 'SE', 'EST', 'FAM'] as const
export const STATI_PERSONA  = ['ATTIVO', 'DA_VALIDARE', 'RIFIUTATO', 'CESSATO'] as const
export const MODALITA       = ['SCELTA', 'NESSUNA', 'ORDINE', 'TURNI', 'MAGAZZINO'] as const
export const CAT_SCONTO     = ['SD', 'SE', 'DIP', 'EST', 'FAM'] as const
export type TipoPersona = typeof TIPI_PERSONA[number]
export type Modalita = typeof MODALITA[number]

const DATA     = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'data')
const ID_LOC   = z.string().regex(/^[A-Za-z0-9_-]{1,30}$/)
/** Testo su una riga, senza caratteri di controllo (finisce in audit, PDF, CSV). */
export const riga = (max: number, min = 0) => z.string().trim().max(max).min(min)
  .refine(s => !/[\u0000-\u001f\u007f]/.test(s), 'caratteri non ammessi')
const testo = (max: number) => z.string().max(max).refine(s => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s), 'caratteri non ammessi')
const CENT = z.number().int().min(0).max(100_000_000)

// ── Sconti ───────────────────────────────────────────────────
/** Regola per tipologia: percentuale intera 1–100, oppure euro in centesimi. */
export const scontoRegola = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('%'), val: z.number().int().min(1).max(100) }),
  z.object({ tipo: z.literal('€'), val: CENT.min(1) }),
])
/** Sconto personale: anche «nessuno sconto», con un motivo facoltativo. */
export const scontoPersonale = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('NO'), nota: riga(200).optional() }),
  z.object({ tipo: z.literal('%'), val: z.number().int().min(1).max(100), nota: riga(200).optional() }),
  z.object({ tipo: z.literal('€'), val: CENT.min(1), nota: riga(200).optional() }),
])
export type ScontoRegola = z.infer<typeof scontoRegola>
export type ScontoPersonale = z.infer<typeof scontoPersonale>

/** Applica uno sconto a un importo lordo in centesimi; € moltiplicato per n (settimane, biglietti). */
export function applicaSconto(lordo: number, sc: ScontoRegola | ScontoPersonale | null | undefined, n = 1): number {
  if (!sc || sc.tipo === 'NO') return lordo
  return sc.tipo === '%' ? Math.round(lordo * (100 - sc.val) / 100) : Math.max(0, lordo - sc.val * n)
}

// ── Config dell'evento ───────────────────────────────────────
export const configSchema = z.object({
  opzioni: z.array(z.object({ id: ID_LOC, etichetta: riga(120, 1) })).max(30).default([]),
  prodotti: z.array(z.object({
    id:          ID_LOC,
    tipologia:   z.string().max(10),
    nome:        riga(120, 1),
    prezzo:      CENT,
    unita:       z.enum(['pz', 'cas', 'kg']),
    contenuto:   z.number().positive().max(100_000).nullable().default(null),
    contenutoUm: z.enum(['lt', 'kg']).default('lt'),
    max:         z.number().int().positive().max(100_000).nullable().default(null),
  })).max(100).default([]),
  periodi: z.array(z.object({
    id:    ID_LOC,
    nome:  riga(60, 1),
    dal:   DATA,
    al:    DATA,
    posti: z.number().int().positive().max(100_000).nullable().default(null),
  }).refine(p => p.al >= p.dal, 'periodo')).max(60).default([]),
  articoli: z.array(z.object({ id: ID_LOC, nome: riga(80, 1), prezzo: CENT })).max(30).default([]),
  sconti: z.object({
    SD: scontoRegola.optional(), SE: scontoRegola.optional(), DIP: scontoRegola.optional(),
    EST: scontoRegola.optional(), FAM: scontoRegola.optional(),
  }).default({}),
}).strict()
export type ConfigEvento = z.infer<typeof configSchema>

export const iniziativaSchema = z.object({
  tipo:        z.string().regex(/^[A-Z0-9]{1,10}$/),
  titolo:      riga(160, 1),
  anno:        z.number().int().min(2000).max(2100),
  data:        DATA,
  scadenza:    DATA.nullable(),
  stato:       z.enum(['BOZZA', 'APERTA', 'CHIUSA']),
  modalita:    z.enum(MODALITA),
  modoPart:    z.enum(['GRUPPI', 'SINGOLI']),
  gruppi:      z.array(z.enum(TIPI_PERSONA)).max(4),
  sedi:        z.array(z.string().regex(/^[A-Z0-9]{1,12}$/)).max(50),
  predefinita: ID_LOC.nullable(),
  fornitore:   riga(160),
  pagamento:   riga(300),
  note:        testo(1000),
  quota:       CENT,
  config:      configSchema,
}).strict()
export type IniziativaInput = z.infer<typeof iniziativaSchema>

/** Coerenza fra modalita' e config: le stesse regole della maschera. null = va bene. */
export function erroreIniziativa(i: IniziativaInput): string | null {
  const c = i.config
  const unici = (xs: Array<{ id: string }>) => new Set(xs.map(x => x.id)).size === xs.length
  if (![c.opzioni, c.prodotti, c.periodi, c.articoli].every(unici)) return 'ID_RIPETUTI'
  if (i.modoPart === 'GRUPPI' && !i.gruppi.length) return 'NESSUN_GRUPPO'
  switch (i.modalita) {
    case 'SCELTA':
      if (c.opzioni.length < 2) return 'OPZIONI_INSUFFICIENTI'
      if (i.predefinita && !c.opzioni.some(o => o.id === i.predefinita)) return 'PREDEFINITA_SCONOSCIUTA'
      break
    case 'ORDINE':    if (!c.prodotti.length) return 'NESSUN_PRODOTTO'; break
    case 'TURNI':     if (!c.periodi.length) return 'NESSUN_PERIODO'; if (i.quota <= 0) return 'QUOTA_MANCANTE'; break
    case 'MAGAZZINO': if (!c.articoli.length) return 'NESSUN_ARTICOLO'; break
  }
  if (i.modalita !== 'SCELTA' && i.predefinita) return 'PREDEFINITA_SCONOSCIUTA'
  return null
}

// ── Dati di una scelta (una persona in un evento) ────────────
export const sceltaSchema = z.object({
  opz:        ID_LOC.nullable().optional(),
  q:          z.record(ID_LOC, z.number().min(0).max(100_000)).nullable().optional(),
  per:        z.record(ID_LOC, z.enum(['', 'P', 'F', 'T'])).nullable().optional(),
  versato:    CENT.nullable().optional(),
  pagato:     z.boolean().nullable().optional(),
  consegnato: z.boolean().nullable().optional(),
  note:       riga(500).nullable().optional(),
  /** Persona di riferimento nei campi: '' = nessuna, assente/null = automatica. */
  rif:        z.string().max(12).nullable().optional(),
  /** Categoria per lo sconto bloccata all'iscrizione. */
  iscr:       z.object({ data: DATA, cat: z.enum(['SD', 'SE', 'DIP', 'EST']) }).nullable().optional(),
  scontoPers: scontoPersonale.nullable().optional(),
}).strict()
export type DatiScelta = z.infer<typeof sceltaSchema>

/** Unisce una modifica ai dati salvati: le chiavi a null si tolgono. */
export function unisciDati(prima: DatiScelta, patch: DatiScelta): DatiScelta {
  const out: Record<string, unknown> = { ...prima }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete out[k]
    else out[k] = v
  }
  // quantita' a zero e settimane vuote non servono: si tolgono
  if (out['q']) out['q'] = Object.fromEntries(Object.entries(out['q'] as Record<string, number>).filter(([, n]) => n > 0))
  if (out['per']) out['per'] = Object.fromEntries(Object.entries(out['per'] as Record<string, string>).filter(([, s]) => s))
  return out as DatiScelta
}

/** I dati usano solo opzioni, prodotti e settimane che esistono nell'evento. */
export function erroreDati(d: DatiScelta, c: ConfigEvento): string | null {
  if (d.opz && !c.opzioni.some(o => o.id === d.opz)) return 'OPZIONE_SCONOSCIUTA'
  for (const [pid, n] of Object.entries(d.q ?? {})) {
    const p = c.prodotti.find(x => x.id === pid)
    if (!p) return 'PRODOTTO_SCONOSCIUTO'
    if (p.unita !== 'kg' && !Number.isInteger(n)) return 'QUANTITA_NON_INTERA'
    if (p.max && n > p.max) return 'OLTRE_IL_MASSIMO'
  }
  for (const pid of Object.keys(d.per ?? {})) if (!c.periodi.some(x => x.id === pid)) return 'PERIODO_SCONOSCIUTO'
  return null
}

/** Ciò che una modifica della config toglierebbe pur essendo già usato. */
export function usiTolti(nuova: ConfigEvento, usati: { opz: Set<string>; prodotti: Set<string>; periodi: Set<string>; articoli: Set<string> }): string | null {
  const manca = (ids: Set<string>, xs: Array<{ id: string }>) => [...ids].some(id => !xs.some(x => x.id === id))
  if (manca(usati.opz, nuova.opzioni)) return 'OPZIONE_IN_USO'
  if (manca(usati.prodotti, nuova.prodotti)) return 'PRODOTTO_IN_USO'
  if (manca(usati.periodi, nuova.periodi)) return 'PERIODO_IN_USO'
  if (manca(usati.articoli, nuova.articoli)) return 'ARTICOLO_IN_USO'
  return null
}

// ── Tessera ──────────────────────────────────────────────────
export interface ParametriTessera {
  formato: 'NUM' | 'PREF'; prefisso: string; cifre: number; prossimo: number
  riammissione: 'NUOVO' | 'SUFFISSO'; sepSuffisso: '' | '/' | '-' | '.'; cifreSuffisso: number
}
export const parametriTesseraSchema = z.object({
  formato:       z.enum(['NUM', 'PREF']),
  prefisso:      z.string().max(10).regex(/^[A-Za-z0-9 ._/-]*$/),
  cifre:         z.number().int().min(1).max(8),
  prossimo:      z.number().int().min(1).max(99_999_999),
  riammissione:  z.enum(['NUOVO', 'SUFFISSO']),
  sepSuffisso:   z.enum(['', '/', '-', '.']),
  cifreSuffisso: z.number().int().min(1).max(3),
}).strict()

export const formatTessera = (t: ParametriTessera, n: number): string =>
  `${t.formato === 'PREF' ? t.prefisso : ''}${String(n).padStart(t.cifre, '0')}`

/** Numero della tessera (senza prefisso e senza suffisso): 'CRAL-0042/01' → 42. */
export function numeroTessera(t: ParametriTessera, tessera: string): number | null {
  const s = tessera.startsWith(t.prefisso) ? tessera.slice(t.prefisso.length) : tessera
  const m = s.match(/^\d+/)
  return m ? parseInt(m[0], 10) : null
}

/** Nel libro soci il numero d'iscrizione è un intero: 42 → '0042' (o 'CRAL-0042'). */
export function tesseraDaFile(t: ParametriTessera, valore: string): string {
  const v = valore.trim()
  return /^\d+$/.test(v) ? formatTessera(t, parseInt(v, 10)) : v
}

/** Dopo aver usato `tessera`, il prossimo numero non deve poterla ripetere. */
export function prossimoDopo(t: ParametriTessera, tessera: string): number {
  const n = numeroTessera(t, tessera)
  return n !== null && n >= t.prossimo ? n + 1 : t.prossimo
}

/**
 * Tessera di chi rientra. NUOVO (default dal 28/10): il prossimo numero
 * libero. SUFFISSO: stesso numero della prima iscrizione + suffisso
 * progressivo (0042/01 … /99); oltre il massimo, errore.
 */
export function tesseraRiammissione(t: ParametriTessera, base: string | null, riammissioni: number):
  { tessera: string; nuovoNumero: boolean } | { errore: string } {
  if (t.riammissione !== 'SUFFISSO' || !base) return { tessera: formatTessera(t, t.prossimo), nuovoNumero: true }
  const n = riammissioni + 1
  if (n > 10 ** t.cifreSuffisso - 1) return { errore: 'SUFFISSI_ESAURITI' }
  return { tessera: `${base}${t.sepSuffisso}${String(n).padStart(t.cifreSuffisso, '0')}`, nuovoNumero: false }
}

/** La tessera senza il suffisso di rientro: base del prossimo suffisso. */
export function baseTessera(t: ParametriTessera, tessera: string): string {
  const re = new RegExp(`${t.sepSuffisso.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')}\\d{${t.cifreSuffisso}}$`)
  return t.sepSuffisso || tessera.length > t.cifre + t.cifreSuffisso ? tessera.replace(re, '') : tessera
}

// ── Abbinamento del libro soci all'anagrafica PGS ────────────
export interface AnagraficaCral extends AnagraficaPerRicerca {
  druolo: string | null
  nascita: string | null
  finRap: string | null
}
export interface CandidatoCral {
  matricola: string; cognome: string; nome: string; ruolo: string | null; druolo: string | null
  nascita: string | null; finRap: string | null
}
export type EsitoAbbinamento = 'trovato' | 'parziale' | 'ambiguo' | 'non-trovato'
export interface RigaAbbinamento { i: number; nominativo: string; matricola?: string; nascita?: string }
export interface Abbinamento {
  i: number
  esito: EsitoAbbinamento
  via: 'matricola' | 'nominativo' | 'nominativo e data di nascita'
  candidati: CandidatoCral[]
  /** Matricola del file che non esiste in anagrafica (si passa al nominativo). */
  matricolaIgnota?: string
  /** Data di nascita in PGS diversa da quella del file. */
  nascitaDiversa?: string
}

function candidato(a: AnagraficaCral): CandidatoCral {
  const [cognome, nome] = a.cognome || a.nome ? [a.cognome ?? '', a.nome ?? ''] : spezzaNominativo(a.cognNome ?? '')
  return { matricola: a.matricola, cognome, nome, ruolo: a.ruolo, druolo: a.druolo, nascita: a.nascita, finRap: a.finRap }
}

/**
 * Cognome e nome da un nominativo in un solo campo. Il libro soci è tutto
 * maiuscolo, quindi non si può sapere dove finisce un cognome composto:
 * «DE LUCA MARIA» → cognome «DE», nome «LUCA MARIA». Le particelle note
 * (DE, DI, DA, DEL, DELLA, LA, LO, D', …) restano attaccate al cognome.
 * Le parole in minuscolo, se ci sono, sono il nome («COLOMBO Anna»).
 */
export function spezzaNominativo(nom: string): [string, string] {
  const parti = nom.trim().split(/\s+/).filter(Boolean)
  if (!parti.length) return ['', '']
  const iNome = parti.findIndex((p, j) => j > 0 && p !== p.toUpperCase())
  if (iNome > 0) return [parti.slice(0, iNome).join(' ').toUpperCase(), parti.slice(iNome).join(' ')]
  const PARTICELLE = new Set(['DE', 'DI', 'DA', 'DEL', 'DELLA', 'DELLO', 'DEI', 'DEGLI', 'DAL', 'DALLA', 'LA', 'LO', 'LI', 'LE', 'D', 'MC', 'MAC', 'VAN', 'VON', 'SAN', 'SANTO', 'SANTA'])
  let k = 0
  while (k < parti.length - 2 && PARTICELLE.has(normalizza(parti[k]!).replace(/ /g, ''))) k++
  return [parti.slice(0, k + 1).join(' ').toUpperCase(), parti.slice(k + 1).join(' ')]
}

/**
 * Abbina una riga del file: prima la matricola (se c'è e esiste), poi il
 * nominativo con la regola di Emolumenti (risolviNominativo, usata così
 * com'è). In più, solo lato CRAL:
 *  · «parziale» quando l'unico candidato ha nomi in più (Bianchi Giulia →
 *    BIANCHI GIULIA MARIA): non passa in silenzio, si guarda;
 *  · la data di nascita del file decide fra gli omonimi (al posto del
 *    codice fiscale) e segnala se è diversa da PGS.
 */
export function abbina(r: RigaAbbinamento, anag: AnagraficaCral[], perMatricola: Map<string, AnagraficaCral>): Abbinamento {
  const mat = (r.matricola ?? '').replace(/\D/g, '')
  let matricolaIgnota: string | undefined
  if (mat) {
    const a = perMatricola.get(mat.padStart(6, '0')) ?? perMatricola.get(mat)
    if (a) return conNascita({ i: r.i, esito: 'trovato', via: 'matricola', candidati: [candidato(a)] }, r.nascita)
    matricolaIgnota = mat
  }
  const nom = r.nominativo.trim()
  if (!nom) return { i: r.i, esito: 'non-trovato', via: 'nominativo', candidati: [], ...(matricolaIgnota ? { matricolaIgnota } : {}) }
  const { esito, candidati } = risolviNominativo(nom, anag)
  const trovati = candidati.map(c => perMatricola.get(c.matricola)).filter((a): a is AnagraficaCral => !!a)
  let out: Abbinamento
  if (esito === 'non-trovato') out = { i: r.i, esito: 'non-trovato', via: 'nominativo', candidati: [] }
  else if (esito === 'ambiguo') out = { i: r.i, esito: 'ambiguo', via: 'nominativo', candidati: trovati.map(candidato) }
  else {
    const a = trovati[0]!
    const cercati = grafie(nom).map(g => g.size)
    const suoi = new Set([a.cognome ?? '', a.nome ?? '', a.cognNome ?? ''].flatMap(c => normalizza(c, 'diviso').split(' ').filter(t => t.length > 1)))
    // risolviNominativo preferisce gli esatti: se l'unico è parziale ha più parole di quelle cercate
    const parziale = Math.min(...cercati) < suoi.size && !cercati.some(n => n >= suoi.size)
    out = { i: r.i, esito: parziale ? 'parziale' : 'trovato', via: 'nominativo', candidati: [candidato(a)] }
  }
  if (matricolaIgnota) out.matricolaIgnota = matricolaIgnota
  if (r.nascita && out.esito === 'ambiguo') {
    const c = out.candidati.filter(x => x.nascita === r.nascita)
    if (c.length === 1) out = { ...out, esito: 'trovato', via: 'nominativo e data di nascita', candidati: c }
  }
  return conNascita(out, r.nascita)
}

function conNascita(a: Abbinamento, nascita?: string): Abbinamento {
  const c = a.candidati[0]
  if (nascita && (a.esito === 'trovato' || a.esito === 'parziale') && c?.nascita && c.nascita !== nascita) return { ...a, nascitaDiversa: c.nascita }
  return a
}

// ── Lettura dei fogli (file caricati dall'utente) ────────────
export const MAX_RIGHE_FOGLIO = 20_000
export const MAX_COLONNE = 60
/** Celle come testo, una matrice per foglio, ripulite e limitate. */
export function pulisciFoglio(righe: unknown[][]): string[][] {
  return righe.slice(0, MAX_RIGHE_FOGLIO).map(r =>
    (Array.isArray(r) ? r : []).slice(0, MAX_COLONNE).map(c =>
      String(c ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 500)))
}

// ── Quote associative: rate e importi versati (0024) ─────────
export interface QuotaValori {
  modo: 'UNICA' | 'MENSILE' | 'TRATTENUTA'; mesi: boolean[]; importi: number[]; pagataIl: string | null; versatoUnica: number | null; note: string
}
/** Rata del mese k (0–11) di una quota annua: l'ultima prende i centesimi di resto. */
export const rataMese = (imp: number, k: number): number => { const r = Math.floor(imp / 12); return k === 11 ? imp - 11 * r : r }
/** Versato reale: somma degli importi delle rate e dell'unica soluzione. */
export const versato = (q: Pick<QuotaValori, 'importi' | 'versatoUnica'>): number => q.importi.reduce((a, v) => a + v, 0) + (q.versatoUnica ?? 0)

/**
 * Modifica a mano di una quota (scheda Quote associative), con le regole
 * della 0024: accendere un mese registra la rata (o lascia l'importo se e'
 * gia' maggiore), spegnerlo azzera l'importo; segnare pagata l'unica
 * soluzione registra la quota dell'anno, toglierla la azzera. Importi
 * espliciti: il mese e' pagato se l'importo copre la rata, tutti i mesi se
 * un versamento copre la quota dell'anno.
 */
export function quotaDopoModifica(
  cur: QuotaValori, patch: Partial<Pick<QuotaValori, 'modo' | 'mesi' | 'importi' | 'pagataIl' | 'note'>>, imp: number,
): QuotaValori {
  const q: QuotaValori = { ...cur, mesi: [...cur.mesi], importi: [...cur.importi] }
  if (patch.modo !== undefined) q.modo = patch.modo
  if (patch.note !== undefined) q.note = patch.note
  if (patch.importi) {
    q.importi = patch.importi.map(v => Math.max(0, Math.round(v)))
    q.mesi = q.importi.map((v, k) => v > 0 && v >= rataMese(imp, k))
    if (imp > 0 && q.importi.some(v => v >= imp)) q.mesi = q.mesi.map(() => true)
  } else if (patch.mesi) {
    q.mesi = [...patch.mesi]
    q.importi = q.importi.map((v, k) => (q.mesi[k] ? Math.max(v, rataMese(imp, k)) : 0))
  }
  if (patch.pagataIl !== undefined) {
    q.pagataIl = patch.pagataIl
    q.versatoUnica = patch.pagataIl ? Math.max(cur.versatoUnica ?? 0, imp) : null
  }
  return q
}
