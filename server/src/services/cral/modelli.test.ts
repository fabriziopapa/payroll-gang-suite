// I modelli Excel dei tracciati si rileggono con lo stesso lettore delle importazioni:
// primo foglio con le sole intestazioni (o una riga per partecipante), nessuna riga vuota in coda.
// Dati SINTETICI.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TRACCIATI_MODELLO, costruisciModello, scriviModello } from './modelli.js'
import { leggiFogli } from './fogli.js'
import type { CralIniziativaRow, CralSocioRow, CralStato } from '../../db/IRepository.js'

const st = { tipologie: [{ id: 'OLI', nome: 'Olio', attiva: true, ordine: 0 }], sedi: [{ id: 'ACT', nome: 'Sede di Via Acton', attiva: true, ordine: 0 }] } as Pick<CralStato, 'tipologie' | 'sedi'>
const ini = {
  titolo: 'Olio nuovo / 2026', modalita: 'ORDINE',
  config: {
    opzioni: [{ id: 'A', etichetta: 'Tradizionale' }, { id: 'B', etichetta: 'Al cioccolato' }],
    prodotti: [{ id: 'L5', tipologia: 'OLI', nome: 'Latta 5 lt', unita: 'pz', max: 3 }, { id: 'M', tipologia: 'TER', nome: 'Mele', unita: 'kg', max: null }],
    periodi: [{ id: 'W1', nome: 'Settimana 1', dal: '2026-06-29', al: '2026-07-03' }, { id: 'W2', nome: 'Settimana 2', dal: '2026-07-06', al: '2026-07-10' }],
  },
} as unknown as CralIniziativaRow
const persone = [{ id: '090002', cognome: 'VERDI', nome: 'Luca' }, { id: '090001', cognome: 'ROSSI', nome: 'Maria' }] as CralSocioRow[]
const leggi = (t: typeof TRACCIATI_MODELLO[number], p: CralSocioRow[] = []) => {
  const m = costruisciModello(t, st, ['T2', 'T3', 'T5'].includes(t) ? ini : null, p, 2026)
  for (const f of m.fogli) for (const r of f.righe) assert.equal(r.length, f.intest.length, `${t} · ${f.nome}: riga lunga come l'intestazione`)
  return { m, fogli: leggiFogli(m.file, scriviModello(m)) }
}

test('ogni tracciato: primo foglio con la sola intestazione, foglio «Esempio» con le stesse colonne', () => {
  for (const t of TRACCIATI_MODELLO) {
    const { m, fogli } = leggi(t); const nomi = Object.keys(fogli)
    assert.equal(nomi[1], 'Esempio', t)
    assert.equal(fogli[nomi[0]!]!.length, 1, `${t}: nessuna riga vuota in coda`)
    assert.deepEqual(fogli[nomi[0]!]![0], fogli['Esempio']![0], t)
    assert.ok(fogli['Esempio']!.length >= 3, t); assert.match(m.file, /^CRAL_T\d_modello[\w-]*\.xlsx$/)
  }
})
test('intestazioni che le importazioni riconoscono', () => {
  assert.deepEqual(leggi('T2').fogli['Risposte']![0], ['ID', 'Telefono', 'Email', 'Nominativo', 'Scelta'])
  assert.deepEqual(leggi('T3').fogli['Ordini']![0], ['ID', 'Telefono', 'Email', 'Nominativo', 'Olio - Latta 5 lt', 'TER - Mele', 'PAGATO', 'NOTE'])
  assert.deepEqual(leggi('T5').fogli['Iscrizioni']![0], ['ID', 'Telefono', 'Email', 'Nominativo', 'Riferimento', 'Settimana 1', 'Settimana 2', 'Versato', 'Note'])
  assert.deepEqual(leggi('T4').fogli['Partecipanti']![0], ['ID', 'Telefono', 'Email', 'Nominativo'])
  assert.ok(leggi('T6').fogli['Soci']![0]!.includes('Consenso telefono'))
  assert.ok(!leggi('T7').fogli['Quote 2026']![0]!.includes('Saldo'))
  assert.deepEqual(leggi('T2').fogli['Opzioni']!.slice(1), [['Tradizionale'], ['Al cioccolato']])
})
test('con i partecipanti: una riga a testa in ordine di nome, ID come testo, niente telefono', () => {
  const { m, fogli } = leggi('T3', persone)
  assert.equal(m.persone, 2); assert.match(m.file, /Olio-nuovo-2026_con-partecipanti/)
  assert.deepEqual(fogli['Ordini'], [['ID', 'Nominativo', 'Olio - Latta 5 lt', 'TER - Mele', 'PAGATO', 'NOTE'], ['090001', 'ROSSI Maria', '', '', '', ''], ['090002', 'VERDI Luca', '', '', '', '']])
  assert.deepEqual(leggi('T5', persone).fogli['Iscrizioni']![1], ['090001', 'ROSSI Maria', '', '', '', '', ''])
  assert.equal(leggi('T1', persone).m.persone, 0) // solo T2, T3, T5
})
