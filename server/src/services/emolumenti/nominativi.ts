// ============================================================
// PAYROLL GANG SUITE — Area Emolumenti · risoluzione dei nominativi
//
// L'ufficio lavora con elenchi incollati da Excel: "Cognome Nome<TAB>numero".
// I nomi arrivano come capita — "D'Angelo Marco" (cognome prima),
// "Giulia Bianchi" (nome prima), "FERRARI ANNA MARIA" tutto
// maiuscolo. Il confronto quindi:
//   - ignora maiuscole, accenti, apostrofi e punteggiatura;
//   - ignora l'ORDINE delle parole (confronto per insiemi di token);
//   - non indovina mai: se i candidati sono piu' di uno lo dichiara ambiguo
//     e li restituisce tutti, perche' liquidare la persona sbagliata e' peggio
//     che chiedere.
// Logica pura, senza dipendenze da db o rete: testabile da sola.
// ============================================================

export interface AnagraficaPerRicerca {
  matricola: string
  /** Campo unico storico (import XML). */
  cognNome:  string | null
  /** Campi separati (import SGE), quando presenti. */
  cognome:   string | null
  nome:      string | null
  ruolo:     string | null
  idAb:      number | null
}

export interface Candidato {
  matricola:   string
  nomeCompleto: string
  ruolo:       string | null
  idAb:        number | null
}

export type EsitoRisoluzione = 'trovato' | 'ambiguo' | 'non-trovato'

export interface RigaRisolta {
  /** Il testo come l'ha incollato l'operatore, per ritrovarlo nella tabella. */
  nominativo:          string
  numeroProvvedimento: string | null
  esito:               EsitoRisoluzione
  /** Valorizzati solo quando esito === 'trovato'. */
  matricola:           string | null
  idAb:                number | null
  nomeCompleto:        string | null
  ruolo:               string | null
  /** Su 'ambiguo': tutti i candidati, perche' scelga l'operatore. */
  candidati:           Candidato[]
}

/**
 * Normalizza per il confronto: maiuscole, via gli accenti, punteggiatura a spazio.
 *
 * L'apostrofo e' il caso che rompe tutto, ed e' frequentissimo nei cognomi
 * italiani: "D'Angelo" puo' stare in anagrafica come `D'ANGELO`, `DANGELO`
 * oppure `D ANGELO`, e le tre forme non si somigliano affatto dopo una
 * normalizzazione sola. Se ne producono quindi **due**:
 *   - `unito`:  l'apostrofo sparisce senza lasciare spazio → `DANGELO`
 *   - `diviso`: l'apostrofo diventa spazio → `D ANGELO` → token `ANGELO`
 * Il confronto prova entrambe: cosi' le tre grafie si trovano fra loro.
 */
