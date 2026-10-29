// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · componenti condivisi
// Stesse classi di versamenti/ui.tsx; in più modale, interruttore,
// pillole delle tipologie e il contesto con lo stato del modulo.
// ============================================================

import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { ApiError } from '../../api/client'
import { showToast } from '../ToastManager'
import type { AnagraficaPgs, Db, Lotto, PatchScelta, Persona, QuotaSocio, Richiesta } from './tipi'
import { RELAZIONI, TIPOLOGIE, fmtData, nominativo, sociDi } from './logica'

export { btnPrimario, btnSecondario, btnPiccolo, inputCls, cardCls, etichettaCls } from '../versamenti/ui'
import { btnPiccolo, btnPrimario, btnSecondario, cardCls, etichettaCls, inputCls } from '../versamenti/ui'

/** Campo senza w-full: per i campi a larghezza fissa (w-24, w-32…), che altrimenti perderebbero contro w-full. */
export const inputW = inputCls.replace('w-full ', '')
export const btnPiccoloSec = btnPiccolo + ' bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'
export const btnPericolo = 'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600/90 hover:bg-red-500 text-white text-sm font-medium transition-colors disabled:opacity-40'
export const thCls = 'px-3 py-2.5 font-semibold'
export const chipCls = (on: boolean): string => `${btnPiccolo} border ${on ? 'bg-indigo-600/20 text-indigo-300 border-indigo-700' : 'bg-slate-800 text-slate-300 border-slate-700'}`
export const sceltaCls = (on: boolean): string => `text-left rounded-lg border px-3 py-2.5 transition-colors ${on ? 'border-indigo-500 bg-indigo-950/30' : 'border-slate-700 hover:border-slate-600'}`

