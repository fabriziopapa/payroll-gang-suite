// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · copia di un evento (26.11.23)
//
// Passo 1 (qui): da un evento (anche archiviato, il caso tipico è quello
// dell'anno prima) si decide tipo, modalità, stato, date, quali
// impostazioni riportare, quale lista di partecipanti usare e se riportare
// le scelte delle persone. Passo 2: la maschera normale dell'evento, già
// compilata, dove si cambia tutto; il salvataggio passa dalle stesse regole
// di «Nuovo evento» e partecipanti e scelte nascono nella stessa operazione.
// Non si copia mai ciò che le persone hanno fatto: consegne, pagamenti,
// versamenti, note e sconti personali, carichi e richieste del magazzino.
// ============================================================

import { useState } from 'react'
import type { Iniziativa, Modalita } from './tipi'
import {
  NOMI_FILTRO, REGOLE, aggiunti, ancoraAttive, descrPart, destinatari, filtriCopia, fmtData, personeDellEvento, personeFiltro, preparaCopia, sposta, titoloCopia,
  type CopiaPronta, type FiltroCopia, type ImpostCopia, type PartCopia, type Spostamento,
} from './logica'
import { Campo, Interruttore, Modale, btnPrimario, btnSecondario, etichettaCls, inputCls, sceltaCls, useCral } from './ui'

const NOMI_MOD: Record<Modalita, string> = { SCELTA: "Scelta di un'opzione", NESSUNA: 'Nessuna scelta (solo consegna)', ORDINE: 'Ordine a pagamento', TURNI: 'Turni a quota fissa', MAGAZZINO: 'Magazzino' }