export function normalizza(s: string, apostrofo: 'unito' | 'diviso' = 'unito'): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/['\u2019\u0060\u00b4]/g, apostrofo === 'unito' ? '' : ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

/** Token significativi: si scartano i frammenti di una lettera (iniziali puntate). */
export function tokens(s: string, apostrofo: 'unito' | 'diviso' = 'unito'): string[] {
  return normalizza(s, apostrofo).split(' ').filter(t => t.length > 1)
}

/**
 * Attacca le particelle di una lettera al token che segue: `D ANGELO` diventa
 * `DANGELO`. Copre il caso in cui l'apostrofo, in origine, e' stato scritto
 * come spazio — che capita, e che nessuna delle due grafie sopra recupera.
 */
function incolla(parti: string[]): string[] {
  const out: string[] = []
  let prefisso = ''
  for (const t of parti) {
    if (t.length === 1) prefisso += t
    else { out.push(prefisso + t); prefisso = '' }
  }
  return out
}

/**
 * Le grafie con cui confrontare una stringa. Tre, perche' le tre scritture di
 * un cognome con la particella non si somigliano dopo una sola normalizzazione:
 *   `DANGELO`  ·  `ANGELO` (particella persa)  ·  `DANGELO` (particella ricucita)
 * Il confronto riesce se **una qualsiasi** combacia.
 */
export function grafie(s: string): Array<Set<string>> {
  const a = tokens(s, 'unito')
  const b = tokens(s, 'diviso')
  const c = incolla(normalizza(s, 'diviso').split(' ').filter(Boolean))
  return [a, b, c].filter(x => x.length > 0).map(x => new Set(x))
}

function nomeCompletoDi(a: AnagraficaPerRicerca): string {
  const composto = [a.cognome, a.nome].filter(Boolean).join(' ').trim()
  return composto || (a.cognNome ?? '').trim() || a.matricola
}

/**
 * Token dell'anagrafica: si prendono da tutti i campi disponibili e in
 * **entrambe** le grafie dell'apostrofo. Qui l'unione e' voluta — sul lato
 * anagrafica conviene essere generosi, perche' non si sa come e' stata scritta.
 */
function tokensDi(a: AnagraficaPerRicerca): Set<string> {
  const campi = [a.cognNome ?? '', a.cognome ?? '', a.nome ?? '']
  return new Set(campi.flatMap(c => grafie(c).flatMap(g => [...g])))
}

/**
 * Token della sola grafia "ricucita": serve a misurare la corrispondenza esatta,
 * cioe' se la persona ha o no altri nomi oltre a quelli cercati. L'unione di
 * `tokensDi` non va bene per questo, perche' gonfia il conteggio.
 */
function tokensPrincipaliDi(a: AnagraficaPerRicerca): Set<string> {
  const campi = [a.cognNome ?? '', a.cognome ?? '', a.nome ?? '']
  return new Set(campi.flatMap(c => incolla(normalizza(c, 'diviso').split(' ').filter(Boolean))))
}

function toCandidato(a: AnagraficaPerRicerca): Candidato {
  return { matricola: a.matricola, nomeCompleto: nomeCompletoDi(a), ruolo: a.ruolo, idAb: a.idAb }
}

/**
 * Risolve UN nominativo contro l'anagrafica.
 *
 * Due passate, dalla piu' stretta alla piu' larga; si usa la prima che produce
 * risultati, cosi' una corrispondenza esatta non viene annegata dalle parziali:
 *   1. stessi token, in qualunque ordine  ("Giulia Bianchi" = "BIANCHI GIULIA");
 *   2. i token cercati sono tutti presenti ("Bianchi Giulia" dentro
 *      "BIANCHI GIULIA MARIA").
 * Se una matricola e' scritta al posto del nome, si risolve per matricola.
 */
export function risolviNominativo(
  nominativo: string,
  anagrafiche: AnagraficaPerRicerca[],
): { esito: EsitoRisoluzione; candidati: Candidato[] } {
  const forme = grafie(nominativo)
  if (forme.length === 0) return { esito: 'non-trovato', candidati: [] }

  // Caso "e' gia' una matricola": tutto cifre → confronto diretto (con padding).
  const soloCifre = normalizza(nominativo).replace(/ /g, '')
  if (/^\d+$/.test(soloCifre)) {
    const target = soloCifre.padStart(6, '0')
    const hit = anagrafiche.filter(a => a.matricola === target || a.matricola === soloCifre)
    return hit.length === 1
      ? { esito: 'trovato',     candidati: hit.map(toCandidato) }
      : { esito: hit.length === 0 ? 'non-trovato' : 'ambiguo', candidati: hit.map(toCandidato) }
  }

  const esatti:   AnagraficaPerRicerca[] = []
  const parziali: AnagraficaPerRicerca[] = []

  for (const a of anagrafiche) {
    const t = tokensDi(a)
    if (t.size === 0) continue
    // Basta che UNA delle grafie sia interamente contenuta.
    const forma = forme.find(f => [...f].every(x => t.has(x)))
    if (!forma) continue
    // Esatto = la persona non ha altri nomi oltre a quelli cercati.
    if (tokensPrincipaliDi(a).size === forma.size) esatti.push(a)
    else parziali.push(a)
  }

  const scelti = esatti.length > 0 ? esatti : parziali
  if (scelti.length === 0) return { esito: 'non-trovato', candidati: [] }
  if (scelti.length === 1) return { esito: 'trovato', candidati: scelti.map(toCandidato) }
  return { esito: 'ambiguo', candidati: scelti.map(toCandidato) }
}

/** Risolve l'intero elenco incollato. */
export function risolviElenco(
  righe: Array<{ nominativo: string; numeroProvvedimento?: string | null }>,
  anagrafiche: AnagraficaPerRicerca[],
): RigaRisolta[] {
  return righe.map(r => {
    const { esito, candidati } = risolviNominativo(r.nominativo, anagrafiche)
    const unico = esito === 'trovato' ? candidati[0]! : null
    return {
      nominativo:          r.nominativo,
      numeroProvvedimento: r.numeroProvvedimento?.trim() || null,
      esito,
      matricola:    unico?.matricola    ?? null,
      idAb:         unico?.idAb         ?? null,
      nomeCompleto: unico?.nomeCompleto ?? null,
      ruolo:        unico?.ruolo        ?? null,
      candidati:    esito === 'ambiguo' ? candidati : [],
    }
  })
}
