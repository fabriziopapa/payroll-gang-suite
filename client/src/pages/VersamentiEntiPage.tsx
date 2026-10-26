// ============================================================
// PAYROLL GANG SUITE — Modulo Versamenti · Versamenti enti
//
// Porting strutturato del Java GestioneSaldiEnti. Si carica la stampa
// versamenti di CSA (STAMPA_VERSAMENTI_*.CSV, anche con piu' mesi), si
// controllano gli enti e si scarica per ciascuno l'EML da aprire in
// Outlook, con CSV e PDF di dettaglio.
//
// PRIVACY. Il CSV si legge e si elabora SOLO nel browser: nominativi,
// matricole, codici fiscali, date di nascita e importi non arrivano al
// server e non si salvano. Al server vanno codice e descrizione degli
// enti (per la rubrica) e, alla generazione, i soli conteggi per l'audit.
//
// Quattro schede: Elaborazione · Rubrica enti · Modelli mail · Consultazione.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { versamentiApi, type VersamentoEnteApi } from '../api/endpoints'
import { showToast } from '../components/ToastManager'
import {
  ANNO_PIU_MESE, OPZIONALI, RICHIESTE, aggregaEnti, colonnaMeseAuto, contaFontiNascita, espandiMesi,
  annoDaNomeFile, decodificaCsv, elabora, leggiFile, propostaPeriodo, type EnteAggregato, type FileVersamenti, type PropostaPeriodo,
} from '../utils/versamentiCsv'
import { completaAllegati } from '../utils/versamentiAllegati'
import { fmtEuro, meseBreve, modelloPer, periodoBreve, type ModelloVersamento } from '../utils/versamentiModelli'
import { scaricaFile } from '../utils/versamentiEml'
import { emlPerEnte, type EmlPronto } from '../components/versamenti/genera'
import {
  CampoEmail, IconaDownload, IconaOcchio, InterruttoreEnte, Pill, btnPiccolo, btnPrimario,
  cardCls, etichettaCls, inputCls, messaggioErrore,
} from '../components/versamenti/ui'
import RubricaEntiTab from '../components/versamenti/RubricaEntiTab'
import ModelliMailTab from '../components/versamenti/ModelliMailTab'
import { AnteprimaEmlModal, DettaglioEnteModal, MeseMancanteModal } from '../components/versamenti/Modali'
import GuidaStampaCsa from '../components/versamenti/GuidaStampaCsa'
import ConsultazioneTab from '../components/versamenti/ConsultazioneTab'

type Scheda = 'elab' | 'rub' | 'mod' | 'con'

const CHIAVE_MITTENTE = 'pgs.versamenti.mittente'
function leggiMittente(): string {
  try { return localStorage.getItem(CHIAVE_MITTENTE) ?? '' } catch { return '' }
}
function scriviMittente(v: string): void {
  try { localStorage.setItem(CHIAVE_MITTENTE, v) } catch { /* solo comodita' della postazione */ }
}
const pausa = (ms: number) => new Promise(r => setTimeout(r, ms))