export type Tono = 'nuovo' | 'warn' | 'ok' | 'neutro' | 'cf' | 'err' | 'cyan' | 'fam'
const TONI: Record<Tono, string> = {
  nuovo:  'bg-indigo-900/50 text-indigo-300 border-indigo-700',
  warn:   'bg-amber-900/50 text-amber-400 border-amber-800',
  ok:     'bg-emerald-900/40 text-emerald-300 border-emerald-800',
  neutro: 'bg-slate-800 text-slate-400 border-slate-700',
  cf:     'bg-violet-900/40 text-violet-300 border-violet-800',
  err:    'bg-red-950/50 text-red-300 border-red-800',
  cyan:   'bg-cyan-950/50 text-cyan-300 border-cyan-800',
  fam:    'bg-pink-950/40 text-pink-300 border-pink-800',
}
export function Pill({ children, tono = 'neutro', title }: { children: ReactNode; tono?: Tono; title?: string }) {
  return <span title={title} className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${TONI[tono]}`}>{children}</span>
}

export const Ico = ({ d, cls = 'w-4 h-4' }: { d: string | string[]; cls?: string }) => (
  <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    {(Array.isArray(d) ? d : [d]).map((p, i) => <path key={i} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={p} />)}
  </svg>
)
export const D = {
  download: 'M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3',
  upload: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12',
  plus: 'M12 4v16m8-8H4',
  check: 'M5 13l4 4L19 7',
  x: 'M6 18L18 6M6 6l12 12',
  search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  link: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
  back: 'M15 19l-7-7 7-7',
  trash: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
  doc: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  copy: 'M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z',
  edit: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
}

export function Modale({ titolo, sotto, onClose, children, piedi, largo }: {
  titolo: ReactNode; sotto?: ReactNode; onClose: () => void; children: ReactNode; piedi?: ReactNode; largo?: boolean
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" className={`${cardCls} shadow-2xl w-full ${largo ? 'max-w-5xl' : 'max-w-xl'} flex flex-col max-h-[92vh]`}>
        <div className="flex items-start gap-3 px-5 py-4 border-b border-slate-800">
          <div className="flex-1 min-w-0"><h3 className="text-white font-semibold">{titolo}</h3>{sotto && <p className="text-xs text-slate-500 mt-0.5">{sotto}</p>}</div>
          <button onClick={onClose} className="p-1 rounded-md text-slate-500 hover:text-white hover:bg-slate-800" aria-label="Chiudi"><Ico d={D.x} /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0">{children}</div>
        {piedi && <div className="px-5 py-3 border-t border-slate-800 flex flex-wrap justify-end gap-2">{piedi}</div>}
      </div>
    </div>
  )
}

export function Conferma({ testo, dettaglio, etichetta = 'Conferma', pericolo, onOk, onClose }: {
  testo: string; dettaglio: ReactNode; etichetta?: string; pericolo?: boolean; onOk: () => void; onClose: () => void
}) {
  return (
    <Modale titolo={testo} onClose={onClose} piedi={<>
      <button className={btnSecondario} onClick={onClose}>Annulla</button>
      <button className={pericolo ? btnPericolo : btnPrimario} onClick={() => { onOk(); onClose() }}>{etichetta}</button>
    </>}>
      <p className="text-sm text-slate-300">{dettaglio}</p>
    </Modale>
  )
}

export function Campo({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return <label className="flex flex-col gap-1.5 min-w-0"><span className={etichettaCls}>{label}</span>{children}{hint && <span className="text-xs text-slate-500">{hint}</span>}</label>
}

export function Interruttore({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} className="inline-flex items-center gap-2 text-sm text-slate-300 text-left disabled:opacity-40">
      <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-indigo-600' : 'bg-slate-700'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>{label}
    </button>
  )
}

export function StatoSocio({ s }: { s: Persona }) {
  if (s.stato === 'ATTIVO') return <Pill tono="ok">Attivo</Pill>
  if (s.stato === 'DA_VALIDARE') return <Pill tono="warn">Da validare</Pill>
  if (s.stato === 'RIFIUTATO') return <Pill tono="err">Rifiutato</Pill>
  if (s.stato === 'ELIMINATO') return <Pill tono="err" title={`Eliminato il ${fmtData(s.eliminatoIl)}${s.statoPrima ? ` · prima: ${s.statoPrima.toLowerCase().replace('_', ' ')}` : ''}`}>Eliminato</Pill>
  return <Pill>Cessato</Pill>
}
export function Origine({ s }: { s: Pick<Persona, 'tipo'> }) {
  const [l, t, d] = TIPOLOGIE[s.tipo]
  return <Pill tono={t} title={d}>{l}</Pill>
}
export function DiChi({ db, s }: { db: Db; s: Persona }) {
  const ls = sociDi(db, s)
  return ls.length ? <span className="text-xs text-slate-500">{ls.map(l => `${RELAZIONI[l.relazione]} di ${nominativo(l.s)}`).join(' · ')}</span> : null
}
export function TipoChip({ db, id }: { db: Db; id: string }) {
  const t = db.tipi.find(x => x.id === id)
  return <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300"><span className="w-2 h-2 rounded-full" style={{ background: t?.colore ?? '#64748b' }} />{t?.nome ?? id}{t?.pagamento && <span className="text-[10px] text-pink-300 uppercase tracking-wider">a pagamento</span>}</span>
}
/** Persona dell'anagrafica PGS: matricola, nominativo, ruolo, eventuale cessazione. */
export function PersonaPgs({ a }: { a: AnagraficaPgs }) {
  return <span className="inline-flex items-center gap-2 flex-wrap"><span className="font-mono text-indigo-300">{a.matricola}</span><span className="text-slate-100">{a.cognome} {a.nome}</span>
    {a.ruolo && <span className="text-xs text-slate-500">{a.ruolo}</span>}{a.finRap && <Pill title={`Rapporto cessato il ${fmtData(a.finRap)}`}>cessato {a.finRap.slice(0, 4)}</Pill>}</span>
}

/** Scarica un file generato nel browser. */
export function scarica(nome: string, blob: Blob): void {
  const url = URL.createObjectURL(blob); const a = document.createElement('a')
  a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Legge un file scelto dall'utente in base64 (va al server, che lo legge: il client non ha librerie per xlsx). */
export async function fileBase64(f: File): Promise<string> {
  const buf = new Uint8Array(await f.arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(s)
}

// ── Errori del server in italiano ────────────────────────────
const ERRORI: Record<string, string> = {
  TESSERA_DOPPIA: 'Tessera già assegnata a un altro socio.',
  MATRICOLA_GIA_SOCIO: 'Questa matricola è già nel CRAL.',
  SOCIO_NON_TROVATO: 'Persona non trovata: ricarica la pagina.',
  SEDE_SCONOSCIUTA: 'Sede sconosciuta.',
  LEGAME_NON_VALIDO: 'Un familiare va legato a soci dipendenti o soci esterni.',
  STATO_NON_VALIDO: 'Operazione non ammessa in questo stato.',
  SUFFISSI_ESAURITI: 'Suffissi esauriti: serve un nuovo numero di tessera.',
  NOME_GIA_USATO: 'Nome già usato.',
  TIPO_SCONOSCIUTO: 'Tipo di evento sconosciuto.',
  MATRICOLA_NON_IN_ANAGRAFICA: 'Matricola non presente in anagrafica PGS.',
  MATRICOLA_MANCANTE: 'Per un socio dipendente serve la matricola.',
  COGNOME_MANCANTE: 'Manca il cognome.',
  EVENTO_NON_TROVATO: 'Evento non trovato: ricarica la pagina.',
  EVENTO_ARCHIVIATO: 'Evento archiviato: sola lettura.',
  MODALITA_IN_USO: 'Ci sono già scelte o movimenti: la modalità non si cambia.',
  OPZIONE_IN_USO: "Un'opzione tolta è già stata scelta.",
  PRODOTTO_IN_USO: 'Un prodotto tolto è già stato ordinato.',
  PERIODO_IN_USO: 'Una settimana tolta ha già iscritti.',
  ARTICOLO_IN_USO: 'Un articolo tolto ha già carichi o richieste.',
  OPZIONI_INSUFFICIENTI: 'Servono almeno due opzioni.',
  NESSUN_PRODOTTO: 'Serve almeno un prodotto.',
  NESSUN_PERIODO: 'Serve almeno una settimana.',
  QUOTA_MANCANTE: 'Manca la quota a settimana.',
  NESSUN_ARTICOLO: 'Serve almeno un articolo.',
  NESSUN_GRUPPO: 'Scegli almeno un gruppo di partecipanti.',
  PREDEFINITA_SCONOSCIUTA: 'Opzione predefinita non valida.',
  ID_RIPETUTI: 'Elementi ripetuti nella configurazione.',
  OPZIONE_SCONOSCIUTA: "Opzione non prevista dall'evento.",
  PRODOTTO_SCONOSCIUTO: "Prodotto non previsto dall'evento.",
  QUANTITA_NON_INTERA: 'Quantità non intera per un prodotto al pezzo.',
  OLTRE_IL_MASSIMO: 'Quantità oltre il massimo a testa.',
  PERIODO_SCONOSCIUTO: "Settimana non prevista dall'evento.",
  ARTICOLO_SCONOSCIUTO: "Articolo non previsto dall'evento.",
  RICHIESTA_NON_TROVATA: 'Richiesta non trovata: ricarica la pagina.',
  DATA_CONSEGNA_MANCANTE: 'Manca la data di consegna.',
  NON_E_SOCIO: 'La quota riguarda solo i soci.',
  TRATTENUTA_SENZA_MATRICOLA: 'La trattenuta in busta paga richiede la matricola.',
  ANNO_NON_IMPOSTATO: "Anno non impostato: aggiungilo in Parametri.",
  FILE_TROPPO_GRANDE: 'File troppo grande (massimo 5 MB).',
  FORMATO_NON_SUPPORTATO: 'Formato non supportato: usa .xlsx, .xls o .csv.',
  FILE_NON_LEGGIBILE: 'File non leggibile.',
  VALIDATION_ERROR: 'Dati non validi.',
  FORBIDDEN: 'Operazione riservata agli amministratori.',
  LOTTO_NON_TROVATO: 'Lotto non trovato: ricarica la pagina.',
  LOTTO_CHIUSO: 'Il lotto è già chiuso.',
  ARCHIVIO_NON_VALIDO: 'Il file non è un archivio CRAL valido (esportato da PGS 26.10.29 o successivo).',
  NESSUNA_SEZIONE: 'Scegli almeno una sezione.',
}
export function messaggioErrore(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Errore imprevisto.'
  return ERRORI[err.code] ?? `Errore (${err.code}).`
}

// ── Contesto del modulo ──────────────────────────────────────
export type Scheda = 'soci' | 'sedi' | 'import' | 'validare' | 'iniziative' | 'quote' | 'report' | 'guide' | 'parametri'
export interface CralCtx {
  db: Db
  /** Lotti di variazioni (aperti e recenti). */
  lotti: Lotto[]
  utente: string
  vaiA: (s: Scheda) => void
  ricarica: () => Promise<void>
  /** Chiamata al server, poi ricarica dello stato. Ritorna null se è fallita (il messaggio è già mostrato). */
  esegui: <T>(fn: () => Promise<T>, ok?: string | ((r: T) => string), livello?: 'success' | 'info' | 'warning') => Promise<T | null>
  /** Modifica di una scelta, subito a video e poi sul server. */
  scelta: (iniziativa: string, socio: string, patch: PatchScelta, fonte?: 'manuale' | 'modulo' | 'predefinita') => void
  /** Modifica di una richiesta di biglietti, subito a video e poi sul server. */
  richiesta: (iniziativa: string, rid: string, patch: Partial<Pick<Richiesta, 'stato' | 'dataCons' | 'modo' | 'pagato' | 'sconto' | 'note'>>) => Promise<boolean>
  /** Modifica della quota di un socio, subito a video e poi sul server. */
  quota: (anno: number, socio: string, prima: QuotaSocio, patch: Partial<QuotaSocio>) => void
}
export const Ctx = createContext<CralCtx | null>(null)
export function useCral(): CralCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useCral fuori da CralPage')
  return c
}
export const avviso = (m: string, l: 'success' | 'info' | 'warning' | 'error' = 'success') => showToast(m, l)
