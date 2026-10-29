// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · lotti di variazioni (regole pure)
//
// Due provenienze, un solo motore:
//   · ARCHIVIO: il file esportato da un altro ambiente (produzione ↔
//     pre-produzione). Si confronta con i dati di qui e ne escono le
//     variazioni: record nuovi, campi diversi, conflitti.
//   · T6: l'aggiornamento massivo da Excel (sede, nascita, email,
//     tessera, note, tipologia, stato) di persone gia' presenti.
// Nulla si applica qui: le variazioni si salvano in un lotto, l'operatore
// le accetta o le scarta (anche un campo alla volta), il repository le
// applica. Regole: niente si cancella in arrivo, un valore vuoto non
// svuota, cambi di stato e passaggi di ID non entrano mai in «accetta
// tutte». Nessuna dipendenza da db o rete (cralLotti.test.ts).
// ============================================================

import { z } from 'zod'
import {
  MODALITA, erroreDati, erroreIniziativa, iniziativaSchema, parametriTesseraSchema, riga, sceltaSchema, scontoPersonale,
  usiTolti, type ConfigEvento, type ParametriTessera,
} from './cral.js'
import { normalizza } from '../services/emolumenti/nominativi.js'
import type { CralSocioRow, CralStato } from '../db/IRepository.js'

export const FORMATO_ARCHIVIO = 'pgs-cral-archivio'
export const SEZIONI = ['sedi', 'tabelle', 'soci', 'quote', 'eventi'] as const
export type Sezione = typeof SEZIONI[number]
export const ORDINE_SEZIONI: Record<Sezione, number> = { sedi: 0, tabelle: 1, soci: 2, quote: 3, eventi: 4 }
export type Entita = 'sede' | 'tipo' | 'tipologia' | 'tessera' | 'quotaAnno' | 'persona' | 'quota' | 'evento'

// ── Formato dell'archivio ────────────────────────────────────
const DATA       = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const TS         = z.string().max(40).nullable()
const UTENTE     = z.string().max(100).nullable()
const ID_PERSONA = z.string().regex(/^([0-9]{1,10}|EXT-[0-9]{4,6}|FAM-[0-9]{4,6})$/)
const MATR       = z.string().regex(/^\d{1,10}$/)
const ID_SEDE    = z.string().regex(/^[A-Z0-9]{1,12}$/)
const ID_COD     = z.string().regex(/^[A-Z0-9]{1,10}$/)
const TESSERA    = z.string().max(30).regex(/^[A-Za-z0-9 ._/-]*$/)
const ANNO       = z.number().int().min(2000).max(2100)
export const STATI = ['ATTIVO', 'DA_VALIDARE', 'RIFIUTATO', 'CESSATO', 'ELIMINATO'] as const
const STATO      = z.enum(STATI)

export const sedeArch = z.object({ id: ID_SEDE, nome: riga(120, 1), attiva: z.boolean(), ordine: z.number().int() })
export const tipoArch = z.object({
  id: ID_COD, nome: riga(60, 1), colore: z.string().regex(/^#[0-9A-Fa-f]{6}$/), pagamento: z.boolean(),
  modo: z.enum(MODALITA).nullable(), attivo: z.boolean(), ordine: z.number().int(),
})
export const tipologiaArch = z.object({ id: ID_COD, nome: riga(80, 1), attiva: z.boolean(), ordine: z.number().int() })
export const tabelleArch = z.object({
  tipi: z.array(tipoArch).max(200), tipologie: z.array(tipologiaArch).max(200),
  tessera: parametriTesseraSchema, extProssimo: z.number().int().min(1), famProssimo: z.number().int().min(1),
  quoteAnno: z.array(z.object({ anno: ANNO, importo: z.number().int().min(1).max(10_000_000) })).max(200),
})
export const personaArch = z.object({
  id: ID_PERSONA, tipo: z.enum(['SD', 'SE', 'EST', 'FAM']), matricola: MATR.nullable(), exMatricola: MATR.nullable().default(null),
  cognome: riga(100, 1), nome: riga(100), nascita: DATA.nullable(), email: z.string().max(254), sede: ID_SEDE.nullable(),
  tessera: TESSERA, riammissioni: z.number().int().min(0).max(999), stato: STATO,
  iscrittoIl: DATA, cessatoIl: DATA.nullable(), eliminatoIl: DATA.nullable().default(null),
  statoPrima: z.enum(['ATTIVO', 'DA_VALIDARE', 'RIFIUTATO', 'CESSATO']).nullable().default(null),
  anniEsenti: z.array(ANNO).max(100).default([]),
  provenienza: riga(200).nullable(), atipico: z.boolean(), note: riga(1000),
  creatoDa: UTENTE, creatoIl: TS, validatoDa: UTENTE, validatoIl: TS, modificatoDa: UTENTE, modificatoIl: TS,
  eliminatoDa: UTENTE.default(null),
  legami: z.array(z.object({ socio: ID_PERSONA, relazione: z.enum(['CONIUGE', 'FIGLIO']) })).max(10),
  storicoTessere: z.array(z.object({ tessera: TESSERA.min(1), dal: DATA.nullable(), al: DATA })).max(100),
})
export const quotaArch = z.object({
  anno: ANNO, socio: ID_PERSONA, modo: z.enum(['UNICA', 'MENSILE', 'TRATTENUTA']), mesi: z.array(z.boolean()).length(12),
  pagataIl: DATA.nullable(), note: riga(300),
})
const UUID = z.string().uuid()
export const eventoArch = iniziativaSchema.extend({
  id: UUID, archiviata: z.boolean(), archiviataDa: UTENTE, archiviataIl: TS,
  partecipanti: z.array(ID_PERSONA).max(50_000),
  scelte: z.array(z.object({ socio: ID_PERSONA, dati: sceltaSchema, fonte: z.enum(['manuale', 'modulo', 'predefinita']) })).max(50_000),
  carichi: z.array(z.object({ id: UUID, art: z.string().max(30), qta: z.number().int().min(1).max(100_000), data: DATA, note: riga(300) })).max(10_000),
  richieste: z.array(z.object({
    id: UUID, persona: ID_PERSONA, art: z.string().max(30), qta: z.number().int().min(1).max(1000), dataRich: DATA,
    stato: z.enum(['ATTESA', 'CONSEGNATA', 'ANNULLATA']), dataCons: DATA.nullable(), modo: z.enum(['MANO', 'EMAIL']),
    pagato: z.boolean(), sconto: scontoPersonale.nullable(), note: riga(300),
  })).max(50_000),
})
export const archivioSchema = z.object({
  formato: z.literal(FORMATO_ARCHIVIO), versione: z.literal(1), app: z.string().max(20), ambiente: z.string().max(80),
  esportato: z.string().max(40), sezioni: z.array(z.enum(SEZIONI)).max(5),
  sedi: z.array(sedeArch).max(500).optional(),
  tabelle: tabelleArch.optional(),
  soci: z.array(personaArch).max(50_000).optional(),
  quote: z.array(quotaArch).max(500_000).optional(),
  eventi: z.array(eventoArch).max(5_000).optional(),
})
export type SedeArch = z.infer<typeof sedeArch>
export type TipoArch = z.infer<typeof tipoArch>
export type TipologiaArch = z.infer<typeof tipologiaArch>
export type TabelleArch = z.infer<typeof tabelleArch>
export type PersonaArch = z.infer<typeof personaArch>
export type QuotaArch = z.infer<typeof quotaArch>
export type EventoArch = z.infer<typeof eventoArch>
export type Archivio = z.infer<typeof archivioSchema>

// ── Variazioni ───────────────────────────────────────────────
export interface CampoVar {
  campo: string
  etichetta: string
  prima: unknown
  dopo: unknown
  /** Il campo non si puo' accettare: perche'. */
  blocco?: string
}
export interface Variazione {
  sezione: Sezione
  entita: Entita
  chiave: string
  tipo: 'NUOVO' | 'MODIFICA' | 'CONFLITTO'
  /** Cambi di stato, passaggi di ID, avvisi: mai in «accetta tutte». */
  delicata: boolean
  /** Il record intero non si puo' accettare: perche'. */
  bloccata?: string
  etichetta: string
  campi: CampoVar[]
  avviso?: string
  /** Quel che serve per applicare (il record d'origine, gia' con le sedi tradotte). */
  record: unknown
}

/** Due valori uguali ai fini del confronto (array e oggetti per contenuto). */
export function uguale(a: unknown, b: unknown): boolean {
  return JSON.stringify(ordinato(a)) === JSON.stringify(ordinato(b))
}
function ordinato(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(ordinato)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map(k => [k, ordinato((v as Record<string, unknown>)[k])]))
  // '' e null valgono uguale: un campo vuoto e' un campo assente
  return v === '' || v === undefined ? null : v
}

