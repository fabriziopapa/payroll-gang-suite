// ============================================================
// PAYROLL GANG SUITE — Esporta e importa · file cifrato .pgsx
//
// Il file che porta i dati da un'installazione all'altra (produzione ↔
// pre-produzione). Regole pure: nessuna dipendenza da db o rete
// (trasferimento.test.ts).
//
// FORMATO (versione 1)
//   [ 0.. 4)  sigla 'PGSX'
//   [ 4.. 5)  versione del formato
//   [ 5..21)  sale        (16 byte a caso)
//   [21..33)  nonce       (12 byte a caso)
//   [33..-16) corpo       gzip(JSON) cifrato con AES-256-GCM
//   [-16..]   sigillo     (tag GCM)
// I primi 33 byte sono in chiaro ma autenticati (dati aggiuntivi del
// sigillo): cambiarne uno invalida il file. In chiaro non c'e' altro —
// ne' l'ambiente, ne' la versione di PGS, ne' cosa contiene.
//
// TRE SCELTE CHE NON SONO DETTAGLI
//   · I parametri di Argon2id sono FISSATI dalla versione del formato e
//     non si leggono dal file: un file ostile potrebbe chiedere gigabyte
//     di memoria prima ancora che il sigillo sia verificato.
//   · Del contenuto non si usa NULLA prima di `final()`: Node consegna i
//     byte decifrati gia' da `update()`, quando il sigillo non e' ancora
//     stato controllato.
//   · La decompressione ha un tetto: un contenuto gonfiato si ferma li',
//     non quando finisce la memoria (PM2 riavvia il processo a 512 MB).
// ============================================================

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import argon2 from 'argon2'
import { z } from 'zod'
import { SEZIONI, archivioSchema } from './cralLotti.js'

export const ESTENSIONE = '.pgsx'
const SIGLA = Buffer.from('PGSX')
const VERSIONE_FORMATO = 1
const LUNG_TESTA = 33
const LUNG_SIGILLO = 16
/** Il file intero, cifrato. */
export const MAX_BYTE_FILE = 16 * 1024 * 1024
/** Il contenuto, decompresso. */
export const MAX_BYTE_CHIARO = 64 * 1024 * 1024
/** Un pezzo del caricamento: sotto 1 MB anche scritto in base64, qualunque proxy ci sia davanti. */
export const BYTE_PEZZO = 384 * 1024

const KDF = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, hashLength: 32, raw: true } as const

/** Errori del file: il codice va al client cosi' com'e'. */
export type CodiceFile = 'FILE_NON_VALIDO' | 'VERSIONE_NON_SUPPORTATA' | 'FILE_O_FRASE_NON_VALIDI' | 'FILE_TROPPO_GRANDE' | 'CONTENUTO_NON_VALIDO'
export class ErroreFile extends Error { constructor(readonly codice: CodiceFile, readonly dove = '') { super(codice) } }

// ── Frase segreta ────────────────────────────────────────────
// 30 simboli senza i confondibili (niente I, L, O, U, 0, 1): 5 gruppi da 5
// fanno circa 123 bit. La genera il server: una frase scelta a mano sarebbe
// il punto debole di tutto il resto.
const ALFABETO = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
export function generaFrase(): string {
  return Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('')).join('-')
}
/** La frase come entra nel calcolo: maiuscole, senza spazi ne' trattini (cosi' si puo' anche dettare). */
export const normalizzaFrase = (f: string): string => f.normalize('NFKC').replace(/[\s-]/g, '').toUpperCase()
/** Una frase che ha la forma di quelle generate qui (25 simboli dell'alfabeto). */
export const fraseBenFormata = (f: string): boolean => new RegExp(`^[${ALFABETO}]{25}$`).test(normalizzaFrase(f))

async function chiave(frase: string, sale: Buffer): Promise<Buffer> {
  return argon2.hash(normalizzaFrase(frase), { ...KDF, salt: sale })
}

