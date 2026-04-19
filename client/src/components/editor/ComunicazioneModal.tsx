// ============================================================
// PAYROLL GANG SUITE — ComunicazioneModal
// Crea / modifica una comunicazione legata a un gruppo liquidazione.
// Destinatari dalla rubrica o manuali — Modelli — Allegato HTML — EML export
// ============================================================

import { useState, useRef, useId } from 'react'
import { useStore } from '../../store/useStore'
import type {
  DettaglioLiquidazione,
  Nominativo,
  Comunicazione,
} from '../../types'
import { downloadPdf, type PdfContext } from '../../utils/pdfBuilder'
import { downloadEml } from '../../utils/emlBuilder'
import { useModalKeyboard } from '../../hooks/useFocusTrap'

// ── Tipi interni ──────────────────────────────────────────────

interface Destinatario { nome: string; email: string }

interface Props {
  dettaglio:  DettaglioLiquidazione
  noms:       Nominativo[]
  existing?:  Comunicazione
  onSave:     (c: Comunicazione) => void
  onDelete?:  (id: string) => void
  onClose:    () => void
}

type Tab = 'destinatari' | 'messaggio' | 'allegato'

// ── Campi allegato disponibili ────────────────────────────────

const CAMPI_ALLEGATO: Array<{ id: string; label: string; hint?: string }> = [
  { id: 'nomeDescrittivo',        label: 'Nome descrittivo' },
  { id: 'voce',                   label: 'Voce HR (codice)' },
  { id: 'descVoce',               label: 'Descrizione voce' },
  { id: 'capitolo',               label: 'Capitolo (codice)' },
  { id: 'descCapitolo',           label: 'Descrizione capitolo' },
  { id: 'competenzaLiquidazione', label: 'Competenza liquidazione' },
  { id: 'dataCompetenzaVoce',     label: 'Data competenza voce' },
  { id: 'provvedimento',          label: 'Provvedimento (n. e data)' },
  { id: 'riferimentoCedolino',    label: 'Riferimento cedolino' },
  { id: 'nominativi',             label: 'Elenco nominativi con importi' },
  { id: 'importiScorporo',        label: 'Lordo beneficiario',
    hint: 'Visibile solo se il gruppo ha il flag Scorporo attivo' },
  { id: 'totaleLordo',            label: 'Totale lordo' },
  { id: 'note',                   label: 'Note' },
]


// ── Stili condivisi ───────────────────────────────────────────

const inputCls = `w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700
  text-white text-sm placeholder-slate-500
  focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition`

// ── Componente principale ─────────────────────────────────────

