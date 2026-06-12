// ============================================================
// PAYROLL GANG SUITE — Tipi e Interfacce
// Agente DATA — Fase 0
// ============================================================

// ------------------------------------------------------------
// APP
// ------------------------------------------------------------

export const APP_NAME = 'Payroll Gang Suite' as const;
export const APP_VERSION = '26.06.12' as const;

// ------------------------------------------------------------
// RUOLI
// ------------------------------------------------------------

/**
 * Il ruolo è una stringa libera perché il file anagrafica HR
 * contiene decine di codici (AR, AS, AU, BE, BS, CC, DR, PA, ND…).
 * Solo i ruoli presenti in RUOLI_CON_SCORPORO possono avere
 * il flag scorporo abilitato.
 */
export type Ruolo = string;

/** Codici ruolo per cui lo scorporo è applicabile */
export type RuoloScorporabile = 'PA' | 'PO' | 'RD' | 'RU' | 'ND';

// ------------------------------------------------------------
// NOMINATIVO
// ------------------------------------------------------------

/** Indica come il nominativo è stato aggiunto alla bozza */
export type OrigineNominativo = 'pdf' | 'manuale';

/** Singola voce del budget interno di un nominativo */
export interface ImportoBudgetItem {
  id:          string
  descrizione: string
  importo:     number
}

/**
 * Rappresenta una persona fisica associata a un DettaglioLiquidazione.
 * Può provenire dal PDF (mock OCR) o essere inserita manualmente.
 */
export interface Nominativo {
  id: string;
  matricola: string;
  /** Formato: "COGNOME Nome" — come da XML HR (COGN_NOME) */
  cognomeNome: string;
  codFisc?: string;
  /** Codice breve ruolo (es. "PA", "ND", "AR") */
  ruolo: Ruolo;
  /** Descrizione estesa ruolo (es. "Professori Associati") */
  druolo: string;
  /** ID del DettaglioLiquidazione a cui è associato */
  dettaglioId: string;
  /**
   * Importo lordo carico ente (da PDF mock o inserito manualmente).
   * Può essere negativo (es. recuperi).
   */
  importoLordo: number;
  origine: OrigineNominativo;
  /**
   * true quando il ruolo è stato modificato manualmente (doppio click).
   * "Aggiorna Ruolo" chiede conferma prima di sovrascrivere.
   * Resettato a false dopo un aggiornamento automatico riuscito da DB.
   */
  ruoloModificato?: boolean;
  /**
   * Data fine rapporto (YYYY-MM-DD) dall'anagrafica al momento dell'aggiunta.
   * null/undefined = attivo o dato non disponibile.
   * Se precedente alla data competenza voce → badge rosso cessazione in DettaglioCard.
   * Per i nominativi pre-esistenti viene popolata dal tasto "Aggiorna Ruolo".
   */
  finRap?: string | null;
  /**
   * Voci di budget interne. Se presente, importoLordo = sum(importoBudget[].importo).
   * Opzionale per backward compat: nominativi senza budget usano solo importoLordo.
   */
  importoBudget?: ImportoBudgetItem[];
}

// ------------------------------------------------------------
// VOCI E CAPITOLI (da XML Lista_voci)
// ------------------------------------------------------------

export interface CapitoloItem {
  /** Codice numerico, es. "000100" */
  codice: string;
  /** Descrizione, es. "Stipendio personale universitario" */
  descrizione: string;
}

/**
 * Voce di bilancio estratta dall'XML HR.
 * COD_DESCR viene separato in codice + descrizione.
 * Ogni voce può avere più capitoli associati (per periodo).
 */
export interface VoceItem {
  /** Codice numerico, es. "00068" */
  codice: string;
  /** Descrizione, es. "Fondo di Incentivazione" */
  descrizione: string;
  /** Formato YYYYMMDD, es. "20090101" */
  dataIn: string;
  /** Formato YYYYMMDD — "22220202" = illimitato */
  dataFin: string;
  tipo: string;
  capitoli: CapitoloItem[];
}

// ------------------------------------------------------------
// TAG CEDOLINO
// ------------------------------------------------------------

export interface TagCedolino {
  /** Prefisso del tag, es. "TL" */
  prefisso: string;
  /** true = built-in (non eliminabile), false = aggiunto dall'utente */
  builtin: boolean;
}

// ------------------------------------------------------------
// DETTAGLIO LIQUIDAZIONE
// ------------------------------------------------------------

/**
 * Gruppo logico che raccoglie uno o più Nominativi sotto gli stessi
 * parametri di liquidazione. Corrisponde a una riga nel CSV HR
 * per ogni nominativo associato.
 */
