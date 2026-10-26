// ============================================================
// PAYROLL GANG SUITE — Versamenti enti · Rubrica enti
//
// Tutti gli enti visti nelle stampe versamenti: email (anche piu' di una,
// separate da virgola), abilitato, modello mail. Ogni modifica si salva
// subito e va nell'audit.
// ============================================================

import { useState } from 'react'
import { versamentiApi, type VersamentoEnteApi } from '../../api/endpoints'
import { showToast } from '../ToastManager'
import type { ModelloVersamento } from '../../utils/versamentiModelli'
import { CampoEmail, InterruttoreEnte, Pill, cardCls, inputCls, messaggioErrore } from './ui'

type Filtro = 'tutti' | 'abilitati' | 'disabilitati' | 'senza' | 'nuovi'

const fmtData = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—')

export default function RubricaEntiTab({ enti, modelli, nuovi, codiciNelFile, onAggiornato }: {
  enti:          VersamentoEnteApi[]
  modelli:       ModelloVersamento[]
  nuovi:         ReadonlySet<string>
  codiciNelFile: ReadonlySet<string>
  onAggiornato:  (e: VersamentoEnteApi) => void
}) {
  const [filtro, setFiltro] = useState<Filtro>('tutti')
  const [cerca, setCerca] = useState('')
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
    <div className={`${cardCls} overflow-hidden`}>
      <div className="px-5 py-3.5 border-b border-slate-800 flex flex-wrap items-center gap-2">
        {chip('tutti', 'Tutti')}{chip('abilitati', 'Abilitati')}{chip('disabilitati', 'Disabilitati')}
        {chip('senza', 'Senza email')}{chip('nuovi', 'Nuovi nell\'ultimo file')}
        <div className="flex-1" />
        <input value={cerca} onChange={e => setCerca(e.target.value)} placeholder="Cerca codice, descrizione, email…"
          aria-label="Cerca nella rubrica" className={`${inputCls} !w-64 !py-1.5`} />
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
  )
}
