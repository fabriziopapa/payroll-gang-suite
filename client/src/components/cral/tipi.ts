// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · modello dati del client
//
// Lo stato arriva tutto da GET /api/v1/cral/stato. La config degli
// eventi (opzioni, prodotti, settimane, articoli, sconti) è JSON validato
// dal server: qui si "appiattisce" sull'evento, così le schede leggono
// ini.prodotti invece di ini.config.prodotti.
// ============================================================

export type TipoPersona = 'SD' | 'SE' | 'EST' | 'FAM'
export type StatoPersona = 'ATTIVO' | 'DA_VALIDARE' | 'RIFIUTATO' | 'CESSATO' | 'ELIMINATO'
export type Relazione = 'CONIUGE' | 'FIGLIO'
export type Modalita = 'SCELTA' | 'NESSUNA' | 'ORDINE' | 'TURNI' | 'MAGAZZINO'
export type CatSconto = 'SD' | 'SE' | 'DIP' | 'EST' | 'FAM'
export type StatoPeriodo = '' | 'P' | 'F' | 'T'

export interface Legame { socio: string; relazione: Relazione }

export interface Persona {
  id: string; tipo: TipoPersona; origine: 'PGS' | 'EST'; matricola: string | null
  cognome: string; nome: string; nascita: string | null; email: string; sede: string | null
  tessera: string; riammissioni: number; stato: StatoPersona
  iscrittoIl: string; cessatoIl: string | null; provenienza: string | null; atipico: boolean; note: string
  creatoDa: string | null; creatoIl: string; validatoDa: string | null; validatoIl: string | null
  modificatoDa: string | null; modificatoIl: string | null
  /** Eliminato (con lo stato di prima), anni esenti dalla quota, ex matricola di chi è passato a socio esterno. */
  eliminatoIl: string | null; eliminatoDa: string | null; statoPrima: Exclude<StatoPersona, 'ELIMINATO'> | null
  anniEsenti: number[]; exMatricola: string | null
  legami: Legame[]
  storicoTessere: Array<{ tessera: string; dal: string | null; al: string }>
}

export interface Sede { id: string; nome: string; attiva: boolean; ordine: number }
export interface TipoEvento { id: string; nome: string; colore: string; pagamento: boolean; modo: Modalita | null; attivo: boolean; ordine: number }
export interface Tipologia { id: string; nome: string; attiva: boolean; ordine: number }
export interface ParametriTessera {
  formato: 'NUM' | 'PREF'; prefisso: string; cifre: number; prossimo: number
  riammissione: 'NUOVO' | 'SUFFISSO'; sepSuffisso: '' | '/' | '-' | '.'; cifreSuffisso: number
}

export interface ScontoRegola { tipo: '%' | '€'; val: number }
export type ScontoPers = { tipo: 'NO'; nota?: string } | { tipo: '%' | '€'; val: number; nota?: string }

export interface Scelta {
  opz?: string
  q?: Record<string, number>
  per?: Record<string, StatoPeriodo>
  versato?: number
  pagato?: boolean
  consegnato?: boolean
  note?: string
  /** Persona di riferimento nei campi: '' = nessuna, assente = automatica. */
  rif?: string
  /** Categoria per lo sconto bloccata all'iscrizione. */
  iscr?: { data: string; cat: Exclude<CatSconto, 'FAM'> }
  scontoPers?: ScontoPers
  fonte?: 'manuale' | 'modulo' | 'predefinita'
}
/** Modifica di una scelta: null toglie la chiave (stessa regola del server). */
export type PatchScelta = { [K in keyof Omit<Scelta, 'fonte'>]?: Scelta[K] | null }

export interface Opzione { id: string; etichetta: string }
export interface Prodotto {
  id: string; tipologia: string; nome: string; prezzo: number; unita: 'pz' | 'cas' | 'kg'
  contenuto: number | null; contenutoUm: 'lt' | 'kg'; max: number | null
}
export interface Periodo { id: string; nome: string; dal: string; al: string; posti: number | null }
export interface Articolo { id: string; nome: string; prezzo: number }
export type Sconti = Partial<Record<CatSconto, ScontoRegola>>
export interface Carico { id: string; art: string; qta: number; data: string; note: string }
export interface Richiesta {
  id: string; persona: string; art: string; qta: number; dataRich: string
  stato: 'ATTESA' | 'CONSEGNATA' | 'ANNULLATA'; dataCons: string | null; modo: 'MANO' | 'EMAIL'
  pagato: boolean; sconto: ScontoPers | null; note: string
}

export interface Iniziativa {
  id: string; tipo: string; titolo: string; anno: number; data: string; scadenza: string | null
  stato: 'BOZZA' | 'APERTA' | 'CHIUSA'; modalita: Modalita
  modoPart: 'GRUPPI' | 'SINGOLI'; gruppi: TipoPersona[]; sedi: string[]; predefinita: string | null
  fornitore: string; pagamento: string; note: string; quota: number
  opzioni: Opzione[]; prodotti: Prodotto[]; periodi: Periodo[]; articoli: Articolo[]; sconti: Sconti
  archiviata: boolean; archiviataDa: string | null; archiviataIl: string | null
  partecipanti: string[]
  scelte: Record<string, Scelta>
  carichi: Carico[]
  richieste: Richiesta[]
}

