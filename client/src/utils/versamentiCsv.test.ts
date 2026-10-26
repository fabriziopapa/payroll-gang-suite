// Test della lettura della stampa versamenti (modulo Versamenti enti).
// Si lanciano con:  npm test --workspace=client
// Dati inventati: matricole 09xxxx, codici fiscali composti a runtime.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ANNO_PIU_MESE, aggregaEnti, annoDaNomeFile, espandiMesi, periodoDaNomeFile, cfCarattereControllo, colonnaMeseAuto, contaFontiNascita, elabora,
  leggiFile, meseDaNomeFile, nascitaDa, nascitaDaCf, parseCsv, parseData, parseImporto, parseMese,
} from './versamentiCsv.ts'

/** Codice fiscale sintetico valido dai primi 15 caratteri. */
const cf = (c15: string) => c15 + cfCarattereControllo(c15)
const OGGI = new Date('2026-10-26T12:00:00Z')

test('CSV: campi tra virgolette, separatore dentro un campo, righe vuote', () => {
  const r = parseCsv('A;B\r\n"x;y";"z ""q"""\r\n\r\n1;2\r\n', ';')
  assert.deepEqual(r, [['A', 'B'], ['x;y', 'z "q"'], ['1', '2']])
})

test('importi: formato italiano, punto decimale, negativi, non numerici', () => {
  assert.equal(parseImporto('1.234,56'), 123456)
  assert.equal(parseImporto('22,4'), 2240)
  assert.equal(parseImporto('1234.56'), 123456)
  assert.equal(parseImporto('-35,00'), -3500)
  assert.equal(parseImporto(' 10 € '), 1000)
  assert.equal(parseImporto('n.d.'), null)
  assert.equal(parseImporto(''), null)
})

test('mese: formati accettati', () => {
  for (const v of ['202503', '2025-03', '2025/03', '03/2025', '3-2025', '15/03/2025', '2025-03-15', 'MAR 2025', 'marzo 2025']) {
    assert.equal(parseMese(v), '2025-03', v)
  }
  assert.equal(parseMese('13/2025'), null)
  assert.equal(parseMese('boh'), null)
})

test('colonna del mese: ANNO+MESE prima di tutto, poi i nomi noti', () => {
  assert.equal(colonnaMeseAuto(['ENTE', 'ANNO', 'MESE']), ANNO_PIU_MESE)
  assert.equal(colonnaMeseAuto(['ENTE', 'COMPETENZA']), 'COMPETENZA')
  assert.equal(colonnaMeseAuto(['ENTE', 'IMP_TOT']), '')
})

test('mese dal nome del file: il mese prima della data di stampa', () => {
  assert.equal(meseDaNomeFile('STAMPA_VERSAMENTI_20260706_GEN_DIC_2025.CSV'), '2026-06')
  assert.equal(meseDaNomeFile('STAMPA_VERSAMENTI_20260105.CSV'), '2025-12')
  assert.equal(meseDaNomeFile('senza_data.csv'), '')
})

test('data di nascita dal CSV: formati e date impossibili', () => {
  assert.equal(parseData('12/03/1968'), '1968-03-12')
  assert.equal(parseData('12-03-1968'), '1968-03-12')
  assert.equal(parseData('1968-03-12'), '1968-03-12')
  assert.equal(parseData('19680312'), '1968-03-12')
  assert.equal(parseData('31/02/1990'), null)
  assert.equal(parseData(''), null)
})

test('data di nascita dal codice fiscale: uomo, donna (+40), omocodia, controllo', () => {
  assert.equal(nascitaDaCf(cf('RSSMRA80A01F839'), OGGI), '1980-01-01')
  assert.equal(nascitaDaCf(cf('BNCGLI85M41F839'), OGGI), '1985-08-01')
  // omocodia: le cifre di anno e giorno sostituite da lettere (8→U, 0→L, 1→M)
  assert.equal(nascitaDaCf(cf('RSSMRAULALMF839'), OGGI), '1980-01-01')
  // carattere di controllo sbagliato
  const giusto = cf('RSSMRA80A01F839'), sbagliato = giusto.slice(0, 15) + (giusto[15] === 'A' ? 'B' : 'A')
  assert.equal(nascitaDaCf(sbagliato, OGGI), null)
  // secolo: un 2015 farebbe un dipendente di 11 anni → 1915
  assert.equal(nascitaDaCf(cf('RSSMRA15A01F839'), OGGI), '1915-01-01')
  assert.equal(nascitaDaCf(cf('RSSMRA05A01F839'), OGGI), '2005-01-01')
})

