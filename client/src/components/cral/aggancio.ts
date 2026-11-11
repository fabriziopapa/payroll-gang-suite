// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · aggancio delle righe di un file
// alle persone. UN solo motore per tutte le importazioni (T2–T7).
//
// Ordine delle chiavi:  ID (matricola, EXT-, FAM-, ex matricola) →
// tessera → telefono → email → nominativo (+ data di nascita).
// Basta UNA chiave: un file con il solo numero di telefono si importa.
//
// Controlli di congruità (quando la riga porta più chiavi):
//  · telefono di una persona sola, nome compatibile o assente → agganciata
//  · telefono condiviso (familiari)  → decide il nome; se non basta sceglie
//    l'utente fra chi ha quel numero                                (AMBIGUA)
//  · telefono del socio e nome di un suo familiare (il figlio iscritto col
//    numero del genitore) → il familiare
//  · telefono di A ma il nome indica B, o non corrisponde ad A → la riga
//    resta ferma finché l'utente non sceglie                      (CONFLITTO)
//  · numero mai visto, persona trovata per email o nome senza numero in
//    anagrafica → il numero si propone come variazione (consenso «no»)
//  · niente combacia → si assegna a mano o si ignora                (IGNOTA)
// Ogni riga non agganciata dice perché (`motivo`).
// ============================================================

import type { ParametriTessera, Persona } from './tipi'
import { leggiTelefono, mostraTelefono } from './contatti'
import { nominativo, norm, risolvi, tesseraDaTesto } from './logica'

export type Ruolo = 'id' | 'tessera' | 'telefono' | 'email' | 'nominativo' | 'cognome' | 'nome' | 'nascita'
export const NOMI_RUOLI: Record<Ruolo, string> = {
  id: 'ID / matricola', tessera: 'Tessera', telefono: 'Telefono', email: 'Email', nominativo: 'Nominativo', cognome: 'Cognome', nome: 'Nome', nascita: 'Data di nascita',
}
/** Intestazione senza maiuscole, accenti e punteggiatura: «N. Tel.» → «n tel». */
export const chiaveIntestazione = (h: string): string =>
  h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
/** I modi in cui le colonne vengono chiamate nei file veri. */
export const SINONIMI: Record<Ruolo, RegExp> = {
  id: /^(id|id socio|id persona|matricola|matr|n matricola|num matricola|numero matricola|numero di matricola|codice|cod)$/,
  tessera: /^(tessera|tessera cral|n tessera|num tessera|numero tessera|numero di tessera|n socio|numero socio)$/,
  telefono: /^((n|num|numero|recapito|contatto)( di)? )?(tel|telefono|telefonico|cell|cellulare|mobile|whatsapp|wa|wa id|phone|telefono cellulare|telefono mobile|recapito|numero)$|^phone number$/,
  email: /mail|posta elettronica/,
  nominativo: /^(nominativo|cognome e nome|cognome nome|nome e cognome|nome cognome|partecipante|socio|dipendente|persona|richiedente|intestatario)$/,
  cognome: /^cognome$/,
  nome: /^nome$/,
  nascita: /nascita|^nato/,
}

/**
 * Quale colonna fa da quale chiave. `ricordate`: scelte fatte a mano in
 * passato per questo tracciato (intestazione → ruolo, '' = ignora): vincono
 * sul riconoscimento automatico. Senza il ruolo «tessera» fra i `ruoli`,
 * una colonna tessera vale come ID (negli eventi sono la stessa chiave).
 */
export function trovaColonne(intest: string[], ruoli: Ruolo[], ricordate: Record<string, string> = {}): Record<Ruolo, number> {
  const out: Record<Ruolo, number> = { id: -1, tessera: -1, telefono: -1, email: -1, nominativo: -1, cognome: -1, nome: -1, nascita: -1 }
  const libere: number[] = []
  intest.forEach((h, j) => {
    const k = chiaveIntestazione(h); if (!k) return
    const r = ricordate[k]
    if (r === undefined) { libere.push(j); return }
    if (r && ruoli.includes(r as Ruolo) && out[r as Ruolo] < 0) out[r as Ruolo] = j
  })
  for (const j of libere) {
    const k = chiaveIntestazione(intest[j] ?? '')
    let r = ruoli.find(x => SINONIMI[x].test(k))
    if (!r && !ruoli.includes('tessera') && ruoli.includes('id') && SINONIMI.tessera.test(k)) r = 'id'
    if (r && out[r] < 0) out[r] = j
  }
  return out
}

