// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL: telefono, consensi, esigenze alimentari
//
// Funzioni pure, senza I/O. La STESSA logica vive nel client
// (client/src/components/cral/contatti.ts): i due file vanno tenuti
// allineati, i test sono gli stessi.
//
// NUMERO. Si conserva nel formato delle API di WhatsApp (Cloud API):
//   · telefono  E.164 con il «+»            +393331234567
//   · waId      le sole cifre, senza «+»     393331234567
// Il waId di norma sono le cifre del numero; WhatsApp in alcuni Paesi lo
// restituisce diverso dal numero composto, per questo ha il suo campo.
// In Italia i fissi tengono lo 0 (+39 06…), i cellulari iniziano per 3.
//
// CONSENSI (GDPR). Due, distinti:
//   · uso del numero di telefono  NO | SI | REVOCATO, con data e origine;
//     dopo una revoca il «sì» torna solo con una nuova data di consenso.
//   · dati alimentari (dati relativi alla salute): senza consenso le
//     esigenze e le allergie NON si conservano.
// ============================================================

export const ESIGENZE = [
  { id: 'VEGETARIANO', nome: 'Vegetariano' },
  { id: 'VEGANO',      nome: 'Vegano' },
  { id: 'CELIACO',     nome: 'Celiaco (senza glutine)' },
  { id: 'LATTOSIO',    nome: 'Senza lattosio' },
] as const
export type Esigenza = typeof ESIGENZE[number]['id']
export const ID_ESIGENZE = ESIGENZE.map(e => e.id) as [Esigenza, ...Esigenza[]]

export const ORIGINI = [
  { id: 'CARTACEO', nome: 'Modulo cartaceo' },
  { id: 'ONLINE',   nome: 'Modulo online' },
  { id: 'EMAIL',    nome: 'Email' },
  { id: 'VOCE',     nome: 'A voce' },
] as const
export type Origine = typeof ORIGINI[number]['id']
export const ID_ORIGINI = ORIGINI.map(o => o.id) as [Origine, ...Origine[]]

export type Consenso = 'NO' | 'SI' | 'REVOCATO'
export type StatoWa = 'SI' | 'NO' | 'NV'

export interface Contatti {
  telefono: string; waId: string
  consenso: Consenso; consensoIl: string | null; origine: Origine | null; revocatoIl: string | null
  whatsapp: StatoWa; waIl: string | null; waFonte: 'MANO' | 'FILE' | null
}
export interface Alimentari { consenso: boolean; consensoIl: string | null; esigenze: Esigenza[]; allergie: string }

export const CONTATTI_VUOTI: Contatti = {
  telefono: '', waId: '', consenso: 'NO', consensoIl: null, origine: null, revocatoIl: null, whatsapp: 'NV', waIl: null, waFonte: null,
}
export const ALIMENTARI_VUOTI: Alimentari = { consenso: false, consensoIl: null, esigenze: [], allergie: '' }

export const E164 = /^\+[1-9]\d{6,14}$/
export const WA_ID = /^[1-9]\d{6,14}$/

export type TipoNumero = 'MOBILE' | 'FISSO' | 'ESTERO'
export type Telefono = { e164: string; waId: string; tipo: TipoNumero; avviso?: string }

/**
 * Legge un numero scritto a mano o in un file. '' = vuoto → null.
 * `prefisso`: prefisso internazionale da dare a chi non lo scrive (39).
 */
export function leggiTelefono(grezzo: unknown, prefisso = '39'): Telefono | { errore: string } | null {
  let s = String(grezzo ?? '').trim()
  if (!s || s === '-') return null
  // Excel: numeri diventati 3.331234567E9 o con «.0»
  if (/^\d+(\.\d+)?[eE]\+?\d+$/.test(s)) { const n = Number(s); if (Number.isFinite(n)) s = n.toFixed(0) }
  s = s.replace(/\.0$/, '').replace(/^(tel|cell|whatsapp|wa)[.:]?\s*/i, '')
  if (/[a-zA-Z]/.test(s)) return { errore: 'non è un numero' }
  const conPiu = s.startsWith('+') || s.replace(/[^\d]/g, '').startsWith('00') && /^\D*00/.test(s)
  let c = s.replace(/[^\d]/g, '')
  if (!c) return { errore: 'non è un numero' }
  if (conPiu) c = c.replace(/^00/, '')
  else if (prefisso === '39') {
    if (/^3\d{8,9}$/.test(c)) c = '39' + c                         // cellulare italiano
    else if (/^0\d{5,10}$/.test(c)) c = '39' + c                   // fisso italiano: lo 0 resta
    else if (/^39(3\d{8,9}|0\d{5,10})$/.test(c)) { /* già col prefisso */ }
    else return { errore: c.length < 9 ? 'numero troppo corto' : 'non è un numero italiano: scrivi il prefisso internazionale (es. +44…)' }
  } else if (!(c.startsWith(prefisso) && c.length >= prefisso.length + 8)) c = prefisso + c.replace(/^0+/, '')
  const e164 = '+' + c
  if (!E164.test(e164)) return { errore: 'numero non valido (da 7 a 15 cifre col prefisso)' }
  if (c.startsWith('39')) {
    const naz = c.slice(2)
    if (/^3\d{8,9}$/.test(naz)) return { e164, waId: c, tipo: 'MOBILE' }
    if (/^0\d{5,10}$/.test(naz)) return { e164, waId: c, tipo: 'FISSO', avviso: 'numero fisso: WhatsApp improbabile' }
    return { errore: 'numero italiano non valido (cellulare 3…, fisso 0…)' }
  }
  return { e164, waId: c, tipo: 'ESTERO' }
}

