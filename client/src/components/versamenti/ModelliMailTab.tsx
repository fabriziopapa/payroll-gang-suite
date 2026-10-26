// ============================================================
// PAYROLL GANG SUITE — Versamenti enti · Modelli mail
//
// Piu' messaggi predefiniti: ognuno ha nome, oggetto, testo con segnaposto
// e la sua configurazione degli allegati. Uno e' il predefinito (vale per
// gli enti senza modello in rubrica).
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { versamentiApi, type VersamentoEnteApi } from '../../api/endpoints'
import { showToast } from '../ToastManager'
import { ConfirmDialog } from '../ConfirmDialog'
import type { EnteAggregato } from '../../utils/versamentiCsv'
import {
  COLDEF, allegatiDefault, allegatiPer, csvTesto, nomeFile, type AllegatiConfig, type ColonnaAllegato,
} from '../../utils/versamentiAllegati'
import {
  FIRMA_UFFICIO, SEGNAPOSTO, SEGNAPOSTO_FILE, SEGNAPOSTO_TESTO, SEGNAPOSTO_TITOLO,
  applica, contesto, periodoFile, segnapostoIgnoti, type ModelloVersamento,
} from '../../utils/versamentiModelli'
import { scaricaFile } from '../../utils/versamentiEml'
import { IconaDownload, Pill, btnPiccolo, btnPrimario, btnSecondario, cardCls, etichettaCls, inputCls, messaggioErrore } from './ui'

interface Bozza {
  id:       string | null
  nome:     string
  oggetto:  string
  testo:    string
  allegati: AllegatiConfig
}
const firma = (b: Pick<Bozza, 'nome' | 'oggetto' | 'testo' | 'allegati'>) => JSON.stringify([b.nome, b.oggetto, b.testo, b.allegati])
const daModello = (m: ModelloVersamento): Bozza => ({ id: m.id, nome: m.nome, oggetto: m.oggetto, testo: m.testo, allegati: structuredClone(m.allegati) })

