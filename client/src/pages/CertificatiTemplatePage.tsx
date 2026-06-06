// ============================================================
// PAYROLL GANG SUITE — Editor template certificato (admin)
// CRUD su templati-certificato. La strutturaJson è un "template-come-dato"
// (CertificatoTemplate): testo statico, segnaposto {{path}}, tag genere
// [[m|f]], righe tabella emolumenti e regole di matching/abbreviazione.
//
// Form A SEZIONI (non più JSON grezzo): chi non conosce il formato JSON
// può comunque comporre un template completo — ogni sezione mappa 1:1 un
// gruppo di campi di CertificatoTemplate, e lo stato del form è SEMPRE un
// CertificatoTemplate completo e tipizzato (vedi normalizzaTemplate, che
// "ripara" anche righe legacy/incomplete caricate dal DB riempiendo i
// campi mancanti coi default — niente più crash a runtime in generazione
// DOCX per chiavi assenti, vedi services/certificato/merge.ts).
// ============================================================

import { useEffect, useState, useCallback, useRef } from 'react'
import { useStore } from '../store/useStore'
import { templatiCertificatoApi, type TemplateApi } from '../api/endpoints'
import { ApiError } from '../api/client'
import { showToast } from '../components/ToastManager'
import { ConfirmDialog } from '../components/ConfirmDialog'
import type { CertificatoTemplate, RigaEmolumento, MatchTeorica } from '../types'
import ArrayStringEditor from '../components/certificatoTemplate/ArrayStringEditor'
import KeyValueMapEditor from '../components/certificatoTemplate/KeyValueMapEditor'
import MatchTeoricheEditor from '../components/certificatoTemplate/MatchTeoricheEditor'
import TabellaEmolumentiEditor from '../components/certificatoTemplate/TabellaEmolumentiEditor'
import PlaceholderPalette from '../components/certificatoTemplate/PlaceholderPalette'

const TEMPLATE_VUOTO: CertificatoTemplate = {
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

// ── Normalizzazione difensiva ────────────────────────────────────────
// Un template caricato da DB può essere incompleto/malformato (righe
// create prima della validazione stretta lato server, o via accesso
// diretto al DB bypassando questa pagina). Qui ricostruiamo SEMPRE un
// CertificatoTemplate completo, con TEMPLATE_VUOTO come fallback
// campo-per-campo: aprire un template "rotto" in editor lo ripara, e
// basta Salvare per metterlo in regola.

function asObj(v: unknown): Record<string, unknown> {
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v as Record<string, unknown> : {}
}
function asStr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}
function asStrArray(v: unknown, fallback: string[]): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [...fallback]
}
function asStringMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(asObj(v))) if (typeof val === 'string') out[k] = val
  return out
}
function asRighe(v: unknown, fallback: RigaEmolumento[]): RigaEmolumento[] {
  if (!Array.isArray(v)) return fallback.map(r => ({ ...r }))
  return v.flatMap((x): RigaEmolumento[] => {
    const o = asObj(x)
    if (typeof o.voce !== 'string' || typeof o.segno !== 'string' || typeof o.src !== 'string') return []
    const r: RigaEmolumento = { voce: o.voce, segno: o.segno, src: o.src }
    if (typeof o.bold === 'boolean') r.bold = o.bold
    return [r]
  })
}
function asMatchTeoriche(v: unknown, fallback: MatchTeorica[]): MatchTeorica[] {
  if (!Array.isArray(v)) return fallback.map(r => ({ field: r.field, keywords: [...r.keywords] }))
  return v.flatMap((x): MatchTeorica[] => {
    const o = asObj(x)
    if (typeof o.field !== 'string' || !Array.isArray(o.keywords)) return []
    return [{ field: o.field, keywords: o.keywords.filter((k): k is string => typeof k === 'string') }]
  })
}

