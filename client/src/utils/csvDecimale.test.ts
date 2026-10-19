// Test del separatore decimale dei file HR (impostazione csvDecimaleVirgola).
// Dati SINTETICI: nessun nominativo, matricola o numero reale.
// Si lanciano con:  npm test --workspace=client

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCsvRows, serializeCsv, separatoreDecimale, formatNumeroCsv } from './biz.ts'
import type { DettaglioLiquidazione, Nominativo } from '../types/index.ts'

function gruppo(over: Partial<DettaglioLiquidazione> = {}): DettaglioLiquidazione {
  return {
    id: 'g1', colore: '#000', nomeDescrittivo: 'test', voce: '00299', capitolo: '000229',
    competenzaLiquidazione: '10/2026', dataCompetenzaVoce: '2026-10-31',
    flagScorporo: false, riferimentoCedolino: 'TL@TEST@',
    identificativoProvvedimento: '', tipoProvvedimento: '029', numeroProvvedimento: '900006',
    dataProvvedimento: '2026-09-02',
    aliquota: 0, parti: 0, flagAdempimenti: 0, idContrattoCSA: '', centroCosto: '', note: '',
    ...over,
  }
}
function nominativo(importoLordo: number, over: Partial<Nominativo> = {}): Nominativo {
  return {
    id: 'n1', matricola: '900001', cognomeNome: 'ROSSI Mario', ruolo: 'ND', druolo: '',
    dettaglioId: 'g1', importoLordo, origine: 'manuale', ...over,
  } as unknown as Nominativo
}

/** aliquota;parti;importo (13a-15a colonna) della prima riga dati. */
function numeri(csv: string): string {
  return csv.split('\n')[1]!.split(';').slice(12, 15).join(';')
}

test('impostazione assente o true = virgola (default)', () => {
  assert.equal(separatoreDecimale({}), ',')
  assert.equal(separatoreDecimale({ csvDecimaleVirgola: true }), ',')
  assert.equal(separatoreDecimale({ csvDecimaleVirgola: false }), '.')
})

test('formatNumeroCsv: cambia solo il carattere dei decimali', () => {
  assert.equal(formatNumeroCsv(1234.56, ','), '1234,56')
  assert.equal(formatNumeroCsv(1234.56, '.'), '1234.56')
  assert.equal(formatNumeroCsv(-0.75, ','), '-0,75')
  assert.equal(formatNumeroCsv(1500, ','), '1500')   // interi invariati, niente migliaia
  assert.equal(formatNumeroCsv(0, ','), '0')
})

test('CSV HR con la virgola: importo, parti e aliquota', () => {
  const det = gruppo({ aliquota: 12.5, parti: 0.75 })
  const csv = serializeCsv(buildCsvRows([det], [nominativo(1353.58)], {}), ',')
  assert.equal(numeri(csv), '12,5;0,75;1353,58')
})

test('CSV HR con il punto: come prima della 26.10.19', () => {
  const det = gruppo({ aliquota: 12.5, parti: 0.75 })
  const csv = serializeCsv(buildCsvRows([det], [nominativo(1353.58)], {}), '.')
  assert.equal(numeri(csv), '12.5;0.75;1353.58')
})

test('il separatore decimale non tocca il resto del tracciato', () => {
  const rows = buildCsvRows([gruppo()], [nominativo(10.5)], {})
  const v = serializeCsv(rows, ',').split('\n')
  const p = serializeCsv(rows, '.').split('\n')
  assert.equal(v[0], p[0])                                   // intestazione identica
  assert.equal(v[1]!.split(';').length, 24)                  // sempre 24 colonne
  const senzaNumeri = (r: string) => r.split(';').filter((_, i) => i < 12 || i > 14).join(';')
  assert.equal(senzaNumeri(v[1]!), senzaNumeri(p[1]!))       // date e codici identici
  assert.ok(v[1]!.includes('31/10/2026'))                    // dataCompetenzaVoce GG/MM/AAAA
  assert.ok(v[1]!.includes(';2026-09-02;'))                  // dataProvvedimento ISO
})

test('l\'export non modifica le righe in memoria', () => {
  const rows = buildCsvRows([gruppo({ parti: 0.5 })], [nominativo(99.9)], {})
  serializeCsv(rows, ',')
  assert.equal(rows[0]!.importo, 99.9)
  assert.equal(rows[0]!.parti, 0.5)
  assert.equal(typeof rows[0]!.importo, 'number')
})
