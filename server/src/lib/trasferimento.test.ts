// Test del file cifrato .pgsx e delle impronte (lib/trasferimento.ts).
// Si lanciano con:  npm test --workspace=server

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomInt } from 'node:crypto'
import {
  BYTE_PEZZO, ErroreFile, FORMATO, MAX_BYTE_CHIARO, cifra, decifra, differenzaSchema, fraseBenFormata, generaFrase,
  improntaSchema, improntaSezione, leggiContenuto, nomeFile, normalizzaFrase,
} from './trasferimento.js'

const cral = {
  formato: 'pgs-cral-archivio', versione: 1, app: '26.11.14.4', ambiente: 'prova', esportato: '2026-11-14T16:00:00.000Z', sezioni: ['sedi'],
  sedi: [{ id: 'S1', nome: 'Sede di prova', attiva: true, ordine: 0 }],
}
const schema = improntaSchema([{ versione: '0028', checksum: 'a' }, { versione: '0029', checksum: 'b' }], ['C|t|c|integer|true'])
const contenuto = () => ({
  formato: FORMATO, versione: 1,
  manifesto: {
    app: '26.11.14.4', ambiente: 'prova', esportato: '2026-11-14T16:00:00.000Z', da: 'utente',
    schema, sezioni: { cral: { sha256: improntaSezione(cral), parti: ['sedi'], righe: { sedi: 1 } } },
  },
  sezioni: { cral },
})
const codice = async (f: () => Promise<unknown> | unknown): Promise<string | null> => {
  try { await f(); return null } catch (e) { return e instanceof ErroreFile ? e.codice : `ALTRO: ${(e as Error).message}` }
}

test('frase: forma, entropia, scrittura libera', () => {
  const f = generaFrase()
  assert.match(f, /^([A-Z2-9]{5}-){4}[A-Z2-9]{5}$/)
  assert.doesNotMatch(f, /[ILOU01]/, 'niente caratteri confondibili')
  assert.notEqual(f, generaFrase())
  assert.equal(normalizzaFrase(` ${f.toLowerCase().replace(/-/g, ' ')} `), f.replace(/-/g, ''))
  assert.ok(fraseBenFormata(f) && fraseBenFormata(f.toLowerCase()))
  assert.ok(!fraseBenFormata('password') && !fraseBenFormata(f.slice(0, -1)))
})

test('andata e ritorno; nel file non si legge nulla', async () => {
  const f = generaFrase()
  const file = await cifra(contenuto(), f)
  assert.deepEqual(await decifra(file, f), contenuto())
  assert.deepEqual(await decifra(file, f.toLowerCase().replace(/-/g, ' ')), contenuto(), 'la frase si puo dettare')
  for (const parola of ['Sede di prova', 'pgs-cral-archivio', '26.11.14.4', 'prova', 'utente']) assert.ok(!file.includes(parola), parola)
  assert.equal(file.subarray(0, 4).toString(), 'PGSX')
  const altro = await cifra(contenuto(), f)
  assert.ok(!altro.equals(file) && !altro.subarray(5, 33).equals(file.subarray(5, 33)), 'sale e nonce nuovi a ogni esportazione')
})

test('un bit cambiato, in qualunque punto: rifiutato', async () => {
  const f = generaFrase()
  const file = await cifra(contenuto(), f)
  // tutta l'intestazione, tutto il sigillo, 24 punti del corpo
  const punti = [...Array(33).keys(), ...Array.from({ length: 16 }, (_, i) => file.length - 16 + i), ...Array.from({ length: 24 }, () => 33 + randomInt(file.length - 49))]
  for (const p of punti) {
    const m = Buffer.from(file); m[p]! ^= 1 << randomInt(8)
    assert.notEqual(await codice(() => decifra(m, f)), null, `byte ${p}`)
  }
})

test('troncato, allungato, vuoto, non nostro: rifiutato', async () => {
  const f = generaFrase()
  const file = await cifra(contenuto(), f)
  for (const n of [0, 4, 5, 32, 33, 48, 49, file.length - 17, file.length - 1]) assert.notEqual(await codice(() => decifra(file.subarray(0, n), f)), null, `taglio a ${n}`)
  assert.equal(await codice(() => decifra(Buffer.concat([file, Buffer.from([0])]), f)), 'FILE_O_FRASE_NON_VALIDI')
  assert.equal(await codice(() => decifra(Buffer.from('{"formato":"pgs-cral-archivio"}'.padEnd(80)), f)), 'FILE_NON_VALIDO')
  const v2 = Buffer.from(file); v2[4] = 2
  assert.equal(await codice(() => decifra(v2, f)), 'VERSIONE_NON_SUPPORTATA')
})