/** Ricostruisce un CertificatoTemplate completo da un valore arbitrario (JSONB legacy incluso). */
function normalizzaTemplate(raw: unknown): CertificatoTemplate {
  const r   = asObj(raw)
  const bol = asObj(r.bollo)
  const int_ = asObj(r.intestazione)
  return {
    bollo:        { testo: asStr(bol.testo, TEMPLATE_VUOTO.bollo.testo) },
    intestazione: {
      protocollo: asStr(int_.protocollo, TEMPLATE_VUOTO.intestazione.protocollo),
      posizione:  asStr(int_.posizione,  TEMPLATE_VUOTO.intestazione.posizione),
    },
    titolo:             asStr(r.titolo, TEMPLATE_VUOTO.titolo),
    corpo:              asStrArray(r.corpo, TEMPLATE_VUOTO.corpo),
    tabellaEmolumenti:  asRighe(r.tabellaEmolumenti, TEMPLATE_VUOTO.tabellaEmolumenti),
    testoExtraerariali: asStr(r.testoExtraerariali, TEMPLATE_VUOTO.testoExtraerariali),
    testoNetto:         asStr(r.testoNetto, TEMPLATE_VUOTO.testoNetto),
    chiusura:           asStr(r.chiusura, TEMPLATE_VUOTO.chiusura),
    luogoData:          asStr(r.luogoData, TEMPLATE_VUOTO.luogoData),
    firma:              asStrArray(r.firma, TEMPLATE_VUOTO.firma),
    matchTeoriche:      asMatchTeoriche(r.matchTeoriche, TEMPLATE_VUOTO.matchTeoriche),
    inquadramentoMap:   asStringMap(r.inquadramentoMap),
    extraRename:        asStringMap(r.extraRename),
  }
}

const SEZ_TITLE = 'text-sm font-semibold text-white'
const SEZ_HINT  = 'text-slate-400 text-xs'