/** Il valore attuale di un campo della persona, come lo confronta il motore. */
export function valorePersona(p: PersonaArch, campo: string): unknown {
  if (campo === 'stato' || campo === 'azioneStato') return statoDi(p)
  return (p as unknown as Record<string, unknown>)[campo] ?? null
}
export const nominativoDi = (p: { cognome: string; nome: string }): string => `${p.cognome} ${p.nome}`.trim()
/** Chiave del nominativo: maiuscole, accenti, apostrofi e ordine delle parole non contano. */
export const chiaveNome = (p: { cognome: string; nome: string }): string =>
  normalizza(nominativoDi(p)).split(' ').filter(Boolean).sort().join(' ')
const normTessera = (t: string) => t.trim().toLowerCase()

/** Stato e date che vanno insieme (i vincoli del db li vogliono coerenti). */
export function statoDi(p: PersonaArch) {
  return { stato: p.stato, cessatoIl: p.cessatoIl, eliminatoIl: p.eliminatoIl, statoPrima: p.statoPrima, riammissioni: p.riammissioni }
}
export type StatoComposto = ReturnType<typeof statoDi>

const ETICHETTE_PERSONA: Record<string, string> = {
  tipo: 'Tipologia', cognome: 'Cognome', nome: 'Nome', nascita: 'Data di nascita', email: 'Email', sede: 'Sede di consegna',
  tessera: 'Tessera', note: 'Note', atipico: 'Atipico', iscrittoIl: 'Iscritto il', exMatricola: 'Ex matricola',
  anniEsenti: 'Anni esenti dalla quota', legami: 'Familiare di', storicoTessere: 'Storico tessere', stato: 'Stato',
  azioneStato: 'Stato',
}

export interface EsitoConfronto {
  variazioni: Variazione[]
  sediTradotte: Record<string, string>
  /**
   * ID dell'archivio che qui sono di un'altra persona: le quote, le scelte
   * e i legami che li citano valgono solo se quella persona entra con un
   * nuovo ID (conflitto accettato); altrimenti si saltano.
   */
  daRimappare: string[]
}

/**
 * Confronta l'archivio `src` con i dati di qui `dst` (stesso formato,
 * tutte le sezioni) e produce le variazioni delle sezioni scelte.
 * `matricolePgs`: le matricole dell'anagrafica PGS di qui.
 */
