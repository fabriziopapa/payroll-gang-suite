// ============================================================
// PAYROLL GANG SUITE — Editor template certificato (admin)
// CRUD su templati-certificato. La strutturaJson contiene testo statico,
// segnaposto {{path}}, tag genere [[m|f]], righe tabella e regole di matching.
// ============================================================

import { useEffect, useState, useCallback } from 'react'
import { useStore } from '../store/useStore'
import { templatiCertificatoApi, type TemplateApi } from '../api/endpoints'
import { showToast } from '../components/ToastManager'
import { ConfirmDialog } from '../components/ConfirmDialog'

const TEMPLATE_VUOTO = {
  bollo: { testo: 'MARCA DA BOLLO DA EURO 16,00\nASSOLTA TRAMITE BONIFICO' },
  intestazione: { protocollo: 'REG.TO AL N. {{protocollo}}', posizione: 'Pos: {{sigla_operatore}}/Stipendi' },
  titolo: 'Si certifica',
  corpo: ['che [[il Sig.|la Sig.ra]] {{anagrafica.cognome}} {{anagrafica.nome}}…'],
  tabellaEmolumenti: [
    { voce: 'Ritenute fiscali', segno: '(-)', src: 'cert.ritenute_fiscali' },
    { voce: 'Importo al netto delle ritenute di legge', segno: '(=)', src: 'cert.netto_ritenute_legge', bold: true },
  ],
  testoExtraerariali: 'su tale importo gravano le seguenti ritenute extra-erariali:',
  testoNetto: 'Per un importo netto a pagare di {{netto_pagare_label}}.',
  chiusura: 'Si rilascia per gli usi consentiti.',
  luogoData: 'Napoli, {{data_rilascio}}.',
  firma: ['Il Dirigente della Ripartizione', 'Economico Patrimoniale', '(dott. {{dirigente}})'],
  matchTeoriche: [{ field: 'stipendio', keywords: ['stipendio classe'] }],
  inquadramentoMap: {},
  extraRename: {},
}

export default function CertificatiTemplatePage() {
  const { navigate } = useStore()
  const [list, setList]   = useState<TemplateApi[]>([])
  const [selId, setSelId] = useState<string | null>(null)
  const [nome, setNome]   = useState('')
  const [attivo, setAttivo] = useState(true)
  const [jsonText, setJsonText] = useState('')
  const [jsonErr, setJsonErr]   = useState<string | null>(null)
  const [saving, setSaving]     = useState(false)
  const [toDelete, setToDelete] = useState<TemplateApi | null>(null)

  const refresh = useCallback(() => {
    templatiCertificatoApi.list()
      .then(setList)
      .catch(() => showToast('Caricamento template fallito', 'error'))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  function seleziona(t: TemplateApi) {
    setSelId(t.id)
    setNome(t.nome)
    setAttivo(t.attivo)
    setJsonText(JSON.stringify(t.strutturaJson, null, 2))
    setJsonErr(null)
  }

  function nuovo() {
    setSelId(null)
    setNome('Nuovo template')
    setAttivo(true)
    setJsonText(JSON.stringify(TEMPLATE_VUOTO, null, 2))
    setJsonErr(null)
  }

  function validaJson(text: string): unknown | null {
    try {
      const o = JSON.parse(text)
      setJsonErr(null)
      return o
    } catch (e) {
      setJsonErr((e as Error).message)
      return null
    }
  }

  async function salva() {
    const struttura = validaJson(jsonText)
    if (struttura === null) { showToast('JSON non valido', 'error'); return }
    if (!nome.trim()) { showToast('Inserisci un nome', 'error'); return }
    setSaving(true)
    try {
      if (selId) {
        await templatiCertificatoApi.update(selId, { nome: nome.trim(), strutturaJson: struttura, attivo })
        showToast('Template aggiornato', 'success')
      } else {
        const created = await templatiCertificatoApi.create(nome.trim(), struttura, attivo)
        setSelId(created.id)
        showToast('Template creato', 'success')
      }
      refresh()
    } catch {
      showToast('Salvataggio fallito', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function confermaElimina() {
    if (!toDelete) return
    try {
      await templatiCertificatoApi.delete(toDelete.id)
      showToast('Template eliminato', 'success')
      if (selId === toDelete.id) { setSelId(null); setJsonText('') }
      refresh()
    } catch {
      showToast('Eliminazione fallita', 'error')
    } finally {
      setToDelete(null)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Template certificato</h1>
          <p className="text-sm text-slate-500">Testo statico, segnaposto <code className="text-indigo-300">{'{{path}}'}</code>, tag genere <code className="text-indigo-300">[[m|f]]</code>.</p>
        </div>
        <button onClick={() => navigate('certificati')} className="text-sm text-slate-400 hover:text-white">← Certificati</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Lista */}
        <div className="space-y-2">
          <button onClick={nuovo} className="w-full px-3 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium">
            + Nuovo template
          </button>
          {list.map(t => (
            <div key={t.id}
              className={`rounded-lg border p-3 cursor-pointer transition-colors
                ${selId === t.id ? 'border-indigo-600 bg-indigo-600/10' : 'border-slate-800 bg-slate-900/50 hover:bg-slate-800/50'}`}
              onClick={() => seleziona(t)}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-slate-200 truncate">{t.nome}</span>
                {!t.attivo && <span className="text-xs text-slate-500">disatt.</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Editor */}
        <div className="md:col-span-2 space-y-3">
          {(selId !== null || jsonText) ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-slate-500">Nome</span>
                  <input className="input mt-1" value={nome} onChange={e => setNome(e.target.value)} />
                </label>
                <label className="flex items-end gap-2 pb-1">
                  <input type="checkbox" checked={attivo} onChange={e => setAttivo(e.target.checked)}
                    className="w-4 h-4 accent-indigo-600" />
                  <span className="text-sm text-slate-300">Attivo</span>
                </label>
              </div>

              <label className="block">
                <span className="text-xs text-slate-500">Struttura (JSON)</span>
                <textarea
                  className="input mt-1 font-mono text-xs h-96 leading-relaxed"
                  spellCheck={false}
                  value={jsonText}
                  onChange={e => { setJsonText(e.target.value); validaJson(e.target.value) }}
                />
              </label>
              {jsonErr && <p className="text-xs text-red-400">JSON: {jsonErr}</p>}

              <div className="flex items-center justify-between">
                {selId && (
                  <button onClick={() => { const t = list.find(x => x.id === selId); if (t) setToDelete(t) }}
                    className="text-sm text-red-400 hover:text-red-300">Elimina</button>
                )}
                <button onClick={salva} disabled={saving || !!jsonErr}
                  className="ml-auto px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50">
                  {saving ? 'Salvataggio…' : 'Salva'}
                </button>
              </div>
            </>
          ) : (
            <div className="text-slate-600 text-sm border border-dashed border-slate-800 rounded-xl p-10 text-center">
              Seleziona un template o creane uno nuovo.
            </div>
          )}
        </div>
      </div>

      {toDelete && (
        <ConfirmDialog
          open
          danger
          title="Elimina template"
          message={`Eliminare "${toDelete.nome}"? I certificati già emessi restano, ma non sarà più rigenerabile da questo template.`}
          confirmLabel="Elimina"
          onConfirm={confermaElimina}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  )
}
