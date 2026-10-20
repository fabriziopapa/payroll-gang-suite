// Test della regola "niente refresh dopo un 401 di login e attivazione".
// Si lanciano con:  npm test --workspace=client

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldRefreshOn401 } from './client.ts'

test('login e attivazione: un 401 non fa partire il refresh', () => {
  assert.equal(shouldRefreshOn401('/auth/login'), false)
  assert.equal(shouldRefreshOn401('/auth/activate'), false)
  assert.equal(shouldRefreshOn401('/auth/login?x=1'), false)
})

test('le altre rotte, compresa /auth/me, continuano a tentare il refresh', () => {
  assert.equal(shouldRefreshOn401('/auth/me'), true)
  assert.equal(shouldRefreshOn401('/bozze'), true)
  assert.equal(shouldRefreshOn401('/settings/public'), true)
})
