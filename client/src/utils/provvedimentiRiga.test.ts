// Test della logica dei provvedimenti per riga (area Emolumenti).
// Dati SINTETICI: nessun nominativo, matricola o numero reale.
// Si lanciano con:  npm test --workspace=client

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  accodaProvv, assegnaMese, completaDate, letteraProvv, mesiDelProvv,
  normalizzaProvv, nuovoProvv, problemiProvv, provvDaPayload, provvDelMese,
  provvSuccessivo, rimuoviProvv, togliMesi, type RigaControllo,
  numeriCondivisi, confermaVale, nuovaConferma, potaConferme, leggiConferme,
  dateAnomale, potaDate, leggiDateConfermate, problemiDate,
} from './provvedimentiRiga.ts'

function riga(over: Partial<RigaControllo> = {}): RigaControllo {
  return {
    nominativo:    'Rossi Mario',
    matricola:     '900001',
    provvedimenti: [{ id: 0, numero: '', data: '' }],
    provvPerMese:  {},
    mesiScelti:    new Set(),
    ...over,
  }
}

test('lettere dei provvedimenti', () => {
  assert.equal(letteraProvv(0), 'A')
  assert.equal(letteraProvv(1), 'B')
  assert.equal(letteraProvv(25), 'Z')
  assert.equal(letteraProvv(26), 'AA')
})

test('il caso dell\'ufficio: agosto su un provvedimento, settembre e ottobre su un altro', () => {
  // Prima riga incollata: "Rossi Mario 111111 14/09/2026", poi si sceglie agosto.
  let r = accodaProvv(riga(), '111111', '2026-09-14').riga
  r = assegnaMese(r, '2026-08', 0).riga

  // Stesso nominativo incollato con un altro numero: NON sparisce, si aggiunge.
  const acc = accodaProvv(r, '222222', '2026-10-01')
  assert.equal(acc.esito, 'aggiunto')
  r = acc.riga
  assert.equal(r.provvedimenti.length, 2)
  const b = r.provvedimenti[1]!

  r = assegnaMese(r, '2026-09', b.id).riga
  r = assegnaMese(r, '2026-10', b.id).riga

  assert.deepEqual(provvDelMese(r, '2026-08'), { id: 0, numero: '111111', data: '2026-09-14' })
  assert.equal(provvDelMese(r, '2026-09')?.numero, '222222')
  assert.equal(provvDelMese(r, '2026-10')?.data, '2026-10-01')
  assert.deepEqual(mesiDelProvv(r, b.id), ['2026-09', '2026-10'])
  assert.deepEqual(problemiProvv([r]), [])
})

test('clic sul mese: aggiunge, sposta sul provvedimento attivo, toglie', () => {
  let r = riga({ provvedimenti: [{ id: 0, numero: '1', data: '2026-01-01' }, { id: 1, numero: '2', data: '2026-01-02' }] })
  let x = assegnaMese(r, '2026-08', 0); assert.equal(x.esito, 'aggiunto'); r = x.riga
  x = assegnaMese(r, '2026-08', 1);     assert.equal(x.esito, 'spostato'); r = x.riga
  assert.equal(provvDelMese(r, '2026-08')?.id, 1)
  x = assegnaMese(r, '2026-08', 1);     assert.equal(x.esito, 'tolto');    r = x.riga
  assert.equal(r.mesiScelti.has('2026-08'), false)
  assert.equal('2026-08' in r.provvPerMese, false)
  x = assegnaMese(r, '2026-08', 99);    assert.equal(x.esito, 'invariato')
})

test('con un provvedimento solo il clic e\' quello di sempre', () => {
  let r = riga({ provvedimenti: [{ id: 0, numero: '1', data: '2026-01-01' }] })
  r = assegnaMese(r, '2026-03', 0).riga
  assert.equal(r.mesiScelti.has('2026-03'), true)
  r = assegnaMese(r, '2026-03', 0).riga
  assert.equal(r.mesiScelti.has('2026-03'), false)
})