export default function ModelliMailTab({ modelli, enti, esempio, onRicarica, onEntiCambiati }: {
  modelli:        ModelloVersamento[]
  enti:           VersamentoEnteApi[]
  esempio:        { a: EnteAggregato; descr: string } | null
  onRicarica:     () => Promise<void>
  onEntiCambiati: () => void
}) {
  const predefinito = modelli.find(m => m.predefinito) ?? modelli[0]
  const [sel, setSel] = useState<string | null>(predefinito?.id ?? null)
  const [bozza, setBozza] = useState<Bozza | null>(null)
  const [busy, setBusy] = useState(false)
  const [conferma, setConferma] = useState(false)
  const ultimoCampo = useRef<'oggetto' | 'testo'>('testo')
  const refOggetto = useRef<HTMLInputElement>(null)
  const refTesto = useRef<HTMLTextAreaElement>(null)

  const originale = sel ? modelli.find(m => m.id === sel) ?? null : null
  useEffect(() => {
    if (sel === null && predefinito) { setSel(predefinito.id); return }
    if (originale && bozza?.id !== originale.id) setBozza(daModello(originale))
  }, [sel, originale, predefinito, bozza?.id])

  const usati = (id: string) => enti.filter(e => (e.modelloId ?? predefinito?.id) === id).length

  function nuovo(copiaDa?: Bozza) {
    setSel('nuovo')
    setBozza(copiaDa
      ? { ...structuredClone(copiaDa), id: null, nome: `Copia di ${copiaDa.nome}`.slice(0, 80) }
      : { id: null, nome: 'Nuovo modello', oggetto: 'Dettagli versamento trattenute mensili -  {DESCRIZIONE_ENTE}',
          testo: `Spett.le {DESCRIZIONE_ENTE},\n\n\n\n\n${FIRMA_UFFICIO}`, allegati: allegatiDefault() })
  }

  const errori = useMemo(() => {
    if (!bozza) return []
    const a = bozza.allegati, e: string[] = []
    const ig = [...segnapostoIgnoti(`${bozza.oggetto}\n${bozza.testo}`, SEGNAPOSTO_TESTO), ...segnapostoIgnoti(a.pdf.titolo, SEGNAPOSTO_TITOLO)]
    if (ig.length) e.push(`Segnaposto sconosciuti: ${[...new Set(ig)].map(k => `{${k}}`).join(', ')}. Usa solo quelli elencati, in maiuscolo.`)
    const igF = segnapostoIgnoti(`${a.nomeEml}\n${a.nomeAllegati}`, SEGNAPOSTO_FILE)
    if (igF.length) e.push(`Nei nomi dei file sono ammessi solo {CODICE_ENTE} e {PERIODO_FILE}: togli ${igF.map(k => `{${k}}`).join(', ')}.`)
    if ((a.csv.attivo || a.pdf.attivo) && !a.colonne.some(c => c.on)) e.push('Scegli almeno una colonna per gli allegati, oppure togli CSV e PDF.')
    if (!bozza.nome.trim() || !bozza.oggetto.trim() || !bozza.testo.trim() || !a.nomeEml.trim() || !a.nomeAllegati.trim()) {
      e.push('Nome, oggetto, testo e nomi dei file sono obbligatori.')
    }
    return e
  }, [bozza])

  if (!bozza) return <p className="text-sm text-slate-500">Nessun modello.</p>
  const sporco = !bozza.id || !originale || firma(bozza) !== firma(originale)
  const set = (patch: Partial<Bozza>) => setBozza(b => (b ? { ...b, ...patch } : b))
  const setAll = (a: AllegatiConfig) => set({ allegati: a })

  function inserisci(k: string) {
    const el = ultimoCampo.current === 'oggetto' ? refOggetto.current : refTesto.current
    const campo = ultimoCampo.current
    if (!el || !bozza) return
    const ins = `{${k}}`
    const v = bozza[campo], a = el.selectionStart ?? v.length, z = el.selectionEnd ?? a
    set({ [campo]: v.slice(0, a) + ins + v.slice(z) } as Partial<Bozza>)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + ins.length, a + ins.length) })
  }

  async function salva() {
    if (!bozza) return
    setBusy(true)
    try {
      const body = { nome: bozza.nome.trim(), oggetto: bozza.oggetto, testo: bozza.testo, allegati: bozza.allegati }
      const { modello } = bozza.id ? await versamentiApi.aggiornaModello(bozza.id, body) : await versamentiApi.creaModello(body)
      await onRicarica()
      setBozza(null); setSel(modello.id)
      showToast(`Modello «${modello.nome}» salvato`, 'success')
    } catch (err) { showToast(messaggioErrore(err), 'error') }
    finally { setBusy(false) }
  }

  async function rendiPredefinito() {
    if (!bozza?.id) return
    setBusy(true)
    try {
      const { modello } = await versamentiApi.predefinito(bozza.id)
      await onRicarica()
      showToast(`«${modello.nome}» è ora il predefinito`, 'success')
    } catch (err) { showToast(messaggioErrore(err), 'error') }
    finally { setBusy(false) }
  }

  async function elimina() {
    if (!bozza?.id) return
    setConferma(false); setBusy(true)
    try {
      const { entiRiportati } = await versamentiApi.eliminaModello(bozza.id)
      await onRicarica(); onEntiCambiati()
      setBozza(null); setSel(null)
      showToast(`Modello eliminato${entiRiportati ? `: ${entiRiportati} enti tornano al predefinito` : ''}`, 'success')
    } catch (err) { showToast(messaggioErrore(err), 'error') }
    finally { setBusy(false) }
  }

  async function prova(tipo: 'csv' | 'pdf') {
    if (!esempio || !bozza) return
    const [x] = await allegatiPer(esempio.a.codice, esempio.descr, esempio.a.righe, esempio.a.mesi, bozza.allegati, false, tipo, esempio.a.periodo)
    if (x) scaricaFile(x.nome, x.bytes, x.tipo)
  }

  const ctx = esempio ? contesto(esempio.a.codice, esempio.descr, esempio.a.righe, esempio.a.periodo) : null
  const a = bozza.allegati
  const isPred = !!originale?.predefinito

  return (
    <div className="grid lg:grid-cols-[300px_1fr] gap-6 items-start">
      <div className="flex flex-col gap-2">
        {modelli.map(m => (
          <button key={m.id} type="button" onClick={() => { setBozza(null); setSel(m.id) }}
            className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${m.id === sel ? 'bg-indigo-600/15 border-indigo-500/70' : 'bg-slate-900 border-slate-800 hover:bg-slate-800/60'}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-medium ${m.id === sel ? 'text-indigo-200' : 'text-slate-200'}`}>{m.nome}</span>
              {m.predefinito && <Pill tono="ok">Predefinito</Pill>}
            </div>
            <p className="text-xs text-slate-500 mt-1 truncate">{m.oggetto}</p>
            <p className="text-[11px] text-slate-500 mt-1">usato da {usati(m.id)} enti</p>
          </button>
        ))}
        {sel === 'nuovo' && (
          <div className="px-4 py-3 rounded-lg border bg-indigo-600/15 border-indigo-500/70 text-sm text-indigo-200">{bozza.nome} <span className="text-xs text-amber-300">(non salvato)</span></div>
        )}
        <div className="flex gap-2 mt-1">
          <button type="button" className={`${btnSecondario} flex-1 justify-center`} onClick={() => nuovo()}>+ Nuovo</button>
          <button type="button" className={`${btnSecondario} flex-1 justify-center`} onClick={() => nuovo(bozza)}>Duplica</button>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Un ente senza modello in rubrica usa il <span className="text-emerald-300">predefinito</span>. Il modello di ogni ente si sceglie in
          «Rubrica enti»; in «Elaborazione» si può usare un modello per tutti, o cambiarlo per un solo ente dall'anteprima.
        </p>
      </div>

      <div className={`${cardCls} overflow-hidden`}>
        <div className="px-5 py-3.5 border-b border-slate-800 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-white">{bozza.id ? 'Modifica modello' : 'Nuovo modello'}</h3>
          {sporco && <span className="text-xs bg-amber-900/50 text-amber-400 border border-amber-800 px-1.5 py-0.5 rounded-full">Non salvato</span>}
          <div className="flex-1" />
          {bozza.id && !isPred && (
            <>
              <button type="button" disabled={busy || sporco} title={sporco ? 'Salva prima le modifiche' : ''} onClick={() => void rendiPredefinito()}
                className={`${btnPiccolo} bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700`}>Imposta come predefinito</button>
              <button type="button" disabled={busy} onClick={() => setConferma(true)}
                className={`${btnPiccolo} text-red-400 border border-red-900 hover:bg-red-950/40`}>Elimina</button>
            </>
          )}
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="vm-nome" className={etichettaCls}>Nome del modello</label>
            <input id="vm-nome" value={bozza.nome} maxLength={80} onChange={e => set({ nome: e.target.value })} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="vm-oggetto" className={etichettaCls}>Oggetto</label>
            <input id="vm-oggetto" ref={refOggetto} value={bozza.oggetto} maxLength={200}
              onFocus={() => { ultimoCampo.current = 'oggetto' }} onChange={e => set({ oggetto: e.target.value })} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="vm-testo" className={etichettaCls}>Testo</label>
            <textarea id="vm-testo" ref={refTesto} rows={13} value={bozza.testo} maxLength={8000}
              onFocus={() => { ultimoCampo.current = 'testo' }} onChange={e => set({ testo: e.target.value })}
              className={`${inputCls} leading-relaxed`} style={{ fontFamily: 'Calibri, Inter, Arial, sans-serif' }} />
          </div>
          <div className="flex flex-col gap-2">
            <span className={etichettaCls}>Inserisci un segnaposto (va nel campo dove si trova il cursore)</span>
            <div className="flex flex-wrap gap-1.5">
              {SEGNAPOSTO.map(s => (
                <button key={s.k} type="button" title={s.descr} onMouseDown={e => e.preventDefault()} onClick={() => inserisci(s.k)}
                  className="font-mono text-[11px] px-2 py-1 rounded border bg-cyan-900/30 text-cyan-300 border-cyan-800 hover:bg-cyan-900/60">{`{${s.k}}`}</button>
              ))}
            </div>
          </div>

          <EditorAllegati a={a} onChange={setAll} />

          {errori.map(t => <div key={t} className="border border-red-800 bg-red-950/40 rounded-lg px-4 py-2.5 text-sm text-red-300">{t}</div>)}
          {a.colonne.some(c => c.on && COLDEF[c.k].pii) && (a.csv.attivo || a.pdf.attivo) && (
            <div className="border border-amber-800 bg-amber-950/30 rounded-lg px-4 py-2.5 text-sm text-amber-300">
              Gli allegati conterranno il codice fiscale. Usa questo modello solo per gli enti che lo richiedono.
            </div>
          )}
          <div className="flex flex-wrap gap-2 justify-end">
            <button type="button" className={btnSecondario} disabled={!sporco || busy}
              onClick={() => { if (originale) setBozza(daModello(originale)); else { setBozza(null); setSel(null) } }}>Annulla modifiche</button>
            <button type="button" className={btnPrimario} disabled={!sporco || errori.length > 0 || busy} onClick={() => void salva()}>
              {busy ? 'Salvo…' : 'Salva modello'}
            </button>
          </div>
        </div>

        <div className="border-t border-slate-800 p-5 flex flex-col gap-3">
          <p className={etichettaCls}>Anteprima {esempio ? <>con <span className="normal-case tracking-normal text-slate-300">{esempio.descr}</span></> : '(carica un file per vederla con un ente vero)'}</p>
          <div className="bg-white text-slate-900 rounded-lg overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-200 text-sm"><span className="text-slate-500">Oggetto:</span> <b>{ctx ? applica(bozza.oggetto, ctx) : bozza.oggetto}</b></div>
            <pre className="p-4 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ fontFamily: 'Calibri, Arial, sans-serif' }}>{ctx ? applica(bozza.testo, ctx) : bozza.testo}</pre>
          </div>
          {esempio && (
            <>
              <p className={etichettaCls}>File generati</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  nomeFile(a.nomeEml, { CODICE_ENTE: esempio.a.codice, PERIODO_FILE: periodoFile(esempio.a.periodo) }, 'eml', false),
                  ...(a.csv.attivo ? [nomeFile(a.nomeAllegati, { CODICE_ENTE: esempio.a.codice, PERIODO_FILE: periodoFile(esempio.a.periodo) }, 'csv', false)] : []),
                  ...(a.pdf.attivo ? [nomeFile(a.nomeAllegati, { CODICE_ENTE: esempio.a.codice, PERIODO_FILE: periodoFile(esempio.a.periodo) }, 'pdf', false)] : []),
                ].map(n => <span key={n} className="font-mono text-xs px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-200">{n}</span>)}
              </div>
              {a.csv.attivo && a.colonne.some(c => c.on) && (
                <>
                  <p className={etichettaCls}>Prime righe del CSV</p>
                  <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] font-mono text-slate-300 overflow-auto">
                    {csvTesto(esempio.a.righe, a, esempio.a.mesi.length > 1).split('\r\n').slice(0, 6).join('\n')}
                  </pre>
                </>
              )}
              <div className="flex flex-wrap gap-2">
                {a.csv.attivo && a.colonne.some(c => c.on) && <button type="button" className={`${btnSecondario} !text-xs`} onClick={() => void prova('csv')}><IconaDownload /> CSV di prova</button>}
                {a.pdf.attivo && a.colonne.some(c => c.on) && <button type="button" className={`${btnSecondario} !text-xs`} onClick={() => void prova('pdf')}><IconaDownload /> PDF di prova</button>}
              </div>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={conferma} danger title="Eliminare il modello?"
        message={`«${bozza.nome}» verrà eliminato. ${bozza.id && usati(bozza.id) ? `${usati(bozza.id)} enti torneranno al modello predefinito.` : 'Nessun ente lo usa.'}`}
        confirmLabel="Elimina" onConfirm={() => void elimina()} onCancel={() => setConferma(false)}
      />
    </div>
  )
}

function EditorAllegati({ a, onChange }: { a: AllegatiConfig; onChange: (a: AllegatiConfig) => void }) {
  const upd = (patch: Partial<AllegatiConfig>) => onChange({ ...a, ...patch })
  const updCsv = (patch: Partial<AllegatiConfig['csv']>) => onChange({ ...a, csv: { ...a.csv, ...patch } })
  const updPdf = (patch: Partial<AllegatiConfig['pdf']>) => onChange({ ...a, pdf: { ...a.pdf, ...patch } })
  const updCol = (k: string, patch: Partial<ColonnaAllegato>) => onChange({ ...a, colonne: a.colonne.map(c => (c.k === k ? { ...c, ...patch } : c)) })
  const sposta = (i: number, d: -1 | 1) => {
    const c = [...a.colonne], j = i + d
    if (j < 0 || j >= c.length) return
    ;[c[i], c[j]] = [c[j]!, c[i]!]
    onChange({ ...a, colonne: c })
  }
  const sel = 'px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-indigo-500'

  return (
    <div className="border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-slate-950/50 border-b border-slate-800 flex flex-wrap items-center gap-x-5 gap-y-2">
        <h4 className="text-sm font-semibold text-white">Allegati</h4>
        <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" className="accent-indigo-500" checked={a.csv.attivo} onChange={e => updCsv({ attivo: e.target.checked })} /> CSV</label>
        <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" className="accent-indigo-500" checked={a.pdf.attivo} onChange={e => updPdf({ attivo: e.target.checked })} /> PDF</label>
        <span className="text-xs text-slate-500">valgono per tutti gli enti che usano questo modello</span>
      </div>
      <div className="p-4 flex flex-col gap-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="va-eml" className={etichettaCls}>Nome del file EML</label>
            <div className="flex items-center gap-1"><input id="va-eml" value={a.nomeEml} maxLength={120} onChange={e => upd({ nomeEml: e.target.value })} className={`${inputCls} font-mono !text-xs`} /><span className="text-xs text-slate-500 font-mono">.eml</span></div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="va-all" className={etichettaCls}>Nome dei file allegati</label>
            <div className="flex items-center gap-1"><input id="va-all" value={a.nomeAllegati} maxLength={120} onChange={e => upd({ nomeAllegati: e.target.value })} className={`${inputCls} font-mono !text-xs`} /><span className="text-xs text-slate-500 font-mono">.csv/.pdf</span></div>
          </div>
          <p className="sm:col-span-2 text-xs text-slate-500 -mt-2">
            Nei nomi dei file si usano <span className="font-mono text-cyan-300">{'{CODICE_ENTE}'}</span> e <span className="font-mono text-cyan-300">{'{PERIODO_FILE}'}</span> (es. 2025-01_2025-12).
            Con «un EML per mese», se manca {'{PERIODO_FILE}'} il periodo si aggiunge in coda.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className={etichettaCls}>Colonne (stesse per CSV e PDF)</span>
            <div className="flex-1" />
            <label className="flex items-center gap-2 text-xs text-slate-400">Ordine delle righe
              <select value={a.ordine} onChange={e => upd({ ordine: e.target.value as AllegatiConfig['ordine'] })} className={sel}>
                <option value="mese">mese, poi nominativo</option><option value="nome">nominativo, poi mese</option><option value="importo">importo decrescente</option>
              </select>
            </label>
          </div>
          <div className="overflow-x-auto border border-slate-800 rounded-lg"><table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 bg-slate-900/60">
              <th className="px-3 py-2 font-semibold">Usa</th><th className="px-3 py-2 font-semibold">Dato</th>
              <th className="px-3 py-2 font-semibold">Intestazione CSV</th><th className="px-3 py-2 font-semibold">Intestazione PDF</th><th className="px-3 py-2 font-semibold">Ordine</th>
            </tr></thead>
            <tbody>{a.colonne.map((c, i) => (
              <tr key={c.k} className={`border-t border-slate-800 ${c.on ? '' : 'opacity-50'}`}>
                <td className="px-3 py-1.5"><input type="checkbox" className="accent-indigo-500" checked={c.on} onChange={e => updCol(c.k, { on: e.target.checked })} aria-label={`Usa ${COLDEF[c.k].nome}`} /></td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <span className="text-slate-200">{COLDEF[c.k].nome}</span>
                  {COLDEF[c.k].pii && <span className="block text-[11px] text-amber-400">dato personale: solo se l'ente lo chiede</span>}
                  {c.k === 'MESE' && (
                    <label className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                      <input type="checkbox" className="accent-indigo-500" checked={!!c.soloMulti} onChange={e => updCol('MESE', { soloMulti: e.target.checked })} /> solo se l'EML ha più mesi
                    </label>
                  )}
                </td>
                <td className="px-3 py-1.5"><input value={c.csv} maxLength={40} onChange={e => updCol(c.k, { csv: e.target.value })} className={`${inputCls} !py-1 !text-xs font-mono !w-36`} aria-label={`Intestazione CSV di ${COLDEF[c.k].nome}`} /></td>
                <td className="px-3 py-1.5"><input value={c.pdf} maxLength={40} onChange={e => updCol(c.k, { pdf: e.target.value })} className={`${inputCls} !py-1 !text-xs !w-40`} aria-label={`Intestazione PDF di ${COLDEF[c.k].nome}`} /></td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <button type="button" disabled={i === 0} onClick={() => sposta(i, -1)} className={`${btnPiccolo} text-slate-400 hover:text-white hover:bg-slate-800`} aria-label="Sposta su">↑</button>
                  <button type="button" disabled={i === a.colonne.length - 1} onClick={() => sposta(i, 1)} className={`${btnPiccolo} text-slate-400 hover:text-white hover:bg-slate-800`} aria-label="Sposta giù">↓</button>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className={`border border-slate-800 rounded-lg p-3.5 flex flex-col gap-3 ${a.csv.attivo ? '' : 'opacity-50'}`}>
            <p className="text-sm font-medium text-slate-200">CSV</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1"><span className={etichettaCls}>Separatore</span>
                <select value={a.csv.sep} onChange={e => updCsv({ sep: e.target.value as AllegatiConfig['csv']['sep'] })} className={sel}>
                  <option value=";">punto e virgola ;</option><option value=",">virgola ,</option><option value="tab">tabulazione</option>
                </select></label>
              <label className="flex flex-col gap-1"><span className={etichettaCls}>Decimali</span>
                <select value={a.csv.decimali} onChange={e => updCsv({ decimali: e.target.value as AllegatiConfig['csv']['decimali'] })} className={sel}>
                  <option value="virgola">1234,56</option><option value="punto">1234.56</option>
                </select></label>
              <label className="flex flex-col gap-1 col-span-2"><span className={etichettaCls}>Codifica</span>
                <select value={a.csv.codifica} onChange={e => updCsv({ codifica: e.target.value as AllegatiConfig['csv']['codifica'] })} className={sel}>
                  <option value="w1252">Windows-1252, come il Java</option><option value="utf8bom">UTF-8 con BOM (Excel recente)</option>
                </select></label>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" className="accent-indigo-500" checked={a.csv.intestazione} onChange={e => updCsv({ intestazione: e.target.checked })} /> Prima riga con le intestazioni</label>
          </div>
          <div className={`border border-slate-800 rounded-lg p-3.5 flex flex-col gap-3 ${a.pdf.attivo ? '' : 'opacity-50'}`}>
            <p className="text-sm font-medium text-slate-200">PDF</p>
            <label className="flex flex-col gap-1"><span className={etichettaCls}>Titolo</span>
              <input value={a.pdf.titolo} maxLength={200} onChange={e => updPdf({ titolo: e.target.value })} className={`${inputCls} !py-1.5 !text-xs`} /></label>
            <label className="flex flex-col gap-1"><span className={etichettaCls}>Pagina</span>
              <select value={a.pdf.orient} onChange={e => updPdf({ orient: e.target.value as AllegatiConfig['pdf']['orient'] })} className={sel}>
                <option value="p">A4 verticale</option><option value="l">A4 orizzontale</option>
              </select></label>
            <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" className="accent-indigo-500" checked={a.pdf.subtotali} onChange={e => updPdf({ subtotali: e.target.checked })} /> Subtotali per mese (con ordine per mese)</label>
            <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" className="accent-indigo-500" checked={a.pdf.totale} onChange={e => updPdf({ totale: e.target.checked })} /> Riga del totale</label>
          </div>
        </div>
      </div>
    </div>
  )
}
