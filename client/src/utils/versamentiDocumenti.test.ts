// Test di modelli, allegati CSV ed EML del modulo Versamenti enti.
// Si lanciano con:  npm test --workspace=client
// Dati inventati: matricole 09xxxx, indirizzi .example.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RigaVersamento } from './versamentiCsv.ts'
import { allegatiDefault, completaAllegati, csvBytes, csvTesto, fmtImporto, nomeFile } from './versamentiAllegati.ts'
import { applica, contesto, modelloPer, periodoBreve, periodoFile, periodoFrase, segnapostoIgnoti, SEGNAPOSTO_TESTO, type ModelloVersamento } from './versamentiModelli.ts'
import { codificaOggetto, costruisciEml } from './versamentiEml.ts'

const riga = (p: Partial<RigaVersamento>): RigaVersamento => ({
  ente: 'S90101', descr: 'Sindacato Alfa', voce: '05010', matr: '091001', nome: 'ROSSI MARIO', cf: '',
  cents: 2240, mese: '2025-01', nascita: { ok: true, iso: '1980-01-01', fonte: 'csv' }, ...p,
})

test('periodo: un mese, mesi contigui, mesi sparsi, anni diversi', () => {
  assert.equal(periodoFrase(['2025-07']), 'nel mese di luglio 2025')
  assert.equal(periodoFrase(['2025-01', '2025-02', '2025-03']), 'nei mesi da gennaio a marzo 2025')
  assert.equal(periodoFrase(['2025-01', '2025-03', '2025-05']), 'nei mesi di gennaio, marzo e maggio 2025')
  assert.equal(periodoFrase(['2024-12', '2025-01']), 'nei mesi da dicembre 2024 a gennaio 2025')
  assert.equal(periodoBreve(['2025-01', '2025-02']), 'gennaio 2025 – febbraio 2025')
  assert.equal(periodoFile(['2025-03', '2025-01']), '2025-01_2025-03')
})

test('segnaposto: sostituzione e sconosciuti', () => {
  const ctx = contesto('S90101', 'Sindacato Alfa', [{ cents: 123456 }], ['2025-07'])
  assert.equal(applica('Spett.le {DESCRIZIONE_ENTE} ({CODICE_ENTE}), {PERIODO}: {TOTALE} su {RIGHE} righe', ctx),
    'Spett.le Sindacato Alfa (S90101), nel mese di luglio 2025: 1.234,56 € su 1 righe')
  assert.equal(applica('{IGNOTO}', ctx), '{IGNOTO}')
  assert.deepEqual(segnapostoIgnoti('{PERIODO} {periodo} {X}', SEGNAPOSTO_TESTO), ['periodo', 'X'])
})

test('modello per ente: anteprima > per tutti > rubrica > predefinito', () => {
  const m = (id: string, predefinito = false): ModelloVersamento => ({ id, nome: id, oggetto: '', testo: 'x', allegati: allegatiDefault(), predefinito })
  const modelli = [m('a', true), m('b'), m('c'), m('d')]
  assert.equal(modelloPer('E', { modelli, override: {}, modelloElab: null, modelloEnte: null })?.id, 'a')
  assert.equal(modelloPer('E', { modelli, override: {}, modelloElab: null, modelloEnte: 'b' })?.id, 'b')
  assert.equal(modelloPer('E', { modelli, override: {}, modelloElab: 'c', modelloEnte: 'b' })?.id, 'c')
  assert.equal(modelloPer('E', { modelli, override: { E: 'd' }, modelloElab: 'c', modelloEnte: 'b' })?.id, 'd')
  assert.equal(modelloPer('E', { modelli, override: {}, modelloElab: null, modelloEnte: 'sparito' })?.id, 'a')
})

test('CSV predefinito: come il Java più la data di nascita; il mese solo con più mesi', () => {
  const cfg = allegatiDefault()
  const r = [riga({}), riga({ mese: '2025-02', nome: 'BIANCHI ANNA', nascita: { ok: false, motivo: 'non disponibile' } })]
  assert.deepEqual(csvTesto(r, cfg, true).split('\r\n'), [
    'nome;data_nascita;mese;voce;importo',
    'ROSSI MARIO;01/01/1980;2025-01;05010;22,40',
    'BIANCHI ANNA;;2025-02;05010;22,40',
    '',
  ])
  assert.equal(csvTesto([riga({})], cfg, false).split('\r\n')[0], 'nome;data_nascita;voce;importo')
})

test('CSV personalizzato: colonne, ordine, separatore, decimali, intestazione, virgolette', () => {
  const cfg = allegatiDefault()
  cfg.csv.sep = 'tab'; cfg.csv.decimali = 'punto'; cfg.ordine = 'importo'
  cfg.colonne = cfg.colonne.map(c => ({ ...c, on: ['IMPORTO', 'NOME', 'MATRICOLA'].includes(c.k) }))
  cfg.colonne.sort((a, b) => (a.k === 'IMPORTO' ? -1 : b.k === 'IMPORTO' ? 1 : 0))
  const r = [riga({ cents: 100 }), riga({ cents: 99900, nome: 'D\'ANGELO "CIRO"', matr: '091002' })]
  assert.deepEqual(csvTesto(r, cfg, false).split('\r\n').slice(0, 3), [
    'importo\tnome\tmatricola',
    '999.00\t"D\'ANGELO ""CIRO"""\t091002',
    '1.00\tROSSI MARIO\t091001',
  ])
  cfg.csv.intestazione = false
  assert.equal(csvTesto(r, cfg, false).split('\r\n').length, 3)
})

