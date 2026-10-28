// Test delle regole del modulo CRAL lato client (conti, sconti, turni, magazzino, quote).
// Dati SINTETICI: nomi inventati, matricole 09xxxx, nessun codice fiscale.
// Si lanciano con:  npm test --workspace=client

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Db, Iniziativa, Persona } from './tipi.ts'
import {
  agganciaPersona, applicaSconto, codaRichieste, contiMagazzino, contiOrdine, destinatari, dovutoTurni, eta, importoRichiesta, leggiData,
  nettoSocio, parseEuro, quotaDi, rataMese, rifDi, risolvi, riepilogo, simNome, spezzaNominativo, tenutoQuota, tesseraRiammissione, versatoQuota,
} from './logica.ts'
import { costruisciReport, testoPdf, type CfgReport } from './report.ts'

const P = (id: string, tipo: Persona['tipo'], cognome: string, nome: string, over: Partial<Persona> = {}): Persona => ({
  id, tipo, origine: /^\d/.test(id) ? 'PGS' : 'EST', matricola: /^\d/.test(id) ? id : null, cognome, nome, nascita: null, email: '', sede: 'S1',
  tessera: '', riammissioni: 0, stato: 'ATTIVO', iscrittoIl: '2020-01-10', cessatoIl: null, provenienza: null, atipico: false, note: '',
  creatoDa: null, creatoIl: '2020-01-10', validatoDa: null, validatoIl: null, modificatoDa: null, modificatoIl: null, legami: [], storicoTessere: [], ...over,
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
  tessera: { formato: 'NUM', prefisso: 'CRAL-', cifre: 4, prossimo: 5, riammissione: 'NUOVO', sepSuffisso: '/', cifreSuffisso: 2 },
  extProssimo: 3, famProssimo: 4, soci: SOCI, perId: new Map(SOCI.map(s => [s.id, s])), iniziative: [],
  quoteAnno: [{ anno: 2026, importo: 6000 }], quote: {}, ...over,
})
const evento = (over: Partial<Iniziativa>): Iniziativa => ({
  id: 'e1', tipo: 'X', titolo: 'Prova', anno: 2026, data: '2026-07-01', scadenza: null, stato: 'APERTA', modalita: 'SCELTA', modoPart: 'GRUPPI',
  gruppi: ['SD', 'SE'], sedi: [], predefinita: null, fornitore: '', pagamento: '', note: '', quota: 0, opzioni: [], prodotti: [], periodi: [], articoli: [],
  sconti: {}, archiviata: false, archiviataDa: null, archiviataIl: null, partecipanti: [], scelte: {}, carichi: [], richieste: [], ...over,
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
  const d = db({ soci: [...SOCI, nov], perId: new Map([...SOCI, nov].map(s => [s.id, s])), quote: { '2026': { '090001': { modo: 'MENSILE', mesi: [true, true, ...Array<boolean>(10).fill(false)], pagataIl: null, note: '' } } } })
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
  assert.equal(agganciaPersona(SOCI, '90002', '', '')[0]?.id, '090002')
  assert.equal(agganciaPersona(SOCI, '0003', '', '')[0]?.id, 'EXT-0001') // tessera
  assert.equal(agganciaPersona(SOCI, '', '', 'carla verdi')[0]?.id, 'EXT-0001')
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
  assert.deepEqual(r.intest, ['Sede', 'Tessera', 'Nominativo'])
  assert.deepEqual(r.righe.map(x => x[2]), ['ROSSI Luca', 'VERDI Carla', 'BIANCHI Giulia'])
  const e = costruisciReport(db(), { ...cfg, eta: true }, '2026-10-28')
  assert.equal(e.righe[0]?.[3], 46)
  assert.equal(testoPdf('−10% → ok ●'), '-10% -> ok *')
})
