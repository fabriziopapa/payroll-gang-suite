// ============================================================
// PAYROLL GANG SUITE — DettaglioCard
// Card colorata con lista nominativi e azioni
// ============================================================

import { useState, useRef, useEffect, useCallback } from 'react'
import { useStore } from '../../store/useStore'
import { showToast } from '../ToastManager'
import { ConfirmDialog } from '../ConfirmDialog'
import { calcolaImportoCSV, formatEur } from '../../utils/biz'
import type { DettaglioLiquidazione, Nominativo } from '../../types'
import { anagraficheApi } from '../../api/endpoints'
import RuoloDisambiguaModal, { type DisambiguaItem } from '../RuoloDisambiguaModal'
import ConflittoRuoloModal, { type ConflittoItem } from '../ConflittoRuoloModal'
import ComunicazioneModal from './ComunicazioneModal'
import type { Comunicazione } from '../../types'
import BudgetPanel from './BudgetPanel'

interface Props {
  dettaglio:        DettaglioLiquidazione
  onEdit:           () => void
  onAddNominativo:  () => void
}

export default function DettaglioCard({ dettaglio, onEdit, onAddNominativo }: Props) {
  const {
    nominativi, removeDettaglio, removeNominativo, addDettaglio,
    updateNominativo, settings,
    comunicazioni, addComunicazione, updateComunicazione, removeComunicazione,
  } = useStore()
  const [collapsed, setCollapsed]             = useState(false)
  const [editingImportoNomId, setEditingImportoNomId] = useState<string | null>(null)
  const [aggRuoloLoading, setAggRuoloLoading] = useState(false)
  const [disambiguaItems, setDisambiguaItems] = useState<DisambiguaItem[]>([])
  const [conflittoItems, setConflittoItems]   = useState<ConflittoItem[]>([])
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null)
  const [deleteGruppoOpen, setDeleteGruppoOpen] = useState(false)
  const [comunModal,   setComunModal]   = useState<{ open: boolean; existing?: Comunicazione }>({ open: false })
  const [comunList,    setComunList]    = useState(false)   // mostra lista comunicazioni esistenti
  const comunMenuRef = useRef<HTMLDivElement>(null)

  // Chiudi il dropdown lista comunicazioni cliccando fuori (senza capture — usa ref)
  const handleOutsideClick = useCallback((e: MouseEvent) => {
    if (comunMenuRef.current && !comunMenuRef.current.contains(e.target as Node)) {
      setComunList(false)
    }
  }, [])

  useEffect(() => {
    if (!comunList) return
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [comunList, handleOutsideClick])

  function handleDuplica() {
    addDettaglio({
      nomeDescrittivo:             `${dettaglio.nomeDescrittivo} (copia)`,
      voce:                        dettaglio.voce,
      capitolo:                    dettaglio.capitolo,
      competenzaLiquidazione:      dettaglio.competenzaLiquidazione,
      dataCompetenzaVoce:          dettaglio.dataCompetenzaVoce,
      flagScorporo:                dettaglio.flagScorporo,
      riferimentoCedolino:         dettaglio.riferimentoCedolino,
      identificativoProvvedimento: dettaglio.identificativoProvvedimento,
      tipoProvvedimento:           dettaglio.tipoProvvedimento,
      numeroProvvedimento:         dettaglio.numeroProvvedimento,
      dataProvvedimento:           dettaglio.dataProvvedimento,
      aliquota:                    dettaglio.aliquota,
      parti:                       dettaglio.parti,
      flagAdempimenti:             dettaglio.flagAdempimenti,
      idContrattoCSA:              dettaglio.idContrattoCSA,
      centroCosto:                 dettaglio.centroCosto,
      note:                        dettaglio.note,
    })
  }

  const noms         = nominativi.filter(n => n.dettaglioId === dettaglio.id)
  const comunDettaglio = comunicazioni.filter(c => c.dettaglioId === dettaglio.id)

  function confirmDelete() {
    setDeleteGruppoOpen(true)
  }

  function downloadMatricolePerRuolo() {
    const byRuolo: Record<string, string[]> = {}
    for (const nom of noms) {
      if (!byRuolo[nom.ruolo]) byRuolo[nom.ruolo] = []
      byRuolo[nom.ruolo]!.push(nom.matricola)
    }
    const fileBase = dettaglio.nomeDescrittivo.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30)
    Object.entries(byRuolo).forEach(([ruolo, matricole], i) => {
      setTimeout(() => {
        const blob = new Blob([matricole.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' })
        const url  = URL.createObjectURL(blob)
        const a    = Object.assign(document.createElement('a'), {
          href: url, download: `matricole_${fileBase}_${ruolo}.txt`,
        })
        a.click()
        URL.revokeObjectURL(url)
      }, i * 150)
    })
  }

  /**
   * Aggiorna il ruolo di tutti i nominativi confrontando il ruolo attuale
   * con il dato storico in DB alla data competenza voce.
   *
   * Per ogni nominativo:
   *  A) DB restituisce 1 risultato  AND  ruolo diverso dall'attuale
   *     → ConflittoRuoloModal: utente sceglie quale tenere
   *  B) DB restituisce 1 risultato  AND  ruolo già coincide
   *     → nessuna azione (reset flag ruoloModificato se presente)
   *  C) DB restituisce >1 risultato
   *     → RuoloDisambiguaModal: utente sceglie il periodo corretto
   *  D) DB restituisce 0 risultati
   *     → nessun dato storico disponibile, lascia invariato
   */
  async function handleAggiornaRuolo() {
    if (noms.length === 0) return
    setAggRuoloLoading(true)

    const dataDate     = dettaglio.dataCompetenzaVoce || undefined
    const toDisambigua: DisambiguaItem[]  = []
    const toConflitto:  ConflittoItem[]   = []

    const CHUNK = 15
    for (let c = 0; c < noms.length; c += CHUNK) {
      const chunk = noms.slice(c, c + CHUNK)
      await Promise.all(chunk.map(async nom => {
        try {
          const results = await anagraficheApi.ruoloAt(nom.matricola, dataDate)

          // D) Nessun dato storico — lascia invariato
          if (results.length === 0) return

          // C) Ambiguo — serve scelta del periodo
          if (results.length > 1) {
            toDisambigua.push({
              nomId:       nom.id,
              matricola:   nom.matricola,
              cognomeNome: nom.cognomeNome,
              options:     results,
            })
            return
          }

          // A / B — un solo risultato
          const dbRuolo  = results[0]!.ruolo
          const dbDruolo = results[0]!.druolo ?? null

          if (dbRuolo !== nom.ruolo) {
            // A) Ruolo diverso → mostra conflitto per tutti (manuale o meno)
            toConflitto.push({
              nomId:        nom.id,
              matricola:    nom.matricola,
              cognomeNome:  nom.cognomeNome,
              ruoloManuale: nom.ruolo,
              ruoloDb:      dbRuolo,
              druoloDb:     dbDruolo,
            })
          } else {
            // B) Già corretto — resetta solo il flag visivo se serve
            if (nom.ruoloModificato) {
              updateNominativo(nom.id, { ruoloModificato: false })
            }
          }
        } catch {
          showToast('Errore aggiornamento ruoli — riprova', 'error')
        }
      }))
    }

    setAggRuoloLoading(false)

    // Prima i conflitti, poi eventuali disambiguation
    if (toConflitto.length > 0) {
      setConflittoItems(toConflitto)
      pendingDisambigua.current = toDisambigua
    } else if (toDisambigua.length > 0) {
      setDisambiguaItems(toDisambigua)
    }
  }

  // Ref per tenere la coda disambiguation in attesa (aperta dopo conflitti)
  const pendingDisambigua = useRef<DisambiguaItem[]>([])

  const ruoliDistinti = [...new Set(noms.map(n => n.ruolo))]

  return (
    <>
    {/* Conflitti: ruolo modificato manualmente vs dato storico DB */}
    {conflittoItems.length > 0 && (
      <ConflittoRuoloModal
        items={conflittoItems}
        onResolve={(nomId, scelta) => {
          if (scelta === 'db') {
            const item = conflittoItems.find(c => c.nomId === nomId)
            if (item) {
              updateNominativo(nomId, {
                ruolo:           item.ruoloDb,
                druolo:          item.druoloDb ?? undefined,
                ruoloModificato: false,
              })
            }
          }
          // scelta === 'mantieni': non toccare il nominativo, lascia ruoloModificato: true
        }}
        onAllResolved={() => {
          setConflittoItems([])
          // Apri eventuali disambiguation rimaste in coda
          if (pendingDisambigua.current.length > 0) {
            setDisambiguaItems(pendingDisambigua.current)
            pendingDisambigua.current = []
          }
        }}
        onClose={() => {
          setConflittoItems([])
          pendingDisambigua.current = []
        }}
      />
    )}
    {/* Ruoli ambigui (>1 risultato da DB) */}
    {disambiguaItems.length > 0 && (
      <RuoloDisambiguaModal
        items={disambiguaItems}
        onResolve={(nomId, ruolo, druolo) => {
          updateNominativo(nomId, { ruolo, druolo, ruoloModificato: false })
        }}
        onAllResolved={() => setDisambiguaItems([])}
        onClose={() => setDisambiguaItems([])}
      />
    )}
    {/* Modale comunicazione */}
    {comunModal.open && (
      <ComunicazioneModal
        dettaglio={dettaglio}
        noms={noms}
        existing={comunModal.existing}
        onSave={(com) => {
          if (comunModal.existing) {
            updateComunicazione(com.id, com)
          } else {
            addComunicazione({
              dettaglioId:   com.dettaglioId,
              stato:         com.stato,
              destinatari:   com.destinatari,
              oggetto:       com.oggetto,
              corpo:         com.corpo,
              campiAllegato: com.campiAllegato,
            })
          }
          setComunModal({ open: false })
        }}
        onDelete={(id) => removeComunicazione(id)}
        onClose={() => setComunModal({ open: false })}
      />
    )}
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">

      {/* ── Header colorato ────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        style={{ borderLeft: `4px solid ${dettaglio.colore}` }}
        onClick={() => setCollapsed(v => !v)}
      >
        {/* Badge colore */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-medium text-sm">
              {dettaglio.nomeDescrittivo || <span className="text-slate-500 italic">Senza nome</span>}
            </span>
            {dettaglio.flagScorporo && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-indigo-900/50 border border-indigo-800 text-indigo-400">
                Scorporo
              </span>
            )}
            {/* Badge ultimo modificatore */}
            {dettaglio.modifiedBy && (
              <span
                title={`Ultima modifica di ${dettaglio.modifiedBy}`}
                className="text-xs px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-500"
              >
                mod. {dettaglio.modifiedBy}
              </span>
            )}
            {/* ⚠ Anagrafiche potenzialmente non aggiornate */}
            {dettaglio.anagraficheOutdated && (
              <span
                title="Data competenza voce successiva all'ultimo import anagrafiche. Verifica i ruoli."
                className="text-amber-400 text-sm cursor-help"
              >
                ⚠
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500 flex-wrap">
            {dettaglio.voce && <span className="font-mono">{dettaglio.voce}</span>}
            {dettaglio.capitolo && <><span>·</span><span className="font-mono">{dettaglio.capitolo}</span></>}
            {dettaglio.competenzaLiquidazione && <><span>·</span><span>{dettaglio.competenzaLiquidazione}</span></>}
            {dettaglio.riferimentoCedolino && (
              <><span>·</span><span className="truncate max-w-32">{dettaglio.riferimentoCedolino}</span></>
            )}
          </div>
        </div>

        {/* Contatore */}
        <span className="text-xs text-slate-500 shrink-0">{noms.length} nom.</span>

        {/* Azioni */}
        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>

          {/* ✉ Comunicazione — badge + dropdown lista esistenti */}
          <div className="relative">
            <button
              onClick={() => comunDettaglio.length > 0 ? setComunList(v => !v) : setComunModal({ open: true })}
              className="relative p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-slate-800 transition"
              title={comunDettaglio.length > 0 ? 'Gestisci comunicazioni' : 'Crea comunicazione'}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
              </svg>
              {comunDettaglio.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full
                                 bg-indigo-600 text-white text-[9px] flex items-center justify-center font-bold">
                  {comunDettaglio.length}
                </span>
              )}
            </button>
            {/* Dropdown lista comunicazioni esistenti */}
            {comunList && comunDettaglio.length > 0 && (
              <div ref={comunMenuRef}
                className="absolute right-0 top-full mt-1 z-50 bg-slate-800 border border-slate-700
                              rounded-lg shadow-xl min-w-48 py-1" onClick={e => e.stopPropagation()}>
                {comunDettaglio.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setComunList(false); setComunModal({ open: true, existing: c }) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left
                               hover:bg-slate-700 transition text-sm"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0
                      ${c.stato === 'validata' ? 'bg-emerald-400' : 'bg-slate-500'}`}/>
                    <span className="text-slate-200 truncate flex-1">{c.oggetto || '(senza oggetto)'}</span>
                  </button>
                ))}
                <div className="border-t border-slate-700 mt-1 pt-1">
                  <button
                    type="button"
                    onClick={() => { setComunList(false); setComunModal({ open: true }) }}
                    className="w-full px-3 py-2 text-left text-xs text-indigo-400
                               hover:bg-slate-700 transition"
                  >
                    + Nuova comunicazione
                  </button>
                </div>
              </div>
            )}
          </div>

          {noms.length > 0 && (
            <>
              {/* Aggiorna Ruolo — ri-legge ruolo storico da DB per tutti i nominativi */}
              <button
                onClick={handleAggiornaRuolo}
                disabled={aggRuoloLoading}
                className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-slate-800 transition
                           disabled:opacity-40"
                title="Aggiorna ruolo storico di tutti i nominativi (usa Data competenza voce)"
              >
                {aggRuoloLoading ? (
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                  </svg>
                )}
              </button>
              {/* Scarica matricole TXT per ruolo */}
              <button
                onClick={downloadMatricolePerRuolo}
                className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition"
                title={`Scarica matricole TXT per ruolo (${ruoliDistinti.length} file: ${ruoliDistinti.join(', ')})`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586
                       a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                </svg>
              </button>
            </>
          )}
          <button
            onClick={onAddNominativo}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs
                       bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 transition"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
            </svg>
            Nominativo
          </button>
          <button
            onClick={handleDuplica}
            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-slate-800 transition"
            title="Duplica gruppo (senza nominativi)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2
                   m-6 4h8a2 2 0 012 2v6a2 2 0 01-2 2H10a2 2 0 01-2-2v-6a2 2 0 012-2z"/>
            </svg>
          </button>
          <button
            onClick={onEdit}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Modifica"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
            </svg>
          </button>
          <button
            onClick={confirmDelete}
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-950/30 transition"
            title="Elimina"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
          </button>
          <button
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 transition"
            title={collapsed ? 'Espandi' : 'Comprimi'}
          >
            <svg
              className={`w-4 h-4 transition-transform ${collapsed ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Lista nominativi ───────────────────────────────── */}
      {!collapsed && (
        <div className="border-t border-slate-800">
          {noms.length === 0 ? (
            <div className="px-4 py-4 text-center">
              <p className="text-slate-500 text-sm">Nessun nominativo</p>
              <button
                onClick={onAddNominativo}
                className="mt-2 text-indigo-400 hover:text-indigo-300 text-sm transition"
              >
                + Aggiungi il primo nominativo
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800/50">
                  <th className="text-left px-4 py-2 text-slate-500 text-xs font-medium">Nominativo</th>
                  <th className="text-left px-4 py-2 text-slate-500 text-xs font-medium hidden sm:table-cell">Matricola</th>
                  <th className="text-left px-4 py-2 text-slate-500 text-xs font-medium">Ruolo</th>
                  <th className="text-right px-4 py-2 text-slate-500 text-xs font-medium">Lordo</th>
                  {dettaglio.flagScorporo && (
                    <th className="text-right px-4 py-2 text-slate-500 text-xs font-medium">Lordo benef.</th>
                  )}
                  <th className="w-8"/>
                </tr>
              </thead>
              <tbody>
                {noms.map((nom, idx) => (
                  <NominativoRow
                    key={nom.id}
                    nom={nom}
                    dettaglio={dettaglio}
                    coefficienti={settings.coefficienti}
                    onRemove={() => setRemoveConfirmId(nom.id)}
                    isEditingImporto={editingImportoNomId === nom.id}
                    onStartEditImporto={() => setEditingImportoNomId(nom.id)}
                    onStopEditImporto={() => setEditingImportoNomId(null)}
                    onCommitAndNext={() => {
                      const next = noms[idx + 1]
                      setEditingImportoNomId(next ? next.id : null)
                    }}
                  />
                ))}
              </tbody>
              {noms.length > 1 && (
                <tfoot>
                  <TotaleRow
                    noms={noms}
                    dettaglio={dettaglio}
                    coefficienti={settings.coefficienti}
                  />
                </tfoot>
              )}
            </table>
          )}
        </div>
      )}
    </div>

    <ConfirmDialog
      open={deleteGruppoOpen}
      title="Elimina gruppo"
      message={
        noms.length > 0
          ? `Eliminare il gruppo «${dettaglio.nomeDescrittivo}»? Saranno rimossi anche ${noms.length} nominativo/i. L'operazione non può essere annullata.`
          : `Eliminare il gruppo «${dettaglio.nomeDescrittivo}»? L'operazione non può essere annullata.`
      }
      danger
      confirmLabel="Elimina"
      onConfirm={() => { removeDettaglio(dettaglio.id); setDeleteGruppoOpen(false) }}
      onCancel={() => setDeleteGruppoOpen(false)}
    />
    <ConfirmDialog
      open={!!removeConfirmId}
      title="Rimuovi nominativo"
      message="Rimuovere il nominativo da questo gruppo?"
      danger
      confirmLabel="Rimuovi"
      onConfirm={() => { if (removeConfirmId) removeNominativo(removeConfirmId); setRemoveConfirmId(null) }}
      onCancel={() => setRemoveConfirmId(null)}
    />
    </>
  )
}

// ── Riga nominativo ───────────────────────────────────────────

function NominativoRow({ nom, dettaglio, coefficienti, onRemove,
  isEditingImporto, onStartEditImporto, onStopEditImporto, onCommitAndNext,
}: {
  nom:                  Nominativo
  dettaglio:            DettaglioLiquidazione
  coefficienti:         ReturnType<typeof useStore.getState>['settings']['coefficienti']
  onRemove:             () => void
  isEditingImporto:     boolean
  onStartEditImporto:   () => void
  onStopEditImporto:    () => void
  onCommitAndNext:      () => void
}) {
  const { updateNominativo } = useStore()
  const importoCSV = calcolaImportoCSV(nom, dettaglio, coefficienti)
  const scorporato = dettaglio.flagScorporo && importoCSV !== nom.importoLordo

  const [tempImporto, setTempImporto] = useState(String(nom.importoLordo))
  const [budgetAnchorEl, setBudgetAnchorEl] = useState<HTMLElement | null>(null)
  const importoInputRef = useRef<HTMLInputElement>(null)

  const [editingRuolo, setEditingRuolo] = useState(false)
  const [tempRuolo, setTempRuolo]       = useState(nom.ruolo)

  // Auto-focus + select when entering edit mode
  useEffect(() => {
    if (isEditingImporto) {
      setTempImporto(nom.importoLordo === 0 ? '' : String(nom.importoLordo))
      setTimeout(() => {
        importoInputRef.current?.focus()
        importoInputRef.current?.select()
      }, 0)
    }
  }, [isEditingImporto]) // eslint-disable-line react-hooks/exhaustive-deps

  function commitImporto() {
    const val = parseFloat(tempImporto.replace(',', '.'))
    if (!isNaN(val)) updateNominativo(nom.id, { importoLordo: val, importoBudget: undefined })
    onStopEditImporto()
  }

  function commitRuolo() {
    const val = tempRuolo.trim().toUpperCase()
    if (val) {
      updateNominativo(nom.id, {
        ruolo:           val,
        ruoloModificato: true,
      })
    }
    setEditingRuolo(false)
  }

  return (
    <tr className="border-b border-slate-800/30 hover:bg-slate-800/20 group transition">
      <td className="px-4 py-2 text-white text-sm">{nom.cognomeNome}</td>
      <td className="px-4 py-2 text-slate-400 text-xs font-mono hidden sm:table-cell">{nom.matricola}</td>
      <td className="px-4 py-2">
        {editingRuolo ? (
          <input
            autoFocus
            type="text"
            value={tempRuolo}
            onChange={e => setTempRuolo(e.target.value.toUpperCase())}
            onBlur={commitRuolo}
            onKeyDown={e => {
              if (e.key === 'Enter')  commitRuolo()
              if (e.key === 'Escape') setEditingRuolo(false)
            }}
            className="w-16 px-1.5 py-0.5 rounded bg-slate-700 border border-indigo-500
                       text-white text-xs text-center font-mono outline-none uppercase"
          />
        ) : (
          <span className="inline-flex items-center gap-1">
            <span
              onDoubleClick={() => { setTempRuolo(nom.ruolo); setEditingRuolo(true) }}
              title={nom.ruoloModificato
                ? 'Modificato manualmente — doppio click per cambiare'
                : 'Doppio click per modificare il ruolo'}
              className={`text-xs px-1.5 py-0.5 rounded font-mono
                         cursor-pointer transition select-none
                         ${nom.ruoloModificato
                           ? 'bg-amber-900/40 text-amber-300 border border-amber-800/60 hover:bg-amber-900/60'
                           : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              {nom.ruolo}
            </span>
            {nom.ruoloModificato && (
              <span
                title="Ruolo modificato manualmente"
                className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
              />
            )}
          </span>
        )}
      </td>
      <td className="px-4 py-2 text-right text-sm font-mono">
        {isEditingImporto ? (
          <input
            ref={importoInputRef}
            type="number"
            step="0.01"
            value={tempImporto}
            onChange={e => setTempImporto(e.target.value)}
            onBlur={commitImporto}
            onKeyDown={e => {
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault()
              if (e.key === 'Enter')  { commitImporto(); onCommitAndNext() }
              if (e.key === 'Escape') onStopEditImporto()
            }}
            className="w-28 px-2 py-0.5 rounded bg-slate-700 border border-indigo-500
                       text-white text-sm text-right outline-none"
          />
        ) : (
          <span className="inline-flex items-center gap-1 justify-end">
            <button
              onClick={onStartEditImporto}
              title="Clicca per modificare"
              className={`hover:text-white transition ${nom.importoLordo === 0 ? 'text-amber-400' : 'text-slate-300'}`}
            >
              {formatEur(nom.importoLordo)}
            </button>
            <button
              onClick={e => setBudgetAnchorEl(e.currentTarget)}
              title={nom.importoBudget && nom.importoBudget.length > 0
                ? `Badge importo (${nom.importoBudget.length} ${nom.importoBudget.length === 1 ? 'voce' : 'voci'})`
                : 'Badge importo — scomponi in voci'}
              className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold transition
                ${nom.importoBudget && nom.importoBudget.length > 0
                  ? 'bg-indigo-600/40 text-indigo-300 border border-indigo-600/60 hover:bg-indigo-600/60'
                  : 'bg-slate-800 text-slate-500 border border-slate-700 hover:bg-slate-700 hover:text-indigo-400'}`}
            >+</button>
          </span>
        )}
        {budgetAnchorEl && (
          <BudgetPanel
            initialItems={nom.importoBudget ?? []}
            initialSingle={nom.importoLordo}
            anchorEl={budgetAnchorEl}
            onConfirm={(total, items) => {
              updateNominativo(nom.id, { importoLordo: total, importoBudget: items })
              setBudgetAnchorEl(null)
            }}
            onClose={() => setBudgetAnchorEl(null)}
          />
        )}
      </td>
      {dettaglio.flagScorporo && (
        <td className={`px-4 py-2 text-right text-sm font-mono ${scorporato ? 'text-indigo-400' : 'text-slate-500'}`}>
          {scorporato ? formatEur(importoCSV) : '—'}
        </td>
      )}
      <td className="px-2 py-2">
        <button
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-500
                     hover:text-red-400 hover:bg-red-950/30 transition"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </td>
    </tr>
  )
}

// ── Riga totale ───────────────────────────────────────────────

function TotaleRow({ noms, dettaglio, coefficienti }: {
  noms:         Nominativo[]
  dettaglio:    DettaglioLiquidazione
  coefficienti: ReturnType<typeof useStore.getState>['settings']['coefficienti']
}) {
  const totaleLordo = noms.reduce((s, n) => s + n.importoLordo, 0)
  const totaleCSV   = noms.reduce((s, n) => s + calcolaImportoCSV(n, dettaglio, coefficienti), 0)

  return (
    <tr className="border-t border-slate-700 bg-slate-800/30">
      <td colSpan={2} className="px-4 py-2 text-slate-400 text-xs font-medium">
        Totale ({noms.length})
      </td>
      <td className="px-4 py-2 hidden sm:table-cell"/>
      <td className="px-4 py-2 text-right text-white text-sm font-mono font-medium">
        {formatEur(Math.round(totaleLordo * 100) / 100)}
      </td>
      {dettaglio.flagScorporo && (
        <td className="px-4 py-2 text-right text-indigo-400 text-sm font-mono font-medium">
          {formatEur(Math.round(totaleCSV * 100) / 100)}
        </td>
      )}
      <td/>
    </tr>
  )
}