export default function CertificatiTemplatePage() {
  const { navigate } = useStore()
  const [list, setList]       = useState<TemplateApi[]>([])
  const [selId, setSelId]     = useState<string | null>(null)
  const [aperto, setAperto]   = useState(false)
  const [formKey, setFormKey] = useState(0)
  const [nome, setNome]       = useState('')
  const [attivo, setAttivo]   = useState(true)
  const [draft, setDraft]     = useState<CertificatoTemplate>(TEMPLATE_VUOTO)
  const [saving, setSaving]   = useState(false)
  const [toDelete, setToDelete] = useState<TemplateApi | null>(null)
  // Flag "vedi/modifica JSON": per chi preferisce intervenire a mano sul JSON
  // della struttura invece che dal form a sezioni. jsonText è editabile in
  // chiaro; ad ogni modifica valida viene riversata in `draft` (normalizzata),
  // così Salva e il passaggio al form a sezioni vedono sempre l'ultima versione.
  const [modoJson, setModoJson] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [jsonErr, setJsonErr]   = useState<string | null>(null)
  /** Contenitore delle sezioni-campo del template — la palette segnaposto traccia
   *  i focus al suo interno per sapere dove inserire {{path}} / [[m|f]]. */
  const fieldsRef = useRef<HTMLDivElement>(null)

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
    setDraft(normalizzaTemplate(t.strutturaJson))
    setAperto(true)
    setFormKey(k => k + 1)   // rimonta le sezioni: stato locale "pulito" sul nuovo contesto
  }

  function nuovo() {
    setSelId(null)
    setNome('Nuovo template')
    setAttivo(true)
    setDraft(structuredClone(TEMPLATE_VUOTO))
    setAperto(true)
    setFormKey(k => k + 1)
  }

  function patch<K extends keyof CertificatoTemplate>(key: K, value: CertificatoTemplate[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  async function salva() {
    if (!nome.trim()) { showToast('Inserisci un nome', 'error'); return }
    setSaving(true)
    try {
      if (selId) {
        await templatiCertificatoApi.update(selId, { nome: nome.trim(), strutturaJson: draft, attivo })
        showToast('Template aggiornato', 'success')
      } else {
        const created = await templatiCertificatoApi.create(nome.trim(), draft, attivo)
        setSelId(created.id)
        showToast('Template creato', 'success')
      }
      refresh()
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'ERRORE'
      showToast(code === 'VALIDATION_ERROR'
        ? 'Dati non validi: controlla i campi obbligatori (titolo, righe tabella emolumenti, regole…)'
        : `Salvataggio fallito: ${code}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function confermaElimina() {
    if (!toDelete) return
    try {
      await templatiCertificatoApi.delete(toDelete.id)
      showToast('Template eliminato', 'success')
      if (selId === toDelete.id) { setSelId(null); setAperto(false) }
      refresh()
    } catch {
      showToast('Eliminazione fallita', 'error')
    } finally {
      setToDelete(null)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Template certificato</h1>
          <p className="text-sm text-slate-500 max-w-2xl">
            Componi il certificato a sezioni: testo statico, segnaposto <code className="text-indigo-300">{'{{path}}'}</code>{' '}
            e tag genere <code className="text-indigo-300">[[per lui|per lei]]</code> si scrivono direttamente nei campi qui sotto —
            non serve conoscere il JSON.
          </p>
        </div>
        <button onClick={() => navigate('certificati')} className="text-sm text-slate-400 hover:text-white shrink-0 ml-4">← Certificati</button>
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

        {/* Editor a sezioni */}
        <div className="md:col-span-2 space-y-4">
          {aperto ? (
            <div key={formKey} className="space-y-4">
              {/* Nome + attivo */}
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

              <PlaceholderPalette containerRef={fieldsRef} />

              {/* Sezioni-campo: la palette traccia i focus qui dentro per l'inserimento */}
              <div ref={fieldsRef} className="space-y-4">

              {/* ── Testata: bollo, protocollo/posizione, titolo ─────── */}
              <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                <div>
                  <h3 className={SEZ_TITLE}>Testata del documento</h3>
                  <p className={SEZ_HINT}>Marca da bollo, riquadro protocollo/posizione e titolo iniziale.</p>
                </div>
                <label className="block">
                  <span className="text-xs text-slate-500">Testo marca da bollo</span>
                  <textarea rows={2} className="input mt-1 text-sm"
                    value={draft.bollo.testo}
                    onChange={e => patch('bollo', { testo: e.target.value })} />
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs text-slate-500">Riquadro protocollo</span>
                    <input className="input mt-1 text-sm" value={draft.intestazione.protocollo}
                      onChange={e => patch('intestazione', { ...draft.intestazione, protocollo: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="text-xs text-slate-500">Riquadro posizione</span>
                    <input className="input mt-1 text-sm" value={draft.intestazione.posizione}
                      onChange={e => patch('intestazione', { ...draft.intestazione, posizione: e.target.value })} />
                  </label>
                </div>
                <label className="block">
                  <span className="text-xs text-slate-500">Titolo</span>
                  <input className="input mt-1 text-sm" value={draft.titolo}
                    onChange={e => patch('titolo', e.target.value)} />
                </label>
              </section>

              {/* ── Corpo ────────────────────────────────────────────── */}
              <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                <div>
                  <h3 className={SEZ_TITLE}>Corpo del certificato</h3>
                  <p className={SEZ_HINT}>Un paragrafo per riga, nell'ordine in cui compaiono nel documento.</p>
                </div>
                <ArrayStringEditor
                  label="Paragrafi"
                  hint="Usa {{anagrafica.cognome}}, {{anagrafica.nome}}, [[il Sig.|la Sig.ra]] ecc. — palette segnaposto in fondo alla pagina."
                  value={draft.corpo}
                  onChange={v => patch('corpo', v)}
                  multiline
                  rows={3}
                  placeholder="es. che [[il Sig.|la Sig.ra]] {{anagrafica.cognome}} {{anagrafica.nome}}…"
                  addLabel="Aggiungi paragrafo"
                />
              </section>

              {/* ── Tabella emolumenti ───────────────────────────────── */}
              <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                <div>
                  <h3 className={SEZ_TITLE}>Tabella emolumenti</h3>
                  <p className={SEZ_HINT}>
                    Ogni riga: etichetta, segno (visualizzato) e sorgente del valore — <code className="text-indigo-300">teo.&lt;campo&gt;</code> (voce
                    teorica riconosciuta dalle regole più sotto) oppure <code className="text-indigo-300">cert.&lt;campo&gt;</code> (dato diretto dal cedolino).
                  </p>
                </div>
                <TabellaEmolumentiEditor
                  label="Righe"
                  value={draft.tabellaEmolumenti}
                  onChange={v => patch('tabellaEmolumenti', v)}
                />
              </section>

              {/* ── Testi finali e firma ─────────────────────────────── */}
              <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                <div>
                  <h3 className={SEZ_TITLE}>Testi finali e firma</h3>
                  <p className={SEZ_HINT}>Chiusura del documento: introduzione extra-erariali, importo netto, formula di chiusura, luogo/data e righe firma.</p>
                </div>
                <label className="block">
                  <span className="text-xs text-slate-500">Introduzione tabella extra-erariali</span>
                  <textarea rows={2} className="input mt-1 text-sm" value={draft.testoExtraerariali}
                    onChange={e => patch('testoExtraerariali', e.target.value)} />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">Frase importo netto</span>
                  <textarea rows={2} className="input mt-1 text-sm" value={draft.testoNetto}
                    onChange={e => patch('testoNetto', e.target.value)} />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">Formula di chiusura</span>
                  <textarea rows={2} className="input mt-1 text-sm" value={draft.chiusura}
                    onChange={e => patch('chiusura', e.target.value)} />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">Luogo e data</span>
                  <input className="input mt-1 text-sm" value={draft.luogoData}
                    onChange={e => patch('luogoData', e.target.value)} />
                </label>
                <ArrayStringEditor
                  label="Righe firma"
                  hint="Una riga per ciascuna riga della firma, nell'ordine di stampa."
                  value={draft.firma}
                  onChange={v => patch('firma', v)}
                  placeholder="es. Il Dirigente della Ripartizione"
                  addLabel="Aggiungi riga firma"
                />
              </section>

              {/* ── Regole dati e abbreviazioni ──────────────────────── */}
              <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
                <div>
                  <h3 className={SEZ_TITLE}>Regole dati e abbreviazioni</h3>
                  <p className={SEZ_HINT}>Configurano come il certificato deriva e rinomina automaticamente i dati letti dal cedolino.</p>
                </div>

                <MatchTeoricheEditor
                  label="Riconoscimento voci teoriche"
                  hint='Associa parole chiave nella descrizione di una voce teorica del cedolino a un campo "teo.<campo>" — riusabile in segnaposto e come "src" nella tabella emolumenti.'
                  value={draft.matchTeoriche}
                  onChange={v => patch('matchTeoriche', v)}
                />

                <div className="border-t border-slate-800 pt-4">
                  <KeyValueMapEditor
                    label="Etichette per inquadramento"
                    hint='Traduce il valore grezzo di INQUADR/RUOLO (es. "Area dei Collaboratori") nell&rsquo;etichetta da mostrare nel certificato — chiave mancante = mostrato il valore grezzo.'
                    value={draft.inquadramentoMap}
                    onChange={v => patch('inquadramentoMap', v)}
                    keyPlaceholder="valore grezzo (es. Area dei Collaboratori)"
                    valuePlaceholder="etichetta da mostrare"
                  />
                </div>

                <div className="border-t border-slate-800 pt-4">
                  <KeyValueMapEditor
                    label="Rinomina voci extra-erariali"
                    hint="Sostituisce l'etichetta grezza di una trattenuta extra-erariale (dopo la pulizia automatica) con un nome più leggibile — chiave mancante = mostrata l'etichetta pulita."
                    value={draft.extraRename}
                    onChange={v => patch('extraRename', v)}
                    keyPlaceholder="etichetta grezza pulita"
                    valuePlaceholder="nome da mostrare"
                  />
                </div>
              </section>

              </div>{/* /fieldsRef */}

              <div className="flex items-center justify-between pt-1">
                {selId && (
                  <button onClick={() => { const t = list.find(x => x.id === selId); if (t) setToDelete(t) }}
                    className="text-sm text-red-400 hover:text-red-300">Elimina</button>
                )}
                <button onClick={salva} disabled={saving}
                  className="ml-auto px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50">
                  {saving ? 'Salvataggio…' : 'Salva'}
                </button>
              </div>
            </div>
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
