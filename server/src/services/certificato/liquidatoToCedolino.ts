// ============================================================
// PAYROLL GANG SUITE — Adapter: liquidato CINECA → CedolinoParsed
// Sorgente ALTERNATIVA al PDF per il certificato stipendiale.
// Costruisce la stessa struttura CedolinoParsed che il PDF produce, così
// il certificato riusa INVARIATO computeCertificato() + template DOCX.
//
// ⚠ La matematica NON viene reinventata: si riusa computeCertificato().
// L'unico input di dominio è la MAPPATURA codice-voce → sezione/descrizione
// (la tabella `mappa`), perché l'API dà solo i codici. La mappa di default
// contiene SOLO le voci verificate numericamente contro i fogli ufficio
// ("Calcolo x certificati"): STIPENDIO/IIS/IVC/Diff.IIS/IRPEF. Le altre
// (contributi, extraerariali, addizionali) vanno completate con l'ufficio.
// ============================================================

import type {
  CedolinoParsed, AnagraficaCedolino, VoceDettaglio, VoceTeorica,
  RiepilogoCedolino, SezioneCedolino,
} from '../cedolino/types.js'
import { computeCertificato } from '../cedolino/calculator.js'
import type { LiquidatoVoce } from '../verificaLiquidato/types.js'

/** Come classificare un codice voce del liquidato per il certificato. */
export interface VoceMap {
  sezione:     SezioneCedolino
  /** true = componente teorica (tabella RETRIBUZIONE del certificato). */
  teorica?:    boolean
  /** etichetta usata nel certificato (il match template è per keyword). */
  descrizione: string
}
export type MappaturaVoci = Record<string, VoceMap>

/**
 * Mappa VERIFICATA (numericamente, contro i fogli "Calcolo x certificati").
 * ⚠ INCOMPLETA di proposito: contiene solo ciò che è stato confermato.
 * Da completare con l'ufficio prima dell'uso in produzione:
 *  - contributi previdenziali carico dipendente (00901, 00903, …)
 *  - addizionali regionale/comunale
 *  - extraerariali (CRAL, sindacali, cessioni V, pignoramenti, buoni pasto…)
 *  - abbattimenti (Abb. TFR)
 */
export const MAPPA_VERIFICATA: MappaturaVoci = {
  '00010': { sezione: 'retribuzioni', teorica: true, descrizione: 'Stipendio' },
  '01251': { sezione: 'retribuzioni', teorica: true, descrizione: 'IIS' },
  '00265': { sezione: 'retribuzioni', teorica: true, descrizione: 'I.V.C. + Elemento perequativo' },
  '10266': { sezione: 'retribuzioni', teorica: true, descrizione: 'Differenziale indiv. IIS' },
  '00017': { sezione: 'retribuzioni', teorica: true, descrizione: 'Assegno ad personam' },
  '10265': { sezione: 'retribuzioni', teorica: true, descrizione: 'Differenziale indiv. Stipendio' },
  '00055': { sezione: 'retribuzioni', teorica: true, descrizione: 'IIS (professori)' },
  '00060': { sezione: 'retribuzioni', teorica: true, descrizione: 'Assegno aggiuntivo' },
  '00012': { sezione: 'retribuzioni', teorica: true, descrizione: 'Classi e scatti' },
  '00816': { sezione: 'fiscali_conguaglio', descrizione: 'Addizionale regionale' },
  '01797': { sezione: 'fiscali_conguaglio', descrizione: 'Addizionale comunale' },
  '02787': { sezione: 'fiscali_conguaglio', descrizione: 'Acconto addizionale comunale' },
  '00961': { sezione: 'fiscali_correnti', descrizione: 'Ritenute fiscali (IRPEF lorda)' },
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Estrae la scadenza da un riferimento tipo "DF@30/06/2028@". */
function scadenzaDaRiferimento(rif: string | null): string | null {
  if (!rif) return null
  const m = rif.match(/DF@(\d{2}\/\d{2}\/\d{4})@/)
  return m ? m[1] : null
}

export interface OpzioniAdapter {
  anagrafica: AnagraficaCedolino
  /** MM del cedolino (mese di erogazione) per marcare gli arretrati. */
  mese: string
  mappa?: MappaturaVoci
}

/**
 * Costruisce un CedolinoParsed dal dettaglio liquidato CINECA.
 * Le voci non presenti in `mappa` vengono ignorate (non finiscono nel
 * certificato) — così non si introducono importi non classificati.
 */
export function liquidatoToCedolino(
  dettaglio: LiquidatoVoce[],
  opts: OpzioniAdapter,
): CedolinoParsed {
  const mappa = opts.mappa ?? MAPPA_VERIFICATA
  const voci_dettaglio: VoceDettaglio[] = []
  const voci_teoriche: VoceTeorica[] = []

  for (const v of dettaglio) {
    if (v.flVoce !== true) continue          // scarta righe non-voce (datore/derivate)
    const map = mappa[v.voce]
    if (!map) continue                        // voce non classificata → esclusa
    const arretrato = v.flagc === '5' || v.flagc === '6' || v.dataCompVoce.slice(5, 7) !== opts.mese
    voci_dettaglio.push({
      sezione:     map.sezione,
      descrizione: map.descrizione,
      valore:      round2(v.importoTotale),
      numeri_riga: [],
      arretrato,
      conguaglio:  v.flagc === '6',
      scadenza:    scadenzaDaRiferimento(v.riferimento),
      decorrenza:  null,
    })
    if (map.teorica && !arretrato) {
      voci_teoriche.push({ descrizione: map.descrizione, valore: round2(v.importoTotale), totale: false })
    }
  }

  const sum = (s: SezioneCedolino) =>
    round2(voci_dettaglio.filter((x) => x.sezione === s).reduce((a, x) => a + x.valore, 0))

  const riepilogo_cedolino: RiepilogoCedolino = {
    retribuzioni:   sum('retribuzioni') + sum('accessorie'),
    accessorie:     sum('accessorie'),
    abbattimenti:   sum('abbattimenti'),
    contributi:     sum('contributi'),
    fiscali_totali: sum('fiscali_correnti') + sum('fiscali_conguaglio'),
    altre_ritenute: sum('sindacali') + sum('altre_ritenute'),
    netto_cedolino: null,
  }

  // Matematica del certificato: INVARIATA (stessa del percorso PDF).
  const certificato = computeCertificato(voci_teoriche, voci_dettaglio, riepilogo_cedolino)

  return { anagrafica: opts.anagrafica, voci_teoriche, voci_dettaglio, riepilogo_cedolino, certificato }
}
