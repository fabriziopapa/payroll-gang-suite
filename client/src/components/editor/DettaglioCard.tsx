// ============================================================
// PAYROLL GANG SUITE — DettaglioCard
// Card colorata con lista nominativi e azioni
// ============================================================

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useStore } from '../../store/useStore'
import { showToast } from '../ToastManager'
import { ConfirmDialog } from '../ConfirmDialog'
import { calcolaImportoCSV, formatEur, finRapWarn, buildCsvRows, serializeCsv, downloadCsv } from '../../utils/biz'
import type { DettaglioLiquidazione, Nominativo, VoceConfig } from '../../types'
import { anagraficheApi, cinecaApi, type RuoloAtApiResult } from '../../api/endpoints'
import ProgressBar from '../ProgressBar'
import RuoloDisambiguaModal, { type DisambiguaItem } from '../RuoloDisambiguaModal'
import ConflittoRuoloModal, { type ConflittoItem } from '../ConflittoRuoloModal'
import ComunicazioneModal from './ComunicazioneModal'
import type { Comunicazione } from '../../types'
import BudgetPanel from './BudgetPanel'

interface Props {
  dettaglio:        DettaglioLiquidazione
  voceConfig?:      VoceConfig
  onEdit:           () => void
  onAddNominativo:  () => void
}

