// Test delle regole del modulo CRAL lato client (conti, sconti, turni, magazzino, quote).
// Dati SINTETICI: nomi inventati, matricole 09xxxx, nessun codice fiscale.
// Si lanciano con:  npm test --workspace=client

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Db, Iniziativa, Persona } from './tipi.ts'
import { ALIMENTARI_VUOTI, CONTATTI_VUOTI } from './contatti.ts'
import { STATI_DI_BASE } from './tipi.ts'
import * as L from './logica.ts'
import { numera } from './report.ts'
import {
  aggiunti, applicaSconto, codaRichieste, contiMagazzino, contiOrdine, descrPart, destinatari, differenzeQuote, dovutoTurni, eta, importoRichiesta, leggiData,
  motivoQuota, nettoSocio, noteQuota, parseEuro, quotaDi, quotaDopoModifica, quoteDovute, rataMese, rifDi, risolvi, riepilogo, simNome, sociAnno, sociQuota, spezzaNominativo, statoQuota, tenutoQuota, tesseraRiammissione, versatoQuota,
} from './logica.ts'
import { costruisciReport, testoPdf, type CfgReport } from './report.ts'

const P = (id: string, tipo: Persona['tipo'], cognome: string, nome: string, over: Partial<Persona> = {}): Persona => ({
  id, tipo, origine: /^\d/.test(id) ? 'PGS' : 'EST', matricola: /^\d/.test(id) ? id : null, cognome, nome, nascita: null, email: '', sede: 'S1',
  tessera: '', riammissioni: 0, stato: 'ATTIVO', iscrittoIl: '2020-01-10', cessatoIl: null, provenienza: null, atipico: false, note: '',
  creatoDa: null, creatoIl: '2020-01-10', validatoDa: null, validatoIl: null, modificatoDa: null, modificatoIl: null,
  eliminatoIl: null, eliminatoDa: null, statoPrima: null, anniEsenti: [], exMatricola: null, legami: [], storicoTessere: [],
  contatti: { ...CONTATTI_VUOTI }, alimentari: { ...ALIMENTARI_VUOTI }, ...over,
})
const SOCI: Persona[] = [
  P('090001', 'SD', 'ROSSI', 'Luca', { tessera: '0001', nascita: '1980-06-15' }),
  P('090002', 'SD', 'BIANCHI', 'Giulia', { tessera: '0002', sede: 'S2' }),
  P('EXT-0001', 'SE', 'VERDI', 'Carla', { tessera: '0003' }),
  P('090003', 'EST', 'NERI', 'Paolo'),                                      // dipendente non socio
  P('EXT-0002', 'EST', 'GIALLI', 'Anna'),                                   // esterno
  P('FAM-0001', 'FAM', 'ROSSI', 'Matteo', { legami: [{ socio: '090001', relazione: 'FIGLIO' }], nascita: '2016-03-01' }),
  P('FAM-0002', 'FAM', 'BIANCHI', 'Sara', { legami: [{ socio: '090002', relazione: 'FIGLIO' }] }),
  P('090004', 'SD', 'VIOLA', 'Marco', { stato: 'CESSATO', cessatoIl: '2026-05-31', tessera: '0004' }),
  P('FAM-0003', 'FAM', 'VIOLA', 'Ugo', { legami: [{ socio: '090004', relazione: 'FIGLIO' }] }),
]
const db = (over: Partial<Db> = {}): Db => ({
  sedi: [{ id: 'S1', nome: 'Sede Uno', attiva: true, ordine: 1 }, { id: 'S2', nome: 'Sede Due', attiva: true, ordine: 2 }],
  tipi: [], tipologie: [{ id: 'TER', nome: 'Terra', attiva: true, ordine: 1 }],
  tessera: { formato: 'NUM', prefisso: 'CRAL-', cifre: 4, prossimo: 5, riammissione: 'NUOVO', sepSuffisso: '/', cifreSuffisso: 2, vincolante: false },
  stati: STATI_DI_BASE, extProssimo: 3, famProssimo: 4, soci: SOCI, perId: new Map(SOCI.map(s => [s.id, s])), iniziative: [],
  quoteAnno: [{ anno: 2026, importo: 6000 }], quote: {}, ...over,
})
const evento = (over: Partial<Iniziativa>): Iniziativa => ({
  id: 'e1', tipo: 'X', titolo: 'Prova', anno: 2026, data: '2026-07-01', scadenza: null, stato: 'APERTA', modalita: 'SCELTA', modoPart: 'GRUPPI',
  gruppi: ['SD', 'SE'], sedi: [], predefinita: null, fornitore: '', pagamento: '', note: '', quota: 0, opzioni: [], prodotti: [], periodi: [], articoli: [],
  sconti: {}, archiviata: false, archiviataDa: null, archiviataIl: null, copiatoDa: null, partecipanti: [], scelte: {}, carichi: [], richieste: [], ...over,
})

test('importi e date dai file', () => {
  assert.equal(parseEuro('1.234,50'), 123450)
  assert.equal(parseEuro('10.5'), 1050)
  assert.equal(parseEuro('abc'), null)
  assert.equal(leggiData('19580307'), '1958-03-07')
  assert.equal(leggiData('7/3/1958'), '1958-03-07')
  assert.equal(eta('2016-03-01', '2026-02-28'), 9)
  assert.equal(eta('2016-03-01', '2026-03-01'), 10)
  assert.equal(eta(null), '')
})

test('partecipanti: gruppi, sedi, familiari solo con socio attivo', () => {
  const d = db()
  assert.deepEqual(destinatari(d, evento({ gruppi: ['SD', 'SE'] })).map(s => s.id), ['090001', '090002', 'EXT-0001'])
  assert.deepEqual(destinatari(d, evento({ gruppi: ['SD'], sedi: ['S2'] })).map(s => s.id), ['090002'])
  // il figlio del socio cessato non partecipa
  assert.deepEqual(destinatari(d, evento({ gruppi: ['FAM'] })).map(s => s.id), ['FAM-0001', 'FAM-0002'])
  assert.deepEqual(destinatari(d, evento({ modoPart: 'SINGOLI', partecipanti: ['EXT-0002', 'FAM-0003'] })).map(s => s.id), ['EXT-0002'])
})

