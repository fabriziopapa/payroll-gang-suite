// ============================================================
// Test extractor regioni PDF — logica pura di ricomposizione testo.
//
// extractRegions() richiede un vero documento PDF (pdfjs + viewport reale):
// la sua integrazione end-to-end è coperta dallo smoke di Step 10
// ("crea template → estrai → genera certificato" su PDF reale via UI).
// Qui testiamo isolatamente joinReadingOrder — la logica di ricomposizione
// in ordine di lettura (raggruppamento per Y, ordinamento per X), pura e
// indipendente da pdfjs — stesso approccio di parser.test.ts che testa
// toNum() come funzione pura esportata.
// ============================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { joinReadingOrder } from './extractor.js'

test('joinReadingOrder — righe ordinate Y crescente (viewport: top→bottom), parole left→right', () => {
  // "Mario Rossi" sopra (y=10), "Importo: 100,00" sotto (y=30) — frammenti
  // volutamente fuori ordine in input, come arrivano da tc.items di pdfjs.
  const testo = joinReadingOrder([
    { x: 50, y: 30, str: 'Importo:' },
    { x: 10, y: 10, str: 'Mario' },
    { x: 90, y: 30, str: '100,00' },
    { x: 40, y: 10, str: 'Rossi' },
  ])
  assert.equal(testo, 'Mario Rossi Importo: 100,00')
})

test('joinReadingOrder — frammenti entro Y_TOL (2px): stessa riga, ordinati per X', () => {
  const testo = joinReadingOrder([
    { x: 50, y: 10.0, str: 'destra' },
    { x: 10, y: 11.5, str: 'sinistra' }, // scarto 1.5px ≤ Y_TOL → stessa riga → riordinati per X
  ])
  assert.equal(testo, 'sinistra destra')
})

test('joinReadingOrder — scarto oltre Y_TOL (2px): righe separate, ordinate per Y', () => {
  const testo = joinReadingOrder([
    { x: 50, y: 10, str: 'sopra' },
    { x: 10, y: 14, str: 'sotto' }, // scarto 4px > Y_TOL → riga propria, dopo la prima (Y crescente)
  ])
  assert.equal(testo, 'sopra sotto')
})

test('joinReadingOrder — input vuoto → stringa vuota', () => {
  assert.equal(joinReadingOrder([]), '')
})

test('joinReadingOrder — normalizza spazi superflui dentro/fra frammenti', () => {
  const testo = joinReadingOrder([
    { x: 10, y: 10, str: '  Totale  ' },
    { x: 60, y: 10, str: '  €' },
  ])
  assert.equal(testo, 'Totale €')
})
