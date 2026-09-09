// ============================================================
// PAYROLL GANG SUITE — Editor template estrazione PDF a regioni (admin)
//
// Disegna sul layout di un cedolino-campione le regioni (RegionRect, %
// 0..1 robuste a zoom/DPI — mirror server extractor.ts: stesso spazio-
// viewport) che il backend userà per estrarre testo da PDF dello stesso
// formato. Ogni "parte" è anagrafica (1 regione) o voce (coppia
// descrizione+importo) — discriminated union mirror Gate2 §A.
//
// Draft-state: ParteAnagrafica/ParteVoce hanno RegionRect OBBLIGATORIE,
// ma durante il disegno servono placeholder nullable → ParteDraft locale
// (union parallela con regioni nullable), validata+convertita solo al
// salvataggio (buildParti/buildPageGeometry).
//
// Versionamento immutabile: salva = create (nuova famiglia) oppure
// createNewVersion (sostituzione completa, mai patch — auto-disattiva la
// versione precedente in tx). certificatoTemplateId fissato alla
// creazione, mai modificabile (Gate1 Q6) — mostrato sola lettura quando
// si versiona una famiglia esistente.
//
// Test estrazione richiede un id PERSISTITO (POST /:id/extract — niente
// dry-run): il PDF di riferimento serve sia per disegnare sia, dopo il
// salvataggio, per testare l'estrazione contro il template appena salvato.
//
// Lazy-loaded da App.tsx: unico punto della SPA che porta pdfjs-dist
// (canvas rendering) — il flusso operativo (PdfRegionTemplatesPage) lavora
// solo su JSON, nessun rendering PDF lato client.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import {
  pdfRegionTemplatesApi, templatiCertificatoApi,
  type PdfRegionTemplateApi, type PdfRegionTemplateBody, type PageGeometry,
  type RegionRect, type AnagraficaRuolo, type ParteTemplate, type ExtractPreviewResult,
  type TemplateApi,
} from '../api/endpoints'
import { usePdfDocument, type PdfPageGeometry } from '../hooks/usePdfDocument'
import { showToast } from '../components/ToastManager'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ApiError } from '../api/client'
import { PALETTE_DETTAGLIO } from '../constants/csvDefaults'

// mirror SEZIONI server (services/cedolino/types.ts SezioneCedolino / routes/pdfRegionTemplates.ts)
const SEZIONI = [
  'retribuzioni', 'accessorie', 'abbattimenti', 'contributi',
  'fiscali_correnti', 'fiscali_conguaglio', 'sindacali', 'altre_ritenute',
] as const

// Campi anagrafica selezionabili — mirror AnagraficaRuolo server
// (services/pdfRegion/types.ts). Copre tutti i campi di AnagraficaCedolino.
const RUOLI_ANAGRAFICA: Array<{ value: AnagraficaRuolo; label: string }> = [
  { value: 'matricola',            label: 'Matricola' },
  { value: 'cognome_nome',         label: 'Cognome e nome' },
  { value: 'periodo_retribuzione', label: 'Periodo retribuzione' },
  { value: 'codice_fiscale',       label: 'Codice fiscale' },
  { value: 'data_nascita',         label: 'Data di nascita' },
  { value: 'luogo_nascita',        label: 'Luogo di nascita' },
  { value: 'inquadramento',        label: 'Inquadramento' },
  { value: 'area_profilo',         label: 'Area/profilo' },
  { value: 'ruolo',                label: 'Ruolo (es. ND/PA/PO)' },
  { value: 'inizio_rapporto',      label: 'Inizio rapporto' },
  { value: 'anzianita_servizio',   label: 'Anzianità servizio' },
  { value: 'afferenza',            label: 'Afferenza' },
  { value: 'sede',                 label: 'Sede' },
]

// ── Draft state — mirror ParteAnagrafica/ParteVoce con regioni nullable ──

interface ParteAnagraficaDraft {
  kind:    'anagrafica'
  id:      string
  label:   string
  ruolo:   AnagraficaRuolo
  regione: RegionRect | null
}
interface ParteVoceDraft {
  kind:               'voce'
  id:                 string
  label:              string
  regioneDescrizione: RegionRect | null
  regioneImporto:     RegionRect | null
  sezione:            string
  sign:               '+' | '-'
  isArretrato:        boolean
  decorrenza:         string | null
  scadenza:           string | null
}
type ParteDraft = ParteAnagraficaDraft | ParteVoceDraft

