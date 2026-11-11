// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · rubrica d'Ateneo (26.11.11.3)
//
// «Cerca nella rubrica d'Ateneo»: propone l'email di una persona dal
// portale dell'Ateneo (il server fa la chiamata; il codice fiscale non
// arriva mai qui). Riempie il campo e basta: si salva con «Salva».
// Con piu' persone dallo stesso nome mostra ruolo e afferenza e si sceglie.
// StatoRubrica (Parametri): connessione e scadenza dei certificati.
// ============================================================

import { useEffect, useState } from 'react'
import { cralApi, type EsitoRubricaApi, type PersonaRubricaApi, type StatoRubricaApi } from '../../api/endpoints'
import { btnPiccoloSec, cardCls, etichettaCls, messaggioErrore } from './ui'
import { fmtData } from './logica'

export type QueryRubrica = { socio?: string; matricola?: string; cognome?: string; nome?: string }
const COME: Record<'idAb' | 'codice fiscale' | 'nome', string> = { idAb: 'per matricola', 'codice fiscale': 'per codice fiscale', nome: 'per cognome e nome' }

/** Testo breve dell'origine, da mostrare sotto il campo. */
export const daRubrica = (come: keyof typeof COME) => `Dalla rubrica d'Ateneo, ${COME[come]}: controlla e salva`

export function CercaRubrica({ query, onEmail, disabled }: { query: QueryRubrica; onEmail: (email: string, nota: string) => void; disabled?: boolean }) {
  const [stato, setStato] = useState<'pronto' | 'cerco' | 'fatto'>('pronto')
  const [msg, setMsg] = useState('')
  const [candidati, setCandidati] = useState<PersonaRubricaApi[]>([])
  async function cerca() {
    setStato('cerco'); setMsg(''); setCandidati([])
    try {
      const r: EsitoRubricaApi = await cralApi.rubrica(query)
      if (r.esito === 'TROVATA') {
        if (r.persona.email) { onEmail(r.persona.email, daRubrica(r.come)); setMsg('') }
        else setMsg(`In rubrica (${r.persona.ruolo || 'senza ruolo'}) ma senza email pubblicata.`)
      } else if (r.esito === 'CANDIDATI') {
        setCandidati(r.candidati)
        setMsg('Più persone con questo nome: scegli quella giusta.')
      } else setMsg('Non trovata nella rubrica d\'Ateneo.')
    } catch (e) { setMsg(messaggioErrore(e)) }
    setStato('fatto')
  }
  return (
    <div className="flex flex-col gap-1.5 mt-1">
      <button type="button" className={btnPiccoloSec + ' self-start text-xs'} disabled={disabled || stato === 'cerco'} onClick={() => void cerca()}>
        {stato === 'cerco' ? 'Cerco nella rubrica…' : 'Cerca nella rubrica d\'Ateneo'}
      </button>
      {msg && <span className="text-xs text-slate-400">{msg}</span>}
      {candidati.length > 0 && <div className="flex flex-col gap-1">
        {candidati.map(c => (
          <button key={c.idAb} type="button" disabled={!c.email} className="text-left text-xs rounded-lg border border-slate-700 px-2.5 py-1.5 hover:bg-slate-800 disabled:opacity-50"
            onClick={() => { onEmail(c.email, `Dalla rubrica d'Ateneo, scelta fra omonimi (${c.ruolo}): controlla e salva`); setCandidati([]); setMsg('') }}>
            <span className="text-slate-100">{c.cognome} {c.nome}</span> · <span className="text-slate-300">{c.ruolo || 'ruolo non indicato'}</span>
            <span className="block text-slate-500">{c.afferenza || '—'} · {c.email || 'email non pubblicata'}</span>
          </button>))}
      </div>}
    </div>
  )
}

/** Email proposta in automatico (Nuova persona, dipendente dall'anagrafica): solo se il campo è vuoto. */
export function useEmailDaRubrica(matricola: string | null | undefined, vuoto: boolean, onEmail: (email: string, nota: string) => void) {
  useEffect(() => {
    if (!matricola || !vuoto) return
    let vivo = true
    cralApi.rubrica({ matricola }).then(r => {
      if (vivo && r.esito === 'TROVATA' && r.persona.email) onEmail(r.persona.email, daRubrica(r.come))
    }).catch(() => { /* in automatico: se la rubrica non risponde resta il pulsante */ })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matricola])
}

/** Parametri: la rubrica risponde? I certificati scadono? */
export function StatoRubrica() {
  const [s, setS] = useState<StatoRubricaApi | null>(null)
  const [prova, setProva] = useState(false)
  const [err, setErr] = useState('')
  const carica = (p: boolean) => { setProva(p); setErr(''); cralApi.rubricaStato(p).then(setS).catch(e => setErr(messaggioErrore(e))).finally(() => setProva(false)) }
  useEffect(() => { carica(false) }, [])
  const giorni = (g?: number) => (g === undefined ? '' : g < 0 ? 'scaduto' : `fra ${g} giorni`)
  const srv = s?.ultimo?.server
  return (
    <div className={`${cardCls} p-5 flex flex-col gap-3`}>
      <div><p className="text-sm font-medium text-white">Rubrica d'Ateneo</p>
        <p className="text-xs text-slate-500 mt-0.5">Da qui PGS propone l'email dei soci (scheda e Nuova persona). La connessione è sempre verificata; il certificato intermedio dell'Ateneo è dentro PGS e qui se ne vede la scadenza.</p></div>
      {err && <p className="text-xs text-red-300">{err}</p>}
      {s && <div className="text-xs text-slate-400 flex flex-col gap-1">
        <span>Ultimo contatto: {s.ultimo ? <>{fmtData(s.ultimo.il.slice(0, 10))} · {s.ultimo.esito === 'OK' ? <span className="text-emerald-300">riuscito</span> : <span className="text-red-300">fallito: {s.ultimo.errore}</span>}</> : 'nessuno da quando il server è partito'}</span>
        {srv && <span>Certificato del server: scade il <span className="text-slate-200">{fmtData(srv.scade.slice(0, 10))}</span> ({giorni(srv.giorni)}) · firmato da <span className="text-slate-300">{(srv.emittente.match(/CN=([^,]+)/)?.[1]) ?? srv.emittente}</span></span>}
        {s.intermedio.info && <span>Certificato intermedio in PGS: scade il <span className="text-slate-200">{fmtData(s.intermedio.info.scade.slice(0, 10))}</span> ({giorni(s.intermedio.info.giorni)}) · {s.intermedio.ok ? <span className="text-emerald-300">integro</span> : <span className="text-red-300">{s.intermedio.motivo}</span>}</span>}
        <span className={etichettaCls + ' mt-1'}>Avvisi</span>
        {s.avvisi.length ? s.avvisi.map(a => <span key={a} className="text-amber-300">• {a}</span>) : <span className="text-emerald-300">Nessuno</span>}
      </div>}
      <button type="button" className={btnPiccoloSec + ' self-start'} disabled={prova} onClick={() => carica(true)}>{prova ? 'Verifico…' : 'Verifica ora'}</button>
    </div>
  )
}
