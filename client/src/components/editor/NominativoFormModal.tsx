// ============================================================
// PAYROLL GANG SUITE — NominativoFormModal
//
// Tab "Manuale"        — ricerca live + auto-popola da anagrafica
// Tab "Incolla lista"  — incolla nomi/CSV, risoluzione automatica
// Tab "Copia"          — copia nominativi da qualsiasi gruppo/bozza
// ============================================================

import { useState, useMemo, useRef, useEffect, useId, cloneElement, isValidElement, Children } from 'react'
import { useStore, type BozzaDati } from '../../store/useStore'
import { anagraficheApi, bozzeApi, type AnagraficaApi } from '../../api/endpoints'
import type { DettaglioLiquidazione, Nominativo, ImportoBudgetItem } from '../../types'
import RuoloDisambiguaModal, { type DisambiguaItem } from '../RuoloDisambiguaModal'
import { useModalKeyboard } from '../../hooks/useFocusTrap'
import BudgetPanel from './BudgetPanel'

interface Props {
  dettaglio: DettaglioLiquidazione
  onClose:   () => void
}

type Tab = 'manuale' | 'incolla' | 'copia'

// ── Tipi interni ──────────────────────────────────────────────

type PasteStatus = 'found' | 'not_found' | 'multiple' | 'duplicate'

interface PasteRow {
  input:         string
  status:        PasteStatus
  match?:        AnagraficaApi
  matches?:      AnagraficaApi[]
  chosen?:       string
  include:       boolean
  importoParsed: number   // importo estratto dal testo incollato
}

/**
 * Riconosce numeri in formato italiano ed inglese:
 *   1200  |  1200,00  |  1200.00  |  1.200,00  |  1.200  |  1,200.00
 * Restituisce null se la stringa non è riconoscibile come numero.
 */
function parseItalianNum(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, '')
  if (!s) return null
  const neg = s.startsWith('-')
  const abs = neg ? s.slice(1) : s

  let value: number | null = null
  // 1.200,50 — ita millesimale + decimale
  if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(abs))
    value = parseFloat(abs.replace(/\./g, '').replace(',', '.'))
  // 1200,50 — ita semplice
  else if (/^\d+,\d{1,2}$/.test(abs))
    value = parseFloat(abs.replace(',', '.'))
  // 1,200.50 — eng millesimale + decimale
  else if (/^\d{1,3}(,\d{3})*\.\d{1,2}$/.test(abs))
    value = parseFloat(abs.replace(/,/g, ''))
  // 1200.50 — plain decimal
  else if (/^\d+\.\d{1,2}$/.test(abs))
    value = parseFloat(abs)
  // 1.200 o 1.200.500 — ita millesimale senza decimale (gruppi esattamente di 3)
  else if (/^\d+(\.\d{3})+$/.test(abs))
    value = parseFloat(abs.replace(/\./g, ''))
  // 1200 — intero
  else if (/^\d+$/.test(abs))
    value = parseInt(abs, 10)

  if (value === null || isNaN(value)) return null
  return neg ? -value : value
}

/**
 * Estrae (name, importo) da una riga incollata.
 * Formati supportati:
 *   1) "Cognome Nome ; importo"  — separatore ; o \t (unambiguo)
 *   2) "Cognome Nome importo"    — ultimo token spazio = numero
 *   3) "Cognome Nome"            — solo nome, importo = 0
 *   4) "matricola"               — solo matricola, importo = 0
 *   5) "Cognome"                 — solo cognome, importo = 0
 */
function parsePasteLine(raw: string): { name: string; importo: number } {
  const line = raw.trim()
  if (!line) return { name: '', importo: 0 }

  // 1. Separatore esplicito ; o tab → unambiguo
  for (const sep of [';', '\t']) {
    const idx = line.indexOf(sep)
    if (idx > 0) {
      const left  = line.slice(0, idx).trim()
      const right = line.slice(idx + 1).trim()
      const num   = parseItalianNum(right)
      if (num !== null && left.length > 0) return { name: left, importo: num }
    }
  }

  // 2. Ultimo token spazio-separato come numero
  const tokens = line.split(/\s+/)
  if (tokens.length >= 2) {
    const last = tokens[tokens.length - 1]!
    const num  = parseItalianNum(last)
    if (num !== null) return { name: tokens.slice(0, -1).join(' '), importo: num }
  }

  // 3. Nessun importo trovato — tutta la riga è il nome/matricola
  return { name: line, importo: 0 }
}

interface BozzaSource {
  id:        string            // 'current' | bozza.id
  nome:      string
  stato:     'corrente' | 'bozza' | 'archiviata'
  dettagli:  DettaglioLiquidazione[]
  nominativi: Nominativo[]
}

// ── Helpers (module-level per useMemo senza eslint-disable) ──

interface GroupedAnag {
  matricola: string
  cognNome:  string
  ruoli:     string[]
  record:    AnagraficaApi
}