/** Slot "armato" in attesa di disegno — il prossimo trascinamento sul PDF gli assegna la regione. */
interface ArmedSlot {
  parteId: string
  field:   'regione' | 'regioneDescrizione' | 'regioneImporto'
}

interface RegioneOverlay { regione: RegionRect; colore: string; etichetta: string }

function toDraft(p: ParteTemplate): ParteDraft {
  if (p.kind === 'anagrafica') {
    return { kind: 'anagrafica', id: p.id, label: p.label, ruolo: p.ruolo, regione: p.regione }
  }
  return {
    kind: 'voce', id: p.id, label: p.label,
    regioneDescrizione: p.regioneDescrizione, regioneImporto: p.regioneImporto,
    sezione: p.sezione, sign: p.sign, isArretrato: p.isArretrato,
    decorrenza: p.decorrenza ?? null, scadenza: p.scadenza ?? null,
  }
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve((reader.result as string).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('Lettura file fallita'))
    reader.readAsDataURL(file)
  })
}

const coloreParte = (idx: number): string => PALETTE_DETTAGLIO[idx % PALETTE_DETTAGLIO.length] as string

export default function PdfRegionEditorPage() {
  const { navigate, user } = useStore()

  // ── lista versioni (storico completo — gestione admin, mirror CertificatiTemplatePage) ──
  const [list, setList]           = useState<PdfRegionTemplateApi[]>([])
  const [selFamily, setSelFamily] = useState<PdfRegionTemplateApi | null>(null)
  const [toDelete, setToDelete]   = useState<PdfRegionTemplateApi | null>(null)

  // ── form principale ──────────────────────────────────────────
  const [nome, setNome] = useState('')
  const [nota, setNota] = useState('')
  const [certTemplates, setCertTemplates]                 = useState<TemplateApi[]>([])
  const [certificatoTemplateId, setCertificatoTemplateId] = useState('')
  const [parti, setParti]         = useState<ParteDraft[]>([])
  const [armedSlot, setArmedSlot] = useState<ArmedSlot | null>(null)
  const [saving, setSaving]       = useState(false)

  // ── PDF di riferimento (disegno regioni + test estrazione — MAI persistito) ──
  const [pdfFile, setPdfFile]     = useState<File | null>(null)
  const [pdfBytes, setPdfBytes]   = useState<Uint8Array | null>(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [zoom, setZoom]           = useState(1)
  const [dragOver, setDragOver]   = useState(false)

  const canvasRef        = useRef<HTMLCanvasElement>(null)
  const overlayRef       = useRef<HTMLDivElement>(null)
  const pageGeomCacheRef = useRef<Map<number, PdfPageGeometry>>(new Map())

  const { isLoading: pdfLoading, loadError: pdfLoadError, numPages, renderPage } = usePdfDocument(pdfBytes)

  // ── disegno regione in corso (trascinamento sull'overlay) ────
  const [drawStart, setDrawStart]     = useState<{ x: number; y: number } | null>(null)
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null)

  // ── test estrazione post-salvataggio (richiede id persistito) ──
  const [testResult, setTestResult] = useState<ExtractPreviewResult | null>(null)
  const [testing, setTesting]       = useState(false)

  // ── caricamento liste ────────────────────────────────────────
  const refresh = useCallback(() => {
    pdfRegionTemplatesApi.list({ all: true })
      .then(rows => setList([...rows].sort((a, b) => a.nome.localeCompare(b.nome) || b.versione - a.versione)))
      .catch(() => showToast('Caricamento template fallito', 'error'))
  }, [])
  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    templatiCertificatoApi.list(true)
      .then(setCertTemplates)
      .catch(() => showToast('Impossibile caricare i template certificato', 'error'))
  }, [])

  // ── render pagina corrente sul canvas, registra geometria nativa in cache ──
  useEffect(() => {
    let cancelled = false
    if (!canvasRef.current || numPages === 0) return
    renderPage(pageIndex, canvasRef.current, zoom).then(g => {
      if (cancelled || !g) return
      pageGeomCacheRef.current.set(pageIndex, g)
    })
    return () => { cancelled = true }
  }, [pageIndex, zoom, numPages, renderPage])

  // ── selezione / nuovo ────────────────────────────────────────
  function seleziona(t: PdfRegionTemplateApi) {
    setSelFamily(t)
    setNome(t.nome)
    setNota(t.nota ?? '')
    setCertificatoTemplateId(t.certificatoTemplateId)
    setParti(t.parti.map(toDraft))
    setArmedSlot(null)
    setTestResult(null)
    // pre-semina la cache dalla geometria già salvata: se l'admin non tocca
    // le regioni può risalvare senza dover rivisitare ogni pagina; rivisitare
    // una pagina sovrascrive comunque con la misura fresca dal PDF caricato.
    pageGeomCacheRef.current = new Map(t.pageGeometry.map(g => [g.pageIndex, { widthPt: g.widthPt, heightPt: g.heightPt, rotation: g.rotation }]))
  }

  function nuovo() {
    setSelFamily(null)
    setNome('Nuovo template')
    setNota('')
    setCertificatoTemplateId(certTemplates[0]?.id ?? '')
    setParti([])
    setArmedSlot(null)
    setTestResult(null)
    pageGeomCacheRef.current = new Map()
    // Audit Gate4 M5: senza questo reset il canvas conserva il PDF del template
    // precedente — le regioni del nuovo template verrebbero mappate sulla
    // geometria sbagliata (corruzione silenziosa dei dati salvati).
    setPdfFile(null)
    setPdfBytes(null)
    setPageIndex(0)
    setZoom(1)
  }

  // ── caricamento PDF di riferimento ───────────────────────────
  async function handlePdfFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf')) { showToast('Seleziona un file PDF', 'error'); return }
    const buf = await file.arrayBuffer()
    // PDF diverso → geometria precedente non più valida, va rimisurata pagina per pagina
    pageGeomCacheRef.current.clear()
    setPdfBytes(new Uint8Array(buf))
    setPdfFile(file)
    setPageIndex(0)
    setZoom(1)
    setTestResult(null)
    // Audit Gate4 M6: slot armato riferito al PDF precedente — disarma per evitare
    // che il prossimo disegno venga associato alla parte sbagliata del template.
    setArmedSlot(null)
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void handlePdfFile(file)
  }

  // ── gestione parti (draft) ───────────────────────────────────
  function aggiungiAnagrafica() {
    setParti(prev => [...prev, {
      kind: 'anagrafica', id: crypto.randomUUID(), label: `Campo ${prev.length + 1}`, ruolo: 'matricola', regione: null,
    }])
  }
  function aggiungiVoce() {
    setParti(prev => [...prev, {
      kind: 'voce', id: crypto.randomUUID(), label: `Voce ${prev.length + 1}`,
      regioneDescrizione: null, regioneImporto: null,
      sezione: 'retribuzioni', sign: '+', isArretrato: false, decorrenza: null, scadenza: null,
    }])
  }
  function rimuoviParte(id: string) {
    setParti(prev => prev.filter(p => p.id !== id))
    if (armedSlot?.parteId === id) setArmedSlot(null)
  }
  function setAnagraficaField<K extends keyof ParteAnagraficaDraft>(id: string, field: K, value: ParteAnagraficaDraft[K]) {
    setParti(prev => prev.map(p => (p.id === id && p.kind === 'anagrafica') ? { ...p, [field]: value } : p))
  }
  function setVoceField<K extends keyof ParteVoceDraft>(id: string, field: K, value: ParteVoceDraft[K]) {
    setParti(prev => prev.map(p => (p.id === id && p.kind === 'voce') ? { ...p, [field]: value } : p))
  }

  // ── disegno regioni — coordinate percentuali via overlay (robuste a zoom/DPI) ──
  function relCoords(e: React.MouseEvent): { x: number; y: number } | null {
    const el = overlayRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    return {
      x: Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1),
    }
  }
  function onOverlayMouseDown(e: React.MouseEvent) {
    if (!armedSlot) return
    const p = relCoords(e)
    if (p) { setDrawStart(p); setDrawCurrent(p) }
  }
  function onOverlayMouseMove(e: React.MouseEvent) {
    if (!drawStart) return
    const p = relCoords(e)
    if (p) setDrawCurrent(p)
  }
  function onOverlayMouseUp() {
    if (drawStart && drawCurrent && armedSlot) {
      const x = Math.min(drawStart.x, drawCurrent.x)
      const y = Math.min(drawStart.y, drawCurrent.y)
      const width  = Math.abs(drawCurrent.x - drawStart.x)
      const height = Math.abs(drawCurrent.y - drawStart.y)
      if (width < 0.004 || height < 0.004) {
        showToast("Regione troppo piccola — trascina un'area più ampia", 'error')
      } else {
        applyRegion(armedSlot, { pageIndex, x, y, width, height })
        setArmedSlot(null)
      }
    }
    setDrawStart(null)
    setDrawCurrent(null)
  }
  function applyRegion(slot: ArmedSlot, regione: RegionRect) {
    setParti(prev => prev.map(p => {
      if (p.id !== slot.parteId) return p
      if (p.kind === 'anagrafica' && slot.field === 'regione')             return { ...p, regione }
      if (p.kind === 'voce'       && slot.field === 'regioneDescrizione')  return { ...p, regioneDescrizione: regione }
      if (p.kind === 'voce'       && slot.field === 'regioneImporto')      return { ...p, regioneImporto: regione }
      return p
    }))
  }

  // regioni della pagina corrente, colorate in round-robin (mirror PALETTE_DETTAGLIO/nextDetColor)
  const regioniPagina = useMemo<RegioneOverlay[]>(() => {
    const out: RegioneOverlay[] = []
    parti.forEach((p, idx) => {
      const colore = coloreParte(idx)
      if (p.kind === 'anagrafica') {
        if (p.regione && p.regione.pageIndex === pageIndex) out.push({ regione: p.regione, colore, etichetta: p.label })
      } else {
        if (p.regioneDescrizione && p.regioneDescrizione.pageIndex === pageIndex)
          out.push({ regione: p.regioneDescrizione, colore, etichetta: `${p.label} · descr.` })
        if (p.regioneImporto && p.regioneImporto.pageIndex === pageIndex)
          out.push({ regione: p.regioneImporto, colore, etichetta: `${p.label} · importo` })
      }
    })
    return out
  }, [parti, pageIndex])

  // ── validazione + conversione draft → contratto al salvataggio ──
  function buildParti(): ParteTemplate[] | null {
    const out: ParteTemplate[] = []
    for (const p of parti) {
      if (p.kind === 'anagrafica') {
        if (!p.regione) return null
        out.push({ kind: 'anagrafica', id: p.id, label: p.label.trim(), ruolo: p.ruolo, regione: p.regione })
      } else {
        if (!p.regioneDescrizione || !p.regioneImporto) return null
        out.push({
          kind: 'voce', id: p.id, label: p.label.trim(),
          regioneDescrizione: p.regioneDescrizione, regioneImporto: p.regioneImporto,
          sezione: p.sezione, sign: p.sign, isArretrato: p.isArretrato,
          decorrenza: p.decorrenza, scadenza: p.scadenza,
        })
      }
    }
    return out
  }
  function buildPageGeometry(): { geometry: PageGeometry[]; missing: number[] } {
    const pagine = new Set<number>()
    for (const p of parti) {
      if (p.kind === 'anagrafica') { if (p.regione) pagine.add(p.regione.pageIndex) }
      else {
        if (p.regioneDescrizione) pagine.add(p.regioneDescrizione.pageIndex)
        if (p.regioneImporto)     pagine.add(p.regioneImporto.pageIndex)
      }
    }
    const geometry: PageGeometry[] = []
    const missing:  number[]       = []
    for (const idx of pagine) {
      const g = pageGeomCacheRef.current.get(idx)
      if (g) geometry.push({ pageIndex: idx, widthPt: g.widthPt, heightPt: g.heightPt, rotation: g.rotation })
      else missing.push(idx)
    }
    return { geometry, missing }
  }

  // ── salva (create nuova famiglia oppure createNewVersion — mai patch parziale) ──
  async function salva() {
    if (!nome.trim())            { showToast('Inserisci un nome', 'error'); return }
    if (!certificatoTemplateId)  { showToast('Seleziona un template certificato', 'error'); return }
    if (parti.length === 0)      { showToast('Aggiungi almeno una parte', 'error'); return }
    if (parti.some(p => !p.label.trim())) { showToast("Ogni parte deve avere un'etichetta", 'error'); return }

    const partiFinal = buildParti()
    if (!partiFinal) { showToast('Disegna tutte le regioni richieste prima di salvare', 'error'); return }

    const { geometry, missing } = buildPageGeometry()
    if (missing.length > 0) {
      showToast(`Visita la/e pagina/e ${missing.map(i => i + 1).join(', ')} nel visualizzatore (registra la geometria), poi salva di nuovo`, 'error')
      return
    }

    setSaving(true)
    try {
      const body: PdfRegionTemplateBody = {
        nome: nome.trim(),
        nota: nota.trim() || null,
        pageGeometry: geometry,
        parti: partiFinal,
        certificatoTemplateId,
      }
      const saved = selFamily
        ? await pdfRegionTemplatesApi.createNewVersion(selFamily.id, body)
        : await pdfRegionTemplatesApi.create(body)
      showToast(`Template "${saved.nome}" salvato — ${saved.versioneLabel}`, 'success')
      setSelFamily(saved)
      setTestResult(null)
      refresh()
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'ERRORE'
      showToast(`Salvataggio fallito: ${code}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── test estrazione — richiede id persistito (no dry-run, mirror /:id/extract) ──
  async function eseguiTest() {
    if (!selFamily) { showToast("Salva il template prima di testare l'estrazione", 'error'); return }
    if (!pdfFile)   { showToast('Carica un PDF di prova', 'error'); return }
    setTesting(true); setTestResult(null)
    try {
      const base64 = await readFileAsBase64(pdfFile)
      const r = await pdfRegionTemplatesApi.extract(selFamily.id, base64)
      setTestResult(r)
      showToast(
        r.errors.length > 0 ? `Test completato — ${r.errors.length} errori da correggere` : 'Estrazione di prova riuscita',
        r.errors.length > 0 ? 'error' : 'success',
      )
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'ERRORE'
      showToast(`Test estrazione fallito: ${code}`, 'error')
    } finally {
      setTesting(false)
    }
  }

  // ── elimina versione/riga (mirror DELETE /:id — elimina SOLO questa riga) ──
  async function confermaElimina() {
    if (!toDelete) return
    try {
      await pdfRegionTemplatesApi.delete(toDelete.id)
      showToast(`Versione ${toDelete.versioneLabel} eliminata`, 'success')
      if (selFamily?.id === toDelete.id) nuovo()
      refresh()
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'ERRORE'
      showToast(`Eliminazione fallita: ${code}`, 'error')
    } finally {
      setToDelete(null)
    }
  }

  const editing = selFamily !== null || nome !== ''

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Template estrazione PDF</h1>
          <p className="text-sm text-slate-500">
            Disegna le regioni sul layout del cedolino-campione: ogni parte punta a un rettangolo
            percentuale della pagina (robusto a zoom/risoluzione).
          </p>
        </div>
        <button onClick={() => navigate('pdf-region-templates')} className="text-sm text-slate-400 hover:text-white">
          ← Certificati da PDF
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Lista versioni — storico completo (gestione admin) */}
        <div className="space-y-2">
          <button onClick={nuovo} className="w-full px-3 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium">
            + Nuovo template
          </button>
          {list.map(t => (
            <div key={t.id}
              className={`rounded-lg border p-3 cursor-pointer transition-colors
                ${selFamily?.id === t.id ? 'border-indigo-600 bg-indigo-600/10' : 'border-slate-800 bg-slate-900/50 hover:bg-slate-800/50'}`}
              onClick={() => seleziona(t)}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-slate-200 truncate">{t.nome}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap
                  ${t.attivo ? 'bg-emerald-600/20 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>
                  {t.attivo ? 'attivo' : `v.${t.versione}`}
                </span>
              </div>
              <p className="text-xs text-slate-500">{t.versioneLabel} · {t.parti.length} parti</p>
            </div>
          ))}
          {list.length === 0 && <p className="text-xs text-slate-600 text-center py-4">Nessun template salvato.</p>}
        </div>

        {/* Editor */}
        <div className="lg:col-span-3 space-y-4">
          {editing ? (
            <>
              {/* Campi principali */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Nome" value={nome} onChange={setNome} />
                <label className="block">
                  <span className="text-xs text-slate-500">Template certificato (forma di output)</span>
                  {selFamily ? (
                    <p className="input mt-1 bg-slate-800/40 text-slate-400 cursor-not-allowed truncate" title="Fissato alla creazione — un layout-sorgente produce sempre la stessa forma di certificato (Gate1 Q6)">
                      {certTemplates.find(c => c.id === certificatoTemplateId)?.nome ?? certificatoTemplateId}
                      <span className="ml-2 text-[10px] text-slate-600">immutabile</span>
                    </p>
                  ) : (
                    <select className="input mt-1" value={certificatoTemplateId} onChange={e => setCertificatoTemplateId(e.target.value)}>
                      <option value="">— seleziona —</option>
                      {certTemplates.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  )}
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs text-slate-500">Nota (opzionale)</span>
                  <textarea className="input mt-1 h-16" value={nota} onChange={e => setNota(e.target.value)} />
                </label>
              </div>

              {/* PDF di riferimento + visualizzatore/disegno */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="text-sm text-slate-300">PDF di riferimento <span className="text-slate-600">— per disegnare le regioni e testare l'estrazione, mai salvato</span></p>
                  <label className="px-3 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-pointer transition-colors">
                    {pdfFile ? 'Cambia file…' : 'Carica PDF…'}
                    <input type="file" accept="application/pdf" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) void handlePdfFile(f); e.target.value = '' }} />
                  </label>
                </div>

                {!pdfFile && (
                  <div
                    onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    className={`rounded-lg border-2 border-dashed p-8 text-center text-sm transition-colors
                      ${dragOver ? 'border-indigo-500 bg-indigo-500/5 text-indigo-300' : 'border-slate-700 text-slate-600'}`}
                  >
                    Trascina qui un cedolino PDF di esempio, oppure usa "Carica PDF…"
                  </div>
                )}

                {pdfFile && (
                  <>
                    <div className="flex items-center gap-3 flex-wrap text-sm">
                      <span className="text-slate-400 truncate max-w-[14rem]" title={pdfFile.name}>{pdfFile.name}</span>
                      {pdfLoading   && <span className="text-slate-500 text-xs">caricamento…</span>}
                      {pdfLoadError && <span className="text-red-400 text-xs">{pdfLoadError}</span>}
                      {numPages > 0 && (
                        <>
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => setPageIndex(i => Math.max(0, i - 1))} disabled={pageIndex === 0}
                              className="px-2 py-1 rounded border border-slate-700 text-slate-300 disabled:opacity-30">‹</button>
                            <span className="text-slate-400 text-xs whitespace-nowrap">pag. {pageIndex + 1} / {numPages}</span>
                            <button onClick={() => setPageIndex(i => Math.min(numPages - 1, i + 1))} disabled={pageIndex >= numPages - 1}
                              className="px-2 py-1 rounded border border-slate-700 text-slate-300 disabled:opacity-30">›</button>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))}
                              className="px-2 py-1 rounded border border-slate-700 text-slate-300">−</button>
                            <span className="text-slate-400 text-xs w-10 text-center">{Math.round(zoom * 100)}%</span>
                            <button onClick={() => setZoom(z => Math.min(3, +(z + 0.25).toFixed(2)))}
                              className="px-2 py-1 rounded border border-slate-700 text-slate-300">+</button>
                          </div>
                        </>
                      )}
                    </div>

                    {armedSlot && (
                      <p className="text-xs text-indigo-300 bg-indigo-600/10 border border-indigo-700/40 rounded-lg px-3 py-2">
                        Trascina sul PDF per disegnare la regione — verrà assegnata alla pagina {pageIndex + 1}.{' '}
                        <button onClick={() => setArmedSlot(null)} className="underline hover:text-indigo-200">Annulla</button>
                      </p>
                    )}

                    <div className="overflow-auto max-h-[70vh] rounded-lg border border-slate-800 bg-slate-950">
                      <div className="relative inline-block">
                        <canvas ref={canvasRef} className="block" />
                        <div
                          ref={overlayRef}
                          className={`absolute inset-0 select-none ${armedSlot ? 'cursor-crosshair' : 'cursor-default'}`}
                          onMouseDown={onOverlayMouseDown}
                          onMouseMove={onOverlayMouseMove}
                          onMouseUp={onOverlayMouseUp}
                          onMouseLeave={onOverlayMouseUp}
                        >
                          {regioniPagina.map((r, i) => (
                            <div key={i} className="absolute border-2 pointer-events-none" style={{
                              left:   `${r.regione.x * 100}%`,
                              top:    `${r.regione.y * 100}%`,
                              width:  `${r.regione.width * 100}%`,
                              height: `${r.regione.height * 100}%`,
                              borderColor:     r.colore,
                              backgroundColor: `${r.colore}26`,
                            }}>
                              <span className="absolute -top-5 left-0 text-[10px] px-1 rounded whitespace-nowrap font-medium"
                                style={{ backgroundColor: r.colore, color: '#0f172a' }}>{r.etichetta}</span>
                            </div>
                          ))}
                          {drawStart && drawCurrent && (
                            <div className="absolute border-2 border-dashed border-indigo-400 bg-indigo-400/10 pointer-events-none" style={{
                              left:   `${Math.min(drawStart.x, drawCurrent.x) * 100}%`,
                              top:    `${Math.min(drawStart.y, drawCurrent.y) * 100}%`,
                              width:  `${Math.abs(drawCurrent.x - drawStart.x) * 100}%`,
                              height: `${Math.abs(drawCurrent.y - drawStart.y) * 100}%`,
                            }} />
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Parti */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-white font-medium text-sm">Parti ({parti.length})</h2>
                  <div className="flex gap-2">
                    <button onClick={aggiungiAnagrafica} className="px-3 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors">+ Anagrafica</button>
                    <button onClick={aggiungiVoce}       className="px-3 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors">+ Voce</button>
                  </div>
                </div>

                {parti.length === 0 && (
                  <p className="text-xs text-slate-600 text-center py-4">Nessuna parte — aggiungi un campo anagrafica o una voce di cedolino.</p>
                )}

                <div className="space-y-3">
                  {parti.map((p, idx) => {
                    const colore = coloreParte(idx)
                    return (
                      <div key={p.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-2"
                        style={{ borderLeftColor: colore, borderLeftWidth: 3 }}>
                        <div className="flex items-center gap-2">
                          <input className="input flex-1" value={p.label}
                            onChange={e => p.kind === 'anagrafica'
                              ? setAnagraficaField(p.id, 'label', e.target.value)
                              : setVoceField(p.id, 'label', e.target.value)} />
                          <span className="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-400 whitespace-nowrap">
                            {p.kind === 'anagrafica' ? 'anagrafica' : 'voce'}
                          </span>
                          <button onClick={() => rimuoviParte(p.id)} className="text-xs text-red-400 hover:text-red-300 whitespace-nowrap">Rimuovi</button>
                        </div>

                        {p.kind === 'anagrafica' ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <label className="block">
                              <span className="text-xs text-slate-500">Ruolo</span>
                              <select className="input mt-1" value={p.ruolo}
                                onChange={e => setAnagraficaField(p.id, 'ruolo', e.target.value as AnagraficaRuolo)}>
                                {RUOLI_ANAGRAFICA.map(r => (
                                  <option key={r.value} value={r.value}>{r.label}</option>
                                ))}
                              </select>
                            </label>
                            <RegionSlot label="Regione" value={p.regione} pageIndex={pageIndex}
                              armed={armedSlot?.parteId === p.id && armedSlot.field === 'regione'}
                              onArm={() => setArmedSlot({ parteId: p.id, field: 'regione' })}
                              onDisarm={() => setArmedSlot(null)} />
                          </div>
                        ) : (
                          <>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <label className="block">
                                <span className="text-xs text-slate-500">Sezione</span>
                                <select className="input mt-1" value={p.sezione} onChange={e => setVoceField(p.id, 'sezione', e.target.value)}>
                                  {SEZIONI.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                              </label>
                              <label className="block">
                                <span className="text-xs text-slate-500">Segno</span>
                                <select className="input mt-1" value={p.sign} onChange={e => setVoceField(p.id, 'sign', e.target.value as '+' | '-')}>
                                  <option value="+">+ (entrata)</option>
                                  <option value="-">− (trattenuta)</option>
                                </select>
                              </label>
                              <label className="flex items-end gap-2 pb-1.5">
                                <input type="checkbox" checked={p.isArretrato}
                                  onChange={e => setVoceField(p.id, 'isArretrato', e.target.checked)}
                                  className="w-4 h-4 accent-indigo-600" />
                                <span className="text-sm text-slate-300">Arretrato</span>
                              </label>
                            </div>

                            {(p.sezione === 'sindacali' || p.sezione === 'altre_ritenute') && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <Field label="Decorrenza (ISO 8601)" value={p.decorrenza ?? ''} onChange={v => setVoceField(p.id, 'decorrenza', v || null)} />
                                <Field label="Scadenza (ISO 8601)"   value={p.scadenza ?? ''}   onChange={v => setVoceField(p.id, 'scadenza', v || null)} />
                              </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <RegionSlot label="Regione descrizione" value={p.regioneDescrizione} pageIndex={pageIndex}
                                armed={armedSlot?.parteId === p.id && armedSlot.field === 'regioneDescrizione'}
                                onArm={() => setArmedSlot({ parteId: p.id, field: 'regioneDescrizione' })}
                                onDisarm={() => setArmedSlot(null)} />
                              <RegionSlot label="Regione importo" value={p.regioneImporto} pageIndex={pageIndex}
                                armed={armedSlot?.parteId === p.id && armedSlot.field === 'regioneImporto'}
                                onArm={() => setArmedSlot({ parteId: p.id, field: 'regioneImporto' })}
                                onDisarm={() => setArmedSlot(null)} />
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Azioni */}
              <div className="flex items-center justify-between flex-wrap gap-3">
                {selFamily && user?.isAdmin && (
                  <button onClick={() => setToDelete(selFamily)} className="text-sm text-red-400 hover:text-red-300">
                    Elimina questa versione
                  </button>
                )}
                <div className="ml-auto flex items-center gap-3">
                  <button onClick={eseguiTest} disabled={testing || !selFamily || !pdfFile}
                    title={!selFamily ? 'Salva il template prima di testare l\'estrazione' : (!pdfFile ? 'Carica un PDF di prova' : undefined)}
                    className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 text-sm font-medium disabled:opacity-40 transition-colors">
                    {testing ? 'Test in corso…' : 'Testa estrazione'}
                  </button>
                  <button onClick={salva} disabled={saving}
                    className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50">
                    {saving ? 'Salvataggio…' : (selFamily ? 'Salva nuova versione' : 'Crea template')}
                  </button>
                </div>
              </div>

              {/* Risultato test estrazione — JSON grezzo (mirror convenzione raw-JSON CertificatiTemplatePage) */}
              {testResult && (
                <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-white font-medium text-sm">
                      Risultato test
                      {testResult.errors.length > 0 && <span className="ml-2 text-red-400 font-normal">{testResult.errors.length} errori</span>}
                      {testResult.warnings.length > 0 && <span className="ml-2 text-amber-400 font-normal">{testResult.warnings.length} avvisi</span>}
                    </h2>
                    <button onClick={() => setTestResult(null)} className="text-xs text-slate-500 hover:text-white">chiudi</button>
                  </div>
                  <pre className="text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-lg p-3 overflow-auto max-h-96 font-mono leading-relaxed">
                    {JSON.stringify(testResult, null, 2)}
                  </pre>
                </div>
              )}
            </>
          ) : (
            <div className="text-slate-600 text-sm border border-dashed border-slate-800 rounded-xl p-10 text-center">
              Seleziona un template dalla lista o creane uno nuovo.
            </div>
          )}
        </div>
      </div>

      {toDelete && (
        <ConfirmDialog
          open
          danger
          title="Elimina versione template"
          message={toDelete.attivo
            ? `Eliminare la versione ATTIVA "${toDelete.nome}" (${toDelete.versioneLabel})? La famiglia resterà senza versione attiva — sparirà dall'elenco operativo finché non ne crei una nuova. Operazione irreversibile.`
            : `Eliminare la versione storica "${toDelete.nome}" (${toDelete.versioneLabel})? Operazione irreversibile.`}
          confirmLabel="Elimina"
          onConfirm={confermaElimina}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  )
}

