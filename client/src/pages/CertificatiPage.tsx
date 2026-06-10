// ============================================================
// PAYROLL GANG SUITE — Pagina Certificati giuridico-stipendiali
// Flusso: upload PDF → anteprima editabile → form → genera DOCX → lista.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from '../store/useStore'
import {
  certificatiApi, templatiCertificatoApi,
  type CedolinoParsedApi, type CertificatoSummaryApi, type TemplateApi,
} from '../api/endpoints'
import { downloadDocx } from '../utils/docxDownloader'
import { showToast } from '../components/ToastManager'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ApiError } from '../api/client'
import { DEFAULT_BOLLO_OPZIONI } from '../types'

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

export default function CertificatiPage() {
  const { navigate, user, settings } = useStore()
  const fileRef = useRef<HTMLInputElement>(null)

  const [parsed, setParsed]       = useState<CedolinoParsedApi | null>(null)
  const [parsing, setParsing]     = useState(false)
  const [generating, setGenerating] = useState(false)
  const [dragOver, setDragOver]   = useState(false)

  const [templates, setTemplates] = useState<TemplateApi[]>([])
  const [templateId, setTemplateId] = useState('')
  const [sigla, setSigla]         = useState('')
  const [dirigente, setDirigente] = useState('Alfonso Borgogni')
  const [dataRilascio, setDataRilascio] = useState(todayIt())
  const [sessoOverride, setSessoOverride] = useState<'' | 'M' | 'F'>('')

  // Modalità assolvimento marca da bollo: lista da Impostazioni (modificabile
  // in autonomia), fallback al default storico se la lista è vuota/assente.
  const bolloOpzioni = settings.bolloOpzioni?.length ? settings.bolloOpzioni : DEFAULT_BOLLO_OPZIONI
  const [bolloIdx, setBolloIdx] = useState(0)
  // lista accorciata da Impostazioni → indice fuori range, rientra sul primo
  const bolloSel = bolloOpzioni[Math.min(bolloIdx, bolloOpzioni.length - 1)]!

  const annoCorrente = new Date().getFullYear()
  const [lista, setLista]   = useState<CertificatoSummaryApi[]>([])
  const [annoFiltro, setAnnoFiltro] = useState(annoCorrente)
  const [search, setSearch] = useState('')
  const [toDelete, setToDelete] = useState<CertificatoSummaryApi | null>(null)

  // ── carica template attivi + lista ─────────────────────────
  useEffect(() => {
    templatiCertificatoApi.list(true)
      .then(t => { setTemplates(t); if (t[0]) setTemplateId(prev => prev || t[0]!.id) })
      .catch(() => showToast('Impossibile caricare i template', 'error'))
  }, [])

  const refreshLista = useCallback(() => {
    certificatiApi.list(annoFiltro, search || undefined)
      .then(setLista)
      .catch(() => showToast('Impossibile caricare i certificati', 'error'))
  }, [annoFiltro, search])

  useEffect(() => { refreshLista() }, [refreshLista])

  // ── parse PDF ───────────────────────────────────────────────
  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showToast('Seleziona un file PDF', 'error'); return
    }
    setParsing(true); setParsed(null)
    try {
      const base64 = await readFileAsBase64(file)
      const result = await certificatiApi.parse(base64)
      setParsed(result)
      showToast('Cedolino analizzato', 'success')
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'ERRORE'
      showToast(`Analisi fallita: ${code}`, 'error')
    } finally {
      setParsing(false)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void handleFile(file)
  }

  // ── helpers editing anteprima ───────────────────────────────
  function setAnag(field: keyof CedolinoParsedApi['anagrafica'], value: string) {
    setParsed(p => p ? { ...p, anagrafica: { ...p.anagrafica, [field]: value } } : p)
  }
  function setExtraRiga(idx: number, field: 'descrizione' | 'decorrenza' | 'scadenza', value: string) {
    setParsed(p => {
      if (!p) return p
      const righe = p.certificato.extraerariali_righe.map((r, i) =>
        i === idx ? { ...r, [field]: value || null } : r)
      return { ...p, certificato: { ...p.certificato, extraerariali_righe: righe } }
    })
  }

  // ── genera ──────────────────────────────────────────────────
  async function handleGenera() {
    if (!parsed) return
    if (!templateId) { showToast('Seleziona un template', 'error'); return }
    if (!sigla.trim()) { showToast('Inserisci la sigla operatore', 'error'); return }
    setGenerating(true)
    try {
      const created = await certificatiApi.create({
        parsed,
        templateId,
        siglaOperatore: sigla.trim(),
        dirigente: dirigente.trim() || undefined,
        dataRilascio,
        ...(sessoOverride ? { sesso: sessoOverride } : {}),
        bolloTesto: bolloSel,
      })
      downloadDocx(created.docx.base64, created.docx.filename)
      showToast(`Certificato ${created.protocollo} generato`, 'success')
      setParsed(null)
      setSigla('')
      refreshLista()
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'ERRORE'
      showToast(`Generazione fallita: ${code}`, 'error')
    } finally {
      setGenerating(false)
    }
  }

  async function handleRigenera(id: string) {
    try {
      const docx = await certificatiApi.docx(id)
      downloadDocx(docx.base64, docx.filename)
    } catch {
      showToast('Rigenerazione fallita', 'error')
    }
  }

  async function confermaElimina() {
    if (!toDelete) return
    try {
      await certificatiApi.delete(toDelete.id)
      showToast(`Certificato ${toDelete.protocollo} eliminato`, 'success')
      refreshLista()
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'ERRORE'
      showToast(`Eliminazione fallita: ${code}`, 'error')
    } finally {
      setToDelete(null)
    }
  }

  const cert = parsed?.certificato
  const ana  = parsed?.anagrafica

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">Certificati</h1>
          <p className="text-sm text-slate-500">Genera certificati giuridico-stipendiali dai cedolini Cineca.</p>
        </div>
        {user?.isAdmin && (
          <button
            onClick={() => navigate('certificati-template')}
            className="px-3 py-2 text-sm rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
          >
            Gestione template
          </button>
        )}
      </div>

      {/* Upload */}
      {!parsed && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`rounded-xl border-2 border-dashed p-10 text-center transition-colors
            ${dragOver ? 'border-indigo-500 bg-indigo-500/5' : 'border-slate-700 bg-slate-900/40'}`}
        >
          <input
            ref={fileRef} type="file" accept="application/pdf" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = '' }}
          />
          <p className="text-slate-300 mb-2">Trascina qui il cedolino PDF</p>
          <p className="text-slate-600 text-sm mb-4">oppure</p>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={parsing}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50"
          >
            {parsing ? 'Analisi in corso…' : 'Scegli file'}
          </button>
        </div>
      )}

      {/* Anteprima editabile */}
      {parsed && ana && cert && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-white font-medium">Anteprima dati estratti</h2>
            <button onClick={() => setParsed(null)} className="text-sm text-slate-400 hover:text-white">
              Annulla / nuovo cedolino
            </button>
          </div>

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
              <span className="text-xs text-slate-500">Template</span>
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
            <label className="block sm:col-span-2">
              <span className="text-xs text-slate-500">Marca da bollo — modalità di assolvimento</span>
              <select className="input mt-1" value={Math.min(bolloIdx, bolloOpzioni.length - 1)}
                onChange={e => setBolloIdx(parseInt(e.target.value))}>
                {bolloOpzioni.map((o, i) => (
                  <option key={i} value={i}>{o.replace(/\n/g, ' — ')}</option>
                ))}
              </select>
              <span className="block mt-1 text-[11px] text-slate-600 whitespace-pre-line">{bolloSel}</span>
            </label>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleGenera}
              disabled={generating}
              className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50"
            >
              {generating ? 'Generazione…' : 'Genera DOCX e salva'}
            </button>
          </div>
        </div>
      )}

      {/* Lista certificati */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-white font-medium flex-1">Certificati emessi</h2>
          <input type="number" className="input w-24" value={annoFiltro}
            onChange={e => setAnnoFiltro(parseInt(e.target.value) || annoCorrente)} />
          <input className="input w-48" placeholder="Cerca matricola/nominativo"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
          {lista.length === 0 ? (
            <p className="text-slate-600 text-sm p-4 text-center">Nessun certificato per l'anno {annoFiltro}.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-slate-500 text-xs border-b border-slate-800">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Protocollo</th>
                  <th className="text-left font-medium px-4 py-2">Nominativo</th>
                  <th className="text-left font-medium px-4 py-2">Periodo</th>
                  <th className="text-left font-medium px-4 py-2">Op.</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {lista.map(c => (
                  <tr key={c.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30">
                    <td className="px-4 py-2 font-mono text-indigo-300">{c.protocollo}</td>
                    <td className="px-4 py-2 text-slate-200">{c.nominativo ?? '—'}</td>
                    <td className="px-4 py-2 text-slate-400">{c.periodo ?? '—'}</td>
                    <td className="px-4 py-2 text-slate-400">{c.siglaOperatore}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button onClick={() => handleRigenera(c.id)}
                        className="text-xs text-indigo-400 hover:text-indigo-300">Scarica DOCX</button>
                      {user?.isAdmin && (
                        <button onClick={() => setToDelete(c)}
                          className="ml-3 text-xs text-red-400 hover:text-red-300">Elimina</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {toDelete && (
        <ConfirmDialog
          open
          danger
          title="Elimina certificato"
          message={`Eliminare definitivamente il certificato ${toDelete.protocollo} (${toDelete.nominativo ?? '—'})? Il progressivo dell'anno viene risincronizzato: se elimini gli ultimi emessi, il contatore scala di conseguenza. Operazione irreversibile.`}
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

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? 'border-indigo-700/50 bg-indigo-600/10' : 'border-slate-800 bg-slate-900/50'}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-sm font-semibold ${accent ? 'text-indigo-300' : 'text-slate-200'}`}>{value}</p>
    </div>
  )
}
