// ============================================================
// PAYROLL GANG SUITE — Costanti CSV e Impostazioni Default
// Agente DATA — Fase 0
// ============================================================

import type { CsvDefaults } from '../types';

// ------------------------------------------------------------
// CAMPI CSV FISSI (mai editabili dall'utente)
// ------------------------------------------------------------

export const CSV_FIXED = {
  /** Comparto — sempre "1" per questo contesto */
  comparto: '1' as const,
  /** Divisa — sempre Euro */
  codiceDivisa: 'E' as const,
  /** Codice ente — fisso per l'ateneo */
  codiceEnte: '000000' as const,
  /** Codice stato voce — sempre vuoto */
  codiceStatoVoce: '' as const,
  /** Codice riferimento voce — sempre vuoto */
  codiceRiferimentoVoce: '' as const,
} as const;

// ------------------------------------------------------------
// PARAMETRI CSV VARIABILI — DEFAULT (configurabili in Impostazioni)
// ------------------------------------------------------------

/**
 * Valori di default per i parametri CSV avanzati.
 * Vengono copiati in ogni nuovo DettaglioLiquidazione al momento della creazione.
 * L'utente può modificarli sia globalmente (Impostazioni) sia per singolo dettaglio.
 */
export const DEFAULT_CSV_PARAMS: CsvDefaults = {
  tipoProvvedimento: '000',
  aliquota: 0,
  parti: 0,
  flagAdempimenti: 0,
  idContrattoCSA: '',
};

// ------------------------------------------------------------
// PALETTE COLORI DETTAGLIO (assegnati round-robin)
// ------------------------------------------------------------

export const PALETTE_DETTAGLIO: readonly string[] = [
  '#16A34A', // verde
  '#2563EB', // blu
  '#D97706', // arancione
  '#7C3AED', // viola
  '#DC2626', // rosso
  '#0891B2', // cyan
  '#DB2777', // rosa
  '#65A30D', // lime
] as const;

// ------------------------------------------------------------
// TAG CEDOLINO — BUILT-IN
// ------------------------------------------------------------

/**
 * Tag built-in non eliminabili.
 * L'utente può aggiungere ulteriori prefissi dal menu Impostazioni → Gestione Tag.
 */
export const TAG_BUILTIN = ['TL'] as const;

// ------------------------------------------------------------
// FORMATO DATE
// ------------------------------------------------------------

export const DATE_FORMATS = {
  /** Formato competenza liquidazione (UI e CSV anno/mese) */
  COMPETENZA: 'MM/YYYY',
  /** Formato data competenza voce nel CSV HR */
  DATA_COMPETENZA_VOCE_CSV: 'YYYY-MM-DD',
  /** Formato data provvedimento nel CSV HR */
  DATA_PROVVEDIMENTO_CSV: 'DD/MM/YYYY',
} as const;