export function confrontaArchivio(src: Archivio, dst: Archivio, sezioni: Sezione[], matricolePgs: Set<string>): EsitoConfronto {
  const vuole = (s: Sezione) => sezioni.includes(s) && src.sezioni.includes(s)
  const out: Variazione[] = []

  // ── Sedi: stesso codice = stessa sede; codice nuovo ma stesso nome = la sede di qui
  const sediDst = new Map((dst.sedi ?? []).map(s => [s.id, s]))
  const perNome = new Map((dst.sedi ?? []).map(s => [s.nome.trim().toLowerCase(), s.id]))
  const sediTradotte: Record<string, string> = {}
  const sediInArrivo = new Set<string>()
  for (const s of src.sedi ?? []) {
    if (sediDst.has(s.id)) { sediTradotte[s.id] = s.id; continue }
    const omonima = perNome.get(s.nome.trim().toLowerCase())
    if (omonima) { sediTradotte[s.id] = omonima; continue }
    sediTradotte[s.id] = s.id
    sediInArrivo.add(s.id)
  }
  const sedeQui = (id: string | null) => (id ? sediTradotte[id] ?? id : null)
  const sedeNota = (id: string | null) => !id || sediDst.has(id) || (vuole('sedi') && sediInArrivo.has(id))
  if (vuole('sedi')) {
    for (const s of src.sedi ?? []) {
      const d = sediDst.get(s.id)
      if (!d) {
        if (!sediInArrivo.has(s.id)) continue // tradotta su una sede di qui con lo stesso nome
        out.push({ sezione: 'sedi', entita: 'sede', chiave: s.id, tipo: 'NUOVO', delicata: false, etichetta: s.nome,
          campi: [{ campo: 'nome', etichetta: 'Nome', prima: null, dopo: s.nome }], record: s })
        continue
      }
      const campi: CampoVar[] = []
      if (s.nome !== d.nome) {
        const altra = perNome.get(s.nome.trim().toLowerCase())
        campi.push({ campo: 'nome', etichetta: 'Nome', prima: d.nome, dopo: s.nome, ...(altra && altra !== d.id ? { blocco: `nome già usato dalla sede ${altra}` } : {}) })
      }
      if (s.attiva !== d.attiva) campi.push({ campo: 'attiva', etichetta: 'Attiva', prima: d.attiva, dopo: s.attiva })
      if (campi.length) out.push({ sezione: 'sedi', entita: 'sede', chiave: s.id, tipo: 'MODIFICA', delicata: false, etichetta: d.nome, campi, record: s })
    }
  }

  // ── Tabelle: tipi di evento, tipologie di prodotto, tessera, importi della quota
  const tipiDst = new Map((dst.tabelle?.tipi ?? []).map(t => [t.id, t]))
  const tipiInArrivo = new Set<string>()
  const annoDst = new Map((dst.tabelle?.quoteAnno ?? []).map(a => [a.anno, a.importo]))
  const anniInArrivo = new Set<number>()
  if (vuole('tabelle') && src.tabelle) {
    for (const t of src.tabelle.tipi) {
      const d = tipiDst.get(t.id)
      if (!d) { tipiInArrivo.add(t.id); out.push({ sezione: 'tabelle', entita: 'tipo', chiave: t.id, tipo: 'NUOVO', delicata: false, etichetta: `Tipo di evento · ${t.nome}`, campi: [{ campo: 'nome', etichetta: 'Nome', prima: null, dopo: t.nome }], record: t }); continue }
      const campi = campiDiversi(d, t, { nome: 'Nome', colore: 'Colore', pagamento: 'A pagamento', modo: 'Modalità', attivo: 'Attivo' })
      if (campi.length) out.push({ sezione: 'tabelle', entita: 'tipo', chiave: t.id, tipo: 'MODIFICA', delicata: false, etichetta: `Tipo di evento · ${d.nome}`, campi, record: t })
    }
    const tipolDst = new Map((dst.tabelle?.tipologie ?? []).map(t => [t.id, t]))
    for (const t of src.tabelle.tipologie) {
      const d = tipolDst.get(t.id)
      if (!d) { out.push({ sezione: 'tabelle', entita: 'tipologia', chiave: t.id, tipo: 'NUOVO', delicata: false, etichetta: `Tipologia di prodotto · ${t.nome}`, campi: [{ campo: 'nome', etichetta: 'Nome', prima: null, dopo: t.nome }], record: t }); continue }
      const campi = campiDiversi(d, t, { nome: 'Nome', attiva: 'Attiva' })
      if (campi.length) out.push({ sezione: 'tabelle', entita: 'tipologia', chiave: t.id, tipo: 'MODIFICA', delicata: false, etichetta: `Tipologia di prodotto · ${d.nome}`, campi, record: t })
    }
    if (dst.tabelle) {
      const campi = campiDiversi(dst.tabelle.tessera, src.tabelle.tessera, {
        formato: 'Formato', prefisso: 'Prefisso', cifre: 'Cifre', riammissione: 'Riammissione', sepSuffisso: 'Separatore del suffisso', cifreSuffisso: 'Cifre del suffisso',
      })
      // cambiare il formato della tessera cambia i numeri futuri: si guarda uno per uno
      if (campi.length) out.push({ sezione: 'tabelle', entita: 'tessera', chiave: 'tessera', tipo: 'MODIFICA', delicata: true, etichetta: 'Formato della tessera', campi, record: src.tabelle.tessera })
    }
    for (const a of src.tabelle.quoteAnno) {
      const d = annoDst.get(a.anno)
      if (d === undefined) { anniInArrivo.add(a.anno); out.push({ sezione: 'tabelle', entita: 'quotaAnno', chiave: String(a.anno), tipo: 'NUOVO', delicata: false, etichetta: `Quota associativa ${a.anno}`, campi: [{ campo: 'importo', etichetta: 'Importo', prima: null, dopo: a.importo }], record: a }) }
      else if (d !== a.importo) out.push({ sezione: 'tabelle', entita: 'quotaAnno', chiave: String(a.anno), tipo: 'MODIFICA', delicata: false, etichetta: `Quota associativa ${a.anno}`, campi: [{ campo: 'importo', etichetta: 'Importo', prima: d, dopo: a.importo }], record: a })
    }
  }

  // ── Persone
  const pDst = new Map((dst.soci ?? []).map(p => [p.id, p]))
  const pSrc = new Map((src.soci ?? []).map(p => [p.id, p]))
  const exDst = new Map((dst.soci ?? []).filter(p => p.exMatricola).map(p => [p.exMatricola!, p]))
  const tessereDst = new Map((dst.soci ?? []).filter(p => p.tessera).map(p => [normTessera(p.tessera), p]))
  const nomiDst = new Map<string, PersonaArch[]>()
  for (const p of dst.soci ?? []) { const k = chiaveNome(p); nomiDst.set(k, [...(nomiDst.get(k) ?? []), p]) }
  const conFamiliari = new Set((dst.soci ?? []).flatMap(p => p.legami.map(l => l.socio)))
  // Chi e' qui ogni persona dell'archivio: la stessa (stesso ID), nuova (ID libero),
  // con l'ID gia' di un'altra persona (entra con un nuovo ID) o bloccata.
  const identita = new Map<string, 'stessa' | 'nuova' | 'altroId' | 'bloccata'>()
  for (const s of src.soci ?? []) {
    const d = pDst.get(s.id)
    if (d) identita.set(s.id, stessaPersona(s, d) ? 'stessa' : 'altroId')
    else identita.set(s.id, (s.matricola && exDst.has(s.matricola)) || (s.exMatricola && pDst.has(s.exMatricola)) ? 'bloccata' : 'nuova')
  }
  /** Una persona citata dall'archivio (in quote, scelte, legami) che dopo l'import c'e' qui. */
  const personaNota = (id: string) => {
    const e = identita.get(id)
    if (!e) return pDst.has(id)
    return e === 'stessa' || (e !== 'bloccata' && vuole('soci'))
  }
  /** Perché una persona citata non c'è: per i messaggi di quote ed eventi. */
  const perche = (id: string) => {
    const e = identita.get(id)
    return e === 'bloccata' ? `la persona ${id} è bloccata nella sezione Soci` : e === 'altroId' ? `qui l'ID ${id} è di un'altra persona: si importa solo con la sezione Soci (nuovo ID)`
      : 'la persona non c\'è qui e non arriva con la sezione Soci'
  }
  if (vuole('soci')) {
    // prima soci ed esterni, poi i familiari (che si legano ai soci)
    const ordinati = [...(src.soci ?? [])].sort((a, b) => Number(a.tipo === 'FAM') - Number(b.tipo === 'FAM'))
    for (const s0 of ordinati) {
      const s: PersonaArch = { ...s0, sede: sedeQui(s0.sede) }
      const d = pDst.get(s.id)
      if (d && identita.get(s.id) === 'stessa') {
        const v = confrontaPersona(s, d, { sedeNota, tessereDst, conFamiliari, personaNota, matricolePgs })
        if (v) out.push(v)
        continue
      }
      const v = nuovaPersona(s, d, { sedeNota, tessereDst, exDst, pDst, nomiDst, personaNota, matricolePgs })
      if (v.bloccata) identita.set(s.id, 'bloccata')
      out.push(v)
    }
  }

  // ── Quote dei soci
  if (vuole('quote')) {
    const qDst = new Map((dst.quote ?? []).map(q => [`${q.anno}|${q.socio}`, q]))
    const annoNoto = (a: number) => annoDst.has(a) || anniInArrivo.has(a)
    for (const q of src.quote ?? []) {
      const chi = pSrc.get(q.socio) ?? pDst.get(q.socio)
      const etichetta = `${q.anno} · ${chi ? nominativoDi(chi) : q.socio}`
      const bloccata = !personaNota(q.socio) ? perche(q.socio) : !annoNoto(q.anno) ? `l'anno ${q.anno} non è impostato qui (sezione Parametri e tabelle)` : undefined
      const d = qDst.get(`${q.anno}|${q.socio}`)
      if (!d) {
        out.push({ sezione: 'quote', entita: 'quota', chiave: `${q.anno}|${q.socio}`, tipo: 'NUOVO', delicata: false, etichetta, ...(bloccata ? { bloccata } : {}),
          campi: [{ campo: 'modo', etichetta: 'Modalità', prima: null, dopo: q.modo }, { campo: 'mesi', etichetta: 'Mesi pagati', prima: null, dopo: q.mesi }, { campo: 'pagataIl', etichetta: 'Pagata il', prima: null, dopo: q.pagataIl }], record: q })
        continue
      }
      const campi: CampoVar[] = []
      if (q.modo !== d.modo) campi.push({ campo: 'modo', etichetta: 'Modalità', prima: d.modo, dopo: q.modo })
      // un mese pagato qui resta pagato: si aggiungono solo i mesi in piu'
      const mesi = d.mesi.map((m, k) => m || !!q.mesi[k])
      if (!uguale(mesi, d.mesi)) campi.push({ campo: 'mesi', etichetta: 'Mesi pagati', prima: d.mesi, dopo: mesi })
      if (q.pagataIl && q.pagataIl !== d.pagataIl) campi.push({ campo: 'pagataIl', etichetta: 'Pagata il', prima: d.pagataIl, dopo: q.pagataIl })
      if (q.note && q.note !== d.note) campi.push({ campo: 'note', etichetta: 'Note', prima: d.note, dopo: q.note })
      if (campi.length) out.push({ sezione: 'quote', entita: 'quota', chiave: `${q.anno}|${q.socio}`, tipo: 'MODIFICA', delicata: false, etichetta, campi, record: { ...q, mesi } })
    }
  }

  // ── Eventi (con partecipanti, scelte, carichi e richieste)
  if (vuole('eventi')) {
    const eDst = new Map((dst.eventi ?? []).map(e => [e.id, e]))
    const tipoNoto = (t: string) => tipiDst.has(t) || tipiInArrivo.has(t)
    for (const e0 of src.eventi ?? []) {
      const e: EventoArch = { ...e0, sedi: e0.sedi.map(x => sedeQui(x) ?? x) }
      const d = eDst.get(e.id)
      out.push(...(d ? confrontaEvento(e, d, personaNota) : [nuovoEvento(e, tipoNoto, personaNota)]))
    }
  }
  return { variazioni: out.map(conBlocchi), sediTradotte, daRimappare: [...identita].filter(([, e]) => e === 'altroId').map(([id]) => id) }
}