export default function VersamentiEntiPage() {
  const [scheda, setScheda]       = useState<Scheda>('elab')
  const [enti, setEnti]           = useState<VersamentoEnteApi[]>([])
  const [modelli, setModelli]     = useState<ModelloVersamento[]>([])
  const [caricato, setCaricato]   = useState(false)

  const [file, setFile]               = useState<FileVersamenti | null>(null)
  const [colMese, setColMese]         = useState('')
  const [meseManuale, setMeseManuale] = useState('')
  const [anno, setAnno]               = useState('')
  const [meseManualeA, setMeseManualeA] = useState('')
  const [mesiSel, setMesiSel]         = useState<Set<string>>(new Set())
  const [nuovi, setNuovi]             = useState<Set<string>>(new Set())
  const [modo, setModo]               = useState<'unico' | 'mese'>('unico')
  const [modelloElab, setModelloElab] = useState('')
  const [override, setOverride]       = useState<Record<string, string>>({})
  const [mittente, setMittente]       = useState(leggiMittente)
  const [cerca, setCerca]             = useState('')
  const [dettaglio, setDettaglio]     = useState<string | null>(null)
  const [anteprima, setAnteprima]     = useState<string | null>(null)
  const [generando, setGenerando]     = useState(false)
  const [trascina, setTrascina]       = useState(false)
  // Finestra «mese mancante»: un file senza colonna del mese aspetta qui la
  // conferma del periodo prima di essere caricato (cambio: file gia' caricato).
  const [attesa, setAttesa] = useState<{
    letto: FileVersamenti; iniziale: { da: string; a: string; fonte: PropostaPeriodo['fonte'] | 'attuale' }; cambio: boolean
  } | null>(null)
  const inputFile = useRef<HTMLInputElement>(null)

  // ── Rubrica e modelli dal server ──────────────────────────
  const ricaricaModelli = useCallback(async () => {
    const { modelli: m } = await versamentiApi.modelli()
    setModelli(m.map(x => ({ ...x, allegati: completaAllegati(x.allegati) })))
  }, [])
  useEffect(() => {
    Promise.all([versamentiApi.enti(), ricaricaModelli()])
      .then(([r]) => { setEnti(r.enti); setCaricato(true) })
      .catch(err => { showToast(messaggioErrore(err), 'error'); setCaricato(true) })
  }, [ricaricaModelli])

  const entiMap = useMemo(() => new Map(enti.map(e => [e.codice, e])), [enti])
  const aggiornaEnte = useCallback((e: VersamentoEnteApi) => {
    setEnti(prev => prev.map(x => (x.codice === e.codice ? e : x)))
  }, [])

  // ── Elaborazione del file (solo nel browser) ──────────────
  const esito = useMemo(() => (file ? elabora(file, colMese, meseManuale, anno, meseManualeA) : null), [file, colMese, meseManuale, anno, meseManualeA])

  useEffect(() => {
    if (!esito) return
    setMesiSel(prev => {
      const validi = [...prev].filter(m => esito.mesi.includes(m))
      return validi.length ? new Set(validi) : new Set(esito.mesi)
    })
  }, [esito])

  // Rubrica: gli enti del file vanno al server (codice e descrizione e
  // basta). Quelli mai visti entrano abilitati, senza email.
  const sincronizzati = useRef('')
  useEffect(() => {
    if (!file || !esito || esito.mancanti.length || !esito.righe.length) return
    const visti = new Map<string, string>()
    for (const r of esito.righe) if (!visti.has(r.ente)) visti.set(r.ente, r.descr)
    const chiave = `${file.nome}|${[...visti.keys()].sort().join(',')}`
    if (chiave === sincronizzati.current) return
    sincronizzati.current = chiave
    versamentiApi.sincronizza({ file: file.nome, enti: [...visti].map(([codice, descrizione]) => ({ codice, descrizione })) })
      .then(r => {
        setEnti(r.enti)
        if (r.nuovi.length) {
          setNuovi(prev => new Set([...prev, ...r.nuovi]))
          showToast(`${r.nuovi.length} enti nuovi aggiunti alla rubrica (abilitati, senza email)`, 'info')
        }
      })
      .catch(err => { sincronizzati.current = ''; showToast(`Rubrica non aggiornata: ${messaggioErrore(err)}`, 'error') })
  }, [file, esito])

  async function apriFile(f: File) {
    if (f.size > 50 * 1024 * 1024) { showToast('File troppo grande (oltre 50 MB).', 'error'); return }
    const { testo, codifica } = decodificaCsv(await f.arrayBuffer())
    const letto = leggiFile(f.name, testo, codifica)
    const col = colonnaMeseAuto(letto.headers)
    // Senza colonna del mese (stampa CSA senza «Suddivisione per mese») il
    // periodo si chiede SUBITO, in una finestra: il file si carica solo dopo
    // la conferma. Se mancano le colonne obbligatorie si carica comunque, per
    // mostrare quali mancano.
    if (!col && RICHIESTE.every(c => letto.headers.includes(c))) {
      setAttesa({ letto, iniziale: propostaPeriodo(f.name), cambio: false })
      return
    }
    carica(letto, col, '', '')
  }

  function carica(letto: FileVersamenti, col: string, da: string, a: string) {
    setFile(letto)
    setColMese(col)
    setMeseManuale(da)
    setMeseManualeA(a)
    setAnno(annoDaNomeFile(letto.nome))
    setMesiSel(new Set())
    setNuovi(new Set())
    setOverride({})
    sincronizzati.current = ''
  }

  function confermaPeriodo(da: string, a: string) {
    if (!attesa) return
    if (attesa.cambio) { setColMese(''); setMeseManuale(da); setMeseManualeA(a); setMesiSel(new Set()) }
    else carica(attesa.letto, '', da, a)
    setAttesa(null)
  }

  /** Scegliendo «nessuna colonna» a file caricato, il periodo si chiede con la stessa finestra. */
  function scegliColonnaMese(c: string) {
    if (c === '' && file) {
      setAttesa({
        letto: file, cambio: true,
        iniziale: meseManuale ? { da: meseManuale, a: meseManualeA || meseManuale, fonte: 'attuale' } : propostaPeriodo(file.nome),
      })
      return
    }
    setColMese(c); setMesiSel(new Set())
  }
  function cambiaPeriodo() {
    if (!file) return
    setAttesa({ letto: file, cambio: true, iniziale: { da: meseManuale, a: meseManualeA || meseManuale, fonte: 'attuale' } })
  }

  const aggregati = useMemo(() => (esito ? aggregaEnti(esito.righe, mesiSel, esito.periodo) : []), [esito, mesiSel])
  const modelloDi = useCallback((codice: string) => modelloPer(codice, {
    modelli, override, modelloElab: modelloElab || null, modelloEnte: entiMap.get(codice)?.modelloId ?? null,
  }), [modelli, override, modelloElab, entiMap])

  const conRubrica = aggregati
    .map(a => ({ a, e: entiMap.get(a.codice) }))
    .sort((x, y) => (x.e?.descrizione ?? x.a.descr).localeCompare(y.e?.descrizione ?? y.a.descr))
  const daControllare = conRubrica.filter(x => x.e?.abilitato && !x.e.email.length)
  const disabilitati  = conRubrica.filter(x => x.e && !x.e.abilitato)
  const q = cerca.trim().toLowerCase()
  const pronti = conRubrica
    .filter(x => x.e?.abilitato && x.e.email.length)
    .filter(x => !q || x.a.codice.toLowerCase().includes(q) || (x.e?.descrizione ?? '').toLowerCase().includes(q))
  const generabili = conRubrica.filter(x => x.e?.abilitato && x.e.email.length && x.a.cents > 0)

  // ── Generazione ───────────────────────────────────────────
  async function prepara(a: EnteAggregato): Promise<EmlPronto[]> {
    const e = entiMap.get(a.codice), m = modelloDi(a.codice)
    if (!e || !m) return []
    return emlPerEnte(a, e.descrizione, e.email, m, modo === 'mese', mittente)
  }

  /** selezione: EML costruiti con i soli versamenti scelti in Consultazione. */
  async function genera(lista: EnteAggregato[], selezione = false) {
    if (!file || !lista.length) return
    setGenerando(true)
    try {
      const emls: EmlPronto[] = []
      for (const a of lista) emls.push(...await prepara(a))
      if (!emls.length) { showToast('Niente da generare.', 'warning'); return }
      // Audit prima del download: se non si registra, non si scarica.
      await versamentiApi.eventoGenerazione({
        file: file.nome, enti: lista.map(a => a.codice), eml: emls.length,
        righe: emls.reduce((s, x) => s + x.righe, 0), modo, selezione,
        mesi: esito?.periodo ?? (selezione ? [...new Set(lista.flatMap(a => a.mesi))].sort() : [...mesiSel].sort()),
      })
      for (const x of emls) { scaricaFile(x.nomeFile, x.sorgente, 'message/rfc822'); if (emls.length > 1) await pausa(350) }
      showToast(emls.length === 1 ? `Scaricato ${emls[0]!.nomeFile}` : `Scaricati ${emls.length} EML`, 'success')
    } catch (err) {
      showToast(`EML non generati: ${messaggioErrore(err)}`, 'error')
    } finally { setGenerando(false) }
  }

  async function generaTutti() {
    const esclusi = [
      daControllare.length && `${daControllare.length} senza email`,
      conRubrica.filter(x => x.e?.abilitato && x.e.email.length && x.a.cents <= 0).length && 'quelli con totale ≤ 0',
    ].filter(Boolean)
    if (esclusi.length) showToast(`Esclusi: ${esclusi.join(', ')}.`, 'info')
    await genera(generabili.map(x => x.a))
  }

  function onMittente(v: string) { setMittente(v); scriviMittente(v) }

  function cliccaMese(m: string | '*') {
    if (!esito) return
    if (m === '*') { setMesiSel(new Set(esito.mesi)); return }
    setMesiSel(prev => {
      if (prev.size === esito.mesi.length) return new Set([m])
      const s = new Set(prev)
      if (s.has(m)) { if (s.size > 1) s.delete(m) } else s.add(m)
      return s
    })
  }

  const enteDettaglio = dettaglio ? aggregati.find(a => a.codice === dettaglio) ?? null : null
  const enteAnteprima = anteprima ? aggregati.find(a => a.codice === anteprima) ?? null : null
  const codiciNelFile = useMemo(() => new Set(esito?.righe.map(r => r.ente) ?? []), [esito])
  const esempioModelli = conRubrica[0] ? { a: conRubrica[0].a, descr: conRubrica[0].e?.descrizione ?? conRubrica[0].a.descr } : null

  // ── Render ────────────────────────────────────────────────
  const tabCls = (on: boolean) =>
    `whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${on ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`

  return (
    <div className="p-6 max-w-6xl mx-auto flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Versamenti enti</h2>
        <p className="text-sm text-slate-400 mt-1 max-w-3xl">
          Carica la stampa versamenti di CSA, controlla gli enti e scarica per ciascuno l'EML da aprire in Outlook,
          con CSV e PDF di dettaglio. Il file resta nel browser: nominativi e importi non vengono salvati.
        </p>
      </div>

      {/* flex-wrap, non overflow-x-auto: con overflow-x il browser rende scorrevole anche
          l'asse verticale e il -mb-px delle schede faceva comparire una barra con le frecce. */}
      <div className="flex flex-wrap gap-1 border-b border-slate-800" role="tablist">
        <button role="tab" aria-selected={scheda === 'elab'} className={tabCls(scheda === 'elab')} onClick={() => setScheda('elab')}>Elaborazione</button>
        <button role="tab" aria-selected={scheda === 'rub'} className={tabCls(scheda === 'rub')} onClick={() => setScheda('rub')}>
          Rubrica enti <span className="ml-1 text-xs text-slate-500">{enti.length}</span>
        </button>
        <button role="tab" aria-selected={scheda === 'mod'} className={tabCls(scheda === 'mod')} onClick={() => setScheda('mod')}>
          Modelli mail <span className="ml-1 text-xs text-slate-500">{modelli.length}</span>
        </button>
        <button role="tab" aria-selected={scheda === 'con'} className={tabCls(scheda === 'con')} onClick={() => setScheda('con')}>Consultazione</button>
      </div>

      {!caricato && <p className="text-sm text-slate-500">Caricamento…</p>}

      {caricato && scheda === 'rub' && (
        <RubricaEntiTab enti={enti} modelli={modelli} nuovi={nuovi} codiciNelFile={codiciNelFile} onAggiornato={aggiornaEnte} onEnti={setEnti} />
      )}
      {caricato && scheda === 'mod' && (
        <ModelliMailTab modelli={modelli} enti={enti} esempio={esempioModelli} onRicarica={ricaricaModelli} onEntiCambiati={() => versamentiApi.enti().then(r => setEnti(r.enti)).catch(() => {})} />
      )}

      {/* Consultazione: resta montata (nascosta) per non perdere selezione e filtri cambiando scheda. */}
      {caricato && scheda === 'con' && !(file && esito && !esito.mancanti.length && esito.righe.length) && (
        <div className={`${cardCls} p-8 text-center text-sm text-slate-400`}>
          Carica prima la stampa versamenti nella scheda{' '}
          <button type="button" className="text-indigo-400 hover:text-indigo-300" onClick={() => setScheda('elab')}>Elaborazione</button>.
          Qui si cercano, si selezionano e si esportano i versamenti del file, che restano nel browser.
        </div>
      )}
      {caricato && file && esito && !esito.mancanti.length && esito.righe.length > 0 && (
        <div hidden={scheda !== 'con'}>
          <ConsultazioneTab
            file={file.nome} righe={esito.righe} mesi={esito.mesi} periodo={esito.periodo}
            mesiSel={mesiSel} onMese={cliccaMese} entiMap={entiMap} modelloDi={modelloDi}
            modo={modo} setModo={setModo} generando={generando}
            onGeneraEml={lista => genera(lista, true)}
          />
        </div>
      )}

      {caricato && scheda === 'elab' && (
        <>
          {/* Caricamento del file */}
          <div className={`${cardCls} p-5 flex flex-col gap-3`}>
            <div
              role="button" tabIndex={0}
              onClick={() => inputFile.current?.click()}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inputFile.current?.click() }}
              onDragOver={e => { e.preventDefault(); setTrascina(true) }}
              onDragLeave={() => setTrascina(false)}
              onDrop={e => { e.preventDefault(); setTrascina(false); const f = e.dataTransfer.files[0]; if (f) void apriFile(f) }}
              className={`flex flex-col sm:flex-row sm:items-center gap-4 border-2 border-dashed rounded-xl px-5 py-5 cursor-pointer transition-colors ${trascina ? 'border-indigo-500 bg-indigo-950/20' : 'border-slate-700 hover:border-indigo-500'}`}
            >
              <div className="w-10 h-10 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">Trascina qui il file STAMPA_VERSAMENTI_*.CSV oppure fai clic per sceglierlo</p>
                <p className="text-xs text-slate-500 mt-0.5">Il file viene letto solo dal browser. Al server arrivano codice e descrizione degli enti, per la rubrica.</p>
              </div>
              <input ref={inputFile} type="file" accept=".csv,.txt" className="sr-only"
                onChange={e => { const f = e.target.files?.[0]; if (f) void apriFile(f); e.target.value = '' }} />
            </div>
            <details className="text-xs text-slate-400">
              <summary className="cursor-pointer select-none text-slate-300">Come estrarre la stampa da CSA</summary>
              <div className="mt-3"><GuidaStampaCsa /></div>
            </details>
            <details className="text-xs text-slate-400">
              <summary className="cursor-pointer select-none text-slate-300">Guida rapida</summary>
              <ol className="list-decimal ml-5 mt-2 space-y-1">
                <li>Carica la stampa versamenti di CSA. Servono le colonne <span className="font-mono">{RICHIESTE.join(', ')}</span>; facoltative <span className="font-mono">{OPZIONALI.join(', ')}</span> per la data di nascita.</li>
                <li>In CSA, con «Suddivisione per mese» il file ha la colonna <span className="font-mono">MESE</span> (solo il numero: l'anno viene dal nome del file, correggibile); senza, gli importi sono la somma del periodo «da … a …», che si legge dal nome del file (es. <span className="font-mono">GEN_DIC_2025</span>) e si può correggere. Poi scegli i mesi.</li>
                <li>Nel riquadro «Da controllare» inserisci le email degli enti nuovi (più indirizzi separati da virgola) o disabilitali. Una rubrica già pronta (es. quella del vecchio programma Java) si carica con «Importa rubrica» nella scheda Rubrica enti.</li>
                <li>Scarica l'EML di un ente o tutti insieme e aprili con Outlook: sono bozze da inviare, con CSV e PDF allegati.</li>
                <li>Testi e allegati si cambiano in «Modelli mail»; il modello di ciascun ente in «Rubrica enti».</li>
              </ol>
            </details>
          </div>

          {file && esito && (
            <>
              <InfoFile file={file} esito={esito} colMese={colMese} setColMese={scegliColonnaMese}
                meseManuale={meseManuale} meseManualeA={meseManualeA} onCambiaPeriodo={cambiaPeriodo}
                anno={anno} setAnno={a => { setAnno(a); setMesiSel(new Set()) }} />

              {!esito.mancanti.length && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <Riquadro k="Righe" v={aggregati.reduce((s, a) => s + a.righe.length, 0).toLocaleString('it-IT')} s="nei mesi selezionati" />
                    <Riquadro k="Enti" v={String(aggregati.length)} s={`${nuovi.size} nuovi in questo file`} cls={nuovi.size ? 'text-indigo-300' : 'text-white'} />
                    <Riquadro k="Mesi" v={`${mesiSel.size}/${esito.mesi.length}`} s={esito.periodo ? `${periodoBreve(esito.periodo)} (senza suddivisione)` : esito.mesi.length ? periodoBreve(esito.mesi) : '—'} />
                    <Riquadro k="Totale" v={`${fmtEuro(aggregati.reduce((s, a) => s + a.cents, 0))} €`} s="trattenute versate" />
                    <Riquadro k="Scartate" v={String(esito.scartate.length)} s={esito.scartate.length ? 'righe da controllare' : 'nessuna'} cls={esito.scartate.length ? 'text-amber-400' : 'text-white'} />
                  </div>

                  {/* Opzioni */}
                  <div className={`${cardCls} p-5 flex flex-col gap-5`}>
                    <div className="flex flex-col gap-2">
                      <span className={etichettaCls}>Mesi</span>
                      <div className="flex flex-wrap gap-1.5">
                        <button type="button" onClick={() => cliccaMese('*')}
                          className={`px-3 py-1 rounded-full text-xs font-medium border ${mesiSel.size === esito.mesi.length ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}>Tutti</button>
                        {esito.mesi.map(m => (
                          <button key={m} type="button" aria-pressed={mesiSel.has(m)} onClick={() => cliccaMese(m)}
                            className={`px-3 py-1 rounded-full text-xs font-medium border tabular-nums ${mesiSel.has(m) ? 'bg-indigo-600/25 border-indigo-500 text-indigo-200' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'}`}>{esito.periodo ? periodoBreve(esito.periodo) : meseBreve(m)}</button>
                        ))}
                      </div>
                    </div>
                    <div className="grid md:grid-cols-3 gap-5">
                      <fieldset className="flex flex-col gap-2">
                        <legend className={`${etichettaCls} mb-2`}>EML</legend>
                        <label className="flex items-start gap-2 text-sm text-slate-300 cursor-pointer">
                          <input type="radio" name="modo" checked={modo === 'unico'} onChange={() => setModo('unico')} className="mt-0.5 accent-indigo-500" />
                          Uno per ente con tutti i mesi selezionati
                        </label>
                        <label className="flex items-start gap-2 text-sm text-slate-300 cursor-pointer">
                          <input type="radio" name="modo" checked={modo === 'mese'} onChange={() => setModo('mese')} className="mt-0.5 accent-indigo-500" />
                          Uno per ente per ciascun mese
                        </label>
                      </fieldset>
                      <div className="flex flex-col gap-2">
                        <label htmlFor="vers-modello-elab" className={etichettaCls}>Modello di messaggio</label>
                        <select id="vers-modello-elab" value={modelloElab} onChange={e => setModelloElab(e.target.value)} className={inputCls}>
                          <option value="">Quello di ciascun ente (rubrica)</option>
                          {modelli.map(m => <option key={m.id} value={m.id}>Per tutti: {m.nome}</option>)}
                        </select>
                        <p className="text-xs text-slate-500">Senza modello in rubrica vale il predefinito, <span className="text-slate-300">{modelli.find(m => m.predefinito)?.nome ?? '—'}</span>.</p>
                      </div>
                      <div className="flex flex-col gap-2">
                        <label htmlFor="vers-mittente" className={etichettaCls}>Mittente (facoltativo)</label>
                        <input id="vers-mittente" value={mittente} onChange={e => onMittente(e.target.value)} placeholder="lascia vuoto: Outlook usa il tuo account"
                          className={`${inputCls} font-mono !text-xs`} />
                        <p className="text-xs text-slate-500">Ricordato solo su questo computer, non in PGS.</p>
                      </div>
                    </div>
                  </div>

                  {/* Da controllare */}
                  {daControllare.length > 0 && (
                    <div className="border border-amber-800/70 bg-amber-950/20 rounded-xl overflow-hidden">
                      <div className="px-5 py-3.5 border-b border-amber-900/60 flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-amber-300">Da controllare ({daControllare.length})</h3>
                        <span className="text-xs text-amber-200/70">
                          Enti abilitati senza indirizzo{daControllare.some(x => nuovi.has(x.a.codice)) ? `, di cui ${daControllare.filter(x => nuovi.has(x.a.codice)).length} nuovi in questo file` : ''}.
                          Inserisci le email (anche più di una, separate da virgola) oppure disabilita l'ente.
                        </span>
                      </div>
                      <div className="overflow-x-auto"><table className="w-full text-sm">
                        <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                          <th className="px-5 py-2 font-semibold">Ente</th><th className="px-3 py-2 font-semibold">Descrizione</th>
                          <th className="px-3 py-2 font-semibold text-right">Righe</th><th className="px-3 py-2 font-semibold text-right">Totale €</th>
                          <th className="px-3 py-2 font-semibold">Email</th><th className="px-5 py-2 font-semibold">Abilitato</th>
                        </tr></thead>
                        <tbody>{daControllare.map(({ a, e }) => e && (
                          <tr key={a.codice} className="border-t border-amber-900/40 align-top">
                            <td className="px-5 py-2.5 font-mono text-xs text-slate-300 whitespace-nowrap">{a.codice}</td>
                            <td className="px-3 py-2.5"><span className="text-slate-200">{e.descrizione}</span> {nuovi.has(a.codice) && <Pill tono="nuovo">NUOVO</Pill>}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-400">{a.righe.length}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-200 whitespace-nowrap">{fmtEuro(a.cents)}</td>
                            <td className="px-3 py-2"><CampoEmail ente={e} onAggiornato={aggiornaEnte} /></td>
                            <td className="px-5 py-2.5"><InterruttoreEnte ente={e} onAggiornato={aggiornaEnte} /></td>
                          </tr>
                        ))}</tbody>
                      </table></div>
                    </div>
                  )}

                  {/* Pronti */}
                  <div className={`${cardCls} overflow-hidden`}>
                    <div className="px-5 py-3.5 border-b border-slate-800 flex flex-wrap items-center gap-3">
                      <h3 className="text-sm font-semibold text-white">Pronti per la mail</h3>
                      <span className="text-xs text-slate-500">{pronti.length} enti</span>
                      <div className="flex-1" />
                      <input value={cerca} onChange={e => setCerca(e.target.value)} placeholder="Cerca ente…" aria-label="Cerca ente" className={`${inputCls} !w-56 !py-1.5`} />
                      <button type="button" className={btnPrimario} disabled={!generabili.length || generando} onClick={() => void generaTutti()}>
                        <IconaDownload /> {generando ? 'Genero…' : 'Scarica tutti gli EML'}
                      </button>
                    </div>
                    {pronti.length === 0 ? (
                      <p className="px-5 py-6 text-sm text-slate-500">Nessun ente pronto. Inserisci le email nel riquadro «Da controllare».</p>
                    ) : (
                      <div className="overflow-x-auto"><table className="w-full text-sm">
                        <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 bg-slate-900/60">
                          <th className="px-5 py-2.5 font-semibold">Ente</th><th className="px-3 py-2.5 font-semibold">Descrizione</th>
                          <th className="px-3 py-2.5 font-semibold text-right">Mesi</th><th className="px-3 py-2.5 font-semibold text-right">Righe</th>
                          <th className="px-3 py-2.5 font-semibold text-right">Totale €</th><th className="px-3 py-2.5 font-semibold">Email</th>
                          <th className="px-5 py-2.5 font-semibold text-right">EML</th>
                        </tr></thead>
                        <tbody>{pronti.map(({ a, e }) => {
                          if (!e) return null
                          const neg = a.cents <= 0
                          const n = modo === 'mese' ? a.mesi.length : 1
                          return (
                            <tr key={a.codice} onClick={() => setDettaglio(a.codice)}
                              className={`border-t border-slate-800 hover:bg-slate-800/40 cursor-pointer align-top ${neg ? 'bg-amber-950/20' : ''}`}>
                              <td className="px-5 py-2.5 font-mono text-xs text-slate-300 whitespace-nowrap">{a.codice}</td>
                              <td className="px-3 py-2.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-slate-100">{e.descrizione}</span>
                                  {nuovi.has(a.codice) && <Pill tono="nuovo">NUOVO</Pill>}
                                  {neg && <Pill tono="warn">totale ≤ 0</Pill>}
                                </div>
                                <p className="text-[11px] text-slate-500 mt-0.5">
                                  modello: <span className={override[a.codice] ? 'text-cyan-300' : 'text-slate-400'}>{modelloDi(a.codice)?.nome ?? '—'}</span>
                                  {override[a.codice] ? ' · scelto in anteprima' : ''}
                                </p>
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-slate-400">{a.mesi.length}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-slate-400">{a.righe.length}</td>
                              <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${neg ? 'text-amber-400' : 'text-slate-100'}`}>{fmtEuro(a.cents)}</td>
                              <td className="px-3 py-2"><CampoEmail ente={e} onAggiornato={aggiornaEnte} /></td>
                              <td className="px-5 py-2">
                                <div className="flex justify-end gap-1.5">
                                  <button type="button" title="Anteprima dell'EML" onClick={ev => { ev.stopPropagation(); setAnteprima(a.codice) }}
                                    className={`${btnPiccolo} bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700`}><IconaOcchio /></button>
                                  <button type="button" disabled={generando} onClick={ev => { ev.stopPropagation(); void genera([a]) }}
                                    className={`${btnPiccolo} bg-indigo-600 hover:bg-indigo-500 text-white whitespace-nowrap`}><IconaDownload /> {n > 1 ? `${n} EML` : 'Genera'}</button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}</tbody>
                      </table></div>
                    )}
                  </div>

                  <details className={`${cardCls} px-5 py-3.5`}>
                    <summary className="text-sm text-slate-300 cursor-pointer select-none">
                      Enti disabilitati presenti nel file <span className="text-slate-500">({disabilitati.length})</span> · non si generano
                    </summary>
                    {disabilitati.length ? (
                      <div className="overflow-x-auto mt-3"><table className="w-full text-sm"><tbody>{disabilitati.map(({ a, e }) => e && (
                        <tr key={a.codice} className="border-t border-slate-800">
                          <td className="py-2 pr-3 font-mono text-xs text-slate-400">{a.codice}</td>
                          <td className="py-2 pr-3 text-slate-400">{e.descrizione}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{a.righe.length} righe</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-slate-400">{fmtEuro(a.cents)}</td>
                          <td className="py-2 text-right"><InterruttoreEnte ente={e} onAggiornato={aggiornaEnte} /></td>
                        </tr>
                      ))}</tbody></table></div>
                    ) : <p className="text-xs text-slate-500 mt-2">Nessuno.</p>}
                  </details>

                  <details className={`${cardCls} px-5 py-3.5`}>
                    <summary className="text-sm text-slate-300 cursor-pointer select-none">
                      Righe scartate <span className={esito.scartate.length ? 'text-amber-400' : 'text-slate-500'}>({esito.scartate.length})</span>
                    </summary>
                    {esito.scartate.length ? (
                      <div className="overflow-x-auto mt-3"><table className="w-full text-xs">
                        <thead><tr className="text-left text-slate-500"><th className="py-1.5 pr-3 font-semibold">Riga</th><th className="py-1.5 pr-3 font-semibold">Motivo</th><th className="py-1.5 font-semibold">Contenuto</th></tr></thead>
                        <tbody>{esito.scartate.slice(0, 200).map(s => (
                          <tr key={s.riga} className="border-t border-slate-800">
                            <td className="py-1.5 pr-3 tabular-nums text-slate-400">{s.riga}</td>
                            <td className="py-1.5 pr-3 text-amber-300 whitespace-nowrap">{s.motivo}</td>
                            <td className="py-1.5 font-mono text-slate-500 break-all">{s.testo}</td>
                          </tr>
                        ))}</tbody>
                      </table>{esito.scartate.length > 200 && <p className="text-xs text-slate-500 mt-2">Mostrate le prime 200.</p>}</div>
                    ) : <p className="text-xs text-slate-500 mt-2">Nessuna.</p>}
                  </details>
                </>
              )}
            </>
          )}
        </>
      )}

      {attesa && (
        <MeseMancanteModal
          nomeFile={attesa.letto.nome} righe={attesa.letto.records.length} iniziale={attesa.iniziale} cambio={attesa.cambio}
          onConferma={confermaPeriodo}
          onAnnulla={() => {
            if (!attesa.cambio) showToast(`${attesa.letto.nome} non caricato: serve il mese dei versamenti.`, 'info')
            setAttesa(null)
          }}
        />
      )}
      {enteDettaglio && (
        <DettaglioEnteModal
          ente={enteDettaglio} rubrica={entiMap.get(enteDettaglio.codice) ?? null} modello={modelloDi(enteDettaglio.codice)}
          perMese={modo === 'mese'} generando={generando}
          onChiudi={() => setDettaglio(null)}
          onAnteprima={() => { setDettaglio(null); setAnteprima(enteDettaglio.codice) }}
          onGenera={() => void genera([enteDettaglio])}
        />
      )}
      {enteAnteprima && (
        <AnteprimaEmlModal
          ente={enteAnteprima} rubrica={entiMap.get(enteAnteprima.codice) ?? null} modelli={modelli}
          override={override[enteAnteprima.codice] ?? ''} modelloElab={modelloElab}
          prepara={() => prepara(enteAnteprima)} generando={generando}
          chiave={[modelloDi(enteAnteprima.codice)?.id, modo, mittente, entiMap.get(enteAnteprima.codice)?.email.join(','), enteAnteprima.mesi.join(','), modelli.length].join('|')}
          onOverride={id => setOverride(prev => {
            const n = { ...prev }
            if (id) n[enteAnteprima.codice] = id; else delete n[enteAnteprima.codice]
            return n
          })}
          onEnteAggiornato={e => { aggiornaEnte(e); setOverride(prev => { const n = { ...prev }; delete n[e.codice]; return n }) }}
          onChiudi={() => setAnteprima(null)}
          onGenera={() => void genera([enteAnteprima])}
        />
      )}
    </div>
  )
}

function Riquadro({ k, v, s, cls = 'text-white' }: { k: string; v: string; s: string; cls?: string }) {
  return (
    <div className={`${cardCls} px-4 py-3.5 flex flex-col gap-0.5 min-w-0`}>
      <span className={etichettaCls}>{k}</span>
      <span className={`text-2xl font-semibold tabular-nums truncate ${cls}`}>{v}</span>
      <span className="text-xs text-slate-500 truncate">{s}</span>
    </div>
  )
}

function InfoFile({ file, esito, colMese, setColMese, meseManuale, meseManualeA, onCambiaPeriodo, anno, setAnno }: {
  file: FileVersamenti; esito: ReturnType<typeof elabora>
  colMese: string; setColMese: (c: string) => void
  meseManuale: string; meseManualeA: string; onCambiaPeriodo: () => void
  anno: string; setAnno: (a: string) => void
}) {
  const opzioni: Array<[string, string]> = []
  if (file.headers.includes('ANNO') && file.headers.includes('MESE')) opzioni.push([ANNO_PIU_MESE, 'ANNO + MESE'])
  // Le colonne senza nome (il «;» finale delle stampe CSA) non si offrono:
  // avrebbero lo stesso valore '' di «nessuna» e la tendina sembrerebbe vuota.
  file.headers.filter(Boolean).forEach(h => opzioni.push([h, h]))
  opzioni.push(['', 'nessuna: mese indicato al caricamento'])
  const fonti = contaFontiNascita(esito.righe)
  const req = new Set<string>(RICHIESTE), opz = new Set<string>(OPZIONALI)
  return (
    <div className={`${cardCls} p-5 flex flex-col gap-4`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-sm text-white break-all">{file.nome}</span>
        <span className="text-xs text-slate-500">{file.codifica} · separatore «{file.sep === '\t' ? 'TAB' : file.sep}» · {file.records.length} righe</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {file.headers.map((h, i) => {
          const mese = colMese === h || (colMese === ANNO_PIU_MESE && (h === 'ANNO' || h === 'MESE'))
          const cls = mese ? 'bg-cyan-900/40 text-cyan-300 border-cyan-800'
            : req.has(h) ? 'bg-emerald-900/40 text-emerald-300 border-emerald-800'
            : opz.has(h) ? 'bg-violet-900/40 text-violet-300 border-violet-800'
            : 'bg-slate-800 text-slate-400 border-slate-700'
          return <span key={`${h}-${i}`} className={`font-mono text-[11px] px-2 py-0.5 rounded border ${cls}`}>{h}</span>
        })}
      </div>
      <p className="text-xs text-slate-500">
        <span className="text-emerald-300">verde</span> = obbligatorie, <span className="text-violet-300">viola</span> = per la data di nascita
        (prima DATA_NASC, poi COD_FISC), <span className="text-cyan-300">azzurro</span> = mese, grigio = ignorate.
      </p>
      {esito.mancanti.length > 0 ? (
        <div className="border border-red-800 bg-red-950/40 rounded-lg px-4 py-3 text-sm text-red-300">
          Mancano le colonne <b className="font-mono">{esito.mancanti.join(', ')}</b>. Servono: <span className="font-mono">{RICHIESTE.join(', ')}</span>.
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-400">
            Data di nascita su {fonti.persone} persone: <span className="text-slate-200 tabular-nums">{fonti.csv}</span> da DATA_NASC ·{' '}
            <span className="text-slate-200 tabular-nums">{fonti.cf}</span> dal codice fiscale ·{' '}
            <span className={`tabular-nums ${fonti.no ? 'text-amber-400' : 'text-slate-200'}`}>{fonti.no}</span> non disponibili.
          </p>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex flex-col gap-1.5 w-64">
              <label htmlFor="vers-col-mese" className={etichettaCls}>Colonna del mese</label>
              <select id="vers-col-mese" value={colMese} onChange={e => setColMese(e.target.value)} className={inputCls}>
                {opzioni.map(([v, t]) => <option key={`${v}|${t}`} value={v}>{t}</option>)}
              </select>
            </div>
            {!colMese && (
              <div className="flex flex-col gap-1.5">
                <span className={etichettaCls}>{meseManualeA && meseManualeA !== meseManuale ? 'Periodo' : 'Mese'}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${meseManuale ? 'text-white' : 'text-amber-400'}`}>
                    {meseManuale ? periodoBreve(espandiMesi(meseManuale, meseManualeA || meseManuale)) : 'non indicato'}
                  </span>
                  <button type="button" onClick={onCambiaPeriodo} className={`${btnPiccolo} bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700`}>
                    {meseManuale ? 'Cambia' : 'Indica il mese'}
                  </button>
                </div>
              </div>
            )}
            {colMese && colMese !== ANNO_PIU_MESE && esito.serveAnno && (
              <div className="flex flex-col gap-1.5 w-40">
                <label htmlFor="vers-anno" className={etichettaCls}>Anno</label>
                <input id="vers-anno" inputMode="numeric" maxLength={4} value={anno} onChange={e => setAnno(e.target.value.replace(/\D/g, ''))}
                  className={`${inputCls} tabular-nums ${/^\d{4}$/.test(anno) ? '' : '!border-amber-600'}`} />
              </div>
            )}
          </div>
          {!colMese && (
            <p className="text-xs text-slate-500 -mt-2">Il file non ha la colonna del mese (stampa CSA senza «Suddivisione per mese»): il mese o il periodo confermato al caricamento vale per tutte le righe e finisce nel testo della mail. Con un periodo, ogni importo è la somma dei suoi mesi.</p>
          )}
          {colMese && colMese !== ANNO_PIU_MESE && esito.serveAnno && (
            <p className="text-xs text-slate-500 -mt-2">La colonna {colMese} ha solo il numero del mese: l'anno viene dal nome del file{anno ? '' : ' (non trovato: indicalo)'}.</p>
          )}
        </>
      )}
    </div>
  )
}
