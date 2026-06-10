// ============================================================
// PAYROLL GANG SUITE — Tipi dominio "PDF Region Editor"
// Porting ESATTO dei contratti locked in Gate 2 (gate2-contratti-api-ts-
// pdf-region-editor.md §A) — nessuna variazione qui, il design è chiuso.
// Strada A pura: ParteVoce.sezione è già un SezioneCedolino — passthrough
// identità verso computeCertificato/merge/docx, zero traduzione.
// ============================================================

import type { SezioneCedolino, CedolinoParsed } from '../cedolino/types.js'

/** Geometria pagina — ancoraggio robustezza multi-pagina/zoom/rotazione.
 *  widthPt/heightPt in PUNTI PDF nativi (pdfjs getViewport().width/height @ scale 1). */
export interface PageGeometry {
  pageIndex: number
  widthPt:   number
  heightPt:  number
  rotation:  0 | 90 | 180 | 270
}

/** Rettangolo regione — coordinate percentuali 0..1 relative alla pagina. */
export interface RegionRect {
  pageIndex: number
  x:         number
  y:         number
  width:     number
  height:    number
}

export type AnagraficaRuolo =
  | 'matricola' | 'cognome_nome' | 'periodo_retribuzione'
  // campi 1:1 su AnagraficaCedolino (stesso nome) — mirror parser dinamico.
  // PRIVACY: niente IBAN/banca/CF nucleo familiare (come il parser).
  | 'codice_fiscale' | 'data_nascita' | 'luogo_nascita'
  | 'inquadramento' | 'area_profilo' | 'ruolo'
  | 'inizio_rapporto' | 'anzianita_servizio' | 'afferenza' | 'sede'

/** Parte anagrafica — 1 sola regione, NIENTE coppia descrizione/importo né sezione/segno
 *  (discriminated union: il compilatore impedisce accessi ambigui a campi dell'altro ramo). */
export interface ParteAnagrafica {
  kind:    'anagrafica'
  id:      string
  label:   string
  ruolo:   AnagraficaRuolo
  regione: RegionRect
}

/** Parte voce — coppia di regioni + attributi calcolo. Strada A pura: `sezione` diretta,
 *  passthrough identità verso il calcolatore esistente, zero traduzione. */
export interface ParteVoce {
  kind:                'voce'
  id:                  string
  label:               string
  regioneDescrizione:  RegionRect
  regioneImporto:      RegionRect
  sezione:             SezioneCedolino
  sign:                '+' | '-'
  isArretrato:         boolean
  decorrenza?:         string | null   // ISO 8601 — solo sezione 'sindacali'/'altre_ritenute'
  scadenza?:           string | null
}

/** Discriminated union — il compilatore forza la gestione esplicita di entrambi i casi. */
export type ParteTemplate = ParteAnagrafica | ParteVoce

/** Template di riconoscimento layout — persistito, versionato, IMMUTABILE.
 *  Riuso SEMPRE manuale (mai automatch — vincolo Gate 0 confermato). */
export interface PdfRegionTemplate {
  id:                    string   // identifica QUESTA riga/versione
  templateFamilyId:      string   // stabile fra versioni — identifica la lineage
  nome:                  string
  nota:                  string | null
  versione:              number   // 1, 2, 3... interno, garantisce unicità/ordinamento
  versioneLabel:         string   // "AA.MM.GG" — convenzione APP_VERSION, es. "26.06.06"
  attivo:                boolean  // auto-versioning: nuova versione = attiva, precedente disattivata in tx
  pageGeometry:          PageGeometry[]
  parti:                 ParteTemplate[]
  /** FK → templati_certificato.id — fissato alla CREAZIONE (Gate 1 Q6), mai modificabile */
  certificatoTemplateId: string
  createdBy:             string | null
  createdAt:             string   // ISO
  updatedAt:             string   // ISO
}

export interface AdattatoreWarning {
  tipo:      'TEO_MANCANTE' | 'IMPORTO_NON_LETTO' | 'RIEPILOGO_SINTETIZZATO'
  campo?:    string
  parteId?:  string
  messaggio: string
}

export interface AdattatoreError {
  tipo:      'REGIONE_VUOTA' | 'IMPORTO_NON_PARSABILE' | 'PAGINA_FUORI_RANGE' | 'ANAGRAFICA_INCOMPLETA'
  parteId?:  string
  messaggio: string
}

/** Risposta endpoint estrazione — preview, NESSUNA persistenza (mirror /certificati/parse). */
export interface ExtractPreviewResult {
  parsed:   CedolinoParsed
  warnings: AdattatoreWarning[]
  errors:   AdattatoreError[]   // se non vuoto, client blocca generazione finché non corretto in anteprima
}