export default function DettaglioCard({ dettaglio, voceConfig, onEdit, onAddNominativo }: Props) {
  const {
    nominativi, removeDettaglio, removeNominativo, addDettaglio,
    updateNominativo, settings,
    comunicazioni, addComunicazione, updateComunicazione, removeComunicazione,
    anagrafiche, setAnagrafiche,
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
  const cardRef      = useRef<HTMLDivElement>(null)

  // ── Riferimento cedolino: tag della voce + anno competenza ──
  const tagTipo  = voceConfig?.tagDefault ?? null   // 'TL' | 'WD' | 'WE' | null
  const isCfTag  = tagTipo === 'WD' || tagTipo === 'WE'
  const annoComp = (dettaglio.competenzaLiquidazione.split('/')[1] ?? '').trim()

  // ── Recupero CF da CINECA (batch + progress) ──────────────
  const [recupero, setRecupero] = useState<{ done: number; total: number } | null>(null)
  const recuperoCancelRef       = useRef(false)
  const [recuperoConfirmOpen, setRecuperoConfirmOpen] = useState(false)

  // ── Ordinamento snapshot (solo vista) ─────────────────────
  // L'ordine viene congelato al click sull'header: le modifiche inline
  // successive NON riposizionano le righe (data-entry sequenziale stabile)
  const [sort, setSort] = useState<{ col: SortCol; dir: 'asc' | 'desc'; ids: string[] } | null>(null)

  // ── Ricerca "evidenzia e scrolla" (stile Ctrl+F) ──────────
  // Le righe non vengono MAI nascoste: solo highlight + scroll al match
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery]           = useState('')
  const [matchPos, setMatchPos]     = useState(0)

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
      tipoScorporo:                dettaglio.tipoScorporo,
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

  // VISTA ORDINATA — SOLO per il render del tbody e la navigazione Enter.
  // Mai passare a ComunicazioneModal / TotaleRow / downloadMatricolePerRuolo /
  // export: l'ordine canonico (documento) è quello dello store (`noms`).
  const displayNoms = useMemo(() => {
    if (!sort) return noms
    const byId    = new Map(noms.map(n => [n.id, n]))
    const ordered = sort.ids.map(id => byId.get(id)).filter((n): n is Nominativo => !!n)
    // Difensivo: nominativi assenti dallo snapshot (l'aggiunta resetta il sort,
    // ma in caso di stato anomalo nessuna riga deve sparire dalla vista)
    if (ordered.length !== noms.length) {
      const seen = new Set(sort.ids)
      ordered.push(...noms.filter(n => !seen.has(n.id)))
    }
    return ordered
  }, [noms, sort])

  function handleSortClick(col: SortCol) {
    setSort(prev => {
      if (!prev || prev.col !== col) {
        return { col, dir: 'asc', ids: [...noms].sort((a, b) => compareNomBy(col, a, b)).map(n => n.id) }
      }
      if (prev.dir === 'asc') {
        // Comparatore invertito (non reverse dell'array): i pari merito
        // restano in ordine di inserimento grazie al sort stabile
        return { col, dir: 'desc', ids: [...noms].sort((a, b) => compareNomBy(col, b, a)).map(n => n.id) }
      }
      return null  // terzo click: ripristino ordine documento
    })
  }

  function handleAddNominativo() {
    if (sort) {
      setSort(null)
      showToast("Ordinamento rimosso — ripristinato l'ordine di inserimento", 'info')
    }
    onAddNominativo()
  }

  // Match ricerca: nominativo + matricola, accent/case-insensitive, token in AND
  const matchIds = useMemo(() => {
    const q = normalizeSearch(query.trim())
    if (!q) return []
    const tokens = q.split(/\s+/)
    return displayNoms
      .filter(n => {
        const hay = normalizeSearch(`${n.cognomeNome} ${n.matricola}`)
        return tokens.every(t => hay.includes(t))
      })
      .map(n => n.id)
  }, [displayNoms, query])
  const matchSet  = useMemo(() => new Set(matchIds), [matchIds])
  const safePos   = matchIds.length === 0 ? 0 : Math.min(matchPos, matchIds.length - 1)
  const currentId = matchIds[safePos] ?? null

  // Scroll al match corrente
  useEffect(() => {
    if (!currentId) return
    cardRef.current?.querySelector(`[data-nom-id="${currentId}"]`)?.scrollIntoView({ block: 'center' })
  }, [currentId])

  function closeSearch() {
    setSearchOpen(false)
    setQuery('')
    setMatchPos(0)
  }

  function stepMatch(delta: 1 | -1) {
    if (matchIds.length === 0) return
    setMatchPos(p => (p + delta + matchIds.length) % matchIds.length)
  }

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

    // Sincronizza finRap dal record anagrafico più recente.
    // Non si può usare ruolo-at: per i cessati prima della data competenza
    // la query non restituisce righe (fin_rap >= data) — proprio il caso
    // che serve segnalare con il badge rosso.
    let anagList = anagrafiche
    if (anagList.length === 0) {
      try {
        anagList = await anagraficheApi.list()
        setAnagrafiche(anagList)
      } catch { /* anagrafica non disponibile — si aggiorna solo il ruolo */ }
    }
    const anagByMatricola = new Map(anagList.map(a => [a.matricola, a]))
    for (const nom of noms) {
      const rec = anagByMatricola.get(nom.matricola)
      // Record assente (es. cessato da >3 anni, fuori dal filtro rilevanza):
      // non toccare il finRap già salvato sul nominativo
      if (rec && (nom.finRap ?? null) !== (rec.finRap ?? null)) {
        updateNominativo(nom.id, { finRap: rec.finRap ?? null })
      }
    }

    const dataDate     = dettaglio.dataCompetenzaVoce || undefined
    const toDisambigua: DisambiguaItem[]  = []
    const toConflitto:  ConflittoItem[]   = []

    // UNA sola richiesta bulk per tutto il gruppo (niente fan-out → niente rate-limit)
    let bulk: Record<string, RuoloAtApiResult[]> = {}
    try {
      bulk = await anagraficheApi.ruoloAtBulk(noms.map(n => n.matricola), dataDate)
    } catch {
      showToast("Errore durante l'aggiornamento dei ruoli — riprova", 'error')
      setAggRuoloLoading(false)
      return
    }

    for (const nom of noms) {
      const results = bulk[nom.matricola] ?? []

      // D) Nessun dato storico — lascia invariato
      if (results.length === 0) continue

      // C) Ambiguo — serve scelta del periodo
      if (results.length > 1) {
        toDisambigua.push({
          nomId:       nom.id,
          matricola:   nom.matricola,
          cognomeNome: nom.cognomeNome,
          options:     results,
        })
        continue
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
      } else if (nom.ruoloModificato) {
        // B) Già corretto — resetta solo il flag visivo se serve
        updateNominativo(nom.id, { ruoloModificato: false })
      }
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

  // ── Recupero CF (tag WD/WE) — solo nominativi senza riferimento ──
  async function runRecuperaCF() {
    const targets = noms.filter(n => !n.riferimentoCedolino?.trim())
    if (targets.length === 0) {
      showToast('Tutti i nominativi hanno già il riferimento cedolino', 'success')
      return
    }
    recuperoCancelRef.current = false
    setRecupero({ done: 0, total: targets.length })
    const BATCH = 25
    let resolved = 0, missing = 0
    try {
      for (let i = 0; i < targets.length; i += BATCH) {
        if (recuperoCancelRef.current) break
        const batch     = targets.slice(i, i + BATCH)
        const matricole = batch.map(n => n.matricola)
        const cfMap = tagTipo === 'WD'
          ? await cinecaApi.cfBulk(matricole)
          : await cinecaApi.figliGiovaneBulk(matricole)
        for (const n of batch) {
          const cf = cfMap[n.matricola]?.codFisc
          if (cf) {
            updateNominativo(n.id, { riferimentoCedolino: `${tagTipo}@${annoComp}${cf}@` })
            resolved++
          } else {
            missing++
          }
        }
        setRecupero({ done: Math.min(i + BATCH, targets.length), total: targets.length })
      }
      showToast(
        `Recupero CF: ${resolved} risolti` +
        (missing ? `, ${missing} senza CF (inseribili a mano sulla riga)` : ''),
        missing ? 'warning' : 'success',
      )
    } catch {
      showToast('Errore durante il recupero CF — riprova', 'error')
    } finally {
      setRecupero(null)
    }
  }

  // ── Scarica CSV HR del solo gruppo selezionato ──
  function handleDownloadCsvGruppo() {
    const rows = buildCsvRows([dettaglio], noms, settings.coefficienti, settings.coefficientiContoTerzi)
    const slug = (dettaglio.nomeDescrittivo || 'gruppo').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)
    downloadCsv(serializeCsv(rows), `liquidazione_${slug}.csv`)
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
    <div ref={cardRef} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">

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

          {/* 🔍 Ricerca evidenzia-e-scrolla (solo gruppi numerosi) */}
          {noms.length > 15 && (
            <button
              onClick={() => {
                if (searchOpen) { closeSearch() } else { setCollapsed(false); setSearchOpen(true) }
              }}
              className={`p-1.5 rounded-lg transition hover:bg-slate-800
                ${searchOpen ? 'text-indigo-400' : 'text-slate-400 hover:text-indigo-400'}`}
              title="Cerca nel gruppo (evidenzia, non nasconde)"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/>
              </svg>
            </button>
          )}

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
              {/* Recupera CF da CINECA — solo voci con tag WD/WE */}
              {isCfTag && (
                <button
                  onClick={() => setRecuperoConfirmOpen(true)}
                  disabled={!!recupero}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-slate-800 transition disabled:opacity-40"
                  title={`Recupera CF da CINECA per il riferimento cedolino (${tagTipo}) — solo nominativi senza riferimento`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>
                  </svg>
                </button>
              )}
              {/* Scarica CSV HR del solo gruppo */}
              <button
                onClick={handleDownloadCsvGruppo}
                className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition"
                title="Scarica CSV HR di questo solo gruppo"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                </svg>
              </button>
            </>
          )}
          <button
            onClick={handleAddNominativo}
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
            onClick={e => { e.stopPropagation(); setCollapsed(v => !v) }}
            aria-expanded={!collapsed}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 transition"
            title={collapsed ? 'Espandi' : 'Comprimi'}
            aria-label={collapsed ? 'Espandi gruppo' : 'Comprimi gruppo'}
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

      {/* Avanzamento recupero CF */}
      {recupero && (
        <div className="px-4 pb-3">
          <ProgressBar
            value={recupero.done}
            max={recupero.total}
            label={`Recupero CF da CINECA (${tagTipo})…`}
            onCancel={() => { recuperoCancelRef.current = true }}
          />
        </div>
      )}

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
            <>
            {/* Barra ricerca evidenzia-e-scrolla */}
            {searchOpen && (
              <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800/50 bg-slate-800/30">
                <svg className="w-3.5 h-3.5 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/>
                </svg>
                <input
                  autoFocus
                  type="search"
                  value={query}
                  onChange={e => { setQuery(e.target.value); setMatchPos(0) }}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  { e.preventDefault(); stepMatch(e.shiftKey ? -1 : 1) }
                    if (e.key === 'Escape') { e.preventDefault(); closeSearch() }
                  }}
                  placeholder="Cerca nominativo o matricola…"
                  aria-label="Cerca nominativo o matricola nel gruppo"
                  className="flex-1 min-w-0 px-2 py-1 rounded bg-slate-800 border border-slate-700
                             text-white text-xs placeholder-slate-500
                             focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <span aria-live="polite" className="text-xs text-slate-500 shrink-0 font-mono">
                  {query.trim() ? `${matchIds.length === 0 ? 0 : safePos + 1} di ${matchIds.length}` : ''}
                </span>
                <button type="button" onClick={() => stepMatch(-1)} disabled={matchIds.length === 0}
                  title="Match precedente (Shift+Invio)"
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-30 transition">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7"/>
                  </svg>
                </button>
                <button type="button" onClick={() => stepMatch(1)} disabled={matchIds.length === 0}
                  title="Match successivo (Invio)"
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-30 transition">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
                  </svg>
                </button>
                <button type="button" onClick={closeSearch} title="Chiudi ricerca (Esc)"
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800/50">
                  <SortableTh label="Nominativo" col="nominativo" sort={sort} onSort={handleSortClick} />
                  <SortableTh label="Matricola"  col="matricola"  sort={sort} onSort={handleSortClick}
                    className="hidden sm:table-cell" />
                  <SortableTh label="Ruolo"      col="ruolo"      sort={sort} onSort={handleSortClick} />
                  <SortableTh label="Lordo"      col="lordo"      sort={sort} onSort={handleSortClick} align="right" />
                  {dettaglio.flagScorporo && (
                    <th className="text-right px-4 py-2 text-slate-500 text-xs font-medium">Lordo benef.</th>
                  )}
                  <th className="w-8"/>
                </tr>
              </thead>
              <tbody>
                {displayNoms.map((nom, idx) => (
                  <NominativoRow
                    key={nom.id}
                    nom={nom}
                    dettaglio={dettaglio}
                    cfTag={isCfTag ? (tagTipo as 'WD' | 'WE') : null}
                    annoComp={annoComp}
                    coefficienti={settings.coefficienti}
                    coefficientiContoTerzi={settings.coefficientiContoTerzi}
                    searchHit={nom.id === currentId ? 'current' : matchSet.has(nom.id) ? 'match' : null}
                    onRemove={() => setRemoveConfirmId(nom.id)}
                    isEditingImporto={editingImportoNomId === nom.id}
                    onStartEditImporto={() => setEditingImportoNomId(nom.id)}
                    onStopEditImporto={() => setEditingImportoNomId(null)}
                    onCommitAndNext={() => {
                      // Naviga la vista ordinata: "riga successiva" = quella sotto l'occhio
                      const next = displayNoms[idx + 1]
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
                    coefficientiContoTerzi={settings.coefficientiContoTerzi}
                  />
                </tfoot>
              )}
            </table>
            </>
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
    <ConfirmDialog
      open={recuperoConfirmOpen}
      title="Recupera CF da CINECA"
      message={(() => {
        const vuoti = noms.filter(n => !n.riferimentoCedolino?.trim()).length
        const pieni = noms.length - vuoti
        return `Recupero il riferimento cedolino (${tagTipo}) da CINECA per i ${vuoti} nominativi senza riferimento`
          + (pieni ? `. I ${pieni} già valorizzati non vengono toccati` : '')
          + '. I CF non trovati restano inseribili a mano sulla riga.'
      })()}
      confirmLabel="Recupera"
      onConfirm={() => { setRecuperoConfirmOpen(false); runRecuperaCF() }}
      onCancel={() => setRecuperoConfirmOpen(false)}
    />
    </>
  )
}

// ── Riga nominativo ───────────────────────────────────────────

function NominativoRow({ nom, dettaglio, cfTag, annoComp, coefficienti, coefficientiContoTerzi, searchHit, onRemove,
  isEditingImporto, onStartEditImporto, onStopEditImporto, onCommitAndNext,
}: {
  nom:                       Nominativo
  dettaglio:                 DettaglioLiquidazione
  /** Tag CF della voce ('WD'|'WE') o null se la voce non usa CF per-nominativo */
  cfTag:                     'WD' | 'WE' | null
  annoComp:                  string
  coefficienti:              ReturnType<typeof useStore.getState>['settings']['coefficienti']
  coefficientiContoTerzi?:   ReturnType<typeof useStore.getState>['settings']['coefficientiContoTerzi']
  searchHit?:                'match' | 'current' | null
  onRemove:                  () => void
  isEditingImporto:          boolean
  onStartEditImporto:   () => void
  onStopEditImporto:    () => void
  onCommitAndNext:      () => void
}) {
  const { updateNominativo } = useStore()
  const importoCSV = calcolaImportoCSV(nom, dettaglio, coefficienti, coefficientiContoTerzi)
  const scorporato = dettaglio.flagScorporo && importoCSV !== nom.importoLordo

  // Riferimento cedolino della riga: presente e diverso dal gruppo, oppure
  // mancante su una voce WD/WE → inseribile a mano (CF proprio/figlio).
  const rifDiverso  = !!nom.riferimentoCedolino && nom.riferimentoCedolino !== dettaglio.riferimentoCedolino
  const rifMancante = !nom.riferimentoCedolino?.trim() && !!cfTag
  const [editingRif, setEditingRif] = useState(false)
  const [tempCf, setTempCf]         = useState('')
  // Numero colonne per il colSpan della sotto-riga
  const colSpan = 4 + (dettaglio.flagScorporo ? 1 : 0) + 1

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
  }, [isEditingImporto, nom.importoLordo])

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

  const cessatoWarn = finRapWarn(nom.finRap, dettaglio.dataCompetenzaVoce || undefined)

  return (
    <>
    <tr
      data-nom-id={nom.id}
      className={`border-b border-slate-800/30 group transition
        ${searchHit === 'current' ? 'bg-indigo-900/40'
          : searchHit === 'match' ? 'bg-indigo-900/15'
          : 'hover:bg-slate-800/20'}`}
    >
      <td className="px-4 py-2 text-white text-sm">
        <span className="inline-flex items-center gap-1.5">
          {nom.cognomeNome}
          {cessatoWarn && (
            <span
              className="inline-flex items-center gap-1 text-xs text-red-400 font-mono shrink-0"
              title={`Fine rapporto: ${cessatoWarn} — precedente alla data di competenza voce`}
              aria-label={`Cessato — fine rapporto ${cessatoWarn}`}
            >
              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" aria-hidden="true" />
              {cessatoWarn}
            </span>
          )}
        </span>
      </td>
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
    {(rifDiverso || rifMancante) && (
      <tr className="border-b border-slate-800/30">
        <td colSpan={colSpan} className="px-4 pb-1.5 pt-0">
          {rifMancante && cfTag ? (
            editingRif ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="text-[11px] text-slate-500 font-mono shrink-0">↳ {cfTag}@{annoComp}</span>
                <input
                  autoFocus
                  value={tempCf}
                  onChange={e => setTempCf(e.target.value.toUpperCase())}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const cf = tempCf.trim().toUpperCase()
                      if (cf) updateNominativo(nom.id, { riferimentoCedolino: `${cfTag}@${annoComp}${cf}@` })
                      setEditingRif(false)
                    }
                    if (e.key === 'Escape') setEditingRif(false)
                  }}
                  onBlur={() => {
                    const cf = tempCf.trim().toUpperCase()
                    if (cf) updateNominativo(nom.id, { riferimentoCedolino: `${cfTag}@${annoComp}${cf}@` })
                    setEditingRif(false)
                  }}
                  placeholder="codice fiscale"
                  className="w-44 px-1.5 py-0.5 rounded bg-slate-700 border border-indigo-500
                             text-white text-[11px] font-mono uppercase outline-none"
                />
              </span>
            ) : (
              <button
                type="button"
                onClick={() => { setTempCf(''); setEditingRif(true) }}
                className="text-[11px] text-slate-600 hover:text-indigo-400 transition"
                title="Inserisci a mano il codice fiscale (proprio o del figlio)"
              >
                ↳ rif. {cfTag} mancante — inserisci CF a mano
              </button>
            )
          ) : (
            <span className="text-[11px] text-slate-600 font-mono break-all">
              ↳ rif. {nom.riferimentoCedolino}
            </span>
          )}
        </td>
      </tr>
    )}
    </>
  )
}

