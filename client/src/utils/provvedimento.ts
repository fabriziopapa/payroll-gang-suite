// ============================================================
// PAYROLL GANG SUITE — Provvedimento
// Identificativo XOR estremi (tipo / numero / data)
// ============================================================

/**
 * Nel CSV HR i dati del provvedimento sono MUTUAMENTE ESCLUSIVI:
 *   - identificativo valorizzato -> `000025994;;;;`
 *   - estremi valorizzati        -> `;029;900006;2026-09-02;`
 * Non vengono mai esportati entrambi i blocchi sulla stessa riga.
 *
 * Se risultassero valorizzati entrambi, vince l'identificativo: e' il
 * dato che HR Suite risolve da solo.
 *
 * Dalla 26.10.13 la regola vale per l'EXPORT, non per il salvataggio:
 * con il flag di gruppo `conservaEstremiProvvedimento` (default ON) il
 * gruppo conserva ID + tipo/numero/data — servono alla comunicazione PDF —
 * ma nel CSV HR, da qualunque pulsante, esce solo l'ID.
 *   - salvataggio -> normalizeProvvedimentoSalvataggio()
 *   - export CSV  -> normalizeProvvedimento()  (buildCsvRows, unico punto)
 */

export type ProvvedimentoMode = 'identificativo' | 'estremi' | 'nessuno'

export interface ProvvedimentoFields {
  identificativoProvvedimento?: string
  tipoProvvedimento?:           string
  numeroProvvedimento?:         string
  dataProvvedimento?:           string
}

/** Tipo provvedimento precompilato all'inserimento del numero. */
export const TIPO_PROVVEDIMENTO_DEFAULT = '029'

/**
 * true se il campo contiene un valore reale.
 * Le stringhe di soli zeri ("000000000", "000") sono i placeholder storici
 * dei default di sistema e valgono come campo vuoto.
 */
export function hasValoreProv(v?: string): boolean {
  const s = (v ?? '').trim()
  return s !== '' && !/^0+$/.test(s)
}

/**
 * Identificativo provvedimento: sempre 9 cifre, completate con zeri a
 * sinistra (25994 -> "000025994"). Non cifre scartate, troncato a 9.
 * Vuoto o soli zeri -> stringa vuota (nessun identificativo).
 */
export function padIdentificativoProvvedimento(v?: string): string {
  const digits = (v ?? '').replace(/\D/g, '').slice(0, 9)
  if (digits === '' || /^0+$/.test(digits)) return ''
  return digits.padStart(9, '0')
}

/** Quale dei due blocchi e' attivo. */
export function provvedimentoMode(p: ProvvedimentoFields): ProvvedimentoMode {
  if (hasValoreProv(p.identificativoProvvedimento)) return 'identificativo'
  if (
    hasValoreProv(p.tipoProvvedimento) ||
    (p.numeroProvvedimento ?? '').trim() !== '' ||
    (p.dataProvvedimento   ?? '').trim() !== ''
  ) return 'estremi'
  return 'nessuno'
}

/**
 * Quadrupla da salvare / da scrivere nel CSV: solo il blocco attivo
 * resta valorizzato, l'altro viene azzerato.
 */
export function normalizeProvvedimento(p: ProvvedimentoFields): Required<ProvvedimentoFields> {
  switch (provvedimentoMode(p)) {
    case 'identificativo':
      return {
        identificativoProvvedimento: padIdentificativoProvvedimento(p.identificativoProvvedimento),
        tipoProvvedimento:           '',
        numeroProvvedimento:         '',
        dataProvvedimento:           '',
      }
    case 'estremi':
      return {
        identificativoProvvedimento: '',
        tipoProvvedimento:           (p.tipoProvvedimento   ?? '').trim(),
        numeroProvvedimento:         (p.numeroProvvedimento ?? '').trim(),
        dataProvvedimento:           (p.dataProvvedimento   ?? '').trim(),
      }
    default:
      return {
        identificativoProvvedimento: '',
        tipoProvvedimento:           '',
        numeroProvvedimento:         '',
        dataProvvedimento:           '',
      }
  }
}

/**
 * Il flag di gruppo: assente (gruppi salvati prima della 26.10.13) vale ON.
 * Quei gruppi sono gia' esclusivi, quindi il CSV non cambia finche' non
 * vengono modificati.
 */
export function conservaEstremi(p: { conservaEstremiProvvedimento?: boolean }): boolean {
  return p.conservaEstremiProvvedimento ?? true
}

/**
 * Quadrupla da SALVARE nel gruppo.
 *  - conserva = true  -> si tengono tutti i campi (ID completato a 9 cifre,
 *    placeholder di soli zeri azzerati). Il CSV restera' comunque esclusivo:
 *    ci pensa normalizeProvvedimento() in buildCsvRows.
 *  - conserva = false -> solo il blocco attivo, come prima della 26.10.13.
 */
export function normalizeProvvedimentoSalvataggio(
  p: ProvvedimentoFields,
  conserva: boolean,
): Required<ProvvedimentoFields> {
  if (!conserva) return normalizeProvvedimento(p)
  return {
    identificativoProvvedimento: padIdentificativoProvvedimento(p.identificativoProvvedimento),
    tipoProvvedimento:           hasValoreProv(p.tipoProvvedimento) ? (p.tipoProvvedimento ?? '').trim() : '',
    numeroProvvedimento:         (p.numeroProvvedimento ?? '').trim(),
    dataProvvedimento:           (p.dataProvvedimento   ?? '').trim(),
  }
}
