// ============================================================
// PAYROLL GANG SUITE — Impostazioni · Esporta e importa
//
// Porta i dati da un'installazione di PGS a un'altra (produzione ↔
// pre-produzione) in un file cifrato .pgsx. In questa versione: il CRAL.
//
// ESPORTA: si scelgono le parti, si conferma con il codice OTP, si scarica
// il file. La frase che lo apre la genera il server e si vede UNA volta.
// IMPORTA: il file si carica a pezzi, il server lo apre con la frase,
// verifica che sia integro e che lo schema del database sia lo stesso, e
// prepara un lotto da validare nel modulo CRAL (confronto campo per campo,
// Prova). Da qui non si scrive mai nei dati.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { trasferimentoApi, type TrasferimentoAperto, type TrasferimentoStato } from '../../api/endpoints'
import { useStore } from '../../store/useStore'
import { showToast } from '../ToastManager'
import type { SezioneLotto } from '../cral/tipi'

const PARTI: Array<[SezioneLotto, string]> = [
  ['sedi', 'Sedi'], ['tabelle', 'Parametri e tabelle'], ['soci', 'Soci e familiari'], ['quote', 'Quote associative'], ['eventi', 'Eventi'],
]
const ERRORI: Record<string, string> = {
  OTP_NON_VALIDO: 'Codice non valido. Il codice usato per entrare non vale una seconda volta: aspetta il successivo.',
  ACCOUNT_LOCKED: 'Troppi codici sbagliati: account bloccato per 15 minuti.',
  FILE_O_FRASE_NON_VALIDI: 'La frase non apre questo file (frase sbagliata o file alterato).',
  TROPPI_TENTATIVI: 'Troppi tentativi con la frase sbagliata: il file è stato scartato. Ricaricalo.',
  FILE_NON_VALIDO: 'Non è un file .pgsx esportato da PGS.',
  VERSIONE_NON_SUPPORTATA: 'File scritto da una versione più recente di PGS: aggiorna questo ambiente.',
  FILE_TROPPO_GRANDE: 'File troppo grande.',
  CONTENUTO_NON_VALIDO: 'Il file si apre ma il contenuto non è quello atteso: esportalo di nuovo.',
  CARICAMENTO_NON_TROVATO: 'Caricamento scaduto (dura 15 minuti): ricarica il file.',
  TROPPI_CARICAMENTI: 'Ci sono già altri caricamenti in corso: riprova fra qualche minuto.',
  FILE_INCOMPLETO: 'Il file non è arrivato per intero: ricaricalo.',
  FILE_NON_APERTO: 'Il file non è stato ancora aperto.',
  FILE_GIA_APERTO: 'Il file è già stato aperto.',
  SCHEMA_DIVERSO: 'Lo schema del database è cambiato nel frattempo: ricarica il file.',
  NESSUNA_SEZIONE: 'Scegli almeno una parte.',
  VALIDATION_ERROR: 'Dati non validi.',
  FORBIDDEN: 'Operazione riservata agli amministratori.',
  RATE_LIMIT_EXCEEDED: 'Troppe richieste: riprova fra un minuto.',
}
const msg = (e: unknown): string => (e instanceof ApiError ? ERRORI[e.code] ?? `Errore (${e.code}).` : 'Errore imprevisto.')
const quando = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) }
const kb = (n: number): string => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} kB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

function base64Di(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}
function scarica(nome: string, base64: string): void {
  const bin = atob(base64), b = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([b], { type: 'application/octet-stream' })); const a = document.createElement('a')
  a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const card = 'bg-slate-900 border border-slate-800 rounded-xl p-5 mb-4'
const input = 'px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'
const btn = 'px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition disabled:opacity-40'
const btn2 = 'px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-sm font-medium transition disabled:opacity-40'

function Parti({ righe, presenti, scelte, onChange }: { righe: Partial<Record<SezioneLotto, number>>; presenti?: SezioneLotto[]; scelte: Set<SezioneLotto>; onChange: (s: Set<SezioneLotto>) => void }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2">
      {PARTI.map(([id, nome]) => {
        const c = !presenti || presenti.includes(id)
        return (
          <label key={id} className={`inline-flex items-center gap-1.5 text-sm ${c ? 'text-slate-300' : 'text-slate-600'}`}>
            <input type="checkbox" className="accent-indigo-500" disabled={!c} checked={scelte.has(id)}
              onChange={() => { const n = new Set(scelte); if (n.has(id)) n.delete(id); else n.add(id); onChange(n) }} />
            {nome} <span className="text-xs text-slate-500">{c ? righe[id] ?? 0 : 'non nel file'}</span>
          </label>)
      })}
    </div>)
}