test('data di nascita: prima DATA_NASC, poi codice fiscale, poi niente', () => {
  const c = cf('RSSMRA80A01F839')
  assert.deepEqual(nascitaDa('02/02/1970', c), { ok: true, iso: '1970-02-02', fonte: 'csv' })
  assert.deepEqual(nascitaDa('', c), { ok: true, iso: '1980-01-01', fonte: 'cf' })
  assert.deepEqual(nascitaDa('xx', c), { ok: true, iso: '1980-01-01', fonte: 'cf' })
  assert.deepEqual(nascitaDa('', ''), { ok: false, motivo: 'non disponibile' })
  assert.deepEqual(nascitaDa('', 'NONVALIDO'), { ok: false, motivo: 'codice fiscale non valido' })
})

function fileDiProva(): string {
  const c1 = cf('RSSMRA80A01F839'), c2 = cf('BNCGLI85M41F839')
  return [
    'ENTE;ENTE_DESCR;VOCE;MATRICOLA;NOME;COD_FISC;DATA_NASC;IMP_TOT;ANNO;MESE',
    `S90101;Sindacato Alfa;05010;091001;ROSSI MARIO;${c1};;22,40;2025;1`,
    `S90101;Sindacato Alfa;05010;091001;ROSSI MARIO;${c1};;22,40;2025;2`,
    `S90120;Finanziaria Esempio;05120;091002;BIANCHI GIULIA;${c2};01/08/1985;180,00;2025;1`,
    ';;05010;091003;VERDI LUCA;;;10,00;2025;1',
    'S90101;Sindacato Alfa;05010;091004;NERI ANNA;;;n.d.;2025;3',
    'S90101;Sindacato Alfa;05010;091005;GIALLI PIA;;;5,00;2025;13',
  ].join('\r\n')
}

test('elaborazione: righe valide, scartate con motivo, mesi', () => {
  const f = leggiFile('STAMPA_VERSAMENTI_20260706_GEN_DIC_2025.CSV', fileDiProva(), 'UTF-8')
  assert.equal(f.sep, ';')
  const e = elabora(f, colonnaMeseAuto(f.headers), '')
  assert.deepEqual(e.mancanti, [])
  assert.equal(e.righe.length, 3)
  assert.deepEqual(e.mesi, ['2025-01', '2025-02'])
  assert.deepEqual(e.scartate.map(s => [s.riga, s.motivo]), [
    [5, 'ENTE vuoto'], [6, 'IMP_TOT non numerico: «n.d.»'], [7, 'mese non riconosciuto'],
  ])
  const n = contaFontiNascita(e.righe)
  assert.deepEqual(n, { csv: 1, cf: 1, no: 0, persone: 2 })
})

test('elaborazione: colonne obbligatorie mancanti', () => {
  const f = leggiFile('x.csv', 'ENTE;NOME;IMP_TOT\r\nS1;A;1,00', 'UTF-8')
  assert.deepEqual(elabora(f, '', '2025-01').mancanti, ['ENTE_DESCR', 'VOCE', 'MATRICOLA'])
})

test('elaborazione: file di un solo mese senza colonna del mese', () => {
  const f = leggiFile('x.csv', 'ENTE;ENTE_DESCR;VOCE;MATRICOLA;NOME;IMP_TOT\r\nS1;Ente;V;091001;A;1,00', 'UTF-8')
  const e = elabora(f, '', '2025-06')
  assert.equal(e.righe[0]?.mese, '2025-06')
  assert.equal(elabora(f, '', '').scartate[0]?.motivo, 'mese non indicato')
})

test('aggregazione per ente sui mesi selezionati', () => {
  const f = leggiFile('x.csv', fileDiProva(), 'UTF-8')
  const e = elabora(f, ANNO_PIU_MESE, '')
  const tutti = aggregaEnti(e.righe, new Set(e.mesi))
  const alfa = tutti.find(x => x.codice === 'S90101')!
  assert.equal(alfa.cents, 4480); assert.deepEqual(alfa.mesi, ['2025-01', '2025-02'])
  const soloFeb = aggregaEnti(e.righe, new Set(['2025-02']))
  assert.deepEqual(soloFeb.map(x => x.codice), ['S90101'])
})

test('anno dal nome del file: l\'ultimo anno che non fa parte di una data', () => {
  assert.equal(annoDaNomeFile('STAMPA_VERSAMENTI_20260706_GEN_DIC_2025.CSV'), '2025')
  assert.equal(annoDaNomeFile('STAMPA_VERSAMENTI_20260706.CSV'), '2026')
  assert.equal(annoDaNomeFile('versamenti.csv'), '')
})