export interface DettaglioLiquidazione {
  /** ID univoco generato automaticamente, es. "DET-001" */
  id: string;
  /** Colore HEX dalla palette round-robin */
  colore: string;
  /** Nome descrittivo inserito dall'utente, es. "TFA Sostegno Nov 2026" */
  nomeDescrittivo: string;

  // --- Voce e Capitolo ---
  /** Codice voce, es. "00068" (codiceVoce nel CSV) */
  voce: string;
  /** Codice capitolo, es. "004665" (codiceCapitolo nel CSV) */
  capitolo: string;

  // --- Competenza ---
  /** Formato "MM/YYYY", es. "04/2026" */
  competenzaLiquidazione: string;
  /**
   * Formato ISO "YYYY-MM-DD", default = ultimo giorno del mese di competenza.
   * Mappato su dataCompetenzaVoce nel CSV.
   */
  dataCompetenzaVoce: string;

  // --- Scorporo ---
  flagScorporo: boolean;
  /**
   * Modalità di scorporo attiva.
   * - 'standard'   : usa coefficienti normali (default)
   * - 'contoterzi' : usa coefficientiContoTerzi
   * undefined = 'standard' per backward compat con bozze esistenti
   */
  tipoScorporo?: 'standard' | 'contoterzi';

  // --- Riferimento cedolino ---
  /** Es. "TL@TFA SOSTEGNO 2023 2024@" */
  riferimentoCedolino: string;

  // --- Dati provvedimento (tutti editabili, generati da CSA) ---
  /** 9 cifre, es. "000000000" */
  identificativoProvvedimento: string;
  /** Default "000", configurabile in Impostazioni */
  tipoProvvedimento: string;
  numeroProvvedimento: string;
  /** Formato DD/MM/YYYY, es. "10/04/2026" */
  dataProvvedimento: string;

  // --- Parametri CSV avanzati (da Impostazioni, override per dettaglio) ---
  aliquota: number;
  parti: number;
  flagAdempimenti: number;
  idContrattoCSA: string;

  // --- Campi aggiuntivi ---
  centroCosto: string;
  note: string;
  /**
   * true quando la data di competenza voce è successiva all'ultimo import anagrafiche.
   * Segnalato da ⚠ sulla DettaglioCard. Reset automatico al prossimo salvataggio.
   */
  anagraficheOutdated?: boolean;
  /**
   * Username di chi ha modificato per ultimo il gruppo (impostato automaticamente dallo store).
   * Mostrato come badge nell'header della DettaglioCard.
   */
  modifiedBy?: string;
}

// ------------------------------------------------------------
// PROTOCOLLO PDF (display only)
// ------------------------------------------------------------

/**
 * Dati estratti (mock) dal PDF del provvedimento.
 * Il campo protocolloDisplay è solo per la UI — i campi
 * identificativoProvvedimento/dataProvvedimento nel DettaglioLiquidazione
 * sono quelli effettivamente usati per il CSV.
 */
export interface DatiPDF {
  /** Formato display: "0012345/2026 del 10/04/2026" */
  protocolloDisplay: string;
  nominativi: Array<{
    cognomeNome: string;
    matricola: string;
    ruolo: Ruolo;
    importoLordo: number;
  }>;
}

// ------------------------------------------------------------
// BOZZA / ARCHIVIO
// ------------------------------------------------------------

export type StatoBozza = 'bozza' | 'archiviata';

export interface Bozza {
  id: string;
  nome: string;
  /** ISO timestamp */
  dataCreazione: string;
  /** ISO timestamp */
  dataUltimaModifica: string;
  stato: StatoBozza;
  /** Stringa display del protocollo caricato da PDF (se presente) */
  protocolloDisplay: string;
  liquidazioni: DettaglioLiquidazione[];
  nominativi: Nominativo[];
}

// ------------------------------------------------------------
// COMUNICAZIONI
// ------------------------------------------------------------

/** Contatto della rubrica globale */
export interface Contatto {
  id:     string;
  nome:   string;
  email:  string;
  ruolo?: string;
}

/** Template di comunicazione riutilizzabile */
export interface ModelloComunicazione {
  id:      string;
  nome:    string;
  oggetto: string;
  corpo:   string;
}

export type StatoComunicazione = 'bozza' | 'validata';

/** Comunicazione legata a un DettaglioLiquidazione — salvata nel JSONB della bozza */
export interface Comunicazione {
  id:            string;
  dettaglioId:   string;
  stato:         StatoComunicazione;
  destinatari:   Array<{ nome: string; email: string }>;
  oggetto:       string;
  corpo:         string;
  /** Codici dei campi del dettaglio inclusi nell'allegato HTML */
  campiAllegato: string[];
  createdAt:     string;
  updatedAt:     string;
}