/** Una modifica con tutti i campi bloccati non si puo' accettare: si blocca intera (e non tiene aperto il lotto). */
function conBlocchi(v: Variazione): Variazione {
  if (v.tipo !== 'MODIFICA' || v.bloccata || !v.campi.length || v.campi.some(c => !c.blocco)) return v
  return { ...v, bloccata: [...new Set(v.campi.map(c => `${c.etichetta}: ${c.blocco}`))].join(' · ') }
}

/** Stesso ID: e' la stessa persona se ha la matricola, o stesso nominativo, o stessa data di nascita. */
function stessaPersona(s: PersonaArch, d: PersonaArch): boolean {
  return !!(s.matricola || d.matricola || chiaveNome(s) === chiaveNome(d) || (s.nascita && s.nascita === d.nascita))
}

function campiDiversi<T extends Record<string, unknown>>(d: T, s: T, etichette: Record<string, string>): CampoVar[] {
  return Object.entries(etichette).filter(([k]) => !uguale(d[k], s[k])).map(([k, etichetta]) => ({ campo: k, etichetta, prima: d[k] ?? null, dopo: s[k] ?? null }))
}

interface CtxPersona {
  sedeNota: (id: string | null) => boolean
  tessereDst: Map<string, PersonaArch>
  personaNota: (id: string) => boolean
  matricolePgs: Set<string>
}

/** Tipologie ammesse per chi ha (o non ha) la matricola: le stesse regole della scheda. */
export function tipiAmmessi(p: Pick<PersonaArch, 'tipo' | 'matricola'>): string[] {
  return p.tipo === 'FAM' ? ['FAM'] : p.matricola ? ['SD', 'EST'] : ['SE', 'EST']
}

