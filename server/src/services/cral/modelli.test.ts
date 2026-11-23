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

test('Esporta elenco (26.11.23): numero progressivo nell\'ordine dell\'elenco', async () => {
  const { COLONNE_ELENCO, elencoSoci } = await import('./esporta.js')
  const col = (ids: string[]) => ids.map(id => COLONNE_ELENCO.find(c => c.id === id)!)
  const p = [{ id: '090002', cognome: 'VERDI', nome: 'Luca' }, { id: '090001', cognome: 'ROSSI', nome: 'Maria' }, { id: 'EXT-0001', cognome: 'BIANCHI', nome: 'Ida' }] as CralSocioRow[]
  const csv = elencoSoci(p, col(['numero', 'cognome', 'nome']), { sedi: [], soci: p } as unknown as Pick<CralStato, 'sedi' | 'soci'>, 'csv', ';', 'Prova').toString('utf8')
  assert.equal(csv, '﻿N.;Cognome;Nome\r\n1;BIANCHI;Ida\r\n2;ROSSI;Maria\r\n3;VERDI;Luca\r\n')
  // nell'Excel il progressivo è un numero, il resto testo
  const xlsx = elencoSoci(p, col(['numero', 'id']), { sedi: [], soci: p } as unknown as Pick<CralStato, 'sedi' | 'soci'>, 'xlsx', ';', 'Prova')
  const XLSX = (await import('xlsx')).default ?? await import('xlsx')
  const ws = XLSX.read(xlsx, { type: 'buffer' }).Sheets['Prova']!
  assert.deepEqual([ws['A2']?.t, ws['A2']?.v, ws['B2']?.t, ws['B2']?.v], ['n', 1, 's', 'EXT-0001'])
})

test('Esporta elenco (26.11.23.1): sede di lavoro e sede di consegna dell\'evento', async () => {
  const { COLONNE_ELENCO, elencoSoci } = await import('./esporta.js')
  const col = (ids: string[]) => ids.map(id => COLONNE_ELENCO.find(c => c.id === id)!)
  const p = [{ id: '090001', cognome: 'ROSSI', nome: 'Maria', sede: 'S1' }, { id: '090002', cognome: 'VERDI', nome: 'Luca', sede: 'S1' }] as CralSocioRow[]
  const st = { sedi: [{ id: 'S1', nome: 'Sede Uno' }, { id: 'S2', nome: 'Sede Due' }], soci: p } as unknown as Pick<CralStato, 'sedi' | 'soci'>
  const csv = elencoSoci(p, col(['cognome', 'sedeNome', 'sedeConsegnaNome']), st, 'csv', ';', 'Prova', new Map([['090002', 'S2']])).toString('utf8')
  assert.equal(csv, '\uFEFFCognome;Sede di lavoro (nome);Sede di consegna (nome)\r\nROSSI;Sede Uno;Sede Uno\r\nVERDI;Sede Uno;Sede Due\r\n')
  // fuori da un evento la sede di consegna è la sede di lavoro
  assert.match(elencoSoci(p, col(['sedeConsegna']), st, 'csv', ';', 'Prova').toString('utf8'), /\r\nS1\r\nS1\r\n$/)
})
