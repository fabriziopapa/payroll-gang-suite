// Test dello ZIP "stored" usato per «un file per ente».
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crc32, zipStore } from './zipStore.ts'

test('CRC-32 standard', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926)
  assert.equal(crc32(new Uint8Array()), 0)
})

test('zip: intestazioni, directory centrale, nomi sicuri e non ripetuti', () => {
  const enc = new TextEncoder()
  const z = zipStore([
    { nome: 'a.csv', bytes: enc.encode('uno') }, { nome: 'a.csv', bytes: enc.encode('due') }, { nome: '../x/y.pdf', bytes: enc.encode('tre') },
  ], new Date(2026, 9, 26, 17, 0, 0))
  const dv = new DataView(z.buffer)
  assert.equal(dv.getUint32(0, true), 0x04034b50)
  const fine = z.length - 22
  assert.equal(dv.getUint32(fine, true), 0x06054b50)
  assert.equal(dv.getUint16(fine + 10, true), 3)
  const testo = new TextDecoder('latin1').decode(z)
  assert.ok(testo.includes('a_2.csv'), 'il secondo a.csv non sovrascrive il primo')
  assert.ok(!testo.includes('../'), 'niente percorsi relativi')
  assert.ok(testo.includes('_x_y.pdf'))
})
