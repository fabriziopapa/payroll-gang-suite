import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ricostruisciInviiPGS, riconcilia, normRiferimento } from './riconciliazione.js'
import type { LiquidatoVoce, RigaPGS } from './types.js'

const R = (o: Partial<LiquidatoVoce>): LiquidatoVoce => ({
  flVoce: true, anno: '2026', mese: '07', oggetto: '000000', progrLiquidazione: '000',
  comparto: '1', ruolo: 'ND', matricola: '000000', capitolo: '000100', flagc: '0',
  dataComp: '2026-07-01', voce: '00000', progrVoce: '00', dataCompVoce: '2026-07-31',
  aliquota: 0, parti: 0, importo: 0, importoTotale: 0, giaLiquidato: 0, divisa: 'E',
  ente: '000000', riferimento: null, idCompenso: 0, idContrattoCsa: 0, ...o,
})

test('normRiferimento: toglie wrapper TL e neutralizza mojibake', () => {
  assert.equal(normRiferimento('TL@ProduttivitÃ @'), 'PRODUTTIVITA')
  assert.equal(normRiferimento('TL@Produttività@'), 'PRODUTTIVITA')
  assert.equal(normRiferimento('GIUGNO 2026'), 'GIUGNO 2026')
  assert.equal(normRiferimento(null), null)
})

test('importo fisso NUOVO + esclusione derivate/tag interni', () => {
  const dett = [
    R({ voce: '03655', capitolo: '000201', flagc: '6', dataCompVoce: '2025-12-31', importo: 580, importoTotale: 580, riferimento: 'TL@ProduttivitÃ @' }),
    R({ voce: '00901', importo: 1940.31, importoTotale: 170.75 }),                 // derivata (no rif)
    R({ voce: '02787', capitolo: '000103', importo: 8, importoTotale: 8, riferimento: 'CG@2025001@DF@30/11/2026@' }), // tag interno
  ]
  const { inviiPGS } = ricostruisciInviiPGS(dett)
  assert.equal(inviiPGS.length, 1)
  assert.equal(inviiPGS[0].voce, '03655')
  assert.equal(inviiPGS[0].importoTotale, 580)
})

test('straordinario a parti: NUOVO + conguaglio tariffa escluso', () => {
  const dett = [
    R({ voce: '00070', capitolo: '000204', flagc: '1', dataCompVoce: '2026-06-30', parti: 19.5, importo: 16.82, importoTotale: 327.99, riferimento: 'GIUGNO 2026' }),
    R({ voce: '00070', capitolo: '000204', flagc: '1', dataCompVoce: '2026-05-31', parti: -14.5, importo: 16.13, importoTotale: -233.89, riferimento: 'MAGGIO 2026' }),
    R({ voce: '00070', capitolo: '000204', flagc: '1', dataCompVoce: '2026-05-31', progrVoce: '01', parti: 14.5, importo: 16.82, importoTotale: 243.89, riferimento: 'MAGGIO 2026' }),
  ]
  const { inviiPGS, conguagli } = ricostruisciInviiPGS(dett)
  assert.equal(inviiPGS.length, 1)
  assert.equal(inviiPGS[0].modalita, 'parti')
  assert.equal(inviiPGS[0].parti, 19.5)
  assert.equal(inviiPGS[0].importoTotale, 327.99)
  assert.equal(conguagli.length, 1)
  assert.equal(conguagli[0].valoreNetto, 10)
})

test('storno e rettifica-residuo', () => {
  const dett = [
    R({ voce: '14167', capitolo: '002298', flagc: '6', dataCompVoce: '2024-12-31', importo: 241.93, importoTotale: -241.93, riferimento: 'TL@WELFARE ANNO 2024 - ISTRUZIONE DIPENDENTE@' }),
    R({ voce: '00298', capitolo: '000211', flagc: '6', dataCompVoce: '2023-12-31', importo: 527.51, importoTotale: -527.51, riferimento: 'TL@Esami di stato 2023@' }),
    R({ voce: '00298', capitolo: '000211', flagc: '6', dataCompVoce: '2023-12-31', progrVoce: '01', importo: 700, importoTotale: 700, riferimento: 'TL@Esami di stato 2023@' }),
  ]
  const { storni, rettifiche } = ricostruisciInviiPGS(dett)
  assert.equal(storni.length, 1)
  assert.equal(storni[0].valore, -241.93)
  assert.equal(rettifiche.length, 1)
  assert.equal(rettifiche[0].tipo, 'RETTIFICA')
  assert.equal(rettifiche[0].valoreNetto, 172.49)
})

test('riconcilia: match value-aware con encoding tollerante', () => {
  const dett = [R({ voce: '03655', capitolo: '000201', flagc: '6', dataCompVoce: '2025-12-31', importo: 580, importoTotale: 580, riferimento: 'TL@ProduttivitÃ @' })]
  const pgs: RigaPGS[] = [
    { matricola: '000000', voce: '03655', capitolo: '000201', dataCompetenzaVoce: '2025-12-31', riferimento: 'TL@Produttività@', importo: 580, flagParti: false },
    { matricola: '000000', voce: '00388', capitolo: '000241', dataCompetenzaVoce: '2025-10-31', riferimento: 'TL@TFA@', importo: 673.81, flagParti: false },
  ]
  const r = riconcilia(dett, pgs)
  assert.equal(r.abbinati.length, 1)
  assert.equal(r.abbinati[0].valoreOk, true)
  assert.equal(r.soloPGS.length, 1)
  assert.equal(r.soloPGS[0].voce, '00388')
  assert.equal(r.soloCineca.length, 0)
  assert.equal(r.ambigui.length, 0)
})