export function CopiaEventoModal({ ini, onClose, onAvanti }: { ini: Iniziativa; onClose: () => void; onAvanti: (c: CopiaPronta) => void }) {
  const { db } = useCral()
  const [tipo, setTipo] = useState(ini.tipo)
  const [modalita, setModalita] = useState<Modalita>(ini.modalita)
  const statoIniziale = db.stati.find(s => s.id === 'BOZZA' && s.attivo)?.id ?? db.stati.find(s => s.attivo && s.regola === 'PREPARAZIONE')?.id ?? db.stati.find(s => s.attivo)?.id ?? 'BOZZA'
  const [stato, setStato] = useState(statoIniziale)
  const [spTipo, setSpTipo] = useState<Spostamento['tipo']>('ANNO')
  const [giorni, setGiorni] = useState('7')
  const spostamento: Spostamento = spTipo === 'GIORNI' ? { tipo: 'GIORNI', n: parseInt(giorni, 10) || 0 } : { tipo: spTipo }
  const dataNuova = sposta(ini.data, spostamento) ?? ini.data
  const titoloAuto = titoloCopia(ini.titolo, ini.anno, +dataNuova.slice(0, 4))
  const [titolo, setTitolo] = useState<string | null>(null)
  const [imp, setImp] = useState<ImpostCopia>({ config: true, predefinita: true, sconti: true, fornitore: true, quota: true, note: false, sedi: true })
  const [part, setPart] = useState<PartCopia>('LISTA')
  const filtri = filtriCopia(ini.modalita)
  const [filtro, setFiltro] = useState<FiltroCopia>(filtri[0]!)
  const [conScelte, setConScelte] = useState(false)
  const [mappa, setMappa] = useState<Record<string, string>>(() => Object.fromEntries(ini.opzioni.map(o => [o.id, o.id])))

  const stessa = modalita === ini.modalita
  const tp = db.tipi.find(t => t.id === tipo)
  function scegliTipo(t: string) {
    setTipo(t)
    const x = db.tipi.find(y => y.id === t)
    if (x?.modo) setModalita(x.modo)
    else if (x?.pagamento && modalita !== 'ORDINE' && modalita !== 'TURNI' && modalita !== 'MAGAZZINO') setModalita('ORDINE')
  }
  const lista = personeDellEvento(db, ini)
  const perFiltro = Object.fromEntries(filtri.map(f => [f, personeFiltro(db, ini, f)])) as Record<FiltroCopia, string[]>
  const oggiRegola = destinatari(db, ini).length
  const nScelte = Object.values(ini.scelte).filter(s => s.opz).length
  const puoScelte = ini.modalita === 'SCELTA' && modalita === 'SCELTA' && imp.config && nScelte > 0
  const opzioniCopia: ImpostCopia = { ...imp, config: stessa && imp.config }
  const o = { tipo, modalita, stato, titolo: titolo ?? titoloAuto, spostamento, imp: opzioniCopia, part, filtro, scelte: puoScelte && conScelte, mappa }
  const pronta = preparaCopia(db, ini, o)
  const ok = !!(titolo ?? titoloAuto).trim() && !!tp && db.stati.some(s => s.id === stato) && (spTipo !== 'GIORNI' || /^-?\d{1,4}$/.test(giorni.trim()))
  const voce = (k: keyof ImpostCopia, label: string, quando = true) => quando && <Interruttore key={k} on={imp[k]} onChange={v => setImp({ ...imp, [k]: v })} label={label} />
  const nConfig = ini.modalita === 'SCELTA' ? `Opzioni (${ini.opzioni.length}), si cambiano al passo dopo` : ini.modalita === 'ORDINE' ? `Prodotti (${ini.prodotti.length}) con i prezzi` : ini.modalita === 'TURNI' ? `Settimane (${ini.periodi.length}), con le date spostate` : ini.modalita === 'MAGAZZINO' ? `Articoli (${ini.articoli.length}) con i prezzi` : ''
  const conta = (ids: string[]) => { const a = ancoraAttive(db, ids); return `${ids.length}${a !== ids.length ? ` · ${a} ancora attive` : ''}` }

  return (
    <Modale largo titolo="Copia evento" sotto={`Da «${ini.titolo}»${ini.archiviata ? ' (archiviato)' : ''} · ${fmtData(ini.data)} · ${NOMI_MOD[ini.modalita]}`} onClose={onClose}
      piedi={<><button className={btnSecondario} onClick={onClose}>Annulla</button><button className={btnPrimario} disabled={!ok} onClick={() => onAvanti(pronta)}>Avanti: rivedi l'evento</button></>}>
      <div className="flex flex-col gap-4">
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2"><Campo label="Titolo"><input className={inputCls} maxLength={160} value={titolo ?? titoloAuto} onChange={e => setTitolo(e.target.value)} /></Campo></div>
          <Campo label="Stato iniziale" hint={REGOLE[db.stati.find(s => s.id === stato)?.regola ?? 'PREPARAZIONE'].descr}>
            <select className={inputCls} value={stato} onChange={e => setStato(e.target.value)}>{db.stati.filter(s => s.attivo).map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></Campo>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <Campo label="Tipo"><select className={inputCls} value={tipo} onChange={e => scegliTipo(e.target.value)}>{db.tipi.filter(t => t.attivo || t.id === tipo).map(t => <option key={t.id} value={t.id}>{t.nome}{t.pagamento ? ' · a pagamento' : ''}</option>)}</select></Campo>
          <Campo label="Modalità" hint={tp?.modo ? 'Fissata dal tipo' : !stessa ? 'Diversa da quella di prima: opzioni, prodotti, settimane e articoli si scrivono da capo' : undefined}>
            <select className={inputCls} disabled={!!tp?.modo} value={modalita} onChange={e => setModalita(e.target.value as Modalita)}>{(Object.keys(NOMI_MOD) as Modalita[]).map(m => <option key={m} value={m}>{NOMI_MOD[m]}</option>)}</select></Campo>
          <Campo label="Date (evento, scadenza, settimane)" hint={`Nuova data: ${fmtData(dataNuova)}`}>
            <div className="flex gap-2">
              <select className={inputCls} value={spTipo} onChange={e => setSpTipo(e.target.value as Spostamento['tipo'])}><option value="ANNO">Un anno dopo</option><option value="GIORNI">Spostate di N giorni</option><option value="NO">Come sono</option></select>
              {spTipo === 'GIORNI' && <input inputMode="numeric" aria-label="Giorni" className={inputCls + ' w-20 text-right tabular-nums'} value={giorni} onChange={e => setGiorni(e.target.value)} />}
            </div></Campo>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-slate-800 p-4">
          <span className={etichettaCls}>Impostazioni da riportare</span>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
            {voce('config', nConfig, stessa && !!nConfig)}
            {voce('predefinita', `Opzione predefinita per chi non sceglie (${ini.opzioni.find(x => x.id === ini.predefinita)?.etichetta ?? ''})`, stessa && ini.modalita === 'SCELTA' && !!ini.predefinita && imp.config)}
            {voce('sconti', 'Sconti per tipologia', stessa && Object.keys(ini.sconti).length > 0)}
            {voce('quota', 'Quota a settimana', stessa && ini.modalita === 'TURNI')}
            {voce('fornitore', 'Fornitore e modalità di pagamento', !!(ini.fornitore || ini.pagamento))}
            {voce('note', 'Note', !!ini.note)}
            {voce('sedi', 'Sedi coinvolte', ini.modoPart === 'GRUPPI' && ini.sedi.length > 0 && part === 'REGOLA')}
          </div>
          {!stessa && <p className="text-xs text-slate-500">Con un'altra modalità la configurazione di prima non si porta: la si scrive nella maschera dell'evento.</p>}
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-slate-800 p-4">
          <span className={etichettaCls}>Partecipanti</span>
          <div className="grid sm:grid-cols-2 gap-2">
            {([
              ['REGOLA', ini.modoPart === 'GRUPPI' ? 'Stessa regola, ricalcolata' : 'Stessa lista di partecipanti singoli',
                ini.modoPart === 'GRUPPI' ? `${descrPart(ini, aggiunti(db, ini).length)} · oggi ${oggiRegola}` : `${conta(ini.partecipanti)}`],
              ['LISTA', "Le persone di quell'evento, come lista fissa", `${conta(lista)} · evento «Singoli»`],
              ['PARTE', "Solo una parte delle persone di quell'evento", `${NOMI_FILTRO[filtro]}: ${conta(perFiltro[filtro] ?? [])}`],
              ['NESSUNO', 'Nessuno', 'Si caricano dopo, da file o uno per uno'],
            ] as Array<[PartCopia, string, string]>).map(([k, t, d]) => (
              <button key={k} type="button" onClick={() => setPart(k)} className={sceltaCls(part === k)}><p className="text-sm font-medium text-white">{t}</p><p className="text-xs text-slate-500 tabular-nums">{d}</p></button>))}
          </div>
          {part === 'PARTE' && <div className="flex flex-wrap gap-2 items-center"><span className="text-xs text-slate-400">Chi</span>
            <select className={inputCls + ' sm:w-72'} value={filtro} onChange={e => setFiltro(e.target.value as FiltroCopia)}>{filtri.map(f => <option key={f} value={f}>{NOMI_FILTRO[f]} ({perFiltro[f]?.length ?? 0})</option>)}</select></div>}
          <p className="text-xs text-slate-500">Partecipa chi è attivo il giorno in cui si lavora l'evento: chi è cessato o eliminato resta in lista ma non conta. Il modo di partecipare si può cambiare al passo dopo.</p>
        </div>

        {ini.modalita === 'SCELTA' && modalita === 'SCELTA' && nScelte > 0 && <div className="flex flex-col gap-2 rounded-lg border border-slate-800 p-4">
          <Interruttore on={conScelte && puoScelte} disabled={!puoScelte} onChange={setConScelte} label={`Riporta le scelte delle persone (${nScelte}) come punto di partenza`} />
          {!imp.config && <p className="text-xs text-slate-500">Per riportarle serve copiare le opzioni.</p>}
          {conScelte && puoScelte && <div className="flex flex-col gap-1.5">
            <p className="text-xs text-slate-500">Per ogni opzione di prima, quella che riceve nell'evento nuovo. Le scelte riportate si vedono con «da copia» e si cambiano a mano; un'opzione tolta al passo dopo si porta via le sue.</p>
            {ini.opzioni.map(x => { const n = Object.values(ini.scelte).filter(s => s.opz === x.id).length; return (
              <div key={x.id} className="flex flex-wrap items-center gap-2 text-sm"><span className="text-slate-200 w-48 truncate">{x.etichetta}</span><span className="text-xs text-slate-500 tabular-nums w-16">{n} persone</span><span className="text-slate-500">→</span>
                <select className={inputCls + ' sm:w-64'} value={mappa[x.id] ?? ''} onChange={e => setMappa({ ...mappa, [x.id]: e.target.value })}><option value="">nessuna (la persona sceglie da capo)</option>{ini.opzioni.map(y => <option key={y.id} value={y.id}>{y.etichetta}</option>)}</select></div>) })}
            <p className="text-xs text-slate-400 tabular-nums">Scelte che arrivano: {pronta.scelte.length}</p>
          </div>}
        </div>}

        <p className="text-xs text-slate-500">Non si copiano mai: consegne, pagamenti, versamenti, note e sconti delle persone, iscrizioni alle settimane, carichi e richieste del magazzino.</p>
      </div>
    </Modale>
  )
}