test('la lettera sotto il mese lo passa al provvedimento successivo, in giro', () => {
  let r = riga({ provvedimenti: [{ id: 0, numero: '1', data: 'x' }, { id: 5, numero: '2', data: 'y' }] })
  r = assegnaMese(r, '2026-08', 0).riga
  r = provvSuccessivo(r, '2026-08'); assert.equal(r.provvPerMese['2026-08'], 5)
  r = provvSuccessivo(r, '2026-08'); assert.equal(r.provvPerMese['2026-08'], 0)
})

test('incollato: stesso numero, data diversa, provvedimento vuoto, numero assente', () => {
  const base = riga({ provvedimenti: [{ id: 0, numero: '111111', data: '2026-09-14' }] })
  assert.equal(accodaProvv(base, '111111', '').esito, 'gia-presente')
  assert.equal(accodaProvv(base, '111111', '2026-09-14').esito, 'gia-presente')
  assert.equal(accodaProvv(base, '111111', '2026-09-15').esito, 'data-diversa')
  assert.equal(accodaProvv(base, '', '2026-09-15').esito, 'senza-numero')

  const senzaData = riga({ provvedimenti: [{ id: 0, numero: '111111', data: '' }] })
  const c = accodaProvv(senzaData, '111111', '2026-09-20')
  assert.equal(c.esito, 'completato')
  assert.equal(c.riga.provvedimenti[0]!.data, '2026-09-20')

  // Riga aggiunta dalla ricerca, ancora senza numero: si riempie, non si affianca.
  const vuota = accodaProvv(riga(), '333333', '', '2026-10-05')
  assert.equal(vuota.esito, 'completato')
  assert.deepEqual(vuota.riga.provvedimenti, [{ id: 0, numero: '333333', data: '2026-10-05' }])

  // La data predefinita non rende "diverso" un numero gia' presente.
  assert.equal(accodaProvv(base, '111111', '', '2026-01-01').esito, 'gia-presente')
})

test('salvataggi v2: un provvedimento per riga, tutti i mesi suoi', () => {
  const o = { numeroProvvedimento: '900008', dataProvvedimento: '2026-09-04' }
  const p = provvDaPayload(o, ['2026-08', '2026-09'])
  assert.deepEqual(p.provvedimenti, [{ id: 0, numero: '900008', data: '2026-09-04' }])
  assert.deepEqual(p.provvPerMese, { '2026-08': 0, '2026-09': 0 })
})

test('salvataggi v3: andata e ritorno dal JSON', () => {
  let r = riga({ provvedimenti: [{ id: 0, numero: '1', data: '2026-09-14' }, { id: 3, numero: '2', data: '2026-10-01' }] })
  r = assegnaMese(r, '2026-08', 0).riga
  r = assegnaMese(r, '2026-09', 3).riga
  const json = JSON.parse(JSON.stringify({ ...r, mesiScelti: [...r.mesiScelti] })) as Record<string, unknown>
  const p = provvDaPayload(json, ['2026-08', '2026-09'])
  assert.deepEqual(p.provvedimenti, r.provvedimenti)
  assert.deepEqual(p.provvPerMese, r.provvPerMese)
})

test('salvataggio rovinato: id doppi e mesi senza provvedimento', () => {
  const p = provvDaPayload({
    provvedimenti: [{ id: 1, numero: 'a', data: 'x' }, { id: 1, numero: 'b', data: 'y' }],
    provvPerMese:  { '2026-08': 1 },
  }, ['2026-08'])
  assert.deepEqual(p.provvedimenti.map(x => x.id), [0, 1])
  const r = normalizzaProvv(riga({ ...p, mesiScelti: new Set(['2026-08']) }))
  // Con due provvedimenti non si indovina: il mese resta senza, e l'export si ferma.
  assert.equal(provvDelMese(r, '2026-08'), null)
  assert.ok(problemiProvv([r]).some(m => m.startsWith('Mesi senza provvedimento')))

  // Con uno solo invece la risposta e' una sola.
  const uno = normalizzaProvv(riga({
    provvedimenti: [{ id: 7, numero: 'a', data: 'x' }], provvPerMese: { '2026-08': 99 }, mesiScelti: new Set(['2026-08']),
  }))
  assert.equal(uno.provvPerMese['2026-08'], 7)
  assert.equal(normalizzaProvv(riga({ provvedimenti: [] })).provvedimenti.length, 1)
})

