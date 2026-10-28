// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · report (CSV e PDF nel browser)
// Una funzione costruisce la tabella (titolo, intestazioni, righe, gruppi);
// la stessa tabella va nell'anteprima, nel CSV e nel PDF. Niente codice
// fiscale: le persone sono nominativo, tessera, ID e (a richiesta) età.
// ============================================================

import type { Db, Iniziativa, Persona, QuotaSocio, Richiesta, StatoPeriodo } from './tipi'
import {
  CAT_SCONTO_1, GRUPPI, MESI, MODI_QUOTA, TIPOLOGIE, aCaricoDi, catSconto, conScontiIni, contenutoTot, contiMagazzino, descrScontoPers,
  destinatari, dovutoTurni, eSocio, eta, fmtData, fmtImp, fmtQ, fmtSconto, gruppiProdotti, haOrdinato, importoRichiesta, iscrittoTurni,
  movimentiMagazzino, nettoSocio, nomeDi, nominativo, ordineRichieste, pagaPer, perUnita, periodiDovuti, persDi, persona, qta, quotaAnno,
  quotaDi, quotaSocio, regolaCat, regolaTurni, riepilogo, righeOrdiniPerSede, rifDi, scontoOrdine, scontoRichiesta, sedeNome, sociQuota,
  statoPer, tipNome, totaleSocio, versatoQuota,
} from './logica'

export type TipoReport = 'riepilogo' | 'scelte' | 'fornitore' | 'soci' | 'quote' | 'settimane' | 'movimenti'
export interface CfgReport {
  tipo: TipoReport; ini: string; sedi: string[]; origine: string; pred: boolean
  tessera: boolean; consegnato: boolean; pagato: boolean; note: boolean; firma: boolean
  colSoci: { sede: boolean; id: boolean; nom: boolean }
  sedeScelte: boolean; ordinaPer: 'nom' | 'tessera' | 'id' | 'tip'; paginaPerSede: boolean
  soloMancanti: boolean; inclusiVuoti: boolean; soloDaPagare: boolean; soloSaldo: boolean
  includiTolte: boolean; presenze: boolean; aCarico: boolean; perRif: boolean; eta: boolean
  anno: number; qmodo: '' | QuotaSocio['modo']; mesi: boolean; statoRic: '' | Richiesta['stato']
}
export type Cella = string | number
export interface Report {
  titolo: string; intest: string[]; righe: Cella[][]
  /** La prima colonna è il gruppo (sede, settimana, famiglia): si stampa come titolo. */
  gruppi?: boolean
  /** Intestazione a due livelli: tipologia sopra, prodotto sotto. */
  sopra?: string[]; breve?: string[]
  /** L'ultima riga è il totale. */
  totale?: boolean
  numCols?: Set<number>; bold?: Set<number>; paginaPerGruppo?: boolean; vuoto?: string
}

export const STATI_RIC_ETICH: Record<Richiesta['stato'], string> = { ATTESA: 'In attesa', CONSEGNATA: 'Consegnata', ANNULLATA: 'Annullata' }
export const MODI_CONS_ETICH: Record<Richiesta['modo'], string> = { MANO: 'A mano', EMAIL: 'Digitale via email' }