test('CSV: niente formule nelle celle di testo, importi negativi intatti (F-10)', () => {
  const r = [riga({ nome: '=HYPERLINK("x")', voce: '+1', cents: -3500 })]
  const [, l] = csvTesto(r, allegatiDefault(), false).split('\r\n')
  assert.equal(l, `"'=HYPERLINK(""x"")";01/01/1980;'+1;-35,00`)
})

test('modello per ente: un codice ente come «constructor» non pesca dal prototipo', () => {
  const m: ModelloVersamento = { id: 'a', nome: 'a', oggetto: '', testo: 'x', allegati: allegatiDefault(), predefinito: true }
  assert.equal(modelloPer('constructor', { modelli: [m], override: {}, modelloElab: null, modelloEnte: null })?.id, 'a')
  assert.equal(applica('{CONSTRUCTOR}', {}), '{CONSTRUCTOR}')
})

test('CSV: Windows-1252 come il Java, oppure UTF-8 con BOM', () => {
  const cfg = allegatiDefault()
  const r = [riga({ nome: 'NICOLÒ' })]
  const w = csvBytes(r, cfg, false)
  assert.ok(w.includes(0xD2), 'Ò in Windows-1252 è 0xD2')
  cfg.csv.codifica = 'utf8bom'
  const u = csvBytes(r, cfg, false)
  assert.deepEqual([...u.slice(0, 3)], [0xEF, 0xBB, 0xBF])
})

test('importi negli allegati: due decimali, niente notazione scientifica', () => {
  assert.equal(fmtImporto(4550), '45,50')
  assert.equal(fmtImporto(-3500), '-35,00')
  assert.equal(fmtImporto(1234567890), '12345678,90')
  assert.equal(fmtImporto(5, 'punto'), '0.05')
})

test('nomi dei file: segnaposto, caratteri non sicuri, periodo aggiunto per mese', () => {
  const ctx = { CODICE_ENTE: 'S90101', PERIODO_FILE: '2025-03' }
  assert.equal(nomeFile('email_{CODICE_ENTE}', ctx, 'eml', false), 'email_S90101.eml')
  assert.equal(nomeFile('email_{CODICE_ENTE}', ctx, 'eml', true), 'email_S90101_2025-03.eml')
  assert.equal(nomeFile('r_{CODICE_ENTE}_{PERIODO_FILE}', ctx, 'pdf', true), 'r_S90101_2025-03.pdf')
  assert.equal(nomeFile('../x y/{CODICE_ENTE}', ctx, 'csv', false), '.._x_y_S90101.csv')
})

test('allegati salvati prima di una colonna nuova: la colonna arriva spenta', () => {
  const vecchio = allegatiDefault(); vecchio.colonne = vecchio.colonne.filter(c => c.k !== 'COD_FISC')
  const c = completaAllegati(vecchio).colonne.find(x => x.k === 'COD_FISC')
  assert.equal(c?.on, false)
})

test('oggetto: ASCII com\'è, accenti in encoded-word UTF-8, niente a capo iniettati', () => {
  assert.equal(codificaOggetto('Versamenti S90101'), 'Versamenti S90101')
  const enc = codificaOggetto('Dettagli versamento trattenute mensili -  Università Alfa')
  assert.match(enc, /^=\?UTF-8\?B\?/)
  assert.ok(enc.split('\r\n ').every(p => p.length <= 75))
  assert.equal(codificaOggetto('a\r\nBcc: x@y.example'), 'a  Bcc: x@y.example')
})

test('EML: X-Unsent, destinatari, alternative testo/HTML, allegati, mittente facoltativo', () => {
  const eml = costruisciEml({
    a: ['uno@ente.example', 'due@ente.example'], oggetto: 'Prova', testo: 'Spett.le Ente,\nriga 2',
    allegati: [{ nome: 'ente_S90101.csv', bytes: new Uint8Array([65, 66]), tipo: 'text/csv', charset: 'windows-1252' }],
    data: new Date('2026-10-26T10:00:00Z'),
  })
  assert.match(eml, /^MIME-Version: 1\.0\r\nX-Unsent: 1\r\n/)
  assert.ok(!/^From:/m.test(eml), 'senza mittente: niente From')
  assert.match(eml, /^To: uno@ente\.example, due@ente\.example$/m)
  assert.match(eml, /Content-Type: multipart\/alternative/)
  assert.match(eml, /Content-Type: text\/html; charset=UTF-8/)
  assert.match(eml, /Content-Type: text\/csv; charset=windows-1252; name="ente_S90101\.csv"/)
  assert.ok(eml.includes('\r\nQUI=\r\n'), 'allegato in base64')
  const conMittente = costruisciEml({ da: 'ufficio@ateneo.example\r\nBcc: x@y.example', a: ['a@b.example'], oggetto: 'x', testo: 'x', allegati: [] })
  assert.match(conMittente, /^From: ufficio@ateneo\.example  Bcc: x@y\.example$/m)
  assert.ok(!/^Bcc:/m.test(conMittente), 'nessuna intestazione iniettata')
})
