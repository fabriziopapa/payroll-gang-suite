// ============================================================
// PAYROLL GANG SUITE — Coefficienti di Scorporo
// Agente DATA — Fase 0
// ============================================================

import type { CoefficienteScorporo } from '../types';

/**
 * Coefficienti di scorporo di default per ruolo.
 * Formula: importoNettoBeneficiario = importoLordoCarteEnte / (1 + coeff / 100)
 *
 * Solo i ruoli presenti in questa mappa possono avere il flag scorporo abilitato.
 * Fonte: "coefficieti di scorporo per codice ruolo.csv"
 */
export const DEFAULT_COEFFICIENTI_SCORPORO: CoefficienteScorporo = {
  PA: 32.70,
  PO: 32.70,
  RD: 34.31,
  RU: 32.70,
  ND: 32.70,
};

/** Insieme dei codici ruolo per cui lo scorporo è applicabile */
export const RUOLI_SCORPORABILI = new Set(
  Object.keys(DEFAULT_COEFFICIENTI_SCORPORO)
);

/**
 * Verifica se un ruolo può avere lo scorporo abilitato.
 * Se il ruolo non è nella tabella, il flag scorporo è disabilitato.
 */
export function isRuoloScorporabile(ruolo: string): boolean {
  return RUOLI_SCORPORABILI.has(ruolo);
}

/**
 * Calcola l'importo netto beneficiario (lordo privo del carico ente).
 * @param importoLordo - Importo lordo carico ente
 * @param coefficiente - Coefficiente percentuale (es. 32.70)
 * @returns Importo netto beneficiario, arrotondato a 2 decimali
 */
export function calcolaScorporo(
  importoLordo: number,
  coefficiente: number
): number {
  return Math.round((importoLordo / (1 + coefficiente / 100)) * 100) / 100;
}