export function costruisciReport(db: Db, cfg: CfgReport, oggiIso: string): Report {
  const ini = db.iniziative.find(i => i.id === cfg.ini)
  const sediOk = (s: Persona) => !cfg.sedi.length || cfg.sedi.includes(s.sede ?? '__NOSEDE')
  const tipOk = (s: Persona) => !cfg.origine || s.tipo === cfg.origine
  // Ordinamento delle persone (dentro ogni sede, se si raggruppa): nominativo, tessera, ID o tipologia
  const chiaveP = (s: Persona) => cfg.ordinaPer === 'tessera' ? (s.tessera || '~') : cfg.ordinaPer === 'id' ? s.id : cfg.ordinaPer === 'tip' ? `${GRUPPI.indexOf(s.tipo)} ${nominativo(s)}` : nominativo(s)
  const cmp = (a: Persona, b: Persona) => chiaveP(a).localeCompare(chiaveP(b)) || nominativo(a).localeCompare(nominativo(b))
  const posSede = (s: Persona) => { const k = db.sedi.findIndex(x => x.id === s.sede); return k < 0 ? 99 : k }
  const ordinaSoci = (arr: Persona[]) => arr.sort((a, b) => posSede(a) - posSede(b) || cmp(a, b))
  const perNome = (arr: Persona[]) => arr.sort(cmp)
  const etaDi = (s: Persona | undefined, al: string): Cella => eta(s?.nascita, al)

  if (cfg.tipo === 'soci') {
    const filtrati = db.soci.filter(s => s.stato === 'ATTIVO' && eSocio(s) && sediOk(s) && tipOk(s))
    const perSede = cfg.colSoci.sede
    const soci = perSede ? ordinaSoci(filtrati) : perNome(filtrati)
    const col: Array<[string, string, (s: Persona) => Cella]> = ([
      ['sede', 'Sede', s => sedeNome(db, s.sede)], ['id', 'ID socio', s => s.id], ['tessera', 'Tessera', s => s.tessera], ['nom', 'Nominativo', s => nominativo(s)],
      ['eta', 'Età', s => etaDi(s, oggiIso)], ['firma', 'Firma', () => ''],
    ] as Array<[string, string, (s: Persona) => Cella]>).filter(([k]) => k === 'tessera' ? cfg.tessera : k === 'firma' ? cfg.firma : k === 'eta' ? cfg.eta : cfg.colSoci[k as 'sede' | 'id' | 'nom'])
    if (!col.length || (perSede && col.length === 1)) return { titolo: 'Elenco soci', intest: [], righe: [], vuoto: 'Accendi almeno una colonna oltre alla sede.' }
    return { titolo: perSede ? 'Elenco soci per sede' : 'Elenco soci', intest: col.map(c => c[1]), gruppi: perSede, righe: soci.map(s => col.map(c => c[2](s))) }
  }
  if (cfg.tipo === 'quote') {
    const anno = cfg.anno, imp = quotaAnno(db, anno)
    const lista = perNome(sociQuota(db, anno).filter(s => sediOk(s) && tipOk(s)).filter(s => !cfg.qmodo || quotaSocio(db, anno, s).modo === cfg.qmodo).filter(s => !cfg.soloSaldo || versatoQuota(db, anno, s) < imp))
    const pre = ['Sede', ...(cfg.tessera ? ['Tessera'] : []), 'Nominativo', ...(cfg.eta ? ['Età'] : []), 'Tipologia', 'Modalità']
    const intest = [...pre, ...(cfg.mesi ? MESI : []), 'Dovuto €', 'Versato €', 'Saldo €', ...(cfg.note ? ['Note'] : []), ...(cfg.firma ? ['Firma'] : [])]
    let tv = 0
    const righe: Cella[][] = lista.map(s => {
      const q = quotaSocio(db, anno, s), v = versatoQuota(db, anno, s); tv += v
      const nota = s.stato === 'CESSATO' ? ` (cessato ${fmtData(s.cessatoIl)})` : s.iscrittoIl.slice(0, 10) >= `${anno}-01-01` ? ` (dal ${fmtData(s.iscrittoIl)})` : ''
      return [sedeNome(db, s.sede), ...(cfg.tessera ? [s.tessera] : []), nominativo(s) + nota, ...(cfg.eta ? [etaDi(s, oggiIso)] : []), TIPOLOGIE[s.tipo][0], MODI_QUOTA[q.modo] + (q.modo === 'UNICA' && q.pagataIl ? ` · ${fmtData(q.pagataIl)}` : ''),
        ...(cfg.mesi ? MESI.map((_, k) => q.modo === 'UNICA' ? (q.pagataIl ? 'X' : '') : q.mesi[k] ? 'X' : '') : []), fmtImp(imp), fmtImp(v), fmtImp(imp - v), ...(cfg.note ? [q.note] : []), ...(cfg.firma ? [''] : [])]
    })
    const k0 = pre.length + (cfg.mesi ? 12 : 0)
    if (righe.length) righe.push(['Totale', ...Array<string>(pre.length - 1 + (cfg.mesi ? 12 : 0)).fill(''), fmtImp(imp * lista.length), fmtImp(tv), fmtImp(imp * lista.length - tv), ...(cfg.note ? [''] : []), ...(cfg.firma ? [''] : [])])
    return { titolo: `Quote associative ${anno} · quota ${fmtImp(imp)} €`, intest, righe, numCols: new Set([k0, k0 + 1, k0 + 2]), bold: new Set(righe.length ? [righe.length - 1] : []) }
  }
  if (!ini) return { titolo: '', intest: [], righe: [], vuoto: 'Scegli un evento.' }
  const mod = ini.modalita

  // ── Turni (campi estivi) ──
  if (mod === 'TURNI') {
    const per = ini.periodi
    const dest = destinatari(db, ini).filter(s => sediOk(s) && tipOk(s))
    const stLab: Record<StatoPeriodo, string> = { '': '', P: 'Prenotata', F: 'Frequentata', T: 'Tolta' }
    const etRif = (s: Persona) => { const r = rifDi(db, ini, s); const rg = regolaCat(ini, r ? catSconto(r) : 'EST'); return `${r ? `${nominativo(r)} · ${CAT_SCONTO_1[catSconto(r)]}` : 'Senza socio o dipendente di riferimento'} · ${rg ? `sconto ${fmtSconto(rg)}` : 'quota piena'}` }
    const chiaveRif = (s: Persona) => { const r = rifDi(db, ini, s); return r ? `0 ${nominativo(r)} ${r.id}` : '1' }
    const ordina = (arr: Persona[]) => arr.sort((a, b) => (cfg.perRif ? chiaveRif(a).localeCompare(chiaveRif(b)) : 0) || nominativo(a).localeCompare(nominativo(b)))
    if (cfg.tipo === 'settimane') {
      const righe: Cella[][] = []
      for (const p of per) ordina(dest.filter(s => pagaPer(statoPer(ini, s.id, p.id)) || (cfg.includiTolte && statoPer(ini, s.id, p.id) === 'T'))).forEach(s =>
        righe.push([`${p.nome} · ${fmtData(p.dal)} – ${fmtData(p.al)}`, nominativo(s), ...(cfg.eta ? [etaDi(s, ini.data)] : []), TIPOLOGIE[s.tipo][0], ...(cfg.aCarico ? [aCaricoDi(db, ini, s)] : []), stLab[statoPer(ini, s.id, p.id)], ...(cfg.presenze ? ['', '', '', '', ''] : []), ...(cfg.firma ? [''] : [])]))
      return { titolo: `${ini.titolo} · elenco per settimana`, intest: ['Settimana', 'Nominativo', ...(cfg.eta ? ['Età'] : []), 'Tipologia', ...(cfg.aCarico ? ['Riferimento'] : []), 'Stato', ...(cfg.presenze ? ['Lun', 'Mar', 'Mer', 'Gio', 'Ven'] : []), ...(cfg.firma ? ['Firma'] : [])], gruppi: true, righe }
    }
    if (cfg.tipo === 'scelte') {
      let lista = dest.filter(s => iscrittoTurni(ini, s.id))
      if (cfg.soloSaldo) lista = lista.filter(s => dovutoTurni(db, ini, s) > (ini.scelte[s.id]?.versato ?? 0))
      const conRifCol = cfg.aCarico && !cfg.perRif
      const pre = ['Nominativo', ...(cfg.eta ? ['Età'] : []), 'Tipologia', ...(conRifCol ? ['Riferimento'] : [])]
      const intest = [...pre, ...per.map(p => p.nome), 'Settimane', 'Quota €', 'Sconto', 'Dovuto €', 'Versato €', 'Saldo €', ...(cfg.note ? ['Note'] : []), ...(cfg.firma ? ['Firma'] : [])]
      const k0 = pre.length + per.length
      const vuoti = (n: number) => Array<string>(Math.max(0, n)).fill('')
      const coda = () => [...(cfg.note ? [''] : []), ...(cfg.firma ? [''] : [])]
      const riga = (s: Persona): Cella[] => {
        const dov = dovutoTurni(db, ini, s), ver = ini.scelte[s.id]?.versato ?? 0, pp = persDi(ini, s.id)
        return [nominativo(s), ...(cfg.eta ? [etaDi(s, ini.data)] : []), TIPOLOGIE[s.tipo][0], ...(conRifCol ? [aCaricoDi(db, ini, s)] : []),
          ...per.map(p => ({ '': '', P: 'P', F: 'F', T: 'tolta' } as Record<StatoPeriodo, string>)[statoPer(ini, s.id, p.id)]), periodiDovuti(ini, s.id), fmtImp(quotaDi(db, ini, s)),
          pp ? (pp.tipo === 'NO' ? 'nessuno (a mano)' : `${fmtSconto(pp)} sul totale (a mano)`) : (fmtSconto(regolaTurni(db, ini, s)) || '—'),
          fmtImp(dov), fmtImp(ver), fmtImp(dov - ver), ...(cfg.note ? [ini.scelte[s.id]?.note ?? ''] : []), ...(cfg.firma ? [''] : [])]
      }
      const tot = (arr: Persona[]): Cella[] => { const n = arr.reduce((a, s) => a + periodiDovuti(ini, s.id), 0), dov = arr.reduce((a, s) => a + dovutoTurni(db, ini, s), 0), ver = arr.reduce((a, s) => a + (ini.scelte[s.id]?.versato ?? 0), 0); return [n, '', '', fmtImp(dov), fmtImp(ver), fmtImp(dov - ver)] }
      const numCols = [k0, k0 + 1, k0 + 3, k0 + 4, k0 + 5]
      if (!cfg.perRif) {
        lista = ordina(lista)
        const righe = lista.map(riga)
        if (righe.length) righe.push(['Totale', '', ...vuoti(pre.length - 2 + per.length), ...tot(lista), ...coda()])
        return { titolo: `${ini.titolo} · quote per persona`, intest, righe, numCols: new Set(numCols), bold: new Set(righe.length ? [righe.length - 1] : []) }
      }
      // Prima il socio o dipendente di riferimento (intestazione del gruppo), sotto i suoi iscritti, con il totale della famiglia
      const gr = new Map<string, Persona[]>(); for (const s of ordina(lista)) { const k = etRif(s); gr.set(k, [...(gr.get(k) ?? []), s]) }
      const righe: Cella[][] = [], bold = new Set<number>()
      gr.forEach((membri, k) => { membri.forEach(s => righe.push([k, ...riga(s)])); if (membri.length > 1) { bold.add(righe.length); righe.push([k, 'Totale famiglia', '', ...vuoti(pre.length - 2 + per.length), ...tot(membri), ...coda()]) } })
      if (righe.length) { bold.add(righe.length); righe.push(['Totale complessivo', `${gr.size} famiglie · ${lista.length} iscritti`, '', ...vuoti(pre.length - 2 + per.length), ...tot(lista), ...coda()]) }
      return { titolo: `${ini.titolo} · quote per famiglia`, intest: ['Riferimento', ...intest], gruppi: true, paginaPerGruppo: false, righe, bold, numCols: new Set(numCols.map(k => k + 1)) }
    }
    const righe = per.map(p => {
      const n = (k: StatoPeriodo) => dest.filter(s => statoPer(ini, s.id, p.id) === k).length
      const imp = dest.filter(s => pagaPer(statoPer(ini, s.id, p.id))).reduce((a, s) => a + quotaDi(db, ini, s), 0)
      return { nome: p.nome, periodo: `${fmtData(p.dal)} – ${fmtData(p.al)}`, P: n('P'), F: n('F'), T: n('T'), posti: p.posti ? `${n('P') + n('F')}/${p.posti}` : '', imp }
    })
    const out: Cella[][] = righe.map(r => [r.nome, r.periodo, r.P, r.F, r.T, r.posti, fmtImp(r.imp)])
    if (righe.length) out.push(['Totale', '', righe.reduce((a, r) => a + r.P, 0), righe.reduce((a, r) => a + r.F, 0), righe.reduce((a, r) => a + r.T, 0), '', fmtImp(righe.reduce((a, r) => a + r.imp, 0))])
    return { titolo: `${ini.titolo} · iscritti per settimana`, intest: ['Settimana', 'Periodo', 'Prenotate', 'Frequentate', 'Tolte', 'Posti', 'Importo €'], righe: out, numCols: new Set([2, 3, 4, 5, 6]), bold: new Set(out.length ? [out.length - 1] : []) }
  }

  // ── Magazzino (biglietti cinema) ──
  if (mod === 'MAGAZZINO') {
    const art = (id: string) => ini.articoli.find(a => a.id === id)?.nome ?? id
    if (cfg.tipo === 'movimenti') return {
      titolo: `${ini.titolo} · registro di magazzino`, intest: ['Data', 'Articolo', 'Movimento', 'Quantità', 'Giacenza'], numCols: new Set([3, 4]),
      righe: movimentiMagazzino(db, ini).map(m => [fmtData(m.data), art(m.art), m.desc, m.q > 0 ? `+${m.q}` : String(m.q), m.giac]),
    }
    if (cfg.tipo === 'scelte') {
      const ric = ini.richieste.filter(r => !cfg.statoRic || r.stato === cfg.statoRic).sort(ordineRichieste)
      return {
        titolo: `${ini.titolo} · richieste`, intest: ['Richiesta il', 'Persona', ...(cfg.eta ? ['Età'] : []), 'Articolo', 'Q.tà', 'Importo €', 'Sconto', 'Stato', 'Consegnata il', 'Consegna', 'Pagato', ...(cfg.firma ? ['Firma per ricevuta'] : [])],
        numCols: new Set(cfg.eta ? [4, 5] : [3, 4]),
        righe: ric.map(r => [fmtData(r.dataRich), nomeDi(db, r.persona), ...(cfg.eta ? [etaDi(persona(db, r.persona), r.dataRich)] : []), art(r.art), r.qta, fmtImp(importoRichiesta(db, ini, r)),
          (r.sconto ? descrScontoPers(r.sconto) : fmtSconto(scontoRichiesta(db, ini, r))) || '—', STATI_RIC_ETICH[r.stato], r.dataCons ? fmtData(r.dataCons) : '', MODI_CONS_ETICH[r.modo], r.pagato ? 'Sì' : 'No', ...(cfg.firma ? [''] : [])]),
      }
    }
    const c = contiMagazzino(ini)
    const righe: Cella[][] = ini.articoli.map(a => { const x = c[a.id]!; return [a.nome, fmtImp(a.prezzo), x.car, x.con, x.giac, x.att, x.disp] })
    if (righe.length) righe.push(['Totale', '', ...[2, 3, 4, 5, 6].map(j => righe.reduce((x, r) => x + Number(r[j]), 0))])
    return { titolo: `${ini.titolo} · giacenze`, intest: ['Articolo', 'Prezzo €', 'Caricati', 'Consegnati', 'Giacenza', 'In attesa', 'Liberi'], numCols: new Set([1, 2, 3, 4, 5, 6]), bold: new Set(righe.length ? [righe.length - 1] : []), righe }
  }

  // ── Ordini a pagamento ──
  if (mod === 'ORDINE') {
    if (cfg.tipo === 'fornitore') {
      const dest = destinatari(db, ini).filter(sediOk)
      const righe: Cella[][] = [], bold = new Set<number>()
      let totE = 0
      for (const g of gruppiProdotti(ini)) {
        let se = 0, sc = 0, um = ''
        for (const p of g.prod) {
          const n = dest.reduce((a, s) => a + qta(ini, s.id, p.id), 0)
          const imp = Math.round(n * p.prezzo); const c = contenutoTot(p, n)
          se += imp; if (c != null) { sc += c; um = p.contenutoUm }
          righe.push([tipNome(db, g.tip), p.nome, `${fmtImp(p.prezzo)}${perUnita(p)}`, `${fmtQ(n)}${p.unita === 'kg' ? ' kg' : p.unita === 'cas' ? (n === 1 ? ' cassetta' : ' cassette') : ''}`, fmtImp(imp), c != null ? `${fmtQ(c)} ${p.contenutoUm}` : ''])
        }
        bold.add(righe.length); righe.push([`Subtotale ${tipNome(db, g.tip)}`, '', '', '', fmtImp(se), um ? `${fmtQ(sc)} ${um}` : '']); totE += se
      }
      bold.add(righe.length); righe.push(['Totale complessivo', '', '', '', fmtImp(totE), ''])
      const netti = dest.filter(s => haOrdinato(ini, s.id)).reduce((a, s) => a + nettoSocio(db, ini, s.id), 0)
      if (netti !== totE) { righe.push(['Sconti ai soci (a carico del CRAL)', '', '', '', fmtImp(netti - totE), '']); bold.add(righe.length); righe.push(['Da incassare dai soci', '', '', '', fmtImp(netti), '']) }
      return { titolo: `${ini.titolo} · ordine al fornitore${ini.fornitore ? ` (${ini.fornitore})` : ''}`, intest: ['Tipologia', 'Prodotto', 'Prezzo €', 'Quantità', 'Importo €', 'Contenuto'], bold, numCols: new Set([2, 3, 4, 5]), righe }
    }
    if (cfg.tipo === 'scelte') {
      const perSede = cfg.sedeScelte
      let soci = destinatari(db, ini).filter(s => sediOk(s) && tipOk(s))
      soci = soci.filter(s => cfg.inclusiVuoti || haOrdinato(ini, s.id)).filter(s => !cfg.soloDaPagare || (haOrdinato(ini, s.id) && !ini.scelte[s.id]?.pagato))
      soci = perSede ? ordinaSoci(soci) : perNome(soci)
      const pre = [...(perSede ? ['Sede'] : []), ...(cfg.tessera ? ['Tessera'] : []), 'Nominativo', ...(cfg.eta ? ['Età'] : [])]
      const cs = conScontiIni(ini)
      const post = [...(cs ? ['Lordo €', 'Sconto'] : []), 'Totale €', ...(cfg.pagato ? ['Pagato'] : []), ...(cfg.consegnato ? ['Consegnato'] : []), ...(cfg.note ? ['Note'] : []), ...(cfg.firma ? ['Firma per ritiro'] : [])]
      const intest = [...pre, ...ini.prodotti.map(p => `${tipNome(db, p.tipologia)} · ${p.nome}`), ...post]
      const sopra = [...pre.map(() => ''), ...ini.prodotti.map(p => tipNome(db, p.tipologia)), ...post.map(() => '')]
      const breve = [...pre, ...ini.prodotti.map(p => p.nome), ...post]
      const righe: Cella[][] = soci.map(s => {
        const o = haOrdinato(ini, s.id), sc = ini.scelte[s.id], pp = persDi(ini, s.id)
        return [...(perSede ? [sedeNome(db, s.sede)] : []), ...(cfg.tessera ? [s.tessera] : []), nominativo(s), ...(cfg.eta ? [etaDi(s, ini.data)] : []),
          ...ini.prodotti.map(p => qta(ini, s.id, p.id) ? fmtQ(qta(ini, s.id, p.id)) : ''),
          ...(cs ? [o ? fmtImp(totaleSocio(ini, s.id)) : '', o ? (pp ? descrScontoPers(pp) : fmtSconto(scontoOrdine(db, ini, s.id))) : ''] : []),
          o ? fmtImp(nettoSocio(db, ini, s.id)) : '', ...(cfg.pagato ? [o ? (sc?.pagato ? 'Sì' : 'No') : ''] : []), ...(cfg.consegnato ? [o ? (sc?.consegnato ? 'Sì' : 'No') : ''] : []),
          ...(cfg.note ? [sc?.note ?? ''] : []), ...(cfg.firma ? [''] : [])]
      })
      return { titolo: `${ini.titolo} · ordini per persona`, intest, sopra, breve, gruppi: perSede, righe }
    }
    const righeS = righeOrdiniPerSede(db, ini).filter(([k]) => !cfg.sedi.length || cfg.sedi.includes(k))
    const out: Cella[][] = righeS.map(([k, r]) => [k === '__NOSEDE' ? 'Sede non indicata' : sedeNome(db, k), r.n, ...ini.prodotti.map(p => fmtQ(r.q[p.id] ?? 0)), fmtImp(r.eur)])
    if (out.length) out.push(['Totale complessivo', righeS.reduce((a, [, r]) => a + r.n, 0), ...ini.prodotti.map(p => fmtQ(righeS.reduce((a, [, r]) => a + (r.q[p.id] ?? 0), 0))), fmtImp(righeS.reduce((a, [, r]) => a + r.eur, 0))])
    return {
      titolo: `${ini.titolo} · quantità per sede`, intest: ['Sede', 'Ordini', ...ini.prodotti.map(p => `${tipNome(db, p.tipologia)} · ${p.nome}`), 'Importo €'],
      sopra: ['', '', ...ini.prodotti.map(p => tipNome(db, p.tipologia)), ''], breve: ['Sede', 'Ordini', ...ini.prodotti.map(p => p.nome), 'Importo €'], totale: true, righe: out,
    }
  }

  // ── Scelta / nessuna scelta ──
  if (cfg.tipo === 'scelte') {
    const perSede = cfg.sedeScelte
    let soci = destinatari(db, ini).filter(s => sediOk(s) && tipOk(s)).filter(s => !cfg.soloMancanti || !ini.scelte[s.id]?.opz)
    soci = perSede ? ordinaSoci(soci) : perNome(soci)
    const conScelta = mod === 'SCELTA'
    const scelta = (s: Persona) => { const o = ini.scelte[s.id]?.opz || (cfg.pred ? ini.predefinita : null); return o ? ini.opzioni.find(x => x.id === o)?.etichetta ?? o : 'Non indicata' }
    const intest = [...(perSede ? ['Sede'] : []), ...(cfg.tessera ? ['Tessera'] : []), 'Nominativo', ...(cfg.eta ? ['Età'] : []), ...(conScelta ? ['Scelta'] : []), ...(cfg.consegnato ? ['Consegnato'] : []), ...(cfg.firma ? ['Firma per ritiro'] : [])]
    return {
      titolo: `${ini.titolo} · ${conScelta ? 'scelte' : 'consegne'} ${perSede ? 'per sede' : 'per persona'}`, intest, gruppi: perSede,
      righe: soci.map(s => [...(perSede ? [sedeNome(db, s.sede)] : []), ...(cfg.tessera ? [s.tessera] : []), nominativo(s), ...(cfg.eta ? [etaDi(s, ini.data)] : []), ...(conScelta ? [scelta(s)] : []), ...(cfg.consegnato ? [ini.scelte[s.id]?.consegnato ? 'Sì' : 'No'] : []), ...(cfg.firma ? [''] : [])]),
    }
  }
  const { colonne, righe } = riepilogo(db, ini, cfg.pred)
  const ok = righe.filter(([k]) => !cfg.sedi.length || cfg.sedi.includes(k))
  const etich = (c: string) => c === '__NONE' ? 'Non indicata' : c === '__ADES' ? 'Destinatari' : ini.opzioni.find(o => o.id === c)?.etichetta ?? c
  const col = colonne.filter(c => c !== '__NONE' || ok.some(([, r]) => r['__NONE']))
  const out: Cella[][] = ok.map(([k, r]) => [k === '__NOSEDE' ? 'Sede non indicata' : sedeNome(db, k), ...col.map(c => r[c] ?? 0), col.reduce((a, c) => a + (r[c] ?? 0), 0)])
  if (out.length) out.push(['Totale complessivo', ...col.map((_, j) => out.reduce((a, r) => a + Number(r[j + 1]), 0)), out.reduce((a, r) => a + Number(r[r.length - 1]), 0)])
  return { titolo: `${ini.titolo} · quantità per sede`, intest: ['Sede', ...col.map(etich), 'Totale'], totale: true, righe: out }
}

