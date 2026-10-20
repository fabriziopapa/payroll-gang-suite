// Test del riconoscimento del mese nel nome della lavorazione (area Emolumenti).
// Si lanciano con:  npm test --workspace=client

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conMeseNelNome, etichettaMeseLiq, meseNelNome, meseNomeDiverso, pillolaLiquidazione } from './meseNome.ts'

test('riconosce mese e anno nel nome, anche con maiuscole', () => {
  assert.equal(meseNelNome('Dottorati di Ricerca (DR) Maggiorazioni Ottobre 2026')?.chiave, '2026-10')
  assert.equal(meseNelNome('BS settembre 2026')?.chiave, '2026-09')
  assert.equal(meseNelNome('DR GENNAIO 2027')?.chiave, '2027-01')
  assert.equal(meseNelNome('DR ottobre')?.chiave, undefined)
  assert.equal(meseNelNome('Emolumenti 2026')?.chiave, undefined)
  // Parola intera: "Settembrex 2026" non e' un mese.
  assert.equal(meseNelNome('DR Settembrex 2026'), null)
})

test('con piu\' mesi nel nome vale l\'ultimo', () => {
  assert.equal(meseNelNome('Recupero agosto 2026 — liquidazione ottobre 2026')?.chiave, '2026-10')
})

test('sostituisce solo mese e anno, conservando il resto e le maiuscole', () => {
  assert.equal(
    conMeseNelNome('Dottorati di Ricerca (DR) Maggiorazioni Settembre 2026', '2026-10'),
    'Dottorati di Ricerca (DR) Maggiorazioni Ottobre 2026',
  )
  assert.equal(conMeseNelNome('BS settembre 2026', '2027-01'), 'BS gennaio 2027')
  assert.equal(conMeseNelNome('DR SETTEMBRE 2026 (bis)', '2026-11'), 'DR NOVEMBRE 2026 (bis)')
  assert.equal(conMeseNelNome('Senza mese', '2026-10'), null)
  assert.equal(conMeseNelNome('DR settembre 2026', '2026-13'), null)
})

test('mese diverso: solo quando entrambi ci sono e non coincidono', () => {
  const nome = 'Dottorati di Ricerca (DR) Maggiorazioni Ottobre 2026'
  assert.equal(meseNomeDiverso(nome, '2026-09'), '2026-10')
  assert.equal(meseNomeDiverso(nome, '2026-10'), null)
  assert.equal(meseNomeDiverso(nome, ''), null)
  assert.equal(meseNomeDiverso('Senza mese', '2026-09'), null)
})

test('etichetta del mese di liquidazione', () => {
  assert.equal(etichettaMeseLiq('2026-10'), 'ottobre 2026')
  assert.equal(etichettaMeseLiq('2026-1'), '')
  assert.equal(etichettaMeseLiq(''), '')
})

// ── Pillola del mese di liquidazione (26.10.20.1) ──────────────────────────

test('pillola: vale «Liquidazione di», grigia se nome e data coincidono', () => {
  const p = pillolaLiquidazione('BS Ottobre 2026', '2026-10', '2026-10-16')
  assert.equal(p.etichetta, 'ottobre 2026')
  assert.equal(p.ambra, false)
  assert.equal(p.titolo, 'Mese in cui si paga (Liquidazione di)')
})

test('pillola: senza «Liquidazione di» vale il mese della data (archiviate prima della 26.10.10.2)', () => {
  for (const vuoto of ['', null, undefined]) {
    const p = pillolaLiquidazione('Borse di Studio (BS) Settembre 2026', vuoto, '2026-09-15')
    assert.equal(p.etichetta, 'settembre 2026')
    assert.equal(p.ambra, false)
    assert.equal(p.titolo, 'Dal giorno di liquidazione 2026-09-15')
  }
})

test('pillola: «Liquidazione di» e data in mesi diversi -> ambra, vince «Liquidazione di»', () => {
  const p = pillolaLiquidazione('BS Ottobre 2026', '2026-10', '2026-09-15')
  assert.equal(p.etichetta, 'ottobre 2026')
  assert.equal(p.ambra, true)
  assert.equal(p.titolo, 'La data di liquidazione (2026-09-15) dice settembre 2026')
})

test('pillola: nome con un altro mese -> ambra, anche col mese preso dalla data', () => {
  const p = pillolaLiquidazione('BS Ottobre 2026', null, '2026-09-15')
  assert.equal(p.etichetta, 'settembre 2026')
  assert.equal(p.ambra, true)
  assert.equal(p.titolo, 'Il nome dice ottobre 2026')
})

test('pillola: nessun mese e nessuna data (o data malformata) -> da indicare, ambra', () => {
  for (const data of [null, '', '15/09/2026']) {
    const p = pillolaLiquidazione('BS Settembre 2026', '', data)
    assert.equal(p.etichetta, '')
    assert.equal(p.ambra, true)
  }
})