export default function ComunicazioneModal({ dettaglio, noms, existing, onSave, onDelete, onClose }: Props) {
  const { settings, voci, capitoliAnag, currentBozzaNome } = useStore()
  const rubrica       = settings.rubrica              ?? []
  const modelli       = settings.modelliComunicazione ?? []
  const coefficienti  = settings.coefficienti

  // Lookup descrizioni voce dalla tabella voci HR
  const voceItem = voci.find(v => v.codice === dettaglio.voce)
  const descVoce = voceItem?.descrizione ?? ''

  // Lookup descrizione capitolo:
  // 1° tentativo → capitoli inline nella voce (Voci_STAMPA.xml)
  // 2° tentativo → capitoliAnag standalone (Capitoli_STAMPA.xml / Capitoli_Locali_STAMPA.xml)
  const capInlineDesc = voceItem?.capitoli.find(c => c.codice === dettaglio.capitolo)?.descrizione
  const capAnagDesc   = capitoliAnag.find(c => c.codice === dettaglio.capitolo)?.descrizione
  const descCapitolo  = capInlineDesc ?? capAnagDesc ?? ''

  /** Costruisce il PdfContext con i campi correnti del form */
  function makePdfCtx(campi: string[]): PdfContext {
    return { det: dettaglio, noms, campi, descVoce, descCapitolo, coefficienti, bozzaNome: currentBozzaNome }
  }

  // ── Stato form ────────────────────────────────────────────
  const [tab, setTab]               = useState<Tab>('destinatari')
  const [pdfLoading, setPdfLoading] = useState(false)
  const [emlLoading, setEmlLoading] = useState(false)
  const pdfInFlight = useRef(false)
  const emlInFlight = useRef(false)
  const titleId     = useId()
  const dialogRef   = useRef<HTMLDivElement>(null)
  useModalKeyboard(dialogRef, onClose)
  const [destinatari, setDestinatari] = useState<Destinatario[]>(
    existing?.destinatari ?? [],
  )
  const [oggetto,       setOggetto]       = useState(existing?.oggetto       ?? '')
  const [corpo,         setCorpo]         = useState(existing?.corpo         ?? '')
  const [campiAllegato, setCampiAllegato] = useState<string[]>(
    existing?.campiAllegato ?? CAMPI_ALLEGATO.map(c => c.id),
  )
  const [stato, setStato] = useState<'bozza' | 'validata'>(
    existing?.stato ?? 'bozza',
  )

  // Destinatario manuale
  const [nomeManuale,  setNomeManuale]  = useState('')
  const [emailManuale, setEmailManuale] = useState('')

  // Modello
  const [modelloSel, setModelloSel]     = useState('')
  const [nomeModello, setNomeModello]   = useState('')
  const [saveModello, setSaveModello]   = useState(false)

  function addDestManuale() {
    const e = emailManuale.trim()
    const n = nomeManuale.trim() || e
    if (!e || destinatari.some(d => d.email === e)) return
    setDestinatari(prev => [...prev, { nome: n, email: e }])
    setNomeManuale('')
    setEmailManuale('')
  }

  function toggleRubrica(c: typeof rubrica[0]) {
    if (destinatari.some(d => d.email === c.email)) {
      setDestinatari(prev => prev.filter(d => d.email !== c.email))
    } else {
      setDestinatari(prev => [...prev, { nome: c.nome, email: c.email }])
    }
  }

  function applicaModello(id: string) {
    const m = modelli.find(x => x.id === id)
    if (!m) return
    setOggetto(m.oggetto)
    setCorpo(m.corpo)
    setModelloSel(id)
    setTab('messaggio')
  }

  function toggleCampo(id: string) {
    setCampiAllegato(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id],
    )
  }

  function buildComunicazione(): Comunicazione {
    const now = new Date().toISOString()
    return {
      id:            existing?.id            ?? crypto.randomUUID(),
      dettaglioId:   dettaglio.id,
      stato,
      destinatari,
      oggetto,
      corpo,
      campiAllegato,
      createdAt:     existing?.createdAt     ?? now,
      updatedAt:     now,
    }
  }

  function handleSalva() {
    const com = buildComunicazione()
    if (saveModello && nomeModello.trim()) {
      // salva modello in settings — delegato all'utente via onSave (ImpostazioniPage gestirà)
      // per ora includiamo un side-effect via evento custom
      const evento = new CustomEvent('payroll:save-modello', {
        detail: { id: crypto.randomUUID(), nome: nomeModello.trim(), oggetto, corpo },
      })
      window.dispatchEvent(evento)
    }
    onSave(com)
  }

  async function handleCreaPdf() {
    if (pdfInFlight.current) return
    pdfInFlight.current = true
    setPdfLoading(true)
    try {
      await downloadPdf(makePdfCtx(campiAllegato))
    } finally {
      setPdfLoading(false)
      pdfInFlight.current = false
    }
  }

  async function handleCreaEml() {
    if (emlInFlight.current) return
    emlInFlight.current = true
    setEmlLoading(true)
    try {
      // Auto-aggiunge il destinatario manuale se compilato e non ancora in lista
      const eMail = emailManuale.trim()
      let destsFinali = destinatari
      if (eMail && !destinatari.some(d => d.email === eMail)) {
        const dest = { nome: nomeManuale.trim() || eMail, email: eMail }
        destsFinali = [...destinatari, dest]
        setDestinatari(destsFinali)
        setNomeManuale('')
        setEmailManuale('')
      }
      const com = { ...buildComunicazione(), destinatari: destsFinali }
      // PdfContext senza campi (downloadEml usa com.campiAllegato)
      await downloadEml(com, makePdfCtx([]))
    } finally {
      setEmlLoading(false)
      emlInFlight.current = false
    }
  }

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'destinatari', label: 'Destinatari' },
    { id: 'messaggio',   label: 'Messaggio' },
    { id: 'allegato',    label: 'Allegato PDF' },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div ref={dialogRef} className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl
                      max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <h2 id={titleId} className="text-white font-semibold flex items-center gap-2">
              <span className="text-indigo-400" aria-hidden="true">✉</span>
              Comunicazione
            </h2>
            <p className="text-slate-500 text-xs mt-0.5 truncate max-w-xs">
              {dettaglio.nomeDescrittivo || 'Gruppo senza nome'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Stato toggle */}
            <button
              type="button"
              onClick={() => setStato(s => s === 'bozza' ? 'validata' : 'bozza')}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition border
                ${stato === 'validata'
                  ? 'bg-emerald-900/40 text-emerald-400 border-emerald-800'
                  : 'bg-slate-800 text-slate-400 border-slate-700'}`}
            >
              {stato === 'validata' ? '✓ Validata' : '○ Bozza'}
            </button>
            <button
              onClick={onClose}
              aria-label="Chiudi"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0.5 px-5 pt-3">
          {TABS.map(t => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-t-lg text-sm font-medium transition
                ${tab === t.id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* ── TAB DESTINATARI ──────────────────────────────── */}
          {tab === 'destinatari' && (
            <>
              {/* Destinatari selezionati */}
              {destinatari.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {destinatari.map(d => (
                    <span
                      key={d.email}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                                 bg-indigo-900/40 border border-indigo-800 text-indigo-200 text-xs"
                    >
                      <span className="font-medium">{d.nome}</span>
                      <span className="text-indigo-400 font-mono">&lt;{d.email}&gt;</span>
                      <button
                        type="button"
                        onClick={() => setDestinatari(prev => prev.filter(x => x.email !== d.email))}
                        className="ml-0.5 text-indigo-400 hover:text-white transition"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Rubrica */}
              {rubrica.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-2">Rubrica contatti</p>
                  <div className="rounded-lg border border-slate-700 overflow-hidden">
                    {rubrica.map(c => {
                      const sel = destinatari.some(d => d.email === c.email)
                      return (
                        <button
                          key={c.email}
                          type="button"
                          onClick={() => toggleRubrica(c)}
                          className={`w-full flex items-center gap-3 px-3 py-2 text-left border-b
                            border-slate-800/50 last:border-0 transition
                            ${sel ? 'bg-indigo-900/20' : 'hover:bg-slate-800/40'}`}
                        >
                          <span className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center
                            ${sel ? 'bg-indigo-600 border-indigo-600' : 'border-slate-600'}`}>
                            {sel && (
                              <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/>
                              </svg>
                            )}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white">{c.nome}</p>
                            <p className="text-xs text-slate-500 font-mono truncate">{c.email}</p>
                          </div>
                          {c.ruolo && (
                            <span className="text-xs text-slate-600 shrink-0">{c.ruolo}</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Aggiunta manuale */}
              <div>
                <p className="text-xs font-medium text-slate-400 mb-2">Aggiungi destinatario manuale</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Nome"
                    value={nomeManuale}
                    onChange={e => setNomeManuale(e.target.value)}
                    className={`${inputCls} flex-1`}
                  />
                  <input
                    type="email"
                    placeholder="email@esempio.it"
                    value={emailManuale}
                    onChange={e => setEmailManuale(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addDestManuale())}
                    className={`${inputCls} flex-1`}
                  />
                  <button
                    type="button"
                    onClick={addDestManuale}
                    className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500
                               text-white text-sm font-medium transition shrink-0"
                  >
                    +
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── TAB MESSAGGIO ────────────────────────────────── */}
          {tab === 'messaggio' && (
            <>
              {/* Selezione modello */}
              {modelli.length > 0 && (
                <div className="flex items-center gap-2">
                  <select
                    value={modelloSel}
                    onChange={e => setModelloSel(e.target.value)}
                    className={`${inputCls} flex-1`}
                  >
                    <option value="">— Scegli un modello —</option>
                    {modelli.map(m => (
                      <option key={m.id} value={m.id}>{m.nome}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => applicaModello(modelloSel)}
                    disabled={!modelloSel}
                    className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600
                               text-slate-200 text-sm transition disabled:opacity-40 shrink-0"
                  >
                    Applica
                  </button>
                </div>
              )}

              {/* Oggetto */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Oggetto</label>
                <input
                  type="text"
                  value={oggetto}
                  onChange={e => setOggetto(e.target.value)}
                  placeholder="Oggetto della comunicazione"
                  className={inputCls}
                />
              </div>

              {/* Corpo */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Corpo</label>
                <textarea
                  value={corpo}
                  onChange={e => setCorpo(e.target.value)}
                  rows={8}
                  placeholder="Testo della comunicazione…"
                  className={inputCls}
                />
              </div>

              {/* Salva come modello */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                <input
                  type="checkbox"
                  id="saveModello"
                  checked={saveModello}
                  onChange={e => setSaveModello(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-600 text-indigo-600"
                />
                <label htmlFor="saveModello" className="text-sm text-slate-300 cursor-pointer">
                  Salva come modello
                </label>
                {saveModello && (
                  <input
                    type="text"
                    value={nomeModello}
                    onChange={e => setNomeModello(e.target.value)}
                    placeholder="Nome del modello"
                    className={`${inputCls} flex-1`}
                  />
                )}
              </div>
            </>
          )}

          {/* ── TAB ALLEGATO ─────────────────────────────────── */}
          {tab === 'allegato' && (
            <>
              <p className="text-xs text-slate-400">
                Seleziona i campi da includere nell'allegato PDF — verrà generato e allegato
                automaticamente sia al file EML sia al download diretto PDF.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {CAMPI_ALLEGATO.map(campo => {
                  // "Importi scorporati" disabilitato se il gruppo non ha flagScorporo
                  const isScorporoField = campo.id === 'importiScorporo'
                  const scorporoInactive = isScorporoField && !dettaglio.flagScorporo
                  return (
                    <label key={campo.id}
                      className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border
                        cursor-pointer transition
                        ${scorporoInactive
                          ? 'bg-slate-800/20 border-slate-800 opacity-50 cursor-not-allowed'
                          : 'bg-slate-800/50 border-slate-700/60 hover:border-slate-600'}`}
                    >
                      <input
                        type="checkbox"
                        checked={campiAllegato.includes(campo.id)}
                        onChange={() => !scorporoInactive && toggleCampo(campo.id)}
                        disabled={scorporoInactive}
                        className="w-4 h-4 rounded border-slate-600 text-indigo-600 shrink-0 mt-0.5"
                      />
                      <div className="min-w-0">
                        <span className="text-sm text-slate-300 block">{campo.label}</span>
                        {campo.hint && (
                          <span className="text-xs text-slate-500 block leading-tight mt-0.5">
                            {scorporoInactive ? '⚠ Scorporo non attivo su questo gruppo' : campo.hint}
                          </span>
                        )}
                      </div>
                    </label>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-slate-800">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 text-sm transition"
            >
              Annulla
            </button>
            {existing && onDelete && (
              <button
                type="button"
                onClick={() => { onDelete(existing.id); onClose() }}
                className="text-red-500 hover:text-red-400 text-sm transition"
              >
                Elimina
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* PDF — scarica direttamente il file .pdf */}
            <button
              type="button"
              onClick={handleCreaPdf}
              disabled={pdfLoading}
              className="flex items-center gap-2 px-3 py-2 rounded-lg
                         bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm transition
                         disabled:opacity-50 disabled:cursor-wait"
              title="Scarica allegato come file PDF"
            >
              {pdfLoading ? (
                /* spinner SVG animato */
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10"
                    stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12h6m-6 4h4"/>
                </svg>
              )}
              {pdfLoading ? 'Generazione…' : 'PDF'}
            </button>
            <button
              type="button"
              onClick={handleCreaEml}
              disabled={emlLoading || (destinatari.length === 0 && !emailManuale.trim()) || !oggetto.trim()}
              className="flex items-center gap-2 px-3 py-2 rounded-lg
                         bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm transition
                         disabled:opacity-50 disabled:cursor-wait"
              title="Scarica file .eml con allegato PDF"
            >
              {emlLoading ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10"
                    stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                </svg>
              )}
              {emlLoading ? 'Generazione…' : 'Crea EML'}
            </button>
            <button
              type="button"
              onClick={handleSalva}
              className="flex items-center gap-2 px-4 py-2 rounded-lg
                         bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition"
            >
              {existing ? 'Aggiorna' : 'Salva'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
