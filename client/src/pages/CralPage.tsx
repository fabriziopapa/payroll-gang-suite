// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL (solo admin)
//
// Soci dipendenti, soci esterni, esterni e familiari; eventi (scelte,
// ordini a pagamento, campi estivi a settimane, biglietti a magazzino);
// quote associative; report CSV/PDF. Lo stato arriva tutto da
// GET /api/v1/cral/stato; ogni modifica va al server e poi si ricarica.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { cralApi } from '../api/endpoints'
import { useStore } from '../store/useStore'
import { showToast } from '../components/ToastManager'
import { daStato, type Db, type Lotto, type PatchScelta, type QuotaSocio, type Richiesta, type Scelta } from '../components/cral/tipi'
import { eSocio } from '../components/cral/logica'
import { Ctx, messaggioErrore, type CralCtx, type Scheda } from '../components/cral/ui'
import { SociTab } from '../components/cral/SociTab'
import { SediTab } from '../components/cral/SediTab'
import { ImportTab } from '../components/cral/ImportTab'
import { ValidareTab } from '../components/cral/ValidareTab'
import { IniziativeTab } from '../components/cral/IniziativeTab'
import { QuoteTab } from '../components/cral/QuoteTab'
import { ReportTab } from '../components/cral/ReportTab'
import { GuideTab } from '../components/cral/GuideTab'
import { ParametriTab } from '../components/cral/ParametriTab'

const SCHEDE: Array<[Scheda, string]> = [
  ['soci', 'Soci'], ['sedi', 'Sedi'], ['import', 'Importazione'], ['validare', 'Da validare'], ['iniziative', 'Eventi'],
  ['quote', 'Quote associative'], ['report', 'Report'], ['guide', 'Guide'], ['parametri', 'Parametri'],
]
const tabCls = (on: boolean) => `whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${on ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`

/** Applica una modifica di scelta come il server: null toglie la chiave, quantità a zero e settimane vuote spariscono. */
function unisci(prima: Scelta | undefined, patch: PatchScelta, fonte: Scelta['fonte']): Scelta {
  const out: Record<string, unknown> = { ...(prima ?? {}) }
  for (const [k, v] of Object.entries(patch)) { if (v === null || v === undefined) delete out[k]; else out[k] = v }
  if (out['q']) out['q'] = Object.fromEntries(Object.entries(out['q'] as Record<string, number>).filter(([, n]) => n > 0))
  if (out['per']) out['per'] = Object.fromEntries(Object.entries(out['per'] as Record<string, string>).filter(([, s]) => s))
  out['fonte'] = fonte
  return out as Scelta
}