test('evento per gruppi: persone aggiunte a mano (26.11.14.2)', () => {
  const d = db()
  const ids = (xs: Persona[]) => xs.map(s => s.id)
  // un esterno aggiunto a un evento per soci: partecipa e resta esterno
  const e = evento({ gruppi: ['SD', 'SE'], partecipanti: ['EXT-0002'] })
  assert.deepEqual(ids(destinatari(d, e)), ['090001', '090002', 'EXT-0001', 'EXT-0002'])
  assert.deepEqual(aggiunti(d, e).map(s => `${s.id} ${s.tipo}`), ['EXT-0002 EST'])
  // non passa dal filtro delle sedi: l'evento è solo per la sede S2, l'aggiunto è in S1
  const s2 = evento({ gruppi: ['SD'], sedi: ['S2'], partecipanti: ['EXT-0002', '090001'] })
  assert.deepEqual(ids(destinatari(d, s2)), ['090001', '090002', 'EXT-0002'])
  assert.deepEqual(ids(aggiunti(d, s2)), ['090001', 'EXT-0002'], 'anche un socio di un\'altra sede è un aggiunto')
  // chi è già nei gruppi conta una volta sola e non è un «aggiunto»
  const doppio = evento({ gruppi: ['SD', 'SE'], partecipanti: ['090001', 'EXT-0002'] })
  assert.equal(destinatari(d, doppio).length, 4)
  assert.deepEqual(ids(aggiunti(d, doppio)), ['EXT-0002'])
  // fuori chi non è attivo: cessato, familiare senza socio attivo, da validare
  assert.deepEqual(aggiunti(d, evento({ partecipanti: ['090004', 'FAM-0003'] })), [])
  const daVal = [...SOCI, P('EXT-0009', 'EST', 'COLOMBO', 'Ida', { stato: 'DA_VALIDARE' })]
  const dv = db({ soci: daVal, perId: new Map(daVal.map(s => [s.id, s])) })
  assert.deepEqual(aggiunti(dv, evento({ partecipanti: ['EXT-0009'] })), [], 'entra solo dopo la validazione')
  // negli eventi «Singoli» non c'è distinzione: l'elenco è tutto a mano
  assert.deepEqual(aggiunti(d, evento({ modoPart: 'SINGOLI', gruppi: [], partecipanti: ['EXT-0002'] })), [])
  // riepilogo per sede e descrizione seguono
  assert.equal(riepilogo(d, e, false).dest.length, 4)
  assert.equal(descrPart(e), 'soci dipendenti + soci esterni · tutte le sedi')
  assert.equal(descrPart(e, 1), 'soci dipendenti + soci esterni · tutte le sedi · + 1 aggiunto')
  assert.equal(descrPart(s2, 2), 'soci dipendenti · 1 sedi · + 2 aggiunti')
})

test('riepilogo per sede con la predefinita per chi non sceglie', () => {
  const i = evento({ opzioni: [{ id: 'A', etichetta: 'Uno' }, { id: 'B', etichetta: 'Due' }], predefinita: 'A', scelte: { '090002': { opz: 'B' } } })
  const r = riepilogo(db(), i, true)
  assert.deepEqual(r.righe, [['S1', { A: 2, B: 0, __NONE: 0 }], ['S2', { A: 0, B: 1, __NONE: 0 }]])
  assert.deepEqual(riepilogo(db(), i, false).righe[0], ['S1', { A: 0, B: 0, __NONE: 2 }])
})

test('ordini: sconto per tipologia e sconto personale', () => {
  const i = evento({
    modalita: 'ORDINE', gruppi: ['SD', 'SE', 'EST'], prodotti: [{ id: 'M', tipologia: 'TER', nome: 'Mele', prezzo: 250, unita: 'kg', contenuto: null, contenutoUm: 'kg', max: null }],
    sconti: { SD: { tipo: '%', val: 10 } },
    scelte: { '090001': { q: { M: 4 } }, 'EXT-0001': { q: { M: 6 }, scontoPers: { tipo: '€', val: 500 } }, '090003': { q: { M: 2 }, pagato: true } },
  })
  const d = db()
  assert.equal(nettoSocio(d, i, '090001'), 900)
  assert.equal(nettoSocio(d, i, 'EXT-0001'), 1000)
  assert.equal(nettoSocio(d, i, '090003'), 500) // dipendente non socio: nessuna regola DIP
  const c = contiOrdine(d, i)
  assert.equal(c.lordo, 3000); assert.equal(c.totale, 2400); assert.equal(c.sconti, 600); assert.equal(c.incassato, 500)
  assert.equal(applicaSconto(1500, { tipo: 'NO' }), 1500)
})

test('campi estivi: riferimento, sconto bloccato all\'iscrizione, settimane tolte', () => {
  const per = ['W1', 'W2', 'W3'].map((id, k) => ({ id, nome: `Settimana ${k + 1}`, dal: `2026-07-0${k + 1}`, al: `2026-07-0${k + 1}`, posti: null }))
  const i = evento({
    modalita: 'TURNI', modoPart: 'SINGOLI', partecipanti: ['FAM-0001', 'EXT-0002', 'FAM-0003'], quota: 18000, periodi: per,
    sconti: { SD: { tipo: '%', val: 50 }, SE: { tipo: '%', val: 50 }, DIP: { tipo: '%', val: 50 } },
    scelte: {
      'FAM-0001': { per: { W1: 'F', W2: 'T', W3: 'P' } },
      'EXT-0002': { per: { W1: 'P' }, rif: '090003' },                          // figlia di un dipendente non socio
      'FAM-0003': { per: { W1: 'P' }, iscr: { data: '2026-05-01', cat: 'SD' } }, // il socio è cessato dopo l'iscrizione
    },
  })
  const d = db()
  const f1 = d.perId.get('FAM-0001')!, e2 = d.perId.get('EXT-0002')!
  assert.equal(rifDi(d, i, f1)?.id, '090001')
  assert.equal(dovutoTurni(d, i, f1), 2 * 9000) // tolta non si paga
  assert.equal(quotaDi(d, i, e2), 9000)          // riferimento dipendente non socio: sconto DIP
  assert.equal(rifDi(d, { ...i, scelte: { ...i.scelte, 'EXT-0002': { rif: '' } } }, e2), null)
  // FAM-0003: socio cessato, ma il familiare non è tra i destinatari; la regola resta quella bloccata
  assert.equal(quotaDi(d, i, d.perId.get('FAM-0003')!), 9000)
})

test('magazzino: giacenza, coda per data, sconto € a biglietto', () => {
  const i = evento({
    modalita: 'MAGAZZINO', articoli: [{ id: 'C', nome: 'Cinema', prezzo: 500 }], sconti: { SD: { tipo: '€', val: 100 } },
    carichi: [{ id: 'k1', art: 'C', qta: 5, data: '2026-10-01', note: '' }],
    richieste: [
      { id: 'r1', persona: '090001', art: 'C', qta: 2, dataRich: '2026-10-02', stato: 'CONSEGNATA', dataCons: '2026-10-03', modo: 'MANO', pagato: true, sconto: null, note: '' },
      { id: 'r2', persona: '090002', art: 'C', qta: 4, dataRich: '2026-10-04', stato: 'ATTESA', dataCons: null, modo: 'MANO', pagato: false, sconto: null, note: '' },
      { id: 'r3', persona: 'EXT-0001', art: 'C', qta: 2, dataRich: '2026-10-05', stato: 'ATTESA', dataCons: null, modo: 'EMAIL', pagato: false, sconto: { tipo: '%', val: 50 }, note: '' },
    ],
  })
  const d = db()
  assert.deepEqual(contiMagazzino(i)['C'], { car: 5, con: 2, att: 6, giac: 3, disp: -3 })
  assert.deepEqual(codaRichieste(i), { r2: 'coda', r3: 'pronta' })
  assert.equal(importoRichiesta(d, i, i.richieste[0]!), 800)  // 2 × (5,00 − 1,00)
  assert.equal(importoRichiesta(d, i, i.richieste[2]!), 500)  // sconto personale sul totale
})