test('togliere un provvedimento: mai l\'ultimo, mai con dei mesi', () => {
  let r = riga({ provvedimenti: [{ id: 0, numero: '1', data: 'x' }] })
  assert.equal(rimuoviProvv(r, 0).provvedimenti.length, 1)
  const n = nuovoProvv(r, '2026-10-01')
  r = n.riga
  assert.deepEqual(r.provvedimenti[1], { id: 1, numero: '', data: '2026-10-01' })
  r = assegnaMese(r, '2026-09', 1).riga
  assert.equal(rimuoviProvv(r, 1).provvedimenti.length, 2)
  r = assegnaMese(r, '2026-09', 1).riga   // tolto il mese
  assert.equal(rimuoviProvv(r, 1).provvedimenti.length, 1)
})

test('"a tutte" compila solo le date vuote', () => {
  const r = riga({ provvedimenti: [{ id: 0, numero: '1', data: '2026-09-14' }, { id: 1, numero: '2', data: '' }] })
  const c = completaDate(r, '2026-10-10')
  assert.deepEqual(c.provvedimenti.map(p => p.data), ['2026-09-14', '2026-10-10'])
  assert.equal(completaDate(r, ''), r)
})

test('mesi gia\' in CSA tolti: sparisce anche la loro assegnazione', () => {
  let r = riga({ provvedimenti: [{ id: 0, numero: '1', data: 'x' }] })
  r = assegnaMese(assegnaMese(r, '2026-08', 0).riga, '2026-09', 0).riga
  r = togliMesi(r, new Set(['2026-08']))
  assert.deepEqual([...r.mesiScelti], ['2026-09'])
  assert.deepEqual(r.provvPerMese, { '2026-09': 0 })
})

test('controlli bloccanti', () => {
  // Riga senza mesi: non va nel CSV, non si controlla.
  assert.deepEqual(problemiProvv([riga()]), [])

  // Numero e data mancanti, con la lettera quando i provvedimenti sono piu' d'uno.
  let r = riga({ provvedimenti: [{ id: 0, numero: '', data: '' }, { id: 1, numero: '5', data: '2026-01-01' }] })
  r = assegnaMese(assegnaMese(r, '2026-08', 0).riga, '2026-09', 1).riga
  const p = problemiProvv([r])
  assert.ok(p.some(m => m.includes('Data provvedimento mancante') && m.includes('Rossi Mario (A)')))
  assert.ok(p.some(m => m.includes('Numero provvedimento mancante') && m.includes('Rossi Mario (A)')))

  // Provvedimento senza mesi accanto a uno con mesi.
  let s = riga({ provvedimenti: [{ id: 0, numero: '1', data: 'x' }, { id: 1, numero: '2', data: 'y' }] })
  s = assegnaMese(s, '2026-08', 0).riga
  assert.ok(problemiProvv([s]).some(m => m.startsWith('Provvedimento senza mesi') && m.includes('(B)')))

  // Stesso numero due volte sulla stessa persona.
  let t = riga({ provvedimenti: [{ id: 0, numero: '7', data: 'x' }, { id: 1, numero: '7', data: 'y' }] })
  t = assegnaMese(assegnaMese(t, '2026-08', 0).riga, '2026-09', 1).riga
  assert.ok(problemiProvv([t]).some(m => m.startsWith('Stesso numero di provvedimento ripetuto')))

  // Stesso numero su due matricole: errore come prima.
  const u = assegnaMese(riga({ provvedimenti: [{ id: 0, numero: '9', data: 'x' }] }), '2026-08', 0).riga
  const v = { ...u, nominativo: 'Bianchi Anna', matricola: '900002' }
  assert.ok(problemiProvv([u, v]).some(m => m.includes('usato su più matricole')))
})

// ── Stesso numero su piu' persone: blocco con conferma esplicita ─────────

