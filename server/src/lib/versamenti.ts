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
// Solo ASCII (audit 26.10.26.2, V-7): parte locale con i caratteri «atext»
// della RFC 5322, dominio a etichette [A-Za-z0-9-]. Fuori restano spazi,
// a capo, caratteri di controllo e invisibili, e le lettere non latine che
// imitano quelle latine (omografi: «un\u0456versita.example» con la «і»
// cirillica). Gli EML portano dati personali: un dominio che SEMBRA giusto
// non deve passare. Un dominio con accenti si scrive nella forma xn--.
// Nessun quantificatore annidato: la regex resta lineare (e prima si
// controlla la lunghezza).
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/

// ── Testi salvati o scritti nell'audit (audit 26.10.26.2, V-6) ──
// Caratteri di controllo (C0/C1, NUL compreso), separatori di riga Unicode,
// caratteri invisibili e override bidirezionali («Trojan Source»).
// Il NUL in particolare: PostgreSQL lo rifiuta in TEXT e JSONB, e un NUL
// nel solo nome file faceva fallire l'audit DOPO il commit dell'import.
const NON_STAMPABILI = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g
// Nei testi su piu' righe restano a capo e tabulazioni.
const NON_STAMPABILI_TESTO = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069\ufeff]/g

/** Una riga di testo: i caratteri non stampabili diventano spazi, poi trim. */
export const pulisciRiga = (s: string): string => s.replace(NON_STAMPABILI, ' ').trim()

/** Schema zod di una riga di testo ripulita, lunga al massimo `max`. */
export const rigaSicura = (max: number, min = 0) =>
  z.string().max(max * 4).transform(pulisciRiga).pipe(z.string().min(min).max(max))

/** Testo su piu' righe (corpo del messaggio): via controlli, NUL e override bidi. */
export const testoSicuro = (max: number) =>
  z.string().max(max * 2).transform(s => s.replace(NON_STAMPABILI_TESTO, '')).pipe(z.string().min(1).max(max))

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

const testoBreve = (max: number) => rigaSicura(max, 1)

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
    titolo:    rigaSicura(200),
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
  testo:    testoSicuro(8000),
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

// ── Import della rubrica (es. dal Java GestioneSaldiEnti) ─────
// Regola: un import non sovrascrive mai il lavoro fatto in PGS.
//   · ente che non c'e'            → si crea con email e abilitazione del file;
//   · ente presente SENZA email    → prende email e abilitazione del file;
//   · ente presente CON email      → non si tocca (nemmeno l'abilitazione);
//   · riga che non porterebbe nulla di nuovo (niente email, stessa
//     abilitazione) → invariata: rifare l'import non riscrive niente.

export interface RigaImportEnte {
  codice:      string
  descrizione: string
  email:       string[]
  abilitato:   boolean
}

export interface PianoImport {
  nuovi:      RigaImportEnte[]
  aggiorna:   RigaImportEnte[]
  saltati:    string[]
  invariati:  string[]
}

export function pianoImport(
  righe: readonly RigaImportEnte[],
  esistenti: ReadonlyMap<string, { email: readonly string[]; abilitato: boolean }>,
): PianoImport {
  const visti = new Set<string>()
  const piano: PianoImport = { nuovi: [], aggiorna: [], saltati: [], invariati: [] }
  for (const r of righe) {
    if (visti.has(r.codice)) continue          // la prima riga di un codice vince
    visti.add(r.codice)
    const e = esistenti.get(r.codice)
    if (!e) piano.nuovi.push(r)
    else if (e.email.length > 0) piano.saltati.push(r.codice)
    else if (r.email.length === 0 && r.abilitato === e.abilitato) piano.invariati.push(r.codice)
    else piano.aggiorna.push(r)
  }
  return piano
}