test('quote associative: intera anche entrando a novembre o recedendo prima', () => {
  const nov = P('090009', 'SD', 'NUOVI', 'Ada', { iscrittoIl: '2026-11-05' })
  const d = db({ soci: [...SOCI, nov], perId: new Map([...SOCI, nov].map(s => [s.id, s])), quote: { '2026': { '090001': { modo: 'MENSILE', mesi: [true, true, ...Array<boolean>(10).fill(false)], importi: [500, 500, ...Array<number>(10).fill(0)], pagataIl: null, versatoUnica: null, note: '' } } } })
  assert.equal(tenutoQuota(nov, 2026), true)
  assert.equal(tenutoQuota(nov, 2025), false)
  assert.equal(tenutoQuota(d.perId.get('090004')!, 2026), true)   // cessato a maggio: deve l'anno
  assert.equal(tenutoQuota(d.perId.get('090003')!, 2026), false)  // esterno: niente quota
  assert.equal(rataMese(6000, 0) * 11 + rataMese(6000, 11), 6000)
  assert.equal(rataMese(6001, 11), 501)
  assert.equal(versatoQuota(d, 2026, d.perId.get('090001')!), 1000)
  assert.equal(versatoQuota(d, 2026, nov), 0) // trattenuta predefinita, nessun mese
})

test('tessera al rientro: nuovo numero o suffisso', () => {
  const t = db().tessera
  const s = P('090004', 'SD', 'VIOLA', 'Marco', { tessera: '0004', stato: 'CESSATO' })
  assert.deepEqual(tesseraRiammissione(t, s), { tessera: '0005', nuovoNumero: true })
  assert.deepEqual(tesseraRiammissione({ ...t, riammissione: 'SUFFISSO' }, s), { tessera: '0004/01', nuovoNumero: false })
  assert.deepEqual(tesseraRiammissione({ ...t, riammissione: 'SUFFISSO' }, { ...s, tessera: '0004/01', riammissioni: 1 }), { tessera: '0004/02', nuovoNumero: false })
})

test('nominativi: aggancio, somiglianza, cognome composto', () => {
  assert.equal(risolvi("D'ANGELO MARCO", [{ cognome: 'DANGELO', nome: 'Marco' }]).esito, 'trovato')
  assert.equal(risolvi('BIANCHI GIULIA', [{ cognome: 'BIANCHI', nome: 'Giulia Maria' }]).esito, 'parziale')
  assert.ok(simNome('ROSSSI LUCA', 'ROSSI LUCA') > 0.85)
  assert.ok(simNome('ROSSI LUCA', 'BIANCHI GIULIA') < 0.5)
  assert.deepEqual(spezzaNominativo('DE ROSSI MICHELE'), ['DE ROSSI', 'MICHELE'])
})

test('report: elenco soci per sede ed età solo se richiesta', () => {
  const cfg: CfgReport = {
    tipo: 'soci', ini: '', sedi: [], origine: '', pred: true, tessera: true, consegnato: true, pagato: true, note: true, firma: false,
    colSoci: { sede: true, id: false, nom: true }, sedeScelte: true, ordinaPer: 'nom', paginaPerSede: true, soloMancanti: false, inclusiVuoti: false,
    soloDaPagare: false, soloSaldo: false, includiTolte: false, presenze: true, aCarico: true, perRif: true, eta: false, anno: 2026, qmodo: '', mesi: true, statoRic: '',
  }
  const r = costruisciReport(db(), cfg, '2026-10-28')
  assert.deepEqual(r.intest, ['Sede di lavoro', 'Tessera', 'Nominativo'])
  assert.deepEqual(r.righe.map(x => x[2]), ['ROSSI Luca', 'VERDI Carla', 'BIANCHI Giulia'])
  const e = costruisciReport(db(), { ...cfg, eta: true }, '2026-10-28')
  assert.equal(e.righe[0]?.[3], 46)
  assert.equal(testoPdf('−10% → ok ●'), '-10% -> ok *')
})

test('quota: eliminati e anni esenti (decisione del 29/10)', () => {
  const el = P('090010', 'SD', 'COLOMBO', 'Anna', { stato: 'ELIMINATO', statoPrima: 'ATTIVO', eliminatoIl: '2026-04-01', iscrittoIl: '2024-01-15' })
  assert.equal(tenutoQuota(el, 2025), true)
  assert.equal(tenutoQuota(el, 2026), false)
  assert.equal(tenutoQuota({ ...el, statoPrima: 'DA_VALIDARE' }, 2025), false)
  const rip = P('090010', 'SD', 'COLOMBO', 'Anna', { anniEsenti: [2026], iscrittoIl: '2024-01-15' })
  assert.equal(tenutoQuota(rip, 2026), false)
  assert.equal(tenutoQuota(rip, 2027), true)
  // l'eliminato non è tra i destinatari degli eventi, e i suoi familiari sono sospesi
  const soci = [el, P('FAM-0010', 'FAM', 'COLOMBO', 'Pietro', { legami: [{ socio: '090010', relazione: 'FIGLIO' }] })]
  const d = db({ soci, perId: new Map(soci.map(x => [x.id, x])) })
  assert.deepEqual(destinatari(d, evento({ gruppi: ['SD', 'FAM'] })).map(x => x.id), [])
})

test('quote (0024): il versato è la somma degli importi; a mano un mese registra la rata', () => {
  const s = SOCI[0]!
  const q = { modo: 'MENSILE' as const, mesi: [true, false, ...Array<boolean>(10).fill(false)], importi: [500, 450, ...Array<number>(10).fill(0)], pagataIl: null, versatoUnica: null, note: '' }
  const d = db({ quote: { '2026': { [s.id]: q } } })
  assert.equal(versatoQuota(d, 2026, s), 950)
  const q2 = quotaDopoModifica(q, { mesi: [true, true, ...Array<boolean>(10).fill(false)] }, 6000)
  assert.deepEqual(q2.importi.slice(0, 2), [500, 500])
  assert.equal(quotaDopoModifica(q, { pagataIl: '2026-01-10' }, 6000).versatoUnica, 6000)
})

// 26.11.11.2: stessi casi del server (server/src/lib/cral.test.ts)
import { tesseraNelFormato } from './logica.ts'
test('tessera nel formato: spento come prima, acceso completa o rifiuta', () => {
  const T = { formato: 'NUM' as const, prefisso: 'CRAL-', cifre: 4, prossimo: 5, riammissione: 'NUOVO' as const, sepSuffisso: '/' as const, cifreSuffisso: 2, vincolante: false }
  assert.deepEqual(tesseraNelFormato(T, ' 175 '), { tessera: '175' })
  const V = { ...T, vincolante: true }
  assert.deepEqual(tesseraNelFormato(V, '175'), { tessera: '0175' })
  assert.deepEqual(tesseraNelFormato(V, '1'), { tessera: '0001' })
  assert.deepEqual(tesseraNelFormato(V, '0175'), { tessera: '0175' })
  assert.deepEqual(tesseraNelFormato(V, ''), { tessera: '' })
  assert.match((tesseraNelFormato(V, '12345') as { errore: string }).errore, /al massimo 4 cifre/)
  assert.match((tesseraNelFormato(V, 'A12') as { errore: string }).errore, /formato 0042/)
  assert.deepEqual(tesseraNelFormato({ ...V, formato: 'PREF' }, 'cral-175'), { tessera: 'CRAL-0175' })
  assert.deepEqual(tesseraNelFormato({ ...V, riammissione: 'SUFFISSO' }, '0042/01'), { tessera: '0042/01' })
  assert.deepEqual(tesseraNelFormato({ ...V, riammissione: 'SUFFISSO', sepSuffisso: '' }, '004201'), { tessera: '004201' })
})