// ── Cifratura ────────────────────────────────────────────────
export async function cifra(contenuto: unknown, frase: string): Promise<Buffer> {
  const chiaro = Buffer.from(JSON.stringify(contenuto), 'utf8')
  if (chiaro.length > MAX_BYTE_CHIARO) throw new ErroreFile('FILE_TROPPO_GRANDE')
  const sale = randomBytes(16), nonce = randomBytes(12)
  const testa = Buffer.concat([SIGLA, Buffer.from([VERSIONE_FORMATO]), sale, nonce])
  const c = createCipheriv('aes-256-gcm', await chiave(frase, sale), nonce)
  c.setAAD(testa)
  const corpo = Buffer.concat([c.update(gzipSync(chiaro)), c.final()])
  const file = Buffer.concat([testa, corpo, c.getAuthTag()])
  if (file.length > MAX_BYTE_FILE) throw new ErroreFile('FILE_TROPPO_GRANDE')
  return file
}

/**
 * Apre il file. Frase sbagliata e file alterato danno lo STESSO errore:
 * chi prova non deve poter distinguere le due cose.
 */
export async function decifra(file: Buffer, frase: string): Promise<unknown> {
  if (file.length > MAX_BYTE_FILE) throw new ErroreFile('FILE_TROPPO_GRANDE')
  if (file.length < LUNG_TESTA + LUNG_SIGILLO || !file.subarray(0, 4).equals(SIGLA)) throw new ErroreFile('FILE_NON_VALIDO')
  if (file[4] !== VERSIONE_FORMATO) throw new ErroreFile('VERSIONE_NON_SUPPORTATA')
  const testa = file.subarray(0, LUNG_TESTA)
  const d = createDecipheriv('aes-256-gcm', await chiave(frase, testa.subarray(5, 21)), testa.subarray(21, LUNG_TESTA))
  d.setAAD(testa)
  d.setAuthTag(file.subarray(file.length - LUNG_SIGILLO))
  let compresso: Buffer
  try { compresso = Buffer.concat([d.update(file.subarray(LUNG_TESTA, file.length - LUNG_SIGILLO)), d.final()]) }
  catch { throw new ErroreFile('FILE_O_FRASE_NON_VALIDI') }
  // da qui il contenuto e' autentico: l'ha scritto chi conosceva la frase
  let chiaro: Buffer
  try { chiaro = gunzipSync(compresso, { maxOutputLength: MAX_BYTE_CHIARO }) }
  catch { throw new ErroreFile('FILE_TROPPO_GRANDE') }
  try { return JSON.parse(chiaro.toString('utf8')) as unknown }
  catch { throw new ErroreFile('CONTENUTO_NON_VALIDO') }
}

// ── Impronte ─────────────────────────────────────────────────
export const sha256 = (v: string | Buffer): string => createHash('sha256').update(v).digest('hex')
/** Impronta di una sezione: la stessa prima di cifrare e dopo aver decifrato. */
export const improntaSezione = (dati: unknown): string => sha256(JSON.stringify(dati))

/**
 * Impronta dello schema. Due parti, e devono coincidere tutte e due:
 *   · `migrazioni`: versione e checksum di ogni migrazione registrata;
 *   · `struttura`: tabelle, colonne, tipi, chiavi e NOMI dei vincoli, letti
 *     dal catalogo. Non il TESTO dei CHECK: PostgreSQL lo riscrive a ogni
 *     dump e ripristino, e due ambienti identici risulterebbero diversi
 *     (verificato sui due server il 14/11/2026).
 */