test('frase sbagliata: stesso errore di un file alterato', async () => {
  const f = generaFrase()
  const file = await cifra(contenuto(), f)
  const alterato = Buffer.from(file); alterato[60]! ^= 1
  assert.equal(await codice(() => decifra(file, generaFrase())), 'FILE_O_FRASE_NON_VALIDI')
  assert.equal(await codice(() => decifra(alterato, f)), 'FILE_O_FRASE_NON_VALIDI')
})

test('contenuto gonfiato oltre il limite: fermato alla decompressione', async () => {
  // si costruisce a mano un file autentico che decompresso supera il limite (cifra() lo rifiuterebbe prima)
  const { createCipheriv, randomBytes } = await import('node:crypto')
  const { gzipSync } = await import('node:zlib')
  const argon2 = (await import('argon2')).default
  const f = generaFrase(), sale = randomBytes(16), nonce = randomBytes(12)
  const testa = Buffer.concat([Buffer.from('PGSX'), Buffer.from([1]), sale, nonce])
  const k = await argon2.hash(normalizzaFrase(f), { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, hashLength: 32, raw: true, salt: sale })
  const c = createCipheriv('aes-256-gcm', k, nonce); c.setAAD(testa)
  const corpo = Buffer.concat([c.update(gzipSync(Buffer.alloc(MAX_BYTE_CHIARO + 1024, 0x20))), c.final()])
  const bomba = Buffer.concat([testa, corpo, c.getAuthTag()])
  assert.ok(bomba.length < 200 * 1024, 'il file e piccolo')
  assert.equal(await codice(() => decifra(bomba, f)), 'FILE_TROPPO_GRANDE')
  assert.equal(await codice(() => cifra({ x: 'A'.repeat(MAX_BYTE_CHIARO) }, f)), 'FILE_TROPPO_GRANDE')
})

test('contenuto: il manifesto deve corrispondere alle sezioni', () => {
  assert.deepEqual(leggiContenuto(contenuto()).manifesto.sezioni.cral?.parti, ['sedi'])
  const altraSede = contenuto(); altraSede.sezioni.cral = { ...cral, sedi: [{ id: 'S1', nome: 'Altra', attiva: true, ordine: 0 }] }
  assert.equal(codiceSync(() => leggiContenuto(altraSede)), 'CONTENUTO_NON_VALIDO', 'impronta diversa')
  const senza = contenuto() as { sezioni: { cral?: unknown } }; delete senza.sezioni.cral
  assert.equal(codiceSync(() => leggiContenuto(senza)), 'CONTENUTO_NON_VALIDO', 'sezione dichiarata e assente')
  assert.equal(codiceSync(() => leggiContenuto({ ...contenuto(), formato: 'pgs-cral-archivio' })), 'CONTENUTO_NON_VALIDO')
  assert.equal(codiceSync(() => leggiContenuto(cral)), 'CONTENUTO_NON_VALIDO', 'un archivio CRAL in chiaro non e un file .pgsx')
  assert.equal(codiceSync(() => leggiContenuto(null)), 'CONTENUTO_NON_VALIDO')
})
function codiceSync(f: () => unknown): string | null {
  try { f(); return null } catch (e) { return e instanceof ErroreFile ? e.codice : `ALTRO: ${(e as Error).message}` }
}

test('schema: stesso schema anche se le righe arrivano in altro ordine', () => {
  const a = improntaSchema([{ versione: '0002', checksum: 'y' }, { versione: '0001', checksum: 'x' }], ['K|t|pk|p|PRIMARY KEY (id)', 'C|t|id|integer|true'])
  const b = improntaSchema([{ versione: '0001', checksum: 'x' }, { versione: '0002', checksum: 'y' }], ['C|t|id|integer|true', 'K|t|pk|p|PRIMARY KEY (id)'])
  assert.deepEqual(a, b)
  assert.equal(differenzaSchema(a, b), null)
  assert.equal(a.ultima, '0002')
})

test('schema: ogni differenza si riconosce e si spiega', () => {
  const base = improntaSchema([{ versione: '0028', checksum: 'x' }], ['C|t|id|integer|true'])
  assert.match(differenzaSchema(improntaSchema([{ versione: '0028', checksum: 'x' }, { versione: '0029', checksum: 'z' }], ['C|t|id|integer|true']), base) ?? '', /migrazioni diverse.*0029.*0028/)
  assert.match(differenzaSchema(improntaSchema([{ versione: '0028', checksum: 'ALTRO' }], ['C|t|id|integer|true']), base) ?? '', /contenuto diverso/)
  assert.match(differenzaSchema(improntaSchema([{ versione: '0028', checksum: 'x' }], ['C|t|id|bigint|true']), base) ?? '', /struttura/)
})

test('nome del file e dimensione dei pezzi', () => {
  assert.equal(nomeFile(new Date('2026-11-14T16:05:00Z')), 'pgs-20261114-1705.pgsx')
  assert.ok(Math.ceil(BYTE_PEZZO / 3) * 4 < 1024 * 1024 - 4096, 'un pezzo in base64 sta sotto 1 MB con margine')
})
