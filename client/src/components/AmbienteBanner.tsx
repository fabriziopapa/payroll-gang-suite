// ============================================================
// PAYROLL GANG SUITE — Banner d'ambiente
// Linea colorata di 3 px sul bordo superiore + piccola linguetta al
// centro («PRE» / «TEST»), visibili SOLO fuori produzione. Il dettaglio
// (host, versione) è nel suggerimento al passaggio del mouse.
// L'ambiente si ricava dall'host della pagina (utils/ambiente.ts).
// In produzione il componente non produce alcun elemento.
// ============================================================

import { APP_VERSION } from '../types'
import type { Ambiente } from '../utils/ambiente'

const STILI: Record<Exclude<Ambiente, 'produzione'>, { linea: string; linguetta: string; sigla: string; nome: string; testo: string }> = {
  'preproduzione': {
    linea:     'bg-amber-400',
    linguetta: 'bg-amber-400 text-slate-950',
    sigla:     'PRE',
    nome:      'Pre-produzione',
    testo:     'i dati sono una copia della produzione',
  },
  'non-identificato': {
    linea:     'bg-red-600',
    linguetta: 'bg-red-600 text-white',
    sigla:     'TEST',
    nome:      'Ambiente non di produzione',
    testo:     'host non riconosciuto',
  },
}

export function AmbienteBanner({ ambiente, host }: { ambiente: Ambiente; host: string }) {
  if (ambiente === 'produzione') return null
  const s = STILI[ambiente]
  const dettaglio = `${s.nome} · ${host} · v${APP_VERSION} — ${s.testo}`

  return (
    <div role="note" aria-label={dettaglio} className="fixed inset-x-0 top-0 z-[100] pointer-events-none select-none">
      <div className={s.linea} style={{ height: 'var(--pgs-env-h)' }} />
      <span
        title={dettaglio}
        className={`${s.linguetta} pointer-events-auto absolute left-1/2 -translate-x-1/2
                    rounded-b-md px-2 pb-0.5 text-[10px] font-bold leading-4 tracking-widest shadow`}
        style={{ top: 'var(--pgs-env-h)' }}
      >
        {s.sigla}
      </span>
    </div>
  )
}
