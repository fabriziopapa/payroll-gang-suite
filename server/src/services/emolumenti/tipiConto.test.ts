// Dati SINTETICI: matricole 09xxxx.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contiDaTestate, type TestataNorm } from './testate.js'
import { righeDaConti, ultimoGiornoMese, fileTxt } from './tipiConto.js'

const T = (matricola: string, progrLiquidazione: string | null, nazIban: string | null): TestataNorm =>
  ({ matricola, progrLiquidazione, nazIban })

test('dai conti CSA alle righe: area = tipo, senza area = DA CHIARIRE', () => {
  const r = righeDaConti(contiDaTestate([
    T('090003', '001', 'IT'),
    T('090001', '001', 'DE'),
    T('090002', '001', 'US'),
    T('090004', '000', null),
  ]).conti)
  assert.deepEqual(r.map(x => [x.matricola, x.tipoConto, x.nazIban, x.motivo]), [
    ['090001', 'SEPA', 'DE', null],
    ['090002', 'EXTRA_UE', 'US', null],
    ['090003', 'IT', 'IT', null],
    ['090004', 'DA_CHIARIRE', null, 'senza coordinata'],
  ])
})

test('progressivi troppo lunghi si troncano entro 40 caratteri', () => {
  const lunghi = Array.from({ length: 15 }, (_, i) => String(i + 1).padStart(3, '0')).join(',')
  const [r] = righeDaConti([{ matricola: '090005', nazIban: 'IT', area: 'IT', motivo: null, progressivi: lunghi }])
  assert.ok(r!.progressivi.length <= 40)
  assert.ok(r!.progressivi.endsWith('…'))
})

test('ultimo giorno del mese, anche bisestile', () => {
  assert.equal(ultimoGiornoMese(2026, 9), '2026-09-30')
  assert.equal(ultimoGiornoMese(2028, 2), '2028-02-29')
  assert.equal(ultimoGiornoMese(2026, 12), '2026-12-31')
})

test('TXT: nome, ordine crescente, CRLF, niente BOM, solo il tipo chiesto', () => {
  const righe = [
    { matricola: '090009', tipoConto: 'IT' },
    { matricola: '090001', tipoConto: 'IT' },
    { matricola: '090005', tipoConto: 'SEPA' },
    { matricola: '090007', tipoConto: 'DA_CHIARIRE' },
  ]
  const f = fileTxt({ ruolo: 'DR', anno: 2026, mese: 9 }, righe, 'IT')
  assert.deepEqual(f, { nomeFile: 'DR_09_26_ITA.txt', contenuto: '090001\r\n090009\r\n', righe: 2 })
  assert.ok(!f!.contenuto.startsWith('﻿'))
  assert.equal(fileTxt({ ruolo: 'DR', anno: 2026, mese: 9 }, righe, 'SEPA')?.nomeFile, 'DR_09_26_SEPA.txt')
})

test('TXT: nessun file per un tipo vuoto', () => {
  assert.equal(fileTxt({ ruolo: 'DR', anno: 2026, mese: 9 }, [{ matricola: '090001', tipoConto: 'IT' }], 'EXTRA_UE'), null)
})
