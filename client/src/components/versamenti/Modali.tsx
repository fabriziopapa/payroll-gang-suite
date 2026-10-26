// ============================================================
// PAYROLL GANG SUITE — Versamenti enti · dettaglio ente e anteprima EML
// ============================================================

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { versamentiApi, type VersamentoEnteApi } from '../../api/endpoints'
import { showToast } from '../ToastManager'
import { errorePeriodo, espandiMesi, type EnteAggregato, type PropostaPeriodo } from '../../utils/versamentiCsv'
import { allegatiPer, colonneAttive, ordina } from '../../utils/versamentiAllegati'
import { fmtEuro, meseLabel, periodoBreve, periodoFrase, type ModelloVersamento } from '../../utils/versamentiModelli'
import { scaricaFile } from '../../utils/versamentiEml'
import type { EmlPronto } from './genera'
import { IconaDownload, IconaOcchio, btnPrimario, btnSecondario, etichettaCls, inputCls, messaggioErrore } from './ui'

const fmtData = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

export function Finestra({ titolo, sottotitolo, onChiudi, children, piede, larga, stretta }: {
  titolo: ReactNode; sottotitolo?: ReactNode; onChiudi: () => void; children: ReactNode; piede?: ReactNode; larga?: boolean; stretta?: boolean
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onChiudi() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onChiudi])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true"
      onClick={e => { if (e.target === e.currentTarget) onChiudi() }}>
      <div className={`bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full ${larga ? 'max-w-5xl' : stretta ? 'max-w-xl' : 'max-w-4xl'} max-h-[88vh] flex flex-col`}>
        <div className="px-6 py-4 border-b border-slate-800 flex items-start gap-3">
          <div className="min-w-0 flex-1">{titolo}{sottotitolo}</div>
          <button type="button" onClick={onChiudi} aria-label="Chiudi" className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800">✕</button>
        </div>
        <div className="overflow-auto flex-1">{children}</div>
        {piede && <div className="px-6 py-4 border-t border-slate-800 flex flex-wrap gap-2 justify-end">{piede}</div>}
      </div>
    </div>
  )
}

