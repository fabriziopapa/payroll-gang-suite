// ============================================================
// PAYROLL GANG SUITE — Area Emolumenti
//
// Due sotto-pagine: «Dottorandi e borse» (EmolumentiPage, invariata) e
// «Tipi conto». La prima resta MONTATA anche quando si guarda l'altra
// (solo nascosta): una lavorazione a meta' non si perde cambiando scheda.
// ============================================================

import { useState } from 'react'
import EmolumentiPage from './EmolumentiPage'
import TipiContoPage from '../components/TipiContoPage'

type Sotto = 'dottorandi' | 'tipi-conto'

const SOTTO: Array<{ id: Sotto; label: string }> = [
  { id: 'dottorandi', label: 'Dottorandi e borse' },
  { id: 'tipi-conto', label: 'Emolumenti · Tipi conto' },
]

export default function EmolumentiArea() {
  const [sotto, setSotto] = useState<Sotto>('dottorandi')

  return (
    <div>
      <div className="px-6 pt-6 max-w-6xl mx-auto">
        <div className="flex flex-wrap gap-0.5 border-b border-slate-800">
          {SOTTO.map(t => (
            <button key={t.id} type="button" onClick={() => setSotto(t.id)}
              className={`px-4 py-2 rounded-t-lg text-sm font-medium transition border-b-2 -mb-px
                ${sotto === t.id
                  ? 'text-white border-indigo-500 bg-slate-800/50'
                  : 'text-slate-400 border-transparent hover:text-white hover:bg-slate-800/30'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div hidden={sotto !== 'dottorandi'}>
        <EmolumentiPage />
      </div>
      {sotto === 'tipi-conto' && (
        <div className="p-6 max-w-6xl mx-auto space-y-6">
          <header>
            <h1 className="text-xl font-semibold text-white">Tipi conto</h1>
            <p className="text-sm text-slate-400 mt-1">
              Conto italiano, SEPA o extra UE: dalla nazione su cui CSA ha pagato, mese per mese.
            </p>
          </header>
          <TipiContoPage />
        </div>
      )}
    </div>
  )
}
