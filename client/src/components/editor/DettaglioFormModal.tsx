// ============================================================
// PAYROLL GANG SUITE — DettaglioFormModal
// Modal add/edit DettaglioLiquidazione
// Voce  → ricerca su tabella Voci HR
// Capitolo → ricerca su tabella Capitoli HR
// ============================================================

import { useState, useEffect, useMemo, useRef, useId, cloneElement, isValidElement, Children } from 'react'
import { useStore } from '../../store/useStore'
import { lastDayOfMonth } from '../../utils/biz'
import { DEFAULT_CSV_PARAMS } from '../../constants/csvDefaults'
import { vociApi, capitoliApi, anagraficheApi } from '../../api/endpoints'
import { showToast } from '../ToastManager'
import { useModalKeyboard } from '../../hooks/useFocusTrap'
import type { DettaglioLiquidazione } from '../../types'

interface Props {
  existing?: DettaglioLiquidazione
  onClose:   () => void
}

type Tab = 'base' | 'provvedimento' | 'avanzato'

export default function DettaglioFormModal({ existing, onClose }: Props) {
  const {
    addDettaglio, updateDettaglio, settings,
    voci, setVoci,
    capitoliAnag, setCapitoliAnag,
  } = useStore()
  const titleId   = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalKeyboard(dialogRef, onClose)

  const csv  = settings?.csvDefaults ?? DEFAULT_CSV_PARAMS
  const tags = (settings?.tags ?? []).map(t => t.prefisso)

  // ── Stato form ────────────────────────────────────────────
  const [tab, setTab]                               = useState<Tab>('base')
  const [nomeDescrittivo, setNomeDescrittivo]       = useState(existing?.nomeDescrittivo ?? '')
  const [voce, setVoce]                             = useState(existing?.voce ?? '')
  const [capitolo, setCapitolo]                     = useState(existing?.capitolo ?? '')
  const [competenza, setCompetenza]                 = useState(existing?.competenzaLiquidazione ?? '')
  const [dataCompetenzaVoce, setDataCompetenzaVoce] = useState(existing?.dataCompetenzaVoce ?? '')
  const [flagScorporo, setFlagScorporo]             = useState(existing?.flagScorporo ?? false)
  const [riferimento, setRiferimento]               = useState(existing?.riferimentoCedolino ?? '')
  const [idProv, setIdProv]                         = useState(existing?.identificativoProvvedimento ?? '000000000')
  const [tipoProv, setTipoProv]                     = useState(existing?.tipoProvvedimento ?? csv.tipoProvvedimento)
  const [numProv, setNumProv]                       = useState(existing?.numeroProvvedimento ?? '')
  const [dataProv, setDataProv]                     = useState(existing?.dataProvvedimento ?? '')
  const [aliquota, setAliquota]                     = useState(String(existing?.aliquota ?? csv.aliquota))
  const [parti, setParti]                           = useState(String(existing?.parti ?? csv.parti))
  const [flagAdem, setFlagAdem]                     = useState(String(existing?.flagAdempimenti ?? csv.flagAdempimenti))
  const [idContratto, setIdContratto]               = useState(existing?.idContrattoCSA ?? csv.idContrattoCSA)
  const [centroCosto, setCentroCosto]               = useState(existing?.centroCosto ?? '')
  const [note, setNote]                             = useState(existing?.note ?? '')

  // ── Search state ──────────────────────────────────────────
  const [voceSearch, setVoceSearch]         = useState(existing?.voce ?? '')
  const [capitoloSearch, setCapitoloSearch] = useState(existing?.capitolo ?? '')
  const [voceOpen, setVoceOpen]             = useState(!existing?.voce)
  const [capitoloOpen, setCapitoloOpen]     = useState(!existing?.capitolo)

  // ── Lazy load voci / capitoli se non ancora in store ─────
  useEffect(() => {
    if (voci.length === 0) {
      vociApi.active().then(data => setVoci(data)).catch(() => {})
    }
    if (capitoliAnag.length === 0) {
      capitoliApi.list().then(data => setCapitoliAnag(data)).catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fill dataCompetenzaVoce quando competenza è completa
  useEffect(() => {
    if (/^\d{2}\/\d{4}$/.test(competenza) && !dataCompetenzaVoce) {
      setDataCompetenzaVoce(lastDayOfMonth(competenza))
    }
  }, [competenza]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Ricerca word-tokenized ────────────────────────────────

  const vociFiltrate = useMemo(() => {
    const words = voceSearch.toLowerCase().trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return voci.slice(0, 60)
    return voci.filter(v => {
      const hay = `${v.codice} ${v.descrizione}`.toLowerCase()
      return words.every(w => hay.includes(w))
    }).slice(0, 60)
  }, [voci, voceSearch])

  const capitaliFiltrati = useMemo(() => {
    const words = capitoloSearch.toLowerCase().trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return capitoliAnag.slice(0, 60)
    return capitoliAnag.filter(c => {
      const hay = `${c.codice} ${c.descrizione ?? ''} ${c.breve ?? ''}`.toLowerCase()
      return words.every(w => hay.includes(w))
    }).slice(0, 60)
  }, [capitoliAnag, capitoloSearch])

  // Descrizione voce/capitolo selezionato (per display)
  const selectedVoceObj    = voci.find(v => v.codice === voce)
  const selectedCapitoloObj = capitoliAnag.find(c => c.codice === capitolo)

  // ── Submit ────────────────────────────────────────────────
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const data: Partial<Omit<DettaglioLiquidazione, 'id' | 'colore'>> = {
      nomeDescrittivo,
      voce,
      capitolo,
      competenzaLiquidazione:      competenza,
      dataCompetenzaVoce,
      flagScorporo,
      riferimentoCedolino:         riferimento,
      identificativoProvvedimento: idProv,
      tipoProvvedimento:           tipoProv,
      numeroProvvedimento:         numProv,
      dataProvvedimento:           dataProv,
      aliquota:                    parseFloat(aliquota) || 0,
      parti:                       parseFloat(parti) || 0,
      flagAdempimenti:             parseInt(flagAdem) || 0,
      idContrattoCSA:              idContratto,
      centroCosto,
      note,
      // preserve existing flag until staleness check overwrites it
      anagraficheOutdated: existing?.anagraficheOutdated ?? false,
    }

    // Persist immediately, then check staleness in background
    let detId: string
    if (existing) {
      updateDettaglio(existing.id, data)
      detId = existing.id
    } else {
      detId = addDettaglio(data)
    }
    onClose()

    // Background: verifica se dataCompetenzaVoce è successiva all'ultimo import anagrafiche
    if (dataCompetenzaVoce) {
      anagraficheApi.lastImport()
        .then(({ lastImport }) => {
          if (!lastImport) return
          const importDate = lastImport.slice(0, 10)  // YYYY-MM-DD
          if (dataCompetenzaVoce > importDate) {
            updateDettaglio(detId, { anagraficheOutdated: true })
            showToast(
              `Data competenza voce (${dataCompetenzaVoce}) successiva all'ultimo import anagrafiche (${importDate}).\nVerifica i ruoli con "Aggiorna Ruolo" prima di esportare il CSV.`,
              'warning',
            )
          } else {
            updateDettaglio(detId, { anagraficheOutdated: false })
          }
        })
        .catch(() => { /* nessuna connessione — ignora */ })
    }
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'base',          label: 'Principale' },
    { id: 'provvedimento', label: 'Provvedimento' },
    { id: 'avanzato',      label: 'Avanzato' },
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
          <h2 id={titleId} className="text-white font-semibold">
            {existing ? 'Modifica gruppo' : 'Nuovo gruppo liquidazione'}
          </h2>
          <button onClick={onClose} aria-label="Chiudi"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="px-5 py-4 space-y-4">

            {/* ── TAB BASE ──────────────────────────────────── */}
            {tab === 'base' && (
              <>
                <Field label="Nome descrittivo *">
                  <input required value={nomeDescrittivo} onChange={e => setNomeDescrittivo(e.target.value)}
                    placeholder="es. TFA Sostegno Nov 2026" className={inputCls} />
                </Field>

                {/* ── VOCE HR ──────────────────────────── */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium text-slate-300">Voce HR</label>
                    {voce && (
                      <button type="button" onClick={() => { setVoce(''); setVoceSearch(''); setVoceOpen(true) }}
                        className="text-xs text-slate-500 hover:text-red-400 transition">
                        Deseleziona
                      </button>
                    )}
                  </div>

                  {/* Valore selezionato */}
                  {voce && !voceOpen ? (
                    <button type="button" onClick={() => setVoceOpen(true)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg
                                 bg-indigo-900/30 border border-indigo-700/50 text-left hover:bg-indigo-900/40 transition">
                      <span className="font-mono text-indigo-300 text-sm shrink-0">{voce}</span>
                      <span className="text-white text-sm truncate">{selectedVoceObj?.descrizione ?? ''}</span>
                      <svg className="w-3.5 h-3.5 text-slate-500 ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
                      </svg>
                    </button>
                  ) : (
                    <div className="space-y-1">
                      <input autoFocus={voceOpen} value={voceSearch}
                        onChange={e => setVoceSearch(e.target.value)}
                        placeholder="Cerca per codice o descrizione…"
                        className={inputCls} />
                      {voci.length === 0 ? (
                        <p className="text-xs text-amber-400 px-1">
                          Nessuna voce caricata. Importa le voci dalla sezione "Voci HR".
                        </p>
                      ) : (
                        <div className="rounded-lg border border-slate-700 overflow-hidden max-h-44 overflow-y-auto">
                          {vociFiltrate.length === 0 ? (
                            <p className="text-center py-4 text-slate-500 text-sm">Nessun risultato.</p>
                          ) : vociFiltrate.map(v => (
                            <button key={`${v.codice}-${v.dataIn}`} type="button"
                              onClick={() => { setVoce(v.codice); setVoceOpen(false) }}
                              className="w-full flex items-center gap-3 px-3 py-2 text-left
                                         hover:bg-slate-700/60 transition border-b border-slate-800/50 last:border-0">
                              <span className="font-mono text-indigo-400 text-xs shrink-0 w-14">{v.codice}</span>
                              <span className="text-slate-200 text-sm truncate">{v.descrizione}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ── CAPITOLO ─────────────────────────── */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium text-slate-300">Capitolo</label>
                    {capitolo && (
                      <button type="button" onClick={() => { setCapitolo(''); setCapitoloSearch(''); setCapitoloOpen(true) }}
                        className="text-xs text-slate-500 hover:text-red-400 transition">
                        Deseleziona
                      </button>
                    )}
                  </div>

                  {/* Valore selezionato */}
                  {capitolo && !capitoloOpen ? (
                    <button type="button" onClick={() => setCapitoloOpen(true)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg
                                 bg-emerald-900/30 border border-emerald-700/50 text-left hover:bg-emerald-900/40 transition">
                      <span className="font-mono text-emerald-300 text-sm shrink-0">{capitolo}</span>
                      <span className="text-white text-sm truncate">
                        {selectedCapitoloObj?.descrizione ?? selectedCapitoloObj?.breve ?? ''}
                      </span>
                      <svg className="w-3.5 h-3.5 text-slate-500 ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
                      </svg>
                    </button>
                  ) : (
                    <div className="space-y-1">
                      <input value={capitoloSearch}
                        onChange={e => setCapitoloSearch(e.target.value)}
                        placeholder="Cerca per codice o descrizione…"
                        className={inputCls} />
                      {capitoliAnag.length === 0 ? (
                        <p className="text-xs text-amber-400 px-1">
                          Nessun capitolo caricato. Importa i capitoli dalla sezione "Capitoli".
                        </p>
                      ) : (
                        <div className="rounded-lg border border-slate-700 overflow-hidden max-h-44 overflow-y-auto">
                          {capitaliFiltrati.length === 0 ? (
                            <p className="text-center py-4 text-slate-500 text-sm">Nessun risultato.</p>
                          ) : capitaliFiltrati.map(c => (
                            <button key={`${c.codice}-${c.sorgente}`} type="button"
                              onClick={() => { setCapitolo(c.codice); setCapitoloOpen(false) }}
                              className="w-full flex items-center gap-3 px-3 py-2 text-left
                                         hover:bg-slate-700/60 transition border-b border-slate-800/50 last:border-0">
                              <span className="font-mono text-emerald-400 text-xs shrink-0 w-16">{c.codice}</span>
                              <span className="text-slate-200 text-sm truncate flex-1">
                                {c.descrizione ?? c.breve ?? '—'}
                              </span>
                              <span className="text-xs text-slate-600 shrink-0">{c.sorgente}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Competenza */}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Competenza (MM/YYYY)">
                    <input value={competenza} onChange={e => setCompetenza(e.target.value)}
                      placeholder="04/2026" pattern="\d{2}/\d{4}" title="Formato MM/YYYY"
                      className={inputCls} />
                  </Field>
                  <Field label="Data competenza voce">
                    <input type="date" value={dataCompetenzaVoce}
                      onChange={e => setDataCompetenzaVoce(e.target.value)} className={inputCls} />
                  </Field>
                </div>

                {/* Scorporo */}
                <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                  <input type="checkbox" id="flagScorporo" checked={flagScorporo}
                    onChange={e => setFlagScorporo(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-600 text-indigo-600" />
                  <label htmlFor="flagScorporo" className="text-sm text-slate-200 cursor-pointer">
                    Applica scorporo
                    <span className="text-slate-400 text-xs block">
                      Calcola importo netto per ruoli PA/PO/RD/RU/ND
                    </span>
                  </label>
                </div>

                {/* Riferimento cedolino */}
                <Field label="Riferimento cedolino">
                  <input value={riferimento} onChange={e => setRiferimento(e.target.value)}
                    placeholder="es. TL@TFA SOSTEGNO 2023/24@" className={inputCls} />
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {tags.map(tag => (
                        <button key={tag} type="button"
                          onClick={() => setRiferimento(v => v + tag + '@')}
                          className="px-2 py-0.5 rounded text-xs bg-slate-700 text-slate-300 hover:bg-slate-600 transition">
                          {tag}
                        </button>
                      ))}
                    </div>
                  )}
                </Field>
              </>
            )}

            {/* ── TAB PROVVEDIMENTO ──────────────────────────── */}
            {tab === 'provvedimento' && (
              <>
                <Field label="ID Provvedimento (9 cifre)">
                  <input value={idProv}
                    onChange={e => setIdProv(e.target.value.replace(/\D/g, '').slice(0, 9))}
                    placeholder="000000000" maxLength={9}
                    className={`${inputCls} font-mono tracking-widest`} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Tipo Provvedimento">
                    <input value={tipoProv} onChange={e => setTipoProv(e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="Numero Provvedimento">
                    <input value={numProv} onChange={e => setNumProv(e.target.value)} className={inputCls} />
                  </Field>
                </div>
                <Field label="Data Provvedimento">
                  <input type="date" value={dataProv} onChange={e => setDataProv(e.target.value)} className={inputCls} />
                </Field>
              </>
            )}

            {/* ── TAB AVANZATO ──────────────────────────────── */}
            {tab === 'avanzato' && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Aliquota">
                    <input type="number" value={aliquota} onChange={e => setAliquota(e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="Parti">
                    <input type="number" value={parti} onChange={e => setParti(e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="Flag Adempimenti">
                    <input type="number" value={flagAdem} onChange={e => setFlagAdem(e.target.value)} className={inputCls} />
                  </Field>
                </div>
                <Field label="ID Contratto CSA">
                  <input value={idContratto} onChange={e => setIdContratto(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Centro di Costo">
                  <input value={centroCosto} onChange={e => setCentroCosto(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Note">
                  <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} className={inputCls} />
                </Field>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-800">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-800 text-sm transition">
              Annulla
            </button>
            <button type="submit"
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500
                         text-white text-sm font-medium transition">
              {existing ? 'Salva modifiche' : 'Aggiungi gruppo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────

const inputCls = `w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700
  text-white text-sm placeholder-slate-500
  focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition`

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id       = useId()
  const childArr = Children.toArray(children)
  const first    = childArr[0]
  const rest     = childArr.slice(1)
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-300 mb-1.5">{label}</label>
      {isValidElement(first) ? cloneElement(first as React.ReactElement<{ id?: string }>, { id }) : first}
      {rest}
    </div>
  )
}
