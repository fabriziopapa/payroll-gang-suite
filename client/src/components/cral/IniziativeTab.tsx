// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · scheda Eventi
// Elenco, maschera dell'evento (cinque modalità), pagina dell'evento con
// scelte, ordini, consegne, partecipanti singoli e importazioni.
// ============================================================

import { nomiEsigenze } from './contatti'
import { EsportaElenco } from './Esporta'
import { Fragment, useState, type ReactNode } from 'react'
import { cralApi, type CralIniziativaBody } from '../../api/endpoints'
import type { Gruppo, Iniziativa, Modalita, Persona, Prodotto, PatchScelta } from './tipi'
import {
  GRUPPI, GRUPPI_EVENTO, NOMI_GRUPPO, catPersona, gruppoDi, contiMagazzino, contiOrdine, contiTurni, aggiunti, descrPart, destinatari, nelGruppo, etichettaPers, fmtData, fmtEuro, fmtImp,
  fmtQ, generaSettimane, gruppiProdotti, haOrdinato, nettoSocio, nominativo, norm, parseEuro, partecipantiEffettivi, riepilogoAlimentare, perUnita, persDi, prodLabel, qta, regolaCat,
  riassuntoSconti, riepilogo, righeOrdiniPerSede, sedeBreve, sedeNome, tipNome, totaleSocio,
  REGOLE, annullato, frasePermessi, permessi, statoDi, type CopiaPronta,
  conLuogo, consegnaAltrove, sedeConsegna,
  breveConfezioni, colonneOrdine, conDecimali, sottoColonna, confezioniDi, etichettaFormato, formati, nomeConfezione, testoConfezioni, umDi, valoreColonna, type ColonnaOrdine,
} from './logica'
import { CopiaEventoModal } from './CopiaEvento'
import { ScontiTipologia, ScontoPersonaleModal, scontiDaTxt, scontiInTxt, scontiTxtOk, type ScontiTxt } from './Sconti'
import { TurniCorpo, IscrizioniImportModal, type NomeCella } from './Turni'
import { MagazzinoCorpo } from './Magazzino'
import { ModuloRisposteModal, OrdiniImportModal, PartecipantiImportModal } from './ImportEvento'
import { NuovoSocioModal } from './SociTab'
import {
  Campo, Conferma, D, DiChi, Ico, Interruttore, Modale, Origine, Pill, StatoChip, TipoChip, avviso, btnPiccolo, btnPiccoloSec, btnPrimario, btnSecondario,
  cardCls, chipCls, etichettaCls, inputCls, inputW, sceltaCls, thCls, useCral, Scorrevole
} from './ui'


export function IniziativeTab() {
  const { db } = useCral()
  const [aperta, setAperta] = useState<string | null>(null)
  const [edit, setEdit] = useState<string | null>(null)
  const [tipo, setTipo] = useState('')
  const [arch, setArch] = useState(false)
  const [statoF, setStatoF] = useState('')
  if (aperta && db.iniziative.some(i => i.id === aperta)) return <IniziativaDettaglio key={aperta} id={aperta} onBack={() => setAperta(null)} onApri={setAperta} />
  const nArch = db.iniziative.filter(i => i.archiviata).length
  const visibili = db.iniziative.filter(i => (!tipo || i.tipo === tipo) && i.archiviata === arch)
  // 0030: in ordine di stato (l'ordine di Parametri), poi dal più recente
  const lista = visibili.filter(i => !statoF || i.stato === statoF)
    .sort((a, b) => (statoDi(db, a.stato).ordine - statoDi(db, b.stato).ordine) || b.data.localeCompare(a.data))
  const statiUsati = db.stati.filter(s => visibili.some(i => i.stato === s.id))
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={() => setTipo('')} className={chipCls(!tipo)}>Tutti</button>
        {db.tipi.filter(t => t.attivo || db.iniziative.some(i => i.tipo === t.id)).map(t => <button key={t.id} onClick={() => setTipo(t.id)} className={chipCls(tipo === t.id)}><span className="w-2 h-2 rounded-full" style={{ background: t.colore }} />{t.nome}</button>)}
        <button onClick={() => setArch(!arch)} className={`${btnPiccolo} border ml-auto ${arch ? 'bg-slate-700 text-white border-slate-500' : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200'}`}>{arch ? 'Torna agli eventi attivi' : `Archiviati (${nArch})`}</button>
        <button className={btnPrimario} onClick={() => setEdit('__NEW')}><Ico d={D.plus} />Nuovo evento</button>
      </div>
      {statiUsati.length > 1 && <div className="flex flex-wrap gap-1.5 items-center -mt-1">
        <span className="text-xs text-slate-500 mr-1">Stato</span>
        <button onClick={() => setStatoF('')} className={chipCls(!statoF)}>Tutti</button>
        {statiUsati.map(s => <button key={s.id} onClick={() => setStatoF(statoF === s.id ? '' : s.id)} className={chipCls(statoF === s.id)}><span className="w-2 h-2 rounded-full" style={{ background: s.colore }} />{s.nome} <span className="text-slate-500 tabular-nums">{visibili.filter(i => i.stato === s.id).length}</span></button>)}
      </div>}
      {arch && <p className="text-xs text-slate-500 -mt-1">Eventi archiviati: in sola lettura, fuori dagli elenchi di lavoro. Restano consultabili e nei report.</p>}
      {!lista.length && <div className={`${cardCls} p-8 text-center text-sm text-slate-500`}>{arch ? 'Nessun evento archiviato.' : 'Nessun evento. Creane uno con «Nuovo evento».'}</div>}
      <div className="grid md:grid-cols-2 gap-4">
        {lista.map(i => {
          const mod = i.modalita
          const ann = annullato(db, i)
          let testo: string, pct: number
          if (mod === 'ORDINE') { const c = contiOrdine(db, i); pct = c.totale ? Math.round(100 * c.incassato / c.totale) : 0; testo = `${c.ord.length} ordini · ${fmtQ(c.pezzi)} pezzi · ${fmtEuro(c.totale)}${c.sconti ? ` (sconti ${fmtEuro(c.sconti)})` : ''} (incassato ${fmtEuro(c.incassato)})` }
          else if (mod === 'TURNI') { const c = contiTurni(db, i); pct = c.dovuto ? Math.min(100, Math.round(100 * c.versato / c.dovuto)) : 0; testo = `${c.isc.length} iscritti · ${c.settimane} settimane · ${fmtEuro(c.dovuto)} (versato ${fmtEuro(c.versato)})` }
          else if (mod === 'MAGAZZINO') { const c = Object.values(contiMagazzino(i)); const car = c.reduce((a, x) => a + x.car, 0), con = c.reduce((a, x) => a + x.con, 0), att = c.reduce((a, x) => a + x.att, 0); pct = car ? Math.round(100 * con / car) : 0; testo = `${con} consegnati su ${car} caricati · ${att} in attesa` }
          else { const dest = destinatari(db, i); const n = dest.filter(s => mod === 'SCELTA' ? i.scelte[s.id]?.opz : i.scelte[s.id]?.consegnato).length; pct = dest.length ? Math.round(100 * n / dest.length) : 0; testo = mod === 'SCELTA' ? `${n} scelte su ${dest.length}` : `${n} consegne su ${dest.length}` }
          const mag = mod === 'MAGAZZINO' ? contiMagazzino(i) : null
          return (
            <button key={i.id} onClick={() => setAperta(i.id)} className={`${cardCls} p-5 text-left hover:border-slate-700 transition-colors flex flex-col gap-3`}>
              <div className="flex items-center gap-2"><TipoChip db={db} id={i.tipo} /><span className="ml-auto flex gap-1.5">{i.archiviata && <Pill>Archiviato</Pill>}<StatoChip db={db} id={i.stato} title={REGOLE[statoDi(db, i.stato).regola].descr} /></span></div>
              <div><p className={`font-semibold ${ann ? 'text-slate-500 line-through' : 'text-white'}`}>{i.titolo}</p>
                <p className="text-xs text-slate-500 mt-0.5 tabular-nums">{fmtData(i.data)}{i.scadenza ? ` · entro ${fmtData(i.scadenza)}` : ''} · {descrPart(i, aggiunti(db, i).length)}</p></div>
              <div className="flex flex-wrap gap-1.5">
                {mod === 'SCELTA' && i.opzioni.map(o => <span key={o.id} className={`text-[11px] px-2 py-0.5 rounded-md border ${o.id === i.predefinita ? 'border-indigo-700 text-indigo-300' : 'border-slate-700 text-slate-400'}`}>{o.etichetta}</span>)}
                {mod === 'NESSUNA' && <span className="text-[11px] px-2 py-0.5 rounded-md border border-slate-700 text-slate-400">Nessuna scelta · solo consegna</span>}
                {mod === 'TURNI' && <><span className="text-[11px] px-2 py-0.5 rounded-md border border-sky-900/70 text-sky-200 tabular-nums">{i.periodi.length} settimane · {fmtData(i.periodi[0]?.dal)} – {fmtData(i.periodi[i.periodi.length - 1]?.al)}</span><span className="text-[11px] px-2 py-0.5 rounded-md border border-sky-900/70 text-sky-200 tabular-nums">{fmtEuro(i.quota)} a settimana{riassuntoSconti(i) ? ` · sconti: ${riassuntoSconti(i)}` : ''}</span></>}
                {mag && i.articoli.map(a => <span key={a.id} className="text-[11px] px-2 py-0.5 rounded-md border border-rose-900/70 text-rose-200 tabular-nums">{a.nome} · {mag[a.id]?.giac ?? 0} in giacenza</span>)}
                {mod === 'ORDINE' && gruppiProdotti(i).map(g => <span key={g.tip} className="text-[11px] px-2 py-0.5 rounded-md border border-pink-900/70 text-pink-200 tabular-nums">{tipNome(db, g.tip)} · {g.prod.length > 1 ? `${g.prod.length} formati da ${fmtEuro(Math.min(...g.prod.map(p => p.prezzo)))}` : `${g.prod[0]!.nome} ${fmtEuro(g.prod[0]!.prezzo)}${perUnita(g.prod[0]!)}`}</span>)}
              </div>
              <div>
                <div className="flex justify-between gap-3 text-xs text-slate-400 mb-1 tabular-nums"><span>{testo}</span><span>{pct}%</span></div>
                <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden"><div className={`h-full rounded-full ${mod === 'ORDINE' ? 'bg-pink-500' : mod === 'TURNI' ? 'bg-sky-500' : mod === 'MAGAZZINO' ? 'bg-rose-500' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} /></div>
              </div>
            </button>)
        })}
      </div>
      {edit && <IniziativaModal id={edit === '__NEW' ? null : edit} onClose={() => setEdit(null)} onCreata={id => setAperta(id)} />}
    </div>
  )
}

// ── Maschera dell'evento ─────────────────────────────────────
type ProdTxt = Prodotto & { prezzoTxt: string; maxTxt: string; contTxt: string
  /** 26.11.25: formati di confezione come si scrivono (quanto contiene, con la virgola) */
  formTxt: Array<{ id: string; tipo: string; qTxt: string }> }
