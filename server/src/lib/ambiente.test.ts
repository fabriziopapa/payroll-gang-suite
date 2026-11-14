// Test del riconoscimento dell'ambiente (lib/ambiente.ts).
// Si lanciano con:  npm test --workspace=server

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ambienteDaHost, ambienteDaOrigin, prefissoOggetto, avvisoEmail } from './ambiente.js'

test('host di produzione e pre-produzione', () => {
  assert.equal(ambienteDaHost('fabriziopapa.com'),      'produzione')
  assert.equal(ambienteDaHost('www.fabriziopapa.com'),  'produzione')
  assert.equal(ambienteDaHost('WWW.FabrizioPapa.com.'), 'produzione')
  assert.equal(ambienteDaHost('pre.fabriziopapa.com'),  'preproduzione')
})

test('qualsiasi altro host non è produzione', () => {
  for (const h of ['trusting-azure-fish.31-14-138-77.cpanel.site', 'localhost', '31.14.135.27',
                   'fabriziopapa.com.evil.it', 'xfabriziopapa.com', '', null, undefined]) {
    assert.equal(ambienteDaHost(h), 'non-identificato', String(h))
  }
})

test('origine completa: si guarda solo il nome host', () => {
  assert.equal(ambienteDaOrigin('https://fabriziopapa.com'),          'produzione')
  assert.equal(ambienteDaOrigin('https://pre.fabriziopapa.com:443/'), 'preproduzione')
  assert.equal(ambienteDaOrigin('http://localhost:5173'),             'non-identificato')
  assert.equal(ambienteDaOrigin('non è un url'),                      'non-identificato')
  assert.equal(ambienteDaOrigin(undefined),                           'non-identificato')
})

test('email: nessun segno in produzione, avviso altrove', () => {
  assert.equal(prefissoOggetto('produzione'), '')
  assert.equal(avvisoEmail('produzione', 'https://fabriziopapa.com'), null)
  assert.equal(prefissoOggetto('preproduzione'), '[PRE-PRODUZIONE] ')
  assert.match(avvisoEmail('preproduzione', 'https://pre.fabriziopapa.com') ?? '', /PRE-PRODUZIONE/)
  assert.equal(prefissoOggetto('non-identificato'), '[NON PRODUZIONE] ')
})
