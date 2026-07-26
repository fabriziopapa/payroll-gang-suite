// ============================================================
// PAYROLL GANG SUITE — Verifica liquidato: tipi
// Struttura del dettaglio CINECA (/v1/liquidazioni/liquidato/dettaglio)
// e delle strutture di riconciliazione con gli invii PGS.
// ============================================================

/** Riga grezza del dettaglio liquidato CINECA. */
export interface LiquidatoVoce {
  flVoce:            boolean
  anno:              string
  mese:              string
  oggetto:           string
  progrLiquidazione: string
  comparto:          string
  ruolo:             string
  matricola:         string
  capitolo:          string
  flagc:             string
  /** competenza inizio (YYYY-MM-DD) */
  dataComp:          string
  voce:              string
  progrVoce:         string
  /** competenza voce (YYYY-MM-DD) — chiave di join lato periodo */
  dataCompVoce:      string
  aliquota:          number
  parti:             number
  importo:           number
  importoTotale:     number
  giaLiquidato:      number
  divisa:            string
  ente:              string
  riferimento:       string | null
  idCompenso:        number
  idContrattoCsa:    number
}

/** Riga PGS (derivata dall'export CSV / bozza) da confrontare col liquidato. */
export interface RigaPGS {
  matricola:          string
  voce:               string   // codiceVoce
  capitolo:           string   // codiceCapitolo
  dataCompetenzaVoce: string   // YYYY-MM-DD
  riferimento:        string   // riferimentoCedolino (TL@..@ / WD@ / WE@ / testo)
  importo:            number
  parti?:             number
  flagParti?:         boolean
}

export type ClasseInvio =
  | 'NUOVO'
  | 'CONGUAGLIO_TARIFFA'
  | 'STORNO'
  | 'RETTIFICA_ANNULLO'
  | 'RETTIFICA'

export interface RigaRicostruita {
  chiave:            string
  matricola:         string
  voce:              string
  capitolo:          string
  dataCompVoce:      string
  riferimento:       string | null
  riferimentoNorm:   string | null
  modalita:          'importo' | 'parti'
  progrLiquidazione: string
  nRighe:            number
  tipo:              ClasseInvio
  /** valorizzati per tipo */
  importoTotale?:    number   // NUOVO
  parti?:            number   // NUOVO (parti)
  importoUnitario?:  number   // NUOVO (parti)
  valore?:           number   // STORNO
  valoreNetto?:      number   // CONGUAGLIO / RETTIFICA
}

export interface Ricostruzione {
  inviiPGS:   RigaRicostruita[]
  conguagli:  RigaRicostruita[]
  storni:     RigaRicostruita[]
  rettifiche: RigaRicostruita[]
}

export interface Abbinamento {
  chiave:    string
  pgs:       RigaPGS
  cineca:    RigaRicostruita
  valoreOk:  boolean
}

export interface RisultatoRiconciliazione extends Ricostruzione {
  abbinati:    Abbinamento[]
  soloPGS:     RigaPGS[]
  soloCineca:  RigaRicostruita[]
  ambigui:     (Abbinamento & { candidati: number })[]
}
