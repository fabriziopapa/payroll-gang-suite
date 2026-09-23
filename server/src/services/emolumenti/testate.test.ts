// Dati SINTETICI: matricole 09xxxx.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contiDaTestate, normalizzaTestate, type TestataNorm } from './testate.js'

const T = (matricola: string, progrLiquidazione: string | null, nazIban: string | null): TestataNorm =>
  ({ matricola, progrLiquidazione, nazIban })

test("le '000' non classificano nessuno", () => {
  const r = contiDaTestate([T('090001', '001', 'IT'), T('090001', '000', null)])
  assert.deepEqual(r.conti, [{ matricola: '090001', nazIban: 'IT', area: 'IT', motivo: null, progressivi: '000,001' }])
})

test("chi compare solo fra le '000' resta, da chiarire", () => {
  const r = contiDaTestate([T('090002', '000', null)])
  assert.equal(r.conti[0]!.motivo, 'senza coordinata')
  assert.equal(r.conti[0]!.area, null)
})

test('due testate liquidate concordi: una riga, progressivi tracciati', () => {
  const r = contiDaTestate([T('090003', '039', 'LT'), T('090003', '001', 'LT')])
  assert.deepEqual(r.conti, [{ matricola: '090003', nazIban: 'LT', area: 'SEPA', motivo: null, progressivi: '001,039' }])
})

test('due testate liquidate discordi: da chiarire, non si sceglie la prima', () => {
  const r = contiDaTestate([T('090004', '001', 'IT'), T('090004', '039', 'BE')])
  assert.equal(r.conti[0]!.motivo, 'coordinate discordanti')
})

test('liquidata senza nazione: da chiarire, anche se un\'altra ce l\'ha', () => {
  const r = contiDaTestate([T('090005', '001', 'IT'), T('090005', '039', null)])
  assert.equal(r.conti[0]!.motivo, 'nazione assente')
})

test('progressivo mancante o malformato: da chiarire', () => {
  assert.equal(contiDaTestate([T('090006', null, 'IT')]).conti[0]!.motivo, 'progressivo assente')
  assert.equal(contiDaTestate([T('090007', '1', 'IT')]).conti[0]!.motivo, 'progressivo assente')
})

test('i tre gruppi e i conteggi', () => {
  const r = contiDaTestate([
    T('090010', '001', 'IT'), T('090011', '001', 'BE'), T('090012', '001', 'US'), T('090013', '000', null),
  ])
  assert.deepEqual(r.conti.map(c => c.area), ['IT', 'SEPA', 'EXTRA_UE', null])
  assert.equal(r.testateLette, 4)
  assert.equal(r.testateLiquide, 3)
})

// ── normalizzazione: cio' che sopravvive della risposta CSA ──
test('normalizzaTestate: restano tre campi, il resto non esiste piu\'', () => {
  const grezza = [{
    matricola: '90020', progrLiquidazione: '001', nazIban: 'it',
    iban: 'IT00X0000000000000000000000', intestazione: 'ROSSI ANNA', abi: '00000', cab: '00000',
  }]
  const n = normalizzaTestate(grezza)
  assert.deepEqual(n, [{ matricola: '090020', progrLiquidazione: '001', nazIban: 'IT' }])
  assert.deepEqual(Object.keys(n[0]!).sort(), ['matricola', 'nazIban', 'progrLiquidazione'])
})

test('normalizzaTestate: risposta non a elenco -> null (nessun dato riportato)', () => {
  assert.equal(normalizzaTestate({ iban: 'IT00X' }), null)
})
