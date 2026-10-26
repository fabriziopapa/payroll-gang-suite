// ============================================================
// PAYROLL GANG SUITE — Versamenti enti · regole lato server
//
// Validazione di cio' che il modulo salva: indirizzi email degli enti e
// modelli di messaggio (oggetto, testo, configurazione degli allegati).
//
// I segnaposto e le chiavi delle colonne sono gli STESSI del client
// (client/src/utils/versamentiModelli.ts e versamentiAllegati.ts): se se ne
// aggiunge uno, va aggiunto in entrambi i posti. Il server rifiuta un
// modello con un segnaposto che il client non saprebbe riempire.
// ============================================================

import { z } from 'zod'

/** Segnaposto ammessi in oggetto, testo e titolo del PDF. */
export const SEGNAPOSTO_TESTO = [
  'DESCRIZIONE_ENTE', 'CODICE_ENTE', 'PERIODO', 'PERIODO_BREVE', 'TOTALE', 'RIGHE',
] as const
/** Segnaposto ammessi nei nomi dei file. */
export const SEGNAPOSTO_FILE = ['CODICE_ENTE', 'PERIODO_FILE'] as const
/** Il titolo del PDF ammette anche il periodo da nome file. */
const SEGNAPOSTO_TITOLO = [...SEGNAPOSTO_TESTO, 'PERIODO_FILE'] as const

export const COLONNE = ['NOME', 'DATA_NASCITA', 'MATRICOLA', 'COD_FISC', 'MESE', 'VOCE', 'IMPORTO'] as const

const MAX_EMAIL = 20
// Volutamente semplice: niente spazi, niente separatori, una chiocciola, un
// dominio con un punto. Outlook fa il resto; qui si fermano i refusi.
const EMAIL_RE = /^[^\s@,;<>()"]+@[^\s@,;<>()"]+\.[A-Za-z]{2,}$/

export type EsitoEmail = { ok: true; lista: string[] } | { ok: false; errata: string } | { ok: false; troppe: true }

/**
 * Normalizza un elenco di indirizzi: accetta una stringa con virgole o
 * punti e virgola (come la cella del Java) o un array. Toglie spazi e
 * doppioni, porta in minuscolo, controlla ognuno.
 */
export function normalizzaEmail(input: string | string[]): EsitoEmail {
  const pezzi = (Array.isArray(input) ? input : [input]).flatMap(s => String(s).split(/[,;]/))
  const lista = [...new Set(pezzi.map(s => s.trim().toLowerCase()).filter(Boolean))]
  const errata = lista.find(x => x.length > 254 || !EMAIL_RE.test(x))
  if (errata !== undefined) return { ok: false, errata }
  if (lista.length > MAX_EMAIL) return { ok: false, troppe: true }
  return { ok: true, lista }
}

/** I nomi tra graffe che non sono nell'elenco ammesso. */
export function segnapostoIgnoti(testo: string, ammessi: readonly string[]): string[] {
  const trovati = [...testo.matchAll(/\{([^{}]*)\}/g)].map(m => m[1] ?? '')
  return [...new Set(trovati.filter(k => !ammessi.includes(k)))]
}

const testoBreve = (max: number) => z.string().trim().min(1).max(max)

export const allegatiSchema = z.object({
  nomeEml:      testoBreve(120),
  nomeAllegati: testoBreve(120),
  ordine:       z.enum(['mese', 'nome', 'importo']),
  csv: z.object({
    attivo:       z.boolean(),
    sep:          z.enum([';', ',', 'tab']),
    decimali:     z.enum(['virgola', 'punto']),
    codifica:     z.enum(['w1252', 'utf8bom']),
    intestazione: z.boolean(),
  }),
  pdf: z.object({
    attivo:    z.boolean(),
    titolo:    z.string().max(200),
    orient:    z.enum(['p', 'l']),
    subtotali: z.boolean(),
    totale:    z.boolean(),
  }),
  colonne: z.array(z.object({
    k:         z.enum(COLONNE),
    csv:       testoBreve(40),
    pdf:       testoBreve(40),
    on:        z.boolean(),
    soloMulti: z.boolean().optional(),
  })).min(1).max(COLONNE.length),
})
export type AllegatiConfig = z.infer<typeof allegatiSchema>

export const modelloSchema = z.object({
  nome:     testoBreve(80),
  oggetto:  testoBreve(200),
  testo:    z.string().min(1).max(8000),
  allegati: allegatiSchema,
})
export type ModelloInput = z.infer<typeof modelloSchema>

/**
 * Controlli che zod non esprime: segnaposto sconosciuti, colonne ripetute,
 * allegati senza colonne. Restituisce il codice d'errore o null.
 */
export function erroreModello(m: ModelloInput): string | null {
  const a = m.allegati
  if (segnapostoIgnoti(m.oggetto + '\n' + m.testo, SEGNAPOSTO_TESTO).length) return 'SEGNAPOSTO_SCONOSCIUTO'
  if (segnapostoIgnoti(a.pdf.titolo, SEGNAPOSTO_TITOLO).length) return 'SEGNAPOSTO_SCONOSCIUTO'
  if (segnapostoIgnoti(a.nomeEml + '\n' + a.nomeAllegati, SEGNAPOSTO_FILE).length) return 'SEGNAPOSTO_FILE_SCONOSCIUTO'
  if (new Set(a.colonne.map(c => c.k)).size !== a.colonne.length) return 'COLONNE_RIPETUTE'
  if ((a.csv.attivo || a.pdf.attivo) && !a.colonne.some(c => c.on)) return 'NESSUNA_COLONNA'
  return null
}
