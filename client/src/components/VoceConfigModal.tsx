// ============================================================
// PAYROLL GANG SUITE — VoceConfigModal
// Config manuale per voce: parti, scorporo, tag riferimento cedolino.
// Pre-compila il gruppo liquidazione alla selezione della voce (Fase 4).
// ============================================================

import { useState, useRef, useId } from 'react'
import { vociConfigApi, type VoceApi } from '../api/endpoints'
import { showToast } from './ToastManager'
import { useModalKeyboard } from '../hooks/useFocusTrap'
import type { VoceConfig } from '../types'

interface Props {
  voce:      VoceApi
  existing?: VoceConfig
  onClose:   () => void
  onSaved:   (codice: string, cfg: VoceConfig | null) => void
}

type ScorporoSel = '' | 'none' | 'standard' | 'contoterzi'
type TagSel      = '' | 'TL' | 'WD' | 'WE'

export default function VoceConfigModal({ voce, existing, onClose, onSaved }: Props) {
  const titleId   = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalKeyboard(dialogRef, onClose)

  const [parti, setParti]           = useState(existing?.parti != null ? String(existing.parti) : '')
  const [scorporo, setScorporo]     = useState<ScorporoSel>((existing?.tipoScorporo ?? '') as ScorporoSel)
  const [tag, setTag]               = useState<TagSel>((existing?.tagDefault ?? '') as TagSel)
  const [autoFiglio, setAutoFiglio] = useState(existing?.autoFiglio ?? false)
  const [saving, setSaving]         = useState(false)

  async function handleSave() {
    setSaving(true)
    const cfg: Omit<VoceConfig, 'codice'> = {
      parti:        parti.trim() === '' ? null : (parseInt(parti, 10) || 0),
      tipoScorporo: scorporo === '' ? null : scorporo,
      tagDefault:   tag === '' ? null : tag,
      autoFiglio:   tag === 'WE' ? autoFiglio : false,
    }
    try {
      const saved = await vociConfigApi.save(voce.codice, cfg)
      showToast('Config voce salvata', 'success')
      onSaved(voce.codice, saved)
      onClose()
    } catch {
      showToast('Errore nel salvataggio della config', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    setSaving(true)
    try {
      await vociConfigApi.remove(voce.codice)
      showToast('Config voce rimossa', 'success')
      onSaved(voce.codice, null)
      onClose()
    } catch {
      showToast('Errore nella rimozione', 'error')
    } finally {
      setSaving(false)
    }
  }

  const tagHint: Record<TagSel, string> = {
    '':   'Nessun tag pre-impostato',
    'TL': 'Testo libero, a livello gruppo (TL@…@)',
    'WD': 'CF del dipendente, per nominativo (WD@anno+CF@)',
    'WE': 'CF del figlio, per nominativo (WE@anno+CF figlio@)',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
      role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div ref={dialogRef} className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg
                      max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="min-w-0">
            <h2 id={titleId} className="text-white font-semibold">Config voce</h2>
            <p className="text-slate-500 text-xs mt-0.5 truncate">
              <span className="font-mono text-indigo-400">{voce.codice}</span> · {voce.descrizione}
            </p>
          </div>
          <button onClick={onClose} aria-label="Chiudi"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Parti */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Parti <span className="text-slate-500 font-normal">(vuoto = default globale)</span>
            </label>
            <input type="number" min={0} value={parti}
              onChange={e => setParti(e.target.value)}
              placeholder="default da Impostazioni" className={inputCls} />
          </div>

          {/* Scorporo */}
          <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700 space-y-2">
            <p className="text-sm font-medium text-slate-300 mb-1">Scorporo pre-impostato</p>
            {([
              { v: '',           l: 'Non impostato', d: 'Decide l\'operatore nel gruppo' },
              { v: 'none',       l: 'Nessuno',       d: 'Importo lordo invariato' },
              { v: 'standard',   l: 'Standard',      d: 'Coefficienti normali' },
              { v: 'contoterzi', l: 'Conto terzi',   d: 'Coefficienti CT' },
            ] as { v: ScorporoSel; l: string; d: string }[]).map(o => (
              <label key={o.v} className="flex items-start gap-3 cursor-pointer">
                <input type="radio" name="scorporo-cfg" checked={scorporo === o.v}
                  onChange={() => setScorporo(o.v)}
                  className="mt-0.5 w-4 h-4 border-slate-600 text-indigo-600" />
                <span className="text-sm text-slate-200">{o.l}
                  <span className="text-slate-500 text-xs block">{o.d}</span>
                </span>
              </label>
            ))}
          </div>

          {/* Tag riferimento cedolino */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Tag riferimento cedolino</label>
            <select value={tag} onChange={e => setTag(e.target.value as TagSel)} className={inputCls}>
              <option value="">— nessuno —</option>
              <option value="TL">TL — testo libero</option>
              <option value="WD">WD — CF dipendente</option>
              <option value="WE">WE — CF figlio</option>
            </select>
            <p className="text-xs text-slate-500 mt-1">{tagHint[tag]}</p>
          </div>

          {/* Auto figlio — solo WE */}
          {tag === 'WE' && (
            <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg bg-slate-800/50 border border-slate-700">
              <input type="checkbox" checked={autoFiglio}
                onChange={e => setAutoFiglio(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-slate-600 accent-indigo-500" />
              <span className="text-sm text-slate-200">Scelta automatica figlio
                <span className="text-slate-500 text-xs block">
                  Prende il figlio (FG) più giovane — sempre 1 sola riga
                </span>
              </span>
            </label>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-slate-800">
          <div>
            {existing && (
              <button type="button" onClick={handleRemove} disabled={saving}
                className="px-3 py-2 rounded-lg text-red-400 hover:bg-red-900/20 text-sm transition disabled:opacity-40">
                Rimuovi config
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-800 text-sm transition">
              Annulla
            </button>
            <button type="button" onClick={handleSave} disabled={saving}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500
                         text-white text-sm font-medium transition disabled:opacity-40">
              {saving ? 'Salvataggio…' : 'Salva'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const inputCls = `w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700
  text-white text-sm placeholder-slate-500
  focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition`