function confrontaPersona(s: PersonaArch, d: PersonaArch, c: CtxPersona & { conFamiliari: Set<string> }): Variazione | null {
  const campi: CampoVar[] = []
  const add = (campo: string, prima: unknown, dopo: unknown, blocco?: string) => {
    if (!uguale(prima, dopo)) campi.push({ campo, etichetta: ETICHETTE_PERSONA[campo] ?? campo, prima: prima ?? null, dopo: dopo ?? null, ...(blocco ? { blocco } : {}) })
  }
  if (s.tipo !== d.tipo) {
    const blocco = !tipiAmmessi(d).includes(s.tipo) ? 'tipologia non compatibile con la matricola'
      : s.tipo === 'EST' && c.conFamiliari.has(d.id) ? 'ha familiari collegati: un esterno non può averne' : undefined
    add('tipo', d.tipo, s.tipo, blocco)
  }
  // un valore vuoto nell'archivio non svuota quello di qui
  if (s.cognome && s.cognome !== d.cognome) add('cognome', d.cognome, s.cognome, d.matricola ? 'viene dall\'anagrafica PGS' : undefined)
  if (s.nome && s.nome !== d.nome) add('nome', d.nome, s.nome, d.matricola ? 'viene dall\'anagrafica PGS' : undefined)
  if (s.nascita && s.nascita !== d.nascita) add('nascita', d.nascita, s.nascita)
  if (s.email && s.email !== d.email) add('email', d.email, s.email)
  if (s.sede && s.sede !== d.sede) add('sede', d.sede, s.sede, c.sedeNota(s.sede) ? undefined : `la sede ${s.sede} non c'è qui (sezione Sedi)`)
  if (s.tessera && s.tessera !== d.tessera) {
    const altro = c.tessereDst.get(normTessera(s.tessera))
    const tipoFinale = s.tipo
    add('tessera', d.tessera, s.tessera, altro && altro.id !== d.id ? `tessera già di ${nominativoDi(altro)} (${altro.id})` : tipoFinale !== 'SD' && tipoFinale !== 'SE' ? 'solo i soci hanno la tessera' : undefined)
  }
  if (s.note && s.note !== d.note) add('note', d.note, s.note)
  if (s.atipico !== d.atipico) add('atipico', d.atipico, s.atipico)
  if (s.iscrittoIl !== d.iscrittoIl) add('iscrittoIl', d.iscrittoIl, s.iscrittoIl)
  if (s.exMatricola && s.exMatricola !== d.exMatricola) add('exMatricola', d.exMatricola, s.exMatricola, d.matricola ? 'ha ancora la matricola' : undefined)
  const anni = [...new Set([...d.anniEsenti, ...s.anniEsenti])].sort()
  if (anni.length !== d.anniEsenti.length) add('anniEsenti', d.anniEsenti, anni)
  if (d.tipo === 'FAM') {
    const nuovi = s.legami.filter(l => !d.legami.some(x => x.socio === l.socio) && c.personaNota(l.socio))
    if (nuovi.length) add('legami', d.legami, [...d.legami, ...nuovi])
  }
  const sto = [...d.storicoTessere]
  for (const t of s.storicoTessere) if (!sto.some(x => x.tessera === t.tessera && x.al === t.al)) sto.push(t)
  if (sto.length !== d.storicoTessere.length) add('storicoTessere', d.storicoTessere, sto)
  if (!uguale(statoDi(s), statoDi(d))) add('stato', statoDi(d), statoDi(s))
  if (!campi.length) return null
  return {
    sezione: 'soci', entita: 'persona', chiave: d.id, tipo: 'MODIFICA',
    delicata: campi.some(x => x.campo === 'stato' || x.campo === 'tipo'), etichetta: nominativoDi(d), campi, record: s,
  }
}

function nuovaPersona(
  s: PersonaArch, occupato: PersonaArch | undefined,
  c: CtxPersona & { exDst: Map<string, PersonaArch>; pDst: Map<string, PersonaArch>; nomiDst: Map<string, PersonaArch[]> },
): Variazione {
  const campi: CampoVar[] = [
    { campo: 'tipo', etichetta: 'Tipologia', prima: null, dopo: s.tipo },
    { campo: 'stato', etichetta: 'Stato', prima: null, dopo: statoDi(s) },
  ]
  if (s.nascita) campi.push({ campo: 'nascita', etichetta: 'Data di nascita', prima: null, dopo: s.nascita })
  if (s.sede) campi.push({ campo: 'sede', etichetta: 'Sede di consegna', prima: null, dopo: s.sede, ...(c.sedeNota(s.sede) ? {} : { blocco: `la sede ${s.sede} non c'è qui: entra senza sede` }) })
  if (s.tessera) {
    const altro = c.tessereDst.get(normTessera(s.tessera))
    campi.push({ campo: 'tessera', etichetta: 'Tessera', prima: null, dopo: s.tessera, ...(altro ? { blocco: `tessera già di ${nominativoDi(altro)} (${altro.id}): entra senza tessera` } : {}) })
  }
  const base = { sezione: 'soci' as const, entita: 'persona' as const, chiave: s.id, etichetta: nominativoDi(s), campi, record: s }
  if (s.tipo === 'FAM') {
    const legami = s.legami.filter(l => c.personaNota(l.socio))
    if (!legami.length) return { ...base, tipo: 'NUOVO', delicata: false, bloccata: 'nessuno dei suoi soci c\'è qui o nell\'archivio' }
    if (legami.length < s.legami.length) campi.push({ campo: 'legami', etichetta: 'Familiare di', prima: null, dopo: legami, blocco: `${s.legami.length - legami.length} soci collegati non ci sono qui` })
  }
  if (s.matricola) {
    const passato = c.exDst.get(s.matricola)
    if (passato) return { ...base, tipo: 'CONFLITTO', delicata: true, bloccata: `qui la matricola ${s.matricola} è passata a socio esterno (${passato.id}, ${nominativoDi(passato)})` }
  }
  if (s.exMatricola) {
    const ancora = c.pDst.get(s.exMatricola)
    if (ancora) return { ...base, tipo: 'CONFLITTO', delicata: true, bloccata: `qui è ancora socio dipendente con la matricola ${s.exMatricola}: fai il passaggio a socio esterno dalla sua scheda, poi reimporta` }
  }
  if (occupato) {
    return { ...base, tipo: 'CONFLITTO', delicata: true,
      avviso: `L'ID ${s.id} qui è già di ${nominativoDi(occupato)}: se accetti entra con un nuovo ID, e le sue quote e scelte lo seguono.` }
  }
  const avvisi: string[] = []
  if (s.matricola && !c.matricolePgs.has(s.matricola)) avvisi.push(`La matricola ${s.matricola} non è nell'anagrafica PGS di qui.`)
  const omonimi = (c.nomiDst.get(chiaveNome(s)) ?? []).filter(p => p.id !== s.id && (!s.nascita || !p.nascita || p.nascita === s.nascita))
  if (omonimi.length) avvisi.push(`Forse è già qui: ${omonimi.map(p => `${p.id} ${nominativoDi(p)}`).join(', ')}. Se è la stessa persona, scartala.`)
  return { ...base, tipo: 'NUOVO', delicata: avvisi.length > 0, ...(avvisi.length ? { avviso: avvisi.join(' ') } : {}) }
}