/** +393331234567 → «+39 333 123 4567» (solo per la lettura). */
export function mostraTelefono(e164: string): string {
  if (!e164) return ''
  if (e164.startsWith('+39')) {
    const n = e164.slice(3)
    if (n.startsWith('3')) return `+39 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`.trim()
    return `+39 ${n}`
  }
  return e164
}

const senzaAccenti = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** «sì», «si», «x», «1», «true», «ok» → true; «no», «0», «false» → false; altro → null. */
export function leggiSiNo(v: unknown): boolean | null {
  const s = senzaAccenti(String(v ?? ''))
  if (['si', 's', 'x', '1', 'true', 'vero', 'ok', 'yes', 'y'].includes(s)) return true
  if (['no', 'n', '0', 'false', 'falso'].includes(s)) return false
  return null
}
export function leggiConsenso(v: unknown): Consenso | null {
  const s = senzaAccenti(String(v ?? ''))
  if (s.startsWith('revoc') || s.startsWith('ritir')) return 'REVOCATO'
  const b = leggiSiNo(s)
  return b === null ? null : b ? 'SI' : 'NO'
}
export function leggiWhatsapp(v: unknown): StatoWa | null {
  const s = senzaAccenti(String(v ?? ''))
  if (s.startsWith('non verif') || s === 'nv' || s === '?') return 'NV'
  const b = leggiSiNo(s)
  return b === null ? null : b ? 'SI' : 'NO'
}
export function leggiOrigine(v: unknown): Origine | null {
  const s = senzaAccenti(String(v ?? ''))
  if (!s) return null
  if (s.includes('cart')) return 'CARTACEO'
  if (s.includes('online') || s.includes('web') || s.includes('form')) return 'ONLINE'
  if (s.includes('mail')) return 'EMAIL'
  if (s.includes('voce') || s.includes('telefon') || s.includes('verbal')) return 'VOCE'
  return null
}

/** «vegano, celiaco» → le voci dell'elenco; quello che non si riconosce torna in `ignote`. */
export function leggiEsigenze(testo: unknown): { esigenze: Esigenza[]; ignote: string[] } {
  const out = new Set<Esigenza>()
  const ignote: string[] = []
  for (const pezzo of String(testo ?? '').split(/[,;/|+\n]+/)) {
    const s = senzaAccenti(pezzo)
    if (!s || s === '-' || s === 'no' || s === 'nessuna' || s === 'nessuno') continue
    if (s.startsWith('vegetar')) out.add('VEGETARIANO')
    else if (s.startsWith('vegan') || s.startsWith('vegetal')) out.add('VEGANO')
    else if (s.includes('celia') || s.includes('glutin')) out.add('CELIACO')
    else if (s.includes('lattos') || s.includes('latte')) out.add('LATTOSIO')
    else ignote.push(pezzo.trim())
  }
  return { esigenze: ID_ESIGENZE.filter(e => out.has(e)), ignote }
}
export const nomiEsigenze = (e: readonly string[]) => ESIGENZE.filter(x => e.includes(x.id)).map(x => x.nome).join(', ')

export interface PatchContatti {
  /** E.164 già letto; '' toglie il numero. */
  telefono?: string
  waId?: string
  consenso?: Consenso; consensoIl?: string | null; origine?: Origine | null; revocatoIl?: string | null
  whatsapp?: StatoWa; waIl?: string | null
}
export type ErroreContatti = 'TELEFONO_NON_VALIDO' | 'TELEFONO_MANCANTE' | 'CONSENSO_REVOCATO' | 'DATA_NON_VALIDA'
export const MESSAGGI_CONTATTI: Record<ErroreContatti, string> = {
  TELEFONO_NON_VALIDO: 'numero di telefono non valido',
  TELEFONO_MANCANTE: 'consenso o WhatsApp senza un numero di telefono',
  CONSENSO_REVOCATO: 'consenso revocato: serve una nuova data di consenso, successiva alla revoca',
  DATA_NON_VALIDA: 'data nel futuro',
}

/**
 * I contatti dopo una modifica. Regole:
 *  · numero nuovo o tolto → consenso e WhatsApp ripartono da capo;
 *  · «sì»: data (oggi se manca) e origine; dopo una revoca la data deve
 *    essere data esplicitamente da file, e mai precedente alla revoca;
 *  · «no» su un consenso dato = revoca (resta la traccia);
 *  · WhatsApp sì/no: data e fonte della verifica.
 */