// ------------------------------------------------------------
// IMPOSTAZIONI APPLICAZIONE
// ------------------------------------------------------------

/**
 * Mappa aperta ruolo → coefficiente di scorporo.
 * Supporta qualsiasi codice ruolo (non solo i 5 predefiniti).
 */
export type ScorporoMap = Record<string, number>

/**
 * Alias mantenuto per backward compatibility.
 * Ora è semplicemente un alias di ScorporoMap.
 */
export type CoefficienteScorporo = ScorporoMap;

/**
 * Parametri CSV avanzati — configurabili in Impostazioni.
 * Vengono copiati come default in ogni nuovo DettaglioLiquidazione.
 */
export interface CsvDefaults {
  tipoProvvedimento: string;
  aliquota: number;
  parti: number;
  flagAdempimenti: number;
  idContrattoCSA: string;
}

/** Stato globale delle impostazioni dell'applicazione */
export interface AppSettings {
  coefficienti:             ScorporoMap;
  /** Coefficienti per scorporo conto terzi (mappa aperta ruolo→coeff). */
  coefficientiContoTerzi?:  ScorporoMap;
  csvDefaults:              CsvDefaults;
  tags:                     TagCedolino[];
  rubrica:                  Contatto[];
  modelliComunicazione:     ModelloComunicazione[];
  /** Protezione bot Cloudflare Turnstile — default true. Disabilitabile da admin. */
  turnstileEnabled?:        boolean;
  /** Kill-switch modulo Certificati PDF (region editor/templates) — default false. Abilitabile da admin. */
  pdfRegionEditorEnabled?:  boolean;
  /** Modalità di assolvimento marca da bollo per i certificati — lista
   *  modificabile da Impostazioni; alla generazione l'operatore ne sceglie una. */
  bolloOpzioni?:            string[];
}

/** Default modalità assolvimento marca da bollo (seed lista bolloOpzioni). */
export const DEFAULT_BOLLO_OPZIONI: string[] = [
  'MARCA DA BOLLO DA EURO 16,00\nASSOLTA TRAMITE BONIFICO',
];

// ------------------------------------------------------------
// CSV EXPORT ROW (struttura della riga CSV HR)
// ------------------------------------------------------------

/** Rappresenta una singola riga del file CSV HR esportato */
export interface CsvExportRow {
  matricola: string;
  comparto: '1';
  ruolo: string;
  codiceVoce: string;
  identificativoProvvedimento: string;
  tipoProvvedimento: string;
  numeroProvvedimento: string;
  dataProvvedimento: string;
  annoCompetenzaLiquidazione: string;
  meseCompetenzaLiquidazione: string;
  dataCompetenzaVoce: string;
  codiceStatoVoce: 'E';
  aliquota: number;
  parti: number;
  importo: number;
  codiceDivisa: 'E';
  codiceEnte: '000000';
  codiceCapitolo: string;
  codiceCentroDiCosto: string;
  riferimento: string;
  codiceRiferimentoVoce: '';
  flagAdempimenti: number;
  idContrattoCSA: string;
  nota: string;
}

// ------------------------------------------------------------
// CERTIFICATO — TEMPLATE-COME-DATO
// Specchio client di server/src/services/certificato/types.ts
// (CertificatoTemplate). Usato dall'editor a sezioni in
// CertificatiTemplatePage + componenti riusabili in
// components/certificatoTemplate/.
// ------------------------------------------------------------

/** Riga della tabella emolumenti del certificato. */
export interface RigaEmolumento {
  voce:  string;
  /** es. "(+)" "(-)" "(=)" */
  segno: string;
  /** path nel contesto risoluzione: "teo.<campo>" oppure "cert.<campo>" */
  src:   string;
  bold?: boolean;
}

/** Regola di matching voce teorica → campo template, via parole chiave. */
export interface MatchTeorica {
  field:    string;
  keywords: string[];
}

/** Template-come-dato per la generazione DOCX dei certificati (campo strutturaJson). */
export interface CertificatoTemplate {
  bollo:        { testo: string };
  intestazione: { protocollo: string; posizione: string };
  titolo:       string;
  corpo:        string[];
  tabellaEmolumenti:  RigaEmolumento[];
  testoExtraerariali: string;
  testoNetto:   string;
  chiusura:     string;
  luogoData:    string;
  firma:        string[];
  matchTeoriche:    MatchTeorica[];
  inquadramentoMap: Record<string, string>;
  extraRename:      Record<string, string>;
}