export function DettaglioEnteModal({ ente, rubrica, modello, perMese, generando, onChiudi, onAnteprima, onGenera }: {
  ente: EnteAggregato; rubrica: VersamentoEnteApi | null; modello: ModelloVersamento | null; perMese: boolean; generando: boolean
  onChiudi: () => void; onAnteprima: () => void; onGenera: () => void
}) {
  const righe = ordina(ente.righe, 'mese')
  // File senza colonna del mese: ogni riga vale per tutto il periodo.
  const etichettaMese = (m: string) => (ente.mesi.length === 1 && ente.periodo.length > 1 ? periodoBreve(ente.periodo) : meseLabel(m))
  const multi = ente.mesi.length > 1
  const ok = !!rubrica?.abilitato && !!rubrica.email.length
  const descr = rubrica?.descrizione ?? ente.descr

  async function solo(tipo: 'csv' | 'pdf') {
    if (!modello) return
    const [x] = await allegatiPer(ente.codice, descr, ente.righe, ente.mesi, modello.allegati, perMese, tipo, ente.periodo)
    if (x) scaricaFile(x.nome, x.bytes, x.tipo)
  }

  // Enti come INPDAP o l'Agenzia delle Entrate hanno decine di migliaia di
  // righe in un anno: oltre MAX_DETTAGLIO a schermo si mostra il riepilogo per
  // mese; il dettaglio completo resta negli allegati.
  const MAX_DETTAGLIO = 1000
  const troppe = righe.length > MAX_DETTAGLIO
  const corpo: ReactNode[] = []
  if (troppe) {
    const perMese = new Map<string, { n: number; c: number }>()
    for (const r of righe) { const x = perMese.get(r.mese) ?? { n: 0, c: 0 }; x.n++; x.c += r.cents; perMese.set(r.mese, x) }
    for (const [m, x] of perMese) corpo.push(
      <tr key={m} className="border-t border-slate-800">
        <td colSpan={2} className="px-5 py-1.5 text-slate-200">{etichettaMese(m)}</td>
        <td colSpan={2} className="px-3 py-1.5 text-slate-400 tabular-nums">{x.n.toLocaleString('it-IT')} righe</td>
        <td className="px-5 py-1.5 text-right tabular-nums text-slate-200">{fmtEuro(x.c)}</td>
      </tr>,
    )
  }
  let corrente: string | null = null, sub = 0
  const chiudi = () => {
    if (multi && corrente) corpo.push(
      <tr key={`t-${corrente}`} className="bg-slate-800/50">
        <td colSpan={4} className="px-5 py-1.5 text-xs font-semibold text-slate-300">Totale {meseLabel(corrente)}</td>
        <td className="px-5 py-1.5 text-right tabular-nums text-xs font-semibold text-slate-200">{fmtEuro(sub)}</td>
      </tr>,
    )
  }
  if (!troppe) righe.forEach((r, i) => {
    if (r.mese !== corrente) { chiudi(); corrente = r.mese; sub = 0 }
    sub += r.cents
    corpo.push(
      <tr key={i} className="border-t border-slate-800">
        <td className="px-5 py-1.5 text-slate-200">{r.nome}</td>
        <td className={`px-3 py-1.5 tabular-nums whitespace-nowrap ${r.nascita.ok ? 'text-slate-300' : 'text-amber-400'}`}
          title={r.nascita.ok ? (r.nascita.fonte === 'csv' ? 'Da DATA_NASC del CSV' : 'DATA_NASC assente: ricavata dal codice fiscale') : `Data di nascita: ${r.nascita.motivo}`}>
          {r.nascita.ok ? <>{fmtData(r.nascita.iso)}{r.nascita.fonte === 'cf' && <span className="ml-1 text-[10px] text-violet-300">da CF</span>}</> : `— ${r.nascita.motivo}`}
        </td>
        <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap">{etichettaMese(r.mese)}</td>
        <td className="px-3 py-1.5 font-mono text-xs text-slate-400">{r.voce}</td>
        <td className="px-5 py-1.5 text-right tabular-nums text-slate-200">{fmtEuro(r.cents)}</td>
      </tr>,
    )
  })
  if (!troppe) chiudi()

  return (
    <Finestra
      onChiudi={onChiudi}
      titolo={<><p className="font-mono text-xs text-slate-500">{ente.codice}</p><h3 className="text-base font-semibold text-white">{descr}</h3></>}
      sottotitolo={<p className="text-xs text-slate-500 mt-0.5">{periodoBreve(ente.periodo)} · {righe.length} righe · totale <span className="text-slate-200 tabular-nums">{fmtEuro(ente.cents)} €</span></p>}
      piede={<>
        <button type="button" className={btnSecondario} disabled={!modello} onClick={() => void solo('csv')}><IconaDownload /> Solo CSV</button>
        <button type="button" className={btnSecondario} disabled={!modello} onClick={() => void solo('pdf')}><IconaDownload /> Solo PDF</button>
        <button type="button" className={btnSecondario} disabled={!ok} onClick={onAnteprima}><IconaOcchio /> Anteprima EML</button>
        <button type="button" className={btnPrimario} disabled={!ok || generando} title={ok ? '' : 'Ente disabilitato o senza email'} onClick={onGenera}><IconaDownload /> Genera EML</button>
      </>}
    >
      {troppe && (
        <p className="px-6 pt-4 text-xs text-amber-300">
          {righe.length.toLocaleString('it-IT')} righe: a schermo il riepilogo per mese. Il dettaglio di ogni persona è nel CSV e nel PDF (anche con «Solo CSV» / «Solo PDF»).
        </p>
      )}
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-900"><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
          <th className="px-5 py-2 font-semibold">Nominativo</th><th className="px-3 py-2 font-semibold">Data di nascita</th>
          <th className="px-3 py-2 font-semibold">Mese</th><th className="px-3 py-2 font-semibold">Voce</th><th className="px-5 py-2 font-semibold text-right">Importo €</th>
        </tr></thead>
        <tbody>
          {corpo}
          <tr className="border-t-2 border-slate-700">
            <td colSpan={4} className="px-5 py-2 font-semibold text-white">Totale</td>
            <td className="px-5 py-2 text-right tabular-nums font-semibold text-white">{fmtEuro(ente.cents)}</td>
          </tr>
        </tbody>
      </table>
    </Finestra>
  )
}

