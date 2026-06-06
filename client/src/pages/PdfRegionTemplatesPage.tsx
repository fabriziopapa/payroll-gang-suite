// ============================================================
// PAYROLL GANG SUITE — Certificati da PDF (estrazione a regioni)
// Flusso operativo: selezione template-estrazione attivo → upload PDF →
// preview JSON via POST /pdf-region-templates/:id/extract (no persistenza,
// mirror /certificati/parse) → anteprima editabile → genera DOCX (mirror
// CertificatiPage, stesso CedolinoParsedApi/certificatiApi.create a valle).
// Per cedolini in formati non coperti dal parser fisso standard.
// Lettura/estrazione: ogni utente autenticato. Gestione template: solo admin
// (→ PdfRegionEditorPage, lazy-loaded con pdfjs).
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import {
  pdfRegionTemplatesApi, certificatiApi, templatiCertificatoApi,
  type PdfRegionTemplateApi, type ExtractPreviewResult, type CedolinoParsedApi,
  type TemplateApi,
} from '../api/endpoints'
import { downloadDocx } from '../utils/docxDownloader'
import { showToast } from '../components/ToastManager'
import { ApiError } from '../api/client'

const todayIt = (): string => new Date().toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
const eur = (n: number | null): string =>
  n == null ? '—' : n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve((reader.result as string).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('Lettura file fallita'))
    reader.readAsDataURL(file)
  })
}