/** Tipi di report ammessi per un evento (o senza evento). */
export function tipiAmmessi(ini: Iniziativa | undefined): Array<[TipoReport, string, string]> {
  const SOCI: [TipoReport, string, string] = ['soci', 'Elenco soci', 'Nominativi per sede di consegna, senza evento']
  const QUOTE: [TipoReport, string, string] = ['quote', 'Quote associative', 'Per anno solare: modalità, mesi pagati, dovuto, versato, saldo']
  const m = ini?.modalita
  if (m === 'TURNI') return [['riepilogo', 'Iscritti per settimana', 'Prenotate, frequentate, tolte, posti e importo'], ['scelte', 'Quote per famiglia', 'Prima il socio o dipendente, sotto i figli: quota, sconto, dovuto, versato, saldo'], ['settimane', 'Elenco per settimana', "Chi c'è settimana per settimana: anche come foglio presenze"], SOCI, QUOTE]
  if (m === 'MAGAZZINO') return [['riepilogo', 'Giacenze', 'Caricati, consegnati, in giacenza e in attesa per articolo'], ['scelte', 'Richieste', 'Chi ha chiesto cosa, quando e se è stato consegnato'], ['movimenti', 'Registro di magazzino', 'Carichi e consegne in ordine di data, con la giacenza'], SOCI, QUOTE]
  const ord = m === 'ORDINE'
  return [
    ['riepilogo', 'Quantità per sede', ord ? 'Pezzi per prodotto e importo, sede per sede' : "Pivot sede × scelta, con totale: l'ordine al fornitore"],
    ['scelte', ord ? 'Ordini per persona' : m === 'NESSUNA' ? 'Consegne per persona' : 'Scelte per persona', ord ? 'Quantità, totale €, pagato, note: il foglio degli ordini' : 'Nominativo, sede e scelta: la lista di consegna'],
    ...(ord ? [['fornitore', 'Ordine al fornitore', 'Per prodotto: prezzo, quantità, importo e litri/kg, con subtotali per tipologia'] as [TipoReport, string, string]] : []),
    SOCI, QUOTE,
  ]
}

