// ============================================================
// PAYROLL GANG SUITE — Area Emolumenti · Tipi conto
//
// Per un mese: dalle testate del liquidato DR in CSA, chi e' pagato su
// conto italiano, SEPA, extra UE, e chi e' da chiarire. Si controlla, si
// conferma, si scaricano i TXT per l'ufficio (DR_MM_AA_TIPO.txt).
//
// Il flusso d'ufficio: in CSA si fa una liquidazione "a mazza secca" di
// tutti, qui la si legge e si salva; poi in CSA la si puo' cancellare,
// l'elaborazione salvata resta.
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import {
  tipiContoApi, type TipoContoApi, type TipoContoElabApi, type TipoContoRigaApi,
} from '../api/endpoints'
import { ApiError } from '../api/client'
import { showToast } from './ToastManager'
import { ConfirmDialog } from './ConfirmDialog'

const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio',
  'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

const TIPI: Array<{ id: TipoContoApi; label: string; cls: string }> = [
  { id: 'IT',          label: 'ITA',         cls: 'text-sky-300 border-sky-900/60 bg-sky-950/30' },
  { id: 'SEPA',        label: 'SEPA',        cls: 'text-emerald-300 border-emerald-900/60 bg-emerald-950/30' },
  { id: 'EXTRA_UE',    label: 'EXTRA UE',    cls: 'text-amber-300 border-amber-900/60 bg-amber-950/30' },
  { id: 'DA_CHIARIRE', label: 'DA CHIARIRE', cls: 'text-rose-300 border-rose-900/60 bg-rose-950/30' },
]
const TIPI_FILE = ['IT', 'SEPA', 'EXTRA_UE'] as const

const btnPrimario =
  'px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm ' +
  'font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
const btnSecondario =
  'px-4 py-2 rounded-lg bg-slate-800 text-slate-200 border border-slate-700 ' +
  'text-sm hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
const btnPericolo =
  'px-4 py-2 rounded-lg bg-rose-950/40 text-rose-300 border border-rose-900/60 ' +
  'text-sm hover:bg-rose-900/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
const inputCls =
  'px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 ' +
  'text-sm focus:outline-none focus:border-indigo-500'

function periodo(e: { mese: number; anno: number }): string {
  return `${String(e.mese).padStart(2, '0')}/${e.anno}`
}

function messaggioErrore(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Errore imprevisto.'
  switch (err.code) {
    case 'CINECA_NON_CONFIGURATO':   return 'Il collegamento a CSA non è configurato sul server.'
    case 'CINECA_UNREACHABLE':       return 'CSA non risponde. Riprova tra qualche minuto.'
    case 'CINECA_API_ERROR':         return 'CSA ha restituito un errore.'
    case 'NESSUNA_TESTATA':          return 'CSA non ha testate DR per quel mese (la liquidazione esiste?).'
    case 'MESE_GIA_CONFERMATO':      return 'Per questo mese c\'è già un\'elaborazione confermata: eliminala prima di confermarne un\'altra.'
    case 'NON_CONFERMATA':           return 'I TXT si generano solo da un\'elaborazione confermata.'
    case 'NESSUNA_MATRICOLA':        return 'Nessuna matricola per questo tipo di conto.'
    case 'NAZIONE_NON_VALIDA':       return 'Nazione non valida: servono due lettere (es. DE).'
    case 'RIGA_GIA_CLASSIFICATA_DA_CSA': return 'La riga è già classificata da CSA: non si corregge a mano.'
    case 'ELABORAZIONE_NON_TROVATA': return 'Elaborazione non trovata (forse eliminata).'
    default:                         return `Errore: ${err.code}`
  }
}

