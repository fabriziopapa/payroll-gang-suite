// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · aggancio nelle importazioni (parte a video)
// Colonne chiave riconosciute dai sinonimi e correggibili a mano (la scelta
// si ricorda per tracciato, in questo browser); cella con l'esito e la
// scelta fra i candidati; proposta dei numeri di telefono nuovi.
// Le regole sono in aggancio.ts.
// ============================================================

import { useMemo, useState } from 'react'
import { cralApi } from '../../api/endpoints'
import type { Persona } from './tipi'
import { NOMI_RUOLI, chiaveIntestazione, trovaColonne, type Chiavi, type EsitoAggancio, type Ruolo } from './aggancio'
import { mostraTelefono } from './contatti'
import { leggiData, nominativo } from './logica'
import { Interruttore, Pill, avviso, inputCls, inputW, messaggioErrore } from './ui'

export const RUOLI_EVENTO: Ruolo[] = ['id', 'telefono', 'email', 'nominativo', 'cognome', 'nome', 'nascita']

const LS = 'pgs.cral.colonne.'
function leggiRicordate(tracciato: string): Record<string, string> {
  try { const v = JSON.parse(localStorage.getItem(LS + tracciato) ?? '{}') as unknown; return v && typeof v === 'object' ? v as Record<string, string> : {} } catch { return {} }
}
/** Colonne chiave di un file con intestazione: automatiche, correggibili, ricordate per tracciato. */
export function useColonne(tracciato: string, intest: string[] | null, ruoli: Ruolo[] = RUOLI_EVENTO) {
  const [ricordate, setRicordate] = useState<Record<string, string>>(() => leggiRicordate(tracciato))
  const firma = intest ? intest.join('\u0001') : ''
  // dipende dal contenuto dell'intestazione (firma), non dall'array: quello cambia a ogni disegno
  const col = useMemo(() => trovaColonne(intest ?? [], ruoli, ricordate), [firma, ricordate])
  function imposta(r: Ruolo, j: number) {
    if (!intest) return
    const n = { ...ricordate }
    // chi aveva questo ruolo lo perde; la colonna scelta lo prende (e lascia l'eventuale ruolo di prima)
    for (const [k, v] of Object.entries(n)) if (v === r) delete n[k]
    const prima = col[r]
    if (j < 0) { if (prima >= 0) n[chiaveIntestazione(intest[prima] ?? '')] = '' }
    else n[chiaveIntestazione(intest[j] ?? '')] = r
    setRicordate(n)
    try { localStorage.setItem(LS + tracciato, JSON.stringify(n)) } catch { /* senza memoria: vale per questa volta */ }
  }
  return { col, imposta }
}

/** Le chiavi di una riga, lette dalle colonne indicate. */
export function chiaviDi(r: string[], col: Record<Ruolo, number>): Chiavi & { nominativo: string; telefono: string; email: string; id: string } {
  const v = (j: number) => (j >= 0 ? (r[j] ?? '').trim() : '')
  return {
    id: v(col.id), tessera: v(col.tessera), telefono: v(col.telefono), email: v(col.email),
    nominativo: v(col.nominativo) || [v(col.cognome), v(col.nome)].filter(Boolean).join(' '),
    nascita: col.nascita >= 0 ? leggiData(v(col.nascita)) : null,
  }
}
export const nelFile = (k: Chiavi): string => [k.nominativo, k.email, k.telefono, k.id].filter(Boolean).join(' · ') || '—'

/** Riga compatta: quali colonne del file fanno da chiave. Si cambia a mano e la scelta resta per le prossime volte. */
export function ColonneChiave({ intest, col, imposta, ruoli = RUOLI_EVENTO }: { intest: string[]; col: Record<Ruolo, number>; imposta: (r: Ruolo, j: number) => void; ruoli?: Ruolo[] }) {
  const trovate = ruoli.filter(r => col[r] >= 0)
  return (
    <details className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
      <summary className="cursor-pointer select-none">Per riconoscere le persone uso: {trovate.length ? trovate.map(r => <span key={r} className="text-slate-200">{NOMI_RUOLI[r]} «{intest[col[r]]}»</span>).reduce<React.ReactNode[]>((a, x, i) => (i ? [...a, ' · ', x] : [x]), []) : <span className="text-amber-400">nessuna colonna riconosciuta</span>} <span className="text-indigo-400">— cambia</span></summary>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-2">{ruoli.map(r => (
        <label key={r} className="flex flex-col gap-1"><span>{NOMI_RUOLI[r]}</span>
          <select className={inputCls + ' py-1 text-xs'} value={col[r]} onChange={e => imposta(r, +e.target.value)}><option value={-1}>— nessuna</option>{intest.map((h, j) => h.trim() ? <option key={j} value={j}>{String.fromCharCode(65 + (j % 26))} · {h.slice(0, 30)}</option> : null)}</select></label>))}</div>
      <p className="mt-2 text-slate-500">Basta una chiave: ID, telefono, email o nominativo. L'ordine è ID → telefono → email → nominativo (+ data di nascita). La scelta delle colonne si ricorda per questo tipo di file.</p>
    </details>
  )
}

