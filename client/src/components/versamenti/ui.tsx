// ============================================================
// PAYROLL GANG SUITE — Versamenti enti · piccoli componenti condivisi
// ============================================================

import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { versamentiApi, type VersamentoEnteApi } from '../../api/endpoints'
import { ApiError } from '../../api/client'
import { showToast } from '../ToastManager'

export const btnPrimario =
  'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm ' +
  'font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
export const btnSecondario =
  'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 text-slate-200 border border-slate-700 ' +
  'text-sm hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
export const btnPiccolo =
  'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ' +
  'disabled:opacity-40 disabled:cursor-not-allowed'
export const inputCls =
  'w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-600 ' +
  'text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30'
export const cardCls = 'bg-slate-900 border border-slate-800 rounded-xl'
export const etichettaCls = 'text-[11px] font-semibold uppercase tracking-wider text-slate-500'

export function Pill({ children, tono }: { children: ReactNode; tono: 'nuovo' | 'warn' | 'ok' | 'neutro' | 'cf' }) {
  const cls = {
    nuovo:  'bg-indigo-900/50 text-indigo-300 border-indigo-700',
    warn:   'bg-amber-900/50 text-amber-400 border-amber-800',
    ok:     'bg-emerald-900/40 text-emerald-300 border-emerald-800',
    neutro: 'bg-slate-800 text-slate-400 border-slate-700',
    cf:     'bg-violet-900/40 text-violet-300 border-violet-800',
  }[tono]
  return <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${cls}`}>{children}</span>
}

export const IconaDownload = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
  </svg>
)
export const IconaOcchio = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
)

export function messaggioErrore(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Errore imprevisto.'
  switch (err.code) {
    case 'EMAIL_NON_VALIDA':             return 'Uno degli indirizzi non è valido.'
    case 'TROPPE_EMAIL':                 return 'Al massimo 20 indirizzi per ente.'
    case 'ENTE_NON_TROVATO':             return 'Ente non trovato: ricarica la pagina.'
    case 'MODELLO_NON_TROVATO':          return 'Modello non trovato: ricarica la pagina.'
    case 'MODELLO_PREDEFINITO':          return 'Il modello predefinito non si elimina: scegline prima un altro come predefinito.'
    case 'NOME_GIA_USATO':               return 'Esiste già un modello con questo nome.'
    case 'SEGNAPOSTO_SCONOSCIUTO':       return 'Il modello contiene un segnaposto sconosciuto.'
    case 'SEGNAPOSTO_FILE_SCONOSCIUTO':  return 'Nei nomi dei file sono ammessi solo {CODICE_ENTE} e {PERIODO_FILE}.'
    case 'COLONNE_RIPETUTE':             return 'Una colonna compare due volte.'
    case 'NESSUNA_COLONNA':              return 'Scegli almeno una colonna per gli allegati.'
    case 'VALIDATION_ERROR':             return 'Dati non validi.'
    default:                             return `Errore (${err.code}).`
  }
}

/** Interruttore abilitato/disabilitato, salvato subito. */
export function InterruttoreEnte({ ente, onAggiornato }: { ente: VersamentoEnteApi; onAggiornato: (e: VersamentoEnteApi) => void }) {
  const [busy, setBusy] = useState(false)
  async function cambia(ev: MouseEvent) {
    ev.stopPropagation()
    setBusy(true)
    try {
      const { ente: e } = await versamentiApi.aggiornaEnte(ente.codice, { abilitato: !ente.abilitato })
      onAggiornato(e)
      showToast(`${e.descrizione}: ${e.abilitato ? 'abilitato' : 'disabilitato'}`, 'success')
    } catch (err) { showToast(messaggioErrore(err), 'error') }
    finally { setBusy(false) }
  }
  const on = ente.abilitato
  return (
    <button type="button" role="switch" aria-checked={on} disabled={busy} onClick={cambia}
      title={on ? 'Abilitato: clic per disabilitare' : 'Disabilitato: clic per abilitare'}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-indigo-600' : 'bg-slate-700'}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}

/**
 * Indirizzi dell'ente, anche piu' di uno separati da virgola. Si salva
 * all'uscita dal campo o con Invio; un indirizzo sbagliato resta nel campo
 * con l'errore sotto, e nulla viene salvato.
 */
export function CampoEmail({ ente, onAggiornato }: { ente: VersamentoEnteApi; onAggiornato: (e: VersamentoEnteApi) => void }) {
  const salvato = ente.email.join(', ')
  const [testo, setTesto] = useState(salvato)
  const [errore, setErrore] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setTesto(salvato); setErrore(null) }, [salvato])

  async function salva() {
    if (testo.trim() === salvato) { setErrore(null); return }
    setBusy(true)
    try {
      const { ente: e } = await versamentiApi.aggiornaEnte(ente.codice, { email: testo })
      setErrore(null)
      onAggiornato(e)
      showToast(e.email.length ? `Email salvate per ${e.descrizione}` : `Email rimosse per ${e.descrizione}`, 'success')
    } catch (err) {
      setErrore(err instanceof ApiError && err.code === 'EMAIL_NON_VALIDA'
        ? 'Un indirizzo non è valido. Separa più indirizzi con la virgola.'
        : messaggioErrore(err))
    } finally { setBusy(false) }
  }

  return (
    <div className="min-w-[220px]" onClick={e => e.stopPropagation()}>
      <input
        value={testo} disabled={busy}
        onChange={e => setTesto(e.target.value)}
        onBlur={salva}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        placeholder="indirizzo@ente.it, altro@ente.it"
        aria-label={`Email di ${ente.descrizione}`}
        className={`${inputCls} !py-1.5 !text-xs font-mono ${errore ? '!border-red-700' : ''}`}
      />
      {errore && <p className="text-[11px] text-red-400 mt-1">{errore}</p>}
    </div>
  )
}
