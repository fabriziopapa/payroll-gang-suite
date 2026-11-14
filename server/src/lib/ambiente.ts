// ============================================================
// PAYROLL GANG SUITE — Riconoscimento dell'ambiente dall'host
//
// Tabella gemella di client/src/utils/ambiente.ts: le due liste vanno
// tenute IDENTICHE. Non stanno in shared/ perché il server compila con
// rootDir = src e non può importare file fuori da src.
//
// Regola prudente: è produzione SOLO un host dell'elenco produzione.
// Qualsiasi host sconosciuto (mirror, *.cpanel.site, localhost) è
// "non-identificato" e viene segnalato come ambiente di prova.
// ============================================================

export type Ambiente = 'produzione' | 'preproduzione' | 'non-identificato'

export const HOST_PRODUZIONE:    readonly string[] = ['fabriziopapa.com', 'www.fabriziopapa.com']
export const HOST_PREPRODUZIONE: readonly string[] = ['pre.fabriziopapa.com']

/** Ambiente a partire da un nome host (senza porta). */
export function ambienteDaHost(host: string | null | undefined): Ambiente {
  const h = (host ?? '').trim().toLowerCase().replace(/\.$/, '')
  if (HOST_PRODUZIONE.includes(h))    return 'produzione'
  if (HOST_PREPRODUZIONE.includes(h)) return 'preproduzione'
  return 'non-identificato'
}

/** Ambiente a partire da un'origine completa, es. il primo CLIENT_ORIGIN. */
export function ambienteDaOrigin(origin: string | null | undefined): Ambiente {
  try {
    return ambienteDaHost(new URL(origin ?? '').hostname)
  } catch {
    return 'non-identificato'
  }
}

/** Prefisso per l'oggetto delle email: vuoto in produzione. */
export function prefissoOggetto(a: Ambiente): string {
  if (a === 'produzione')    return ''
  if (a === 'preproduzione') return '[PRE-PRODUZIONE] '
  return '[NON PRODUZIONE] '
}

/** Riga d'avviso per il corpo delle email: null in produzione. */
export function avvisoEmail(a: Ambiente, origin: string): string | null {
  if (a === 'produzione') return null
  const nome = a === 'preproduzione' ? 'PRE-PRODUZIONE' : 'NON DI PRODUZIONE'
  return `Questa email arriva dall'ambiente ${nome} (${origin}): il link non porta alla produzione.`
}
