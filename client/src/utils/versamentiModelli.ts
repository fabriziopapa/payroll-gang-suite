// ============================================================
// PAYROLL GANG SUITE — Versamenti enti · modelli di messaggio
//
// Segnaposto, periodi e scelta del modello per un ente. I segnaposto sono
// gli stessi di server/src/lib/versamenti.ts: se se ne aggiunge uno, va
// aggiunto in entrambi i posti (il server rifiuta quelli che non conosce).
// ============================================================

import type { AllegatiConfig } from './versamentiAllegati'

export interface ModelloVersamento {
  id:          string
  nome:        string
  oggetto:     string
  testo:       string
  allegati:    AllegatiConfig
  predefinito: boolean
}

export const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio',
  'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'] as const

export const meseLabel = (ym: string) => `${MESI[+ym.slice(5, 7) - 1] ?? '?'} ${ym.slice(0, 4)}`
export const meseBreve = (ym: string) => `${(MESI[+ym.slice(5, 7) - 1] ?? '?').slice(0, 3)} ${ym.slice(2, 4)}`
const idx = (ym: string) => (+ym.slice(0, 4)) * 12 + (+ym.slice(5, 7) - 1)
const contigui = (m: string[]) => m.every((x, i) => i === 0 || idx(x) === idx(m[i - 1]!) + 1)
const elenco = (a: string[]) => a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} e ${a[a.length - 1]}`

/** Frase per il testo: «nel mese di luglio 2025», «nei mesi da gennaio a dicembre 2025»… */
export function periodoFrase(mesi: readonly string[]): string {
  const m = [...mesi].sort()
  if (!m.length) return ''
  if (m.length === 1) return `nel mese di ${meseLabel(m[0]!)}`
  const primo = m[0]!, ultimo = m[m.length - 1]!
  const unAnno = m.every(x => x.slice(0, 4) === primo.slice(0, 4))
  if (contigui(m)) {
    return unAnno
      ? `nei mesi da ${MESI[+primo.slice(5) - 1]} a ${meseLabel(ultimo)}`
      : `nei mesi da ${meseLabel(primo)} a ${meseLabel(ultimo)}`
  }
  return unAnno
    ? `nei mesi di ${elenco(m.map(x => MESI[+x.slice(5) - 1]!))} ${primo.slice(0, 4)}`
    : `nei mesi di ${elenco(m.map(meseLabel))}`
}

/** Per titoli e oggetti: «luglio 2025», «gennaio 2025 – dicembre 2025», «gen 25, mar 25». */
export function periodoBreve(mesi: readonly string[]): string {
  const m = [...mesi].sort()
  if (!m.length) return ''
  if (m.length === 1) return meseLabel(m[0]!)
  return contigui(m) ? `${meseLabel(m[0]!)} – ${meseLabel(m[m.length - 1]!)}` : m.map(meseBreve).join(', ')
}

/** Per i nomi dei file: '2025-07' oppure '2025-01_2025-12'. */
export function periodoFile(mesi: readonly string[]): string {
  const m = [...mesi].sort()
  if (!m.length) return ''
  return m.length === 1 ? m[0]! : `${m[0]}_${m[m.length - 1]}`
}

/** Centesimi → '1.234,56' (separatore delle migliaia sempre, anche sotto 10.000). */
export function fmtEuro(cents: number): string {
  const a = Math.abs(Math.round(cents))
  const intero = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${cents < 0 ? '-' : ''}${intero},${String(a % 100).padStart(2, '0')}`
}

export const SEGNAPOSTO: ReadonlyArray<{ k: string; descr: string }> = [
  { k: 'DESCRIZIONE_ENTE', descr: 'Descrizione dell\'ente' },
  { k: 'CODICE_ENTE',      descr: 'Codice dell\'ente' },
  { k: 'PERIODO',          descr: 'Frase del periodo («nei mesi da gennaio a dicembre 2025»)' },
  { k: 'PERIODO_BREVE',    descr: 'Periodo breve («gennaio 2025 – dicembre 2025»)' },
  { k: 'TOTALE',           descr: 'Totale versato («1.234,56 €»)' },
  { k: 'RIGHE',            descr: 'Numero di righe di dettaglio' },
]
export const SEGNAPOSTO_TESTO = SEGNAPOSTO.map(s => s.k)
export const SEGNAPOSTO_FILE = ['CODICE_ENTE', 'PERIODO_FILE']
export const SEGNAPOSTO_TITOLO = [...SEGNAPOSTO_TESTO, 'PERIODO_FILE']

export type Contesto = Record<string, string>

export function contesto(codice: string, descr: string, righe: ReadonlyArray<{ cents: number }>, mesi: readonly string[]): Contesto {
  return {
    DESCRIZIONE_ENTE: descr,
    CODICE_ENTE:      codice,
    PERIODO:          periodoFrase(mesi),
    PERIODO_BREVE:    periodoBreve(mesi),
    PERIODO_FILE:     periodoFile(mesi),
    TOTALE:           `${fmtEuro(righe.reduce((s, r) => s + r.cents, 0))} €`,
    RIGHE:            String(righe.length),
  }
}

/** Sostituisce i segnaposto noti; quelli sconosciuti restano come sono. */
export const applica = (tpl: string, ctx: Contesto) =>
  tpl.replace(/\{([A-Z_]+)\}/g, (tutto, k: string) => (Object.hasOwn(ctx, k) ? ctx[k]! : tutto))

export function segnapostoIgnoti(testo: string, ammessi: readonly string[]): string[] {
  const trovati = [...testo.matchAll(/\{([^{}]*)\}/g)].map(m => m[1] ?? '')
  return [...new Set(trovati.filter(k => !ammessi.includes(k)))]
}

/**
 * Il modello per un ente, dal piu' forte al piu' debole:
 *   scelta fatta nell'anteprima (solo per questa elaborazione)
 *   → modello forzato per tutta l'elaborazione
 *   → modello dell'ente in rubrica
 *   → predefinito.
 */
export function modelloPer(
  codice: string,
  p: {
    modelli:      readonly ModelloVersamento[]
    override:     Readonly<Record<string, string>>
    modelloElab:  string | null
    modelloEnte:  string | null
  },
): ModelloVersamento | null {
  const by = (id: string | null | undefined) => (typeof id === 'string' && id ? p.modelli.find(m => m.id === id) : undefined)
  // hasOwn: il codice ente viene dal CSV e potrebbe chiamarsi «constructor».
  return by(Object.hasOwn(p.override, codice) ? p.override[codice] : undefined) ?? by(p.modelloElab) ?? by(p.modelloEnte)
    ?? p.modelli.find(m => m.predefinito) ?? p.modelli[0] ?? null
}

export const FIRMA_UFFICIO =
  'Cordiali saluti,\n\n\n\n\nUniversità degli Studi di Napoli Parthenope \n Ufficio Stipendi ed Emolumenti al Personale Esterno \n Via Amm. F. Acton, 38 - 80133 Napoli \n +39 081 547 5808 -5881 -5649 -4428 -5816'
