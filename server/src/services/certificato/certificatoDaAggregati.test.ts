// Test del motore ad aggregati. DATI 100% SINTETICI (nessun dato reale).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { certificatoDaAggregati } from './certificatoDaAggregati.js'
import type { LiquidatoVoce } from '../verificaLiquidato/types.js'

// Helper: riga minima con i soli campi rilevanti al motore.
function riga(p: Partial<LiquidatoVoce> & { voce: string; importoTotale: number }): LiquidatoVoce {
  return {
    flVoce: true, anno: '2099', mese: '01', oggetto: '000000', progrLiquidazione: '001',
    comparto: '1', ruolo: 'ND', matricola: '000000', capitolo: '000100', flagc: '0',
    dataComp: '2099-01-01', progrVoce: '00', dataCompVoce: '2099-01-31', aliquota: 0,
    parti: 0, importo: 0, giaLiquidato: 0, divisa: 'E', ente: '000000', riferimento: null,
    idCompenso: 0, idContrattoCsa: 0, ...p,
  }
}

test('aggregati mese corrente: certificato e quadratura con voce 03003', () => {
  // Valori sintetici scelti perché quadrino: 1000 - 100 - (200+50) - 80 = 570.
  const dettaglio: LiquidatoVoce[] = [
    riga({ voce: '01096', importoTotale: 1000 }),   // lordo
    riga({ voce: '00991', importoTotale: 100 }),    // fiscali nette
    riga({ voce: '00990', importoTotale: 200 }),    // previdenziali
    riga({ voce: '01323', importoTotale: 50 }),     // Abb.TFR → +previdenziali
    riga({ voce: '00994', importoTotale: 80 }),     // extraerariali
    riga({ voce: '00850', importoTotale: 80, riferimento: 'DF@30/06/2030@' }), // dettaglio extra
    riga({ voce: '03003', importoTotale: 570 }),    // netto in busta (quadratura)
    // rumore che NON deve entrare nel calcolo:
    riga({ voce: '01096', importoTotale: 999, flagc: '1' }),               // arretrato stesso capitolo
    riga({ voce: '00991', importoTotale: 999, capitolo: '002296' }),       // run secondario
    riga({ voce: '00816', importoTotale: 999, capitolo: '000103' }),       // addizionale rateizzata (altro cap.)
  ]

  const r = certificatoDaAggregati(dettaglio)
  assert.equal(r.certificato.lordo_teorico, 1000)
  assert.equal(r.certificato.ritenute_fiscali, 100)
  assert.equal(r.certificato.ritenute_previdenziali, 250) // 200 + 50 Abb.TFR
  assert.equal(r.certificato.extraerariali_totale, 80)
  assert.equal(r.certificato.netto_ritenute_legge, 650)   // 1000 - 100 - 250
  assert.equal(r.certificato.netto_a_pagare, 570)         // 650 - 80
  assert.equal(r.nettoCedolino, 570)
  assert.equal(r.quadratura, true)
  assert.equal(r.certificato.quinto, 130)                 // 650/5
  assert.equal(r.certificato.extraerariali_righe.length, 1)
  assert.equal(r.certificato.extraerariali_righe[0].scadenza, '30/06/2030')
})

test('addizionali nello scope corrente si inglobano nelle fiscali', () => {
  const dettaglio: LiquidatoVoce[] = [
    riga({ voce: '01096', importoTotale: 1000 }),
    riga({ voce: '00991', importoTotale: 100 }),
    riga({ voce: '00816', importoTotale: 10 }),  // regionale
    riga({ voce: '01797', importoTotale: 5 }),   // comunale
    riga({ voce: '02787', importoTotale: 2 }),   // acconto
  ]
  const r = certificatoDaAggregati(dettaglio)
  assert.equal(r.certificato.ritenute_fiscali, 117) // 100 + 10 + 5 + 2
  assert.equal(r.quadratura, false)                 // niente 03003 → non quadrabile
})

test('mappa descrizioni ruolo-aware popola la tabella RETRIBUZIONE', () => {
  const dettaglio: LiquidatoVoce[] = [
    riga({ voce: '01096', importoTotale: 500 }),
    riga({ voce: '00010', importoTotale: 400 }),
    riga({ voce: '00055', importoTotale: 100 }),
  ]
  const r = certificatoDaAggregati(dettaglio, {}, { '00010': 'Stipendio', '00055': 'IIS (professori)' })
  assert.equal(r.retribuzione.length, 2)
  assert.deepEqual(
    r.retribuzione.map(x => x.descrizione).sort(),
    ['IIS (professori)', 'Stipendio'],
  )
})