/** Scarica testo UTF-8 senza BOM: TextEncoder non lo aggiunge. */
function scaricaTesto(nomeFile: string, contenuto: string): void {
  const blob = new Blob([new TextEncoder().encode(contenuto)], { type: 'text/plain;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = nomeFile
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function BadgeTipo({ tipo }: { tipo: TipoContoApi }) {
  const t = TIPI.find(x => x.id === tipo)
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs font-medium ${t?.cls ?? ''}`}>
      {t?.label ?? tipo}
    </span>
  )
}

function BadgeStato({ stato }: { stato: TipoContoElabApi['stato'] }) {
  return stato === 'confermata'
    ? <span className="px-2 py-0.5 rounded text-xs bg-emerald-950/50 text-emerald-300 border border-emerald-900/60">Confermata</span>
    : <span className="px-2 py-0.5 rounded text-xs bg-amber-950/50 text-amber-300 border border-amber-900/60">Anteprima</span>
}

// ────────────────────────────────────────────────────────────
export default function TipiContoPage() {
  const [apertaId, setApertaId] = useState<string | null>(null)
  return apertaId
    ? <Dettaglio id={apertaId} onChiudi={() => setApertaId(null)} />
    : <Elenco onApri={setApertaId} />
}

// ── Elenco ──────────────────────────────────────────────────
function Elenco({ onApri }: { onApri: (id: string) => void }) {
  const oggi = new Date()
  const [elab, setElab]       = useState<TipoContoElabApi[] | null>(null)
  const [nuova, setNuova]     = useState(false)
  const [anno, setAnno]       = useState(oggi.getFullYear())
  const [mese, setMese]       = useState(oggi.getMonth() + 1)
  const [progr, setProgr]     = useState('')
  const [lettura, setLettura] = useState(false)
  const [daEliminare, setDaEliminare] = useState<TipoContoElabApi | null>(null)

  const carica = () => {
    tipiContoApi.elenco()
      .then(r => setElab(r.elaborazioni))
      .catch(e => { setElab([]); showToast(messaggioErrore(e), 'error') })
  }
  useEffect(carica, [])

  const progrValido = progr.trim() === '' || /^\d{3}$/.test(progr.trim())

  async function recupera() {
    setLettura(true)
    try {
      const { id } = await tipiContoApi.recupera({
        anno, mese, ...(progr.trim() ? { progrLiquidazione: progr.trim() } : {}),
      })
      showToast('Testate lette da CSA.', 'success')
      onApri(id)
    } catch (e) {
      showToast(messaggioErrore(e), 'error')
    } finally {
      setLettura(false)
    }
  }

  async function elimina(e: TipoContoElabApi) {
    setDaEliminare(null)
    try {
      await tipiContoApi.archivia(e.id)
      showToast(`Elaborazione ${periodo(e)} eliminata.`, 'success')
      carica()
    } catch (err) {
      showToast(messaggioErrore(err), 'error')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-sm text-slate-400 max-w-3xl">
          Si leggono da CSA le testate del liquidato <b>DR</b> (comparto 1) di un mese e ogni
          matricola finisce in <b>ITA</b>, <b>SEPA</b>, <b>EXTRA UE</b> o <b>DA CHIARIRE</b> secondo
          la nazione su cui CSA ha pagato. Dopo la conferma si scaricano i TXT.
        </p>
        {!nuova && (
          <button className={btnPrimario} onClick={() => setNuova(true)}>Nuova elaborazione</button>
        )}
      </div>

      {nuova && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white">Nuova elaborazione da CSA</h2>
          <div className="flex flex-wrap gap-4 items-end">
            <label className="text-xs text-slate-400 space-y-1">
              <span className="block">Mese</span>
              <select className={inputCls} value={mese} onChange={e => setMese(Number(e.target.value))}>
                {MESI.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-400 space-y-1">
              <span className="block">Anno</span>
              <input type="number" className={inputCls + ' w-28'} value={anno}
                min={1990} max={2100} onChange={e => setAnno(Number(e.target.value))} />
            </label>
            <label className="text-xs text-slate-400 space-y-1">
              <span className="block">Progressivo liquidazione (facoltativo)</span>
              <input className={inputCls + ' w-40'} value={progr} placeholder="es. 039" maxLength={3}
                onChange={e => setProgr(e.target.value.replace(/\D/g, ''))} />
            </label>
            <label className="text-xs text-slate-400 space-y-1">
              <span className="block">Ruolo · comparto</span>
              <input className={inputCls + ' w-28'} value="DR · 1" disabled />
            </label>
          </div>
          {!progrValido && <p className="text-xs text-rose-300">Il progressivo ha tre cifre.</p>}
          <p className="text-xs text-slate-500">
            Senza progressivo si leggono tutte le liquidazioni del mese. La lettura può
            durare qualche minuto.
          </p>
          <div className="flex gap-2">
            <button className={btnPrimario} disabled={lettura || !progrValido || anno < 1990 || anno > 2100}
              onClick={() => void recupera()}>
              {lettura ? 'Lettura da CSA…' : 'Leggi da CSA'}
            </button>
            <button className={btnSecondario} disabled={lettura} onClick={() => setNuova(false)}>Annulla</button>
          </div>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        {elab === null ? (
          <p className="p-5 text-sm text-slate-500">Caricamento…</p>
        ) : elab.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">Nessuna elaborazione. Parti da «Nuova elaborazione».</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500 uppercase tracking-wide border-b border-slate-800">
                <tr>
                  <th className="text-left px-4 py-3">Mese</th>
                  <th className="text-left px-4 py-3">Ruolo</th>
                  <th className="text-left px-4 py-3">Stato</th>
                  {TIPI.map(t => <th key={t.id} className="text-right px-4 py-3">{t.label}</th>)}
                  <th className="text-left px-4 py-3">Letta il</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {elab.map(e => (
                  <tr key={e.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30">
                    <td className="px-4 py-3 text-white font-medium">{periodo(e)}</td>
                    <td className="px-4 py-3 text-slate-300">
                      {e.ruolo} · {e.comparto}{e.progrLiquidazione ? ` · prog. ${e.progrLiquidazione}` : ''}
                    </td>
                    <td className="px-4 py-3"><BadgeStato stato={e.stato} /></td>
                    {TIPI.map(t => (
                      <td key={t.id} className={`px-4 py-3 text-right tabular-nums ${
                        t.id === 'DA_CHIARIRE' && e.conteggi[t.id] > 0 ? 'text-rose-300' : 'text-slate-300'}`}>
                        {e.conteggi[t.id]}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-slate-400">{new Date(e.recuperataIl).toLocaleString('it-IT')}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 justify-end">
                        <button className={btnSecondario + ' !px-3 !py-1.5'} onClick={() => onApri(e.id)}>Apri</button>
                        <button className={btnPericolo + ' !px-3 !py-1.5'} onClick={() => setDaEliminare(e)}>Elimina</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={daEliminare !== null}
        danger
        title="Eliminare l'elaborazione?"
        message={daEliminare
          ? `L'elaborazione ${periodo(daEliminare)} non comparirà più nell'elenco. In CSA non cambia nulla.`
          : ''}
        confirmLabel="Elimina"
        onConfirm={() => { if (daEliminare) void elimina(daEliminare) }}
        onCancel={() => setDaEliminare(null)}
      />
    </div>
  )
}

// ── Dettaglio ───────────────────────────────────────────────
function Dettaglio({ id, onChiudi }: { id: string; onChiudi: () => void }) {
  const [dati, setDati] = useState<{ elaborazione: TipoContoElabApi; righe: TipoContoRigaApi[] } | null>(null)
  const [filtro, setFiltro]   = useState<TipoContoApi | 'tutti'>('tutti')
  const [cerca, setCerca]     = useState('')
  const [occupato, setOccupato] = useState<string | null>(null)
  const [chiedi, setChiedi]   = useState<'riclassifica' | 'elimina' | null>(null)

  const carica = () => {
    tipiContoApi.leggi(id)
      .then(setDati)
      .catch(e => { showToast(messaggioErrore(e), 'error'); onChiudi() })
  }
  useEffect(carica, [id])

  const righe = useMemo(() => {
    if (!dati) return []
    const q = cerca.trim().toLowerCase()
    return dati.righe.filter(r =>
      (filtro === 'tutti' || r.tipoConto === filtro)
      && (q === '' || r.matricola.includes(q) || (r.nominativo ?? '').toLowerCase().includes(q)))
  }, [dati, filtro, cerca])

  if (!dati) return <p className="text-sm text-slate-500">Caricamento…</p>
  const e = dati.elaborazione
  const confermata = e.stato === 'confermata'

  async function azione(nome: string, fn: () => Promise<unknown>, ok: string): Promise<boolean> {
    setOccupato(nome)
    try {
      await fn()
      showToast(ok, 'success')
      carica()
      return true
    } catch (err) {
      showToast(messaggioErrore(err), 'error')
      return false
    } finally {
      setOccupato(null)
    }
  }

  async function scarica(tipo: typeof TIPI_FILE[number]) {
    setOccupato('txt-' + tipo)
    try {
      const f = await tipiContoApi.txt(id, tipo)
      scaricaTesto(f.nomeFile, f.contenuto)
    } catch (err) {
      showToast(messaggioErrore(err), 'error')
    } finally {
      setOccupato(null)
    }
  }

  async function elimina() {
    setChiedi(null)
    try {
      await tipiContoApi.archivia(id)
      showToast(`Elaborazione ${periodo(e)} eliminata.`, 'success')
      onChiudi()
    } catch (err) {
      showToast(messaggioErrore(err), 'error')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <button className="text-sm text-slate-400 hover:text-white" onClick={onChiudi}>← Tutte le elaborazioni</button>
          <h2 className="text-lg font-semibold text-white mt-1 flex items-center gap-3">
            {MESI[e.mese - 1]} {e.anno} · {e.ruolo} · comparto {e.comparto}
            {e.progrLiquidazione && <span className="text-slate-400 font-normal">· prog. {e.progrLiquidazione}</span>}
            <BadgeStato stato={e.stato} />
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Letta da CSA il {new Date(e.recuperataIl).toLocaleString('it-IT')} · testate lette {e.testateLette},
            liquidate {e.testateLiquid} · elenco paesi: {e.elencoPaesi}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className={btnSecondario} disabled={occupato !== null} onClick={() => setChiedi('riclassifica')}>
            {occupato === 'riclassifica' ? 'Lettura da CSA…' : 'Riclassifica da CSA'}
          </button>
          {!confermata && (
            <button className={btnPrimario} disabled={occupato !== null}
              onClick={() => void azione('conferma', () => tipiContoApi.conferma(id), 'Elaborazione confermata.')}>
              Conferma
            </button>
          )}
          <button className={btnPericolo} disabled={occupato !== null} onClick={() => setChiedi('elimina')}>Elimina</button>
        </div>
      </div>

      {/* Conteggi: un clic filtra la tabella */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {TIPI.map(t => (
          <button key={t.id} type="button"
            onClick={() => setFiltro(f => f === t.id ? 'tutti' : t.id)}
            className={`text-left rounded-xl border p-4 transition ${t.cls} ${
              filtro === t.id ? 'ring-2 ring-indigo-500' : 'hover:brightness-125'}`}>
            <p className="text-xs uppercase tracking-wide opacity-80">{t.label}</p>
            <p className="text-2xl font-semibold tabular-nums mt-1">{e.conteggi[t.id]}</p>
          </button>
        ))}
      </div>

      {/* TXT */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white">Genera TXT</h3>
        {!confermata ? (
          <p className="text-xs text-slate-400">
            I file si generano dopo la conferma. Le righe DA CHIARIRE non finiscono in nessun file:
            vanno chiarite prima (nazione a mano) o restano fuori.
          </p>
        ) : e.conteggi.DA_CHIARIRE > 0 ? (
          <p className="text-xs text-rose-300">
            Attenzione: {e.conteggi.DA_CHIARIRE} matricole DA CHIARIRE non sono in nessun file.
          </p>
        ) : null}
        <div className="flex gap-2 flex-wrap">
          {TIPI_FILE.filter(t => e.conteggi[t] > 0).map(t => {
            const nome = `${e.ruolo}_${String(e.mese).padStart(2, '0')}_${String(e.anno % 100).padStart(2, '0')}_${t === 'IT' ? 'ITA' : t}.txt`
            return (
              <button key={t} className={btnSecondario} disabled={!confermata || occupato !== null}
                onClick={() => void scarica(t)}>
                {nome} <span className="text-slate-400">({e.conteggi[t]})</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Righe */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 flex items-center gap-3 flex-wrap border-b border-slate-800">
          <input className={inputCls + ' w-64'} placeholder="Cerca matricola o nome" value={cerca}
            onChange={ev => setCerca(ev.target.value)} />
          {filtro !== 'tutti' && (
            <button className="text-xs text-slate-400 hover:text-white" onClick={() => setFiltro('tutti')}>
              Filtro: {TIPI.find(t => t.id === filtro)?.label} ✕
            </button>
          )}
          <span className="text-xs text-slate-500 ml-auto">{righe.length} di {dati.righe.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 uppercase tracking-wide border-b border-slate-800">
              <tr>
                <th className="text-left px-4 py-3">Matricola</th>
                <th className="text-left px-4 py-3">Nominativo</th>
                <th className="text-left px-4 py-3">Nazione</th>
                <th className="text-left px-4 py-3">Tipo conto</th>
                <th className="text-left px-4 py-3">Progressivi</th>
                <th className="text-left px-4 py-3">Note</th>
              </tr>
            </thead>
            <tbody>
              {righe.map(r => (
                <RigaTabella key={r.matricola} r={r} disabilitata={occupato !== null}
                  onSalva={(nazIban, nota) => azione('manuale-' + r.matricola,
                    () => tipiContoApi.nazioneManuale(id, r.matricola, { nazIban, nota }),
                    confermata
                      ? `Nazione salvata per ${r.matricola}. L'elaborazione torna in anteprima: va riconfermata.`
                      : `Nazione salvata per ${r.matricola}.`)} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={chiedi === 'riclassifica'}
        title="Riclassificare da CSA?"
        message={`Si rileggono da CSA le testate di ${periodo(e)} e le righe vengono sostituite. Le nazioni inserite a mano restano dove CSA continua a non darle. L'elaborazione torna in anteprima.`}
        confirmLabel="Rileggi da CSA"
        onConfirm={() => { setChiedi(null); void azione('riclassifica', () => tipiContoApi.riclassifica(id), 'Righe aggiornate da CSA.') }}
        onCancel={() => setChiedi(null)}
      />
      <ConfirmDialog
        open={chiedi === 'elimina'}
        danger
        title="Eliminare l'elaborazione?"
        message={`L'elaborazione ${periodo(e)} non comparirà più nell'elenco. In CSA non cambia nulla.`}
        confirmLabel="Elimina"
        onConfirm={() => void elimina()}
        onCancel={() => setChiedi(null)}
      />
    </div>
  )
}