/** Un numero positivo con la virgola o il punto (formati di confezione). */
const misuraOk = (t: string) => /^\d+([.,]\d{1,2})?$/.test(t.trim()) && +t.trim().replace(',', '.') > 0
interface FormEvento {
  tipo: string; titolo: string; anno: number; data: string; scadenza: string; stato: Iniziativa['stato']; modalita: Modalita
  modoPart: Iniziativa['modoPart']; gruppi: Gruppo[]; sedi: string[]; predefinita: string | null
  fornitore: string; pagamento: string; note: string
  opzioni: Iniziativa['opzioni']; prodotti: ProdTxt[]
  periodi: Array<{ id: string; nome: string; dal: string; al: string; postiTxt: string }>
  articoli: Array<{ id: string; nome: string; prezzoTxt: string }>
  quotaTxt: string; scontiTxt: ScontiTxt
}
const nuovoId = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 2).toString(36)}`
const MODI: Array<[Modalita, string, string]> = [['SCELTA', "Scelta di un'opzione", 'Es. gusto del panettone'], ['NESSUNA', 'Nessuna scelta', 'Uguale per tutti, si registra la consegna'], ['ORDINE', 'Ordine a pagamento', 'Prodotti con prezzo e quantità'], ['TURNI', 'Turni a quota fissa', 'Es. campi estivi: settimane a prezzo fisso'], ['MAGAZZINO', 'Magazzino', 'Es. biglietti cinema: carichi, richieste, consegne']]

function IniziativaModal({ id, onClose, onCreata, copia }: { id: string | null; onClose: () => void; onCreata?: (id: string) => void; copia?: CopiaPronta }) {
  const { db, esegui } = useCral()
  const esistente = id ? db.iniziative.find(i => i.id === id) : undefined
  const tipoIniziale = db.tipi.find(t => t.attivo && !t.pagamento && !t.modo)?.id ?? db.tipi[0]?.id ?? ''
  const [f, setF] = useState<FormEvento>(() => {
    // 26.11.23: la copia apre la maschera di un evento nuovo già compilata
    const b = esistente ?? copia?.base
    return {
      tipo: b?.tipo ?? tipoIniziale, titolo: b?.titolo ?? '', anno: b?.anno ?? new Date().getFullYear(), data: b?.data ?? '', scadenza: b?.scadenza ?? '',
      stato: b?.stato ?? 'BOZZA', modalita: b?.modalita ?? 'SCELTA', modoPart: b?.modoPart ?? 'GRUPPI', gruppi: b?.gruppi ?? ['SD', 'SE'], sedi: b?.sedi ?? [],
      predefinita: b?.predefinita ?? null, fornitore: b?.fornitore ?? '', pagamento: b?.pagamento ?? '', note: b?.note ?? '',
      opzioni: b?.opzioni.length ? b.opzioni.map(o => ({ ...o })) : [{ id: 'O1', etichetta: '' }, { id: 'O2', etichetta: '' }],
      prodotti: (b?.prodotti ?? []).map(p => ({ ...p, prezzoTxt: fmtImp(p.prezzo), maxTxt: p.max ? String(p.max) : '', contTxt: p.contenuto ? fmtQ(p.contenuto) : '', formTxt: (p.confezioni ?? []).map(c => ({ id: c.id, tipo: c.tipo, qTxt: fmtQ(c.q) })) })),
      periodi: (b?.periodi ?? []).map(p => ({ id: p.id, nome: p.nome, dal: p.dal, al: p.al, postiTxt: p.posti ? String(p.posti) : '' })),
      articoli: (b?.articoli ?? []).map(a => ({ id: a.id, nome: a.nome, prezzoTxt: fmtImp(a.prezzo) })),
      quotaTxt: b?.quota ? fmtImp(b.quota) : '', scontiTxt: scontiInTxt(b?.sconti ?? {}),
    }
  })
  const [gen, setGen] = useState({ dal: '', n: '4', posti: '' })
  const [salvo, setSalvo] = useState(false)
  const mod = f.modalita
  const scelte = esistente ? Object.values(esistente.scelte) : []
  const usate = new Set(scelte.map(v => v.opz).filter(Boolean))
  const ordinati = new Set(scelte.flatMap(v => Object.entries(v.q ?? {}).filter(([, n]) => n > 0).map(([k]) => k)))
  const usatiPer = new Set(scelte.flatMap(v => Object.entries(v.per ?? {}).filter(([, s]) => s).map(([k]) => k)))
  const usatiArt = new Set([...(esistente?.carichi ?? []), ...(esistente?.richieste ?? [])].map(x => x.art))
  // 26.11.25: formati scelti a mano da qualcuno («prodotto|formato»): non si tolgono e non cambiano misura
  const usatiForm = new Set(scelte.flatMap(v => Object.entries(v.conf ?? {}).flatMap(([pid, m]) => Object.entries(m).filter(([, n]) => n > 0).map(([fid]) => `${pid}|${fid}`))))
  const [formAperti, setFormAperti] = useState<string | null>(null)
  const inUso = !!esistente && (scelte.length > 0 || esistente.carichi.length > 0 || esistente.richieste.length > 0)
  const opzOk = mod !== 'SCELTA' || (f.opzioni.length >= 2 && f.opzioni.every(o => o.etichetta.trim()))
  const prodOk = mod !== 'ORDINE' || (f.prodotti.length >= 1 && f.prodotti.every(p => p.nome.trim() && parseEuro(p.prezzoTxt) !== null && (!p.maxTxt || /^\d+$/.test(p.maxTxt)) && (!p.contTxt || /^\d+([.,]\d+)?$/.test(p.contTxt)) && (p.unita === 'cas' || p.formTxt.every(x => misuraOk(x.qTxt)))))
  const turOk = mod !== 'TURNI' || (f.periodi.length >= 1 && f.periodi.every(p => p.nome.trim() && p.dal && p.al && p.al >= p.dal && (!p.postiTxt || /^\d+$/.test(p.postiTxt))) && (parseEuro(f.quotaTxt) ?? 0) > 0)
  const magOk = mod !== 'MAGAZZINO' || (f.articoli.length >= 1 && f.articoli.every(a => a.nome.trim() && parseEuro(a.prezzoTxt || '0') !== null))
  const ok = !!f.titolo.trim() && !!f.data && opzOk && prodOk && turOk && magOk && scontiTxtOk(f.scontiTxt) && (f.modoPart === 'SINGOLI' || f.gruppi.length > 0) && !salvo
  // 26.11.14.2: persone aggiunte a mano a un evento per gruppi, contate con i gruppi e le sedi scelti qui
  const nAgg = esistente ? aggiunti(db, { ...esistente, modoPart: 'GRUPPI', gruppi: f.gruppi, sedi: f.sedi }).length : 0
  const setOpz = (k: string, v: string) => setF({ ...f, opzioni: f.opzioni.map(o => o.id === k ? { ...o, etichetta: v } : o) })
  const setProd = (k: string, p: Partial<ProdTxt>) => setF({ ...f, prodotti: f.prodotti.map(x => x.id === k ? { ...x, ...p } : x) })
  const prodVuoto = (): ProdTxt => ({ id: nuovoId('P'), tipologia: db.tipologie.find(t => t.attiva)?.id ?? '', nome: '', prezzo: 0, unita: 'pz', contenuto: null, contenutoUm: 'lt', max: null, confezioni: [], prezzoTxt: '', maxTxt: '', contTxt: '', formTxt: [] })
  const setForm = (k: string, fid: string, x: Partial<ProdTxt['formTxt'][number]>) => setF({ ...f, prodotti: f.prodotti.map(p => p.id !== k ? p : { ...p, formTxt: p.formTxt.map(y => y.id === fid ? { ...y, ...x } : y) }) })
  const conModo = (g: FormEvento, m: Modalita): FormEvento => ({
    ...g, modalita: m,
    prodotti: m === 'ORDINE' && !g.prodotti.length ? [prodVuoto()] : g.prodotti,
    articoli: m === 'MAGAZZINO' && !g.articoli.length ? [{ id: nuovoId('A'), nome: '', prezzoTxt: '' }] : g.articoli,
    modoPart: m === 'TURNI' && !esistente ? 'SINGOLI' : g.modoPart,
  })
  function scegliTipo(t: string) {
    const tp = db.tipi.find(x => x.id === t)
    if (!esistente && tp?.modo) setF(conModo({ ...f, tipo: t }, tp.modo))
    else if (!esistente && tp?.pagamento && mod !== 'ORDINE') setF(conModo({ ...f, tipo: t }, 'ORDINE'))
    else setF({ ...f, tipo: t })
  }
  async function salva() {
    const body: CralIniziativaBody = {
      tipo: f.tipo, titolo: f.titolo.trim(), anno: f.anno, data: f.data, scadenza: f.scadenza || null, stato: f.stato, modalita: mod,
      modoPart: f.modoPart, gruppi: f.modoPart === 'GRUPPI' ? f.gruppi : [], sedi: f.modoPart === 'GRUPPI' ? f.sedi : [],
      predefinita: mod === 'SCELTA' ? f.predefinita : null, fornitore: mod === 'ORDINE' ? f.fornitore.trim() : '',
      pagamento: ['ORDINE', 'TURNI', 'MAGAZZINO'].includes(mod) ? f.pagamento.trim() : '', note: f.note,
      quota: mod === 'TURNI' ? parseEuro(f.quotaTxt) ?? 0 : 0,
      config: {
        opzioni: mod === 'SCELTA' ? f.opzioni.map(o => ({ id: o.id, etichetta: o.etichetta.trim() })) : [],
        prodotti: mod === 'ORDINE' ? f.prodotti.map(({ prezzoTxt, maxTxt, contTxt, formTxt, ...p }) => ({ ...p, nome: p.nome.trim(), prezzo: parseEuro(prezzoTxt) ?? 0, max: maxTxt ? +maxTxt : null, contenuto: contTxt ? +contTxt.replace(',', '.') : null,
          confezioni: p.unita === 'cas' ? [] : formTxt.map(x => ({ id: x.id, tipo: x.tipo, q: +x.qTxt.trim().replace(',', '.') })) })) : [],
        periodi: mod === 'TURNI' ? f.periodi.map(({ postiTxt, ...p }) => ({ ...p, nome: p.nome.trim(), posti: postiTxt ? +postiTxt : null })) : [],
        articoli: mod === 'MAGAZZINO' ? f.articoli.map(({ prezzoTxt, ...a }) => ({ ...a, nome: a.nome.trim(), prezzo: parseEuro(prezzoTxt || '0') ?? 0 })) : [],
        sconti: ['ORDINE', 'TURNI', 'MAGAZZINO'].includes(mod) ? scontiDaTxt(f.scontiTxt, mod) : {},
      },
    }
    setSalvo(true)
    // copia: le scelte riportate valgono solo per le opzioni che l'evento nuovo ha ancora
    const opzFinali = new Set(body.config.opzioni.map(o => o.id))
    // 26.11.23.1: e le sedi di consegna solo se l'evento nuovo consegna per sede
    const scelteCopia = (copia?.scelte ?? []).flatMap(x => {
      const v = { socio: x.socio, ...(mod === 'SCELTA' && x.opz && opzFinali.has(x.opz) ? { opz: x.opz } : {}), ...(conLuogo(mod) && x.luogo ? { luogo: x.luogo } : {}) }
      return v.opz || v.luogo ? [v] : []
    })
    const r = await esegui(() => esistente ? cralApi.salvaIniziativa(esistente.id, body)
      : copia ? cralApi.copiaIniziativa({ da: copia.da.id, evento: body, partecipanti: copia.partecipanti, scelte: scelteCopia })
        : cralApi.creaIniziativa(body),
    x => esistente ? 'Evento salvato' : copia ? `Evento copiato${'partecipanti' in x && x.partecipanti ? ` · ${x.partecipanti} partecipanti` : ''}${'scelte' in x && x.scelte ? ` · ${x.scelte} scelte riportate` : ''}${'luoghi' in x && x.luoghi ? ` · ${x.luoghi} sedi di consegna` : ''}` : 'Evento creato')
    setSalvo(false)
    if (r) { onClose(); if (!esistente) onCreata?.(r.iniziativa.id) }
  }
  const setPeriodo = (pid: string, p: Partial<FormEvento['periodi'][number]>) => setF({ ...f, periodi: f.periodi.map(x => x.id === pid ? { ...x, ...p } : x) })
  return (
    <Modale largo titolo={esistente ? 'Modifica evento' : copia ? 'Nuovo evento · copia' : 'Nuovo evento'} sotto={copia ? `Da «${copia.da.titolo}». Rivedi e cambia quello che serve: si salva come un evento nuovo.` : undefined} onClose={onClose} piedi={<><button className={btnSecondario} onClick={onClose}>Annulla</button><button className={btnPrimario} disabled={!ok} onClick={() => void salva()}>Salva</button></>}>
      <div className="flex flex-col gap-4">
        <div className="grid sm:grid-cols-3 gap-4">
          <Campo label="Tipo" hint="I tipi si personalizzano in Parametri"><select className={inputCls} value={f.tipo} onChange={e => scegliTipo(e.target.value)}>{db.tipi.filter(t => t.attivo || t.id === f.tipo).map(t => <option key={t.id} value={t.id}>{t.nome}{t.pagamento ? ' · a pagamento' : ''}</option>)}</select></Campo>
          <div className="sm:col-span-2"><Campo label="Titolo"><input className={inputCls} maxLength={160} value={f.titolo} placeholder="Es. Panettoni Natale 2026" onChange={e => setF({ ...f, titolo: e.target.value })} /></Campo></div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Campo label="Stato" hint={REGOLE[statoDi(db, f.stato).regola].descr}><select className={inputCls} value={f.stato} onChange={e => setF({ ...f, stato: e.target.value })}>{db.stati.filter(s => s.attivo || s.id === f.stato).map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></Campo>
          <Campo label="Anno"><input type="number" min={2000} max={2100} className={inputCls} value={f.anno} onChange={e => setF({ ...f, anno: +e.target.value || f.anno })} /></Campo>
          <Campo label="Data consegna / evento"><input type="date" className={inputCls} value={f.data} onChange={e => setF({ ...f, data: e.target.value })} /></Campo>
          <Campo label={mod === 'ORDINE' ? 'Ordini entro' : mod === 'TURNI' ? 'Iscrizioni entro' : mod === 'MAGAZZINO' ? 'Richieste entro' : 'Scelte entro'}><input type="date" className={inputCls} value={f.scadenza} onChange={e => setF({ ...f, scadenza: e.target.value })} /></Campo>
        </div>
        <div className="flex flex-col gap-3 rounded-lg border border-slate-800 p-4">
          <span className={etichettaCls}>Modalità</span>
          <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {MODI.map(([k, t, d]) => <button key={k} disabled={inUso && k !== esistente?.modalita} title={inUso ? 'Ci sono già scelte, ordini o movimenti: la modalità non si cambia' : ''} onClick={() => setF(conModo(f, k))} className={`text-left rounded-lg border px-3 py-2.5 transition-colors disabled:opacity-40 ${mod === k ? (k === 'ORDINE' ? 'border-pink-500 bg-pink-950/20' : 'border-indigo-500 bg-indigo-950/30') : 'border-slate-700 hover:border-slate-600'}`}><p className="text-sm font-medium text-white">{t}</p><p className="text-xs text-slate-500">{d}</p></button>)}
          </div>
          {mod === 'SCELTA' && <>
            <div className="flex flex-col gap-2">
              {f.opzioni.map((o, k) => (
                <div key={o.id} className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-5 tabular-nums">{k + 1}</span>
                  <input className={inputCls} maxLength={120} value={o.etichetta} placeholder="Es. Panettone con canditi" onChange={e => setOpz(o.id, e.target.value)} />
                  <button title={usate.has(o.id) ? 'Già scelta da qualcuno: non si toglie' : 'Togli opzione'} disabled={usate.has(o.id) || f.opzioni.length <= 2} className="p-2 rounded-md text-slate-500 hover:text-red-400 disabled:opacity-30" onClick={() => setF({ ...f, opzioni: f.opzioni.filter(x => x.id !== o.id), predefinita: f.predefinita === o.id ? null : f.predefinita })}><Ico d={D.trash} /></button>
                </div>))}
              <button className={btnPiccoloSec + ' self-start'} onClick={() => setF({ ...f, opzioni: [...f.opzioni, { id: nuovoId('O'), etichetta: '' }] })}><Ico d={D.plus} cls="w-3.5 h-3.5" />Aggiungi opzione</button>
            </div>
            <Campo label="Opzione per chi non sceglie (facoltativa)" hint="Chi non risponde resta «senza scelta», ma nei conteggi per il fornitore si può contare su questa opzione, e alla chiusura gliela si può assegnare.">
              <select className={inputCls} value={f.predefinita ?? ''} onChange={e => setF({ ...f, predefinita: e.target.value || null })}><option value="">Nessuna</option>{f.opzioni.filter(o => o.etichetta.trim()).map(o => <option key={o.id} value={o.id}>{o.etichetta}</option>)}</select></Campo>
          </>}
          {mod === 'NESSUNA' && <p className="text-xs text-slate-500">Tutti i destinatari ricevono la stessa cosa: si registra solo la consegna.</p>}
          {mod === 'TURNI' && <>
            <div className="rounded-lg bg-slate-950/50 border border-slate-800 p-3 flex flex-wrap gap-3 items-end">
              <Campo label="Primo lunedì"><input type="date" className={inputCls} value={gen.dal} onChange={e => setGen({ ...gen, dal: e.target.value })} /></Campo>
              <div className="w-24"><Campo label="Settimane"><input inputMode="numeric" className={inputCls} value={gen.n} onChange={e => setGen({ ...gen, n: e.target.value.replace(/\D/g, '') })} /></Campo></div>
              <div className="w-28"><Campo label="Posti a sett."><input inputMode="numeric" className={inputCls} value={gen.posti} placeholder="—" onChange={e => setGen({ ...gen, posti: e.target.value.replace(/\D/g, '') })} /></Campo></div>
              <button className={btnSecondario} disabled={!gen.dal || !(+gen.n > 0) || +gen.n > 60 || usatiPer.size > 0} title={usatiPer.size ? 'Ci sono già iscrizioni: modifica le settimane una per una' : ''} onClick={() => setF({ ...f, periodi: generaSettimane(gen.dal, +gen.n, +gen.posti || null) })}>Genera settimane lun–ven</button>
            </div>
            <Scorrevole><table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500"><th className="py-1.5 pr-2 font-semibold">Periodo</th><th className="py-1.5 px-2 font-semibold">Dal</th><th className="py-1.5 px-2 font-semibold">Al</th><th className="py-1.5 px-2 font-semibold">Posti</th><th /></tr></thead>
              <tbody>{f.periodi.map(p => <tr key={p.id}>
                <td className="py-1 pr-2 min-w-[160px]"><input className={inputCls + ' py-1.5'} maxLength={60} value={p.nome} onChange={e => setPeriodo(p.id, { nome: e.target.value })} /></td>
                <td className="py-1 px-2"><input type="date" className={inputCls + ' py-1.5'} value={p.dal} onChange={e => setPeriodo(p.id, { dal: e.target.value })} /></td>
                <td className="py-1 px-2"><input type="date" className={inputCls + ' py-1.5'} value={p.al} onChange={e => setPeriodo(p.id, { al: e.target.value })} /></td>
                <td className="py-1 px-2 w-24"><input inputMode="numeric" className={inputCls + ' py-1.5 text-right'} value={p.postiTxt} placeholder="—" onChange={e => setPeriodo(p.id, { postiTxt: e.target.value.replace(/\D/g, '') })} /></td>
                <td className="py-1 pl-1"><button disabled={usatiPer.has(p.id)} title={usatiPer.has(p.id) ? 'Ci sono iscritti: non si toglie' : 'Togli'} className="p-2 rounded-md text-slate-500 hover:text-red-400 disabled:opacity-30" onClick={() => setF({ ...f, periodi: f.periodi.filter(x => x.id !== p.id) })}><Ico d={D.trash} /></button></td></tr>)}</tbody></table></Scorrevole>
            <button className={btnPiccoloSec + ' self-start'} onClick={() => {
              const u = f.periodi[f.periodi.length - 1]
              const g = u?.dal ? generaSettimane(new Date(new Date(`${u.dal}T12:00:00`).getTime() + 7 * 864e5).toISOString().slice(0, 10), 1, u.postiTxt ? +u.postiTxt : null, f.periodi.length + 1)[0]! : { id: nuovoId('W'), nome: '', dal: '', al: '', postiTxt: '' }
              setF({ ...f, periodi: [...f.periodi, { ...g, id: nuovoId('W'), nome: `Settimana ${f.periodi.length + 1}` }] })
            }}><Ico d={D.plus} cls="w-3.5 h-3.5" />Aggiungi settimana</button>
            <div className="w-56"><Campo label="Quota piena a settimana €"><input inputMode="decimal" className={inputCls + ' text-right tabular-nums'} value={f.quotaTxt} placeholder="180,00" onChange={e => setF({ ...f, quotaTxt: e.target.value })} /></Campo></div>
            <p className="text-xs text-slate-500">La quota è per settimana intera: si paga anche se si frequentano 2 giorni su 5. Una settimana prenotata e non fatta si mette a «Tolta» e non si paga. Un allungamento è una settimana in più.</p>
            <Campo label="Come si paga"><input className={inputCls} maxLength={300} value={f.pagamento} placeholder="Es. bonifico al CRAL prima dell'inizio della settimana" onChange={e => setF({ ...f, pagamento: e.target.value })} /></Campo>
          </>}
          {mod === 'MAGAZZINO' && <>
            <Scorrevole><table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500"><th className="py-1.5 pr-2 font-semibold">Articolo (es. cinema)</th><th className="py-1.5 px-2 font-semibold">Prezzo al socio €</th><th /></tr></thead>
              <tbody>{f.articoli.map(a => <tr key={a.id}>
                <td className="py-1 pr-2"><input className={inputCls + ' py-1.5'} maxLength={80} value={a.nome} placeholder="Es. Cinema convenzionato" onChange={e => setF({ ...f, articoli: f.articoli.map(x => x.id === a.id ? { ...x, nome: e.target.value } : x) })} /></td>
                <td className="py-1 px-2 w-36"><input inputMode="decimal" className={inputCls + ' py-1.5 text-right tabular-nums'} value={a.prezzoTxt} placeholder="0,00" onChange={e => setF({ ...f, articoli: f.articoli.map(x => x.id === a.id ? { ...x, prezzoTxt: e.target.value } : x) })} /></td>
                <td className="py-1 pl-1 w-10"><button disabled={usatiArt.has(a.id) || f.articoli.length <= 1} className="p-2 rounded-md text-slate-500 hover:text-red-400 disabled:opacity-30" onClick={() => setF({ ...f, articoli: f.articoli.filter(x => x.id !== a.id) })}><Ico d={D.trash} /></button></td></tr>)}</tbody></table></Scorrevole>
            <button className={btnPiccoloSec + ' self-start'} onClick={() => setF({ ...f, articoli: [...f.articoli, { id: nuovoId('A'), nome: '', prezzoTxt: '' }] })}><Ico d={D.plus} cls="w-3.5 h-3.5" />Aggiungi articolo</button>
            <p className="text-xs text-slate-500">I carichi (biglietti arrivati, con la data) e le richieste si registrano nella pagina dell'evento. Ogni consegna scala la giacenza.</p>
            <Campo label="Come si paga"><input className={inputCls} maxLength={300} value={f.pagamento} placeholder="Es. contanti alla consegna" onChange={e => setF({ ...f, pagamento: e.target.value })} /></Campo>
          </>}
          {mod === 'ORDINE' && <>
            <Scorrevole><table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500"><th className="py-1.5 pr-2 font-semibold">Tipologia</th><th className="py-1.5 px-2 font-semibold">Prodotto / formato</th><th className="py-1.5 px-2 font-semibold">Prezzo €</th><th className="py-1.5 px-2 font-semibold">Si vende</th><th className="py-1.5 px-2 font-semibold">Contenuto</th><th className="py-1.5 px-2 font-semibold">Confezioni</th><th className="py-1.5 px-2 font-semibold">Max a testa</th><th /></tr></thead>
              <tbody>{f.prodotti.map(p => {
                const errP = p.prezzoTxt !== '' && parseEuro(p.prezzoTxt) === null
                const um = umDi(p), aperto = formAperti === p.id && p.unita !== 'cas'
                const usatoForm = p.formTxt.some(x => usatiForm.has(`${p.id}|${x.id}`))
                const riass = p.formTxt.filter(x => misuraOk(x.qTxt)).map(x => `${nomeConfezione(db, x.tipo)} ${x.qTxt.trim()} ${um}`).join(' · ')
                const errF = p.formTxt.some(x => !misuraOk(x.qTxt))
                return (
                  <Fragment key={p.id}><tr>
                    <td className="py-1 pr-2 w-44"><select className={inputCls + ' py-1.5'} value={p.tipologia} onChange={e => setProd(p.id, { tipologia: e.target.value })}>{db.tipologie.filter(t => t.attiva || t.id === p.tipologia).map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}</select></td>
                    <td className="py-1 px-2 min-w-[200px]"><input className={inputCls + ' py-1.5'} maxLength={120} value={p.nome} placeholder="Es. Latta da 5 lt" onChange={e => setProd(p.id, { nome: e.target.value })} /></td>
                    <td className="py-1 px-2 w-28"><input inputMode="decimal" className={inputCls + ' py-1.5 text-right tabular-nums ' + (errP ? 'border-red-600' : '')} value={p.prezzoTxt} placeholder="0,00" onChange={e => setProd(p.id, { prezzoTxt: e.target.value })} /></td>
                    <td className="py-1 px-2 w-28"><select className={inputCls + ' py-1.5'} value={p.unita} onChange={e => { const u = e.target.value as Prodotto['unita']; setProd(p.id, { unita: u, ...(u === 'cas' ? { formTxt: [] } : {}) }) }}><option value="pz">al pezzo</option><option value="cas" disabled={usatoForm} title={usatoForm ? 'Qualcuno ha scelto le confezioni a mano' : undefined}>a cassetta</option><option value="kg">al kg</option><option value="lt">al litro</option></select></td>
                    <td className="py-1 px-2 w-36"><div className="flex gap-1"><input inputMode="decimal" className={inputW + ' py-1.5 text-right tabular-nums w-16'} value={p.contTxt} placeholder="—" title="Quanto contiene un pezzo, per sommare litri o kg (es. latta da 5 lt)" onChange={e => setProd(p.id, { contTxt: e.target.value })} /><select className={inputW + ' py-1.5 w-16 px-1'} value={p.contenutoUm} onChange={e => setProd(p.id, { contenutoUm: e.target.value as Prodotto['contenutoUm'] })}><option value="lt">lt</option><option value="kg">kg</option></select></div></td>
                    <td className="py-1 px-2 w-44"><button type="button" disabled={p.unita === 'cas'} aria-expanded={aperto} title={p.unita === 'cas' ? 'A cassetta si contano le cassette: niente confezioni' : riass || 'Formati di confezione (es. sacco da 2 kg): PGS propone a ognuno il minimo di confezioni'}
                      className={`w-full max-w-[11rem] truncate text-left rounded-md border px-2.5 py-1.5 text-xs disabled:opacity-40 ${aperto ? 'border-pink-600 bg-pink-950/30 text-pink-100' : errF ? 'border-red-600 text-red-300' : riass ? 'border-slate-700 text-slate-200 hover:border-slate-500' : 'border-dashed border-slate-700 text-slate-500 hover:text-slate-300'}`}
                      onClick={() => setFormAperti(aperto ? null : p.id)}>{p.unita === 'cas' ? '—' : riass || '+ Confezioni'}</button></td>
                    <td className="py-1 px-2 w-24"><input inputMode="numeric" className={inputCls + ' py-1.5 text-right tabular-nums'} value={p.maxTxt} placeholder="—" onChange={e => setProd(p.id, { maxTxt: e.target.value.replace(/\D/g, '') })} /></td>
                    <td className="py-1 pl-1"><button title={ordinati.has(p.id) ? 'Già ordinato da qualcuno: non si toglie' : 'Togli prodotto'} disabled={ordinati.has(p.id) || f.prodotti.length <= 1} className="p-2 rounded-md text-slate-500 hover:text-red-400 disabled:opacity-30" onClick={() => setF({ ...f, prodotti: f.prodotti.filter(x => x.id !== p.id) })}><Ico d={D.trash} /></button></td>
                  </tr>
                  {aperto && <tr><td colSpan={8} className="pb-3 pt-1">
                    <div className="ml-2 rounded-lg border border-pink-900/70 bg-pink-950/10 p-3 flex flex-col gap-2">
                      <p className={etichettaCls}>Confezioni di {p.nome.trim() || 'questo prodotto'} · quanto contiene ciascuna, in {um === 'kg' ? 'kg' : um === 'lt' ? 'litri' : 'pezzi'}</p>
                      {p.formTxt.map(x => {
                        const usato = usatiForm.has(`${p.id}|${x.id}`)
                        return (
                          <div key={x.id} className="flex flex-wrap items-center gap-2">
                            <select className={inputW + ' py-1.5 w-44'} value={x.tipo} aria-label="Tipo di confezione" onChange={e => setForm(p.id, x.id, { tipo: e.target.value })}>
                              {db.confezioni.filter(c => c.attiva || c.id === x.tipo).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                              {!db.confezioni.some(c => c.id === x.tipo) && <option value={x.tipo}>{x.tipo}</option>}</select>
                            <span className="text-xs text-slate-500">da</span>
                            <input inputMode="decimal" disabled={usato} aria-label="Quanto contiene" className={inputW + ' py-1.5 w-20 text-right tabular-nums ' + (misuraOk(x.qTxt) ? '' : 'border-red-600')} value={x.qTxt} placeholder="2" onChange={e => setForm(p.id, x.id, { qTxt: e.target.value })} />
                            <span className="text-xs text-slate-300 w-6">{um}</span>
                            <button disabled={usato} title={usato ? 'Scelto a mano da qualcuno: non si toglie' : 'Togli formato'} className="p-2 rounded-md text-slate-500 hover:text-red-400 disabled:opacity-30" onClick={() => setProd(p.id, { formTxt: p.formTxt.filter(y => y.id !== x.id) })}><Ico d={D.trash} /></button>
                            {usato && <span className="text-[11px] text-pink-300">in uso in una scelta a mano: misura fissa, non si toglie</span>}
                          </div>)
                      })}
                      <div className="flex flex-wrap items-center gap-3">
                        <button className={btnPiccoloSec} disabled={p.formTxt.length >= 10 || !db.confezioni.some(c => c.attiva)} onClick={() => setProd(p.id, { formTxt: [...p.formTxt, { id: nuovoId('F'), tipo: db.confezioni.find(c => c.attiva)?.id ?? '', qTxt: '' }] })}><Ico d={D.plus} cls="w-3.5 h-3.5" />Aggiungi formato</button>
                        <span className="text-xs text-slate-500">Il prezzo resta quello del prodotto ({fmtEuro(parseEuro(p.prezzoTxt) ?? 0)}{um === 'pz' ? ' al pezzo' : `/${um}`}). Senza formati il prodotto si vende come prima. I tipi (sacco, pacco…) si personalizzano in Parametri.</span>
                      </div>
                    </div></td></tr>}
                  </Fragment>)
              })}</tbody>
            </table></Scorrevole>
            <button className={btnPiccoloSec + ' self-start'} onClick={() => setF({ ...f, prodotti: [...f.prodotti, prodVuoto()] })}><Ico d={D.plus} cls="w-3.5 h-3.5" />Aggiungi prodotto</button>
            <p className="text-xs text-slate-500">Ogni riga è un prodotto con il suo prezzo: per l'olio, una riga per ogni varietà e formato. «Al kg» e «al litro» accettano quantità decimali (1,5 kg); «a cassetta» conta le cassette. Con le <b className="text-slate-400">confezioni</b> (es. sacchi da 1 e da 2 kg) PGS propone a ognuno il minimo di confezioni, che si corregge a mano sulla persona. Il contenuto serve a sommare litri o kg nell'ordine al fornitore. Prezzo 0,00 = omaggio. Le tipologie si personalizzano in Parametri.</p>
            <div className="grid sm:grid-cols-2 gap-4"><Campo label="Fornitore"><input className={inputCls} maxLength={160} value={f.fornitore} placeholder="A chi va l'ordine complessivo" onChange={e => setF({ ...f, fornitore: e.target.value })} /></Campo>
              <Campo label="Come si paga"><input className={inputCls} maxLength={300} value={f.pagamento} placeholder="Es. contanti al ritiro, oppure bonifico al CRAL entro la scadenza" onChange={e => setF({ ...f, pagamento: e.target.value })} /></Campo></div>
          </>}
        </div>
        {(mod === 'ORDINE' || mod === 'TURNI' || mod === 'MAGAZZINO') && <ScontiTipologia mod={mod} valori={f.scontiTxt} onChange={scontiTxt => setF({ ...f, scontiTxt })} />}
        <div className="flex flex-col gap-3 rounded-lg border border-slate-800 p-4">
          <span className={etichettaCls}>Partecipanti</span>
          <div className="grid sm:grid-cols-2 gap-2">
            {([['GRUPPI', 'Per gruppi', 'Una o più tipologie già anagrafate: tutti quelli attivi partecipano'], ['SINGOLI', 'Singoli', 'Si caricano uno per uno: da file (importazione) o con «Nuovo partecipante»']] as Array<[Iniziativa['modoPart'], string, string]>).map(([k, t, d]) => (
              <button key={k} onClick={() => setF({ ...f, modoPart: k })} className={sceltaCls(f.modoPart === k)}><p className="text-sm font-medium text-white">{t}</p><p className="text-xs text-slate-500">{d}</p></button>))}
          </div>
          {f.modoPart === 'GRUPPI' ? <>
            <div><p className="text-xs text-slate-400 mb-1.5">Gruppi (anche più di uno)</p>
              <div className="flex flex-wrap gap-1.5">
                {GRUPPI_EVENTO.map(g => { const on = f.gruppi.includes(g); const n = db.soci.filter(x => x.stato === 'ATTIVO' && gruppoDi(db, x) === g).length; return <button key={g} onClick={() => setF({ ...f, gruppi: on ? f.gruppi.filter(x => x !== g) : [...f.gruppi, g] })} className={chipCls(on) + (g === 'FEX' ? ' border-dashed' : '')}>{on && <Ico d={D.check} cls="w-3 h-3" />}{NOMI_GRUPPO[g]} <span className="text-slate-500 tabular-nums">{n}</span></button> })}
              </div>
              {!f.gruppi.length && <p className="text-xs text-red-300 mt-1.5">Scegli almeno un gruppo.</p>}
              {(f.gruppi.includes('FAM') || f.gruppi.includes('FEX')) && <p className="text-xs text-slate-500 mt-1.5">I familiari partecipano finché almeno una delle loro persone di riferimento è attiva.{f.gruppi.includes('FEX') ? ' I familiari di esterni hanno la categoria di sconto del loro esterno.' : ''}</p>}</div>
            <div><p className="text-xs text-slate-400 mb-1.5">Sedi coinvolte (sede di lavoro di chi partecipa)</p>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => setF({ ...f, sedi: [] })} className={chipCls(!f.sedi.length)}>Tutte</button>
                {db.sedi.filter(s => s.attiva || f.sedi.includes(s.id)).map(s => { const on = f.sedi.includes(s.id); return <button key={s.id} onClick={() => setF({ ...f, sedi: on ? f.sedi.filter(x => x !== s.id) : [...f.sedi, s.id] })} className={chipCls(on)}>{sedeBreve(s.nome)}</button> })}
              </div></div>
            <p className="text-xs text-slate-500">{nAgg ? `${nAgg} ${nAgg === 1 ? 'persona aggiunta a mano resta' : 'persone aggiunte a mano restano'} nell'evento anche se fuori da questi gruppi e sedi: si tolgono dalla pagina dell'evento.` : "Chi è fuori dai gruppi (es. un esterno a cui fare un omaggio) si aggiunge dalla pagina dell'evento con «Aggiungi persona»: resta della sua tipologia."}</p>
          </> : <p className="text-xs text-slate-500">{copia && !esistente ? (copia.partecipanti.length ? `${copia.partecipanti.length} partecipanti dalla copia: si caricano col salvataggio.` : "Nessun partecipante dalla copia: dopo il salvataggio, nella pagina dell'evento, «Importa partecipanti» o «Nuovo partecipante».") : esistente?.partecipanti.length ? `${esistente.partecipanti.length} partecipanti già caricati.` : "Dopo il salvataggio, nella pagina dell'evento: «Importa partecipanti» (file) oppure «Nuovo partecipante» (uno alla volta, anche persone nuove di qualunque tipologia)."}</p>}
        </div>
        <Campo label="Note"><textarea rows={2} maxLength={1000} className={inputCls} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Campo>
      </div>
    </Modale>
  )
}

// ── Tabelle di riepilogo ─────────────────────────────────────
function TabellaRiepilogo({ ini, mancantiComePred }: { ini: Iniziativa; mancantiComePred: boolean }) {
  const { db } = useCral()
  const { colonne, righe } = riepilogo(db, ini, mancantiComePred)
  const etich = (c: string) => c === '__NONE' ? 'Non indicata' : c === '__ADES' ? 'Destinatari' : (ini.opzioni.find(o => o.id === c)?.etichetta ?? c)
  const tot: Record<string, number> = Object.fromEntries(colonne.map(c => [c, righe.reduce((a, [, r]) => a + (r[c] ?? 0), 0)]))
  const vis = colonne.filter(c => c !== '__NONE' || (tot['__NONE'] ?? 0) > 0)
  const totG = Object.values(tot).reduce((a, b) => a + b, 0)
  return (
    <Scorrevole><table className="w-full text-sm">
      <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 bg-slate-900/60">
        <th className="px-5 py-2.5 font-semibold">Sede di consegna</th>{vis.map(c => <th key={c} className={`${thCls} text-right ${c === '__NONE' ? 'text-amber-500/80' : ''}`}>{etich(c).split(' - ')[0]}</th>)}<th className="px-5 py-2.5 font-semibold text-right">Totale</th></tr></thead>
      <tbody className="divide-y divide-slate-800/70 tabular-nums">
        {righe.map(([k, r]) => <tr key={k}><td className="px-5 py-2 text-slate-200 whitespace-nowrap">{k === '__NOSEDE' ? <span className="text-amber-400">Sede non indicata</span> : sedeNome(db, k)}</td>
          {vis.map(c => <td key={c} className={`px-3 py-2 text-right ${r[c] ? (c === '__NONE' ? 'text-amber-400' : 'text-slate-200') : 'text-slate-600'}`}>{r[c] ?? 0}</td>)}
          <td className="px-5 py-2 text-right text-white font-medium">{Object.values(r).reduce((a, b) => a + b, 0)}</td></tr>)}
        <tr className="bg-slate-800/40 font-semibold"><td className="px-5 py-2 text-white">Totale complessivo</td>{vis.map(c => <td key={c} className="px-3 py-2 text-right text-white">{tot[c]}</td>)}<td className="px-5 py-2 text-right text-white">{totG}</td></tr>
      </tbody>
    </table></Scorrevole>
  )
}

function TabellaOrdini({ ini }: { ini: Iniziativa }) {
  const { db } = useCral()
  const righe = righeOrdiniPerSede(db, ini)
  if (!righe.length) return <p className="px-5 py-6 text-sm text-slate-500">Ancora nessun ordine.</p>
  const te = righe.reduce((a, [, r]) => a + r.eur, 0), tn = righe.reduce((a, [, r]) => a + r.n, 0)
  // 26.11.25: per i prodotti con le confezioni una colonna per formato (e «non confezionato» se qualcosa resta fuori)
  const tutti = righe.flatMap(([, r]) => r.ids)
  const cols = colonneOrdine(ini, tutti)
  const nCol = (g: { prod: Prodotto[] }) => cols.filter(c => g.prod.includes(c.p)).length
  const cella = (ids: string[], c: ColonnaOrdine) => { const v = valoreColonna(ini, ids, c); return c.resto ? (v ? `${fmtQ(v)} ${umDi(c.p)}` : '0') : fmtQ(v) }
  const tono = (ids: string[], c: ColonnaOrdine) => (valoreColonna(ini, ids, c) ? (c.resto ? 'text-amber-300' : 'text-slate-200') : 'text-slate-600')
  return (
    <Scorrevole><table className="w-full text-sm">
      <thead className="text-[11px] uppercase tracking-wider text-slate-500 bg-slate-900/60">
        <tr><th rowSpan={2} className="px-5 py-2 font-semibold text-left align-bottom">Sede di consegna</th><th rowSpan={2} className={thCls + ' text-right align-bottom'}>Ordini</th>{gruppiProdotti(ini).map(g => <th key={g.tip} colSpan={nCol(g)} className="px-3 pt-2 pb-1 font-semibold text-center text-pink-300/90 border-b border-slate-800">{tipNome(db, g.tip)}</th>)}<th rowSpan={2} className="px-5 py-2 font-semibold text-right align-bottom">Importo</th></tr>
        <tr>{cols.map(c => <th key={`${c.p.id}|${c.f?.id ?? (c.resto ? 'R' : '')}`} className="px-3 pb-2 pt-1 font-semibold text-right normal-case tracking-normal whitespace-nowrap">{c.p.nome}{sottoColonna(db, c) && <div className={`font-normal ${c.resto ? 'text-amber-400/90' : c.f ? 'text-pink-200/80' : 'text-slate-400'}`}>{sottoColonna(db, c)}</div>}</th>)}</tr></thead>
      <tbody className="divide-y divide-slate-800/70 tabular-nums">
        {righe.map(([k, r]) => <tr key={k}><td className="px-5 py-2 text-slate-200 whitespace-nowrap">{k === '__NOSEDE' ? <span className="text-amber-400">Sede non indicata</span> : sedeNome(db, k)}</td><td className="px-3 py-2 text-right text-slate-400">{r.n}</td>
          {cols.map(c => <td key={`${c.p.id}|${c.f?.id ?? (c.resto ? 'R' : '')}`} className={`px-3 py-2 text-right whitespace-nowrap ${tono(r.ids, c)}`}>{cella(r.ids, c)}</td>)}<td className="px-5 py-2 text-right text-white font-medium whitespace-nowrap">{fmtEuro(r.eur)}</td></tr>)}
        <tr className="bg-slate-800/40 font-semibold"><td className="px-5 py-2 text-white">Totale complessivo</td><td className="px-3 py-2 text-right text-white">{tn}</td>{cols.map(c => <td key={`${c.p.id}|${c.f?.id ?? (c.resto ? 'R' : '')}`} className={`px-3 py-2 text-right whitespace-nowrap ${c.resto ? 'text-amber-300' : 'text-white'}`}>{cella(tutti, c)}</td>)}<td className="px-5 py-2 text-right text-white whitespace-nowrap">{fmtEuro(te)}</td></tr>
      </tbody>
    </table></Scorrevole>
  )
}

function AggiungiPartecipanteModal({ ini, onClose }: { ini: Iniziativa; onClose: () => void }) {
  const { db, esegui } = useCral()
  const [q, setQ] = useState('')
  const [nuovo, setNuovo] = useState(false)
  const gia = new Set(ini.partecipanti)
  const perGruppi = ini.modoPart === 'GRUPPI'
  const n = norm(q)
  const ris = n.length < 2 ? [] : db.soci.filter(s => !gia.has(s.id) && !nelGruppo(db, ini, s) && (s.stato === 'ATTIVO' || s.stato === 'DA_VALIDARE') && norm(`${nominativo(s)} ${s.id} ${s.tessera}`).includes(n)).slice(0, 10)
  const aggiungi = (s: Persona) => { void esegui(() => cralApi.partecipanti(ini.id, [s.id]), `${nominativo(s)} aggiunto all'evento`).then(r => { if (r) setQ('') }) }
  if (nuovo) return <NuovoSocioModal perIniziativa={ini.id} onClose={onClose} tipoIniziale="EST" />
  return (
    <Modale titolo={perGruppi ? 'Aggiungi persona' : 'Nuovo partecipante'} sotto={perGruppi ? `A «${ini.titolo}»: chi è fuori dai gruppi dell'evento. Resta della sua tipologia` : `A «${ini.titolo}»: chiunque sia già nel CRAL, di qualunque tipologia`} onClose={onClose} piedi={<><button className={btnSecondario} onClick={onClose}>Fatto</button><button className={btnPrimario} onClick={() => setNuovo(true)}><Ico d={D.plus} />Persona nuova</button></>}>
      <div className="flex flex-col gap-2">
        <div className="relative"><span className="absolute left-3 top-2.5 text-slate-500"><Ico d={D.search} /></span>
          <input autoFocus className={inputCls + ' pl-9'} placeholder="Cognome, ID o tessera: soci dipendenti, soci esterni, esterni, familiari" value={q} onChange={e => setQ(e.target.value)} /></div>
        {n.length >= 2 && <div className="border border-slate-800 rounded-lg divide-y divide-slate-800 max-h-72 overflow-y-auto pgs-discreto">
          {ris.map(s => <button key={s.id} onClick={() => aggiungi(s)} className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-3 text-sm"><span className="font-mono text-xs text-slate-400 w-20">{s.id}</span><span className="text-slate-100 flex-1">{nominativo(s)}{s.tipo === 'FAM' && <span className="block"><DiChi db={db} s={s} /></span>}</span>{s.stato === 'DA_VALIDARE' && <Pill tono="warn">da validare</Pill>}<Origine s={s} /><Ico d={D.plus} cls="w-3.5 h-3.5 text-indigo-400" /></button>)}
          {!ris.length && <p className="px-3 py-3 text-sm text-slate-500">{perGruppi ? "Nessuno fuori dai gruppi dell'evento: chi ne fa già parte non compare. Se è una persona nuova usa «Persona nuova»." : 'Nessuno. Se è una persona nuova usa «Persona nuova».'}</p>}
        </div>}
        <p className="text-xs text-slate-500">Si possono aggiungere più persone di seguito. Chi è «da validare» entra in elenco ma partecipa solo dopo la validazione.</p>
      </div>
    </Modale>
  )
}

// ── Pagina dell'evento ───────────────────────────────────────
/** Esigenze alimentari dei partecipanti: conteggi e, a richiesta, i nomi. Solo chi ha dato il consenso. */
function EsigenzeEvento({ ini }: { ini: Iniziativa }) {
  const { db } = useCral()
  const [aperto, setAperto] = useState(false)
  const pers = partecipantiEffettivi(db, ini)
  const r = riepilogoAlimentare(pers)
  if (ini.modalita === 'MAGAZZINO' || !r.conDati.length) return null
  return (
    <div className="rounded-xl border border-amber-900/50 bg-amber-950/10 px-4 py-2.5 text-sm text-slate-300 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1"><span className="text-amber-300 font-medium">Esigenze alimentari</span>
        {r.conteggi.map(([n, k]) => <span key={n}><b className="text-white tabular-nums">{k}</b> {n.toLowerCase()}</span>)}
        {r.allergie > 0 && <span><b className="text-white tabular-nums">{r.allergie}</b> con allergie</span>}
        <span className="text-xs text-slate-500">su {pers.length} {ini.modalita === 'ORDINE' ? 'che hanno ordinato' : ini.modalita === 'TURNI' ? 'iscritti' : 'partecipanti'}</span>
        <button className="ml-auto text-xs text-indigo-400 hover:text-indigo-300" aria-expanded={aperto} onClick={() => setAperto(!aperto)}>{aperto ? 'Nascondi i nomi' : 'Mostra i nomi'}</button></div>
      {aperto && <ul className="text-xs text-slate-300 grid sm:grid-cols-2 gap-x-6 gap-y-0.5">{r.conDati.map(s => <li key={s.id}><span className="text-slate-100">{nominativo(s)}</span> — {[nomiEsigenze(s.alimentari.esigenze), s.alimentari.allergie ? `allergie: ${s.alimentari.allergie}` : ''].filter(Boolean).join(' · ')}</li>)}</ul>}
      {aperto && <p className="text-[11px] text-slate-500">Per chi prepara: Report › Esigenze alimentari (PDF o Excel).</p>}
    </div>
  )
}

// ── Sede di consegna (26.11.23.1) ────────────────────────────
/** Menu della sede di consegna di una persona: vuoto = la sua sede di lavoro. Una sede disattivata resta visibile dove c'è già. */
function SceltaLuogo({ ini, s, disabled, onChange }: { ini: Iniziativa; s: Persona; disabled: boolean; onChange: (v: string) => void }) {
  const { db } = useCral()
  const l = ini.scelte[s.id]?.luogo ?? ''
  const altrove = consegnaAltrove(ini, s)
  return (
    <select disabled={disabled} aria-label={`Sede di consegna di ${nominativo(s)}`} title={altrove ? 'Ritira in una sede diversa dalla sua sede di lavoro' : undefined}
      className={inputCls + ' py-1 text-xs min-w-[150px] ' + (l ? (altrove ? 'border-amber-600 text-amber-200' : 'text-slate-200') : 'text-slate-500')} value={l} onChange={e => onChange(e.target.value)}>
      <option value="">— come la sede di lavoro</option>
      {db.sedi.filter(x => x.attiva || x.id === l).map(x => <option key={x.id} value={x.id}>{x.nome}{x.attiva ? '' : ' (non attiva)'}</option>)}
    </select>
  )
}

/** Sede di consegna a tutti o all'elenco filtrato; «Togli» rimette la sede di lavoro. Le fonti delle scelte restano. */
function SedeConsegnaModal({ ini, tutti, filtrati, onClose }: { ini: Iniziativa; tutti: Persona[]; filtrati: Persona[]; onClose: () => void }) {
  const { db, esegui } = useCral()
  const diversi = filtrati.length !== tutti.length
  const [chi, setChi] = useState<'tutti' | 'filtrati'>(diversi ? 'filtrati' : 'tutti')
  const [luogo, setLuogo] = useState(db.sedi.find(s => s.attiva)?.id ?? '')
  const [togli, setTogli] = useState(false)
  const persone = chi === 'tutti' ? tutti : filtrati
  const dopo = togli ? '' : luogo
  const cambiano = persone.filter(s => (ini.scelte[s.id]?.luogo ?? '') !== dopo)
  async function applica() {
    // una chiamata per fonte: «modulo», «predef.», «da copia» restano com'erano
    const perFonte = new Map<string, Persona[]>()
    for (const s of cambiano) { const f = ini.scelte[s.id]?.fonte ?? 'manuale'; perFonte.set(f, [...(perFonte.get(f) ?? []), s]) }
    const r = await esegui(async () => {
      let n = 0
      for (const [fonte, ps] of perFonte) for (let k = 0; k < ps.length; k += 5000)
        n += (await cralApi.scelteInBlocco(ini.id, ps.slice(k, k + 5000).map(s => ({ socio: s.id, dati: { luogo: dopo || null } })), fonte as 'manuale' | 'modulo' | 'predefinita' | 'copia')).fatte
      return n
    }, n => (dopo ? `Sede di consegna «${sedeNome(db, dopo)}» a ${n} persone` : `${n} persone tornano alla sede di lavoro`))
    if (r !== null) onClose()
  }
  return (
    <Modale titolo="Sede di consegna" sotto={`Dove ritirano in «${ini.titolo}». La sede di lavoro delle persone non cambia.`} onClose={onClose}
      piedi={<><button className={btnSecondario} onClick={onClose}>Annulla</button><button className={btnPrimario} disabled={!cambiano.length || (!togli && !luogo)} onClick={() => void applica()}>{cambiano.length ? `Applica a ${cambiano.length}` : 'Nessuno da cambiare'}</button></>}>
      <div className="flex flex-col gap-4">
        <div className="grid sm:grid-cols-2 gap-2">
          {([['tutti', 'Tutti i destinatari', tutti.length], ['filtrati', "L'elenco filtrato", filtrati.length]] as Array<['tutti' | 'filtrati', string, number]>).map(([k, t, n]) => (
            <button key={k} type="button" disabled={k === 'filtrati' && !diversi} onClick={() => setChi(k)} className={sceltaCls(chi === k) + ' disabled:opacity-40'}><p className="text-sm font-medium text-white">{t}</p><p className="text-xs text-slate-500 tabular-nums">{n} persone</p></button>))}
        </div>
        <Campo label="Sede di consegna"><select className={inputCls} disabled={togli} value={luogo} onChange={e => setLuogo(e.target.value)}>{db.sedi.filter(s => s.attiva).map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></Campo>
        <Interruttore on={togli} onChange={setTogli} label="Togli la sede di consegna: ritirano nella loro sede di lavoro" />
        <p className="text-xs text-slate-500 tabular-nums">Cambiano {cambiano.length} su {persone.length}. Chi entra nell'evento dopo parte dalla sua sede di lavoro.</p>
      </div>
    </Modale>
  )
}

// ── Confezioni della persona (26.11.25) ──────────────────────
/**
 * Le confezioni di una persona per un prodotto: di partenza il calcolo automatico (il minimo di confezioni);
 * con + e − si scelgono a mano e la quantità diventa la loro somma. «Automatico» torna al calcolo.
 */
function ConfezioniModal({ ini, sid, pid, attivo, onClose, onPatch }: { ini: Iniziativa; sid: string; pid: string; attivo: boolean; onClose: () => void; onPatch: (p: PatchScelta) => void }) {
  const { db } = useCral()
  const s = db.perId.get(sid), p = ini.prodotti.find(x => x.id === pid)
  if (!s || !p) return null
  const fs = formati(p), um = umDi(p), sc = ini.scelte[sid]
  const q = qta(ini, sid, pid)
  const cp = confezioniDi(ini, sid, p) ?? { n: Object.fromEntries(fs.map(f => [f.id, 0])), resto: 0, mano: !!sc?.conf?.[pid] }
  const inConf = fs.reduce((a, f) => a + (cp.n[f.id] ?? 0) * f.q, 0)
  function cambia(fid: string, d: number) {
    const n = Object.fromEntries(fs.map(f => [f.id, Math.max(0, (cp.n[f.id] ?? 0) + (f.id === fid ? d : 0))]))
    const tot = Math.round(fs.reduce((a, f) => a + (n[f.id] ?? 0) * f.q, 0) * 100) / 100
    if (p!.max && tot > p!.max) { avviso(`Massimo ${p!.max} per persona per «${p!.nome}»`, 'warning'); return }
    const { [pid]: _x, ...altre } = sc?.conf ?? {}
    const { [pid]: _y, ...altreQ } = sc?.q ?? {}
    onPatch(tot > 0
      ? { q: { ...altreQ, [pid]: tot }, conf: { ...altre, [pid]: n } }
      : { q: altreQ, conf: Object.keys(altre).length ? altre : null })
  }
  function automatico() {
    const { [pid]: _x, ...altre } = sc?.conf ?? {}
    onPatch({ conf: Object.keys(altre).length ? altre : null })
  }
  return (
    <Modale titolo={`Confezioni · ${p.nome}`} sotto={nominativo(s)} onClose={onClose}
      piedi={<><button className={btnSecondario} disabled={!attivo || !cp.mano} onClick={automatico} title="Torna al numero minimo di confezioni per la quantità di adesso">Automatico</button><button className={btnPrimario} onClick={onClose}>Fatto</button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-slate-400">{cp.mano ? 'Scelte a mano: la quantità è la somma delle confezioni. «Automatico» torna al minimo di confezioni.' : 'Calcolo automatico: il minimo di confezioni per la quantità ordinata. Cambia i numeri per sceglierle a mano (la quantità segue).'}</p>
        <div className="divide-y divide-slate-800 border-y border-slate-800">
          {fs.map(f => (
            <div key={f.id} className="flex items-center gap-3 py-2">
              <span className="flex-1 text-sm text-slate-100">{etichettaFormato(db, p, f)}</span>
              <button className={btnPiccoloSec + ' w-9 justify-center'} disabled={!attivo || !(cp.n[f.id] ?? 0)} aria-label={`Una ${etichettaFormato(db, p, f)} in meno`} onClick={() => cambia(f.id, -1)}>−</button>
              <span className="w-8 text-center font-semibold tabular-nums text-white">{cp.n[f.id] ?? 0}</span>
              <button className={btnPiccoloSec + ' w-9 justify-center'} disabled={!attivo} aria-label={`Una ${etichettaFormato(db, p, f)} in più`} onClick={() => cambia(f.id, 1)}>+</button>
            </div>))}
        </div>
        <div className="flex flex-wrap justify-between gap-2 text-sm tabular-nums">
          <span className="text-slate-400">Ordinati {fmtQ(q)} {um} · in confezioni {fmtQ(inConf)} {um}</span>
          <span className="text-white font-medium">{fmtEuro(Math.round(q * p.prezzo))}</span>
        </div>
        {cp.resto > 0 && <p className="text-xs"><span className="rounded-full px-2 py-0.5 bg-amber-950/70 text-amber-300">non confezionabile · {fmtQ(cp.resto)} {um}</span> <span className="text-slate-500">non entra in nessun formato: resta da consegnare a parte, o si sceglie a mano.</span></p>}
        {!attivo && <p className="text-xs text-amber-400">Lo stato dell'evento non permette di cambiare gli ordini.</p>}
      </div>
    </Modale>
  )
}

function IniziativaDettaglio({ id, onBack, onApri }: { id: string; onBack: () => void; onApri: (id: string) => void }) {
  const [esporta, setEsporta] = useState(false)
  const { db, esegui, scelta } = useCral()
  const ini = db.iniziative.find(i => i.id === id)
  const [cerca, setCerca] = useState('')
  const [spOrd, setSpOrd] = useState<Persona | null>(null)
  const [sede, setSede] = useState('')
  const [solo, setSolo] = useState('')
  const [pred, setPred] = useState(true)
  const [modulo, setModulo] = useState(false)
  const [confPred, setConfPred] = useState(false)
  const [addPar, setAddPar] = useState(false)
  const [impPar, setImpPar] = useState(false)
  const [edit, setEdit] = useState(false)
  const [tipF, setTipF] = useState('')
  const [ord, setOrd] = useState<{ k: string; dir: 1 | -1 }>({ k: 'nom', dir: 1 })
  const [confArch, setConfArch] = useState(false)
  const [copiaDa, setCopiaDa] = useState(false)
  const [copia, setCopia] = useState<CopiaPronta | null>(null)
  const [luogoBlocco, setLuogoBlocco] = useState(false)
  const [confAperta, setConfAperta] = useState<{ sid: string; pid: string } | null>(null)
  if (!ini) return null
  const mod = ini.modalita
  const singoli = ini.modoPart === 'SINGOLI'
  const partSet = new Set(ini.partecipanti)
  // 26.11.14.2: evento per gruppi, chi è stato aggiunto a mano (segno «aggiunto» e «x» per toglierlo)
  const agg = new Set(aggiunti(db, ini).map(s => s.id))
  const posSede = (s: Persona) => { const k = db.sedi.findIndex(x => x.id === s.sede); return k < 0 ? 99 : k }
  const posConsegna = (s: Persona) => { const k = db.sedi.findIndex(x => x.id === sedeConsegna(ini, s)); return k < 0 ? 99 : k }
  const CHIAVI_ORD: Record<string, [string, (s: Persona) => string | number]> = {
    nom: ['Nominativo', s => nominativo(s)], sede: ['Sede di lavoro, poi nominativo', posSede],
    ...(conLuogo(mod) ? { consegna: ['Sede di consegna, poi nominativo', posConsegna] as [string, (s: Persona) => number] } : {}), tip: ['Tipologia, poi nominativo', s => GRUPPI.indexOf(s.tipo)],
    tessera: ['Tessera', s => s.tessera || '~'], id: ['ID', s => s.id],
    ...(mod === 'SCELTA' ? { scelta: ['Scelta, poi nominativo', (s: Persona) => { const k = ini.opzioni.findIndex(o => o.id === ini.scelte[s.id]?.opz); return k < 0 ? 99 : k }] as [string, (s: Persona) => number] } : {}),
    ...(mod === 'ORDINE' ? { totale: ['Totale €', (s: Persona) => nettoSocio(db, ini, s.id)] as [string, (s: Persona) => number], pagato: ['Pagato, poi nominativo', (s: Persona) => ini.scelte[s.id]?.pagato ? 0 : 1] as [string, (s: Persona) => number] } : {}),
    consegnato: ['Consegnato, poi nominativo', s => ini.scelte[s.id]?.consegnato ? 0 : 1],
  }
  const chiave = (CHIAVI_ORD[ord.k] ?? CHIAVI_ORD['nom']!)[1]
  const confronta = (a: Persona, b: Persona) => { const x = chiave(a), y = chiave(b); const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)); return c * ord.dir || nominativo(a).localeCompare(nominativo(b)) }
  const ordinaPer = (k: string) => setOrd(o => ({ k, dir: o.k === k ? (o.dir === 1 ? -1 : 1) : 1 }))
  const Th = ({ k, children, cls = thCls }: { k: string; children: ReactNode; cls?: string }) => <th className={cls}><button className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-200 ${ord.k === k ? 'text-indigo-300' : ''}`} onClick={() => ordinaPer(k)}>{children}{ord.k === k && <span>{ord.dir > 0 ? '▲' : '▼'}</span>}</button></th>
  const dest = destinatari(db, ini)
  const q = norm(cerca)
  const filtroSolo = (s: Persona) => {
    if (!solo) return true
    if (solo === 'mancanti') return !ini.scelte[s.id]?.opz
    if (solo === 'daconsegnare') return !ini.scelte[s.id]?.consegnato && (mod !== 'ORDINE' || haOrdinato(ini, s.id))
    if (solo === 'ordinato') return haOrdinato(ini, s.id)
    if (solo === 'nonordinato') return !haOrdinato(ini, s.id)
    if (solo === 'dapagare') return haOrdinato(ini, s.id) && !ini.scelte[s.id]?.pagato
    return ini.scelte[s.id]?.opz === solo
  }
  const lista = dest.filter(s => (!q || norm(`${nominativo(s)} ${s.tessera} ${s.id}`).includes(q)) && (!sede || sedeConsegna(ini, s) === sede) && (!tipF || gruppoDi(db, s) === tipF) && filtroSolo(s)).sort(confronta)
  const mancanti = dest.filter(s => !ini.scelte[s.id]?.opz).length
  const esclusi = db.soci.filter(s => s.stato === 'DA_VALIDARE' && (partSet.has(s.id) || (!singoli && ini.gruppi.includes(gruppoDi(db, s))))).length
  // 0030: cosa si può fare lo decide la regola dello stato (e l'archiviazione)
  const perm = permessi(db, ini)
  const st0 = statoDi(db, ini.stato)
  const origine = ini.copiatoDa ? db.iniziative.find(x => x.id === ini.copiatoDa) : undefined
  const archivia = (v: boolean) => { void esegui(() => cralApi.archivia(id, v), v ? 'Evento archiviato' : 'Evento ripristinato').then(r => { if (r && v) onBack() }) }
  // la fonte («modulo», «predef.») resta finché non si cambia a mano la scelta o le quantità
  const aggiorna = (sid: string, patch: PatchScelta) => scelta(ini.id, sid, patch, 'opz' in patch || 'q' in patch ? 'manuale' : (ini.scelte[sid]?.fonte ?? 'manuale'))
  const setQta = (s: Persona, p: Prodotto, v: string) => {
    let n = Math.max(0, conDecimali(p) ? Math.round((parseFloat(v.replace(',', '.')) || 0) * 100) / 100 : (parseInt(v, 10) || 0))
    if (p.max && n > p.max) { n = p.max; avviso(`Massimo ${p.max} per persona per «${p.nome}»`, 'warning') }
    aggiorna(s.id, { q: { ...(ini.scelte[s.id]?.q ?? {}), [p.id]: n } })
  }
  const togliPart = (sid: string) => { void esegui(() => cralApi.partecipanti(id, [], [sid]), 'Tolto dall\'evento', 'info') }
  const conti = mod === 'ORDINE' ? contiOrdine(db, ini) : null
  const nomeCella: NomeCella = (s, o = {}) => <td className={`${o.rientro ? 'pl-10' : 'pl-5'} pr-3 py-2 whitespace-nowrap`}><span className="inline-flex items-center gap-1.5">{o.rientro && <span className="text-slate-600 -ml-4 mr-0.5">↳</span>}<span className="text-slate-100">{nominativo(s)}</span>{s.tipo !== 'SD' && <Origine s={s} />}{agg.has(s.id) && <Pill tratteggio title="Aggiunto a mano: non rientra nei gruppi o nelle sedi dell'evento">aggiunto</Pill>}{(singoli || agg.has(s.id)) && perm.raccolta && <button title="Togli dall'evento" className="text-slate-500 hover:text-red-400" onClick={() => togliPart(s.id)}><Ico d={D.x} cls="w-3.5 h-3.5" /></button>}</span>{s.tipo === 'FAM' && !o.sotto && <div><DiChi db={db} s={s} /></div>}{o.sotto}</td>
  const nomePred = ini.opzioni.find(o => o.id === ini.predefinita)?.etichetta
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button className={btnPiccoloSec} onClick={onBack}><Ico d={D.back} cls="w-3.5 h-3.5" />Eventi</button>
        <TipoChip db={db} id={ini.tipo} /><StatoChip db={db} id={ini.stato} title={REGOLE[st0.regola].descr} />{ini.archiviata && <Pill>Archiviato</Pill>}
        <div className="ml-auto flex flex-wrap gap-2">
          {!singoli && perm.raccolta && <button className={btnSecondario} onClick={() => setAddPar(true)} title="Fa entrare chi è fuori dai gruppi dell'evento, es. un esterno a cui fare un omaggio: resta della sua tipologia"><Ico d={D.plus} />Aggiungi persona</button>}
          {singoli && perm.raccolta && <><button className={btnSecondario} onClick={() => setImpPar(true)}><Ico d={D.upload} />Importa partecipanti</button><button className={btnSecondario} onClick={() => setAddPar(true)}><Ico d={D.plus} />Nuovo partecipante</button></>}
          {(mod === 'SCELTA' || mod === 'ORDINE' || mod === 'TURNI') && perm.raccolta && <button className={btnSecondario} onClick={() => setModulo(true)}><Ico d={D.upload} />{mod === 'ORDINE' ? 'Importa ordini' : mod === 'TURNI' ? 'Importa iscrizioni' : 'Importa risposte modulo'}</button>}
          <button className={btnSecondario} onClick={() => setEsporta(true)} title="Lista WhatsApp, rubrica, esigenze alimentari: scegli colonne e formato"><Ico d={D.download} />Esporta elenco</button>
          {!ini.archiviata && <button className={btnSecondario} onClick={() => setEdit(true)}>Modifica</button>}
          <button className={btnSecondario} onClick={() => setCopiaDa(true)} title="Un evento nuovo da questo: scegli tipo, impostazioni, lista dei partecipanti e scelte da riportare"><Ico d={D.plus} />Copia</button>
          <button className={btnSecondario} onClick={() => { if (ini.archiviata) archivia(false); else setConfArch(true) }}>{ini.archiviata ? 'Ripristina' : 'Archivia'}</button>
        </div>
      </div>
      {esporta && <EsportaElenco ids={partecipantiEffettivi(db, ini).map(s => s.id)} titolo={ini.titolo} iniziativa={conLuogo(mod) ? ini.id : undefined} onClose={() => setEsporta(false)} />}
      <EsigenzeEvento ini={ini} />
      {ini.archiviata && <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-2.5 text-sm text-slate-400">Evento archiviato il {fmtData(ini.archiviataIl)}{ini.archiviataDa ? ` da ${ini.archiviataDa}` : ''}: sola lettura. «Ripristina» lo riporta tra gli eventi attivi.</div>}
      <div><h3 className="text-lg font-semibold text-white">{ini.titolo}</h3>
        <p className="text-sm text-slate-400 tabular-nums">{fmtData(ini.data)}{ini.scadenza ? ` · ${({ ORDINE: 'ordini', TURNI: 'iscrizioni', MAGAZZINO: 'richieste' } as Record<string, string>)[mod] ?? 'scelte'} entro ${fmtData(ini.scadenza)}` : ''} · {dest.length} partecipanti ({descrPart(ini, agg.size)}){ini.fornitore ? ` · Fornitore: ${ini.fornitore}` : ''}{ini.pagamento ? ` · Pagamento: ${ini.pagamento}` : ''}{ini.note ? ` · ${ini.note}` : ''}</p>
        {esclusi > 0 && <p className="text-xs text-amber-400 mt-1">{esclusi === 1 ? '1 persona in attesa di validazione non è' : `${esclusi} persone in attesa di validazione non sono`} tra i partecipanti: lo diventano appena validate.</p>}
        {origine && <p className="text-xs text-slate-500 mt-1">Copia di <button className="text-indigo-300 hover:text-indigo-200" onClick={() => onApri(origine.id)}>«{origine.titolo}»</button>{origine.archiviata ? ' (archiviato)' : ''}.</p>}
        {!ini.archiviata && frasePermessi(perm) && <p className={`text-xs mt-1 ${st0.regola === 'ANNULLATO' || st0.regola === 'SOSPESO' ? 'text-amber-400' : 'text-slate-500'}`}>Stato «{st0.nome}»: {frasePermessi(perm).charAt(0).toLowerCase() + frasePermessi(perm).slice(1)} Si cambia con «Modifica».</p>}</div>

      {mod === 'TURNI' ? <TurniCorpo ini={ini} perm={perm} nomeCella={nomeCella} />
        : mod === 'MAGAZZINO' ? <MagazzinoCorpo ini={ini} perm={perm} />
          : <>
            {conti && <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {([['Ordini', String(conti.ord.length), 'text-white'], ['Totale', fmtEuro(conti.totale), 'text-white'], ['Sconti', fmtEuro(conti.sconti), conti.sconti ? 'text-pink-300' : 'text-slate-500'], ['Incassato', fmtEuro(conti.incassato), 'text-emerald-300'], ['Da incassare', fmtEuro(conti.totale - conti.incassato), conti.totale > conti.incassato ? 'text-amber-400' : 'text-white']] as Array<[string, string, string]>).map(([l, n, c]) => (
                <div key={l} className={`${cardCls} px-4 py-3`}><p className={etichettaCls}>{l}</p><p className={`text-xl font-semibold tabular-nums mt-1 ${c}`}>{n}</p></div>))}
            </div>}

            <div className={`${cardCls} overflow-hidden`}>
              <div className="px-5 py-3 border-b border-slate-800 flex flex-wrap gap-3 items-center">
                <p className="text-sm font-medium text-white flex-1">{mod === 'ORDINE' ? 'Quantità per sede di consegna (ordine al fornitore)' : 'Riepilogo per sede di consegna'}</p>
                {mod === 'SCELTA' && ini.predefinita && <Interruttore on={pred} onChange={setPred} label={`Conta chi non ha scelto come «${nomePred}»`} />}
              </div>
              {mod === 'ORDINE' ? <TabellaOrdini ini={ini} /> : <TabellaRiepilogo ini={ini} mancantiComePred={pred} />}
            </div>

            <div className={`${cardCls} overflow-hidden`}>
              <div className="px-5 py-3 border-b border-slate-800 flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[180px]"><input className={inputCls} placeholder="Cerca persona o tessera…" value={cerca} onChange={e => setCerca(e.target.value)} /></div>
                <select className={inputCls + ' sm:w-56'} value={sede} onChange={e => setSede(e.target.value)}><option value="">Tutte le sedi di consegna</option>{db.sedi.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select>
                <select className={inputCls + ' sm:w-56'} value={solo} onChange={e => setSolo(e.target.value)}>
                  <option value="">Tutti i destinatari</option>
                  {mod === 'SCELTA' && <option value="mancanti">Senza scelta ({mancanti})</option>}
                  {conti && <><option value="ordinato">Hanno ordinato ({conti.ord.length})</option><option value="nonordinato">Non hanno ordinato</option><option value="dapagare">Da pagare</option></>}
                  <option value="daconsegnare">Da consegnare</option>
                  {mod === 'SCELTA' && ini.opzioni.map(o => <option key={o.id} value={o.id}>{o.etichetta}</option>)}</select>
                <select className={inputCls + ' sm:w-44'} value={tipF} onChange={e => setTipF(e.target.value)}><option value="">Tutte le tipologie</option>{GRUPPI_EVENTO.map(g => <option key={g} value={g}>{NOMI_GRUPPO[g]}</option>)}</select>
                <div className="flex gap-1 items-center"><select className={inputCls + ' sm:w-56'} value={ord.k} onChange={e => setOrd({ k: e.target.value, dir: 1 })} title="Ordina per">{Object.entries(CHIAVI_ORD).map(([k, [l]]) => <option key={k} value={k}>Ordina: {l}</option>)}</select>
                  <button className={btnPiccoloSec + ' h-[38px]'} title={ord.dir > 0 ? 'Crescente' : 'Decrescente'} onClick={() => setOrd({ ...ord, dir: ord.dir === 1 ? -1 : 1 })}>{ord.dir > 0 ? 'A→Z' : 'Z→A'}</button></div>
                {mod === 'SCELTA' && ini.predefinita && mancanti > 0 && perm.gestione && <button className={btnPiccoloSec} onClick={() => setConfPred(true)}>Assegna la predefinita ai {mancanti} senza scelta</button>}
                {perm.gestione && <button className={btnPiccoloSec} onClick={() => setLuogoBlocco(true)} title="Dove ritirano in questo evento: a tutti o a chi è nell'elenco filtrato">Sede di consegna…</button>}
              </div>
              <Scorrevole className="max-h-[560px]"><table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-900 z-10 text-left text-[11px] uppercase tracking-wider text-slate-500">
                  {mod === 'ORDINE' && <tr><th colSpan={4} />{gruppiProdotti(ini).map(g => <th key={g.tip} colSpan={g.prod.length} className="px-2 pt-2 pb-1 font-semibold text-center text-pink-300/90 border-b border-slate-800">{tipNome(db, g.tip)}</th>)}<th colSpan={4} /></tr>}
                  <tr>
                    <Th k="nom" cls="px-5 py-2.5 font-semibold">Persona</Th><Th k="tessera">Tessera</Th><Th k="sede">Sede di lavoro</Th><Th k="consegna">Sede di consegna</Th>
                    {mod === 'SCELTA' && <Th k="scelta">Scelta</Th>}
                    {mod === 'ORDINE' && ini.prodotti.map(p => <th key={p.id} className="px-2 py-2 font-semibold text-center normal-case tracking-normal" title={`${prodLabel(db, p)} · ${fmtEuro(p.prezzo)}${perUnita(p)}${p.max ? ` · max ${p.max}` : ''}`}>{p.nome}<div className="font-normal text-slate-600 tabular-nums">{fmtEuro(p.prezzo)}{perUnita(p)}</div></th>)}
                    {mod === 'ORDINE' && <><Th k="totale" cls={thCls + ' text-right'}>Totale</Th><Th k="pagato" cls={thCls + ' text-center'}>Pagato</Th><th className={thCls}>Note</th></>}
                    <Th k="consegnato" cls="px-5 py-2.5 font-semibold text-center">Consegnato</Th></tr></thead>
                <tbody className="divide-y divide-slate-800/70">
                  {lista.map(s => {
                    const sc = ini.scelte[s.id]; const ordinato = haOrdinato(ini, s.id)
                    return (
                      <tr key={s.id} className="hover:bg-slate-800/30">
                        {nomeCella(s)}
                        <td className="px-3 py-2 font-mono text-xs text-slate-400">{s.tessera || '—'}</td>
                        <td className="px-3 py-2 text-slate-400 text-xs whitespace-nowrap">{s.sede ? sedeBreve(sedeNome(db, s.sede)) : <span className="text-amber-400">non indicata</span>}</td>
                        <td className="px-3 py-1.5"><SceltaLuogo ini={ini} s={s} disabled={!perm.gestione} onChange={v => aggiorna(s.id, { luogo: v || null })} /></td>
                        {mod === 'SCELTA' && <td className="px-3 py-1.5"><div className="flex items-center gap-2">
                          <select disabled={!perm.raccolta} className={inputCls + ' py-1 text-xs min-w-[220px]'} value={sc?.opz ?? ''} onChange={e => aggiorna(s.id, { opz: e.target.value || null })}>
                            <option value="">— Nessuna scelta</option>{ini.opzioni.map(o => <option key={o.id} value={o.id}>{o.etichetta}</option>)}</select>
                          {sc?.opz && sc.fonte === 'modulo' && <span title="Arrivata dalle risposte del modulo" className="text-[10px] text-cyan-400 uppercase tracking-wider">modulo</span>}
                          {sc?.opz && sc.fonte === 'predefinita' && <span className="text-[10px] text-indigo-400 uppercase tracking-wider">predef.</span>}
                          {sc?.opz && sc.fonte === 'copia' && <span title="Riportata dall'evento copiato: si cambia a mano" className="text-[10px] text-amber-300 uppercase tracking-wider">da copia</span>}</div></td>}
                        {mod === 'ORDINE' && ini.prodotti.map(p => {
                          const cp = confezioniDi(ini, s.id, p)
                          const breve = cp ? breveConfezioni(p, cp) : ''
                          return <td key={p.id} className="px-2 py-1.5 text-center align-top"><input type="number" min="0" step={conDecimali(p) ? '0.5' : '1'} max={p.max ?? undefined} disabled={!perm.raccolta} className={inputW + ' py-1 w-16 text-center tabular-nums ' + (qta(ini, s.id, p.id) ? 'border-pink-700 text-white' : 'text-slate-500')} value={qta(ini, s.id, p.id)} onChange={e => setQta(s, p, e.target.value)} aria-label={`${prodLabel(db, p)} per ${nominativo(s)}`} />
                            {cp && <div className="flex flex-col items-center gap-0.5 mt-1">
                              {breve && <button type="button" onClick={() => setConfAperta({ sid: s.id, pid: p.id })} title={`${cp.mano ? 'Scelte a mano' : 'Automatico'}: ${testoConfezioni(db, p, { ...cp, resto: 0 })}. Clic per cambiare`}
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap ${cp.mano ? 'bg-pink-950/70 text-pink-200 hover:bg-pink-900/60' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>{breve}{cp.mano && <Ico d={D.edit} cls="w-3 h-3" />}</button>}
                              {cp.resto > 0 && <button type="button" onClick={() => setConfAperta({ sid: s.id, pid: p.id })} title={`${fmtQ(cp.resto)} ${umDi(p)} non entrano in nessuna confezione. Clic per sceglierle a mano`}
                                className="rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap bg-amber-950/70 text-amber-300 hover:bg-amber-900/60">non confez. · {fmtQ(cp.resto)} {umDi(p)}</button>}
                            </div>}</td>
                        })}
                        {mod === 'ORDINE' && <><td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{ordinato ? <>{nettoSocio(db, ini, s.id) !== totaleSocio(ini, s.id) && <div className="text-[11px] text-slate-500 line-through">{fmtEuro(totaleSocio(ini, s.id))}</div>}<span className="text-white">{fmtEuro(nettoSocio(db, ini, s.id))}</span>
                          <div><button disabled={!perm.gestione} className={`text-[11px] ${persDi(ini, s.id) ? 'text-amber-300' : 'text-slate-500 hover:text-slate-300'}`} onClick={() => setSpOrd(s)}>{etichettaPers(persDi(ini, s.id), regolaCat(ini, catPersona(s, db)))}</button></div></> : <span className="text-slate-600">—</span>}</td>
                          <td className="px-3 py-2 text-center"><input type="checkbox" disabled={!perm.gestione || !ordinato} className="accent-emerald-500 w-4 h-4" checked={!!sc?.pagato} onChange={e => aggiorna(s.id, { pagato: e.target.checked })} aria-label={`Pagato da ${nominativo(s)}`} /></td>
                          <td className="px-3 py-1.5"><input disabled={!perm.gestione} maxLength={500} className={inputCls + ' py-1 text-xs min-w-[150px]'} defaultValue={sc?.note ?? ''} key={`${s.id}-${sc?.note ?? ''}`} placeholder={ordinato ? 'Es. resto da dare' : ''} onBlur={e => { if (e.target.value !== (sc?.note ?? '')) aggiorna(s.id, { note: e.target.value || null }) }} /></td></>}
                        <td className="px-5 py-2 text-center"><input type="checkbox" disabled={!perm.consegna || (mod === 'ORDINE' && !ordinato)} className="accent-indigo-500 w-4 h-4" checked={!!sc?.consegnato} onChange={e => aggiorna(s.id, { consegnato: e.target.checked })} aria-label={`Consegnato a ${nominativo(s)}`} /></td>
                      </tr>)
                  })}
                  {!lista.length && <tr><td colSpan={20} className="px-5 py-10 text-center text-slate-500">{singoli && !ini.partecipanti.length ? 'Nessun partecipante: usa «Importa partecipanti» o «Nuovo partecipante».' : 'Nessuno con questi filtri.'}</td></tr>}
                </tbody>
              </table></Scorrevole>
            </div>
          </>}
      {spOrd && <ScontoPersonaleModal titolo={`Sconto · ${nominativo(spOrd)}`} sotto="Sull'ordine intero" regola={regolaCat(ini, catPersona(spOrd, db))} valore={persDi(ini, spOrd.id)} lordo={totaleSocio(ini, spOrd.id)} onClose={() => setSpOrd(null)}
        onSalva={v => { aggiorna(spOrd.id, { scontoPers: v }); setSpOrd(null); avviso(v ? 'Sconto personale salvato' : 'Sconto automatico') }} />}
      {edit && <IniziativaModal id={id} onClose={() => setEdit(false)} />}
      {confAperta && <ConfezioniModal ini={ini} sid={confAperta.sid} pid={confAperta.pid} attivo={perm.raccolta} onClose={() => setConfAperta(null)} onPatch={patch => aggiorna(confAperta.sid, patch)} />}
      {luogoBlocco && <SedeConsegnaModal ini={ini} tutti={dest} filtrati={lista} onClose={() => setLuogoBlocco(false)} />}
      {copiaDa && <CopiaEventoModal ini={ini} onClose={() => setCopiaDa(false)} onAvanti={c => { setCopiaDa(false); setCopia(c) }} />}
      {copia && <IniziativaModal id={null} copia={copia} onClose={() => setCopia(null)} onCreata={nuovo => onApri(nuovo)} />}
      {addPar && <AggiungiPartecipanteModal ini={ini} onClose={() => setAddPar(false)} />}
      {impPar && <PartecipantiImportModal ini={ini} onClose={() => setImpPar(false)} />}
      {confArch && <Conferma testo="Archiviare l'evento?" dettaglio={`«${ini.titolo}» esce dagli eventi attivi e diventa di sola lettura${ini.stato !== 'CHIUSA' ? ` (e passa a «${statoDi(db, 'CHIUSA').nome}»)` : ''}. Resta consultabile in «Archiviati» e nei report; si può ripristinare.`} etichetta="Archivia" onClose={() => setConfArch(false)} onOk={() => archivia(true)} />}
      {modulo && mod === 'TURNI' && <IscrizioniImportModal ini={ini} onClose={() => setModulo(false)} />}
      {modulo && mod === 'ORDINE' && <OrdiniImportModal ini={ini} onClose={() => setModulo(false)} />}
      {modulo && mod === 'SCELTA' && <ModuloRisposteModal ini={ini} onClose={() => setModulo(false)} />}
      {confPred && ini.predefinita && <Conferma testo="Assegnare la scelta predefinita?" dettaglio={`I ${mancanti} senza scelta riceveranno «${nomePred}». Si può cambiare a mano dopo.`} onClose={() => setConfPred(false)}
        onOk={() => {
          const p = ini.predefinita!
          void esegui(() => cralApi.scelteInBlocco(ini.id, dest.filter(s => !ini.scelte[s.id]?.opz).map(s => ({ socio: s.id, dati: { opz: p } })), 'predefinita'), `Predefinita assegnata a ${mancanti} persone`)
        }} />}
    </div>
  )
}
