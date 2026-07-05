// ============================================================
// Test parser cedolino — verifica end-to-end su PDF reale.
//
// Il cedolino contiene PII reale e NON è committato (regola CLAUDE.md).
// Anche i VALORI ATTESI derivano da PII reale, quindi vivono in un JSON
// locale non committato. Il test gira solo se entrambe le env puntano
// a file esistenti:
//   CEDOLINO_SAMPLE="C:\path\Cedolino_...pdf" \
//   CEDOLINO_EXPECTED="C:\path\cedolino_expected.json" \
//   npm run test --workspace=server
// Altrimenti viene saltato (skip), così la CI resta verde senza fixture.
//
// Formato di cedolino_expected.json:
// {
//   "anagrafica": { "cognome": "...", "codice_fiscale": "...", "periodo_retribuzione": "..." },
//   "certificato": {
//     "lordo_teorico": 0, "ritenute_fiscali": 0, "ritenute_previdenziali": 0,
//     "netto_ritenute_legge": 0, "netto_a_pagare": 0, "quinto": 0, "settimo": 0,
//     "extraerariali_righe": 0
//   }
// }
// ============================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { toNum } from './parser.js'

const SAMPLE = process.env.CEDOLINO_SAMPLE
const EXPECTED = process.env.CEDOLINO_EXPECTED
const haveSample = !!SAMPLE && existsSync(SAMPLE) && !!EXPECTED && existsSync(EXPECTED)

test('toNum — formato italiano 1.234,56', () => {
  assert.equal(toNum('1.234,56'), 1234.56)
  assert.equal(toNum('2.202,75'), 2202.75)
  assert.equal(toNum('-156,43'), -156.43)
  assert.equal(toNum('0,00'), 0)
  assert.equal(toNum(''), null)
  assert.equal(toNum('-'), null)
  assert.equal(toNum(null), null)
})

test('parseCedolino — campione locale al centesimo', { skip: !haveSample }, async () => {
  const { parseCedolino } = await import('./parser.js')
  const buf = readFileSync(SAMPLE!)
  const exp = JSON.parse(readFileSync(EXPECTED!, 'utf8'))
  const r = await parseCedolino(buf)

  // Anagrafica
  assert.equal(r.anagrafica.cognome, exp.anagrafica.cognome)
  assert.equal(r.anagrafica.codice_fiscale, exp.anagrafica.codice_fiscale)
  assert.equal(r.anagrafica.periodo_retribuzione, exp.anagrafica.periodo_retribuzione)
  // PRIVACY opzione A: nessun campo IBAN/banca nell'anagrafica
  assert.equal((r.anagrafica as unknown as Record<string, unknown>).iban, undefined)

  // Certificato — banco di prova §3.2
  const c = r.certificato
  assert.equal(c.lordo_teorico,          exp.certificato.lordo_teorico)
  assert.equal(c.ritenute_fiscali,       exp.certificato.ritenute_fiscali)
  assert.equal(c.ritenute_previdenziali, exp.certificato.ritenute_previdenziali)
  assert.equal(c.netto_ritenute_legge,   exp.certificato.netto_ritenute_legge)
  assert.equal(c.netto_a_pagare,         exp.certificato.netto_a_pagare)
  assert.equal(c.quinto,                 exp.certificato.quinto)
  assert.equal(c.settimo,                exp.certificato.settimo)
  assert.equal(c.extraerariali_righe.length, exp.certificato.extraerariali_righe)
})
