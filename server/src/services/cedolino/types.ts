// ============================================================
// PAYROLL GANG SUITE — Tipi parser/calcolo cedolino Cineca
// Riscrittura TS della "specifica eseguibile" cedolino_parser.py
// ============================================================

/** Sezioni del tracciato Cineca (ancore stabili) */
export type SezioneCedolino =
  | 'retribuzioni'
  | 'accessorie'
  | 'contributi'
  | 'fiscali_correnti'
  | 'fiscali_conguaglio'
  | 'sindacali'
  | 'altre_ritenute'

/** Anagrafica estratta dall'header del cedolino.
 *  PRIVACY (opzione A): iban e CF nucleo NON vengono estratti. */
export interface AnagraficaCedolino {
  periodo_retribuzione: string | null
  matricola:            string | null
  cognome:              string | null
  nome:                 string | null
  codice_fiscale:       string | null
  data_nascita:         string | null
  luogo_nascita:        string | null
  inquadramento:        string | null
  area_profilo:         string | null
  ruolo:                string | null
  inizio_rapporto:      string | null
  anzianita_servizio:   string | null
  afferenza:            string | null
  sede:                 string | null
  // Campi derivati aggiunti in fase di merge (template)
  inquadramento_label?: string
  settore?:             string
}

export interface VoceTeorica {
  descrizione: string
  valore:      number | null
  totale:      boolean
}

export interface VoceDettaglio {
  sezione:     SezioneCedolino | null
  descrizione: string
  valore:      number
  numeri_riga: number[]
  arretrato:   boolean
  conguaglio:  boolean
  scadenza:    string | null
  decorrenza:  string | null
}

export interface RiepilogoCedolino {
  retribuzioni:   number | null
  accessorie:     number | null
  contributi:     number | null
  fiscali_totali: number | null
  altre_ritenute: number | null
  netto_cedolino: number | null
}

export interface ExtraerarialeRiga {
  descrizione: string
  decorrenza:  string | null
  scadenza:    string | null
  valore:      number | null
}

/** Risultato del ricalcolo certificato (regole Excel ufficio) */
export interface CertificatoCalcolato {
  lordo_teorico:          number | null
  ritenute_fiscali:       number | null
  ritenute_previdenziali: number | null
  netto_ritenute_legge:   number | null
  extraerariali_totale:   number | null
  extraerariali_righe:    ExtraerarialeRiga[]
  netto_a_pagare:         number | null
  quinto:                 number | null
  settimo:                number | null
}

/** Output completo del parser — serializzato in certificati.dati_json */
export interface CedolinoParsed {
  anagrafica:      AnagraficaCedolino
  voci_teoriche:   VoceTeorica[]
  voci_dettaglio:  VoceDettaglio[]
  riepilogo_cedolino: RiepilogoCedolino
  certificato:     CertificatoCalcolato
}