/** Le scelte valide per la config: le altre si contano e si lasciano fuori. */
function scelteValide(e: Pick<EventoArch, 'scelte' | 'config'>): EventoArch['scelte'] {
  return e.scelte.filter(x => !erroreDati(x.dati, e.config as ConfigEvento))
}

function nuovoEvento(e: EventoArch, tipoNoto: (t: string) => boolean, personaNota: (id: string) => boolean): Variazione {
  const part = e.partecipanti.filter(personaNota)
  const sce = scelteValide(e).filter(x => personaNota(x.socio))
  const ric = e.richieste.filter(r => personaNota(r.persona))
  const fuori = e.partecipanti.length - part.length + e.scelte.length - sce.length + e.richieste.length - ric.length
  const err = erroreIniziativa(e)
  const bloccata = !tipoNoto(e.tipo) ? `il tipo di evento ${e.tipo} non c'è qui (sezione Parametri e tabelle)` : err ? `configurazione non valida (${err})` : undefined
  return {
    sezione: 'eventi', entita: 'evento', chiave: e.id, tipo: 'NUOVO', delicata: false, ...(bloccata ? { bloccata } : {}),
    etichetta: `${e.titolo} (${e.anno})`,
    campi: [
      { campo: 'data', etichetta: 'Data', prima: null, dopo: e.data },
      { campo: 'partecipanti', etichetta: 'Partecipanti singoli', prima: null, dopo: part.length },
      { campo: 'scelte', etichetta: 'Scelte e ordini', prima: null, dopo: sce.length },
      { campo: 'carichi', etichetta: 'Carichi di magazzino', prima: null, dopo: e.carichi.length },
      { campo: 'richieste', etichetta: 'Richieste di biglietti', prima: null, dopo: ric.length },
    ],
    ...(fuori ? { avviso: `${fuori} righe (partecipanti, scelte o richieste) riguardano persone che non ci sono qui né nell'archivio, o dati non validi: restano fuori.` } : {}),
    record: { ...e, partecipanti: part, scelte: sce, richieste: ric },
  }
}

const CAMPI_EVENTO: Record<string, string> = {
  titolo: 'Titolo', anno: 'Anno', data: 'Data', scadenza: 'Scadenza', stato: 'Stato della raccolta', modalita: 'Modalità', modoPart: 'Partecipanti',
  gruppi: 'Gruppi', sedi: 'Sedi', predefinita: 'Scelta predefinita', fornitore: 'Fornitore', pagamento: 'Pagamento', note: 'Note',
  quota: 'Quota', archiviata: 'Archiviato',
}

function confrontaEvento(e: EventoArch, d: EventoArch, personaNota: (id: string) => boolean): Variazione[] {
  const campi = campiDiversi(d as unknown as Record<string, unknown>, e as unknown as Record<string, unknown>, CAMPI_EVENTO)
  const dati = d.scelte.length || d.richieste.length || d.carichi.length
  for (const c of campi) if (c.campo === 'modalita' && dati) c.blocco = 'qui ci sono già scelte o movimenti'
  if (!uguale(d.config, e.config)) {
    const usati = usiDi(d)
    const tolto = usiTolti(e.config as ConfigEvento, usati)
    campi.push({ campo: 'config', etichetta: 'Configurazione (opzioni, prodotti, settimane, articoli, sconti)', prima: riassuntoConfig(d.config as ConfigEvento), dopo: riassuntoConfig(e.config as ConfigEvento), ...(tolto ? { blocco: `toglierebbe elementi già usati qui (${tolto})` } : {}) })
  }
  // sotto-elenchi: solo aggiunte (partecipanti, carichi) e scelte/richieste nuove o diverse
  const part = e.partecipanti.filter(p => !d.partecipanti.includes(p) && personaNota(p))
  if (part.length) campi.push({ campo: 'partecipanti', etichetta: 'Partecipanti singoli', prima: d.partecipanti.length, dopo: d.partecipanti.length + part.length })
  const scD = new Map(d.scelte.map(x => [x.socio, x]))
  const sce = scelteValide(e).filter(x => personaNota(x.socio) && !uguale(scD.get(x.socio)?.dati, x.dati))
  if (sce.length) campi.push({ campo: 'scelte', etichetta: 'Scelte e ordini', prima: `${d.scelte.length}`, dopo: `${sce.filter(x => !scD.has(x.socio)).length} nuove, ${sce.filter(x => scD.has(x.socio)).length} diverse` })
  const carD = new Set(d.carichi.map(c => c.id))
  const car = e.carichi.filter(c => !carD.has(c.id))
  if (car.length) campi.push({ campo: 'carichi', etichetta: 'Carichi di magazzino', prima: d.carichi.length, dopo: d.carichi.length + car.length })
  const ricD = new Map(d.richieste.map(r => [r.id, r]))
  const ric = e.richieste.filter(r => personaNota(r.persona) && !uguale(ricD.get(r.id), r))
  if (ric.length) campi.push({ campo: 'richieste', etichetta: 'Richieste di biglietti', prima: `${d.richieste.length}`, dopo: `${ric.filter(r => !ricD.has(r.id)).length} nuove, ${ric.filter(r => ricD.has(r.id)).length} diverse` })
  if (!campi.length) return []
  const unito = { ...d, ...Object.fromEntries(campi.filter(c => c.campo in CAMPI_EVENTO).map(c => [c.campo, (e as Record<string, unknown>)[c.campo]])), config: e.config }
  const err = erroreIniziativa(unito as EventoArch)
  return [{
    sezione: 'eventi', entita: 'evento', chiave: d.id, tipo: 'MODIFICA', delicata: false, etichetta: `${d.titolo} (${d.anno})`, campi,
    ...(err ? { bloccata: `il risultato non sarebbe valido (${err})` } : {}),
    record: { ...e, partecipanti: part, scelte: sce, carichi: car, richieste: ric },
  }]
}

function usiDi(e: EventoArch) {
  const opz = new Set<string>(), prodotti = new Set<string>(), periodi = new Set<string>()
  for (const { dati } of e.scelte) {
    if (dati.opz) opz.add(dati.opz)
    for (const [k, n] of Object.entries(dati.q ?? {})) if (n > 0) prodotti.add(k)
    for (const [k, v] of Object.entries(dati.per ?? {})) if (v) periodi.add(k)
  }
  return { opz, prodotti, periodi, articoli: new Set([...e.carichi, ...e.richieste].map(x => x.art)) }
}
const riassuntoConfig = (c: ConfigEvento): string =>
  [`${c.opzioni.length} opzioni`, `${c.prodotti.length} prodotti`, `${c.periodi.length} settimane`, `${c.articoli.length} articoli`, `${Object.keys(c.sconti).length} sconti`].join(', ')

