// ============================================================
// Test adapter regioni→CedolinoParsed — dati sintetici puri (no PDF).
// Mirror calculator.test.ts: builder + assert puntuali su tipi/warning/errori.
// Run: npm run test --workspace=server
// ============================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adaptToParsed } from './adapter.js'
import type { ParteTemplate, ParteAnagrafica, ParteVoce } from './types.js'
import type { RegionExtractionResult, RegionTesto } from './extractor.js'

const rect = (pageIndex = 0) => ({ pageIndex, x: 0.1, y: 0.1, width: 0.2, height: 0.05 })

const anagrafica = (id: string, label: string, ruolo: ParteAnagrafica['ruolo']): ParteAnagrafica => ({
  kind: 'anagrafica', id, label, ruolo, regione: rect(),
})

const voce = (id: string, label: string, sezione: ParteVoce['sezione'], sign: '+' | '-' = '+'): ParteVoce => ({
  kind: 'voce', id, label,
  regioneDescrizione: rect(), regioneImporto: rect(),
  sezione, sign, isArretrato: false,
})

const t = (parteId: string, ruolo: RegionTesto['ruolo'], testo: string): RegionTesto => ({ parteId, ruolo, testo })

const extraction = (testi: RegionTesto[], errors: RegionExtractionResult['errors'] = []): RegionExtractionResult =>
  ({ testi, errors })

test('adaptToParsed — caso base: anagrafica + voci di varie sezioni, riepilogo sintetizzato', () => {
  const parti: ParteTemplate[] = [
    anagrafica('a1', 'Matricola',  'matricola'),
    anagrafica('a2', 'Nominativo', 'cognome_nome'),
    voce('v1', 'Retribuzione',  'retribuzioni'),
    voce('v2', 'Ritenuta Tesoro', 'contributi'),
    voce('v3', 'IRPEF', 'fiscali_correnti'),
  ]
  const r = adaptToParsed(extraction([
    t('a1', 'anagrafica',  '000123'),
    t('a2', 'anagrafica',  'ROSSI Mario'),
    t('v1', 'descrizione', 'Retribuzione complessiva'), t('v1', 'importo', '2.202,75'),
    t('v2', 'descrizione', 'Ritenuta Tesoro'),          t('v2', 'importo', '195,48'),
    t('v3', 'descrizione', 'Ritenute IRPEF'),           t('v3', 'importo', '453,95'),
  ]), parti)

  assert.equal(r.parsed.anagrafica.matricola, '000123')
  assert.equal(r.parsed.anagrafica.cognome, 'ROSSI')
  assert.equal(r.parsed.anagrafica.nome, 'Mario')
  assert.equal(r.parsed.voci_teoriche.length, 0)            // sempre [] — Strada A regioni
  assert.equal(r.parsed.voci_dettaglio.length, 3)
  assert.equal(r.parsed.voci_dettaglio[0]!.valore, 2202.75)
  assert.equal(r.parsed.riepilogo_cedolino.retribuzioni, 2202.75)
  assert.equal(r.parsed.riepilogo_cedolino.contributi, 195.48)
  assert.equal(r.parsed.riepilogo_cedolino.fiscali_totali, 453.95)
  assert.equal(r.parsed.riepilogo_cedolino.netto_cedolino, null)  // non sintetizzabile, editabile
  assert.equal(r.errors.length, 0)
  // warning sempre presenti su questo percorso (Strada A regioni — niente teoriche/riepilogo dal PDF)
  assert.ok(r.warnings.some(w => w.tipo === 'TEO_MANCANTE'))
  assert.ok(r.warnings.some(w => w.tipo === 'RIEPILOGO_SINTETIZZATO'))
})

test('adaptToParsed — sign del template è la fonte di verità sul segno (non il testo letto)', () => {
  const parti: ParteTemplate[] = [
    voce('v1', 'Detrazione', 'fiscali_correnti', '-'),
    voce('v2', 'IRPEF',      'fiscali_correnti', '+'),
  ]
  const r = adaptToParsed(extraction([
    t('v1', 'descrizione', 'Detrazioni art.13'), t('v1', 'importo', '156,43'), // stampato positivo
    t('v2', 'descrizione', 'Ritenute IRPEF'),    t('v2', 'importo', '453,95'),
  ]), parti)

  assert.equal(r.parsed.voci_dettaglio[0]!.valore, -156.43)
  assert.equal(r.parsed.voci_dettaglio[1]!.valore, 453.95)
  assert.equal(r.parsed.riepilogo_cedolino.fiscali_totali, 297.52) // 453.95 - 156.43, somma firmata Decimal
})

test('adaptToParsed — conguaglio/numeri_riga derivati, mai estratti', () => {
  const parti: ParteTemplate[] = [
    voce('v1', 'Cong. addiz.', 'fiscali_conguaglio'),
    voce('v2', 'IRPEF', 'fiscali_correnti'),
  ]
  const r = adaptToParsed(extraction([
    t('v1', 'descrizione', 'Cong. addiz. regionale'), t('v1', 'importo', '86,00'),
    t('v2', 'descrizione', 'Ritenute IRPEF'),         t('v2', 'importo', '453,95'),
  ]), parti)

  assert.equal(r.parsed.voci_dettaglio[0]!.conguaglio, true)   // derivato da sezione === fiscali_conguaglio
  assert.equal(r.parsed.voci_dettaglio[1]!.conguaglio, false)
  assert.deepEqual(r.parsed.voci_dettaglio[0]!.numeri_riga, []) // sempre [] — non ricostruibile da regioni
})