export default function PdfRegionTemplatesPage() {
  const { navigate, user } = useStore()
  const fileRef = useRef<HTMLInputElement>(null)

  const [regionTemplates, setRegionTemplates]   = useState<PdfRegionTemplateApi[]>([])
  const [regionTemplateId, setRegionTemplateId] = useState('')

  const [result, setResult]         = useState<ExtractPreviewResult | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [dragOver, setDragOver]     = useState(false)

  const [templates, setTemplates]   = useState<TemplateApi[]>([])
  const [templateId, setTemplateId] = useState('')
  const [sigla, setSigla]           = useState('')
  const [dirigente, setDirigente]   = useState('Alfonso Borgogni')
  const [dataRilascio, setDataRilascio]   = useState(todayIt())
  const [sessoOverride, setSessoOverride] = useState<'' | 'M' | 'F'>('')

  // ── carica template-estrazione attivi + template-certificato attivi ──
  useEffect(() => {
    pdfRegionTemplatesApi.list()
      .then(t => { setRegionTemplates(t); if (t[0]) setRegionTemplateId(prev => prev || t[0]!.id) })
      .catch(() => showToast('Impossibile caricare i template di estrazione', 'error'))
    templatiCertificatoApi.list(true)
      .then(t => { setTemplates(t); if (t[0]) setTemplateId(prev => prev || t[0]!.id) })
      .catch(() => showToast('Impossibile caricare i template certificato', 'error'))
  }, [])

  // ── estrazione PDF via template a regioni (nessuna persistenza) ────
  async function handleFile(file: File) {
    if (!regionTemplateId) { showToast('Seleziona un template di estrazione', 'error'); return }
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showToast('Seleziona un file PDF', 'error'); return
    }
    setExtracting(true); setResult(null)
    try {
      const base64 = await readFileAsBase64(file)
      const r = await pdfRegionTemplatesApi.extract(regionTemplateId, base64)
      setResult(r)
      if (r.errors.length > 0) showToast(`Estrazione completata con ${r.errors.length} errori da correggere`, 'error')
      else showToast('Cedolino analizzato', 'success')
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'ERRORE'
      showToast(`Estrazione fallita: ${code}`, 'error')
    } finally {
      setExtracting(false)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void handleFile(file)
  }

  // ── helpers editing anteprima (mirror CertificatiPage, su result.parsed) ──
  function setAnag(field: keyof CedolinoParsedApi['anagrafica'], value: string) {
    setResult(r => r ? { ...r, parsed: { ...r.parsed, anagrafica: { ...r.parsed.anagrafica, [field]: value } } } : r)
  }
  function setExtraRiga(idx: number, field: 'descrizione' | 'decorrenza' | 'scadenza', value: string) {
    setResult(r => {
      if (!r) return r
      const righe = r.parsed.certificato.extraerariali_righe.map((row, i) =>
        i === idx ? { ...row, [field]: value || null } : row)
      return { ...r, parsed: { ...r.parsed, certificato: { ...r.parsed.certificato, extraerariali_righe: righe } } }
    })
  }

  // ── genera ──────────────────────────────────────────────────
  async function handleGenera() {
    if (!result) return
    if (result.errors.length > 0) { showToast('Correggi gli errori in anteprima prima di generare', 'error'); return }
    if (!templateId) { showToast('Seleziona un template certificato', 'error'); return }
    if (!sigla.trim()) { showToast('Inserisci la sigla operatore', 'error'); return }
    setGenerating(true)
    try {
      const created = await certificatiApi.create({
        parsed: result.parsed,
        templateId,
        siglaOperatore: sigla.trim(),
        dirigente: dirigente.trim() || undefined,
        dataRilascio,
        ...(sessoOverride ? { sesso: sessoOverride } : {}),
      })
      downloadDocx(created.docx.base64, created.docx.filename)
      showToast(`Certificato ${created.protocollo} generato`, 'success')
      setResult(null)
      setSigla('')
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'ERRORE'
      showToast(`Generazione fallita: ${code}`, 'error')
    } finally {
      setGenerating(false)
    }
  }

  const cert = result?.parsed.certificato
  const ana  = result?.parsed.anagrafica

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">Certificati da PDF (estrazione a regioni)</h1>
          <p className="text-sm text-slate-500">Per cedolini in formati non coperti dal parser standard — estrazione guidata da template a regioni disegnate sul layout.</p>
        </div>
        {user?.isAdmin && (
          <button
            onClick={() => navigate('pdf-region-editor')}
            className="px-3 py-2 text-sm rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
          >
            Gestione template estrazione
          </button>
        )}
      </div>

      {/* Selezione template + upload */}
      {!result && (
        <div className="space-y-4">
          <label className="block bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <span className="text-xs text-slate-500">Template di estrazione</span>
            {regionTemplates.length === 0 ? (
              <p className="text-sm text-slate-600 mt-1">
                Nessun template disponibile
                {user?.isAdmin ? ' — creane uno dalla "Gestione template estrazione".' : ' — contatta un amministratore.'}
              </p>
            ) : (
              <select className="input mt-1" value={regionTemplateId} onChange={e => setRegionTemplateId(e.target.value)}>
                {regionTemplates.map(t => (
                  <option key={t.id} value={t.id}>{t.nome} — {t.versioneLabel}</option>
                ))}
              </select>
            )}
          </label>

          <div
            onDragOver={e => { e.preventDefault(); if (regionTemplateId) setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`rounded-xl border-2 border-dashed p-10 text-center transition-colors
              ${dragOver ? 'border-indigo-500 bg-indigo-500/5' : 'border-slate-700 bg-slate-900/40'}
              ${!regionTemplateId ? 'opacity-40 pointer-events-none' : ''}`}
          >
            <input
              ref={fileRef} type="file" accept="application/pdf" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = '' }}
            />
            <p className="text-slate-300 mb-2">Trascina qui il cedolino PDF</p>
            <p className="text-slate-600 text-sm mb-4">oppure</p>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={extracting || !regionTemplateId}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50"
            >
              {extracting ? 'Estrazione in corso…' : 'Scegli file'}
            </button>
          </div>
        </div>
      )}

      {/* Anteprima editabile */}
      {result && ana && cert && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-white font-medium">Anteprima dati estratti</h2>
            <button onClick={() => setResult(null)} className="text-sm text-slate-400 hover:text-white">
              Annulla / nuovo cedolino
            </button>
          </div>

          {/* Avvisi/errori estrazione (mirror banner ExtractPreviewResult) */}
          {result.errors.length > 0 && (
            <div className="rounded-lg border border-red-700/50 bg-red-600/10 p-3">
              <p className="text-sm font-medium text-red-300 mb-1">
                {result.errors.length === 1 ? '1 errore blocca' : `${result.errors.length} errori bloccano`} la generazione
              </p>
              <ul className="text-xs text-red-400/90 space-y-0.5 list-disc list-inside">
                {result.errors.map((e, i) => <li key={i}>{e.messaggio}</li>)}
              </ul>
            </div>
          )}
          {result.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-700/50 bg-amber-600/10 p-3">
              <p className="text-sm font-medium text-amber-300 mb-1">
                {result.warnings.length === 1 ? '1 avviso' : `${result.warnings.length} avvisi`}
              </p>
              <ul className="text-xs text-amber-400/90 space-y-0.5 list-disc list-inside">
                {result.warnings.map((w, i) => <li key={i}>{w.messaggio}</li>)}
              </ul>
            </div>
          )}

          {/* Anagrafica */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <Field label="Cognome"        value={ana.cognome ?? ''}        onChange={v => setAnag('cognome', v)} />
            <Field label="Nome"           value={ana.nome ?? ''}           onChange={v => setAnag('nome', v)} />
            <Field label="Codice fiscale" value={ana.codice_fiscale ?? ''} onChange={v => setAnag('codice_fiscale', v)} />
            <Field label="Data nascita"   value={ana.data_nascita ?? ''}   onChange={v => setAnag('data_nascita', v)} />
            <Field label="Luogo nascita"  value={ana.luogo_nascita ?? ''}  onChange={v => setAnag('luogo_nascita', v)} />
            <Field label="Inizio rapporto" value={ana.inizio_rapporto ?? ''} onChange={v => setAnag('inizio_rapporto', v)} />
            <Field label="Inquadramento"  value={ana.inquadramento ?? ''}  onChange={v => setAnag('inquadramento', v)} />
            <Field label="Periodo"        value={ana.periodo_retribuzione ?? ''} onChange={v => setAnag('periodo_retribuzione', v)} />
          </div>

          {/* Riepilogo certificato (calcolato) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Lordo teorico"   value={eur(cert.lordo_teorico)} />
            <Stat label="Rit. fiscali"    value={eur(cert.ritenute_fiscali)} />
            <Stat label="Rit. previd."    value={eur(cert.ritenute_previdenziali)} />
            <Stat label="Netto di legge"  value={eur(cert.netto_ritenute_legge)} accent />
            <Stat label="Extra-erariali"  value={eur(cert.extraerariali_totale)} />
            <Stat label="Netto a pagare"  value={eur(cert.netto_a_pagare)} accent />
            <Stat label="Quinto"          value={eur(cert.quinto)} />
            <Stat label="Settimo"         value={eur(cert.settimo)} />
          </div>

          {/* Extra-erariali editabili */}
          {cert.extraerariali_righe.length > 0 && (
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
              <p className="text-sm text-slate-400 mb-3">Ritenute extra-erariali (decorrenza/scadenza compilabili a mano)</p>
              <div className="space-y-2">
                {cert.extraerariali_righe.map((r, i) => (
                  <div key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <input className="sm:col-span-5 input" value={r.descrizione}
                      onChange={e => setExtraRiga(i, 'descrizione', e.target.value)} />
                    <input className="sm:col-span-3 input" placeholder="decorrenza" value={r.decorrenza ?? ''}
                      onChange={e => setExtraRiga(i, 'decorrenza', e.target.value)} />
                    <input className="sm:col-span-3 input" placeholder="scadenza" value={r.scadenza ?? ''}
                      onChange={e => setExtraRiga(i, 'scadenza', e.target.value)} />
                    <span className="sm:col-span-1 text-right text-sm text-slate-300">{eur(r.valore)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Form generazione */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-500">Template certificato</span>
              <select className="input mt-1" value={templateId} onChange={e => setTemplateId(e.target.value)}>
                {templates.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
            </label>
            <Field label="Sigla operatore" value={sigla} onChange={setSigla} />
            <Field label="Dirigente firmatario" value={dirigente} onChange={setDirigente} />
            <Field label="Data rilascio" value={dataRilascio} onChange={setDataRilascio} />
            <label className="block">
              <span className="text-xs text-slate-500">Genere (override)</span>
              <select className="input mt-1" value={sessoOverride} onChange={e => setSessoOverride(e.target.value as '' | 'M' | 'F')}>
                <option value="">Auto (da CF)</option>
                <option value="M">Maschile</option>
                <option value="F">Femminile</option>
              </select>
            </label>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleGenera}
              disabled={generating || result.errors.length > 0}
              className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50"
            >
              {generating ? 'Generazione…' : 'Genera DOCX e salva'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── sub-componenti (mirror CertificatiPage — duplicazione locale voluta) ──

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input className="input mt-1" value={value} onChange={e => onChange(e.target.value)} />
    </label>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? 'border-indigo-700/50 bg-indigo-600/10' : 'border-slate-800 bg-slate-900/50'}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-sm font-semibold ${accent ? 'text-indigo-300' : 'text-slate-200'}`}>{value}</p>
    </div>
  )
}
