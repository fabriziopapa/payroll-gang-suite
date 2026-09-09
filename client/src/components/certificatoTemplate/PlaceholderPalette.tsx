// ============================================================
// PAYROLL GANG SUITE — PlaceholderPalette
// Pannello "Segnaposto e tag genere" per l'editor a sezioni del template
// certificato. Elenca tutti i path {{...}} disponibili nel contesto di
// risoluzione (PreparedContext.flat — vedi services/certificato/merge.ts
// e prepareData) e offre un helper visivo per i tag genere [[m|f]].
//
// Click su una voce → inserisce il testo nel campo (input/textarea) di
// template attualmente "a fuoco" (tracciato via focusin sul container),
// alla posizione del cursore — niente copia-incolla, niente refusi tipo
// {{anagrfica.nome}} che il motore stampa-unione lascerebbe silenziosamente
// invariato nel documento finale.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { showToast } from '../ToastManager'

interface PlaceholderGroup {
  titolo: string
  voci:   { path: string; label: string }[]
}

// Specchio di PreparedContext.flat (merge.ts: prepareData) — l'intero
// oggetto `parsed` (CedolinoParsed) più i campi calcolati/meta aggiunti.
const PLACEHOLDER_GROUPS: PlaceholderGroup[] = [
  {
    titolo: 'Anagrafica',
    voci: [
      { path: 'anagrafica.cognome',              label: 'Cognome' },
      { path: 'anagrafica.nome',                 label: 'Nome' },
      { path: 'anagrafica.codice_fiscale',       label: 'Codice fiscale' },
      { path: 'anagrafica.data_nascita',         label: 'Data di nascita' },
      { path: 'anagrafica.luogo_nascita',        label: 'Luogo di nascita' },
      { path: 'anagrafica.matricola',            label: 'Matricola' },
      { path: 'anagrafica.periodo_retribuzione', label: 'Periodo retribuzione (grezzo, es. "MAGGIO 2026")' },
      { path: 'anagrafica.inquadramento',        label: 'Inquadramento — codice grezzo dal cedolino' },
      { path: 'anagrafica.inquadramento_label',  label: 'Inquadramento — etichetta da "Etichette per inquadramento"' },
      { path: 'anagrafica.area_profilo',         label: 'Area / profilo' },
      { path: 'anagrafica.settore',              label: 'Settore (area_profilo ripulito da "Settore ")' },
      { path: 'anagrafica.ruolo',                label: 'Ruolo' },
      { path: 'anagrafica.inizio_rapporto',      label: 'Inizio rapporto' },
      { path: 'anagrafica.anzianita_servizio',   label: 'Anzianità di servizio' },
      { path: 'anagrafica.afferenza',            label: 'Afferenza' },
      { path: 'anagrafica.sede',                 label: 'Sede' },
    ],
  },
  {
    titolo: 'Certificato — importi calcolati',
    voci: [
      { path: 'certificato.lordo_teorico',          label: 'Lordo teorico' },
      { path: 'certificato.ritenute_fiscali',       label: 'Ritenute fiscali' },
      { path: 'certificato.ritenute_previdenziali', label: 'Ritenute previdenziali' },
      { path: 'certificato.netto_ritenute_legge',   label: 'Netto al netto delle ritenute di legge' },
      { path: 'certificato.extraerariali_totale',   label: 'Totale trattenute extra-erariali' },
      { path: 'certificato.netto_a_pagare',         label: 'Netto a pagare' },
      { path: 'certificato.quinto',                 label: 'Quinto cedibile' },
      { path: 'certificato.settimo',                label: 'Settimo cedibile' },
    ],
  },
  {
    titolo: 'Etichette pronte (precalcolate)',
    voci: [
      { path: 'periodo_label',      label: 'Periodo capitalizzato (es. "Maggio 2026")' },
      { path: 'netto_pagare_label', label: 'Netto a pagare già formattato (es. "€ 1.234,56")' },
    ],
  },
  {
    titolo: 'Dati di emissione (compilati al momento della generazione)',
    voci: [
      { path: 'protocollo',      label: 'Numero di protocollo' },
      { path: 'sigla_operatore', label: 'Sigla dell’operatore' },
      { path: 'data_rilascio',   label: 'Data di rilascio' },
      { path: 'dirigente',       label: 'Nome del dirigente' },
    ],
  },
]

type TextField = HTMLInputElement | HTMLTextAreaElement

function isTextField(el: EventTarget | null): el is TextField {
  if (el instanceof HTMLTextAreaElement) return true
  return el instanceof HTMLInputElement && (el.type === 'text' || el.type === '')
}

/** Imposta il value tramite il setter nativo (bypassa l'override di React) e notifica react via evento 'input'. */
function setNativeValue(el: TextField, value: string) {
  const proto  = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(el, value)
}