test('colonna MESE con il solo numero del mese (stampa CSA): l\'anno viene dal campo anno', () => {
  const testo = [
    'MESE;ENTE;ENTE_DESCR;VOCE;MATRICOLA;NOME;DATA_NASC;IMP_TOT;',
    '09;P90150;CRAL Demo;00854 - Quota C.R.A.L.;091001;ROSSI MARIO;19571218;5;',
    '1;P90150;CRAL Demo;00854 - Quota C.R.A.L.;091001;ROSSI MARIO;19571218;5;',
  ].join('\r\n')
  const f = leggiFile('STAMPA_VERSAMENTI_20260706_GEN_DIC_2025.CSV', testo, 'Windows-1252')
  assert.equal(colonnaMeseAuto(f.headers), 'MESE')
  const e = elabora(f, 'MESE', '', '2025')
  assert.equal(e.serveAnno, true)
  assert.deepEqual(e.mesi, ['2025-01', '2025-09'])
  assert.deepEqual(e.righe[0]?.nascita, { ok: true, iso: '1957-12-18', fonte: 'csv' })
  const senza = elabora(f, 'MESE', '', '')
  assert.equal(senza.righe.length, 0)
  assert.equal(senza.scartate[0]?.motivo, "mese senza anno: indica l'anno")
})

test('periodo dal nome del file e mesi compresi', () => {
  assert.deepEqual(periodoDaNomeFile('STAMPA_VERSAMENTI_20260706_GEN_DIC_2025.CSV'), { da: '2025-01', a: '2025-12' })
  assert.deepEqual(periodoDaNomeFile('STAMPA_VERSAMENTI_20260105_NOV_DIC_2025.CSV'), { da: '2025-11', a: '2025-12' })
  assert.deepEqual(periodoDaNomeFile('STAMPA_VERSAMENTI_20260105_NOV_2025.CSV'), { da: '2025-11', a: '2025-11' })
  assert.equal(periodoDaNomeFile('STAMPA_VERSAMENTI_20260105.CSV'), null)
  assert.deepEqual(espandiMesi('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02'])
  assert.deepEqual(espandiMesi('2025-05', '2025-03'), ['2025-05'])
})

test('file senza colonna del mese: importi sul periodo «da … a …», scritto nella mail', () => {
  const testo = [
    'ENTE;ENTE_DESCR;VOCE;MATRICOLA;NOME;DATA_NASC;IMP_TOT;',
    'P90150;CRAL Demo;00854 - Quota C.R.A.L.;091001;ROSSI MARIO;19571218;10;',
  ].join('\r\n')
  const f = leggiFile('STAMPA_VERSAMENTI_20260105_NOV_DIC_2025.CSV', testo, 'Windows-1252')
  assert.equal(colonnaMeseAuto(f.headers), '')
  const e = elabora(f, '', '2025-11', '', '2025-12')
  assert.deepEqual(e.periodo, ['2025-11', '2025-12'])
  assert.equal(e.righe.length, 1)
  const [a] = aggregaEnti(e.righe, new Set(e.mesi), e.periodo)
  assert.deepEqual(a?.mesi, ['2025-11'])
  assert.deepEqual(a?.periodo, ['2025-11', '2025-12'])
  // con la colonna del mese il periodo e' quello dei mesi
  assert.equal(elabora(leggiFile('x.csv', fileDiProva(), 'UTF-8'), ANNO_PIU_MESE, '').periodo, null)
})

test('mese mancante: proposta dal nome del file, stima dalla data di stampa, niente', async () => {
  const { propostaPeriodo, errorePeriodo } = await import('./versamentiCsv.ts')
  assert.deepEqual(propostaPeriodo('STAMPA_VERSAMENTI_20260706_GEN_DIC_2025.CSV'), { da: '2025-01', a: '2025-12', fonte: 'nome' })
  assert.deepEqual(propostaPeriodo('STAMPA_VERSAMENTI_20260706_NOV_2025.CSV'), { da: '2025-11', a: '2025-11', fonte: 'nome' })
  assert.deepEqual(propostaPeriodo('STAMPA_VERSAMENTI_20260706.CSV'), { da: '2026-06', a: '2026-06', fonte: 'stima' })
  assert.deepEqual(propostaPeriodo('versamenti.csv'), { da: '', a: '', fonte: 'nessuna' })
  assert.equal(errorePeriodo('2025-03', '2025-03'), null)
  assert.equal(errorePeriodo('', ''), 'Indica il mese.')
  assert.equal(errorePeriodo('2025-13', '2025-13'), 'Indica il mese.')
  assert.equal(errorePeriodo('2025-05', '2025-02'), 'Il mese finale viene prima di quello iniziale.')
  assert.equal(errorePeriodo('2020-01', '2025-12'), 'Periodo troppo lungo (oltre cinque anni).')
  assert.equal(errorePeriodo('1989-12', '1989-12'), 'Indica il mese.')
})