test('adaptToParsed — importo non letto: warning IMPORTO_NON_LETTO, valore 0, non bloccante', () => {
  // matricola inclusa per isolare lo scenario (altrimenti scatta ANAGRAFICA_INCOMPLETA)
  const parti: ParteTemplate[] = [
    anagrafica('a1', 'Matricola', 'matricola'),
    voce('v1', 'Voce X', 'retribuzioni'),
  ]
  const r = adaptToParsed(extraction([
    t('a1', 'anagrafica',  '000123'),
    t('v1', 'descrizione', 'Voce X'), t('v1', 'importo', ''),
  ]), parti)

  assert.equal(r.parsed.voci_dettaglio.length, 1)
  assert.equal(r.parsed.voci_dettaglio[0]!.valore, 0)
  assert.ok(r.warnings.some(w => w.tipo === 'IMPORTO_NON_LETTO' && w.parteId === 'v1'))
  assert.equal(r.errors.length, 0)
})

test('adaptToParsed — importo illeggibile: errore bloccante IMPORTO_NON_PARSABILE, voce esclusa', () => {
  const parti: ParteTemplate[] = [
    voce('v1', 'Voce X', 'retribuzioni'),
    voce('v2', 'Voce Y', 'retribuzioni'),
  ]
  const r = adaptToParsed(extraction([
    t('v1', 'descrizione', 'Voce X'), t('v1', 'importo', 'XXXX###'),
    t('v2', 'descrizione', 'Voce Y'), t('v2', 'importo', '100,00'),
  ]), parti)

  assert.equal(r.parsed.voci_dettaglio.length, 1)             // v1 esclusa — niente valori inventati
  assert.equal(r.parsed.voci_dettaglio[0]!.descrizione, 'Voce Y')
  assert.ok(r.errors.some(e => e.tipo === 'IMPORTO_NON_PARSABILE' && e.parteId === 'v1'))
})

test('adaptToParsed — descrizione vuota: errore REGIONE_VUOTA, fallback al label del template', () => {
  const parti: ParteTemplate[] = [voce('v1', 'Label di fallback', 'retribuzioni')]
  const r = adaptToParsed(extraction([
    t('v1', 'descrizione', ''), t('v1', 'importo', '100,00'),
  ]), parti)

  assert.equal(r.parsed.voci_dettaglio[0]!.descrizione, 'Label di fallback')
  assert.ok(r.errors.some(e => e.tipo === 'REGIONE_VUOTA' && e.parteId === 'v1'))
})

test('adaptToParsed — anagrafica incompleta: né matricola né cognome → errore bloccante', () => {
  const parti: ParteTemplate[] = [anagrafica('a1', 'Periodo', 'periodo_retribuzione')]
  const r = adaptToParsed(extraction([t('a1', 'anagrafica', 'MAGGIO 2026')]), parti)

  assert.equal(r.parsed.anagrafica.periodo_retribuzione, 'MAGGIO 2026')
  assert.equal(r.parsed.anagrafica.matricola, null)
  assert.ok(r.errors.some(e => e.tipo === 'ANAGRAFICA_INCOMPLETA'))
})

test('adaptToParsed — cognome_nome: ultima parola = nome, resto = cognome (gestisce cognomi composti)', () => {
  const parti: ParteTemplate[] = [anagrafica('a1', 'Nominativo', 'cognome_nome')]

  const r1 = adaptToParsed(extraction([t('a1', 'anagrafica', 'DE LUCA Maria')]), parti)
  assert.equal(r1.parsed.anagrafica.cognome, 'DE LUCA')
  assert.equal(r1.parsed.anagrafica.nome, 'Maria')

  const r2 = adaptToParsed(extraction([t('a1', 'anagrafica', 'ROSSI')]), parti)
  assert.equal(r2.parsed.anagrafica.cognome, 'ROSSI')
  assert.equal(r2.parsed.anagrafica.nome, null)
})

test('adaptToParsed — regione anagrafica vuota: errore REGIONE_VUOTA con parteId', () => {
  const parti: ParteTemplate[] = [anagrafica('a1', 'Matricola', 'matricola')]
  const r = adaptToParsed(extraction([t('a1', 'anagrafica', '   ')]), parti)

  assert.equal(r.parsed.anagrafica.matricola, null)
  assert.ok(r.errors.some(e => e.tipo === 'REGIONE_VUOTA' && e.parteId === 'a1'))
})

test('adaptToParsed — errori strutturali (PAGINA_FUORI_RANGE) propagati dall\'estrazione', () => {
  const parti: ParteTemplate[] = [voce('v1', 'Voce X', 'retribuzioni')]
  const errExtraction: RegionExtractionResult = {
    testi:  [t('v1', 'descrizione', 'Voce X'), t('v1', 'importo', '100,00')],
    errors: [{ tipo: 'PAGINA_FUORI_RANGE', parteId: 'v1', messaggio: 'Pagina 100 fuori range (il PDF ne ha 3)' }],
  }
  const r = adaptToParsed(errExtraction, parti)
  assert.ok(r.errors.some(e => e.tipo === 'PAGINA_FUORI_RANGE' && e.parteId === 'v1'))
})

test('adaptToParsed — sezione assente dal template → null nel riepilogo (computeCertificato gestisce dinamicamente)', () => {
  const parti: ParteTemplate[] = [voce('v1', 'Stipendio', 'retribuzioni')]
  const r = adaptToParsed(extraction([
    t('v1', 'descrizione', 'Stipendio'), t('v1', 'importo', '1.000,00'),
  ]), parti)

  assert.equal(r.parsed.riepilogo_cedolino.retribuzioni, 1000)
  assert.equal(r.parsed.riepilogo_cedolino.contributi, null)
  assert.equal(r.parsed.riepilogo_cedolino.fiscali_totali, null)
  assert.equal(r.parsed.riepilogo_cedolino.altre_ritenute, null)
})
