// Test della Consultazione (modulo Versamenti enti). Dati inventati:
// matricole 09xxxx, nessun codice fiscale vero.
// Si lanciano con:  npm test --workspace=client

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RigaVersamento } from './versamentiCsv.ts'
import {
  cfgExport, chiaviRicerca, csvSelezione, entiDelFile, filtra, normalizza, opzioniExportDefault, ordinaPersone,
  ordinaRighe, perEnte, raggruppaPersone, riepilogo, somme,
} from './versamentiConsultazione.ts'

const riga = (p: Partial<RigaVersamento>): RigaVersamento => ({
  ente: 'S90101', descr: 'Sindacato Alfa', voce: '05010', matr: '091001', nome: 'ROSSI MARIO', cf: '',
  cents: 2240, mese: '2025-01', nascita: { ok: true, iso: '1980-01-01', fonte: 'csv' }, ...p,
})
const RIGHE: RigaVersamento[] = [
  riga({}),                                                                        // 0
  riga({ mese: '2025-02' }),                                                       // 1
  riga({ ente: 'S90120', descr: 'Finanziaria Beta', voce: '05120', cents: 18000 }), // 2
  riga({ matr: '091002', nome: 'ESPOSITO NICOLÒ', cents: 1530 }),                  // 3
  riga({ matr: '091002', nome: 'ESPOSITO NICOLÒ', mese: '2025-02', cents: 1530 }), // 4
  riga({ matr: '091003', nome: 'BIANCHI ANNA', ente: 'S90120', descr: 'Finanziaria Beta', voce: '05120', cents: -3500 }), // 5
]
const TUTTI = new Set(['2025-01', '2025-02'])
const chiavi = chiaviRicerca(RIGHE)
const f = (p: Partial<Parameters<typeof filtra>[2]>) => filtra(RIGHE, chiavi, { mesi: TUTTI, enti: new Set(), voce: '', testo: '', ...p })

test('ricerca: piu\' parole, senza accenti, per matricola, con mesi, enti e voce', () => {
  assert.equal(normalizza('Nicolò'), 'nicolo')
  assert.deepEqual(f({ testo: 'nicolo esposito' }), [3, 4])
  assert.deepEqual(f({ testo: '091003' }), [5])
  assert.deepEqual(f({ testo: 'rossi', mesi: new Set(['2025-02']) }), [1])
  assert.deepEqual(f({ enti: new Set(['S90120']) }), [2, 5])
  assert.deepEqual(f({ voce: '05120', testo: 'rossi' }), [2])
  assert.deepEqual(f({ testo: 'nessuno' }), [])
})

test('persone: una per matricola+nome, con enti, mesi, righe e totale', () => {
  const p = raggruppaPersone(RIGHE, f({}))
  const rossi = p.find(x => x.matr === '091001')!
  assert.deepEqual(rossi.idx, [0, 1, 2])
  assert.deepEqual(rossi.enti, ['S90101', 'S90120'])
  assert.deepEqual(rossi.mesi, ['2025-01', '2025-02'])
  assert.equal(rossi.cents, 2240 + 2240 + 18000)
  assert.deepEqual(ordinaPersone(p, { k: 'cents', dir: -1 }).map(x => x.matr), ['091001', '091002', '091003'])
  assert.deepEqual(ordinaPersone(p, { k: 'nome', dir: 1 }).map(x => x.nome), ['BIANCHI ANNA', 'ESPOSITO NICOLÒ', 'ROSSI MARIO'])
})

test('somme e riepilogo: centesimi esatti, negativi compresi', () => {
  const s = somme(RIGHE, new Set([0, 2, 5]))
  assert.deepEqual(s, { righe: 3, persone: 2, enti: 2, cents: 2240 + 18000 - 3500 })
  // 0,10 + 0,20 non fa 0,30000000000000004
  assert.equal(somme([riga({ cents: 10 }), riga({ cents: 20 })], [0, 1]).cents, 30)
  const r = riepilogo(RIGHE, [0, 1, 2, 5])
  assert.deepEqual(r.perEnte.map(e => [e.codice, e.righe, e.persone, e.cents]), [['S90120', 2, 2, 14500], ['S90101', 2, 1, 4480]])
  assert.deepEqual(r.perMese, [{ mese: '2025-01', righe: 3, cents: 16740 }, { mese: '2025-02', righe: 1, cents: 2240 }])
  assert.deepEqual(entiDelFile(RIGHE, new Set(['2025-02'])), [{ codice: 'S90101', descr: 'Sindacato Alfa', righe: 2, persone: 2, cents: 3770 }])
})

test('ordinamento delle righe e divisione per ente', () => {
  assert.deepEqual(ordinaRighe(RIGHE, [0, 2, 5], { k: 'cents', dir: -1 }), [2, 0, 5])
  assert.deepEqual(ordinaRighe(RIGHE, [0, 2, 5], { k: 'ente', dir: 1 }), [5, 2, 0], 'stesso ente: per nome')
  const g = perEnte(RIGHE, [5, 0, 2])
  assert.deepEqual([...g.keys()], ['S90120', 'S90101'])
  assert.equal(g.get('S90120')!.length, 2)
})

test('CSV della selezione: colonne ente, ordine per ente, codice fiscale solo se scelto, F-10', () => {
  const txt = (b: Uint8Array) => new TextDecoder('windows-1252').decode(b)
  const o = opzioniExportDefault()
  assert.ok(!o.colonne.includes('COD_FISC'), 'il codice fiscale parte spento')
  const righe = [RIGHE[0]!, RIGHE[5]!, riga({ nome: '=HYPERLINK("x")', matr: '091004' })]
  const out = txt(csvSelezione(righe, o)).trim().split('\r\n')
  assert.equal(out[0], 'codice_ente;ente;nominativo;data_nascita;matricola;mese;voce;importo')
  assert.equal(out[1], 'S90120;Finanziaria Beta;BIANCHI ANNA;01/01/1980;091003;2025-01;05120;-35,00', 'prima la Finanziaria (ordine per ente); il negativo resta un numero')
  assert.equal(out[2], `S90101;Sindacato Alfa;"'=HYPERLINK(""x"")";01/01/1980;091004;2025-01;05010;22,40`)
  const conCf = txt(csvSelezione([riga({ cf: 'CODICE-FINTO' })], { ...o, colonne: [...o.colonne, 'COD_FISC'] })).split('\r\n')[0]!
  assert.ok(conCf.includes('codice_fiscale'))
  // l'ordine delle colonne e' fisso, non quello in cui si spuntano
  assert.deepEqual(cfgExport({ ...o, colonne: ['IMPORTO', 'NOME'] }).colonne.map(c => c.k), ['NOME', 'IMPORTO'])
})
