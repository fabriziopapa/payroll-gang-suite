// ============================================================
// PAYROLL GANG SUITE — Area del conto di accredito
//
// UNA SOLA REGOLA, IN UN SOLO POSTO. Questo modulo e' la classificatrice
// condivisa fra i due consumatori che oggi chiedono la stessa cosa:
//   · l'import dell'anagrafica, che riceve la nazione da Oracle;
//   · la funzione Tipi conto, che riceve `nazIban` dalle testate CSA.
//
// PERCHE' NON STA IN SQL. Fino a oggi la regola viveva dentro un CASE
// dell'estrazione Oracle. Conseguenza misurata: l'elenco SEPA li' dentro
// aveva 36 prefissi invece di 42 — mancavano AL GI MD ME MK RS — e chi
// era pagato su un IBAN albanese, moldavo, montenegrino, macedone, serbo
// o di Gibilterra risultava EXTRA_UE. Una regola in SQL non si testa, non
// si versiona insieme a chi la consuma e non si puo' condividere con una
// funzione che legge da un'API REST. Qui si testa, e i test sono accanto.
//
// LA SORGENTE DA' I FATTI, L'APPLICAZIONE APPLICA LE REGOLE.
// L'estrazione deve restituire due lettere, non un giudizio: un archivio
// che tiene le conclusioni e scarta le premesse non si puo' correggere,
// si puo' solo rifare. Con la nazione conservata, cambiare l'elenco EPC
// e' un file piu' un ricalcolo — senza tornare in Oracle.
//
// PRIVACY: qui entra ed esce SOLO il codice nazione a due lettere. Mai un
// IBAN, nemmeno parziale o mascherato.
// ============================================================

/**
 * Elenco dei prefissi IBAN dell'area SEPA.
 *
 * FONTE: EPC409-09 "EPC List of SEPA Scheme Countries", versione 8.0,
 * 24 dicembre 2025. 42 prefissi.
 *
 * Un elenco e' un dato con una data: va scritto con la sua fonte e la sua
 * versione, altrimenti invecchia senza che nessuno se ne accorga. Quando
 * EPC pubblica una versione nuova si cambia QUESTO file, si alza
 * EPC_VERSIONE, e si lancia il ricalcolo: la differenza si vede prima di
 * essere scritta.
 *
 * NB: gli otto codici ISO d'oltremare francesi (GF GP MQ YT RE BL MF PM)
 * non compaiono perche' i loro IBAN iniziano per FR. Qui conta il
 * PREFISSO IBAN, non il codice del territorio.
 */
export const EPC_VERSIONE = 'v8.0' as const
export const EPC_DATA     = '2025-12-24' as const

export const PREFISSI_SEPA: ReadonlySet<string> = new Set([
  'AD', 'AL', 'AT', 'BE', 'BG', 'CH', 'CY', 'CZ', 'DE', 'DK',
  'EE', 'ES', 'FI', 'FR', 'GB', 'GI', 'GR', 'HR', 'HU', 'IE',
  'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MC', 'MD', 'ME', 'MK',
  'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'SE', 'SI', 'SK',
  'SM', 'VA',
])

/**
 * I valori di dominio, quelli gia' in uso in `anagrafiche.area_conto`
 * (migrazione 0011) e mostrati da AnagrafichePage ed EmolumentiPage.
 *
 * NB: 'ITA' non e' un valore di dominio — e' come si chiama il FILE
 * (DR_09_26_ITA.txt). Presentazione, non dominio: la conversione sta
 * dove si costruisce il nome del file, non qui.
 *
 * NB: 'DA_CHIARIRE' non e' un valore di questa funzione. E' un'ESCLUSIONE
 * CON MOTIVO, e il motivo lo conosce chi chiama, non chi classifica:
 * "nessuna coordinata attiva" e "coordinata senza nazione" arrivano
 * entrambe qui come assenza di nazione, ma si risolvono in due modi
 * diversi. Appiattirle in una sola etichetta e' il difetto che questo
 * modulo esiste per non ripetere.
 */
export type AreaConto = 'IT' | 'SEPA' | 'EXTRA_UE' | 'NON_NOTO'

/**
 * Classifica una nazione IBAN.
 *
 * @param nazIban codice ISO 3166-1 alpha-2 del PAESE DELL'IBAN — non del
 *                BIC, non della banca. Un conto italiano puo' stare su una
 *                banca estera: `REVOITM2` (Revolut) e `BPPIITRRXXX` (Poste)
 *                hanno entrambi IBAN italiani. Classificare dal BIC li
 *                manderebbe fuori dall'Italia.
 * @returns       'IT' | 'SEPA' | 'EXTRA_UE' | 'NON_NOTO'
 *
 * Assente, vuoto o non nel formato di due lettere -> 'NON_NOTO'.
 * Il chiamante che sa PERCHE' manca lo registra a parte.
 */
export function areaConto(nazIban: string | null | undefined): AreaConto {
  if (nazIban === null || nazIban === undefined) return 'NON_NOTO'

  const naz = String(nazIban).trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(naz)) return 'NON_NOTO'

  if (naz === 'IT')            return 'IT'
  if (PREFISSI_SEPA.has(naz))  return 'SEPA'
  return 'EXTRA_UE'
}

/**
 * Il segmento di nome file per un'area. Qui, e solo qui, 'IT' diventa
 * 'ITA': il file si chiama DR_09_26_ITA.txt perche' cosi' l'ha chiesto
 * l'ufficio, non perche' il dominio conosca quella sigla.
 */
export function segmentoNomeFile(area: Exclude<AreaConto, 'NON_NOTO'>): string {
  return area === 'IT' ? 'ITA' : area
}