/** Una persona con un provvedimento e un mese scelto. */
function persona(nominativo: string, matricola: string, numero: string, data: string, mese = '2026-08'): RigaControllo {
  return assegnaMese(riga({ nominativo, matricola, provvedimenti: [{ id: 0, numero, data }] }), mese, 0).riga
}

test('stesso numero su due persone: bloccante finche\' non si conferma', () => {
  const a = persona('Rossi Mario', '900001', '777', '2026-10-05')
  const b = persona('Bianchi Anna', '900002', '777', '2026-10-05')
  const [c] = numeriCondivisi([a, b])
  assert.deepEqual(c?.matricole, ['900001', '900002'])
  assert.deepEqual(c?.date, ['2026-10-05'])

  assert.ok(problemiProvv([a, b]).some(m => m.includes('usato su più matricole')))
  const conferme = { '777': nuovaConferma(c!, '2026-10-10T20:00:00Z') }
  assert.deepEqual(problemiProvv([a, b], conferme), [])
})

test('la conferma decade se cambia l\'insieme delle matricole o la data', () => {
  const a = persona('Rossi Mario', '900001', '777', '2026-10-05')
  const b = persona('Bianchi Anna', '900002', '777', '2026-10-05')
  const conf = nuovaConferma(numeriCondivisi([a, b])[0]!)

  // Una terza persona con lo stesso numero.
  const t = persona('Verdi Luca', '900003', '777', '2026-10-05')
  const c3 = numeriCondivisi([a, b, t])[0]!
  assert.equal(confermaVale(c3, conf), false)
  assert.ok(problemiProvv([a, b, t], { '777': conf }).some(m => m.includes('usato su più matricole')))

  // La stessa data cambiata su entrambe: e' un altro atto, si riconferma.
  const a2 = { ...a, provvedimenti: [{ id: 0, numero: '777', data: '2026-10-06' }] }
  const b2 = { ...b, provvedimenti: [{ id: 0, numero: '777', data: '2026-10-06' }] }
  assert.equal(confermaVale(numeriCondivisi([a2, b2])[0]!, conf), false)
})

test('stesso numero con date diverse: non confermabile', () => {
  const a = persona('Rossi Mario', '900001', '777', '2026-10-05')
  const b = persona('Bianchi Anna', '900002', '777', '2026-05-10')
  const c = numeriCondivisi([a, b])[0]!
  const finta = { matricole: ['900001', '900002'], data: '2026-10-05', il: '' }
  assert.equal(confermaVale(c, finta), false)
  const p = problemiProvv([a, b], { '777': finta })
  assert.ok(p.some(m => m.includes('con date diverse') && m.includes('05/10/2026') && m.includes('10/05/2026')))
})

test('righe senza mesi e provvedimenti senza mesi non contano', () => {
  const a = persona('Rossi Mario', '900001', '777', '2026-10-05')
  const b = riga({ nominativo: 'Bianchi Anna', matricola: '900002', provvedimenti: [{ id: 0, numero: '777', data: '2026-10-05' }] })
  assert.deepEqual(numeriCondivisi([a, b]), [])
  // Stessa persona su due provvedimenti con lo stesso numero: e' un altro controllo.
  assert.deepEqual(numeriCondivisi([a]), [])
})

test('pota: via le conferme che non combaciano piu\', stesso oggetto se niente cambia', () => {
  const a = persona('Rossi Mario', '900001', '777', '2026-10-05')
  const b = persona('Bianchi Anna', '900002', '777', '2026-10-05')
  const cond = numeriCondivisi([a, b])
  const valide = { '777': nuovaConferma(cond[0]!) }
  assert.equal(potaConferme(valide, cond), valide)

  const conVecchia = { ...valide, '888': { matricole: ['900001', '900009'], data: '', il: '' } }
  assert.deepEqual(Object.keys(potaConferme(conVecchia, cond)), ['777'])
  // Refuso corretto: il numero non e' piu' condiviso, la conferma se ne va.
  assert.deepEqual(potaConferme(valide, []), {})
})