// 26.11.11.3: familiari di esterni
import { catPersona, famDiEsterno, gruppoDi, nomeTipologia } from './logica.ts'
test('familiari di esterni: gruppo a sé, sconto dell\'esterno, i familiari dei soci non cambiano', () => {
  const extra = [
    P('FAM-0004', 'FAM', 'GIALLI', 'Leo', { legami: [{ socio: 'EXT-0002', relazione: 'FIGLIO' }] }),            // figlio di esterno
    P('FAM-0005', 'FAM', 'NERI', 'Ada', { legami: [{ socio: '090003', relazione: 'FIGLIO' }] }),                // figlia di dipendente non socio
    P('FAM-0006', 'FAM', 'ROSSI', 'Bea', { legami: [{ socio: 'EXT-0002', relazione: 'FIGLIO' }, { socio: '090001', relazione: 'FIGLIO' }] }), // anche di un socio
    P('FAM-0007', 'FAM', 'VIOLA', 'Ivo', { legami: [{ socio: 'EXT-0002', relazione: 'FIGLIO' }, { socio: '090004', relazione: 'FIGLIO' }] }), // socio cessato
  ]
  const soci = [...SOCI, ...extra]
  const d = db({ soci, perId: new Map(soci.map(s => [s.id, s])) })
  const p = (id: string) => d.perId.get(id)!
  assert.equal(famDiEsterno(d, p('FAM-0001')), false)
  assert.equal(famDiEsterno(d, p('FAM-0004')), true)
  assert.equal(famDiEsterno(d, p('FAM-0006')), false, 'con un socio attivo resta dei soci')
  assert.equal(famDiEsterno(d, p('FAM-0007')), true, 'il socio è cessato: conta l\'esterno attivo')
  assert.equal(gruppoDi(d, p('FAM-0004')), 'FEX'); assert.equal(gruppoDi(d, p('FAM-0001')), 'FAM'); assert.equal(gruppoDi(d, p('090001')), 'SD')
  assert.equal(nomeTipologia(d, p('FAM-0004')), 'Familiare di esterno'); assert.equal(nomeTipologia(d, p('FAM-0001')), 'Familiare')
  // eventi: il gruppo dei familiari dei soci non prende i familiari di esterni, e viceversa
  const ids = (g: Iniziativa['gruppi']) => destinatari(d, evento({ gruppi: g })).map(s => s.id).filter(x => x.startsWith('FAM'))
  assert.deepEqual(ids(['FAM']), ['FAM-0001', 'FAM-0002', 'FAM-0006'])
  assert.deepEqual(ids(['FEX']), ['FAM-0004', 'FAM-0005', 'FAM-0007'])
  // sconti: la categoria dell'esterno (o dipendente non socio), mai «Familiari»
  assert.equal(catPersona(p('FAM-0001'), d), 'FAM')
  assert.equal(catPersona(p('FAM-0004'), d), 'EST')
  assert.equal(catPersona(p('FAM-0005'), d), 'DIP')
  assert.equal(catPersona(p('FAM-0004')), 'FAM', 'senza db resta il comportamento di prima')
})

test('quote (0028): dovuta, esente, non dovuta; «Allinea soci» conta le differenze', () => {
  // ROSSI e BIANCHI attivi, VERDI socia esterna, VIOLA cessato a maggio 2026 (deve l'anno), COLOMBO entrata e cessata a novembre
  const err = P('090009', 'SD', 'COLOMBO', 'Ida', { iscrittoIl: '2026-11-03', stato: 'CESSATO', cessatoIl: '2026-11-10' })
  const soci = [...SOCI, err]
  const riga = (stato: 'ESENTE' | 'NON_DOVUTA', motivo: string, importi = Array<number>(12).fill(0)) =>
    ({ modo: 'MENSILE' as const, mesi: importi.map(v => v > 0), importi, pagataIl: null, versatoUnica: null, note: '', stato, motivo })
  const d = db({ soci, perId: new Map(soci.map(s => [s.id, s])), quoteAnno: [{ anno: 2025, importo: 6000 }, { anno: 2026, importo: 6000 }],
    quote: { '2025': { 'EXT-0001': riga('ESENTE', 'socia onoraria') }, '2026': { '090002': riga('ESENTE', 'delibera del direttivo', [500, ...Array<number>(11).fill(0)]) } } })
  const p = (id: string) => d.perId.get(id)!
  const ids = (xs: Persona[]) => xs.map(s => s.id)
  // senza riga (o con una riga di prima della 0028) la quota è dovuta
  assert.equal(statoQuota(d, 2026, p('090001')), 'DOVUTA')
  assert.equal(statoQuota(db({ quote: { '2026': { '090001': { modo: 'UNICA', mesi: Array<boolean>(12).fill(false), importi: Array<number>(12).fill(0), pagataIl: null, versatoUnica: null, note: '' } } } }), 2026, p('090001')), 'DOVUTA')
  assert.equal(statoQuota(d, 2026, p('090002')), 'ESENTE'); assert.equal(motivoQuota(d, 2026, p('090002')), 'delibera del direttivo')
  // per l'anagrafica i soci del 2026 sono cinque: l'errore è fra loro, ed è il caso da correggere
  assert.deepEqual(ids(sociAnno(d, 2026)), ['090001', '090002', 'EXT-0001', '090004', '090009'])
  assert.deepEqual(ids(sociQuota(d, 2026)), ['090001', '090002', 'EXT-0001', '090004', '090009'], 'l\'esente resta in elenco')
  assert.deepEqual(ids(quoteDovute(d, 2026)), ['090001', 'EXT-0001', '090004', '090009'], 'ma non entra nel dovuto')
  // cosa guardare: entrati e usciti nell'anno, esenti l'anno prima
  assert.deepEqual(noteQuota(d, 2026, p('090009')), ['entrato il 03/11/2026', 'cessato il 10/11/2026'])
  assert.deepEqual(noteQuota(d, 2026, p('EXT-0001')), ['esente nel 2025'])
  assert.deepEqual(noteQuota(d, 2026, p('090001')), [])
  // differenze: l'errore diventa non dovuta, l'esente del 2025 si riconferma, l'esente di oggi torna dovuta
  const scelte = { '090009': 'NON_DOVUTA' as const, 'EXT-0001': 'ESENTE' as const, '090002': 'DOVUTA' as const, '090001': 'DOVUTA' as const }
  const r = differenzeQuote(d, 2026, scelte)
  assert.deepEqual(r.diff.map(x => [x.s.id, x.prima, x.dopo, x.versato]), [['090002', 'ESENTE', 'DOVUTA', 500], ['090009', 'DOVUTA', 'NON_DOVUTA', 0], ['EXT-0001', 'DOVUTA', 'ESENTE', 0]])
  assert.equal(r.prima, 4); assert.equal(r.dopo, 3)   // 4 − 2 che escono + 1 che torna
  assert.deepEqual(differenzeQuote(d, 2026, {}).diff, [])
  // dopo l'approvazione: la non dovuta esce dall'elenco dell'anno, non dagli altri anni né dall'anagrafica
  const dopo = db({ soci, perId: d.perId, quoteAnno: d.quoteAnno, quote: { '2026': { '090009': riga('NON_DOVUTA', 'inserita per errore') } } })
  assert.deepEqual(ids(sociQuota(dopo, 2026)), ['090001', '090002', 'EXT-0001', '090004'])
  assert.deepEqual(ids(sociAnno(dopo, 2026)), ['090001', '090002', 'EXT-0001', '090004', '090009'], 'in «Allinea soci» si vede ancora, per rimetterla dovuta')
  assert.equal(tenutoQuota(p('090009'), 2026), true, 'la regola dell\'anagrafica non cambia')
  // il report Quote: l'esente c'è con dovuto zero, la non dovuta non c'è
  const cfg = { tipo: 'quote', anno: 2026, sedi: [], origine: '', ordinaPer: 'nom', tessera: false, eta: false, mesi: false, note: true, firma: false, qmodo: '', soloSaldo: false } as unknown as CfgReport
  const rep = costruisciReport(d, cfg)
  const col = (nome: string) => rep.intest.indexOf(nome)
  const rigaDi = (cognome: string) => rep.righe.find(x => String(x[col('Nominativo')]).startsWith(cognome))!
  assert.equal(rigaDi('BIANCHI')[col('Modalità')], 'Esente'); assert.equal(rigaDi('BIANCHI')[col('Dovuto €')], '0,00'); assert.equal(rigaDi('BIANCHI')[col('Note')], 'delibera del direttivo')
  assert.equal(rigaDi('ROSSI')[col('Dovuto €')], '60,00')
  assert.equal(rep.righe.at(-1)![col('Dovuto €')], '240,00', 'totale: quattro quote dovute')
  assert.equal(costruisciReport(dopo, cfg).righe.some(x => String(x[col('Nominativo')]).startsWith('COLOMBO')), false)
})