export interface QuotaSocio {
  modo: 'UNICA' | 'MENSILE' | 'TRATTENUTA'; mesi: boolean[]; pagataIl: string | null; note: string
  /** Centesimi versati per mese e in unica soluzione (0024): il versato è la loro somma. */
  importi: number[]; versatoUnica: number | null
}

export interface Db {
  sedi: Sede[]; tipi: TipoEvento[]; tipologie: Tipologia[]
  tessera: ParametriTessera; extProssimo: number; famProssimo: number
  soci: Persona[]
  /** Indice per ID: le ricerche nelle tabelle grandi non scorrono l'elenco. */
  perId: Map<string, Persona>
  iniziative: Iniziativa[]
  quoteAnno: Array<{ anno: number; importo: number }>
  quote: Record<string, Record<string, QuotaSocio>>
}

// ── Risposta del server ──────────────────────────────────────
export interface StatoApi {
  sedi: Sede[]; tipi: TipoEvento[]; tipologie: Tipologia[]
  parametri: { tessera: ParametriTessera; extProssimo: number; famProssimo: number }
  soci: Persona[]
  iniziative: Array<Omit<Iniziativa, 'opzioni' | 'prodotti' | 'periodi' | 'articoli' | 'sconti' | 'scelte' | 'richieste'> & {
    config: unknown; scelte: Record<string, Record<string, unknown>>; richieste: Array<Omit<Richiesta, 'sconto'> & { sconto: unknown }>
  }>
  quoteAnno: Array<{ anno: number; importo: number }>
  quote: Record<string, Record<string, QuotaSocio>>
}

/** Riga dell'anagrafica PGS (ricerca e abbinamento): nessun codice fiscale. */
export interface AnagraficaPgs {
  matricola: string; cognome: string; nome: string; ruolo: string | null; druolo: string | null
  nascita: string | null; finRap: string | null
}

// ── Lotti di variazioni da validare ──────────────────────────
export type SezioneLotto = 'sedi' | 'tabelle' | 'soci' | 'quote' | 'eventi'
export interface Lotto {
  id: string; origine: 'T6' | 'T7' | 'ARCHIVIO'; file: string; ambiente: string; esportato: string | null; sezioni: SezioneLotto[]
  stato: 'APERTO' | 'CHIUSO' | 'SCARTATO'; riepilogo: Record<string, unknown>
  creatoDa: string | null; creatoIl: string; chiusoDa: string | null; chiusoIl: string | null
  conteggi?: Record<string, number>
}
export interface CampoVariazione { campo: string; etichetta: string; prima: unknown; dopo: unknown; blocco?: string }
export interface Variazione {
  id: number; sezione: SezioneLotto; entita: string; chiave: string; tipo: 'NUOVO' | 'MODIFICA' | 'CONFLITTO'
  delicata: boolean; bloccata: string | null; esito: 'ATTESA' | 'ACCETTATA' | 'SCARTATA' | 'APPLICATA' | 'ERRORE'
  accettati: string[]; etichetta: string; campi: CampoVariazione[]; avviso: string | null; nota: string
}
/** Testata dell'archivio (per mostrare cosa contiene prima di caricarlo). */
export interface ArchivioTestata {
  formato: string; versione: number; app: string; ambiente: string; esportato: string; sezioni: SezioneLotto[]
  sedi?: unknown[]; tabelle?: { tipi?: unknown[]; tipologie?: unknown[]; quoteAnno?: unknown[] }; soci?: unknown[]; quote?: unknown[]; eventi?: unknown[]
}

const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : [])

export function daStato(s: StatoApi): Db {
  const iniziative: Iniziativa[] = s.iniziative.map(i => {
    const c = (i.config ?? {}) as Record<string, unknown>
    const { config: _c, ...resto } = i
    return {
      ...resto,
      opzioni: arr<Opzione>(c['opzioni']),
      prodotti: arr<Prodotto>(c['prodotti']),
      periodi: arr<Periodo>(c['periodi']),
      articoli: arr<Articolo>(c['articoli']),
      sconti: (c['sconti'] && typeof c['sconti'] === 'object' ? c['sconti'] : {}) as Sconti,
      gruppi: i.gruppi as TipoPersona[],
      scelte: i.scelte as Record<string, Scelta>,
      richieste: i.richieste.map(r => ({ ...r, sconto: (r.sconto ?? null) as ScontoPers | null })),
    }
  })
  return {
    sedi: s.sedi, tipi: s.tipi, tipologie: s.tipologie,
    tessera: s.parametri.tessera, extProssimo: s.parametri.extProssimo, famProssimo: s.parametri.famProssimo,
    soci: s.soci, perId: new Map(s.soci.map(p => [p.id, p])),
    iniziative, quoteAnno: s.quoteAnno, quote: s.quote,
  }
}

/** Config dell'evento come la vuole il server (inverso di daStato). */
export function configDi(i: Pick<Iniziativa, 'opzioni' | 'prodotti' | 'periodi' | 'articoli' | 'sconti'>) {
  return { opzioni: i.opzioni, prodotti: i.prodotti, periodi: i.periodi, articoli: i.articoli, sconti: i.sconti }
}
