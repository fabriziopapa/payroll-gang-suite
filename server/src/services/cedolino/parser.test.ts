// ============================================================
// Test parser cedolino — verifica end-to-end su PDF reale.
//
// Il cedolino contiene PII reale e NON è committato (regola CLAUDE.md).
// Il test gira solo se la env CEDOLINO_SAMPLE punta a un PDF locale:
//   CEDOLINO_SAMPLE="C:\path\Cedolino_...pdf" npm run test --workspace=server
// Altrimenti viene saltato (skip), così la CI resta verde senza fixture.
// ============================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { toNum } from './parser.js'

const SAMPLE = process.env.CEDOLINO_SAMPLE
const haveSample = !!SAMPLE && existsSync(SAMPLE)

test('toNum — formato italiano 1.234,56', () => {
  assert.equal(toNum('1.234,56'), 1234.56)
  assert.equal(toNum('2.202,75'), 2202.75)
  assert.equal(toNum('-156,43'), -156.43)
  assert.equal(toNum('0,00'), 0)
  assert.equal(toNum(''), null)
  assert.equal(toNum('-'), null)
  assert.equal(toNum(null), null)
})

test('parseCedolino — campione Pino al centesimo', { skip: !haveSample }, async () => {
  const { parseCedolino } = await import('./parser.js')
  const buf = readFileSync(SAMPLE!)
  const r = await parseCedolino(buf)

  // Anagrafica
  assert.equal(r.anagrafica.cognome, 'PINO')
  assert.equal(r.anagrafica.codice_fiscale, 'PNIVCN70T10A064T')
  assert.equal(r.anagrafica.periodo_retribuzione, 'MAGGIO 2026')
  // PRIVACY opzione A: nessun campo IBAN/banca nell'anagrafica
  assert.equal((r.anagrafica as unknown as Record<string, unknown>).iban, undefined)

  // Certificato — banco di prova §3.2
  const c = r.certificato
  assert.equal(c.lordo_teorico,          2221.38)
  assert.equal(c.ritenute_fiscali,       326.59)
  assert.equal(c.ritenute_previdenziali, 247.68)
  assert.equal(c.netto_ritenute_legge,   1647.11)
  assert.equal(c.netto_a_pagare,         1243.52)
  assert.equal(c.quinto,                 329.42)
  assert.equal(c.settimo,                235.30)
  assert.equal(c.extraerariali_righe.length, 4)
})