export interface Schema { migrazioni: number; ultima: string; improntaMigrazioni: string; elementi: number; improntaStruttura: string }
export function improntaSchema(migrazioni: Array<{ versione: string; checksum: string }>, struttura: string[]): Schema {
  const m = [...migrazioni].sort((a, b) => a.versione.localeCompare(b.versione))
  const s = [...struttura].sort()
  return {
    migrazioni: m.length, ultima: m.at(-1)?.versione ?? '', improntaMigrazioni: sha256(m.map(x => `${x.versione}:${x.checksum}`).join('\n')),
    elementi: s.length, improntaStruttura: sha256(s.join('\n')),
  }
}
/** Perche' due schemi non sono lo stesso; null se lo sono. */
export function differenzaSchema(file: Schema, qui: Schema): string | null {
  if (file.improntaMigrazioni !== qui.improntaMigrazioni) {
    return file.ultima !== qui.ultima || file.migrazioni !== qui.migrazioni
      ? `migrazioni diverse: il file viene da uno schema alla ${file.ultima || '—'} (${file.migrazioni} migrazioni), qui siamo alla ${qui.ultima || '—'} (${qui.migrazioni})`
      : 'stesso numero di migrazioni ma contenuto diverso (un file di migrazione è cambiato in uno dei due ambienti)'
  }
  if (file.improntaStruttura !== qui.improntaStruttura) return 'stesse migrazioni ma struttura del database diversa (tabelle, colonne o chiavi)'
  return null
}

// ── Contenuto ────────────────────────────────────────────────
export const FORMATO = 'pgs-trasferimento'
const HEX64 = z.string().regex(/^[0-9a-f]{64}$/)
const schemaSchema = z.object({
  migrazioni: z.number().int().min(0).max(10_000), ultima: z.string().max(40), improntaMigrazioni: HEX64,
  elementi: z.number().int().min(0).max(1_000_000), improntaStruttura: HEX64,
})
export const contenutoSchema = z.object({
  formato: z.literal(FORMATO), versione: z.literal(1),
  manifesto: z.object({
    app: z.string().max(20), ambiente: z.string().max(80), esportato: z.string().max(40), da: z.string().max(100),
    schema: schemaSchema,
    sezioni: z.object({
      cral: z.object({ sha256: HEX64, parti: z.array(z.enum(SEZIONI)).min(1).max(5), righe: z.record(z.number().int().min(0)) }).optional(),
    }),
  }),
  sezioni: z.object({ cral: archivioSchema.optional() }),
})
export type Contenuto = z.infer<typeof contenutoSchema>
export type Manifesto = Contenuto['manifesto']

/**
 * Valida il contenuto e ricontrolla le impronte delle sezioni contro il
 * manifesto. Il sigillo garantisce gia' che il file non e' stato alterato;
 * questo controllo prende i difetti di chi l'ha SCRITTO (un'esportazione
 * interrotta o un errore nel codice), che il sigillo non vede.
 */
export function leggiContenuto(grezzo: unknown): Contenuto {
  // l'impronta si calcola sul contenuto com'e' nel file, prima che la validazione aggiunga i valori predefiniti
  const cralGrezzo = (grezzo as { sezioni?: { cral?: unknown } } | null)?.sezioni?.cral
  const p = contenutoSchema.safeParse(grezzo)
  if (!p.success) throw new ErroreFile('CONTENUTO_NON_VALIDO', p.error.issues[0]?.path.slice(0, 5).join('.') ?? '')
  const c = p.data
  const dichiarata = c.manifesto.sezioni.cral
  if (!!dichiarata !== !!c.sezioni.cral) throw new ErroreFile('CONTENUTO_NON_VALIDO', 'sezioni.cral')
  if (dichiarata && improntaSezione(cralGrezzo) !== dichiarata.sha256) throw new ErroreFile('CONTENUTO_NON_VALIDO', 'sezioni.cral (impronta)')
  return c
}

/** Nome del file: data e ora, niente che dica cosa c'e' dentro. */
export function nomeFile(adesso: Date): string {
  const p = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }).format(adesso).replace(/[^0-9]/g, '')
  return `pgs-${p.slice(0, 8)}-${p.slice(8, 12)}${ESTENSIONE}`
}