// ── sub-componenti ────────────────────────────────────────────

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input className="input mt-1" value={value} onChange={e => onChange(e.target.value)} />
    </label>
  )
}

/** Slot regione — mostra stato corrente e arma/disarma il disegno sull'overlay PDF. */
function RegionSlot({ label, value, pageIndex, armed, onArm, onDisarm }: {
  label: string; value: RegionRect | null; pageIndex: number
  armed: boolean; onArm: () => void; onDisarm: () => void
}) {
  return (
    <div className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <span className={`text-xs px-2 py-1.5 rounded border flex-1 truncate
          ${value ? 'border-slate-700 text-slate-300' : 'border-dashed border-slate-700 text-slate-600'}`}>
          {value
            ? `pag. ${value.pageIndex + 1} · ${(value.width * 100).toFixed(0)}×${(value.height * 100).toFixed(0)}%`
            : `non disegnata (verrà su pag. ${pageIndex + 1})`}
        </span>
        <button onClick={armed ? onDisarm : onArm}
          className={`text-xs px-2 py-1.5 rounded font-medium whitespace-nowrap transition-colors
            ${armed ? 'bg-indigo-600 text-white' : 'border border-slate-700 text-slate-300 hover:bg-slate-800'}`}>
          {armed ? 'Annulla' : (value ? 'Ridisegna' : 'Disegna')}
        </button>
      </div>
    </div>
  )
}
