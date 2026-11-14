// ============================================================
// PAYROLL GANG SUITE — Riconoscimento dell'ambiente dall'host
//
// Tabella gemella di server/src/lib/ambiente.ts: le due liste vanno
// tenute IDENTICHE.
//
// Regola prudente: è produzione SOLO un host dell'elenco produzione.
// Qualsiasi host sconosciuto (mirror, *.cpanel.site, localhost) è
// "non-identificato" e mostra comunque il banner.
// ============================================================

export type Ambiente = 'produzione' | 'preproduzione' | 'non-identificato'

export const HOST_PRODUZIONE:    readonly string[] = ['fabriziopapa.com', 'www.fabriziopapa.com']
export const HOST_PREPRODUZIONE: readonly string[] = ['pre.fabriziopapa.com']

/** Altezza della linea d'ambiente: il resto della pagina si sposta di questa misura. */
export const ALTEZZA_BANNER = '3px'

/** Ambiente a partire da un nome host (senza porta). */
export function ambienteDaHost(host: string | null | undefined): Ambiente {
  const h = (host ?? '').trim().toLowerCase().replace(/\.$/, '')
  if (HOST_PRODUZIONE.includes(h))    return 'produzione'
  if (HOST_PREPRODUZIONE.includes(h)) return 'preproduzione'
  return 'non-identificato'
}

/** Favicon SVG con il bollino dell'ambiente (data URL: ammesso dalla CSP img-src). */
function faviconAmbiente(colore: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" rx="7" fill="#4f46e5"/>` +
    `<text x="14" y="23" font-family="system-ui,sans-serif" font-size="19" font-weight="700" ` +
    `fill="#fff" text-anchor="middle">P</text>` +
    `<circle cx="25" cy="7" r="6.5" fill="${colore}" stroke="#0f172a" stroke-width="1.5"/>` +
    `</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/**
 * Da chiamare una volta, prima del primo render: fuori produzione riserva
 * lo spazio del banner (--pgs-env-h), mette il prefisso al titolo della
 * scheda e il bollino alla favicon. In produzione non tocca nulla.
 */
export function applicaAmbiente(a: Ambiente): void {
  if (a === 'produzione') return
  const root = document.documentElement
  root.style.setProperty('--pgs-env-h', ALTEZZA_BANNER)
  root.dataset.ambiente = a

  const prefisso = a === 'preproduzione' ? '[PRE] ' : '[TEST] '
  if (!document.title.startsWith(prefisso)) document.title = prefisso + document.title

  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.type = 'image/svg+xml'
  link.href = faviconAmbiente(a === 'preproduzione' ? '#f59e0b' : '#dc2626')
}
