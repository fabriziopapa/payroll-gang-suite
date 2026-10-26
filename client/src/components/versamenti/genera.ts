// ============================================================
// PAYROLL GANG SUITE — Versamenti enti · dall'ente aggregato all'EML
// ============================================================

import type { EnteAggregato } from '../../utils/versamentiCsv'
import { allegatiPer, nomeFile, type Allegato } from '../../utils/versamentiAllegati'
import { applica, contesto, periodoFile, type ModelloVersamento } from '../../utils/versamentiModelli'
import { costruisciEml } from '../../utils/versamentiEml'

export interface EmlPronto {
  nomeFile:  string
  sorgente:  string
  da:        string
  a:         string[]
  oggetto:   string
  testo:     string
  allegati:  Allegato[]
  mesi:      string[]
  righe:     number
  modello:   ModelloVersamento
}

/**
 * Gli EML di un ente: uno con tutti i mesi selezionati, oppure (perMese)
 * uno per ciascun mese in cui l'ente compare.
 */
export async function emlPerEnte(
  ente: EnteAggregato, descr: string, email: string[], modello: ModelloVersamento,
  perMese: boolean, mittente: string,
): Promise<EmlPronto[]> {
  const gruppi = perMese ? ente.mesi.map(m => [m]) : [ente.mesi]
  const out: EmlPronto[] = []
  for (const mesi of gruppi) {
    const set = new Set(mesi)
    const righe = ente.righe.filter(r => set.has(r.mese))
    // Il periodo della mail: il mese del gruppo, oppure il «da … a …» di un file senza colonna del mese.
    const periodo = gruppi.length > 1 ? mesi : ente.periodo
    const ctx = contesto(ente.codice, descr, righe, periodo)
    const allegati = await allegatiPer(ente.codice, descr, righe, mesi, modello.allegati, perMese, undefined, periodo)
    const oggetto = applica(modello.oggetto, ctx)
    const testo = applica(modello.testo, ctx)
    out.push({
      nomeFile: nomeFile(modello.allegati.nomeEml, { CODICE_ENTE: ente.codice, PERIODO_FILE: periodoFile(periodo) }, 'eml', perMese),
      sorgente: costruisciEml({ da: mittente, a: email, oggetto, testo, allegati }),
      da: mittente, a: email, oggetto, testo, allegati, mesi: periodo, righe: righe.length, modello,
    })
  }
  return out
}