export function AnteprimaEmlModal({ ente, rubrica, modelli, override, modelloElab, prepara, chiave, generando, onOverride, onEnteAggiornato, onChiudi, onGenera }: {
  ente: EnteAggregato; rubrica: VersamentoEnteApi | null; modelli: ModelloVersamento[]
  override: string; modelloElab: string
  prepara: () => Promise<EmlPronto[]>
  /** Cambia quando cambia cio' che finisce nell'EML: allora l'anteprima si rifa'. */
  chiave: string; generando: boolean
  onOverride: (id: string) => void; onEnteAggiornato: (e: VersamentoEnteApi) => void
  onChiudi: () => void; onGenera: () => void
}) {
  const [emls, setEmls] = useState<EmlPronto[] | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const preparaRef = useRef(prepara)
  preparaRef.current = prepara
  useEffect(() => {
    let vivo = true
    setEmls(null); setErrore(null)
    preparaRef.current().then(x => { if (vivo) setEmls(x) }).catch(() => { if (vivo) setErrore('Anteprima non disponibile.') })
    return () => { vivo = false }
  }, [chiave])

  const x = emls?.[0]
  const predefinito = modelli.find(m => m.predefinito)
  const delEnte = modelli.find(m => m.id === rubrica?.modelloId) ?? predefinito
  const kb = (n: number) => `${(n / 1024).toLocaleString('it-IT', { maximumFractionDigits: 1 })} KB`

  async function usaSempre() {
    if (!rubrica || !override) return
    try {
      const { ente: e } = await versamentiApi.aggiornaEnte(rubrica.codice, { modelloId: override })
      onEnteAggiornato(e)
      showToast(`D'ora in poi ${e.descrizione} usa «${modelli.find(m => m.id === override)?.nome ?? ''}»`, 'success')
    } catch (err) { showToast(messaggioErrore(err), 'error') }
  }

  const riga = (k: string, v: string, mono = false) => (
    <tr className="border-t border-slate-800 first:border-t-0">
      <td className="py-1.5 pr-4 text-[11px] uppercase tracking-wider text-slate-500 whitespace-nowrap align-top">{k}</td>
      <td className={`py-1.5 ${mono ? 'font-mono text-xs' : ''} text-slate-200 break-all`}>{v}</td>
    </tr>
  )

  return (
    <Finestra
      onChiudi={onChiudi}
      titolo={<><p className="text-[11px] uppercase tracking-wider text-slate-500">Anteprima · {ente.codice} {rubrica?.descrizione ?? ente.descr}</p><h3 className="font-mono text-sm text-white break-all">{x?.nomeFile ?? '…'}</h3></>}
      sottotitolo={emls && emls.length > 1 && x ? <p className="text-xs text-amber-300 mt-1">In modalità «per mese» questo ente produce {emls.length} EML: qui vedi il primo ({meseLabel(x.mesi[0] ?? '')}).</p> : null}
      piede={<>
        <button type="button" className={btnSecondario} onClick={onChiudi}>Chiudi</button>
        <button type="button" className={btnPrimario} disabled={!emls?.length || generando} onClick={onGenera}><IconaDownload /> Genera {emls && emls.length > 1 ? `${emls.length} EML` : 'EML'}</button>
      </>}
    >
      <div className="px-6 py-4 flex flex-col gap-5">
        <div className="flex flex-wrap items-end gap-3 bg-slate-950/60 border border-slate-800 rounded-lg px-4 py-3">
          <div className="flex flex-col gap-1.5 min-w-[240px] flex-1">
            <label htmlFor="vers-ant-modello" className={etichettaCls}>Modello per questo ente</label>
            <select id="vers-ant-modello" value={override} onChange={e => onOverride(e.target.value)} className={inputCls}>
              <option value="">Come da rubrica: {delEnte?.nome ?? '—'}</option>
              {modelli.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </div>
          {override && override !== rubrica?.modelloId && (
            <button type="button" className={`${btnSecondario} !text-xs`} onClick={() => void usaSempre()}>Usalo sempre per questo ente</button>
          )}
          <p className="text-xs text-slate-500 w-full">
            La scelta vale per questa elaborazione; con «Usalo sempre» finisce nella rubrica.
            {modelloElab && !override ? ` Ora è attivo «per tutti: ${modelli.find(m => m.id === modelloElab)?.nome ?? ''}».` : ''}
          </p>
        </div>

        {errore && <p className="text-sm text-red-300">{errore}</p>}
        {!x && !errore && <p className="text-sm text-slate-500">Preparo l'anteprima…</p>}
        {x && (
          <>
            <table className="w-full text-sm"><tbody>
              {riga('Modello', x.modello.nome)}
              {riga('X-Unsent', '1 · Outlook la apre come bozza da inviare')}
              {riga('Da', x.da || '(assente: Outlook usa il tuo account)', true)}
              {riga('A', x.a.join(', '), true)}
              {riga('Oggetto', x.oggetto)}
            </tbody></table>
            <div className="flex flex-col gap-2">
              <p className={etichettaCls}>Testo (uguale nella parte HTML)</p>
              <pre className="bg-white text-slate-900 rounded-lg p-4 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ fontFamily: 'Calibri, Arial, sans-serif' }}>{x.testo}</pre>
            </div>
            <div className="flex flex-col gap-2">
              <p className={etichettaCls}>Allegati</p>
              <div className="flex flex-wrap gap-2">
                {x.allegati.length ? x.allegati.map(a => (
                  <button key={a.nome} type="button" className={`${btnSecondario} !text-xs font-mono`} onClick={() => scaricaFile(a.nome, a.bytes, a.tipo)}>
                    <IconaDownload /> {a.nome} <span className="text-slate-500">{kb(a.bytes.length)}</span>
                  </button>
                )) : <span className="text-xs text-amber-300">Questo modello non allega file.</span>}
              </div>
              <p className="text-xs text-slate-500">{x.righe} righe · colonne: {colonneAttive(x.modello.allegati, x.mesi.length > 1).map(c => c.pdf).join(', ')}</p>
            </div>
            <details>
              <summary className="text-xs text-slate-400 cursor-pointer select-none">Intestazioni dell'EML</summary>
              <pre className="mt-2 bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] font-mono text-slate-400 whitespace-pre overflow-auto max-h-72">
                {x.sorgente.split('\r\n\r\n')[0]}
              </pre>
            </details>
          </>
        )}
      </div>
    </Finestra>
  )
}

/**
 * Finestra «mese mancante»: si apre al caricamento di una stampa SENZA
 * colonna del mese (CSA senza «Suddivisione per mese»). Finche' non si
 * conferma, il file non e' caricato e nulla va al server.
 *   · Un mese    → tutte le righe sono di quel mese (come se ci fosse MESE);
 *   · Un periodo → ogni importo e' la somma del periodo «da … a …».
 * Senza una proposta dal nome del file i campi restano vuoti e Conferma non
 * si attiva: niente mesi tirati a indovinare.
 */
export function MeseMancanteModal({ nomeFile, righe, iniziale, cambio, onConferma, onAnnulla }: {
  nomeFile: string
  righe: number
  iniziale: { da: string; a: string; fonte: PropostaPeriodo['fonte'] | 'attuale' }
  /** true: si cambia il periodo di un file gia' caricato. */
  cambio: boolean
  onConferma: (da: string, a: string) => void
  onAnnulla: () => void
}) {
  const [modo, setModo] = useState<'mese' | 'periodo'>(iniziale.da && iniziale.a && iniziale.a !== iniziale.da ? 'periodo' : 'mese')
  const [da, setDa] = useState(iniziale.da)
  const [a, setA] = useState(iniziale.a || iniziale.da)
  const fine = modo === 'mese' ? da : a
  const errore = errorePeriodo(da, fine)
  const primo = useRef<HTMLInputElement>(null)
  useEffect(() => { primo.current?.focus() }, [])
  const conferma = () => { if (!errore) onConferma(da, fine) }
  const nota = {
    nome:    <p className="text-xs text-emerald-300">Proposta letta dal nome del file: controlla e conferma.</p>,
    stima:   <p className="text-xs text-amber-300">Proposta stimata: il mese prima della data di stampa scritta nel nome del file. Controlla prima di confermare.</p>,
    nessuna: <p className="text-xs text-amber-300">Il nome del file non indica il periodo: inseriscilo tu.</p>,
    attuale: null,
  }[iniziale.fonte]
  const scelta = (k: 'mese' | 'periodo', t: string, d: string) => (
    <label className={`flex gap-2.5 items-start p-3 rounded-lg border cursor-pointer ${modo === k ? 'border-indigo-500 bg-indigo-950/30' : 'border-slate-700 hover:border-slate-600'}`}>
      <input type="radio" name="vers-mese-modo" checked={modo === k} onChange={() => setModo(k)} className="accent-indigo-500 mt-0.5" />
      <span><span className="block text-sm text-slate-100">{t}</span><span className="block text-xs text-slate-500 mt-0.5">{d}</span></span>
    </label>
  )
  return (
    <Finestra stretta onChiudi={onAnnulla}
      titolo={<h3 className="text-base font-semibold text-white">{cambio ? 'Cambia il mese dei versamenti' : 'Il file non indica il mese dei versamenti'}</h3>}
      sottotitolo={<p className="text-xs text-slate-500 mt-1"><span className="font-mono break-all">{nomeFile}</span> · {righe.toLocaleString('it-IT')} righe</p>}
      piede={<>
        <button type="button" className={btnSecondario} onClick={onAnnulla}>{cambio ? 'Annulla' : 'Annulla: non caricare il file'}</button>
        <button type="button" className={btnPrimario} disabled={!!errore} onClick={conferma}>Conferma</button>
      </>}>
      <form className="px-6 py-5 flex flex-col gap-4" onSubmit={e => { e.preventDefault(); conferma() }}>
        <p className="text-sm text-slate-300">La stampa è stata fatta in CSA senza «Suddivisione per mese»: indica a quale mese, o a quale periodo, si riferiscono gli importi.</p>
        <div className="grid sm:grid-cols-2 gap-2">
          {scelta('mese', 'Un mese', 'tutte le righe sono di quel mese')}
          {scelta('periodo', 'Un periodo', 'ogni importo è la somma dei mesi da … a …')}
        </div>
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-1.5 w-48">
            <label htmlFor="vers-mm-da" className={etichettaCls}>{modo === 'mese' ? 'Mese' : 'Da'}</label>
            <input ref={primo} id="vers-mm-da" type="month" value={da} min="1990-01" max="2100-12"
              onChange={e => { setDa(e.target.value); if (!a || a < e.target.value) setA(e.target.value) }} className={inputCls} />
          </div>
          {modo === 'periodo' && (
            <div className="flex flex-col gap-1.5 w-48">
              <label htmlFor="vers-mm-a" className={etichettaCls}>A</label>
              <input id="vers-mm-a" type="month" value={a} min={da || '1990-01'} max="2100-12" onChange={e => setA(e.target.value)} className={inputCls} />
            </div>
          )}
        </div>
        {nota}
        {errore
          ? (da || fine) && <p className="text-xs text-red-300">{errore}</p>
          : <p className="text-sm text-slate-300 border border-slate-800 bg-slate-950 rounded-lg px-3 py-2">
              Nel testo della mail: <span className="text-white">«{periodoFrase(espandiMesi(da, fine))}»</span>
              {modo === 'periodo' && <span className="text-slate-500"> · {espandiMesi(da, fine).length} mesi</span>}
            </p>}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Finestra>
  )
}
