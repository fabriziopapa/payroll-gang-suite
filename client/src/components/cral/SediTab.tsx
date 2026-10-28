// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · scheda Sedi
// Composizione a mano: chi ritira dove. I familiari seguono il socio.
// ============================================================

import { useState } from 'react'
import { cralApi } from '../../api/endpoints'
import { nominativo, norm, sedeBreve, sedeNome } from './logica'
import { D, Ico, Origine, Pill, StatoSocio, btnPrimario, cardCls, inputCls, thCls, useCral } from './ui'

export function SediTab() {
  const { db, esegui, vaiA } = useCral()
  const vivi = db.soci.filter(s => s.tipo !== 'FAM' && (s.stato === 'ATTIVO' || s.stato === 'DA_VALIDARE'))
  const [sel, setSel] = useState(db.sedi[0]?.id ?? '__NOSEDE')
  const [spunte, setSpunte] = useState<Set<string>>(new Set())
  const [dest, setDest] = useState('')
  const [cerca, setCerca] = useState('')
  const scegli = (id: string) => { setSel(id); setSpunte(new Set()); setCerca('') }
  const nomeSel = sel === '__NOSEDE' ? 'Senza sede di consegna' : sedeNome(db, sel)
  const membri = vivi.filter(s => (sel === '__NOSEDE' ? !s.sede : s.sede === sel)).sort((a, b) => nominativo(a).localeCompare(nominativo(b)))
  const n = norm(cerca)
  const aggiungibili = n.length < 2 ? [] : vivi.filter(s => (sel === '__NOSEDE' ? !!s.sede : s.sede !== sel) && norm(`${nominativo(s)} ${s.id} ${s.tessera}`).includes(n)).slice(0, 8)
  const sposta = async (ids: string[], sede: string | null) => {
    const r = await esegui(() => cralApi.sposta(ids, sede),
      `${ids.length} ${ids.length === 1 ? 'persona spostata' : 'persone spostate'} in «${sede ? sedeNome(db, sede) : 'senza sede'}»`)
    if (r) setSpunte(new Set())
  }
  const conta = (id: string) => vivi.filter(s => (id === '__NOSEDE' ? !s.sede : s.sede === id)).length
  const tutti = membri.length > 0 && membri.every(s => spunte.has(s.id))
  const voci: Array<[string, string, boolean]> = [...db.sedi.map(s => [s.id, s.nome, s.attiva] as [string, string, boolean]), ['__NOSEDE', 'Senza sede di consegna', true]]
  return (
    <div className="grid lg:grid-cols-[280px_minmax(0,1fr)] gap-4 items-start">
      <div className={`${cardCls} overflow-hidden`}>
        <div className="px-4 py-3 border-b border-slate-800 flex items-center"><p className="text-sm font-medium text-white flex-1">Sedi di consegna</p><button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={() => vaiA('parametri')}>Aggiungi o rinomina</button></div>
        <div className="p-2 flex flex-col gap-0.5">
          {voci.map(([id, nome, attiva]) => (
            <button key={id} onClick={() => scegli(id)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${sel === id ? 'bg-indigo-600/20 text-indigo-300' : 'text-slate-300 hover:bg-slate-800'}`}>
              <span className={`flex-1 ${id === '__NOSEDE' ? 'text-amber-400' : ''}`}>{sedeBreve(nome)}</span>
              {!attiva && <Pill>non attiva</Pill>}
              <span className="text-xs text-slate-500 tabular-nums">{conta(id)}</span>
            </button>))}
        </div>
      </div>

      <div className={`${cardCls} overflow-hidden min-w-0`}>
        <div className="px-5 py-3 border-b border-slate-800 flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-white flex-1">{nomeSel}</p><span className="text-xs text-slate-500 tabular-nums">{membri.length} persone</span></div>
        <div className="px-5 py-3 border-b border-slate-800 flex flex-col gap-2">
          <div className="relative"><span className="absolute left-3 top-2.5 text-slate-500"><Ico d={D.search} /></span>
            <input className={inputCls + ' pl-9'} placeholder={sel === '__NOSEDE' ? 'Cerca chi togliere dalla sua sede…' : `Aggiungi a «${sedeBreve(nomeSel)}»: cognome, ID o tessera`} value={cerca} onChange={e => setCerca(e.target.value)} /></div>
          {n.length >= 2 && <div className="border border-slate-800 rounded-lg divide-y divide-slate-800 max-h-60 overflow-y-auto">
            {aggiungibili.map(s => (
              <button key={s.id} onClick={() => { void sposta([s.id], sel === '__NOSEDE' ? null : sel); setCerca('') }} className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-3 text-sm">
                <span className="font-mono text-xs text-slate-400 w-20">{s.id}</span><span className="text-slate-100 flex-1">{nominativo(s)}</span>
                <span className="text-xs text-slate-500">{s.sede ? `da ${sedeBreve(sedeNome(db, s.sede))}` : 'senza sede'}</span><Ico d={D.plus} cls="w-3.5 h-3.5 text-indigo-400" />
              </button>))}
            {!aggiungibili.length && <p className="px-3 py-3 text-sm text-slate-500">Nessuno trovato fuori da questa sede. I nuovi iscritti si aggiungono da «Soci › Nuova persona».</p>}
          </div>}
        </div>
        <div className="overflow-x-auto max-h-[520px] overflow-y-auto"><table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-900"><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
            <th className="pl-5 pr-2 py-2.5"><input type="checkbox" className="accent-indigo-500" checked={tutti} onChange={() => setSpunte(tutti ? new Set() : new Set(membri.map(s => s.id)))} aria-label="Seleziona tutti" /></th>
            <th className={thCls}>ID</th><th className={thCls}>Nominativo</th><th className={thCls}>Tipologia</th><th className={thCls}>Tessera</th><th className="px-5 py-2.5 font-semibold">Stato</th></tr></thead>
          <tbody className="divide-y divide-slate-800/70">
            {membri.map(s => (
              <tr key={s.id} className="hover:bg-slate-800/30">
                <td className="pl-5 pr-2 py-2"><input type="checkbox" className="accent-indigo-500" checked={spunte.has(s.id)} onChange={() => { const x = new Set(spunte); if (x.has(s.id)) x.delete(s.id); else x.add(s.id); setSpunte(x) }} aria-label={`Seleziona ${nominativo(s)}`} /></td>
                <td className="px-3 py-2 font-mono text-xs text-slate-300">{s.id}</td>
                <td className="px-3 py-2 text-slate-100 whitespace-nowrap">{nominativo(s)}</td>
                <td className="px-3 py-2"><Origine s={s} /></td>
                <td className="px-3 py-2 font-mono text-xs text-slate-400">{s.tessera || '—'}</td>
                <td className="px-5 py-2"><StatoSocio s={s} /></td>
              </tr>))}
            {!membri.length && <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-500">Nessuno in questa sede. Cerca sopra per aggiungere.</td></tr>}
          </tbody>
        </table></div>
        <div className="px-5 py-3 border-t border-slate-800 flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-400 mr-auto">{spunte.size ? `${spunte.size} selezionati` : 'Seleziona chi spostare'}</span>
          <select className={inputCls + ' sm:w-64'} value={dest} onChange={e => setDest(e.target.value)}>
            <option value="">Sposta in…</option>{db.sedi.filter(s => s.attiva && s.id !== sel).map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}{sel !== '__NOSEDE' && <option value="__NOSEDE">— Nessuna sede</option>}</select>
          <button className={btnPrimario} disabled={!spunte.size || !dest} onClick={() => { void sposta([...spunte], dest === '__NOSEDE' ? null : dest); setDest('') }}>Sposta</button>
        </div>
      </div>
    </div>
  )
}
