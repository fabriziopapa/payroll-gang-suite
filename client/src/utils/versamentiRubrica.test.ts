// Test dell'import della rubrica (modulo Versamenti enti). Dati inventati.
// Si lanciano con:  npm test --workspace=client

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anteprimaImport, leggiAbilitato, leggiRubricaCsv } from './versamentiRubrica.ts'

const buf = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

test('rubrica CSV: intestazioni del Java o di PGS, email multiple, abilitato', () => {
  const l = leggiRubricaCsv(buf([
    'ENTE;ENTE_DESCR;EMAIL;ABILITATO',
    'P90150;CRAL Demo;Cral@Ente.example, tesoreria@ente.example;1',
    'A90002;Ente fiscale Demo;;0',
    'S90101;Sindacato Demo;segreteria@sind.example;',
  ].join('\r\n')))
  assert.deepEqual(l.mancanti, [])
  assert.deepEqual(l.errori, [])
  assert.deepEqual(l.righe.map(r => [r.codice, r.email, r.abilitato]), [
    ['P90150', 'cral@ente.example, tesoreria@ente.example', true],
    ['A90002', '', false],
    ['S90101', 'segreteria@sind.example', true],
  ])
})

test('rubrica CSV: righe sbagliate indicate, colonne mancanti', () => {
  const l = leggiRubricaCsv(buf('codice;email;abilitato\r\nX 1;a@b.example;1\r\nP1;rotto;1\r\nP2;a@b.example;forse'))
  assert.deepEqual(l.errori.map(e => e.riga), [2, 3, 4])
  assert.deepEqual(leggiRubricaCsv(buf('ENTE;DESCR\r\nP1;x')).mancanti, ['email'])
  assert.equal(leggiAbilitato('Sì'), true)
  assert.equal(leggiAbilitato('NO'), false)
})

test('anteprima import: nuovi, completati, saltati, come la regola del server', () => {
  const righe = [
    { codice: 'A1', descrizione: '', email: 'a@x.example', abilitato: true },
    { codice: 'B2', descrizione: '', email: 'b@x.example', abilitato: false },
    { codice: 'C3', descrizione: '', email: '', abilitato: false },
    { codice: 'C3', descrizione: '', email: 'dopo@x.example', abilitato: true },
    { codice: 'D4', descrizione: '', email: '', abilitato: false },
  ]
  const a = anteprimaImport(righe, [
    { codice: 'A1', email: [], abilitato: true }, { codice: 'B2', email: ['gia@x.example'], abilitato: true },
    { codice: 'D4', email: [], abilitato: false },
  ])
  assert.deepEqual(a.nuovi.map(r => r.codice), ['C3'])
  assert.deepEqual(a.aggiorna.map(r => r.codice), ['A1'])
  assert.deepEqual(a.saltati, ['B2'])
  assert.deepEqual(a.invariati, ['D4'])
  assert.equal(a.conEmail, 1)
  assert.equal(a.disabilitati, 1)
})

test('rubrica CSV: indirizzi non ASCII (omografi) scartati e mostrati in chiaro', () => {
  const l = leggiRubricaCsv(buf('codice;email\r\nP1;tesoreria@un\u0456versita.example\r\nP2;a@ente\u200b.example\r\nP3;ok@xn--ent-6ma.example'))
  assert.deepEqual(l.errori.map(e => e.riga), [2, 3])
  assert.match(l.errori[0]!.motivo, /un\\u0456versita/)
  assert.deepEqual(l.righe.map(r => r.codice), ['P3'])
})
