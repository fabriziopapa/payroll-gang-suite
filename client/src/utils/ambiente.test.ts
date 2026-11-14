import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ambienteDaHost, HOST_PRODUZIONE, HOST_PREPRODUZIONE } from './ambiente'

test('ambiente: produzione e pre-produzione dagli host esatti', () => {
  assert.equal(ambienteDaHost('fabriziopapa.com'),      'produzione')
  assert.equal(ambienteDaHost('www.fabriziopapa.com'),  'produzione')
  assert.equal(ambienteDaHost('WWW.FabrizioPapa.com.'), 'produzione')
  assert.equal(ambienteDaHost('pre.fabriziopapa.com'),  'preproduzione')
})

test('ambiente: ogni altro host mostra il banner', () => {
  for (const h of ['trusting-azure-fish.31-14-138-77.cpanel.site', 'localhost', '31.14.135.27',
                   'fabriziopapa.com.evil.it', 'xfabriziopapa.com', '', null, undefined]) {
    assert.equal(ambienteDaHost(h), 'non-identificato', String(h))
  }
})

test('ambiente: elenchi identici a quelli del server', async () => {
  const fs = await import('node:fs')
  const src = fs.readFileSync(new URL('../../../server/src/lib/ambiente.ts', import.meta.url), 'utf8')
  const lista = (nome: string) => {
    const m = src.match(new RegExp(`${nome}:\\s*readonly string\\[\\]\\s*=\\s*\\[([^\\]]*)\\]`))
    assert.ok(m, nome)
    return [...m[1]!.matchAll(/'([^']+)'/g)].map(x => x[1])
  }
  assert.deepEqual(lista('HOST_PRODUZIONE'),    [...HOST_PRODUZIONE])
  assert.deepEqual(lista('HOST_PREPRODUZIONE'), [...HOST_PREPRODUZIONE])
})
