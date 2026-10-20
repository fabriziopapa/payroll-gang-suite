// ============================================================
// PAYROLL GANG SUITE — Area Emolumenti · mese di liquidazione e nome
//
// Il nome di una lavorazione porta quasi sempre il mese in cui si paga
// ("Dottorati di Ricerca (DR) Maggiorazioni Ottobre 2026"), e lo stesso mese
// sta in «Liquidazione di». Sono due campi scritti a mano: se divergono, uno
// dei due e' un refuso. Qui si riconosce il mese nel nome e lo si sostituisce
// senza toccare il resto. Nessun controllo bloccante: la pagina mostra solo
// un suggerimento, e decide chi lavora.
// ============================================================

export const MESI_LUNGHI_IT = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
] as const

/** "nome del mese" + spazi + anno a quattro cifre, come parola intera. */
const RE_MESE_ANNO = new RegExp(
  `(?<![\\p{L}\\d])(${MESI_LUNGHI_IT.join('|')})\\s+(\\d{4})(?![\\p{L}\\d])`,
  'giu',
)

export interface MeseNelNome {
  /** 'AAAA-MM', come «Liquidazione di». */
  chiave: string
  /** Posizione nel nome della parte riconosciuta, per sostituirla. */
  inizio: number
  fine:   number
  /** La parola del mese cosi' come e' scritta (per conservarne le maiuscole). */
  parola: string
}

/**
 * Il mese e l'anno scritti nel nome. Se ce ne sono piu' d'uno vale l'ULTIMO:
 * nei nomi d'ufficio il periodo sta in coda ("… Maggiorazioni Ottobre 2026").
 */
export function meseNelNome(nome: string): MeseNelNome | null {
  let ultimo: MeseNelNome | null = null
  for (const m of nome.matchAll(RE_MESE_ANNO)) {
    const i = MESI_LUNGHI_IT.indexOf(m[1]!.toLowerCase() as typeof MESI_LUNGHI_IT[number])
    ultimo = {
      chiave: `${m[2]}-${String(i + 1).padStart(2, '0')}`,
      inizio: m.index!,
      fine:   m.index! + m[0].length,
      parola: m[1]!,
    }
  }
  return ultimo
}

/** 'AAAA-MM' -> "ottobre 2026". Stringa vuota se la chiave non e' valida. */
export function etichettaMeseLiq(k: string): string {
  const m = k.match(/^(\d{4})-(0[1-9]|1[0-2])$/)
  return m ? `${MESI_LUNGHI_IT[Number(m[2]) - 1]} ${m[1]}` : ''
}

/** Stesse maiuscole della parola di partenza: "Ottobre", "OTTOBRE", "ottobre". */
function comeScritto(modello: string, parola: string): string {
  if (modello === modello.toUpperCase()) return parola.toUpperCase()
  if (modello[0] === modello[0]!.toUpperCase()) return parola[0]!.toUpperCase() + parola.slice(1)
  return parola
}

/**
 * Il nome con il mese e l'anno sostituiti da quelli di `k` ('AAAA-MM').
 * Il resto del nome resta com'e'. Se il nome non contiene un mese, o la
 * chiave non e' valida, torna null: la pagina allora genera il nome da zero.
 */
export function conMeseNelNome(nome: string, k: string): string | null {
  const m = meseNelNome(nome)
  const nuovo = etichettaMeseLiq(k)
  if (!m || !nuovo) return null
  const [mese, anno] = nuovo.split(' ') as [string, string]
  return nome.slice(0, m.inizio) + `${comeScritto(m.parola, mese)} ${anno}` + nome.slice(m.fine)
}

/**
 * Il mese scritto nel nome, se e' DIVERSO da quello di liquidazione. null se
 * coincidono, se il nome non ne contiene uno o se la liquidazione non e'
 * ancora indicata (in quel caso lo dice gia' l'etichetta «da indicare»).
 */
export function meseNomeDiverso(nome: string, meseLiquidazione: string): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(meseLiquidazione)) return null
  const m = meseNelNome(nome)
  return m && m.chiave !== meseLiquidazione ? m.chiave : null
}

/** Mese 'AAAA-MM' di una data 'AAAA-MM-GG'; '' se non ha quella forma. */
function meseDellaData(data: string | null | undefined): string {
  const m = (data ?? '').match(/^(\d{4})-(0[1-9]|1[0-2])-\d{2}$/)
  return m ? `${m[1]}-${m[2]}` : ''
}

export interface PillolaLiquidazione {
  /** "settembre 2026", oppure '' se il mese non si conosce. */
  etichetta: string
  /** Ambra: mese sconosciuto, oppure il nome o la data dicono un altro mese. */
  ambra:     boolean
  /** Spiegazione per il tooltip. */
  titolo:    string
}

/**
 * La pillola del mese di liquidazione (elenco e intestazione dell'editor).
 *
 * Vale il mese di «Liquidazione di». Se manca — lavorazioni archiviate prima
 * della 26.10.10.2, quando il campo si poteva lasciare vuoto — si usa il mese
 * della DATA di liquidazione scritta all'archiviazione. Solo visualizzazione:
 * nessun dato salvato cambia.
 *
 * Ambra se il mese non si conosce, se il nome dice un altro mese o se
 * «Liquidazione di» e data di liquidazione non coincidono (26.10.20.1).
 */
export function pillolaLiquidazione(
  nome:             string,
  meseLiquidazione: string | null | undefined,
  dataLiquidazione: string | null | undefined,
): PillolaLiquidazione {
  const scelto = /^\d{4}-(0[1-9]|1[0-2])$/.test(meseLiquidazione ?? '') ? meseLiquidazione! : ''
  const daData = meseDellaData(dataLiquidazione)
  const mese   = scelto || daData
  if (!mese) {
    return { etichetta: '', ambra: true, titolo: 'Mese in cui si paga: da indicare in «Liquidazione di»' }
  }

  const avvisi: string[] = []
  const nomeDice = meseNomeDiverso(nome, mese)
  if (nomeDice) avvisi.push(`Il nome dice ${etichettaMeseLiq(nomeDice)}`)
  if (scelto && daData && daData !== scelto) {
    avvisi.push(`La data di liquidazione (${dataLiquidazione}) dice ${etichettaMeseLiq(daData)}`)
  }

  return {
    etichetta: etichettaMeseLiq(mese),
    ambra:     avvisi.length > 0,
    titolo:    avvisi.length > 0
      ? avvisi.join(' · ')
      : scelto
        ? 'Mese in cui si paga (Liquidazione di)'
        : `Dal giorno di liquidazione ${dataLiquidazione}`,
  }
}
