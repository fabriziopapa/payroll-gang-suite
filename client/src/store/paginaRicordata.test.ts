import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paginaRicordata, ricordaPagina, ricordaValore, valoreRicordato } from './paginaRicordata'

const finta = () => { const d = new Map<string, string>(); return { getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => void d.set(k, v), removeItem: (k: string) => void d.delete(k), d } }

test('pagina ricordata: il CRAL si riapre, solo per un admin', () => {
  const m = finta()
  ricordaPagina('cral', m)
  assert.equal(paginaRicordata(true, m), 'cral')
  assert.equal(paginaRicordata(false, m), null)
})

test('pagina ricordata: una pagina fuori elenco cancella il ricordo', () => {
  const m = finta()
  ricordaPagina('cral', m)
  ricordaPagina('editor', m)
  assert.equal(paginaRicordata(true, m), null)
  ricordaPagina('cral', m); ricordaPagina('login', m)
  assert.equal(paginaRicordata(true, m), null)
})

test('pagina ricordata: valori estranei e memoria assente non rompono', () => {
  const m = finta(); m.setItem('pgs.pagina', 'editor')
  assert.equal(paginaRicordata(true, m), null)
  m.setItem('pgs.pagina', 'qualsiasi')
  assert.equal(paginaRicordata(true, m), null)
  assert.equal(paginaRicordata(true, null), null)
  const rotta = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') }, removeItem: () => { throw new Error('no') } }
  assert.doesNotThrow(() => ricordaPagina('cral', rotta))
  assert.equal(paginaRicordata(true, rotta), null)
})

test('valore ricordato: solo fra quelli ammessi', () => {
  const m = finta()
  ricordaValore('cral.scheda', 'parametri', m)
  assert.equal(valoreRicordato('cral.scheda', ['soci', 'parametri'] as const, m), 'parametri')
  ricordaValore('cral.scheda', 'nonesiste', m)
  assert.equal(valoreRicordato('cral.scheda', ['soci', 'parametri'] as const, m), null)
})
