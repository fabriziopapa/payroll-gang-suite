// ============================================================
// PAYROLL GANG SUITE — Banner d'ambiente
// Barra fissa in alto, non chiudibile, visibile SOLO fuori produzione.
// L'ambiente si ricava dall'host della pagina (utils/ambiente.ts).
// In produzione il componente non produce alcun elemento.
// ============================================================

import { APP_VERSION } from '../types'
import type { Ambiente } from '../utils/ambiente'

const STILI: Record<Exclude<Ambiente, 'produzione'>, { strisce: string; etichetta: string; testo: string; nome: string }> = {
  'preproduzione': {
    strisce:   'repeating-linear-gradient(-45deg, #f59e0b 0 10px, #1c1917 10px 20px)',
    etichetta: 'bg-amber-400 text-slate-950',
    testo:     'i dati sono una copia della produzione',
    nome:      'PRE-PRODUZIONE',
  },
  'non-identificato': {
    strisce:   'repeating-linear-gradient(-45deg, #dc2626 0 10px, #1c1917 10px 20px)',
    etichetta: 'bg-red-600 text-white',
    testo:     'host non riconosciuto',
    nome:      'AMBIENTE NON DI PRODUZIONE',
  },
}

export function AmbienteBanner({ ambiente, host }: { ambiente: Ambiente; host: string }) {
  if (ambiente === 'produzione') return null
  const s = STILI[ambiente]

  return (
    <div
      role="note"
      aria-label={`Ambiente: ${s.nome}`}
      className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center px-2 select-none"
      style={{ height: 'var(--pgs-env-h)', background: s.strisce }}
    >
      <span className={`${s.etichetta} max-w-full truncate rounded px-3 py-0.5 text-xs font-bold tracking-wide shadow`}>
        {s.nome}
        <span className="hidden sm:inline font-semibold"> · {host} · v{APP_VERSION} — {s.testo}</span>
      </span>
    </div>
  )
}