/** Inserisce `text` nel campo `el` alla posizione del cursore (sostituendo l'eventuale selezione). */
function insertAtCursor(el: TextField, text: string) {
  const start = el.selectionStart ?? el.value.length
  const end   = el.selectionEnd   ?? el.value.length
  const next  = el.value.slice(0, start) + text + el.value.slice(end)
  setNativeValue(el, next)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  const pos = start + text.length
  requestAnimationFrame(() => {
    try { el.setSelectionRange(pos, pos) } catch { /* tipi di input senza selectionRange */ }
    el.focus()
  })
}

interface Props {
  /** Contenitore dei campi del template — solo i focus al suo interno vengono tracciati come bersaglio inserimento. */
  containerRef: React.RefObject<HTMLElement | null>
}

export default function PlaceholderPalette({ containerRef }: Props) {
  const targetRef            = useRef<TextField | null>(null)
  const [open, setOpen]      = useState(true)
  const [maschile, setMaschile]   = useState('il Sig.')
  const [femminile, setFemminile] = useState('la Sig.ra')
  const [genere, setGenere]       = useState<'M' | 'F'>('M')

  useEffect(() => {
    function onFocusIn(e: FocusEvent) {
      const t = e.target
      if (isTextField(t) && containerRef.current?.contains(t)) targetRef.current = t
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [containerRef])

  function inserisci(text: string) {
    const el = targetRef.current
    if (!el || !document.contains(el)) {
      showToast('Clicca prima dentro un campo di testo del template, poi inserisci il segnaposto', 'error')
      return
    }
    insertAtCursor(el, text)
  }

  return (
    <section className="bg-indigo-950/30 border border-indigo-800/40 rounded-xl p-4 space-y-3 sticky top-2 z-10 backdrop-blur-sm">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-start justify-between gap-3 text-left">
        <div>
          <h3 className="text-sm font-semibold text-indigo-200">Segnaposto e tag genere</h3>
          <p className="text-xs text-indigo-300/70">
            Clicca dentro un campo di testo del template qui sotto, poi clicca un segnaposto: viene inserito al posto del cursore — niente da ricopiare a mano (e niente refusi come <code className="text-indigo-200">{'{{anagrfica.nome}}'}</code> che resterebbero stampati invariati).
          </p>
        </div>
        <span className="text-indigo-300 text-xs shrink-0 whitespace-nowrap">{open ? 'Nascondi ▲' : 'Mostra ▼'}</span>
      </button>

      {open && (
        <div className="space-y-4">
          {/* Helper tag genere */}
          <div className="rounded-lg border border-indigo-800/30 bg-slate-950/40 p-3 space-y-2.5">
            <p className="text-xs font-medium text-indigo-200">
              Tag genere <code className="text-indigo-300">[[forma maschile|forma femminile]]</code>
              <span className="text-slate-500 font-normal"> — il motore stampa quella giusta in base al sesso del/la dipendente</span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] text-slate-500">Forma maschile</span>
                <input value={maschile} onChange={e => setMaschile(e.target.value)}
                  className="input mt-0.5 text-sm" placeholder="es. il Sig." />
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-500">Forma femminile</span>
                <input value={femminile} onChange={e => setFemminile(e.target.value)}
                  className="input mt-0.5 text-sm" placeholder="es. la Sig.ra" />
              </label>
            </div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-[11px] text-slate-500 shrink-0">Anteprima:</span>
              <div className="flex rounded-lg overflow-hidden border border-slate-700 shrink-0">
                <button type="button" onClick={() => setGenere('M')}
                  className={`px-2.5 py-1 text-xs transition ${genere === 'M' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
                  Lui (M)
                </button>
                <button type="button" onClick={() => setGenere('F')}
                  className={`px-2.5 py-1 text-xs transition ${genere === 'F' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
                  Lei (F)
                </button>
              </div>
              <span className="text-xs text-slate-300 italic truncate">
                "…che <strong className="text-white not-italic">{(genere === 'M' ? maschile : femminile) || '—'}</strong> Cognome Nome…"
              </span>
            </div>
            <button type="button"
              onClick={() => inserisci(`[[${maschile}|${femminile}]]`)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
              </svg>
              Inserisci tag genere nel campo attivo
            </button>
          </div>

          {/* Palette segnaposto */}
          <div className="space-y-3">
            {PLACEHOLDER_GROUPS.map(g => (
              <div key={g.titolo}>
                <p className="text-[11px] font-medium text-indigo-200/80 uppercase tracking-wide mb-1.5">{g.titolo}</p>
                <div className="flex flex-wrap gap-1.5">
                  {g.voci.map(v => (
                    <button key={v.path} type="button" title={v.label}
                      onClick={() => inserisci(`{{${v.path}}}`)}
                      className="px-2 py-1 rounded-md text-[11px] font-mono bg-slate-800 border border-slate-700
                                 text-indigo-300 hover:bg-indigo-600 hover:text-white hover:border-indigo-500 transition">
                      {`{{${v.path}}}`}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