test('stati (0030): permessi per regola, archiviato, stato sconosciuto', () => {
  const stati = [...STATI_DI_BASE, { id: 'SOSP', nome: 'Sospeso', colore: '#D97706', regola: 'SOSPESO' as const, attivo: true, ordine: 4 }, { id: 'ANN', nome: 'Annullato', colore: '#DC2626', regola: 'ANNULLATO' as const, attivo: true, ordine: 5 }]
  const d = db({ stati })
  const p = (stato: string, archiviata = false) => L.permessi(d, evento({ stato, archiviata }))
  assert.deepEqual(p('BOZZA'), { raccolta: true, gestione: true, consegna: false })
  assert.deepEqual(p('APERTA'), { raccolta: true, gestione: true, consegna: true })
  assert.deepEqual(p('CHIUSA'), { raccolta: false, gestione: true, consegna: true })
  assert.deepEqual(p('SOSP'), { raccolta: false, gestione: false, consegna: false })
  assert.deepEqual(p('APERTA', true), { raccolta: false, gestione: false, consegna: false }, 'archiviato: sola lettura')
  assert.deepEqual(p('NONCE'), { raccolta: false, gestione: false, consegna: false }, 'stato sconosciuto: nulla')
  assert.equal(L.statoDi(d, 'NONCE').nome, 'NONCE')
  assert.equal(L.frasePermessi(p('CHIUSA')), 'In questo stato non si registrano nuove scelte, ordini, iscrizioni o partecipanti.')
  assert.equal(L.frasePermessi(p('BOZZA')), 'In questo stato non si registrano consegne.')
  assert.equal(L.frasePermessi(p('APERTA')), '')
  // annullato: fuori dagli eventi «vivi» (scheda della persona)
  const d2 = db({ stati, iniziative: [evento({ id: 'a', stato: 'APERTA' }), evento({ id: 'b', stato: 'ANN' }), evento({ id: 'c', stato: 'APERTA', archiviata: true })] })
  assert.deepEqual(L.eventiVivi(d2).map(i => i.id), ['a'])
})

test('copia (26.11.23): date, titolo, persone dell\'evento, filtri', () => {
  assert.equal(L.sposta('2025-12-18', { tipo: 'ANNO' }), '2026-12-18')
  assert.equal(L.sposta('2024-02-29', { tipo: 'ANNO' }), '2025-02-28')
  assert.equal(L.sposta('2027-02-28', { tipo: 'ANNO' }), '2028-02-28')
  assert.equal(L.sposta('2026-06-29', { tipo: 'GIORNI', n: 364 }), '2027-06-28')
  assert.equal(L.sposta('2026-03-01', { tipo: 'GIORNI', n: -1 }), '2026-02-28')
  assert.equal(L.sposta(null, { tipo: 'ANNO' }), null)
  assert.equal(L.sposta('2026-01-10', { tipo: 'NO' }), '2026-01-10')
  assert.equal(L.titoloCopia('Panettoni 2025', 2025, 2026), 'Panettoni 2026')
  assert.equal(L.titoloCopia('Strenne di Natale', 2025, 2026), 'Strenne di Natale (copia)')
  assert.equal(L.titoloCopia('Panettoni 2025', 2025, 2025), 'Panettoni 2025 (copia)')
  const d = db()
  // evento per soci con: un esterno aggiunto, una scelta di un familiare (fuori dai gruppi), una richiesta... di un cessato
  const ini = evento({ id: 'PAN25', gruppi: ['SD'], partecipanti: ['EXT-0002'], scelte: { '090001': { opz: 'O1', consegnato: true }, '090002': { opz: 'O2' }, 'FAM-0001': { opz: 'O1' }, '090004': { opz: 'O2', consegnato: true } } })
  assert.deepEqual(L.personeDellEvento(d, ini), ['090002', '090001', 'FAM-0001', 'EXT-0002', '090004'].sort((a, b) => L.nominativo(d.perId.get(a)!).localeCompare(L.nominativo(d.perId.get(b)!))))
  assert.deepEqual(L.personeFiltro(d, ini, 'consegnato').sort(), ['090001', '090004'])
  assert.deepEqual(L.personeFiltro(d, ini, 'scelto').length, 4)
  assert.equal(L.ancoraAttive(d, ['090001', '090004', 'FAM-0003']), 1, 'il cessato e il figlio del cessato non contano')
  assert.deepEqual(L.filtriCopia('TURNI'), ['iscritto'])
})