function RigaTabella({ r, disabilitata, onSalva }: {
  r: TipoContoRigaApi
  disabilitata: boolean
  onSalva: (nazIban: string, nota: string) => Promise<boolean>
}) {
  const modificabile = r.tipoConto === 'DA_CHIARIRE' || r.fonte === 'manuale'
  const [aperta, setAperta] = useState(false)
  const [naz, setNaz]       = useState(r.nazIban ?? '')
  const [nota, setNota]     = useState(r.nota ?? '')
  const valida = /^[A-Za-z]{2}$/.test(naz.trim()) && nota.trim().length >= 3

  return (
    <tr className="border-b border-slate-800/60 last:border-0 align-top">
      <td className="px-4 py-2.5 font-mono text-slate-200">{r.matricola}</td>
      <td className="px-4 py-2.5 text-slate-300">{r.nominativo ?? <span className="text-slate-600">—</span>}</td>
      <td className="px-4 py-2.5 font-mono text-slate-300">{r.nazIban ?? <span className="text-slate-600">—</span>}</td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <BadgeTipo tipo={r.tipoConto} />
          {r.fonte === 'manuale' && (
            <span title={r.nota ?? ''} className="px-1.5 py-0.5 rounded text-[10px] uppercase bg-violet-950/50 text-violet-300 border border-violet-900/60">
              manuale
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{r.progressivi}</td>
      <td className="px-4 py-2.5 text-xs text-slate-400 min-w-[16rem]">
        {r.motivo && <p className="text-rose-300">{r.motivo}</p>}
        {r.fonte === 'manuale' && r.nota && <p>{r.nota}</p>}
        {r.suggerimento && (
          <p className="text-slate-500">
            Anagrafica PGS: <span className="font-mono text-slate-300">{r.suggerimento.nazIban}</span>
            {' '}({r.suggerimento.tipoConto === 'IT' ? 'ITA' : r.suggerimento.tipoConto.replace('_', ' ')}) — solo suggerimento
          </p>
        )}
        {modificabile && !aperta && (
          <button className="mt-1 text-indigo-300 hover:text-indigo-200" disabled={disabilitata}
            onClick={() => setAperta(true)}>
            {r.fonte === 'manuale' ? 'Modifica nazione' : 'Inserisci nazione a mano'}
          </button>
        )}
        {aperta && (
          <div className="mt-2 space-y-2">
            <div className="flex gap-2">
              <input className={inputCls + ' w-16 font-mono uppercase'} maxLength={2} placeholder="DE"
                value={naz} onChange={ev => setNaz(ev.target.value.replace(/[^A-Za-z]/g, '').toUpperCase())} />
              {r.suggerimento && naz === '' && (
                <button className="text-xs text-slate-400 hover:text-white"
                  onClick={() => setNaz(r.suggerimento!.nazIban)}>
                  usa {r.suggerimento.nazIban}
                </button>
              )}
            </div>
            <input className={inputCls + ' w-full'} maxLength={300}
              placeholder="Da dove viene (es. verificato in CSA, email del dottorando)"
              value={nota} onChange={ev => setNota(ev.target.value)} />
            <div className="flex gap-2">
              <button className={btnPrimario + ' !px-3 !py-1.5'} disabled={!valida || disabilitata}
                onClick={() => void onSalva(naz.trim().toUpperCase(), nota.trim()).then(ok => { if (ok) setAperta(false) })}>
                Salva
              </button>
              <button className={btnSecondario + ' !px-3 !py-1.5'} onClick={() => setAperta(false)}>Annulla</button>
            </div>
          </div>
        )}
      </td>
    </tr>
  )
}