export interface Chiavi { id?: string; tessera?: string; telefono?: string; email?: string; nominativo?: string; nascita?: string | null }
export type StatoAggancio = 'OK' | 'AMBIGUA' | 'CONFLITTO' | 'IGNOTA'
export interface EsitoAggancio {
  socio: Persona | null
  stato: StatoAggancio
  /** Con che chiave si è agganciata (per il segno «per …»). */
  via: string
  /** Fra chi scegliere a mano, in ordine di probabilità. */
  candidati: Persona[]
  /** Perché non è agganciata. */
  motivo: string
  avvisi: string[]
  /** Numero letto dalla riga (E.164), se valido. */
  telefono: string
  /** La persona agganciata non ha un numero in anagrafica: si può proporre questo. */
  telefonoNuovo: boolean
}
export interface OpzioniAggancio {
  prefisso: string
  /** Accetta anche il nominativo parziale (un nome in meno): sì negli aggiornamenti, no negli eventi. */
  parziale?: boolean
  tessera?: ParametriTessera
}

const idUguale = (s: Persona, id: string) => s.id === id || s.id === id.toUpperCase() || (/^\d+$/.test(id) && (s.id === id.padStart(6, '0') || s.exMatricola === id || s.exMatricola === id.padStart(6, '0')))
/** Il nome scritto nel file è compatibile con questa persona (ordine, accenti, un secondo nome in meno non contano). */
export function nomeCompatibile(nom: string, p: Persona): boolean {
  const r = risolvi(nom, [p])
  return r.esito === 'trovato' || r.esito === 'parziale'
}

