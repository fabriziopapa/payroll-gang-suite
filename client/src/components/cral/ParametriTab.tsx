// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · scheda Parametri
// Sedi, quota associativa per anno, tipi di evento,
// tipologie di prodotto, confezioni, numerazione della tessera.
// ============================================================

import { useState } from 'react'
import { cralApi } from '../../api/endpoints'
import type { ParametriTessera, RegolaStato } from './tipi'
import { ORDINE_REGOLE, PERMESSI_REGOLA, REGOLE, fmtEuro, fmtImp, formatTessera, nominativo, oggi, parseEuro, prossimaTessera, rataMese, tesseraNelFormato } from './logica'
import { StatoRubrica } from './Rubrica'
import { Campo, D, Ico, Interruttore, avviso, btnPiccoloSec, btnPrimario, cardCls, etichettaCls, inputCls, inputW, sceltaCls, useCral } from './ui'

interface Voce { id: string; nome: string; colore?: string; flag: boolean; flag2?: boolean }
function ListaParametri({ titolo, sotto, voci, usi, onRinomina, onFlag, flagLabel, onFlag2, flag2Label, onColore, onAggiungi, segnaposto, maxLen = 120 }: {
  titolo: string; sotto?: string; voci: Voce[]; usi: (id: string) => number
  onRinomina: (id: string, nome: string) => void; onFlag: (id: string, v: boolean) => void; flagLabel: string
  onFlag2?: (id: string, v: boolean) => void; flag2Label?: string; onColore?: (id: string, c: string) => void
  onAggiungi: (nome: string) => Promise<boolean>; segnaposto: string; maxLen?: number
}) {
  const [nuovo, setNuovo] = useState('')
  const aggiungi = () => { const n = nuovo.trim(); if (n) void onAggiungi(n).then(ok => { if (ok) setNuovo('') }) }
  return (
    <div className={`${cardCls} overflow-hidden`}>
      <div className="px-5 py-3 border-b border-slate-800"><p className="text-sm font-medium text-white">{titolo}</p>{sotto && <p className="text-xs text-slate-500 mt-0.5">{sotto}</p>}</div>
      <div className="divide-y divide-slate-800/70">
        {voci.map(v => (
          <div key={v.id} className="px-5 py-2 flex flex-wrap items-center gap-3">
            {onColore && <input type="color" defaultValue={v.colore} onBlur={e => { if (e.target.value.toUpperCase() !== (v.colore ?? '').toUpperCase()) onColore(v.id, e.target.value) }} className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer" aria-label={`Colore ${v.nome}`} />}
            <span className="font-mono text-[11px] text-slate-500 w-10">{v.id}</span>
            <input className={inputCls + ' py-1.5 flex-1 min-w-[140px] w-auto'} maxLength={maxLen} defaultValue={v.nome} key={v.nome}
              onBlur={e => { const n = e.target.value.trim(); if (!n) { e.target.value = v.nome; return } if (n !== v.nome) onRinomina(v.id, n) }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
            <span className="text-xs text-slate-500 tabular-nums w-14 text-right whitespace-nowrap">{usi(v.id)} usi</span>
            {onFlag2 && <Interruttore on={!!v.flag2} onChange={x => onFlag2(v.id, x)} label={flag2Label ?? ''} />}
            <Interruttore on={v.flag} onChange={x => onFlag(v.id, x)} label={flagLabel} />
          </div>))}
      </div>
      <div className="px-5 py-3 border-t border-slate-800 flex gap-2">
        <input className={inputCls + ' py-1.5'} maxLength={maxLen} placeholder={segnaposto} value={nuovo} onChange={e => setNuovo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') aggiungi() }} />
        <button className={btnPiccoloSec + ' whitespace-nowrap'} disabled={!nuovo.trim()} onClick={aggiungi}><Ico d={D.plus} cls="w-3.5 h-3.5" />Aggiungi</button>
      </div>
    </div>
  )
}

/**
 * 0030: stati degli eventi. Nome, colore e ordine liberi; la regola, fra sei fisse, decide cosa si può
 * fare negli eventi in quello stato (il server la controlla a ogni scrittura). Uno stato in uso non si
 * cancella: si disattiva, e gli eventi che lo hanno lo tengono.
 */
function ParametriStati() {
  const { db, esegui } = useCral()
  const [nuovo, setNuovo] = useState<{ nome: string; regola: RegolaStato }>({ nome: '', regola: 'RACCOLTA_CHIUSA' })
  const usi = (id: string) => db.iniziative.filter(i => i.stato === id).length
  const sposta = (k: number, d: -1 | 1) => {
    const ids = db.stati.map(s => s.id); const j = k + d
    if (j < 0 || j >= ids.length) return
    ;[ids[k], ids[j]] = [ids[j]!, ids[k]!]
    void esegui(() => cralApi.ordinaStatiEvento(ids), 'Ordine salvato', 'info')
  }
  const aggiungi = () => { const n = nuovo.nome.trim(); if (n) void esegui(() => cralApi.creaStatoEvento({ nome: n, colore: '#64748B', regola: nuovo.regola }), `Stato «${n}» aggiunto`).then(r => { if (r) setNuovo({ ...nuovo, nome: '' }) }) }
  const si = (b: boolean) => (b ? 'sì' : 'no')
  return (
    <div className={`${cardCls} overflow-hidden`}>
      <div className="px-5 py-3 border-b border-slate-800"><p className="text-sm font-medium text-white">Stati degli eventi</p>
        <p className="text-xs text-slate-500 mt-0.5">Nome, colore e ordine sono liberi. La <b className="text-slate-400">regola</b> decide cosa si può fare negli eventi in quello stato, ed è controllata anche dal server. L'ordine è quello dell'elenco degli eventi. Uno stato in uso non si cancella: si disattiva.</p></div>
      <div className="divide-y divide-slate-800/70">
        {db.stati.map((s, k) => (
          <div key={s.id} className="px-5 py-2 flex flex-wrap items-center gap-2">
            <div className="flex flex-col"><button className="text-slate-500 hover:text-slate-200 disabled:opacity-30 leading-none text-xs" disabled={k === 0} aria-label={`Sposta su ${s.nome}`} onClick={() => sposta(k, -1)}>▲</button><button className="text-slate-500 hover:text-slate-200 disabled:opacity-30 leading-none text-xs" disabled={k === db.stati.length - 1} aria-label={`Sposta giù ${s.nome}`} onClick={() => sposta(k, 1)}>▼</button></div>
            <input type="color" defaultValue={s.colore} onBlur={e => { if (e.target.value.toUpperCase() !== s.colore.toUpperCase()) void esegui(() => cralApi.aggiornaStatoEvento(s.id, { colore: e.target.value.toUpperCase() }), 'Colore salvato', 'info') }} className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer" aria-label={`Colore ${s.nome}`} />
            <span className="font-mono text-[11px] text-slate-500 w-20 truncate" title={s.id}>{s.id}</span>
            <input className={inputCls + ' py-1.5 flex-1 min-w-[130px] w-auto'} maxLength={60} defaultValue={s.nome} key={s.nome}
              onBlur={e => { const n = e.target.value.trim(); if (!n) { e.target.value = s.nome; return } if (n !== s.nome) void esegui(() => cralApi.aggiornaStatoEvento(s.id, { nome: n }), 'Stato rinominato') }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
            <select className={inputW + ' py-1.5 w-44'} value={s.regola} title={REGOLE[s.regola].descr} aria-label={`Regola di ${s.nome}`}
              onChange={e => void esegui(() => cralApi.aggiornaStatoEvento(s.id, { regola: e.target.value as RegolaStato }), `«${s.nome}»: regola ${REGOLE[e.target.value as RegolaStato].nome}`)}>
              {ORDINE_REGOLE.map(r => <option key={r} value={r}>{REGOLE[r].nome}</option>)}</select>
            <span className="text-xs text-slate-500 tabular-nums w-14 text-right whitespace-nowrap">{usi(s.id)} eventi</span>
            <Interruttore on={s.attivo} onChange={v => void esegui(() => cralApi.aggiornaStatoEvento(s.id, { attivo: v }), v ? 'Stato attivato' : 'Stato disattivato', 'info')} label="attivo" />
          </div>))}
      </div>
      <div className="px-5 py-3 border-t border-slate-800 flex flex-wrap gap-2">
        <input className={inputCls + ' py-1.5 flex-1 min-w-[160px]'} maxLength={60} placeholder="Es. In consegna, Ordine inviato…" value={nuovo.nome} onChange={e => setNuovo({ ...nuovo, nome: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') aggiungi() }} />
        <select className={inputW + ' py-1.5 w-44'} value={nuovo.regola} aria-label="Regola del nuovo stato" onChange={e => setNuovo({ ...nuovo, regola: e.target.value as RegolaStato })}>{ORDINE_REGOLE.map(r => <option key={r} value={r}>{REGOLE[r].nome}</option>)}</select>
        <button className={btnPiccoloSec + ' whitespace-nowrap'} disabled={!nuovo.nome.trim()} onClick={aggiungi}><Ico d={D.plus} cls="w-3.5 h-3.5" />Aggiungi</button>
      </div>
      <details className="px-5 py-3 border-t border-slate-800 text-xs text-slate-400"><summary className="cursor-pointer text-slate-300">Le sei regole</summary>
        <table className="mt-2 w-full"><thead><tr className="text-left text-slate-500"><th className="py-1 font-normal">Regola</th><th className="font-normal">Scelte, ordini, iscrizioni</th><th className="font-normal">Pagamenti, note</th><th className="font-normal">Consegne</th></tr></thead>
          <tbody>{ORDINE_REGOLE.map(r => <tr key={r} className="border-t border-slate-800/70"><td className="py-1 pr-2 text-slate-200" title={REGOLE[r].descr}>{REGOLE[r].nome}</td><td>{si(PERMESSI_REGOLA[r].raccolta)}</td><td>{si(PERMESSI_REGOLA[r].gestione)}</td><td>{si(PERMESSI_REGOLA[r].consegna)}</td></tr>)}</tbody></table>
        <p className="mt-2">«Concluso» e «Annullato» sono di sola lettura; l'annullato è barrato in elenco, esce dalla scheda della persona e nei report porta «ANNULLATO». Archiviare un evento resta una cosa a parte.</p>
      </details>
    </div>
  )
}

/** Prefisso internazionale dato ai numeri scritti senza: vale per la scheda e per tutte le importazioni. */
function ParametriTelefono() {
  const { db, esegui } = useCral()
  return (
    <div className={`${cardCls} p-5 flex flex-col gap-3`}>
      <div><p className="text-sm font-medium text-white">Numeri di telefono</p><p className="text-xs text-slate-500 mt-0.5">I numeri si conservano nel formato delle API di WhatsApp: prefisso internazionale e numero, es. <span className="font-mono">+393331234567</span> (wa_id <span className="font-mono">393331234567</span>).</p></div>
      <div className="flex items-center gap-3"><span className="text-sm text-slate-300">Prefisso per chi non lo scrive</span><span className="text-slate-500">+</span>
        <input inputMode="numeric" className={inputW + ' py-1 w-20 tabular-nums'} maxLength={4} defaultValue={db.prefissoTel} key={db.prefissoTel}
          onBlur={e => { const v = e.target.value.trim(); if (!/^[1-9]\d{0,3}$/.test(v)) { avviso('Prefisso non valido', 'error'); e.target.value = db.prefissoTel; return } if (v !== db.prefissoTel) void esegui(() => cralApi.salvaPrefissoTel(v), `Prefisso +${v} salvato`) }} /></div>
      <p className="text-xs text-slate-500">Con +39: i cellulari iniziano per 3, i fissi tengono lo 0. Un numero estero va scritto col suo prefisso (+44…, 0044…).</p>
    </div>
  )
}

function ParametriQuote() {
  const { db, esegui } = useCral()
  const righe = [...db.quoteAnno].sort((a, b) => b.anno - a.anno)
  const prossimo = (righe[0]?.anno ?? +oggi().slice(0, 4)) + 1
  return (
    <div className={`${cardCls} p-5 flex flex-col gap-3`}>
      <div><p className="text-sm font-medium text-white">Quota associativa per anno</p><p className="text-xs text-slate-500 mt-0.5">Anno solare. Può cambiare da un anno all'altro: gli anni passati restano col loro importo.</p></div>
      <div className="divide-y divide-slate-800 border border-slate-800 rounded-lg">{righe.map(q => (
        <div key={q.anno} className="flex items-center gap-3 px-3 py-2"><span className="text-sm text-white tabular-nums w-14">{q.anno}</span>
          <input inputMode="decimal" className={inputW + ' py-1 w-28 text-right tabular-nums'} defaultValue={fmtImp(q.importo)} key={`${q.anno}-${q.importo}`}
            onBlur={e => { const v = parseEuro(e.target.value); if (v === null || v <= 0) { avviso('Importo non valido', 'error'); e.target.value = fmtImp(q.importo); return } if (v !== q.importo) void esegui(() => cralApi.quotaAnno(q.anno, v), `Quota ${q.anno}: ${fmtEuro(v)}`) }} />
          <span className="text-xs text-slate-500 tabular-nums">€ · 12 rate da {fmtEuro(rataMese(q.importo, 0))}</span></div>))}</div>
      <button className={btnPiccoloSec + ' self-start'} onClick={() => void esegui(() => cralApi.quotaAnno(prossimo, righe[0]?.importo ?? 6000), `Anno ${prossimo} aggiunto`)}><Ico d={D.plus} cls="w-3.5 h-3.5" />Aggiungi l'anno {prossimo}</button>
    </div>
  )
}

/** Numerazione della tessera CRAL: formato, cifre, progressivo e regola per chi rientra dopo la cessazione. */
function ParametriTesseraCard() {
  const { db, esegui } = useCral()
  const [t, setT] = useState<ParametriTessera>(db.tessera)
  const set = (p: Partial<ParametriTessera>) => setT({ ...t, ...p })
  const cambiata = JSON.stringify(t) !== JSON.stringify(db.tessera)
  const es = formatTessera(t, 42)
  const suf = (n: number) => `${es}${t.sepSuffisso}${String(n).padStart(t.cifreSuffisso, '0')}`
  const max = 10 ** t.cifreSuffisso - 1
  const prefOk = /^[A-Za-z0-9 ._/-]{0,10}$/.test(t.prefisso)
  // 26.11.11.2: le tessere già assegnate che col formato scelto non sarebbero accettate (non si cambiano da sole)
  const fuori = t.vincolante ? db.soci.filter(p => p.tessera && p.stato !== 'ELIMINATO').filter(p => { const r = tesseraNelFormato(t, p.tessera); return 'errore' in r || r.tessera !== p.tessera }) : []
  const scelta = (on: boolean, onClick: () => void, titolo: string, desc: string) => <button onClick={onClick} className={sceltaCls(on)}><p className="text-sm font-medium text-white">{titolo}</p><p className="text-xs text-slate-500 font-mono">{desc}</p></button>
  return (
    <div className={`${cardCls} p-5 flex flex-col gap-4`}>
      <div><p className="text-sm font-medium text-white">Tessera CRAL (numero socio)</p><p className="text-xs text-slate-500 mt-0.5">Vale per le nuove tessere: quelle già assegnate non cambiano. Dal libro soci arriva il numero d'iscrizione, che prende questo formato.</p></div>
      <div className="flex flex-col gap-2"><span className={etichettaCls}>Formato</span>
        <div className="grid sm:grid-cols-2 gap-2">
          {scelta(t.formato === 'NUM', () => set({ formato: 'NUM' }), 'Solo progressivo numerico', formatTessera({ ...t, formato: 'NUM' }, 42))}
          {scelta(t.formato === 'PREF', () => set({ formato: 'PREF' }), 'Parte testuale + progressivo', formatTessera({ ...t, formato: 'PREF' }, 42))}
        </div></div>
      <div className="grid grid-cols-3 gap-3">
        <Campo label="Parte testuale" hint={prefOk ? undefined : <span className="text-red-400">Solo lettere, cifre, spazio e . _ / -</span>}><input disabled={t.formato !== 'PREF'} maxLength={10} className={inputCls + ' font-mono disabled:opacity-40'} value={t.prefisso} onChange={e => set({ prefisso: e.target.value })} /></Campo>
        <Campo label="Cifre" hint="Con zeri iniziali"><input type="number" min={1} max={8} className={inputCls} value={t.cifre} onChange={e => set({ cifre: Math.max(1, Math.min(8, +e.target.value || 1)) })} /></Campo>
        <Campo label="Prossimo n."><input type="number" min={1} className={inputCls} value={t.prossimo} onChange={e => set({ prossimo: Math.max(1, Math.min(99_999_999, +e.target.value || 1)) })} /></Campo>
      </div>
      <div className="flex flex-col gap-2">
        <Interruttore on={t.vincolante} onChange={v => set({ vincolante: v })} label={<span>Formato obbligatorio <span className="text-slate-500">· anche le tessere scritte a mano e importate</span></span>} />
        <p className="text-xs text-slate-500">{t.vincolante
          ? <>Scrivendo solo il numero si completa da sé: <span className="font-mono text-slate-300">175</span> → <span className="font-mono text-slate-300">{formatTessera(t, 175)}</span>, <span className="font-mono text-slate-300">1</span> → <span className="font-mono text-slate-300">{formatTessera(t, 1)}</span>. Una tessera fuori formato non si salva. Quelle già assegnate restano come sono.</>
          : 'Spento: la tessera scritta a mano entra così come la scrivi (deve solo essere unica).'}</p>
        {fuori.length > 0 && <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-200 flex flex-col gap-1">
          <span>{fuori.length === 1 ? '1 tessera già assegnata non è' : `${fuori.length} tessere già assegnate non sono`} nel formato: restano come sono, si correggono a mano o col T6.</span>
          <span className="text-amber-300/80">{fuori.slice(0, 12).map(p => `${nominativo(p)} «${p.tessera}»`).join(' · ')}{fuori.length > 12 ? ` · e altre ${fuori.length - 12}` : ''}</span>
        </div>}
      </div>
      <div className="flex flex-col gap-2"><span className={etichettaCls}>Chi rientra dopo la cessazione</span>
        <div className="grid sm:grid-cols-2 gap-2">
          {scelta(t.riammissione === 'NUOVO', () => set({ riammissione: 'NUOVO' }), 'Nuovo numero (default)', `${prossimaTessera(t)} (il prossimo libero, come nel libro soci)`)}
          {scelta(t.riammissione === 'SUFFISSO', () => set({ riammissione: 'SUFFISSO' }), 'Stesso numero + suffisso', `${suf(1)} · ${suf(2)} … ${suf(max)}`)}
        </div>
        {t.riammissione === 'SUFFISSO' && <div className="grid grid-cols-2 gap-3">
          <Campo label="Separatore"><select className={inputCls} value={t.sepSuffisso} onChange={e => set({ sepSuffisso: e.target.value as ParametriTessera['sepSuffisso'] })}><option value="/">/ (0042/01)</option><option value="-">- (0042-01)</option><option value=".">. (0042.01)</option><option value="">nessuno (004201)</option></select></Campo>
          <Campo label="Cifre del suffisso" hint={`Fino a ${max} rientri`}><select className={inputCls} value={t.cifreSuffisso} onChange={e => set({ cifreSuffisso: +e.target.value })}><option value={1}>1 (fino a 9)</option><option value={2}>2 (fino a 99)</option><option value={3}>3 (fino a 999)</option></select></Campo>
        </div>}
      </div>
      <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-4 py-3 text-xs text-slate-400 flex flex-col gap-1">
        <span className={etichettaCls}>Anteprima</span>
        <span>Nuovo socio: <span className="font-mono text-slate-100">{prossimaTessera(t)}</span></span>
        <span>Socio con tessera <span className="font-mono text-slate-200">{es}</span> che rientra: <span className="font-mono text-emerald-300">{t.riammissione === 'SUFFISSO' ? suf(1) : prossimaTessera(t)}</span>{t.riammissione === 'SUFFISSO' && <>, al secondo rientro <span className="font-mono text-emerald-300">{suf(2)}</span></>}</span>
        <span>{t.vincolante ? `Scritta a mano: nel formato ${formatTessera(t, 42)}, e unica.` : 'La tessera si può sempre scrivere a mano: deve solo essere unica.'}</span>
      </div>
      <div className="flex gap-2 justify-end">
        {cambiata && <button className={btnPiccoloSec} onClick={() => setT(db.tessera)}>Annulla le modifiche</button>}
        <button className={btnPrimario} disabled={!cambiata || !prefOk} onClick={() => void esegui(() => cralApi.salvaTessera(t), 'Numerazione della tessera salvata')}>Salva</button>
      </div>
    </div>
  )
}

export function ParametriTab() {
  const { db, esegui } = useCral()
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <div className="flex flex-col gap-4">
        <ListaParametri titolo="Sedi" sotto="La sede di lavoro delle persone e, negli eventi, la sede di consegna. «Esterni» è una sede come le altre. Una sede non attiva resta dove è già usata ma non si propone più."
          voci={db.sedi.map(s => ({ id: s.id, nome: s.nome, flag: s.attiva }))} segnaposto="Nuova sede…" flagLabel="attiva"
          usi={id => db.soci.filter(s => s.sede === id && s.stato === 'ATTIVO').length}
          onRinomina={(id, nome) => void esegui(() => cralApi.aggiornaSede(id, { nome }), 'Sede rinominata')}
          onFlag={(id, attiva) => void esegui(() => cralApi.aggiornaSede(id, { attiva }), attiva ? 'Sede attivata' : 'Sede disattivata', 'info')}
          onAggiungi={async nome => !!(await esegui(() => cralApi.creaSede(nome), `Sede «${nome}» aggiunta`))} />
        <ParametriQuote />
        <ParametriTelefono />
        <ParametriTesseraCard />
        <StatoRubrica />
      </div>
      <div className="flex flex-col gap-4">
        <ListaParametri titolo="Tipi di evento" sotto="«a pagamento» propone la modalità Ordine quando si crea un evento di quel tipo. Campo estivo e Cinema propongono Turni e Magazzino."
          voci={db.tipi.map(t => ({ id: t.id, nome: t.nome, colore: t.colore, flag: t.attivo, flag2: t.pagamento }))} segnaposto="Es. Teatro, Buono libri…" flagLabel="attivo" maxLen={60}
          flag2Label="a pagamento" onFlag2={(id, pagamento) => void esegui(() => cralApi.aggiornaTipo(id, { pagamento }), 'Tipo aggiornato', 'info')}
          usi={id => db.iniziative.filter(i => i.tipo === id).length}
          onRinomina={(id, nome) => void esegui(() => cralApi.aggiornaTipo(id, { nome }), 'Tipo rinominato')}
          onColore={(id, colore) => void esegui(() => cralApi.aggiornaTipo(id, { colore: colore.toUpperCase() }), 'Colore salvato', 'info')}
          onFlag={(id, attivo) => void esegui(() => cralApi.aggiornaTipo(id, { attivo }), attivo ? 'Tipo attivato' : 'Tipo disattivato', 'info')}
          onAggiungi={async nome => !!(await esegui(() => cralApi.creaTipo({ nome, colore: '#DB2777', pagamento: false }), `Tipo «${nome}» aggiunto`))} />
        <ParametriStati />
        <ListaParametri titolo="Tipologie di prodotto" sotto="Raggruppano i prodotti degli eventi a pagamento (es. varietà dell'olio)."
          voci={db.tipologie.map(t => ({ id: t.id, nome: t.nome, flag: t.attiva }))} segnaposto="Es. Vino rosso, Formaggi…" flagLabel="attiva" maxLen={80}
          usi={id => db.iniziative.reduce((a, i) => a + i.prodotti.filter(p => p.tipologia === id).length, 0)}
          onRinomina={(id, nome) => void esegui(() => cralApi.aggiornaTipologia(id, { nome }), 'Tipologia rinominata')}
          onFlag={(id, attiva) => void esegui(() => cralApi.aggiornaTipologia(id, { attiva }), attiva ? 'Tipologia attivata' : 'Tipologia disattivata', 'info')}
          onAggiungi={async nome => !!(await esegui(() => cralApi.creaTipologia(nome), `Tipologia «${nome}» aggiunta`))} />
        <ListaParametri titolo="Confezioni" sotto="Sacco, pacco, latta… Nel prodotto di un evento si sceglie il tipo e quanto contiene (kg, litri o pezzi, come si vende il prodotto). Il prezzo resta quello del prodotto. Una confezione usata non si cancella: si disattiva."
          voci={db.confezioni.map(t => ({ id: t.id, nome: t.nome, flag: t.attiva }))} segnaposto="Es. Rete, Cassetta di legno…" flagLabel="attiva" maxLen={60}
          usi={id => db.iniziative.reduce((a, i) => a + i.prodotti.reduce((b, p) => b + (p.confezioni ?? []).filter(f => f.tipo === id).length, 0), 0)}
          onRinomina={(id, nome) => void esegui(() => cralApi.aggiornaConfezione(id, { nome }), 'Confezione rinominata')}
          onFlag={(id, attiva) => void esegui(() => cralApi.aggiornaConfezione(id, { attiva }), attiva ? 'Confezione attivata' : 'Confezione disattivata', 'info')}
          onAggiungi={async nome => !!(await esegui(() => cralApi.creaConfezione(nome), `Confezione «${nome}» aggiunta`))} />
      </div>
    </div>
  )
}