export function contattiDopo(prima: Contatti, p: PatchContatti, oggi: string, fonte: 'MANO' | 'FILE'): Contatti | { errore: ErroreContatti } {
  let c: Contatti = { ...prima }
  if (p.telefono !== undefined && p.telefono !== prima.telefono) {
    if (p.telefono && !E164.test(p.telefono)) return { errore: 'TELEFONO_NON_VALIDO' }
    c = { ...CONTATTI_VUOTI, telefono: p.telefono, waId: p.telefono.slice(1) }
  }
  if (!c.telefono) {
    if (p.consenso === 'SI' || p.whatsapp === 'SI') return { errore: 'TELEFONO_MANCANTE' }
    return { ...CONTATTI_VUOTI }
  }
  if (p.waId !== undefined) {
    if (p.waId && !WA_ID.test(p.waId)) return { errore: 'TELEFONO_NON_VALIDO' }
    c.waId = p.waId || c.telefono.slice(1)
  }
  if ([p.consensoIl, p.revocatoIl, p.waIl].some(d => d && d > oggi)) return { errore: 'DATA_NON_VALIDA' }
  if (p.consenso === 'SI') {
    const il = p.consensoIl ?? (c.consenso === 'SI' ? c.consensoIl : c.consenso === 'REVOCATO' && fonte === 'FILE' ? null : oggi)
    if (!il || (c.revocatoIl && il < c.revocatoIl)) return { errore: 'CONSENSO_REVOCATO' }
    c = { ...c, consenso: 'SI', consensoIl: il, origine: p.origine !== undefined ? p.origine : c.consenso === 'SI' ? c.origine : null, revocatoIl: null }
  } else if (p.consenso === 'REVOCATO' || (p.consenso === 'NO' && c.consenso !== 'NO')) {
    if (c.consenso !== 'REVOCATO' || p.revocatoIl) c = { ...c, consenso: 'REVOCATO', revocatoIl: p.revocatoIl ?? oggi }
  } else if (p.consenso === undefined && c.consenso === 'SI') {
    if (p.consensoIl) c.consensoIl = p.consensoIl
    if (p.origine !== undefined) c.origine = p.origine
  }
  if (p.whatsapp !== undefined && (p.whatsapp !== c.whatsapp || p.waIl)) {
    c = p.whatsapp === 'NV' ? { ...c, whatsapp: 'NV', waIl: null, waFonte: null }
      : { ...c, whatsapp: p.whatsapp, waIl: p.waIl ?? oggi, waFonte: fonte }
  }
  return c
}

export interface PatchAlimentari { consenso?: boolean; consensoIl?: string | null; esigenze?: Esigenza[]; allergie?: string }
/** Senza consenso non resta nulla; col consenso la data (oggi se manca). */
export function alimentariDopo(prima: Alimentari, p: PatchAlimentari, oggi: string): Alimentari {
  const consenso = p.consenso ?? prima.consenso
  if (!consenso) return { ...ALIMENTARI_VUOTI }
  return {
    consenso: true, consensoIl: p.consensoIl ?? prima.consensoIl ?? oggi,
    esigenze: ID_ESIGENZE.filter(e => (p.esigenze ?? prima.esigenze).includes(e)),
    allergie: (p.allergie ?? prima.allergie).trim().slice(0, 300),
  }
}

/** Si può usare il numero per contattarlo. */
export const contattabile = (c: Contatti) => !!c.telefono && c.consenso === 'SI'
/** Va in una lista WhatsApp: consenso valido e WhatsApp non escluso. */
export const perWhatsapp = (c: Contatti) => contattabile(c) && c.whatsapp !== 'NO'

/** Una riga leggibile dei contatti (variazioni, schede). Mai nell'audit. */
export function riassuntoContatti(c: Contatti | null | undefined): string {
  if (!c || !c.telefono) return '—'
  const d = (x: string | null) => (x ? x.split('-').reverse().join('/') : '')
  const cons = c.consenso === 'SI' ? `consenso sì${c.consensoIl ? ` dal ${d(c.consensoIl)}` : ''}${c.origine ? ` (${ORIGINI.find(o => o.id === c.origine)?.nome.toLowerCase()})` : ''}`
    : c.consenso === 'REVOCATO' ? `consenso revocato${c.revocatoIl ? ` il ${d(c.revocatoIl)}` : ''}` : 'senza consenso'
  const wa = c.whatsapp === 'SI' ? 'WhatsApp sì' : c.whatsapp === 'NO' ? 'WhatsApp no' : 'WhatsApp non verificato'
  return `${mostraTelefono(c.telefono)} · ${cons} · ${wa}${c.waId && c.waId !== c.telefono.slice(1) ? ` (wa_id ${c.waId})` : ''}`
}
export function riassuntoAlimentari(a: Alimentari | null | undefined): string {
  if (!a || !a.consenso) return '—'
  return [nomiEsigenze(a.esigenze), a.allergie ? `allergie: ${a.allergie}` : ''].filter(Boolean).join(' · ') || 'nessuna esigenza (consenso dato)'
}
