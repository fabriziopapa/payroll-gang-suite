// ============================================================
// PAYROLL GANG SUITE — Versamenti enti · Rubrica enti
//
// Tutti gli enti visti nelle stampe versamenti: email (anche piu' di una,
// separate da virgola), abilitato, modello mail. Ogni modifica si salva
// subito e va nell'audit.
// ============================================================

import { useRef, useState } from 'react'
import { versamentiApi, type VersamentoEnteApi } from '../../api/endpoints'
import { showToast } from '../ToastManager'
import type { ModelloVersamento } from '../../utils/versamentiModelli'
import { leggiRubricaCsv, anteprimaImport, type LetturaRubrica } from '../../utils/versamentiRubrica'
import { ApiError } from '../../api/client'
import { CampoEmail, InterruttoreEnte, Pill, btnPrimario, btnSecondario, cardCls, inputCls, messaggioErrore } from './ui'

type Filtro = 'tutti' | 'abilitati' | 'disabilitati' | 'senza' | 'nuovi'

const fmtData = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—')

export default function RubricaEntiTab({ enti, modelli, nuovi, codiciNelFile, onAggiornato, onEnti }: {
  enti:          VersamentoEnteApi[]
  modelli:       ModelloVersamento[]
  nuovi:         ReadonlySet<string>
  codiciNelFile: ReadonlySet<string>
  onAggiornato:  (e: VersamentoEnteApi) => void
  onEnti:        (enti: VersamentoEnteApi[]) => void
}) {
  const [filtro, setFiltro] = useState<Filtro>('tutti')
  const [cerca, setCerca] = useState('')
  const [importa, setImporta] = useState<{ nome: string; l: LetturaRubrica } | null>(null)
  const [importando, setImportando] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function apriRubrica(f: File) {
    if (f.size > 5 * 1024 * 1024) { showToast('File troppo grande (oltre 5 MB).', 'error'); return }
    setImporta({ nome: f.name, l: leggiRubricaCsv(await f.arrayBuffer()) })
  }
  async function confermaImport() {
    if (!importa) return
    setImportando(true)
    try {
      const r = await versamentiApi.importaEnti({ file: importa.nome, righe: importa.l.righe })
      onEnti(r.enti)
      setImporta(null)
      showToast(`Rubrica importata: ${r.nuovi.length} nuovi, ${r.aggiornati.length} completati, ${r.saltati.length + r.invariati.length} non toccati`, 'success')
    } catch (err) {
      const msg = err instanceof ApiError && err.code === 'EMAIL_NON_VALIDA' ? 'Un indirizzo non è valido: correggi il file.' : messaggioErrore(err)
      showToast(`Import non riuscito: ${msg}`, 'error')
    } finally { setImportando(false) }
  }
  const ant = importa && !importa.l.mancanti.length ? anteprimaImport(importa.l.righe, enti) : null
  const predefinito = modelli.find(m => m.predefinito)

  const filtri: Record<Filtro, (e: VersamentoEnteApi) => boolean> = {
    tutti: () => true,
    abilitati: e => e.abilitato,
    disabilitati: e => !e.abilitato,
    senza: e => !e.email.length,
    nuovi: e => nuovi.has(e.codice),
  }
  const q = cerca.trim().toLowerCase()
  const righe = enti.filter(filtri[filtro]).filter(e =>
    !q || e.codice.toLowerCase().includes(q) || e.descrizione.toLowerCase().includes(q) || e.email.join(' ').includes(q))

  async function cambiaModello(e: VersamentoEnteApi, id: string) {
    try {
      const { ente } = await versamentiApi.aggiornaEnte(e.codice, { modelloId: id || null })
      onAggiornato(ente)
      showToast(`${ente.descrizione}: modello «${modelli.find(m => m.id === ente.modelloId)?.nome ?? `predefinito (${predefinito?.nome ?? '—'})`}»`, 'success')
    } catch (err) { showToast(messaggioErrore(err), 'error') }
  }

  const chip = (k: Filtro, t: string) => (
    <button key={k} type="button" onClick={() => setFiltro(k)}
      className={`px-3 py-1 rounded-full text-xs font-medium border ${filtro === k ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}>
      {t} <span className="opacity-70 tabular-nums">{enti.filter(filtri[k]).length}</span>
    </button>
  )

  return (
    <div className="flex flex-col gap-6">
    {importa && (
      <div className="border border-indigo-800/70 bg-indigo-950/20 rounded-xl p-5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-indigo-200">Importa rubrica</h3>
          <span className="font-mono text-xs text-slate-400 break-all">{importa.nome}</span>
        </div>
        {importa.l.mancanti.length > 0 ? (
          <p className="text-sm text-red-300">Mancano le colonne {importa.l.mancanti.join(', ')}. Servono almeno <span className="font-mono">codice</span> (o <span className="font-mono">ENTE</span>) ed <span className="font-mono">email</span>; facoltative <span className="font-mono">descrizione</span> e <span className="font-mono">abilitato</span>.</p>
        ) : ant && (
          <>
            <ul className="text-sm text-slate-300 grid sm:grid-cols-2 gap-x-6 gap-y-1">
              <li><span className="tabular-nums text-white">{importa.l.righe.length}</span> enti nel file</li>
              <li><span className="tabular-nums text-white">{ant.nuovi.length}</span> nuovi, da creare</li>
              <li><span className="tabular-nums text-white">{ant.aggiorna.length}</span> già in rubrica senza email: prendono email e abilitazione</li>
              <li><span className="tabular-nums text-white">{ant.saltati.length}</span> già con email in PGS: non si toccano</li>
              <li><span className="tabular-nums text-white">{ant.invariati.length}</span> già uguali: niente da cambiare</li>
              <li><span className="tabular-nums text-white">{ant.conEmail}</span> arrivano con almeno un indirizzo</li>
              <li><span className="tabular-nums text-white">{ant.disabilitati}</span> arrivano disabilitati</li>
            </ul>
            {ant.conEmail > 0 && (
              // Controllo a occhio prima di confermare: a questi indirizzi
              // andranno gli EML con i dati delle persone.
              <details className="text-xs text-slate-300">
                <summary className="cursor-pointer text-indigo-300 hover:text-indigo-200">Indirizzi che verranno scritti ({ant.conEmail})</summary>
                <ul className="mt-2 max-h-56 overflow-auto border border-slate-800 rounded-lg divide-y divide-slate-800">
                  {[...ant.nuovi, ...ant.aggiorna].filter(r => r.email).map(r => (
                    <li key={r.codice} className="px-3 py-1.5 flex flex-wrap gap-x-3">
                      <span className="font-mono text-slate-400 w-20 shrink-0">{r.codice}</span>
                      <span className="text-slate-400 truncate max-w-[16rem]">{r.descrizione || (enti.find(e => e.codice === r.codice)?.descrizione ?? '')}</span>
                      <span className="font-mono break-all text-slate-100">{r.email}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {importa.l.errori.length > 0 && (
              <div className="border border-amber-800 bg-amber-950/30 rounded-lg px-4 py-2.5 text-xs text-amber-300">
                {importa.l.errori.length} righe scartate e non importate:
                <ul className="list-disc ml-5 mt-1">{importa.l.errori.slice(0, 20).map(e => <li key={e.riga}>riga {e.riga}: {e.motivo}</li>)}</ul>
              </div>
            )}
          </>
        )}
        <div className="flex flex-wrap gap-2 justify-end">
          <button type="button" className={btnSecondario} onClick={() => setImporta(null)} disabled={importando}>Annulla</button>
          <button type="button" className={btnPrimario} disabled={!ant || !importa.l.righe.length || importando || (!ant.nuovi.length && !ant.aggiorna.length)}
            onClick={() => void confermaImport()}>{importando ? 'Importo…' : 'Importa'}</button>
        </div>
      </div>
    )}
    <div className={`${cardCls} overflow-hidden`}>
      <div className="px-5 py-3.5 border-b border-slate-800 flex flex-wrap items-center gap-2">
        {chip('tutti', 'Tutti')}{chip('abilitati', 'Abilitati')}{chip('disabilitati', 'Disabilitati')}
        {chip('senza', 'Senza email')}{chip('nuovi', 'Nuovi nell\'ultimo file')}
        <div className="flex-1" />
        <input value={cerca} onChange={e => setCerca(e.target.value)} placeholder="Cerca codice, descrizione, email…"
          aria-label="Cerca nella rubrica" className={`${inputCls} !w-64 !py-1.5`} />
        <button type="button" className={`${btnSecondario} !py-1.5`} onClick={() => fileRef.current?.click()}
          title="CSV con colonne codice (o ENTE), descrizione, email, abilitato: non sovrascrive gli enti che hanno già un'email">Importa rubrica</button>
        <input ref={fileRef} type="file" accept=".csv,.txt" className="sr-only"
          onChange={e => { const f = e.target.files?.[0]; if (f) void apriRubrica(f); e.target.value = '' }} />
      </div>
      {enti.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">La rubrica è vuota: si riempie da sola al primo caricamento di una stampa versamenti.</p>
      ) : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 bg-slate-900/60">
            <th className="px-5 py-2.5 font-semibold">Codice</th><th className="px-3 py-2.5 font-semibold">Descrizione</th>
            <th className="px-3 py-2.5 font-semibold">Email</th><th className="px-3 py-2.5 font-semibold">Modello</th>
            <th className="px-3 py-2.5 font-semibold">Abilitato</th><th className="px-3 py-2.5 font-semibold">Nel file</th>
            <th className="px-5 py-2.5 font-semibold">Ultimo file</th>
          </tr></thead>
          <tbody>
            {righe.map(e => (
              <tr key={e.codice} className={`border-t border-slate-800 align-top ${e.abilitato ? '' : 'opacity-60'}`}>
                <td className="px-5 py-2.5 font-mono text-xs text-slate-300 whitespace-nowrap">{e.codice}</td>
                <td className="px-3 py-2.5"><span className="text-slate-100">{e.descrizione}</span> {nuovi.has(e.codice) && <Pill tono="nuovo">NUOVO</Pill>}</td>
                <td className="px-3 py-2"><CampoEmail ente={e} onAggiornato={onAggiornato} /></td>
                <td className="px-3 py-2">
                  <select value={e.modelloId ?? ''} onChange={ev => void cambiaModello(e, ev.target.value)}
                    aria-label={`Modello per ${e.descrizione}`} className={`${inputCls} !py-1.5 !text-xs !w-56`}>
                    <option value="">Predefinito ({predefinito?.nome ?? '—'})</option>
                    {modelli.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2.5"><InterruttoreEnte ente={e} onAggiornato={onAggiornato} /></td>
                <td className={`px-3 py-2.5 text-xs ${codiciNelFile.has(e.codice) ? 'text-emerald-400' : 'text-slate-600'}`}>{codiciNelFile.has(e.codice) ? 'sì' : '—'}</td>
                <td className="px-5 py-2.5 text-xs text-slate-500"><span className="font-mono break-all">{e.ultimoFile ?? '—'}</span><br />{fmtData(e.ultimoVisto)}</td>
              </tr>
            ))}
            {!righe.length && <tr><td colSpan={7} className="px-5 py-6 text-sm text-slate-500">Nessun ente con questo filtro.</td></tr>}
          </tbody>
        </table></div>
      )}
      <p className="px-5 py-3 border-t border-slate-800 text-xs text-slate-500">
        PGS salva per ogni ente solo codice, descrizione, email, abilitazione, modello e ultimo file. Ogni modifica è nell'Audit.
      </p>
    </div>
    </div>
  )
}
