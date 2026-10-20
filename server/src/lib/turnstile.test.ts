// Test della verifica Turnstile lato server (lib/turnstile.ts).
// Si lanciano con:  npm test --workspace=server

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyTurnstile, SITEVERIFY_URL } from './turnstile.js'

/** fetch finto: restituisce `body` con lo stato indicato e registra la chiamata. */
function fintoFetch(status: number, body: unknown) {
  const chiamate: Array<{ url: string; body: Record<string, unknown> }> = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    chiamate.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
  return { fn, chiamate }
}

test('secret assente o interruttore spento: passa senza chiamare Cloudflare', async () => {
  const { fn, chiamate } = fintoFetch(200, { success: false })
  assert.deepEqual(await verifyTurnstile(undefined, true, 'x', '1.2.3.4', fn), { ok: true })
  assert.deepEqual(await verifyTurnstile('s', false, undefined, '1.2.3.4', fn), { ok: true })
  assert.equal(chiamate.length, 0)
})

test('token mancante: rifiuto con motivo missing_token, senza chiamare Cloudflare', async () => {
  const { fn, chiamate } = fintoFetch(200, { success: true })
  const r = await verifyTurnstile('s', true, undefined, '1.2.3.4', fn)
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'missing_token')
  assert.equal(chiamate.length, 0)
})

test('successo: ok e inoltro di secret, token e IP a siteverify', async () => {
  const { fn, chiamate } = fintoFetch(200, { success: true })
  const r = await verifyTurnstile('segreto', true, 'tok', '1.2.3.4', fn)
  assert.equal(r.ok, true)
  assert.equal(chiamate[0]?.url, SITEVERIFY_URL)
  assert.deepEqual(chiamate[0]?.body, { secret: 'segreto', response: 'tok', remoteip: '1.2.3.4' })
})

test('rifiuto di Cloudflare: motivo rejected con gli error-codes', async () => {
  const { fn } = fintoFetch(200, { success: false, 'error-codes': ['timeout-or-duplicate'] })
  const r = await verifyTurnstile('s', true, 'tok', '1.2.3.4', fn)
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'rejected')
  assert.deepEqual(r.codes, ['timeout-or-duplicate'])
})

test('risposta HTTP non 2xx: motivo http_<stato>', async () => {
  const { fn } = fintoFetch(503, { success: true })
  const r = await verifyTurnstile('s', true, 'tok', '1.2.3.4', fn)
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'http_503')
})

test('timeout: motivo timeout_<ms>ms', async () => {
  // Il timer di AbortSignal.timeout non tiene vivo il processo (unref):
  // un timer normale lo fa finche' arriva l'abort.
  const lento = ((_u: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_ok, ko) => {
      const vivo = setTimeout(() => {}, 5000)
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(vivo)
        ko(init.signal?.reason)
      })
    })) as typeof fetch
  const r = await verifyTurnstile('s', true, 'tok', '1.2.3.4', lento, 20)
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'timeout_20ms')
})

test('errore di rete: motivo network:<codice>', async () => {
  const rotto = (async () => {
    throw new TypeError('fetch failed', { cause: { code: 'ENETUNREACH' } })
  }) as typeof fetch
  const r = await verifyTurnstile('s', true, 'tok', '1.2.3.4', rotto)
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'network:ENETUNREACH')
})