// ── T6: aggiornamento massivo da Excel ───────────────────────
export const AZIONI_STATO = ['cessa', 'elimina', 'ripristina', 'riattiva'] as const
export type AzioneStato = typeof AZIONI_STATO[number]
export const rigaT6Schema = z.object({
  socio: ID_PERSONA,
  /** Riga del file, per i messaggi. */
  riga: z.number().int().min(0).max(1_000_000),
  /** null = svuota il campo («-» nel file); assente = non cambia. */
  valori: z.object({
    sede: ID_SEDE.nullable().optional(),
    nascita: DATA.nullable().optional(),
    email: z.string().trim().max(254).refine(s => /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[A-Za-z]{2,}$/.test(s), 'email').nullable().optional(),
    tessera: TESSERA.min(1).nullable().optional(),
    note: riga(1000).nullable().optional(),
    tipo: z.enum(['SD', 'SE', 'EST']).optional(),
    stato: z.enum(['ATTIVO', 'CESSATO', 'ELIMINATO']).optional(),
    dataStato: DATA.optional(),
  }).strict(),
})
export type RigaT6 = z.infer<typeof rigaT6Schema>

/**
 * Variazioni del T6 sulle persone di qui. `nascitaPgs`: data di nascita
 * dell'anagrafica PGS per matricola. Regola (29/10): la data di nascita di
 * chi ha la matricola si scrive solo se in PGS manca; se c'e' ed e'
 * diversa si segnala e non si sovrascrive.
 */
export function confrontaT6(righe: RigaT6[], soci: PersonaArch[], sedi: Set<string>, nascitaPgs: Map<string, string | null>, oggi: string): Variazione[] {
  const perId = new Map(soci.map(p => [p.id, p]))
  const tessere = new Map(soci.filter(p => p.tessera).map(p => [normTessera(p.tessera), p]))
  const conFamiliari = new Set(soci.flatMap(p => p.legami.map(l => l.socio)))
  const tessereNelFile = new Map<string, number>()
  for (const r of righe) if (r.valori.tessera) { const k = normTessera(r.valori.tessera); tessereNelFile.set(k, (tessereNelFile.get(k) ?? 0) + 1) }
  const out: Variazione[] = []
  const viste = new Set<string>()
  for (const r of righe) {
    const d = perId.get(r.socio)
    if (!d || viste.has(r.socio)) continue
    viste.add(r.socio)
    const v = r.valori
    const campi: CampoVar[] = []
    const add = (campo: string, prima: unknown, dopo: unknown, blocco?: string) => {
      if (!uguale(prima, dopo)) campi.push({ campo, etichetta: ETICHETTE_PERSONA[campo] ?? campo, prima: prima ?? null, dopo: dopo ?? null, ...(blocco ? { blocco } : {}) })
    }
    const tipo = v.tipo ?? d.tipo
    if (v.tipo && v.tipo !== d.tipo) {
      add('tipo', d.tipo, v.tipo, !tipiAmmessi(d).includes(v.tipo) ? (d.matricola ? 'con la matricola: socio dipendente o esterno' : 'senza matricola: socio esterno o esterno')
        : v.tipo === 'EST' && conFamiliari.has(d.id) ? 'ha familiari collegati: un esterno non può averne' : undefined)
    }
    if (v.sede !== undefined) add('sede', d.sede, v.sede, v.sede && !sedi.has(v.sede) ? `sede ${v.sede} sconosciuta` : undefined)
    if (v.nascita !== undefined) {
      const pgs = d.matricola ? nascitaPgs.get(d.matricola) ?? null : null
      add('nascita', d.nascita, v.nascita, pgs && pgs !== v.nascita ? `in PGS è ${pgs.split('-').reverse().join('/')}: non si sovrascrive` : undefined)
    }
    if (v.email !== undefined) add('email', d.email || null, v.email)
    if (v.tessera !== undefined) {
      const altro = v.tessera ? tessere.get(normTessera(v.tessera)) : undefined
      add('tessera', d.tessera || null, v.tessera, tipo !== 'SD' && tipo !== 'SE' && v.tessera ? 'solo i soci hanno la tessera'
        : altro && altro.id !== d.id ? `tessera già di ${nominativoDi(altro)} (${altro.id})`
          : v.tessera && (tessereNelFile.get(normTessera(v.tessera)) ?? 0) > 1 ? 'tessera ripetuta nel file' : undefined)
    }
    if (v.note !== undefined) add('note', d.note || null, v.note)
    if (v.stato) {
      const az = azioneStato(d, v.stato)
      if (az) {
        const dopo = { azione: 'azione' in az ? az.azione : null, data: v.dataStato ?? oggi, stato: v.stato }
        campi.push({ campo: 'azioneStato', etichetta: 'Stato', prima: statoDi(d), dopo, ...('blocco' in az ? { blocco: az.blocco } : {}) })
      }
    }
    if (campi.length) out.push({ sezione: 'soci', entita: 'persona', chiave: d.id, tipo: 'MODIFICA', delicata: campi.some(c => c.campo === 'azioneStato' || c.campo === 'tipo'), etichetta: `${nominativoDi(d)} · riga ${r.riga}`, campi, record: { id: d.id, riga: r.riga } })
  }
  return out.map(conBlocchi)
}

/** Dallo stato di qui allo stato chiesto dal file: quale azione, o perché no. null = gia' cosi'. */
export function azioneStato(d: Pick<PersonaArch, 'stato' | 'tipo' | 'statoPrima'>, voluto: 'ATTIVO' | 'CESSATO' | 'ELIMINATO'): { azione: AzioneStato } | { blocco: string } | null {
  if (d.stato === voluto) return null
  if (voluto === 'ELIMINATO') return { azione: 'elimina' }
  if (d.stato === 'ELIMINATO') {
    return d.statoPrima === voluto || voluto === 'ATTIVO' ? { azione: 'ripristina' } : { blocco: `si ripristina nello stato di prima (${d.statoPrima ?? '—'})` }
  }
  if (voluto === 'CESSATO') return d.stato === 'ATTIVO' ? { azione: 'cessa' } : { blocco: 'si cessa solo chi è attivo' }
  if (d.stato === 'CESSATO') return d.tipo === 'EST' || d.tipo === 'FAM' ? { azione: 'riattiva' } : { blocco: 'un socio cessato rientra con «Riammetti» dalla sua scheda (tessera)' }
  return { blocco: d.stato === 'DA_VALIDARE' ? 'si attiva validandolo in «Da validare»' : 'rifiutato: rimettilo in attesa e validalo' }
}