/** Esito dell'aggancio di una riga: la persona, oppure perché no e fra chi scegliere. */
export function CellaAggancio({ e, scelta, onScelta, elenco, altre }: {
  e: EsitoAggancio; scelta: string; onScelta: (id: string) => void; elenco: Persona[]
  /** Altre voci del menu (es. «Crea nuovo esterno»): [valore, etichetta]. */
  altre?: Array<[string, string]>
}) {
  if (e.socio) return (
    <span className="text-sm text-slate-100">{nominativo(e.socio)} <Pill tono="ok">per {e.via}</Pill>
      {e.telefonoNuovo && <span className="ml-1"><Pill tono="cyan" title="In anagrafica non ha un numero: quello del file si può proporre (senza consenso)">+ tel. {mostraTelefono(e.telefono)}</Pill></span>}
      {e.avvisi.length > 0 && <span className="block text-[11px] text-amber-400">{e.avvisi.join(' · ')}</span>}</span>)
  const cand = new Set(e.candidati.map(c => c.id))
  const ord = (xs: Persona[]) => xs.slice().sort((a, b) => nominativo(a).localeCompare(nominativo(b)))
  return (
    <div className="flex flex-col gap-1 min-w-[220px]">
      <div className="flex items-center gap-2">{e.stato === 'CONFLITTO' ? <Pill tono="err" title="Le chiavi della riga indicano persone diverse: la riga resta ferma finché non scegli">Conflitto</Pill> : e.stato === 'AMBIGUA' ? <Pill tono="warn">Da scegliere</Pill> : <Pill tono="warn">Non agganciata</Pill>}
        <select className={inputW + ' py-1 text-xs flex-1 min-w-0'} value={scelta} onChange={ev => onScelta(ev.target.value)} aria-label="Assegna la riga a una persona">
          <option value="">{e.stato === 'IGNOTA' ? 'Assegna a…' : 'Scegli…'}</option>
          {altre?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          {e.candidati.length > 0 && <optgroup label="Possibili">{e.candidati.map(s => <option key={s.id} value={s.id}>{nominativo(s)} ({s.id})</option>)}</optgroup>}
          <optgroup label={e.candidati.length ? 'Tutti gli altri' : 'Persone'}>{ord(elenco.filter(s => !cand.has(s.id))).map(s => <option key={s.id} value={s.id}>{nominativo(s)}</option>)}</optgroup>
        </select></div>
      <span className={`text-[11px] ${e.stato === 'CONFLITTO' ? 'text-red-300' : 'text-slate-500'}`}>{[e.motivo, ...e.avvisi.filter(a => !e.motivo.includes(a))].filter(Boolean).join(' · ')}</span>
    </div>
  )
}

export interface TelefonoProposto { socio: string; telefono: string; riga: number }
/** Il numero della riga va proposto: la persona scelta non ne ha uno e il numero non è di nessun altro. */
export function daProporre(e: EsitoAggancio, finale: Persona | null | undefined, tutti: Persona[], riga: number): TelefonoProposto[] {
  if (!finale || !e.telefono || finale.contatti.telefono || tutti.some(x => x.contatti.telefono === e.telefono)) return []
  return [{ socio: finale.id, telefono: e.telefono, riga }]
}
export function PropostaTelefoni({ n, on, onChange }: { n: number; on: boolean; onChange: (v: boolean) => void }) {
  if (!n) return null
  return <Interruttore on={on} onChange={onChange} label={<span className="text-xs">{n === 1 ? 'Un numero di telefono nuovo' : `${n} numeri di telefono nuovi`}: proponili in anagrafica (finiscono in «Da validare», senza consenso)</span>} />
}
/** Crea il lotto con i numeri nuovi: si accettano uno per uno in «Da validare». Non blocca l'importazione. */
export async function proponiTelefoni(origine: string, voci: TelefonoProposto[]): Promise<number> {
  const uniche = [...new Map(voci.map(v => [v.socio, v])).values()]
  if (!uniche.length) return 0
  try {
    const r = await cralApi.lottoT6(`Telefoni da ${origine}`.slice(0, 200), uniche.map(v => ({ socio: v.socio, riga: v.riga, valori: { contatti: { telefono: v.telefono } } })))
    return r.variazioni
  } catch (err) { avviso(`Numeri di telefono non proposti: ${messaggioErrore(err)}`, 'warning'); return 0 }
}