test('copia (26.11.23): l\'evento nuovo, la lista e le scelte riportate', () => {
  const d = db()
  const ini = evento({
    id: 'PAN25', tipo: 'PAN', titolo: 'Panettoni 2025', anno: 2025, data: '2025-12-18', scadenza: '2025-11-30', stato: 'CHIUSA', archiviata: true, archiviataIl: '2026-01-10',
    gruppi: ['SD', 'SE'], sedi: ['S2'], partecipanti: ['EXT-0002'], predefinita: 'O1', note: 'ritiro in portineria', fornitore: 'Pasticceria',
    opzioni: [{ id: 'O1', etichetta: 'Tradizionale' }, { id: 'O2', etichetta: 'Cioccolato' }, { id: 'O3', etichetta: 'Albicocca' }],
    scelte: { '090001': { opz: 'O1', consegnato: true, note: 'x', pagato: true }, '090002': { opz: 'O3' }, 'EXT-0001': { opz: 'O2', fonte: 'modulo' } },
  })
  const base = { tipo: 'PAN', modalita: 'SCELTA' as const, stato: 'BOZZA', titolo: 'Panettoni 2026', spostamento: { tipo: 'ANNO' as const },
    imp: { config: true, predefinita: true, sconti: true, fornitore: false, quota: true, note: false, sedi: true }, part: 'REGOLA' as const, filtro: 'scelto' as const,
    scelte: true, mappa: { O1: 'O1', O2: 'O2', O3: '' } }
  const c = L.preparaCopia(d, ini, base)
  // un evento nuovo, non archiviato, legato all'origine, con nulla di ciò che le persone hanno fatto
  assert.equal(c.base.copiatoDa, 'PAN25'); assert.equal(c.base.archiviata, false); assert.equal(c.base.stato, 'BOZZA')
  assert.deepEqual([c.base.data, c.base.scadenza, c.base.anno], ['2026-12-18', '2026-11-30', 2026])
  assert.deepEqual(c.base.opzioni.map(o => o.etichetta), ['Tradizionale', 'Cioccolato', 'Albicocca']); assert.equal(c.base.predefinita, 'O1')
  assert.deepEqual([c.base.fornitore, c.base.note], ['', ''])
  assert.deepEqual(c.base.scelte, {}); assert.deepEqual(c.base.richieste, []); assert.deepEqual(c.base.carichi, [])
  // stessa regola: gruppi, sedi e gli aggiunti
  assert.deepEqual([c.base.modoPart, c.base.gruppi, c.base.sedi, c.partecipanti], ['GRUPPI', ['SD', 'SE'], ['S2'], ['EXT-0002']])
  // scelte riportate: solo l'opzione, con la corrispondenza (Albicocca → nessuna)
  assert.deepEqual(c.scelte.sort((a, b) => a.socio.localeCompare(b.socio)), [{ socio: '090001', opz: 'O1' }, { socio: 'EXT-0001', opz: 'O2' }])
  // lista fissa e parte
  const lista = L.preparaCopia(d, ini, { ...base, part: 'LISTA' })
  assert.equal(lista.base.modoPart, 'SINGOLI'); assert.ok(lista.partecipanti.includes('EXT-0002') && lista.partecipanti.includes('090002'))
  const parte = L.preparaCopia(d, ini, { ...base, part: 'PARTE', filtro: 'consegnato' })
  assert.deepEqual(parte.partecipanti, ['090001'])
  assert.deepEqual(L.preparaCopia(d, ini, { ...base, part: 'NESSUNO' }).partecipanti, [])
  // un'altra modalità: niente configurazione, niente scelte, niente predefinita
  const ord = L.preparaCopia(d, ini, { ...base, tipo: 'VEN', modalita: 'ORDINE' })
  assert.deepEqual([ord.base.opzioni, ord.base.prodotti, ord.base.predefinita, ord.scelte], [[], [], null, []])
  // senza le opzioni non si riportano scelte
  assert.deepEqual(L.preparaCopia(d, ini, { ...base, imp: { ...base.imp, config: false } }).scelte, [])
  // campi estivi: le settimane si spostano
  const campo = evento({ id: 'CAM26', modalita: 'TURNI', quota: 18000, data: '2026-06-29', periodi: [{ id: 'W1', nome: 'Settimana 1', dal: '2026-06-29', al: '2026-07-03', posti: 30 }] })
  const cc = L.preparaCopia(d, campo, { ...base, modalita: 'TURNI', spostamento: { tipo: 'GIORNI', n: 364 }, part: 'NESSUNO' })
  assert.deepEqual([cc.base.periodi[0]!.dal, cc.base.periodi[0]!.al, cc.base.periodi[0]!.posti, cc.base.quota], ['2027-06-28', '2027-07-02', 30, 18000])
})

test('report (26.11.23): numero progressivo, anche per gruppo, senza contare totali e grassetti', () => {
  const rep = { titolo: 'x', intest: ['Sede', 'Nominativo', 'Importo'], gruppi: true, numCols: new Set([2]), bold: new Set([2]),
    righe: [['S1', 'ROSSI', '1,00'], ['S1', 'BIANCHI', '2,00'], ['S1', 'Subtotale', '3,00'], ['S2', 'VERDI', '4,00']] }
  const a = numera(rep, true)
  assert.deepEqual(a.intest, ['Sede', 'N.', 'Nominativo', 'Importo'])
  assert.deepEqual(a.righe.map(r => r[1]), [1, 2, '', 1])
  assert.deepEqual([...a.numCols!].sort(), [1, 3])
  assert.deepEqual(numera(rep, false).righe.map(r => r[1]), [1, 2, '', 3])
  const piatto = numera({ titolo: 'y', intest: ['Nominativo'], totale: true, righe: [['A'], ['B'], ['Totale']] }, true)
  assert.deepEqual(piatto.righe, [[1, 'A'], [2, 'B'], ['', 'Totale']])
  // il report vero: elenco soci con il progressivo
  const cfg = { tipo: 'soci', ini: '', sedi: [], origine: '', ordinaPer: 'nom', tessera: true, colSoci: { sede: false, id: false, nom: true }, firma: false, eta: false, numero: true, numeroPerGruppo: true } as unknown as CfgReport
  const r = costruisciReport(db(), cfg, '2026-11-23')
  assert.equal(r.intest[0], 'N.'); assert.deepEqual(r.righe.map(x => x[0]), r.righe.map((_, i) => i + 1))
  // un evento annullato lo dice nel titolo
  const stati = [...STATI_DI_BASE, { id: 'ANN', nome: 'Annullato', colore: '#DC2626', regola: 'ANNULLATO' as const, attivo: true, ordine: 9 }]
  const dA = db({ stati, iniziative: [evento({ id: 'e9', titolo: 'Gita', stato: 'ANN', modalita: 'NESSUNA' })] })
  assert.match(costruisciReport(dA, { ...cfg, tipo: 'scelte', ini: 'e9', numero: false } as CfgReport, '2026-11-23').titolo, /· ANNULLATO$/)
})

