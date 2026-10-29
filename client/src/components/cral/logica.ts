// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · regole pure del client
//
// Conti, partecipanti, sconti, turni, magazzino e quote. Nessun React,
// nessuna rete: si provano da sole (logica.test.ts). Importi sempre in
// centesimi interi.
// ============================================================

import type {
  CatSconto, Db, Iniziativa, Modalita, ParametriTessera, Persona, Prodotto, Relazione, Richiesta,
  ScontoPers, ScontoRegola, StatoPeriodo, TipoPersona, QuotaSocio,
} from './tipi.ts'

// ── Testo e date ─────────────────────────────────────────────
export const norm = (s: unknown): string => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  .replace(/[^A-Z0-9' @._-]/g, ' ').replace(/\s+/g, ' ').trim()
export const oggi = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const fmtData = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')
export const ggmm = (iso: string): string => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '')
/** Età compiuta in anni alla data `al` (ISO). Vuota se manca la data di nascita. */
export function eta(nascita: string | null | undefined, al: string = oggi()): number | '' {
  if (!nascita) return ''
  const [y = 0, m = 0, g = 0] = nascita.split('-').map(Number)
  const [Y = 0, M = 0, G = 0] = al.slice(0, 10).split('-').map(Number)
  return Y - y - (M < m || (M === m && G < g) ? 1 : 0)
}
/** Data da file: 19580307, 07/03/1958, 1958-03-07. */
export function leggiData(v: unknown): string | null {
  const t = String(v ?? '').trim()
  let m: RegExpMatchArray | null
  if ((m = t.match(/^(\d{4})(\d{2})(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`
  if ((m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}
export const nominativo = (s: Pick<Persona, 'cognome' | 'nome'>): string => `${s.cognome} ${s.nome}`.trim()

// ── Importi ──────────────────────────────────────────────────
export const fmtImp = (c: number): string => (c / 100).toFixed(2).replace('.', ',')
export const fmtEuro = (c: number): string => `${(c / 100).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
export function parseEuro(t: unknown): number | null {
  let s = String(t ?? '').trim().replace('€', '').trim()
  if (!s) return null
  s = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}
export const fmtQ = (n: number): string => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2)).replace('.', ','))

// ── Persone ──────────────────────────────────────────────────
export const TIPOLOGIE: Record<TipoPersona, [string, 'nuovo' | 'cf' | 'cyan' | 'fam', string]> = {
  SD:  ['Socio dipendente', 'nuovo', "Dipendente iscritto al CRAL: ID = matricola dell'anagrafica PGS"],
  SE:  ['Socio esterno', 'cf', 'Iscritto al CRAL ma non dipendente: anagrafato a mano o da import, va validato'],
  EST: ['Esterno', 'cyan', 'Non è socio: partecipa solo agli eventi aperti agli esterni o a cui viene aggiunto'],
  FAM: ['Familiare', 'fam', 'Coniuge o figlio/figlia di uno o più soci (dipendenti o esterni)'],
}
export const RELAZIONI: Record<Relazione, string> = { CONIUGE: 'Coniuge', FIGLIO: 'Figlio/Figlia' }
export const STATI: Record<Persona['stato'], string> = { ATTIVO: 'Attivo', DA_VALIDARE: 'Da validare', RIFIUTATO: 'Rifiutato', CESSATO: 'Cessato', ELIMINATO: 'Eliminato' }
/** Soci dipendenti e soci esterni attivi: il totale dei soci. */
export const totaleSoci = (db: Db): number => db.soci.filter(s => eSocio(s) && s.stato === 'ATTIVO').length
export const GRUPPI: TipoPersona[] = ['SD', 'SE', 'EST', 'FAM']
export const eSocio = (s: Pick<Persona, 'tipo'>): boolean => s.tipo === 'SD' || s.tipo === 'SE'
export const persona = (db: Db, id: string | null | undefined): Persona | undefined => (id ? db.perId.get(id) : undefined)
export const sedeNome = (db: Db, id: string | null | undefined): string => db.sedi.find(s => s.id === id)?.nome ?? 'Sede non indicata'
export const sedeBreve = (nome: string): string => nome.replace(/^Sede (di|del) /, '')

export interface LegameRisolto { socio: string; relazione: Relazione; s: Persona }
/** Un familiare è legato a uno o più soci (dipendenti o esterni), ciascuno con la sua relazione. */
export const sociDi = (db: Db, s: Persona): LegameRisolto[] =>
  s.tipo !== 'FAM' ? [] : s.legami.flatMap(l => { const p = persona(db, l.socio); return p ? [{ ...l, s: p }] : [] })
export const familiariDi = (db: Db, socioId: string): Persona[] => db.soci.filter(x => x.tipo === 'FAM' && x.legami.some(l => l.socio === socioId))
export const relDi = (fam: Persona, socioId: string): Relazione | undefined => fam.legami.find(l => l.socio === socioId)?.relazione
/** Un familiare vale solo finché almeno uno dei suoi soci è attivo. */
export const rifAttivo = (db: Db, s: Persona): boolean => s.tipo !== 'FAM' || s.legami.some(l => persona(db, l.socio)?.stato === 'ATTIVO')

// ── Partecipanti e riepiloghi ────────────────────────────────
/**
 * GRUPPI: tutte le persone attive delle tipologie scelte, nelle sedi coinvolte;
 * SINGOLI: solo le persone aggiunte una per una (a mano o da file).
 */
export function destinatari(db: Db, ini: Iniziativa): Persona[] {
  const part = ini.modoPart === 'SINGOLI' ? new Set(ini.partecipanti) : null
  return db.soci.filter(s => s.stato === 'ATTIVO' && rifAttivo(db, s) && (
    part ? part.has(s.id) : ini.gruppi.includes(s.tipo) && (!ini.sedi.length || (s.sede !== null && ini.sedi.includes(s.sede)))))
}
const NOMI_GRUPPI: Record<TipoPersona, string> = { SD: 'soci dipendenti', SE: 'soci esterni', EST: 'esterni', FAM: 'familiari' }
export const descrPart = (ini: Iniziativa): string => ini.modoPart === 'SINGOLI'
  ? `${ini.partecipanti.length} partecipanti singoli`
  : `${ini.gruppi.map(g => NOMI_GRUPPI[g]).join(' + ')} · ${ini.sedi.length ? `${ini.sedi.length} sedi` : 'tutte le sedi'}`

export interface Riepilogo { colonne: string[]; righe: Array<[string, Record<string, number>]>; dest: Persona[] }
/** Pivot sede × scelta (o destinatari, senza scelta), nell'ordine delle sedi. */
export function riepilogo(db: Db, ini: Iniziativa, mancantiComePred: boolean): Riepilogo {
  const dest = destinatari(db, ini)
  const conScelta = ini.modalita === 'SCELTA'
  const colonne = conScelta ? [...ini.opzioni.map(o => o.id), '__NONE'] : ['__ADES']
  const righe = new Map<string, Record<string, number>>()
  for (const s of dest) {
    const k = s.sede ?? '__NOSEDE'
    let r = righe.get(k)
    if (!r) { r = Object.fromEntries(colonne.map(c => [c, 0])); righe.set(k, r) }
    if (!conScelta) { r['__ADES'] = (r['__ADES'] ?? 0) + 1; continue }
    let o = ini.scelte[s.id]?.opz
    if (!o && mancantiComePred && ini.predefinita) o = ini.predefinita
    const c = o && o in r ? o : '__NONE'
    r[c] = (r[c] ?? 0) + 1
  }
  const ordine = [...db.sedi.map(s => s.id), '__NOSEDE']
  return { colonne, righe: [...righe.entries()].sort((a, b) => ordine.indexOf(a[0]) - ordine.indexOf(b[0])), dest }
}

// ── Ordini ───────────────────────────────────────────────────
export const qta = (ini: Iniziativa, sid: string, pid: string): number => ini.scelte[sid]?.q?.[pid] ?? 0
export const totaleSocio = (ini: Iniziativa, sid: string): number => ini.prodotti.reduce((a, p) => a + Math.round(qta(ini, sid, p.id) * p.prezzo), 0)
export const tipNome = (db: Db, id: string): string => db.tipologie.find(t => t.id === id)?.nome ?? id
export const prodLabel = (db: Db, p: Prodotto): string => `${tipNome(db, p.tipologia)} · ${p.nome}`
export const perUnita = (p: Prodotto): string => (p.unita === 'kg' ? '/kg' : p.unita === 'cas' ? '/cassetta' : '')
/** Prodotti raggruppati per tipologia, nell'ordine in cui compaiono: per le intestazioni a due livelli. */
export function gruppiProdotti(ini: Iniziativa): Array<{ tip: string; prod: Prodotto[] }> {
  const g: Array<{ tip: string; prod: Prodotto[] }> = []
  for (const p of ini.prodotti) { const u = g[g.length - 1]; if (u && u.tip === p.tipologia) u.prod.push(p); else g.push({ tip: p.tipologia, prod: [p] }) }
  return g
}
export const contenutoTot = (p: Prodotto, n: number): number | null => (p.contenuto ? n * p.contenuto : null)
export const pezziSocio = (ini: Iniziativa, sid: string): number => ini.prodotti.reduce((a, p) => a + qta(ini, sid, p.id), 0)
export const haOrdinato = (ini: Iniziativa, sid: string): boolean => pezziSocio(ini, sid) > 0

// ── Sconti ───────────────────────────────────────────────────
// Due livelli: regola per tipologia (nell'evento) e sconto personale sulla
// persona o sulla richiesta, che sostituisce la regola (anche «nessuno»).
export const CAT_SC: Record<CatSconto, string> = { SD: 'Soci dipendenti', SE: 'Soci esterni', DIP: 'Dipendenti non soci', EST: 'Esterni', FAM: 'Familiari' }
export const CAT_SCONTO_1: Record<CatSconto, string> = { SD: 'socio dipendente', SE: 'socio esterno', DIP: 'dipendente non socio', EST: 'esterno', FAM: 'familiare' }
export const catDiModo = (mod: Modalita): CatSconto[] => (mod === 'TURNI' ? ['SD', 'SE', 'DIP', 'EST'] : ['SD', 'SE', 'DIP', 'EST', 'FAM'])
export const unitaSconto = (mod: Modalita): string => (mod === 'TURNI' ? 'a settimana' : mod === 'MAGAZZINO' ? 'a biglietto' : 'a ordine')
export const fmtSconto = (sc: ScontoRegola | ScontoPers | null | undefined): string =>
  !sc || sc.tipo === 'NO' || !sc.val ? '' : sc.tipo === '%' ? `−${sc.val}%` : `−${fmtEuro(sc.val)}`
export function applicaSconto(lordo: number, sc: ScontoRegola | ScontoPers | null | undefined, n = 1): number {
  if (!sc || sc.tipo === 'NO' || !sc.val) return lordo
  return sc.tipo === '%' ? Math.round(lordo * (100 - sc.val) / 100) : Math.max(0, lordo - sc.val * n)
}
export const regolaCat = (ini: Iniziativa, cat: CatSconto): ScontoRegola | null => { const r = ini.sconti[cat]; return r && r.val ? r : null }
/** Categoria per lo sconto: socio attivo = la sua tipologia, con matricola = dipendente non socio, altrimenti esterno. */
export const catSconto = (p: Persona | null | undefined): Exclude<CatSconto, 'FAM'> =>
  !p ? 'EST' : eSocio(p) && p.stato === 'ATTIVO' ? (p.tipo as 'SD' | 'SE') : p.matricola ? 'DIP' : 'EST'
export const catPersona = (s: Persona | null | undefined): CatSconto => (!s ? 'EST' : s.tipo === 'FAM' ? 'FAM' : catSconto(s))
export const persDi = (ini: Iniziativa, sid: string): ScontoPers | null => ini.scelte[sid]?.scontoPers ?? null
export const conScontiIni = (ini: Iniziativa): boolean =>
  catDiModo(ini.modalita).some(k => regolaCat(ini, k)) || Object.values(ini.scelte).some(v => v.scontoPers) || ini.richieste.some(r => r.sconto)
export function riassuntoSconti(ini: Iniziativa): string {
  const g = new Map<string, string[]>()
  for (const k of catDiModo(ini.modalita)) { const r = regolaCat(ini, k); if (r) { const f = fmtSconto(r); g.set(f, [...(g.get(f) ?? []), CAT_SC[k].toLowerCase()]) } }
  return [...g.entries()].map(([f, l]) => `${l.join(', ')} ${f}`).join(' · ')
}
export const etichettaPers = (p: ScontoPers | null, regola: ScontoRegola | null): string =>
  p ? (p.tipo === 'NO' ? 'nessuno sconto (a mano)' : `${fmtSconto(p)} a mano`) : (regola ? `auto ${fmtSconto(regola)}` : 'sconto…')
export const descrScontoPers = (p: ScontoPers): string => (p.tipo === 'NO' ? 'nessuno (a mano)' : `${fmtSconto(p)} (a mano)`)

export const scontoOrdine = (db: Db, ini: Iniziativa, sid: string): ScontoRegola | ScontoPers | null =>
  persDi(ini, sid) ?? regolaCat(ini, catPersona(persona(db, sid)))
export const nettoSocio = (db: Db, ini: Iniziativa, sid: string): number => applicaSconto(totaleSocio(ini, sid), scontoOrdine(db, ini, sid))

export interface ContiOrdine { dest: Persona[]; ord: Persona[]; lordo: number; sconti: number; totale: number; incassato: number; pezzi: number }
export function contiOrdine(db: Db, ini: Iniziativa): ContiOrdine {
  const dest = destinatari(db, ini)
  const ord = dest.filter(s => haOrdinato(ini, s.id))
  const lordo = ord.reduce((a, s) => a + totaleSocio(ini, s.id), 0)
  const totale = ord.reduce((a, s) => a + nettoSocio(db, ini, s.id), 0)
  const incassato = ord.filter(s => ini.scelte[s.id]?.pagato).reduce((a, s) => a + nettoSocio(db, ini, s.id), 0)
  return { dest, ord, lordo, sconti: lordo - totale, totale, incassato, pezzi: ord.reduce((a, s) => a + pezziSocio(ini, s.id), 0) }
}
export interface RigaSede { q: Record<string, number>; eur: number; n: number }
export function righeOrdiniPerSede(db: Db, ini: Iniziativa): Array<[string, RigaSede]> {
  const m = new Map<string, RigaSede>()
  for (const s of destinatari(db, ini)) {
    if (!haOrdinato(ini, s.id)) continue
    const k = s.sede ?? '__NOSEDE'
    let r = m.get(k)
    if (!r) { r = { q: Object.fromEntries(ini.prodotti.map(p => [p.id, 0])), eur: 0, n: 0 }; m.set(k, r) }
    for (const p of ini.prodotti) r.q[p.id] = (r.q[p.id] ?? 0) + qta(ini, s.id, p.id)
    r.eur += nettoSocio(db, ini, s.id); r.n++
  }
  const ordine = [...db.sedi.map(s => s.id), '__NOSEDE']
  return [...m.entries()].sort((a, b) => ordine.indexOf(a[0]) - ordine.indexOf(b[0]))
}

// ── Cinema (magazzino): la regola € vale a biglietto, lo sconto personale sulla richiesta intera
export const scontoRichiesta = (db: Db, ini: Iniziativa, r: Richiesta): ScontoRegola | ScontoPers | null =>
  r.sconto ?? regolaCat(ini, catPersona(persona(db, r.persona)))
export const lordoRichiesta = (ini: Iniziativa, r: Richiesta): number => r.qta * (ini.articoli.find(x => x.id === r.art)?.prezzo ?? 0)
export const importoRichiesta = (db: Db, ini: Iniziativa, r: Richiesta): number =>
  applicaSconto(lordoRichiesta(ini, r), scontoRichiesta(db, ini, r), r.sconto ? 1 : r.qta)
export const nomeDi = (db: Db, id: string): string => { const p = persona(db, id); return p ? nominativo(p) : id }

export interface ContoArticolo { car: number; con: number; att: number; giac: number; disp: number }
export function contiMagazzino(ini: Iniziativa): Record<string, ContoArticolo> {
  return Object.fromEntries(ini.articoli.map(a => {
    const car = ini.carichi.filter(c => c.art === a.id).reduce((x, c) => x + c.qta, 0)
    const con = ini.richieste.filter(r => r.art === a.id && r.stato === 'CONSEGNATA').reduce((x, r) => x + r.qta, 0)
    const att = ini.richieste.filter(r => r.art === a.id && r.stato === 'ATTESA').reduce((x, r) => x + r.qta, 0)
    return [a.id, { car, con, att, giac: car - con, disp: car - con - att }]
  }))
}
export const ordineRichieste = (a: Richiesta, b: Richiesta): number => a.dataRich.localeCompare(b.dataRich) || a.id.localeCompare(b.id)
/** Coda delle richieste in attesa, per data richiesta: quali si possono già consegnare con la giacenza. */
export function codaRichieste(ini: Iniziativa): Record<string, 'pronta' | 'coda'> {
  const g: Record<string, number> = Object.fromEntries(Object.entries(contiMagazzino(ini)).map(([k, v]) => [k, v.giac]))
  const esito: Record<string, 'pronta' | 'coda'> = {}
  for (const r of ini.richieste.filter(x => x.stato === 'ATTESA').sort(ordineRichieste)) {
    if ((g[r.art] ?? 0) >= r.qta) { esito[r.id] = 'pronta'; g[r.art] = (g[r.art] ?? 0) - r.qta } else esito[r.id] = 'coda'
  }
  return esito
}
export interface Movimento { data: string; art: string; q: number; desc: string; giac: number }
export function movimentiMagazzino(db: Db, ini: Iniziativa): Movimento[] {
  const mov = [
    ...ini.carichi.map(c => ({ data: c.data, art: c.art, q: c.qta, desc: `Carico${c.note ? ` · ${c.note}` : ''}` })),
    ...ini.richieste.filter(r => r.stato === 'CONSEGNATA').map(r => ({ data: r.dataCons ?? r.dataRich, art: r.art, q: -r.qta, desc: `Consegna a ${nomeDi(db, r.persona)}` })),
  ].sort((a, b) => a.data.localeCompare(b.data) || b.q - a.q)
  const g: Record<string, number> = {}
  return mov.map(m => { g[m.art] = (g[m.art] ?? 0) + m.q; return { ...m, giac: g[m.art] ?? 0 } })
}

// ── Turni (campi estivi) ─────────────────────────────────────
// P prenotata · F frequentata · T tolta (non si paga). La quota è per periodo intero.
export const statoPer = (ini: Iniziativa, sid: string, pid: string): StatoPeriodo => ini.scelte[sid]?.per?.[pid] ?? ''
export const pagaPer = (st: StatoPeriodo): boolean => st === 'P' || st === 'F'
/** Persona di riferimento: scelta a mano (rif), altrimenti il primo socio attivo del familiare, oppure la persona stessa se socio o dipendente. */
export function rifDi(db: Db, ini: Iniziativa, s: Persona): Persona | null {
  const id = ini.scelte[s.id]?.rif
  if (id !== undefined) return id ? persona(db, id) ?? null : null
  if (s.tipo === 'FAM') { const ls = sociDi(db, s); return (ls.find(l => l.s.stato === 'ATTIVO') ?? ls[0])?.s ?? null }
  return eSocio(s) || s.matricola ? s : null
}
/** Riferimento automatico (come se rif non ci fosse). */
export function rifAutomatico(db: Db, ini: Iniziativa, s: Persona): Persona | null {
  const { rif: _r, ...resto } = ini.scelte[s.id] ?? {}
  return rifDi(db, { ...ini, scelte: { ...ini.scelte, [s.id]: resto } }, s)
}
/** Categoria che decide lo sconto: quella del giorno d'iscrizione (bloccata). */
export const catBloccata = (db: Db, ini: Iniziativa, s: Persona): CatSconto => ini.scelte[s.id]?.iscr?.cat ?? catSconto(rifDi(db, ini, s))
export const regolaTurni = (db: Db, ini: Iniziativa, s: Persona): ScontoRegola | null => regolaCat(ini, catBloccata(db, ini, s))
export const quotaDi = (db: Db, ini: Iniziativa, s: Persona): number => applicaSconto(ini.quota, regolaTurni(db, ini, s))
export const haSconto = (db: Db, ini: Iniziativa, s: Persona): boolean => { const p = persDi(ini, s.id); return p ? p.tipo !== 'NO' && !!p.val : !!regolaTurni(db, ini, s) }
export const periodiDovuti = (ini: Iniziativa, sid: string): number => ini.periodi.filter(p => pagaPer(statoPer(ini, sid, p.id))).length
/** Dovuto: settimane × quota della regola; lo sconto personale invece si applica al totale lordo. */
export function dovutoTurni(db: Db, ini: Iniziativa, s: Persona): number {
  const n = periodiDovuti(ini, s.id), p = persDi(ini, s.id)
  return p ? applicaSconto(n * ini.quota, p) : n * quotaDi(db, ini, s)
}
export const iscrittoTurni = (ini: Iniziativa, sid: string): boolean => ini.periodi.some(p => statoPer(ini, sid, p.id))
export const aCaricoDi = (db: Db, ini: Iniziativa, s: Persona): string => { const r = rifDi(db, ini, s); return r && r.id !== s.id ? nominativo(r) : '' }
export const occupati = (db: Db, ini: Iniziativa, pid: string): number => destinatari(db, ini).filter(s => pagaPer(statoPer(ini, s.id, pid))).length
export interface ContiTurni { dest: Persona[]; isc: Persona[]; dovuto: number; versato: number; settimane: number }
export function contiTurni(db: Db, ini: Iniziativa): ContiTurni {
  const dest = destinatari(db, ini)
  const isc = dest.filter(s => periodiDovuti(ini, s.id) > 0)
  return {
    dest, isc,
    dovuto: isc.reduce((a, s) => a + dovutoTurni(db, ini, s), 0),
    versato: dest.reduce((a, s) => a + (ini.scelte[s.id]?.versato ?? 0), 0),
    settimane: isc.reduce((a, s) => a + periodiDovuti(ini, s.id), 0),
  }
}
const isoLocale = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** n settimane lun–ven a partire dal lunedì `dal`. */
export function generaSettimane(dal: string, n: number, posti: number | null, primo = 1): Array<{ id: string; nome: string; dal: string; al: string; postiTxt: string }> {
  const out = []
  const base = Date.now().toString(36)
  let d = new Date(`${dal}T12:00:00`)
  for (let k = 0; k < n; k++) {
    const fine = new Date(d); fine.setDate(fine.getDate() + 4)
    out.push({ id: `W${base}${k}`, nome: `Settimana ${primo + k}`, dal: isoLocale(d), al: isoLocale(fine), postiTxt: posti ? String(posti) : '' })
    d = new Date(d); d.setDate(d.getDate() + 7)
  }
  return out
}

// ── Quote associative (anno solare) ──────────────────────────
export const MESI = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']
export const MODI_QUOTA: Record<QuotaSocio['modo'], string> = { TRATTENUTA: 'Trattenuta in busta paga', MENSILE: 'Mensile', UNICA: 'Unica soluzione' }
export const quotaAnno = (db: Db, anno: number): number => db.quoteAnno.find(q => q.anno === anno)?.importo ?? 0
/**
 * Socio tenuto alla quota dell'anno (stessa regola del server): iscritto
 * entro il 31/12 e non cessato prima del 1/1. Esterni e familiari no.
 * L'eliminato la deve solo per gli anni prima dell'eliminazione; gli anni
 * passati da eliminato restano esenti anche dopo il ripristino.
 */
export function tenutoQuota(s: Persona, anno: number): boolean {
  if (!eSocio(s) || (s.anniEsenti ?? []).includes(anno)) return false
  if ((s.iscrittoIl || '0000').slice(0, 10) > `${anno}-12-31`) return false
  const stato = s.stato === 'ELIMINATO' ? s.statoPrima : s.stato
  if (s.stato === 'ELIMINATO' && (!s.eliminatoIl || anno >= +s.eliminatoIl.slice(0, 4))) return false
  return stato === 'ATTIVO' || (stato === 'CESSATO' && (s.cessatoIl ?? '') >= `${anno}-01-01`)
}
export const sociQuota = (db: Db, anno: number): Persona[] => db.soci.filter(s => tenutoQuota(s, anno))
export const quotaSocio = (db: Db, anno: number, s: Persona): QuotaSocio =>
  db.quote[String(anno)]?.[s.id] ?? { modo: s.matricola ? 'TRATTENUTA' : 'UNICA', mesi: Array<boolean>(12).fill(false), importi: Array<number>(12).fill(0), pagataIl: null, versatoUnica: null, note: '' }
/** Rata del mese k (0–11): l'ultima prende i centesimi di resto. */
export const rataMese = (imp: number, k: number): number => { const r = Math.floor(imp / 12); return k === 11 ? imp - 11 * r : r }
/** Versato reale (0024): importi delle rate più l'unica soluzione. */
export const versatoDi = (q: Pick<QuotaSocio, 'importi' | 'versatoUnica'>): number => (q.importi ?? []).reduce((a, v) => a + v, 0) + (q.versatoUnica ?? 0)
export const versatoQuota = (db: Db, anno: number, s: Persona): number => versatoDi(quotaSocio(db, anno, s))
/**
 * Modifica a mano (stessa regola del server, lib/cral.ts): accendere un mese
 * registra la rata (o lascia l'importo se maggiore), spegnerlo lo azzera;
 * l'unica soluzione pagata registra la quota dell'anno.
 */
export function quotaDopoModifica(cur: QuotaSocio, patch: Partial<Pick<QuotaSocio, 'modo' | 'mesi' | 'pagataIl' | 'note'>>, imp: number): QuotaSocio {
  const q: QuotaSocio = { ...cur, mesi: [...cur.mesi], importi: [...(cur.importi ?? Array<number>(12).fill(0))] }
  if (patch.modo !== undefined) q.modo = patch.modo
  if (patch.note !== undefined) q.note = patch.note
  if (patch.mesi) { q.mesi = [...patch.mesi]; q.importi = q.importi.map((v, k) => (q.mesi[k] ? Math.max(v, rataMese(imp, k)) : 0)) }
  if (patch.pagataIl !== undefined) { q.pagataIl = patch.pagataIl; q.versatoUnica = patch.pagataIl ? Math.max(cur.versatoUnica ?? 0, imp) : null }
  return q
}

// ── Tessera ──────────────────────────────────────────────────
export const formatTessera = (t: ParametriTessera, n: number): string => `${t.formato === 'PREF' ? t.prefisso : ''}${String(n).padStart(t.cifre, '0')}`
export const prossimaTessera = (t: ParametriTessera): string => formatTessera(t, t.prossimo)
/** Dal libro soci arriva un intero: 42 → 0042 (o CRAL-0042). */
export const tesseraDaTesto = (t: ParametriTessera, v: string): string => { const x = v.trim(); return /^\d+$/.test(x) ? formatTessera(t, parseInt(x, 10)) : x }
/** Numero della tessera senza prefisso e suffisso: stesso numero anche se scritto diverso (0031/01 e 31). */
export function numBase(t: ParametriTessera, tessera: string | null | undefined): number {
  const s = String(tessera ?? ''); const x = t.prefisso && s.startsWith(t.prefisso) ? s.slice(t.prefisso.length) : s
  const m = x.match(/^\d+/); return m ? parseInt(m[0], 10) : NaN
}
/** Tessera alla riammissione (stessa regola del server, solo per l'anteprima). */
export function tesseraRiammissione(t: ParametriTessera, s: Persona): { tessera: string; nuovoNumero: boolean } | { errore: string } {
  if (t.riammissione !== 'SUFFISSO' || !s.tessera) return { tessera: prossimaTessera(t), nuovoNumero: true }
  const sep = t.sepSuffisso.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')
  const base = s.riammissioni > 0 ? s.tessera.replace(new RegExp(`${sep}\\d{${t.cifreSuffisso}}$`), '') : s.tessera
  const n = s.riammissioni + 1, max = 10 ** t.cifreSuffisso - 1
  if (n > max) return { errore: `Raggiunto il suffisso massimo (${max}): serve un nuovo numero.` }
  return { tessera: `${base}${t.sepSuffisso}${String(n).padStart(t.cifreSuffisso, '0')}`, nuovoNumero: false }
}
export const tesseraDoppia = (db: Db, id: string | null, t: string): boolean =>
  !!t && db.soci.some(x => x.id !== id && x.tessera && norm(x.tessera) === norm(t))

// ── Nominativi (stessa regola di Emolumenti, per agganciare righe di file alle persone del CRAL) ──
const normA = (s: unknown, ap: 'unito' | 'diviso' = 'unito'): string => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  .replace(/['’`´]/g, ap === 'unito' ? '' : ' ').replace(/[^A-Z0-9]+/g, ' ').trim()
export const normNome = normA
const tok = (s: unknown, ap: 'unito' | 'diviso'): string[] => normA(s, ap).split(' ').filter(t => t.length > 1)
const incolla = (parti: string[]): string[] => { const out: string[] = []; let p = ''; for (const t of parti) { if (t.length === 1) p += t; else { out.push(p + t); p = '' } } return out }
const grafie = (s: unknown): Array<Set<string>> => [tok(s, 'unito'), tok(s, 'diviso'), incolla(normA(s, 'diviso').split(' ').filter(Boolean))].filter(x => x.length).map(x => new Set(x))
const tokensDi = (a: { cognome: string; nome: string }): Set<string> => new Set([a.cognome, a.nome].flatMap(c => grafie(c).flatMap(g => [...g])))
const tokensPrinc = (a: { cognome: string; nome: string }): Set<string> => new Set([a.cognome, a.nome].flatMap(c => incolla(normA(c, 'diviso').split(' ').filter(Boolean))))
export function risolvi<T extends { cognome: string; nome: string }>(nom: string, elenco: T[]): { esito: 'trovato' | 'parziale' | 'ambiguo' | 'non-trovato'; cand: T[] } {
  const forme = grafie(nom); if (!forme.length) return { esito: 'non-trovato', cand: [] }
  const esatti: T[] = [], parziali: T[] = []
  for (const a of elenco) {
    const t = tokensDi(a); const f = forme.find(x => [...x].every(y => t.has(y))); if (!f) continue
    ;(tokensPrinc(a).size === f.size ? esatti : parziali).push(a)
  }
  if (esatti.length === 1) return { esito: 'trovato', cand: esatti }
  if (esatti.length > 1) return { esito: 'ambiguo', cand: esatti }
  if (parziali.length === 1) return { esito: 'parziale', cand: parziali }
  if (parziali.length > 1) return { esito: 'ambiguo', cand: parziali }
  return { esito: 'non-trovato', cand: [] }
}
/** Somiglianza fra due nominativi (0–1): Levenshtein sulle parole in ordine alfabetico. Propone, non decide. */
export function simNome(a: string, b: string): number {
  const x = normA(a).split(' ').sort().join(' '), y = normA(b).split(' ').sort().join(' ')
  if (!x || !y) return 0
  let prec = Array.from({ length: y.length + 1 }, (_, j) => j)
  for (let i = 1; i <= x.length; i++) {
    const cur = [i]
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prec[j]! + 1, cur[j - 1]! + 1, prec[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1))
    prec = cur
  }
  return 1 - prec[y.length]! / Math.max(x.length, y.length)
}
/** Aggancio di una riga di file a una persona: matricola/ID/tessera, poi email, poi nominativo. */
export function agganciaPersona(elenco: Persona[], idTxt: string, email: string, nom: string): [Persona | null, string] {
  if (idTxt) {
    const id = idTxt.trim()
    const p = elenco.find(s => s.id === id.padStart(6, '0') || s.id === id || s.id === id.toUpperCase() || (s.tessera && norm(s.tessera) === norm(id)))
    if (p) return [p, 'matricola/tessera']
  }
  if (email) { const p = elenco.find(s => s.email && s.email.toLowerCase() === email.toLowerCase()); if (p) return [p, 'email'] }
  if (nom) { const r = risolvi(nom, elenco); if (r.esito === 'trovato' && r.cand[0]) return [r.cand[0], 'nominativo'] }
  return [null, '']
}
/** Riga d'intestazione: la prima (entro 10) che contiene NOMINATIVO, COGNOME, NOME o MATRICOLA. Sopra può esserci un titolo. */
export const trovaIntestazione = (rows: string[][] | undefined): number => {
  const k = (rows ?? []).slice(0, 10).findIndex(r => r.some(h => /^(nominativo|cognome|matricola|nome)$/i.test(h.trim()) || /cognome\s*e?\s*nome|nominativo/i.test(h)))
  return k < 0 ? 0 : k
}
/** Cognome e nome da un nominativo in un solo campo (stessa regola del server per il libro soci). */
export function spezzaNominativo(nom: string): [string, string] {
  const parti = nom.trim().split(/\s+/).filter(Boolean)
  if (!parti.length) return ['', '']
  const iNome = parti.findIndex((p, j) => j > 0 && p !== p.toUpperCase())
  if (iNome > 0) return [parti.slice(0, iNome).join(' ').toUpperCase(), parti.slice(iNome).join(' ')]
  const PARTICELLE = new Set(['DE', 'DI', 'DA', 'DEL', 'DELLA', 'DELLO', 'DEI', 'DEGLI', 'DAL', 'DALLA', 'LA', 'LO', 'LI', 'LE', 'D', 'MC', 'MAC', 'VAN', 'VON', 'SAN', 'SANTO', 'SANTA'])
  let k = 0
  while (k < parti.length - 2 && PARTICELLE.has(normA(parti[k], 'diviso').replace(/ /g, ''))) k++
  return [parti.slice(0, k + 1).join(' ').toUpperCase(), parti.slice(k + 1).join(' ')]
}

// ── CSV ──────────────────────────────────────────────────────
const csvCella = (v: unknown): string => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
export const creaCsv = (intest: string[], righe: Array<Array<string | number>>): string =>
  '﻿' + [intest, ...righe].map(r => r.map(csvCella).join(';')).join('\r\n')
