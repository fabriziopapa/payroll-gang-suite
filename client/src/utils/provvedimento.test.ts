// Test del provvedimento: salvataggio con/senza flag "conserva" e CSV HR.
// Dati SINTETICI: nessun nominativo, matricola o numero reale.
// Si lanciano con:  npm test --workspace=client

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  conservaEstremi, normalizeProvvedimento, normalizeProvvedimentoSalvataggio,
} from './provvedimento.ts'
import { buildCsvRows, serializeCsv } from './biz.ts'
import { buildPdfFragment } from './pdfBuilder.ts'
import type { DettaglioLiquidazione, Nominativo } from '../types/index.ts'

const PIENO = {
  identificativoProvvedimento: '25994',
  tipoProvvedimento:           '029',
  numeroProvvedimento:         '900006',
  dataProvvedimento:           '2026-09-02',
}

function gruppo(over: Partial<DettaglioLiquidazione> = {}): DettaglioLiquidazione {
  return {
    id: 'g1', colore: '#000', nomeDescrittivo: 'test', voce: '00299', capitolo: '000229',
    competenzaLiquidazione: '10/2026', dataCompetenzaVoce: '2026-10-31',
    flagScorporo: false, riferimentoCedolino: 'TL@TEST@',
    identificativoProvvedimento: '', tipoProvvedimento: '', numeroProvvedimento: '', dataProvvedimento: '',
    aliquota: 0, parti: 0, flagAdempimenti: 0, idContrattoCSA: '', centroCosto: '', note: '',
    ...over,
  }
}
const NOM = {
  id: 'n1', matricola: '900001', cognomeNome: 'ROSSI Mario', ruolo: 'ND', druolo: '',
  dettaglioId: 'g1', importoLordo: 1, origine: 'manuale',
} as unknown as Nominativo

/** Le quattro colonne del provvedimento (5a-8a) della prima riga del CSV HR. */
function colonneProv(det: DettaglioLiquidazione): string {
  const riga = serializeCsv(buildCsvRows([det], [NOM], {})).split(/\r?\n/)[1]!
  return riga.split(';').slice(4, 8).join(';')
}

test('flag assente = ON (gruppi salvati prima della 26.10.13)', () => {
  assert.equal(conservaEstremi({}), true)
  assert.equal(conservaEstremi({ conservaEstremiProvvedimento: false }), false)
})

test('salvataggio con il flag: si conservano ID e estremi, ID a 9 cifre', () => {
  assert.deepEqual(normalizeProvvedimentoSalvataggio(PIENO, true), { ...PIENO, identificativoProvvedimento: '000025994' })
})

test('salvataggio senza il flag: come prima, vince l\'ID', () => {
  assert.deepEqual(normalizeProvvedimentoSalvataggio(PIENO, false), normalizeProvvedimento(PIENO))
  assert.deepEqual(normalizeProvvedimentoSalvataggio(PIENO, false), {
    identificativoProvvedimento: '000025994', tipoProvvedimento: '', numeroProvvedimento: '', dataProvvedimento: '',
  })
})

test('placeholder storici di soli zeri valgono vuoto anche con il flag', () => {
  const r = normalizeProvvedimentoSalvataggio({ identificativoProvvedimento: '000000000', tipoProvvedimento: '000' }, true)
  assert.equal(r.identificativoProvvedimento, '')
  assert.equal(r.tipoProvvedimento, '')
})

test('CSV HR: gruppo con ID ed estremi salvati -> esce solo l\'ID', () => {
  const det = gruppo({ ...normalizeProvvedimentoSalvataggio(PIENO, true), conservaEstremiProvvedimento: true })
  assert.equal(det.numeroProvvedimento, '900006')         // salvato...
  assert.equal(colonneProv(det), '000025994;;;')         // ...ma non esportato
})

test('CSV HR: flag ON senza ID -> escono gli estremi, data ISO', () => {
  const det = gruppo({ tipoProvvedimento: '029', numeroProvvedimento: '900006', dataProvvedimento: '2026-09-02' })
  assert.equal(colonneProv(det), ';029;900006;2026-09-02')
})

test('CSV HR: nessun provvedimento -> quattro colonne vuote', () => {
  assert.equal(colonneProv(gruppo()), ';;;')
})

test('PDF comunicazione: numero e data del provvedimento, data in GG/MM/AAAA', () => {
  const det = gruppo({ ...normalizeProvvedimentoSalvataggio(PIENO, true) })
  const html = buildPdfFragment({
    det, noms: [], campi: ['provvedimento', 'dataCompetenzaVoce'],
    descVoce: '', descCapitolo: '', coefficienti: {},
  })
  assert.match(html, /n\. 900006 del 02\/09\/2026/)
  assert.match(html, /31\/10\/2026/)
  assert.doesNotMatch(html, /2026-09-02/)
})