test('sede di consegna (26.11.23.1): riepiloghi, report e copia', () => {
  // Rossi (S1) e Verdi (S1) ritirano alla Sede Due; Bianchi è già in S2
  const ini = evento({ id: 'e1', modalita: 'SCELTA', gruppi: ['SD', 'SE'], opzioni: [{ id: 'O1', etichetta: 'Tradizionale' }],
    scelte: { '090001': { opz: 'O1', luogo: 'S2' }, '090002': { opz: 'O1' }, 'EXT-0001': { luogo: 'S2' } } })
  const d = db({ iniziative: [ini] })
  const r = (id: string) => d.perId.get(id)!
  assert.deepEqual(['090001', '090002', 'EXT-0001'].map(id => L.sedeConsegna(ini, r(id))), ['S2', 'S2', 'S2'])
  assert.deepEqual(['090001', '090002'].map(id => L.consegnaAltrove(ini, r(id))), [true, false])
  // il riepilogo per sede conta dove si ritira: tutti e tre alla Sede Due
  assert.deepEqual(L.riepilogo(d, ini, false).righe.map(([k, x]) => [k, x['O1'], x['__NONE']]), [['S2', 2, 1]])
  // nei campi estivi la sede di consegna non conta
  const campo = { ...ini, modalita: 'TURNI' as const }
  assert.equal(L.sedeConsegna(campo, r('090001')), 'S1')
  // ordine: quantità per sede di consegna
  const ord = evento({ id: 'e2', modalita: 'ORDINE', gruppi: ['SD'], prodotti: [{ id: 'P1', tipologia: 'TER', nome: 'Olio', prezzo: 1000, unita: 'pz', contenuto: null, contenutoUm: 'lt', max: null }],
    scelte: { '090001': { q: { P1: 2 }, luogo: 'S2' }, '090002': { q: { P1: 1 } } } })
  assert.deepEqual(L.righeOrdiniPerSede(db({ iniziative: [ord] }), ord).map(([k, x]) => [k, x.q['P1'], x.n]), [['S2', 3, 2]])

  // report «scelte per persona» raggruppato: gruppo = sede di consegna, accanto la sede di lavoro
  const cfg = { tipo: 'scelte', ini: 'e1', sedi: [], origine: '', ordinaPer: 'nom', tessera: false, colSoci: { sede: true, id: false, nom: true }, sedeScelte: true,
    pred: false, consegnato: false, firma: false, eta: false, soloMancanti: false } as unknown as CfgReport
  const rp = costruisciReport(d, cfg, '2026-11-23')
  assert.deepEqual(rp.intest, ['Sede di consegna', 'Nominativo', 'Sede di lavoro', 'Scelta'])
  assert.deepEqual(rp.righe.map(x => [x[0], x[1], x[2]]), [['Sede Due', 'BIANCHI Giulia', 'Sede Due'], ['Sede Due', 'ROSSI Luca', 'Sede Uno'], ['Sede Due', 'VERDI Carla', 'Sede Uno']])
  // senza raggruppare: la colonna è la sede di consegna; spenta, nessuna colonna
  assert.deepEqual(costruisciReport(d, { ...cfg, sedeScelte: false }, '2026-11-23').intest, ['Nominativo', 'Sede di consegna', 'Scelta'])
  assert.deepEqual(costruisciReport(d, { ...cfg, sedeScelte: false, sedeAltra: false }, '2026-11-23').intest, ['Nominativo', 'Scelta'])
  // il filtro delle sedi lavora sulla sede di consegna: in S1 non ritira nessuno
  assert.equal(costruisciReport(d, { ...cfg, sedi: ['S1'] }, '2026-11-23').righe.length, 0)
  assert.equal(costruisciReport(d, { ...cfg, tipo: 'riepilogo' }, '2026-11-23').intest[0], 'Sede di consegna')
  // senza sedi di consegna nessuna colonna in più
  const pulito = { ...ini, scelte: { '090001': { opz: 'O1' } } }
  assert.deepEqual(costruisciReport(db({ iniziative: [pulito] }), cfg, '2026-11-23').intest, ['Sede di consegna', 'Nominativo', 'Scelta'])

  // copia: come nell'evento di prima, solo per chi entra e verso una sede attiva
  const base = { tipo: 'X', modalita: 'SCELTA' as const, stato: 'BOZZA', titolo: 'Copia', spostamento: { tipo: 'NO' as const },
    imp: { config: true, predefinita: false, sconti: false, fornitore: false, quota: false, note: false, sedi: false }, part: 'LISTA' as const, filtro: 'scelto' as const, scelte: false, mappa: {} }
  const lc = L.luoghiCopia(d, ini, 'LISTA', 'scelto')
  assert.deepEqual([lc.voci.length, lc.prima, lc.fuori], [2, 2, 0])
  assert.deepEqual(L.preparaCopia(d, ini, base).scelte, [], 'di partenza: sede di lavoro di ciascuno')
  const conL = L.preparaCopia(d, ini, { ...base, luoghi: true, scelte: true, mappa: { O1: 'O1' } }).scelte.sort((a, b) => a.socio.localeCompare(b.socio))
  assert.deepEqual(conL, [{ socio: '090001', opz: 'O1', luogo: 'S2' }, { socio: '090002', opz: 'O1' }, { socio: 'EXT-0001', luogo: 'S2' }])
  // chi non entra (solo chi ha ricevuto: nessuno) e una sede disattivata non si riportano
  assert.deepEqual(L.luoghiCopia(d, ini, 'PARTE', 'consegnato').fuori, 2)
  const spenta = db({ iniziative: [ini], sedi: [{ id: 'S1', nome: 'Sede Uno', attiva: true, ordine: 1 }, { id: 'S2', nome: 'Sede Due', attiva: false, ordine: 2 }] })
  assert.deepEqual(L.luoghiCopia(spenta, ini, 'LISTA', 'scelto').voci, [])
  // verso i campi estivi le sedi di consegna non vanno
  assert.deepEqual(L.preparaCopia(d, ini, { ...base, modalita: 'TURNI', luoghi: true }).scelte, [])
})

// ── Confezioni (26.11.25) ────────────────────────────────────
test('confezioni: il minimo di confezioni, e il resto quando non si compone', () => {
  assert.deepEqual(L.componi(3, [1, 2]), { n: [1, 1], resto: 0 })
  assert.deepEqual(L.componi(16, [1, 2]), { n: [0, 8], resto: 0 })
  assert.deepEqual(L.componi(5, [1, 2]), { n: [1, 2], resto: 0 })
  assert.deepEqual(L.componi(7, [2, 5]), { n: [1, 1], resto: 0 })
  assert.deepEqual(L.componi(3, [2, 5]), { n: [1, 0], resto: 1 })
  assert.deepEqual(L.componi(1, [2, 5]), { n: [0, 0], resto: 1 })
  assert.deepEqual(L.componi(1.5, [0.5, 1]), { n: [1, 1], resto: 0 })
  // quantità enormi: si arriva comunque al conto giusto
  const g = L.componi(50_000, [1, 2])
  assert.equal(g.n[0]! + g.n[1]! * 2, 50_000); assert.equal(g.resto, 0)
})