export function CralPage() {
  const user = useStore(s => s.user)
  const [db, setDb] = useState<Db | null>(null)
  const [lotti, setLotti] = useState<Lotto[]>([])
  const [errore, setErrore] = useState<string | null>(null)
  const [scheda, setScheda] = useState<Scheda>('soci')

  const ricarica = useCallback(async () => {
    try {
      const [st, lt] = await Promise.all([cralApi.stato(), cralApi.lotti().catch(() => ({ lotti: [] as Lotto[] }))])
      setDb(daStato(st)); setLotti(lt.lotti); setErrore(null)
    } catch (e) { setErrore(messaggioErrore(e)) }
  }, [])
  useEffect(() => { void ricarica() }, [ricarica])

  const ctx = useMemo<CralCtx | null>(() => !db ? null : ({
    db,
    lotti,
    utente: user?.username ?? '',
    vaiA: (s: Scheda) => { setScheda(s); window.scrollTo({ top: 0 }) },
    ricarica,
    esegui: async (fn, ok, livello = 'success') => {
      try {
        const r = await fn()
        await ricarica()
        if (ok) showToast(typeof ok === 'function' ? ok(r) : ok, livello)
        return r
      } catch (e) { showToast(messaggioErrore(e), 'error'); await ricarica(); return null }
    },
    scelta: (iid, sid, patch, fonte = 'manuale') => {
      setDb(d => d && ({ ...d, iniziative: d.iniziative.map(i => i.id !== iid ? i : { ...i, scelte: { ...i.scelte, [sid]: unisci(i.scelte[sid], patch, fonte) } }) }))
      cralApi.scelta(iid, sid, patch, fonte)
        .then(r => setDb(d => d && ({ ...d, iniziative: d.iniziative.map(i => i.id !== iid ? i : { ...i, scelte: { ...i.scelte, [sid]: { ...(r.dati as Scelta), fonte } } }) })))
        .catch(e => { showToast(messaggioErrore(e), 'error'); void ricarica() })
    },
    richiesta: async (iid, rid, patch) => {
      setDb(d => d && ({ ...d, iniziative: d.iniziative.map(i => i.id !== iid ? i : { ...i, richieste: i.richieste.map(r => r.id === rid ? { ...r, ...patch } as Richiesta : r) }) }))
      try { await cralApi.aggiornaRichiesta(iid, rid, patch); return true }
      catch (e) { showToast(messaggioErrore(e), 'error'); await ricarica(); return false }
    },
    quota: (anno, sid, prima, patch) => {
      const nuova: QuotaSocio = { ...prima, ...patch }
      setDb(d => d && ({ ...d, quote: { ...d.quote, [String(anno)]: { ...(d.quote[String(anno)] ?? {}), [sid]: nuova } } }))
      // la modalità va sempre: una quota mai salvata prende quella mostrata (predefinita)
      cralApi.quota(anno, sid, { modo: nuova.modo, ...patch })
        .then(r => setDb(d => d && ({ ...d, quote: { ...d.quote, [String(anno)]: { ...(d.quote[String(anno)] ?? {}), [sid]: r.quota } } })))
        .catch(e => { showToast(messaggioErrore(e), 'error'); void ricarica() })
    },
  }), [db, lotti, ricarica, user?.username])

  if (!ctx) return (
    <div className="p-6 text-sm text-slate-400">{errore ? <span className="text-red-300">{errore}</span> : 'Caricamento del modulo CRAL…'}</div>
  )
  const daValidare = ctx.db.soci.filter(s => s.stato === 'DA_VALIDARE').length + ctx.lotti.filter(l => l.stato === 'APERTO').length
  const attivi = ctx.db.soci.filter(s => s.stato === 'ATTIVO' && eSocio(s)).length
  return (
    <Ctx.Provider value={ctx}>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto flex flex-col gap-6">
        <div>
          <h2 className="text-xl font-semibold text-white">CRAL · Soci e iniziative</h2>
          <p className="text-sm text-slate-400 mt-1 max-w-3xl">Soci dipendenti, soci esterni, esterni e familiari dei soci. Per ogni evento (strenne, panettoni, colombe, vendite, gite, campi estivi, cinema) si raccolgono scelte, ordini, iscrizioni o richieste e si stampano le liste.</p>
        </div>
        <div className="flex flex-wrap gap-1 border-b border-slate-800" role="tablist">
          {SCHEDE.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={scheda === k} className={tabCls(scheda === k)} onClick={() => ctx.vaiA(k)}>
              {l}
              {k === 'soci' && <span className="ml-1 text-xs text-slate-500">{attivi}</span>}
              {k === 'validare' && daValidare > 0 && <span className="ml-1.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-900/50 text-amber-400 border border-amber-800">{daValidare}</span>}
              {k === 'iniziative' && <span className="ml-1 text-xs text-slate-500">{ctx.db.iniziative.filter(i => !i.archiviata).length}</span>}
            </button>))}
        </div>
        {scheda === 'soci' && <SociTab />}
        {scheda === 'sedi' && <SediTab />}
        {scheda === 'import' && <ImportTab />}
        {scheda === 'validare' && <ValidareTab />}
        {scheda === 'iniziative' && <IniziativeTab />}
        {scheda === 'quote' && <QuoteTab />}
        {scheda === 'report' && <ReportTab />}
        {scheda === 'guide' && <GuideTab />}
        {scheda === 'parametri' && <ParametriTab />}
      </div>
    </Ctx.Provider>
  )
}