function normStr(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function searchAnagGrouped(query: string, anagrafiche: AnagraficaApi[]): GroupedAnag[] {
  const words = normStr(query).trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const matches = anagrafiche.filter(a => {
    const hay = normStr(`${a.cognNome} ${a.matricola}`)
    return words.every(w => hay.includes(w))
  })
  const grouped = new Map<string, GroupedAnag>()
  for (const a of matches) {
    if (!grouped.has(a.matricola)) {
      grouped.set(a.matricola, { matricola: a.matricola, cognNome: a.cognNome, ruoli: [a.ruolo], record: a })
    } else {
      const g = grouped.get(a.matricola)!
      if (!g.ruoli.includes(a.ruolo)) g.ruoli.push(a.ruolo)
    }
  }
  return Array.from(grouped.values()).slice(0, 8)
}

// ── Componente ────────────────────────────────────────────────

export default function NominativoFormModal({ dettaglio, onClose }: Props) {
  const {
    anagrafiche, setAnagrafiche,
    bozze, setBozze,
    nominativi, dettagli: dettagliCorrente, addNominativo,
    currentBozzaId, currentBozzaNome,
  } = useStore()

  const [tab, setTab]         = useState<Tab>('manuale')
  const [loading, setLoading] = useState(false)
  const titleId   = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalKeyboard(dialogRef, onClose)

  // Matricole già presenti in questo dettaglio
  const alreadyIn = useMemo(
    () => new Set(nominativi.filter(n => n.dettaglioId === dettaglio.id).map(n => n.matricola)),
    [nominativi, dettaglio.id],
  )

  // Lazy load anagrafiche e bozze se non in store
  useEffect(() => {
    let cancelled = false
    const promises: Promise<unknown>[] = []
    if (anagrafiche.length === 0)
      promises.push(anagraficheApi.list().then(d => { if (!cancelled) setAnagrafiche(d) }))
    if (bozze.length === 0)
      promises.push(bozzeApi.list().then(d => { if (!cancelled) setBozze(d) }))
    if (promises.length > 0) {
      setLoading(true)
      Promise.all(promises).finally(() => { if (!cancelled) setLoading(false) })
    }
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Ricerca su anagrafiche ────────────────────────────────

  /**
   * Ricerca grezza per tab Incolla:
   * 1. Strict — tutti i token presenti nel hay (cognNome + matricola)
   * 2. Fuzzy  — almeno un token (≥3 car) presente, se strict = 0
   * Gestisce: cognome/nome in ordine qualsiasi, matricola parziale,
   *           singolo cognome, singola matricola.
   */
  function searchAnag(query: string): AnagraficaApi[] {
    const tokens = normStr(query).trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return []
    const strict = anagrafiche.filter(a => {
      const hay = normStr(`${a.cognNome} ${a.matricola}`)
      return tokens.every(t => hay.includes(t))
    })
    if (strict.length > 0) return strict
    // Fallback fuzzy: almeno un token significativo (≥3 car) trovato
    return anagrafiche.filter(a => {
      const hay = normStr(`${a.cognNome} ${a.matricola}`)
      return tokens.some(t => t.length >= 3 && hay.includes(t))
    })
  }

  // ═══════════════════════════════════════════════════════════
  // TAB MANUALE
  // ═══════════════════════════════════════════════════════════

  const [mSearch, setMSearch]         = useState('')
  const [showDrop, setShowDrop]       = useState(false)
  const [mMatricola, setMMatricola]   = useState('')
  const [mCognNome, setMCognNome]     = useState('')
  const [mRuolo, setMRuolo]           = useState('')
  const [mDruolo, setMDruolo]         = useState('')
  const [mImporto, setMImporto]       = useState('')
  const [filled, setFilled]           = useState(false)
  const [fillLoading, setFillLoading] = useState(false)
  const [addedFlash, setAddedFlash]         = useState(false)
  const [confirmedBudget, setConfirmedBudget] = useState<ImportoBudgetItem[]>([])
  const [budgetAnchorEl, setBudgetAnchorEl]   = useState<HTMLElement | null>(null)
  const searchRef                             = useRef<HTMLDivElement>(null)
  const searchInputRef                        = useRef<HTMLInputElement>(null)
  // fillRef: incrementato a ogni nuova ricerca — scarta risposte stale
  const fillRef                               = useRef(0)

  const importoEffettivo = confirmedBudget.length > 0
    ? confirmedBudget.reduce((s, b) => s + b.importo, 0)
    : (parseFloat(mImporto.replace(',', '.')) || 0)

  // Stato disambiguation modal (tab manuale)
  const [disambiguaItems, setDisambiguaItems] = useState<DisambiguaItem[]>([])

  const suggestions = useMemo(
    () => mSearch.trim().length < 2 ? [] : searchAnagGrouped(mSearch, anagrafiche),
    [mSearch, anagrafiche],
  )

  async function fillFromAnagrafica(a: AnagraficaApi) {
    const myRef = ++fillRef.current
    setMMatricola(a.matricola)
    setMCognNome(a.cognNome)
    setMSearch(a.cognNome)
    setShowDrop(false)
    setFilled(false)
    setFillLoading(true)

    const dataDate = dettaglio.dataCompetenzaVoce || undefined
    try {
      const results = await anagraficheApi.ruoloAt(a.matricola, dataDate)
      if (fillRef.current !== myRef) return  // risposta stale, ignorata

      if (results.length === 0 || results.length === 1) {
        // 0 = nessun record storico → usa dati locali
        // 1 = univoco
        const r = results[0]
        setMRuolo((r?.ruolo ?? a.ruolo).toUpperCase())
        setMDruolo(r?.druolo ?? a.druolo ?? '')
        setFilled(true)
      } else {
        // Ambiguo → apri disambiguation modal
        setDisambiguaItems([{
          nomId:       '__manual__',
          matricola:   a.matricola,
          cognomeNome: a.cognNome,
          options:     results,
        }])
      }
    } catch {
      // Fallback silenzioso ai dati attuali in store
      if (fillRef.current === myRef) {
        setMRuolo(a.ruolo.toUpperCase())
        setMDruolo(a.druolo ?? '')
        setFilled(true)
      }
    } finally {
      if (fillRef.current === myRef) setFillLoading(false)
    }
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDrop(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function handleAddManuale(e: React.FormEvent) {
    e.preventDefault()
    const importoLordo = importoEffettivo
    const importoBudget: ImportoBudgetItem[] | undefined =
      confirmedBudget.length > 0 ? confirmedBudget : undefined
    addNominativo({
      matricola:    mMatricola.trim(),
      cognomeNome:  mCognNome.trim(),
      ruolo:        mRuolo.trim().toUpperCase(),
      druolo:       mDruolo.trim(),
      dettaglioId:  dettaglio.id,
      importoLordo,
      importoBudget,
      origine:      'manuale',
    })
    // Rimane aperto — reset form
    setMSearch('')
    setMMatricola('')
    setMCognNome('')
    setMRuolo('')
    setMDruolo('')
    setMImporto('')
    setConfirmedBudget([])
    setBudgetAnchorEl(null)
    setFilled(false)
    setAddedFlash(true)
    setTimeout(() => setAddedFlash(false), 2000)
    searchInputRef.current?.focus()
  }

  // ═══════════════════════════════════════════════════════════
  // TAB INCOLLA
  // ═══════════════════════════════════════════════════════════

  const [pasteText, setPasteText]   = useState('')
  const [pasteRows, setPasteRows]   = useState<PasteRow[]>([])
  const [searched, setSearched]     = useState(false)
  const searchCancelRef             = useRef(0)

  async function handleSearch() {
    const myGen = ++searchCancelRef.current
    const rawLines = pasteText.split(/\r?\n/).filter(l => l.trim())
    const parsed   = rawLines.map(parsePasteLine)

    // Fase 1: ricerca locale con deduplicazione per matricola
    const preliminary: PasteRow[] = parsed.map(({ name, importo }) => {
      const rawMatches = searchAnag(name)
      if (rawMatches.length === 0) return { input: name, status: 'not_found', include: false, importoParsed: importo }

      // Deduplica per matricola: tieni il primo record per ogni persona
      const seen = new Set<string>()
      const matches = rawMatches.filter(a => {
        if (seen.has(a.matricola)) return false
        seen.add(a.matricola)
        return true
      })

      const single = matches.length === 1 ? matches[0]! : null
      if (single && alreadyIn.has(single.matricola)) {
        return { input: name, status: 'duplicate', match: single, include: false, importoParsed: importo }
      }
      if (single) return { input: name, status: 'found', match: single, include: true, importoParsed: importo }
      return { input: name, status: 'multiple', matches, include: false, importoParsed: importo }
    })

    setPasteRows(preliminary)
    setSearched(true)

    // Fase 2: arricchimento ruolo-at per le righe trovate univoche
    const dataDate = dettaglio.dataCompetenzaVoce || undefined
    if (!dataDate) return  // senza data non ha senso il lookup storico

    if (searchCancelRef.current !== myGen) return

    const toEnrich = preliminary
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.status === 'found' && r.match)

    // Chunked Promise.all — max 15 parallele
    const CHUNK = 15
    const enriched = new Map<number, { ruolo: string; druolo: string }>()

    for (let c = 0; c < toEnrich.length; c += CHUNK) {
      const chunk = toEnrich.slice(c, c + CHUNK)
      await Promise.all(chunk.map(async ({ r, i }) => {
        try {
          const results = await anagraficheApi.ruoloAt(r.match!.matricola, dataDate)
          if (results.length === 1) {
            enriched.set(i, { ruolo: results[0]!.ruolo, druolo: results[0]!.druolo ?? '' })
          }
          // 0 risultati = ok, usa quello locale
          // >1 risultati = ignoriamo per incolla (troppo complesso per batch)
        } catch {
          // ignora errori di rete, usa il ruolo locale
        }
      }))
    }

    if (enriched.size > 0 && searchCancelRef.current === myGen) {
      setPasteRows(prev => prev.map((r, i) => {
        const e = enriched.get(i)
        if (!e || !r.match) return r
        return { ...r, match: { ...r.match, ruolo: e.ruolo, druolo: e.druolo } }
      }))
    }
  }

  function toggleInclude(idx: number) {
    setPasteRows(prev => prev.map((r, i) =>
      i === idx && r.status !== 'not_found' && r.status !== 'duplicate'
        ? { ...r, include: !r.include }
        : r,
    ))
  }

  function chooseMatch(idx: number, matricola: string) {
    setPasteRows(prev => prev.map((r, i) =>
      i === idx ? { ...r, chosen: matricola, include: true } : r,
    ))
  }

  function handleAddFromPaste() {
    for (const r of pasteRows) {
      if (!r.include) continue
      const a = r.match ?? anagrafiche.find(x => x.matricola === r.chosen)
      if (!a) continue
      addNominativo({
        matricola:    a.matricola,
        cognomeNome:  a.cognNome,
        ruolo:        a.ruolo,
        druolo:       a.druolo ?? '',
        dettaglioId:  dettaglio.id,
        importoLordo: r.importoParsed,
        origine:      'pdf',
      })
    }
    onClose()
  }

  function updatePasteImporto(idx: number, value: string) {
    setPasteRows(prev => prev.map((r, i) =>
      i === idx ? { ...r, importoParsed: parseFloat(value.replace(',', '.')) || 0 } : r,
    ))
  }

  const pasteAddCount = pasteRows.filter(r => r.include).length

  // ═══════════════════════════════════════════════════════════
  // TAB COPIA DA GRUPPI/BOZZE
  // ═══════════════════════════════════════════════════════════

  const [bozzaSearch, setBozzaSearch]       = useState('')
  const [expandedBozze, setExpandedBozze]   = useState<Set<string>>(new Set())
  const [expandedGruppi, setExpandedGruppi] = useState<Set<string>>(new Set())
  // key: `${bozzaId}||${nom.id}`  value: Nominativo
  const [copySel, setCopySel]               = useState<Map<string, Nominativo>>(new Map())

  // Costruisce le sorgenti: bozza corrente + tutte le salvate
  const bozzeSources = useMemo((): BozzaSource[] => {
    const sources: BozzaSource[] = []

    // Bozza corrente in memoria (anche non salvata)
    if (dettagliCorrente.length > 0) {
      sources.push({
        id:         'current',
        nome:       currentBozzaNome || 'Bozza corrente',
        stato:      'corrente',
        dettagli:   dettagliCorrente,
        nominativi,
      })
    }

    // Bozze salvate (escludi quella corrente se già mostrata sopra)
    for (const b of bozze) {
      if (b.id === currentBozzaId) continue
      const dati = (b.dati ?? {}) as Partial<BozzaDati>
      sources.push({
        id:         b.id,
        nome:       b.nome,
        stato:      b.stato as 'bozza' | 'archiviata',
        dettagli:   dati.dettagli   ?? [],
        nominativi: dati.nominativi ?? [],
      })
    }

    return sources
  }, [bozze, currentBozzaId, currentBozzaNome, dettagliCorrente, nominativi])

  const bozzeFiltrate = useMemo(() => {
    if (!bozzaSearch.trim()) return bozzeSources
    const q = bozzaSearch.toLowerCase()
    return bozzeSources.filter(b =>
      b.nome.toLowerCase().includes(q) ||
      b.dettagli.some(d =>
        d.nomeDescrittivo.toLowerCase().includes(q) ||
        d.voce.includes(q),
      ),
    )
  }, [bozzeSources, bozzaSearch])

  function toggleCopyNom(bozzaId: string, nom: Nominativo) {
    const key = `${bozzaId}||${nom.id}`
    setCopySel(prev => {
      const next = new Map(prev)
      if (next.has(key)) next.delete(key)
      else next.set(key, nom)
      return next
    })
  }

  function toggleCopyGruppo(bozzaId: string, gruppoNoms: Nominativo[]) {
    const available = gruppoNoms.filter(n => !alreadyIn.has(n.matricola))
    const allKeys   = available.map(n => `${bozzaId}||${n.id}`)
    const allIn     = allKeys.every(k => copySel.has(k))
    setCopySel(prev => {
      const next = new Map(prev)
      if (allIn) allKeys.forEach(k => next.delete(k))
      else available.forEach(n => next.set(`${bozzaId}||${n.id}`, n))
      return next
    })
  }

  function handleAddCopy() {
    for (const nom of copySel.values()) {
      addNominativo({
        matricola:    nom.matricola,
        cognomeNome:  nom.cognomeNome,
        ruolo:        nom.ruolo,
        druolo:       nom.druolo,
        dettaglioId:  dettaglio.id,
        importoLordo: nom.importoLordo,
        origine:      nom.origine,
      })
    }
    onClose()
  }

  const copyCount = copySel.size

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════

  return (
    <>
    {/* Disambiguation modal per il tab manuale */}
    {disambiguaItems.length > 0 && (
      <RuoloDisambiguaModal
        items={disambiguaItems}
        onResolve={(_nomId, ruolo, druolo) => {
          setMRuolo(ruolo.toUpperCase())
          setMDruolo(druolo)
          setFilled(true)
        }}
        onAllResolved={() => setDisambiguaItems([])}
        onClose={() => setDisambiguaItems([])}
      />
    )}
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div ref={dialogRef}
        className="bg-slate-900 border-0 sm:border border-slate-700
                   rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl
                   h-[100dvh] sm:h-auto sm:max-h-[90dvh]
                   flex flex-col shadow-2xl"
      >

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <h2 id={titleId} className="text-white font-semibold">Aggiungi nominativo</h2>
            <p className="text-slate-500 text-xs mt-0.5 truncate max-w-sm">
              {dettaglio.nomeDescrittivo || 'Gruppo senza nome'}
            </p>
          </div>
          <button onClick={onClose} aria-label="Chiudi"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0.5 px-5 pt-3">
          {([
            { id: 'manuale', label: 'Manuale' },
            { id: 'incolla', label: 'Incolla lista' },
            { id: 'copia',   label: 'Copia nominativi' },
          ] as { id: Tab; label: string }[]).map(t => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-t-lg text-sm font-medium transition
                ${tab === t.id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body — min-h-0 necessario per flex-shrink corretto su 100dvh */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* ══ TAB MANUALE ══════════════════════════════════ */}
          {tab === 'manuale' && (
            <form id="manuale-form" onSubmit={handleAddManuale} className="px-5 py-4 space-y-4">
              {addedFlash && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-900/30
                                border border-emerald-800/60 text-emerald-400 text-sm">
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                  </svg>
                  Nominativo aggiunto — inserisci il prossimo
                </div>
              )}
              <div ref={searchRef} className="relative">
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Cerca nominativo, matricola o codice fiscale
                  {loading && <span className="ml-2 text-xs text-slate-500 font-normal">caricamento…</span>}
                  {!loading && anagrafiche.length > 0 && (
                    <span className="ml-2 text-xs text-slate-600 font-normal">({anagrafiche.length} record)</span>
                  )}
                </label>
                <div className="relative">
                  <input ref={searchInputRef} autoFocus value={mSearch} disabled={loading}
                    onChange={e => { setMSearch(e.target.value); setShowDrop(true); setFilled(false) }}
                    onFocus={() => mSearch.length >= 2 && setShowDrop(true)}
                    placeholder="es. Papa Fabrizio  oppure  000123  oppure  PPAFBR…"
                    className={inputCls} />
                  {fillLoading && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-indigo-400 flex items-center gap-1">
                      <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      ruolo…
                    </span>
                  )}
                  {filled && !fillLoading && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-emerald-400">
                      ✓ auto-compilato
                    </span>
                  )}
                </div>
                {showDrop && suggestions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-slate-800 border border-slate-700
                                  rounded-lg shadow-xl overflow-hidden">
                    {suggestions.map(g => (
                      <button key={g.matricola} type="button" onMouseDown={() => fillFromAnagrafica(g.record)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left
                                   hover:bg-slate-700 transition border-b border-slate-700/50 last:border-0">
                        <span className="font-mono text-xs text-indigo-400 shrink-0 w-16">{g.matricola}</span>
                        <span className="text-white text-sm flex-1 truncate">{g.cognNome}</span>
                        {/* Tutti i ruoli attivi sulla stessa riga */}
                        <span className="flex gap-1 shrink-0">
                          {g.ruoli.map(r => (
                            <span key={r} className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 font-mono">
                              {r}
                            </span>
                          ))}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {showDrop && mSearch.trim().length >= 2 && suggestions.length === 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-slate-800 border border-slate-700
                                  rounded-lg px-3 py-3 text-sm text-slate-500">
                    Nessun risultato. Compila i campi manualmente.
                  </div>
                )}
              </div>

              <Field label="Matricola *">
                <input required value={mMatricola}
                  onChange={e => { setMMatricola(e.target.value); setFilled(false) }}
                  placeholder="es. 000123" className={inputCls} />
              </Field>

              <Field label="Cognome e Nome *">
                <input required value={mCognNome}
                  onChange={e => { setMCognNome(e.target.value); setFilled(false) }}
                  placeholder="es. PAPA Fabrizio" className={inputCls} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Ruolo (codice) *">
                  <input required value={mRuolo}
                    onChange={e => { setMRuolo(e.target.value.toUpperCase()); setFilled(false) }}
                    placeholder="es. PA" className={`${inputCls} uppercase font-mono`} maxLength={10} />
                </Field>
                <Field label="Descrizione ruolo">
                  <input value={mDruolo} onChange={e => setMDruolo(e.target.value)}
                    placeholder="es. Professori Associati" className={inputCls} />
                </Field>
              </div>

              {/* ── Importo + Badge ───────────────────────── */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Importo lordo (€) *
                </label>
                <div className="flex gap-2">
                  <input
                    required={confirmedBudget.length === 0}
                    type={confirmedBudget.length > 0 ? 'text' : 'number'}
                    step="0.01"
                    readOnly={confirmedBudget.length > 0}
                    value={confirmedBudget.length > 0
                      ? importoEffettivo.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
                      : mImporto}
                    onChange={e => { if (confirmedBudget.length === 0) setMImporto(e.target.value) }}
                    placeholder="es. 1234.56"
                    className={`${inputCls} flex-1 ${confirmedBudget.length > 0 ? 'bg-slate-700/50 text-emerald-400 font-mono cursor-default' : ''}`}
                  />
                  <button
                    type="button"
                    onClick={e => setBudgetAnchorEl(e.currentTarget)}
                    title="Badge importo — scomponi in voci"
                    className="px-3 py-2 rounded-lg bg-indigo-600/20 text-indigo-400
                               border border-indigo-700/50 hover:bg-indigo-600/40 transition text-sm font-bold"
                  >+</button>
                </div>
                {budgetAnchorEl && (
                  <BudgetPanel
                    initialItems={confirmedBudget}
                    initialSingle={parseFloat(mImporto.replace(',', '.')) || 0}
                    anchorEl={budgetAnchorEl}
                    onConfirm={(_total, items) => {
                      setConfirmedBudget(items)
                      setBudgetAnchorEl(null)
                    }}
                    onClose={() => setBudgetAnchorEl(null)}
                  />
                )}
              </div>
            </form>
          )}

          {/* ══ TAB INCOLLA ══════════════════════════════════ */}
          {tab === 'incolla' && (
            <div className="px-5 py-4 space-y-3">
              <p className="text-slate-400 text-xs">
                Incolla uno o più nominativi (un nome per riga) o un CSV con il nominativo
                come prima colonna. Ogni riga verrà cercata nell&apos;anagrafica.
              </p>
              <textarea autoFocus value={pasteText}
                onChange={e => { setPasteText(e.target.value); setSearched(false); setPasteRows([]) }}
                placeholder={'Fabrizio Papa\nDino Papa\nMario Rossi\n\nOppure CSV:\nPapa Fabrizio,…'}
                rows={5} className={`${inputCls} resize-none font-mono text-xs`} />
              <button type="button" onClick={handleSearch}
                disabled={!pasteText.trim() || loading}
                className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white
                           text-sm font-medium transition disabled:opacity-40">
                {loading ? 'Caricamento anagrafica…' : 'Cerca nell\'anagrafica'}
              </button>

              {searched && pasteRows.length > 0 && (
                <div className="rounded-lg border border-slate-800 overflow-hidden">
                  <div className="px-3 py-2 bg-slate-800/50 border-b border-slate-800 flex justify-between">
                    <span className="text-xs text-slate-400">
                      {pasteRows.filter(r => r.status === 'found').length} trovati ·{' '}
                      {pasteRows.filter(r => r.status === 'multiple').length} multipli ·{' '}
                      {pasteRows.filter(r => r.status === 'not_found').length} non trovati
                    </span>
                    <button type="button"
                      onClick={() => setPasteRows(prev => prev.map(r =>
                        r.status === 'not_found' || r.status === 'duplicate' ? r : { ...r, include: true }
                      ))}
                      className="text-xs text-indigo-400 hover:text-indigo-300 transition">
                      Seleziona tutti trovati
                    </button>
                  </div>
                  <div className="divide-y divide-slate-800/50">
                    {pasteRows.map((row, idx) => (
                      <PasteResultRow key={idx} row={row}
                        onToggle={() => toggleInclude(idx)}
                        onChoose={m => chooseMatch(idx, m)}
                        onImportoChange={v => updatePasteImporto(idx, v)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══ TAB COPIA ════════════════════════════════════ */}
          {tab === 'copia' && (
            <div className="px-5 py-4 space-y-3">
              <p className="text-slate-400 text-xs">
                Seleziona i nominativi da copiare da qualsiasi gruppo o bozza (incluse le archiviate).
                Gli importi lordi vengono preservati.
              </p>

              <input value={bozzaSearch} onChange={e => setBozzaSearch(e.target.value)}
                placeholder="Cerca bozza o gruppo…"
                className={inputCls} />

              {loading && (
                <p className="text-center text-slate-500 text-sm py-4">Caricamento bozze…</p>
              )}

              {!loading && bozzeFiltrate.length === 0 && (
                <div className="text-center py-8 text-slate-500 text-sm">
                  Nessuna bozza disponibile.
                </div>
              )}

              <div className="space-y-2">
                {bozzeFiltrate.map(source => {
                  const isExpBozza = expandedBozze.has(source.id)
                  const statoBadge: Record<string, string> = {
                    corrente:   'bg-indigo-900/40 text-indigo-400 border-indigo-800',
                    bozza:      'bg-slate-800 text-slate-400 border-slate-700',
                    archiviata: 'bg-amber-900/30 text-amber-500 border-amber-800/50',
                  }

                  return (
                    <div key={source.id}
                      className="rounded-xl border border-slate-800 overflow-hidden">

                      {/* Header bozza */}
                      <button type="button"
                        onClick={() => setExpandedBozze(prev => {
                          const n = new Set(prev)
                          n.has(source.id) ? n.delete(source.id) : n.add(source.id)
                          return n
                        })}
                        className="w-full flex items-center gap-3 px-4 py-3
                                   hover:bg-slate-800/40 transition text-left">
                        <svg className={`w-4 h-4 text-slate-500 transition-transform shrink-0
                          ${isExpBozza ? 'rotate-90' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                        </svg>
                        <span className="text-white text-sm font-medium flex-1 truncate">{source.nome}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded border shrink-0
                          ${statoBadge[source.stato] ?? statoBadge.bozza}`}>
                          {source.stato}
                        </span>
                        <span className="text-slate-500 text-xs shrink-0">
                          {source.dettagli.length} gruppi
                        </span>
                      </button>

                      {/* Gruppi */}
                      {isExpBozza && (
                        <div className="border-t border-slate-800 bg-slate-950/30">
                          {source.dettagli.length === 0 ? (
                            <p className="px-4 py-3 text-slate-500 text-xs">Nessun gruppo in questa bozza.</p>
                          ) : source.dettagli.map(gruppo => {
                            const gruppoKey  = `${source.id}||${gruppo.id}`
                            const isExpGruppo = expandedGruppi.has(gruppoKey)
                            const gruppoNoms  = source.nominativi.filter(n => n.dettaglioId === gruppo.id)
                            const available   = gruppoNoms.filter(n => !alreadyIn.has(n.matricola))
                            const selCount    = available.filter(n => copySel.has(`${source.id}||${n.id}`)).length

                            return (
                              <div key={gruppo.id} className="border-b border-slate-800/50 last:border-0">
                                {/* Header gruppo */}
                                <div className="flex items-center gap-2 px-4 py-2.5">
                                  <button type="button"
                                    onClick={() => setExpandedGruppi(prev => {
                                      const n = new Set(prev)
                                      n.has(gruppoKey) ? n.delete(gruppoKey) : n.add(gruppoKey)
                                      return n
                                    })}
                                    className="flex items-center gap-2 flex-1 text-left min-w-0">
                                    <svg className={`w-3.5 h-3.5 text-slate-600 transition-transform shrink-0
                                      ${isExpGruppo ? 'rotate-90' : ''}`}
                                      fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                                    </svg>
                                    <span
                                      className="w-2 h-2 rounded-full shrink-0"
                                      style={{ backgroundColor: gruppo.colore ?? '#6366f1' }}
                                    />
                                    <span className="text-slate-300 text-xs truncate">
                                      {gruppo.nomeDescrittivo || 'Gruppo senza nome'}
                                    </span>
                                  </button>

                                  {/* Seleziona tutto il gruppo */}
                                  {available.length > 0 && (
                                    <button type="button"
                                      onClick={() => toggleCopyGruppo(source.id, gruppoNoms)}
                                      className="text-xs text-indigo-400 hover:text-indigo-300 transition shrink-0 ml-2">
                                      {selCount === available.length ? 'Desel.' : `Tutti (${available.length})`}
                                    </button>
                                  )}
                                  <span className="text-slate-600 text-xs shrink-0">{gruppoNoms.length} nom.</span>
                                </div>

                                {/* Nominativi del gruppo */}
                                {isExpGruppo && (
                                  <div className="pb-1">
                                    {gruppoNoms.length === 0 ? (
                                      <p className="px-8 py-2 text-slate-600 text-xs">Nessun nominativo.</p>
                                    ) : gruppoNoms.map(nom => {
                                      const key       = `${source.id}||${nom.id}`
                                      const isAlready = alreadyIn.has(nom.matricola)
                                      const isSel     = copySel.has(key)

                                      return (
                                        <label key={nom.id}
                                          className={`flex items-center gap-3 px-6 py-2 cursor-pointer
                                            transition select-none
                                            ${isAlready ? 'opacity-30 cursor-not-allowed' : 'hover:bg-slate-800/30'}
                                            ${isSel ? 'bg-indigo-900/10' : ''}`}>
                                          <input type="checkbox"
                                            checked={isSel}
                                            disabled={isAlready}
                                            onChange={() => !isAlready && toggleCopyNom(source.id, nom)}
                                            className="w-4 h-4 rounded border-slate-600 accent-indigo-500 shrink-0" />
                                          <span className="text-slate-300 text-xs flex-1 truncate">
                                            {nom.cognomeNome}
                                          </span>
                                          <span className="font-mono text-xs text-slate-500 shrink-0">
                                            {nom.matricola}
                                          </span>
                                          <span className="text-xs px-1 py-0.5 rounded bg-slate-800
                                                           text-slate-400 font-mono shrink-0">
                                            {nom.ruolo}
                                          </span>
                                          <span className="text-xs font-mono text-slate-400 shrink-0">
                                            {nom.importoLordo.toLocaleString('it-IT', {
                                              minimumFractionDigits: 2, maximumFractionDigits: 2,
                                            })} €
                                          </span>
                                        </label>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer — flex-none: sempre visibile anche con tastiera mobile aperta */}
        <div className="flex-none flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-800"
             style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-800 text-sm transition">
            Annulla
          </button>

          {tab === 'manuale' && (
            <button type="submit" form="manuale-form"
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500
                         text-white text-sm font-medium transition">
              Aggiungi
            </button>
          )}
          {tab === 'incolla' && (
            <button type="button" disabled={pasteAddCount === 0} onClick={handleAddFromPaste}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white
                         text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed">
              Aggiungi{pasteAddCount > 0 ? ` (${pasteAddCount})` : ''}
            </button>
          )}
          {tab === 'copia' && (
            <button type="button" disabled={copyCount === 0} onClick={handleAddCopy}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white
                         text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed">
              Copia{copyCount > 0 ? ` (${copyCount})` : ''}
            </button>
          )}
        </div>
      </div>
    </div>
    </>
  )
}

// ── Riga risultato incolla ────────────────────────────────────

function PasteResultRow({ row, onToggle, onChoose, onImportoChange }: {
  row:             PasteRow
  onToggle:        () => void
  onChoose:        (matricola: string) => void
  onImportoChange: (value: string) => void
}) {
  const statusIcon: Record<PasteStatus, React.ReactNode> = {
    found:      <span className="text-emerald-400 text-xs font-bold shrink-0">✓</span>,
    not_found:  <span className="text-red-400 text-xs font-bold shrink-0">✗</span>,
    multiple:   <span className="text-amber-400 text-xs font-bold shrink-0">?</span>,
    duplicate:  <span className="text-slate-500 text-xs shrink-0">dup</span>,
  }

  const canToggle = row.status === 'found' || (row.status === 'multiple' && !!row.chosen)

  const [localImporto, setLocalImporto] = useState(
    row.importoParsed > 0 ? String(row.importoParsed) : '',
  )
  useEffect(() => {
    setLocalImporto(row.importoParsed > 0 ? String(row.importoParsed) : '')
  }, [row.importoParsed])

  return (
    <div className={`px-3 py-2.5 flex items-start gap-3 ${row.include ? 'bg-indigo-900/10' : ''}`}>
      <input type="checkbox" checked={row.include} onChange={onToggle} disabled={!canToggle}
        className="mt-0.5 w-4 h-4 rounded border-slate-600 accent-indigo-500 shrink-0
                   disabled:opacity-30 disabled:cursor-not-allowed" />
      <div className="mt-0.5">{statusIcon[row.status]}</div>
      <div className="flex-1 min-w-0">
        <p className="text-slate-300 text-sm font-mono truncate">{row.input}</p>
        {row.status === 'found' && row.match && (
          <p className="text-slate-500 text-xs mt-0.5">
            {row.match.cognNome} · <span className="font-mono">{row.match.matricola}</span> · {row.match.ruolo}
          </p>
        )}
        {row.status === 'not_found' && (
          <p className="text-red-400 text-xs mt-0.5">Non trovato nell&apos;anagrafica</p>
        )}
        {row.status === 'duplicate' && (
          <p className="text-slate-500 text-xs mt-0.5">Già presente in questo gruppo</p>
        )}
        {row.status === 'multiple' && row.matches && (
          <div className="mt-1.5">
            <p className="text-amber-400 text-xs mb-1">{row.matches.length} corrispondenze:</p>
            <div className="flex flex-col gap-1">
              {row.matches.map(m => (
                <button key={m.matricola} type="button" onMouseDown={() => onChoose(m.matricola)}
                  className={`text-left px-2 py-1 rounded text-xs transition
                    ${row.chosen === m.matricola
                      ? 'bg-indigo-700/40 text-indigo-300 border border-indigo-700'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                  {m.cognNome} · <span className="font-mono">{m.matricola}</span> · {m.ruolo}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {/* Importo editabile per riga */}
      {(row.status === 'found' || (row.status === 'multiple' && !!row.chosen)) && (
        <div className="shrink-0 flex items-center gap-1">
          <input
            type="number"
            step="0.01"
            value={localImporto}
            onChange={e => { setLocalImporto(e.target.value); onImportoChange(e.target.value) }}
            placeholder="€ 0"
            className="w-24 px-2 py-1 rounded-lg bg-slate-700 border border-slate-600
                       text-white text-xs text-right font-mono
                       focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <span className="text-slate-600 text-xs">€</span>
        </div>
      )}
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