export default function EsportaImporta() {
  const navigate = useStore(s => s.navigate)
  const [stato, setStato] = useState<TrasferimentoStato | null>(null)
  const [errStato, setErrStato] = useState(false)
  useEffect(() => { trasferimentoApi.stato().then(setStato).catch(() => setErrStato(true)) }, [])

  // ── Esporta ────────────────────────────────────────────────
  const [parti, setParti] = useState<Set<SezioneLotto>>(new Set(PARTI.map(p => p[0])))
  const [otp, setOtp] = useState('')
  const [esporto, setEsporto] = useState(false)
  const [uscita, setUscita] = useState<{ nome: string; byte: number; frase: string } | null>(null)
  async function esporta() {
    setEsporto(true)
    try {
      const r = await trasferimentoApi.esporta(PARTI.map(p => p[0]).filter(p => parti.has(p)), otp)
      scarica(r.nome, r.base64)
      setUscita({ nome: r.nome, byte: r.byte, frase: r.frase })
    } catch (e) { showToast(msg(e), 'error') }
    setOtp(''); setEsporto(false)
  }

  // ── Importa ────────────────────────────────────────────────
  const inp = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [frase, setFrase] = useState('')
  const [lavoro, setLavoro] = useState<string | null>(null)
  const [caricato, setCaricato] = useState<string | null>(null)   // id del caricamento sul server
  const [aperto, setAperto] = useState<TrasferimentoAperto | null>(null)
  const [daImportare, setDaImportare] = useState<Set<SezioneLotto>>(new Set())
  const [lotto, setLotto] = useState<{ id: string; variazioni: number } | null>(null)
  function azzera(tieniFile = false) {
    if (caricato) void trasferimentoApi.abbandona(caricato).catch(() => { /* scade da solo */ })
    setCaricato(null); setAperto(null); setLotto(null); setFrase(''); if (!tieniFile) setFile(null)
  }
  function scegli(f: File) {
    azzera()
    if (stato && f.size > stato.limiti.byteFile) { showToast(`File troppo grande (massimo ${kb(stato.limiti.byteFile)}).`, 'error'); return }
    setFile(f)
  }
  async function caricaEApri() {
    if (!file || !stato) return
    try {
      let id = caricato
      if (!id) {
        const passo = stato.limiti.bytePezzo, pezzi = Math.ceil(file.size / passo)
        setLavoro('Caricamento…')
        const c = await trasferimentoApi.carica(file.name, file.size, pezzi)
        const tutto = new Uint8Array(await file.arrayBuffer())
        for (let n = 0; n < pezzi; n++) {
          setLavoro(`Caricamento: pezzo ${n + 1} di ${pezzi}`)
          await trasferimentoApi.pezzo(c.id, n, base64Di(tutto.subarray(n * passo, Math.min(tutto.length, (n + 1) * passo))))
        }
        id = c.id; setCaricato(id)
      }
      setLavoro('Apertura e verifiche…')
      const r = await trasferimentoApi.apri(id, frase)
      setAperto(r); setFrase('')
      if (r.aperto) setDaImportare(new Set(r.sezioni.cral?.parti ?? []))
      else setCaricato(null)   // schema diverso: il server ha gia' scartato il file
    } catch (e) {
      showToast(msg(e), 'error')
      // con la frase sbagliata il file resta sul server: si riprova senza ricaricarlo. In ogni altro caso si riparte.
      if (!(e instanceof ApiError && e.code === 'FILE_O_FRASE_NON_VALIDI')) setCaricato(null)
    }
    setLavoro(null)
  }
  async function confronta() {
    if (!caricato) return
    setLavoro('Confronto con i dati di qui…')
    try {
      const r = await trasferimentoApi.confronta(caricato, PARTI.map(p => p[0]).filter(p => daImportare.has(p)))
      setLotto({ id: r.lotto, variazioni: r.variazioni }); setCaricato(null)
    } catch (e) { showToast(msg(e), 'error'); setCaricato(null); setAperto(null) }
    setLavoro(null)
  }

  if (errStato) return <div className={card}><p className="text-sm text-red-300">Impossibile leggere lo stato dal server. Ricarica la pagina.</p></div>
  if (!stato) return <div className={card}><p className="text-sm text-slate-400">Caricamento…</p></div>

  return (
    <>
      <section className={card}>
        <h3 className="text-sm font-semibold text-white mb-1">Questo ambiente</h3>
        <p className="text-sm text-slate-300"><b className="text-white">{stato.ambiente}</b> · PGS {stato.app || '—'} · schema alla migrazione <span className="font-mono">{stato.schema.ultima || '—'}</span> ({stato.schema.migrazioni})</p>
        <p className="text-xs text-slate-500 mt-1">Un file si importa solo fra ambienti con lo stesso schema: stesse migrazioni, stessa struttura del database. Se non coincide il file viene rifiutato, prima di toccare qualunque dato.</p>
      </section>

      {/* ── ESPORTA ─────────────────────────────────────────── */}
      <section className={card}>
        <h3 className="text-sm font-semibold text-white mb-1">Esporta in un file cifrato</h3>
        <p className="text-xs text-slate-500 mb-3">Il file (.pgsx) è cifrato per intero: senza la frase non si legge nulla, nemmeno da quale ambiente viene. In questa versione si esporta il CRAL.</p>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">CRAL · cosa esportare</p>
        <Parti righe={stato.sezioni.cral} scelte={parti} onChange={setParti} />
        <p className="text-xs text-slate-500 mt-2">Quote ed eventi hanno senso insieme ai soci; i soci insieme alle sedi.</p>
        <div className="flex flex-wrap items-end gap-3 mt-4">
          <label className="flex flex-col gap-1 text-xs text-slate-400">Codice OTP (quello dell'app di autenticazione)
            <input value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code"
              placeholder="000000" className={`${input} w-32 font-mono tracking-widest`} />
          </label>
          <button type="button" className={btn} disabled={esporto || otp.length !== 6 || !parti.size} onClick={() => void esporta()}>{esporto ? 'Cifratura in corso…' : 'Esporta e scarica'}</button>
        </div>
        <p className="text-xs text-slate-500 mt-2">Serve un codice nuovo: quello usato per entrare non vale una seconda volta.</p>

        {uscita && (
          <div className="mt-4 rounded-lg border border-amber-700 bg-amber-950/30 p-4">
            <p className="text-sm text-amber-200 font-medium">Frase che apre il file <span className="font-mono text-xs text-amber-300/80">{uscita.nome}</span> ({kb(uscita.byte)})</p>
            <p className="font-mono text-lg text-white tracking-wider mt-2 select-all break-all">{uscita.frase}</p>
            <p className="text-xs text-amber-200/80 mt-2">Si vede solo adesso: il server non la conserva e non c'è modo di recuperarla. Annotala e non tenerla insieme al file (non nella stessa email, non nella stessa cartella). Chi ha file e frase legge tutto.</p>
            <div className="flex gap-2 mt-3">
              <button type="button" className={btn2} onClick={() => { void navigator.clipboard?.writeText(uscita.frase).then(() => showToast('Frase copiata', 'info')).catch(() => showToast('Copia non riuscita: selezionala a mano.', 'warning')) }}>Copia</button>
              <button type="button" className={btn2} onClick={() => setUscita(null)}>Ho annotato la frase: nascondi</button>
            </div>
          </div>)}
      </section>

      {/* ── IMPORTA ─────────────────────────────────────────── */}
      <section className={card}>
        <h3 className="text-sm font-semibold text-white mb-1">Importa da un file cifrato</h3>
        <p className="text-xs text-slate-500 mb-3">Da qui non si scrive nei dati. Il server apre il file, lo verifica e prepara un lotto: il confronto campo per campo, l'accettazione e la Prova si fanno nel modulo CRAL, in «Da validare». Niente si cancella in arrivo e un valore vuoto non svuota.</p>

        {!lotto && <>
          <div className="flex flex-wrap items-center gap-3">
            <input ref={inp} type="file" accept=".pgsx" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) scegli(f); e.target.value = '' }} />
            <button type="button" className={btn2} disabled={!!lavoro} onClick={() => inp.current?.click()}>{file ? 'Cambia file' : 'Scegli il file .pgsx'}</button>
            {file && <span className="text-sm text-slate-300"><span className="font-mono">{file.name}</span> <span className="text-xs text-slate-500">{kb(file.size)}</span></span>}
          </div>
          {file && !aperto?.aperto && (
            <div className="flex flex-wrap items-end gap-3 mt-3">
              <label className="flex flex-col gap-1 text-xs text-slate-400 flex-1 min-w-[260px]">Frase del file
                <input value={frase} onChange={e => setFrase(e.target.value)} autoComplete="off" spellCheck={false} placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" className={`${input} font-mono uppercase`} />
              </label>
              <button type="button" className={btn} disabled={!!lavoro || frase.replace(/[\s-]/g, '').length < 25} onClick={() => void caricaEApri()}>{lavoro ?? (caricato ? 'Riprova con questa frase' : 'Carica e verifica')}</button>
            </div>)}
        </>}

        {aperto && !lotto && (
          <div className="mt-4 border-t border-slate-800 pt-4">
            <table className="text-sm w-full"><tbody>
              <tr><td className="py-1 pr-4 text-slate-500 whitespace-nowrap">Integrità del file</td><td className="py-1 text-emerald-300">verificata: il file è quello scritto da chi conosceva la frase</td></tr>
              <tr><td className="py-1 pr-4 text-slate-500 whitespace-nowrap">Viene da</td><td className="py-1 text-slate-200"><b className="text-white">{aperto.ambiente}</b> · PGS {aperto.app || '—'} · esportato il {quando(aperto.esportato)} da {aperto.da || '—'}</td></tr>
              <tr><td className="py-1 pr-4 text-slate-500 whitespace-nowrap">Arriva in</td><td className="py-1 text-slate-200"><b className="text-white">{aperto.ambienteQui}</b> · PGS {aperto.appQui || '—'}{aperto.stessoAmbiente && <span className="text-amber-400"> · è lo stesso ambiente: le differenze saranno le modifiche fatte dopo l'esportazione</span>}</td></tr>
              <tr><td className="py-1 pr-4 text-slate-500 whitespace-nowrap">Schema del database</td><td className={`py-1 ${aperto.schema.uguale ? 'text-emerald-300' : 'text-red-300'}`}>
                {aperto.schema.uguale ? `identico (migrazione ${aperto.schema.qui.ultima}, ${aperto.schema.qui.migrazioni} in tutto)` : `DIVERSO — ${aperto.schema.motivo}`}</td></tr>
            </tbody></table>
            {!aperto.schema.uguale && <p className="text-sm text-red-300 mt-3">File rifiutato: nessun dato è stato letto né scritto. Porta i due ambienti alla stessa versione di PGS, poi esporta di nuovo.</p>}
            {aperto.aperto && aperto.sezioni.cral && <>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mt-4 mb-2">CRAL · cosa confrontare</p>
              <Parti righe={aperto.sezioni.cral.righe} presenti={aperto.sezioni.cral.parti} scelte={daImportare} onChange={setDaImportare} />
              <p className="text-xs text-slate-500 mt-2">Quote ed eventi richiedono che le persone ci siano qui o arrivino con «Soci e familiari»; le persone, che le sedi ci siano o arrivino con «Sedi».</p>
              <div className="flex gap-2 mt-4">
                <button type="button" className={btn2} disabled={!!lavoro} onClick={() => azzera()}>Annulla</button>
                <button type="button" className={btn} disabled={!!lavoro || !daImportare.size} onClick={() => void confronta()}>{lavoro ?? 'Prepara il confronto'}</button>
              </div>
            </>}
            {!aperto.aperto && <button type="button" className={`${btn2} mt-3`} onClick={() => azzera()}>Chiudi</button>}
          </div>)}

        {lotto && (
          <div className="mt-2 rounded-lg border border-emerald-800 bg-emerald-950/20 p-4">
            <p className="text-sm text-emerald-200 font-medium">{lotto.variazioni ? `Confronto pronto: ${lotto.variazioni} variazioni da validare.` : 'Confronto pronto: nessuna differenza con i dati di qui.'}</p>
            <p className="text-xs text-slate-400 mt-1">Il lotto è nel modulo CRAL, scheda «Da validare». Lì si accetta o si scarta ogni variazione, anche un campo alla volta, e con «Prova» il server applica davvero le accettate e poi annulla, per dire in anticipo che cosa succederebbe. L'applicazione vera arriva col prossimo rilascio.</p>
            <div className="flex gap-2 mt-3">
              <button type="button" className={btn} onClick={() => navigate('cral')}>Vai al modulo CRAL</button>
              <button type="button" className={btn2} onClick={() => azzera()}>Importa un altro file</button>
            </div>
          </div>)}
      </section>
    </>
  )
}