export function agganciaRiga(elenco: Persona[], k: Chiavi, o: OpzioniAggancio): EsitoAggancio {
  const avvisi: string[] = []
  const nom = (k.nominativo ?? '').trim()
  const t = leggiTelefono(k.telefono, o.prefisso)
  const tel = t && 'e164' in t ? t.e164 : ''
  if (t && 'errore' in t) avvisi.push(`telefono «${String(k.telefono).trim()}»: ${t.errore}`)
  const fine = (socio: Persona | null, stato: StatoAggancio, via: string, candidati: Persona[], motivo: string): EsitoAggancio => {
    if (socio && tel && socio.contatti.telefono && socio.contatti.telefono !== tel && via !== 'telefono') avvisi.push(`in anagrafica ha un altro numero (${mostraTelefono(socio.contatti.telefono)})`)
    return { socio, stato, via, candidati, motivo, avvisi, telefono: tel, telefonoNuovo: !!socio && !!tel && !socio.contatti.telefono }
  }
  // 1 · ID e tessera: chiavi forti, vincono su tutto
  const id = (k.id ?? '').trim()
  if (id) {
    const p = elenco.find(s => idUguale(s, id))
    if (p) return fine(p, 'OK', p.id === id.toUpperCase() || p.id === id.padStart(6, '0') ? 'ID' : `ex matricola (ora ${p.id})`, [], '')
    const pt = elenco.find(s => !!s.tessera && norm(s.tessera) === norm(o.tessera ? tesseraDaTesto(o.tessera, id) : id))
    if (pt) return fine(pt, 'OK', 'tessera', [], '')
    avvisi.push(`ID ${id} non presente`)
  }
  const tk = (k.tessera ?? '').trim()
  if (tk) {
    const p = elenco.find(s => !!s.tessera && norm(s.tessera) === norm(o.tessera ? tesseraDaTesto(o.tessera, tk) : tk))
    if (p) return fine(p, 'OK', 'tessera', [], '')
    avvisi.push(`tessera ${tk} non presente`)
  }
  const perNome = nom ? risolvi(nom, elenco) : null
  const diNome = perNome && (perNome.esito === 'trovato' || (o.parziale && perNome.esito === 'parziale')) ? perNome.cand[0] ?? null : null
  const candNome = perNome?.cand ?? []
  // 2 · telefono
  if (tel) {
    const suo = elenco.filter(s => s.contatti.telefono === tel)
    if (suo.length === 1) {
      const p = suo[0]!
      if (!nom || nomeCompatibile(nom, p)) return fine(p, 'OK', 'telefono', [], '')
      // il numero è del socio ma la riga è di un suo familiare (o viceversa): es. il figlio iscritto col telefono del genitore
      const famiglia = elenco.filter(x => x.id !== p.id && (x.legami.some(l => l.socio === p.id) || p.legami.some(l => l.socio === x.id)) && nomeCompatibile(nom, x))
      if (famiglia.length === 1) return fine(famiglia[0]!, 'OK', `nominativo (telefono di ${nominativo(p)})`, [], '')
      return fine(null, 'CONFLITTO', '', diNome && diNome.id !== p.id ? [p, diNome] : [p, ...candNome.filter(x => x.id !== p.id)],
        diNome && diNome.id !== p.id ? `il telefono è di ${nominativo(p)}, il nominativo indica ${nominativo(diNome)}` : `il telefono è di ${nominativo(p)}, ma nel file c'è «${nom}»`)
    }
    if (suo.length > 1) {
      const giusti = nom ? suo.filter(p => nomeCompatibile(nom, p)) : []
      if (giusti.length === 1) return fine(giusti[0]!, 'OK', 'telefono e nominativo', [], '')
      return fine(null, 'AMBIGUA', '', suo, `numero condiviso da ${suo.length} persone${nom && !giusti.length ? `, nessuna si chiama «${nom}»` : ''}: scegli`)
    }
  }
  // 3 · email (può essere di più persone: decide il nome)
  const email = (k.email ?? '').trim().toLowerCase()
  if (email) {
    const sua = elenco.filter(s => !!s.email && s.email.toLowerCase() === email)
    if (sua.length === 1) {
      const p = sua[0]!
      if (!nom || nomeCompatibile(nom, p) || !diNome) return fine(p, 'OK', 'email', [], '')
      return fine(null, 'CONFLITTO', '', [p, diNome], `l'email è di ${nominativo(p)}, il nominativo indica ${nominativo(diNome)}`)
    }
    if (sua.length > 1) {
      const giusti = nom ? sua.filter(p => nomeCompatibile(nom, p)) : []
      if (giusti.length === 1) return fine(giusti[0]!, 'OK', 'email e nominativo', [], '')
      return fine(null, 'AMBIGUA', '', sua, `email usata da ${sua.length} persone: scegli`)
    }
  }
  // 4 · nominativo, con la data di nascita a decidere fra gli omonimi
  if (perNome) {
    if (diNome) return fine(diNome, 'OK', perNome.esito === 'parziale' ? 'nominativo parziale' : 'nominativo', candNome, '')
    const perData = k.nascita ? candNome.filter(c => c.nascita === k.nascita) : []
    if (perData.length === 1) return fine(perData[0]!, 'OK', 'nominativo e data di nascita', candNome, '')
    if (candNome.length > 1) return fine(null, 'AMBIGUA', '', candNome, `${candNome.length} persone con questo nome${k.nascita ? '' : ': la data di nascita le distinguerebbe'}`)
    if (candNome.length === 1) return fine(null, 'AMBIGUA', '', candNome, 'il nominativo corrisponde solo in parte: conferma')
  }
  const cosa = [tel ? `il numero ${mostraTelefono(tel)}` : '', email ? `l'email ${email}` : '', nom ? `«${nom}»` : ''].filter(Boolean)
  return fine(null, 'IGNOTA', '', [], cosa.length ? `${cosa.join(', ')} non ${cosa.length > 1 ? 'sono' : 'è'} in anagrafica` : avvisi.length ? avvisi.join(' · ') : 'riga senza una chiave (ID, telefono, email, nominativo)')
}