test('confezioni: automatiche, a mano, colonne per formato e somma per sede', () => {
  const ca = { id: 'CA', tipologia: 'TER', nome: 'Castagne', prezzo: 400, unita: 'kg' as const, contenuto: null, contenutoUm: 'kg' as const, max: null,
    confezioni: [{ id: 'F1', tipo: 'SAC', q: 1 }, { id: 'F2', tipo: 'SAC', q: 2 }] }
  const pt = { ...ca, id: 'PT', nome: 'Patate', prezzo: 100, confezioni: [{ id: 'G2', tipo: 'SAC', q: 2 }] }
  const ol = { ...ca, id: 'OL', nome: 'Olio', unita: 'pz' as const, confezioni: [] }
  const ini = evento({ modalita: 'ORDINE', gruppi: ['SD'], prodotti: [ca, pt, ol], scelte: {
    '090001': { q: { CA: 5, PT: 3, OL: 1 } },
    '090002': { q: { CA: 4 }, conf: { CA: { F1: 4 } } },
  } })
  const d = db({ confezioni: [{ id: 'SAC', nome: 'Sacco', attiva: true, ordine: 1 }] })
  const a = L.confezioniDi(ini, '090001', ca)!
  assert.deepEqual(a, { n: { F1: 1, F2: 2 }, resto: 0, mano: false })
  assert.equal(L.breveConfezioni(ca, a), '1×1 kg + 2×2 kg')
  assert.deepEqual(L.confezioniDi(ini, '090002', ca), { n: { F1: 4, F2: 0 }, resto: 0, mano: true })
  assert.deepEqual(L.confezioniDi(ini, '090001', pt), { n: { G2: 1 }, resto: 1, mano: false })
  assert.equal(L.testoConfezioni(d, pt, L.confezioniDi(ini, '090001', pt)!), '1 × Sacco 2 kg + 1 kg non confezionabili')
  assert.equal(L.confezioniDi(ini, '090001', ol), null)
  assert.equal(L.confezioniDi(ini, '090002', pt), null)
  // a cassetta niente confezioni, anche se la config le avesse
  assert.deepEqual(L.formati({ ...ca, unita: 'cas' }), [])
  const ids = ['090001', '090002']
  const cols = L.colonneOrdine(ini, ids)
  assert.deepEqual(cols.map(c => `${c.p.id}${c.f ? ':' + c.f.id : c.resto ? ':R' : ''}`), ['CA', 'CA:F1', 'CA:F2', 'PT', 'PT:G2', 'PT:R', 'OL'])
  assert.deepEqual(cols.map(c => L.valoreColonna(ini, ids, c)), [9, 5, 2, 3, 1, 1, 1])
  assert.deepEqual(cols.map(c => L.sottoColonna(d, c)), ['totale kg', 'Sacco 1 kg', 'Sacco 2 kg', 'totale kg', 'Sacco 2 kg', 'non confezionato', ''])
  assert.equal(L.cellaColonna(ini, ids, cols[5]!), '1 kg')
  assert.equal(L.contaConfezioni(d, 'SAC', 26), '26 sacchi'); assert.equal(L.contaConfezioni(d, 'SAC', 1), '1 sacco')
  assert.equal(L.contaConfezioni({ confezioni: [{ id: 'RET', nome: 'Rete', attiva: true, ordine: 1 }] }, 'RET', 3), '3 × Rete')
  // le righe per sede sanno chi ha ordinato: le confezioni si sommano per sede di consegna
  const righe = L.righeOrdiniPerSede(d, ini)
  assert.deepEqual(righe.map(([k, r]) => [k, r.ids]), [['S1', ['090001']], ['S2', ['090002']]])
  assert.equal(L.valoreColonna(ini, righe[1]![1].ids, cols[1]!), 4)
})

test('confezioni nei report: ordine al fornitore, per sede e per persona', () => {
  const ca = { id: 'CA', tipologia: 'TER', nome: 'Castagne', prezzo: 400, unita: 'kg' as const, contenuto: null, contenutoUm: 'kg' as const, max: null,
    confezioni: [{ id: 'F1', tipo: 'SAC', q: 1 }, { id: 'F2', tipo: 'SAC', q: 2 }] }
  const ini = evento({ id: 'ev', modalita: 'ORDINE', gruppi: ['SD'], prodotti: [ca], scelte: { '090001': { q: { CA: 5 } }, '090002': { q: { CA: 4 }, conf: { CA: { F1: 4 } } } } })
  const d = db({ iniziative: [ini], confezioni: [{ id: 'SAC', nome: 'Sacco', attiva: true, ordine: 1 }] })
  const cfg: CfgReport = {
    tipo: 'fornitore', ini: 'ev', sedi: [], origine: '', pred: true, tessera: false, consegnato: false, pagato: false, note: false, firma: false,
    colSoci: { sede: true, id: false, nom: true }, sedeScelte: false, ordinaPer: 'nom', paginaPerSede: false, soloMancanti: false, inclusiVuoti: false,
    soloDaPagare: false, soloSaldo: false, includiTolte: false, presenze: false, aCarico: false, perRif: false, eta: false, anno: 2026, qmodo: '', mesi: false, statoRic: '',
  }
  // ordine al fornitore: il prodotto col totale e sotto una riga per formato
  const f = costruisciReport(d, cfg, '2026-11-25')
  assert.deepEqual(f.righe.slice(0, 3).map(r => [r[1], r[3], r[5]]), [['Castagne', '9 kg', ''], ['↳ Sacco 1 kg', '5 sacchi', '5 kg'], ['↳ Sacco 2 kg', '2 sacchi', '4 kg']])
  // per sede: totale e formati
  const r = costruisciReport(d, { ...cfg, tipo: 'riepilogo' }, '2026-11-25')
  assert.deepEqual(r.intest, ['Sede di consegna', 'Ordini', 'Terra · Castagne · totale kg', 'Terra · Castagne · Sacco 1 kg', 'Terra · Castagne · Sacco 2 kg', 'Importo €'])
  assert.deepEqual(r.righe.at(-1), ['Totale complessivo', 2, '9', '5', '2', '36,00'])
  // per persona: le stesse colonne, una riga a testa e il totale
  const p = costruisciReport(d, { ...cfg, tipo: 'scelte' }, '2026-11-25')
  assert.deepEqual(p.righe.map(x => x.slice(0, 5)), [['BIANCHI Giulia', '4', '4', '', '16,00'], ['ROSSI Luca', '5', '1', '2', '20,00'], ['Totale', '9', '5', '2', '36,00']])
  // raggruppato per sede di consegna: il totale di ogni sede
  const g = costruisciReport(d, { ...cfg, tipo: 'scelte', sedeScelte: true }, '2026-11-25')
  assert.deepEqual(g.righe.map(x => x.slice(0, 5)), [['Sede Uno', 'ROSSI Luca', '5', '1', '2'], ['Sede Uno', 'Totale sede', '5', '1', '2'], ['Sede Due', 'BIANCHI Giulia', '4', '4', ''], ['Sede Due', 'Totale sede', '4', '4', '']])
})

test('report: il PDF si genera con e senza griglia (26.11.25.2)', async () => {
  const { creaPdf } = await import('./report.ts')
  const rep = { titolo: 'Prova', intest: ['Sede', 'Nominativo', 'Castagne', 'Firma per ritiro'], sopra: ['', '', 'Terra', ''], gruppi: true, righe: [['S1', 'ROSSI Luca', '5', ''], ['S1', 'Totale sede', '5', '']], bold: new Set([1]) }
  for (const griglia of [false, true]) {
    const b = await creaPdf(rep, { firma: true, paginaPerSede: false, griglia }, 'prova', '2026-11-25')
    assert.ok(b.size > 1000)
  }
})
