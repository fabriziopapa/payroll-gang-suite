import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leggiPerPagina, normalizzaPerPagina, numeriPagina, scriviPerPagina } from './perPagina'

test('per pagina: 1–200, altrimenti 10', () => {
  assert.equal(normalizzaPerPagina('25'), 25)
  assert.equal(normalizzaPerPagina(' 1 '), 1)
  assert.equal(normalizzaPerPagina('200'), 200)
  assert.equal(normalizzaPerPagina('201'), 200)
  assert.equal(normalizzaPerPagina('999'), 200)
  assert.equal(normalizzaPerPagina('2.4'), 2)
  for (const v of ['0', '-3', 'abc', '', null, undefined]) assert.equal(normalizzaPerPagina(v), 10)
})

test('per pagina: si ricorda, e una memoria rotta non rompe', () => {
  const d = new Map<string, string>()
  const m = { getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => void d.set(k, v) }
  assert.equal(leggiPerPagina('dashboard', m), 10)
  scriviPerPagina('dashboard', 30, m); assert.equal(leggiPerPagina('dashboard', m), 30)
  d.set('pgs.perPagina.dashboard', 'x'); assert.equal(leggiPerPagina('dashboard', m), 10)
  const rotta = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') } }
  assert.equal(leggiPerPagina('dashboard', rotta), 10); assert.doesNotThrow(() => scriviPerPagina('dashboard', 5, rotta))
})

test('numeri delle pagine: accorciati quando sono tante', () => {
  assert.deepEqual(numeriPagina(5, 2), [1, 2, 3, 4, 5])
  assert.deepEqual(numeriPagina(20, 1), [1, 2, '…', 20])
  assert.deepEqual(numeriPagina(20, 10), [1, '…', 9, 10, 11, '…', 20])
  assert.deepEqual(numeriPagina(20, 20), [1, '…', 19, 20])
  assert.deepEqual(numeriPagina(20, 3), [1, 2, 3, 4, '…', 20])
})