// ── PDF (jspdf, tabelle disegnate a mano come negli allegati dei versamenti) ──
/** Il carattere standard del PDF copre WinAnsi: i simboli fuori si sostituiscono. */
export const testoPdf = (v: Cella): string => String(v).replace(/−/g, '-').replace(/≠/g, '<>').replace(/→/g, '->').replace(/[●•]/g, '*')
  .replace(/[^\u0000-ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g, '?')

export async function creaPdf(rep: Report, cfg: Pick<CfgReport, 'firma' | 'paginaPerSede'>, utente: string, oggiIso: string): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const conGruppi = !!rep.gruppi
  const intest = (rep.breve ?? rep.intest).slice(conGruppi ? 1 : 0)
  const sopra = rep.sopra?.slice(conGruppi ? 1 : 0)
  const nCol = intest.length
  const land = rep.intest.length > 5
  const doc = new jsPDF({ orientation: land ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  const X0 = 10, LARGH = W - 20, YMAX = H - 14
  const fs = nCol > 12 ? 6.5 : nCol > 8 ? 7.5 : 8.5
  const hRiga = fs * 0.62 + (cfg.firma ? 3.6 : 2.4)
  const offset = conGruppi ? 1 : 0
  const num = (k: number) => !!rep.numCols?.has(k + offset) || (!!rep.totale && k > 0)
  // larghezze: dal testo più lungo (con un tetto), la firma più larga
  doc.setFontSize(fs)
  const pesi = intest.map((h, k) => {
    const celle = rep.righe.slice(0, 300).map(r => testoPdf(r[k + offset] ?? ''))
    const w = Math.max(doc.getTextWidth(testoPdf(h)) * 0.8, ...celle.map(c => doc.getTextWidth(c))) + 3
    return h.startsWith('Firma') ? Math.max(w, 40) : Math.min(Math.max(w, 8), 70)
  })
  const somma = pesi.reduce((a, b) => a + b, 0) || 1
  const larg = pesi.map(p => (p / somma) * LARGH)
  let y = 0
  const cella = (t: string, x: number, w: number, destra: boolean) => {
    let s = testoPdf(t)
    while (s && doc.getTextWidth(s) > w - 2.4) s = s.slice(0, -1)
    doc.text(s, destra ? x + w - 1.2 : x + 1.2, y, { align: destra ? 'right' : 'left' })
  }
  const testata = (sotto: string) => {
    doc.setTextColor(0); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(testoPdf(`CRAL · ${rep.titolo}`).slice(0, 120), 14, 16)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(110)
    doc.text(testoPdf(`Generato da Payroll Gang Suite il ${fmtData(oggiIso)}${utente ? ` · ${utente}` : ''}${sotto ? ` · ${sotto}` : ''}`), 14, 21.5); doc.setTextColor(0)
    y = 28
  }
  const testaTabella = () => {
    doc.setFontSize(fs); doc.setFont('helvetica', 'bold')
    if (sopra?.some(Boolean)) {
      doc.setFillColor(224, 231, 255)
      let x = X0, k = 0
      while (k < nCol) {
        let j = k + 1; while (j < nCol && sopra[j] && sopra[j] === sopra[k]) j++
        const w = larg.slice(k, j).reduce((a, b) => a + b, 0)
        if (sopra[k]) { doc.rect(x, y - hRiga + 1.4, w, hRiga, 'F'); cella(sopra[k]!, x, w, false) }
        x += w; k = j
      }
      y += hRiga
    }
    doc.setFillColor(79, 70, 229); doc.rect(X0, y - hRiga + 1.4, LARGH, hRiga, 'F'); doc.setTextColor(255)
    let x = X0; intest.forEach((h, k) => { cella(h, x, larg[k]!, num(k)); x += larg[k]! })
    doc.setTextColor(0); doc.setFont('helvetica', 'normal'); y += hRiga
  }
  const riga = (r: Cella[], grassetto: boolean) => {
    if (y > YMAX) { doc.addPage(); y = 18; testaTabella() }
    doc.setFont('helvetica', grassetto ? 'bold' : 'normal'); doc.setFontSize(fs)
    if (grassetto) { doc.setFillColor(241, 245, 249); doc.rect(X0, y - hRiga + 1.4, LARGH, hRiga, 'F') }
    let x = X0
    r.forEach((c, k) => { if (k < nCol) { cella(String(c), x, larg[k]!, num(k)); x += larg[k]! } })
    doc.setDrawColor(210, 214, 220); doc.line(X0, y + 1.4, X0 + LARGH, y + 1.4)
    y += hRiga
  }
  if (!conGruppi) {
    testata(''); testaTabella()
    rep.righe.forEach((r, i) => riga(r, (!!rep.totale && i === rep.righe.length - 1) || !!rep.bold?.has(i)))
  } else {
    const gruppi = new Map<string, Array<{ r: Cella[]; i: number }>>()
    rep.righe.forEach((r, i) => { const k = String(r[0]); gruppi.set(k, [...(gruppi.get(k) ?? []), { r: r.slice(1), i }]) })
    const perPagina = rep.paginaPerGruppo ?? cfg.paginaPerSede
    let primo = true
    gruppi.forEach((gg, nome) => {
      if (perPagina && !primo) doc.addPage()
      if (primo || perPagina) testata(perPagina ? nome : '')
      else y += 4
      if (y > YMAX - 20) { doc.addPage(); y = 18 }
      const nr = gg.filter(x => !rep.bold?.has(x.i)).length
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.text(testoPdf(`${nome}  (${nr})`).slice(0, 140), 14, y); y += 8
      testaTabella()
      gg.forEach(x => riga(x.r, !!rep.bold?.has(x.i)))
      primo = false
    })
  }
  const n = doc.getNumberOfPages()
  for (let p = 1; p <= n; p++) { doc.setPage(p); doc.setFontSize(8); doc.setTextColor(130); doc.text(`Pagina ${p} di ${n}`, W - 14, H - 8, { align: 'right' }) }
  return doc.output('blob')
}

export { MODI_QUOTA }