test('conferme lette da un salvataggio: difensive', () => {
  assert.deepEqual(leggiConferme(null), {})
  assert.deepEqual(leggiConferme([1, 2]), {})
  assert.deepEqual(leggiConferme({ a: 'x', b: { matricole: 'no' } }), {})
  assert.deepEqual(
    leggiConferme({ '777': { matricole: ['900002', 900001], data: '2026-10-05', il: 'ieri' } }),
    { '777': { matricole: ['900002', '900001'], data: '2026-10-05', il: 'ieri' } },
  )
})

// ── Date dei provvedimenti da verificare ────────────────────────────────

const OGGI = '2026-10-10'

/** Il caso di ottobre: tante date di inizio ottobre e una "10/05" letta come 10 maggio. */
function lavorazioneOttobre(): RigaControllo[] {
  return [
    persona('A', '900001', '101', '2026-09-14'),
    persona('B', '900002', '102', '2026-10-02'),
    persona('C', '900003', '103', '2026-10-05'),
    persona('D', '900004', '104', '2026-10-06'),
    persona('E', '900005', '105', '2026-05-10'),
  ]
}

test('data lontana dalle altre: bloccante, con la proposta giorno/mese scambiati', () => {
  const an = dateAnomale(lavorazioneOttobre(), OGGI)
  assert.equal(an.length, 1)
  const a = an[0]!
  assert.equal(a.matricola, '900005')
  assert.equal(a.motivo, 'lontana')
  assert.equal(a.proposta, '2026-10-05')
  assert.equal(a.riferimento, '2026-10-02')
  assert.equal(a.chiave, '900005|105|2026-05-10')
  const p = problemiDate(an, {})
  assert.equal(p.length, 1)
  assert.ok(p[0]!.includes('10/05/2026') && p[0]!.includes('forse 05/10/2026?'))
  // 14/09 e' a 18 giorni dalla mediana: normale.
  assert.ok(!an.some(x => x.matricola === '900001'))
})

test('data confermata: sblocca solo quella data di quell\'atto', () => {
  const an = dateAnomale(lavorazioneOttobre(), OGGI)
  const conf = { [an[0]!.chiave]: '2026-10-10T20:00:00Z' }
  assert.deepEqual(problemiDate(an, conf), [])
  // Data corretta: non e' piu' anomala, la conferma si pota.
  const corrette = lavorazioneOttobre().map(r => r.matricola === '900005'
    ? { ...r, provvedimenti: [{ id: 0, numero: '105', data: '2026-10-05' }] } : r)
  const an2 = dateAnomale(corrette, OGGI)
  assert.deepEqual(an2, [])
  assert.deepEqual(potaDate(conf, an2), {})
  assert.equal(potaDate(conf, an), conf)
})

test('data futura: bloccante anche con poche date', () => {
  const an = dateAnomale([persona('A', '900001', '101', '2026-12-01')], OGGI)
  assert.equal(an.length, 1)
  assert.equal(an[0]!.motivo, 'futura')
  assert.equal(an[0]!.distanza, 52)
  // 2026-12-01 scambiata e' 2026-01-12: non futura, nessuna mediana -> proposta.
  assert.equal(an[0]!.proposta, '2026-01-12')
})

test('con meno di tre date non c\'e\' riferimento: nessuna data "lontana"', () => {
  const r = [persona('A', '900001', '101', '2026-01-10'), persona('B', '900002', '102', '2026-10-01')]
  assert.deepEqual(dateAnomale(r, OGGI), [])
})

test('niente proposta se lo scambio non e\' una data o resta lontana', () => {
  const base = lavorazioneOttobre().slice(0, 4)
  // 25/05 -> mese 25: non esiste.
  const a = dateAnomale([...base, persona('E', '900005', '105', '2026-05-25')], OGGI)[0]!
  assert.equal(a.proposta, null)
  // 03/03: scambiata e' uguale, niente proposta.
  const b = dateAnomale([...base, persona('E', '900005', '105', '2026-03-03')], OGGI)[0]!
  assert.equal(b.proposta, null)
})

test('date confermate lette da un salvataggio: difensive', () => {
  assert.deepEqual(leggiDateConfermate(null), {})
  assert.deepEqual(leggiDateConfermate({ a: 1, 'x|1|2026-05-10': 'ieri' }), { 'x|1|2026-05-10': 'ieri' })
})