// ── Ordinamento e ricerca (helper puri, solo vista) ───────────

type SortCol = 'nominativo' | 'matricola' | 'ruolo' | 'lordo'

const sortCollator = new Intl.Collator('it', { sensitivity: 'base', numeric: true })

function compareNomBy(col: SortCol, a: Nominativo, b: Nominativo): number {
  switch (col) {
    case 'nominativo': return sortCollator.compare(a.cognomeNome, b.cognomeNome)
    case 'matricola':  return sortCollator.compare(a.matricola, b.matricola)
    case 'ruolo':      return sortCollator.compare(a.ruolo, b.ruolo)
    case 'lordo':      return a.importoLordo - b.importoLordo
  }
}

/** lowercase + rimozione diacritici: "Buonì" matcha "buoni" */
function normalizeSearch(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function SortableTh({ label, col, sort, onSort, align = 'left', className = '' }: {
  label:     string
  col:       SortCol
  sort:      { col: SortCol; dir: 'asc' | 'desc' } | null
  onSort:    (col: SortCol) => void
  align?:    'left' | 'right'
  className?: string
}) {
  const active = sort?.col === col
  const arrow  = active ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'
  return (
    <th
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={`p-0 ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        title="Ordina la vista — non modifica l'ordine salvato"
        className={`w-full flex items-center gap-1 px-4 py-2 text-xs font-medium transition
          focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded
          ${align === 'right' ? 'justify-end' : ''}
          ${active ? 'text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
      >
        {align === 'right' && <span className={`text-[10px] ${active ? '' : 'text-slate-700'}`} aria-hidden="true">{arrow}</span>}
        {label}
        {align === 'left' && <span className={`text-[10px] ${active ? '' : 'text-slate-700'}`} aria-hidden="true">{arrow}</span>}
      </button>
    </th>
  )
}

// ── Riga totale ───────────────────────────────────────────────

function TotaleRow({ noms, dettaglio, coefficienti, coefficientiContoTerzi }: {
  noms:                      Nominativo[]
  dettaglio:                 DettaglioLiquidazione
  coefficienti:              ReturnType<typeof useStore.getState>['settings']['coefficienti']
  coefficientiContoTerzi?:   ReturnType<typeof useStore.getState>['settings']['coefficientiContoTerzi']
}) {
  const totaleLordo = noms.reduce((s, n) => s + n.importoLordo, 0)
  const totaleCSV   = noms.reduce((s, n) => s + calcolaImportoCSV(n, dettaglio, coefficienti, coefficientiContoTerzi), 0)

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