// ── Quota associativa: chi la deve ───────────────────────────
/**
 * Socio tenuto alla quota dell'anno (stessa regola del client): soci attivi
 * o cessati nell'anno; l'eliminato la deve solo per gli anni prima
 * dell'eliminazione; gli anni esenti (passati da eliminato) mai.
 */
export function tenutoQuota(p: Pick<PersonaArch, 'tipo' | 'stato' | 'statoPrima' | 'iscrittoIl' | 'cessatoIl' | 'eliminatoIl' | 'anniEsenti'>, anno: number): boolean {
  if (p.tipo !== 'SD' && p.tipo !== 'SE') return false
  if (p.anniEsenti.includes(anno)) return false
  if (p.iscrittoIl.slice(0, 10) > `${anno}-12-31`) return false
  const stato = p.stato === 'ELIMINATO' ? p.statoPrima : p.stato
  if (p.stato === 'ELIMINATO' && (!p.eliminatoIl || anno >= +p.eliminatoIl.slice(0, 4))) return false
  if (stato === 'ATTIVO') return true
  return stato === 'CESSATO' && (p.cessatoIl ?? '') >= `${anno}-01-01`
}

/** Anni esenti dopo un ripristino: dall'anno dell'eliminazione all'anno prima del ripristino. */
export function anniEsentiDopoRipristino(prima: number[], eliminatoIl: string, oggi: string): number[] {
  const da = +eliminatoIl.slice(0, 4), a = +oggi.slice(0, 4) - 1
  const anni = new Set(prima)
  for (let y = da; y <= a; y++) anni.add(y)
  return [...anni].sort((x, y) => x - y)
}

// ── Conteggi per il riepilogo e l'audit ──────────────────────
export function conteggi(vs: Array<Pick<Variazione, 'sezione' | 'tipo'>>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const v of vs) { const s = (out[v.sezione] ??= {}); s[v.tipo] = (s[v.tipo] ?? 0) + 1 }
  return out
}

// ── Dallo stato del db al formato dell'archivio ──────────────
export function archivioDaStato(st: CralStato, meta: { app: string; ambiente: string; esportato: string }, sezioni: readonly Sezione[]): Archivio {
  const ha = (s: Sezione) => sezioni.includes(s)
  const a: Archivio = { formato: FORMATO_ARCHIVIO, versione: 1, ...meta, sezioni: [...sezioni] }
  if (ha('sedi')) a.sedi = st.sedi.map(s => ({ id: s.id, nome: s.nome, attiva: s.attiva, ordine: s.ordine }))
  if (ha('tabelle')) a.tabelle = {
    tipi: st.tipi.map(t => ({ id: t.id, nome: t.nome, colore: t.colore, pagamento: t.pagamento, modo: t.modo as TipoArch['modo'], attivo: t.attivo, ordine: t.ordine })),
    tipologie: st.tipologie.map(t => ({ id: t.id, nome: t.nome, attiva: t.attiva, ordine: t.ordine })),
    tessera: st.parametri.tessera, extProssimo: st.parametri.extProssimo, famProssimo: st.parametri.famProssimo,
    quoteAnno: st.quoteAnno.map(q => ({ anno: q.anno, importo: q.importo })),
  }
  if (ha('soci')) a.soci = st.soci.map(personaDaRiga)
  if (ha('quote')) a.quote = Object.entries(st.quote).flatMap(([anno, perSocio]) =>
    Object.entries(perSocio).map(([socio, q]) => ({ anno: +anno, socio, modo: q.modo, mesi: q.mesi, pagataIl: q.pagataIl, note: q.note })))
  if (ha('eventi')) a.eventi = st.iniziative.map(i => ({
    id: i.id, tipo: i.tipo, titolo: i.titolo, anno: i.anno, data: i.data, scadenza: i.scadenza, stato: i.stato, modalita: i.modalita,
    modoPart: i.modoPart, gruppi: i.gruppi as EventoArch['gruppi'], sedi: i.sedi, predefinita: i.predefinita, fornitore: i.fornitore,
    pagamento: i.pagamento, note: i.note, quota: i.quota, config: i.config as EventoArch['config'],
    archiviata: i.archiviata, archiviataDa: i.archiviataDa, archiviataIl: i.archiviataIl, partecipanti: i.partecipanti,
    scelte: Object.entries(i.scelte).map(([socio, x]) => { const { fonte, ...dati } = x as Record<string, unknown>; return { socio, dati: dati as EventoArch['scelte'][number]['dati'], fonte: (fonte ?? 'manuale') as 'manuale' } }),
    carichi: i.carichi.map(c => ({ id: c.id, art: c.art, qta: c.qta, data: c.data, note: c.note })),
    richieste: i.richieste.map(r => ({ id: r.id, persona: r.persona, art: r.art, qta: r.qta, dataRich: r.dataRich, stato: r.stato, dataCons: r.dataCons, modo: r.modo, pagato: r.pagato, sconto: (r.sconto ?? null) as EventoArch['richieste'][number]['sconto'], note: r.note })),
  }))
  return a
}

export function personaDaRiga(s: CralSocioRow): PersonaArch {
  return {
    id: s.id, tipo: s.tipo, matricola: s.matricola, exMatricola: s.exMatricola, cognome: s.cognome, nome: s.nome, nascita: s.nascita,
    email: s.email, sede: s.sede, tessera: s.tessera, riammissioni: s.riammissioni, stato: s.stato, iscrittoIl: s.iscrittoIl,
    cessatoIl: s.cessatoIl, eliminatoIl: s.eliminatoIl, statoPrima: s.statoPrima, anniEsenti: s.anniEsenti, provenienza: s.provenienza,
    atipico: s.atipico, note: s.note, creatoDa: s.creatoDa, creatoIl: s.creatoIl, validatoDa: s.validatoDa, validatoIl: s.validatoIl,
    modificatoDa: s.modificatoDa, modificatoIl: s.modificatoIl, eliminatoDa: s.eliminatoDa, legami: s.legami, storicoTessere: s.storicoTessere,
  }
}

export type { ParametriTessera }
