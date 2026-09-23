// ============================================================
// Import anagrafiche XLSX — la nazione del conto (NAZ_IBAN)
//
// Dati SINTETICI: matricole 09xxxx, nominativi dal set di convenzione.
// Il repository e' finto: qui si prova cio' che l'import CONSEGNA al
// persistence layer (nazIban undefined / null / due lettere, impronta),
// non l'SQL. Che undefined non cancelli e null si', lo decide l'ON
// CONFLICT di PgAnagraficheRepository: senza un database di prova non e'
// coperto da questo file.
// ============================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import * as XLSX from 'xlsx'
import {
  importAnagraficheXlsx, leggiNazIban, segmentoHashNazione, nazioniPerMatricola,
} from './importService.js'
import type { AnagraficaInput, IAnagraficheRepository, ImportResult } from '../db/IRepository.js'

/** Repository finto: raccoglie cio' che l'import gli passa. */
function repoFinto() {
  const ricevuti: AnagraficaInput[] = []
  const allineate: Array<Record<string, string | null>> = []
  const repo = {
    async upsertMany(items: AnagraficaInput[]): Promise<ImportResult> {
      ricevuti.push(...items)
      return { inserted: items.length, updated: 0, skipped: 0, errors: [], processedAt: new Date() }
    },
    async allineaNazioni(nazioni: Record<string, string | null>): Promise<number> {
      allineate.push(nazioni)
      return Object.keys(nazioni).length
    },
  } as unknown as IAnagraficheRepository
  return { repo, ricevuti, allineate }
}

/** Un XLSX in memoria con le colonne date. */
function xlsx(righe: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(righe), 'ru')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

const BASE = ['ID_AB', 'MATRICOLA', 'COGNOME', 'NOME', 'DT_NASCITA', 'GENERE', 'COD_FIS', 'RUOLO', 'DT_INIZIO', 'DT_FINE']
const riga = (mat: string, cognome: string, ruolo = 'DR', inizio = '01/11/2025', fine = '') =>
  [99001, mat, cognome, 'ANNA', '01/01/1990', 'F', '', ruolo, inizio, fine]

// ── leggiNazIban: le quattro risposte ────────────────────────
test('leggiNazIban: colonna assente -> undefined (non si tocca)', () => {
  assert.deepEqual(leggiNazIban('IT', false), { nazIban: undefined })
})

test('leggiNazIban: cella vuota -> null (nessuna coordinata, si scrive NULL)', () => {
  assert.deepEqual(leggiNazIban('', true),    { nazIban: null })
  assert.deepEqual(leggiNazIban('   ', true), { nazIban: null })
  assert.deepEqual(leggiNazIban(undefined, true), { nazIban: null })
})

test('leggiNazIban: due lettere, anche minuscole o con spazi', () => {
  assert.deepEqual(leggiNazIban(' lt ', true), { nazIban: 'LT' })
})

test("leggiNazIban: valore sporco -> non si aggiorna, errore che non ripete il valore", () => {
  const r = leggiNazIban('BE76XXXXXXXXXXXXXX', true)
  assert.equal(r.nazIban, undefined)
  assert.ok(r.errore)
  // PRIVACY: se nella colonna finisse un IBAN, il messaggio non lo riporta.
  assert.ok(!r.errore!.includes('BE76'))
})

// ── L'impronta ───────────────────────────────────────────────
test("impronta: la nazione ha un'etichetta, e i tre casi sono distinti", () => {
  assert.equal(segmentoHashNazione(undefined), 'naz:?')
  assert.equal(segmentoHashNazione(null),      'naz:')
  assert.equal(segmentoHashNazione('IT'),      'naz:IT')
})

// Il caso che ha motivato l'etichetta: con la nazione NUDA al posto
// dell'area, un conto italiano produrrebbe la stessa impronta del formato
// precedente (ultimo campo 'IT' in entrambi), l'upsert salterebbe la riga e
// naz_iban non verrebbe mai scritta.
test("impronta: per un conto IT cambia rispetto al formato con l'area", async () => {
  const { repo, ricevuti } = repoFinto()
  await importAnagraficheXlsx(xlsx([[...BASE, 'NAZ_IBAN'], [...riga('090001', 'ROSSI'), 'IT']]), repo)
  const it = ricevuti[0]!
  const campi = ['090001', 'DR', 'ROSSI ANNA', '2025-11-01', '', '', 'F']
  const hashFormatoArea = createHash('sha256').update([...campi, 'IT'].join('|')).digest('hex')
  assert.notEqual(it.hashRecord, hashFormatoArea)
  // Controprova: i campi qui sopra sono proprio quelli dell'import, nello
  // stesso ordine — altrimenti il notEqual sarebbe vero per il motivo sbagliato.
  const hashAtteso = createHash('sha256').update([...campi, 'naz:IT'].join('|')).digest('hex')
  assert.equal(it.hashRecord, hashAtteso)
})

// ── Il file intero ───────────────────────────────────────────
test('file con NAZ_IBAN: IT, SEPA, cella vuota', async () => {
  const { repo, ricevuti } = repoFinto()
  const res = await importAnagraficheXlsx(xlsx([
    [...BASE, 'NAZ_IBAN', 'COORD_ATTIVE'],
    [...riga('090001', 'ROSSI'),   'IT', 1],
    [...riga('090002', 'VERDI'),   'lt', 1],
    [...riga('090003', 'BIANCHI'), '',   0],
  ]), repo)
  assert.deepEqual(ricevuti.map(r => r.nazIban), ['IT', 'LT', null])
  assert.equal(res.errors.length, 0)
  // L'area non si importa piu': non e' nell'input del repository.
  assert.ok(ricevuti.every(r => !('areaConto' in r)))
})

test('file senza NAZ_IBAN (formato SGE precedente): nazione non toccata, nessun avviso', async () => {
  const { repo, ricevuti } = repoFinto()
  const res = await importAnagraficheXlsx(xlsx([BASE, riga('090004', 'FERRARI')]), repo)
  assert.equal(ricevuti[0]!.nazIban, undefined)
  assert.equal(res.errors.length, 0)
})

test("file con AREA_CONTO e senza NAZ_IBAN: l'area si ignora e il referto lo dice", async () => {
  const { repo, ricevuti } = repoFinto()
  const res = await importAnagraficheXlsx(xlsx([
    [...BASE, 'AREA_CONTO'],
    [...riga('090005', 'COLOMBO'), 'EXTRA_UE'],
  ]), repo)
  assert.equal(ricevuti[0]!.nazIban, undefined)
  assert.equal(res.errors.length, 1)
  assert.equal(res.errors[0]!.row, 0)
  assert.match(res.errors[0]!.message, /AREA_CONTO ignorata/)
})

test("valore sporco: la riga si importa, la nazione no, e c'e' un errore di riga", async () => {
  const { repo, ricevuti } = repoFinto()
  const res = await importAnagraficheXlsx(xlsx([
    [...BASE, 'NAZ_IBAN'],
    [...riga('090006', 'ROSSI'), 'ITA'],
    [...riga('090007', 'VERDI'), 'BE'],
  ]), repo)
  assert.equal(ricevuti.length, 2)
  assert.deepEqual(ricevuti.map(r => r.nazIban), [undefined, 'BE'])
  assert.equal(res.errors.length, 1)
  assert.equal(res.errors[0]!.row, 1)
})

// ── Chiave con il ruolo (migrazione 0017) ────────────────────
// Il caso reale: una persona con due rapporti veri che iniziano lo stesso
// giorno, ND e NM. Con la chiave vecchia uno dei due spariva a caso.
test('stesso giorno, ruoli diversi: entrano entrambi, nessun errore', async () => {
  const { repo, ricevuti } = repoFinto()
  const res = await importAnagraficheXlsx(xlsx([
    [...BASE, 'NAZ_IBAN'],
    [...riga('090010', 'VERDI', 'ND', '02/09/2024', ''),           'IT'],
    [...riga('090010', 'VERDI', 'NM', '02/09/2024', '15/05/2025'), 'IT'],
  ]), repo)
  assert.equal(res.errors.length, 0)
  assert.deepEqual(ricevuti.map(r => r.ruolo), ['ND', 'NM'])
})

test('stesso giorno e STESSO ruolo: resta un doppione, segnalato', async () => {
  const { repo } = repoFinto()
  const res = await importAnagraficheXlsx(xlsx([
    [...BASE, 'NAZ_IBAN'],
    [...riga('090011', 'BIANCHI', 'BE', '01/07/2026', '31/12/2027'), 'IT'],
    [...riga('090011', 'BIANCHI', 'BE', '01/07/2026', '30/09/2026'), 'IT'],
  ]), repo)
  assert.equal(res.errors.length, 1)
  assert.match(res.errors[0]!.message, /Chiave duplicata .*RUOLO BE/)
})

// ── La nazione e' della persona ──────────────────────────────
test('la nazione si estende a tutte le righe della matricola', async () => {
  const { repo, allineate } = repoFinto()
  await importAnagraficheXlsx(xlsx([
    [...BASE, 'NAZ_IBAN'],
    [...riga('090012', 'ROSSI', 'DR', '01/11/2022', '31/10/2025'), 'BE'],
    [...riga('090012', 'ROSSI', 'BS', '01/11/2025', ''),           'BE'],
    [...riga('090013', 'VERDI'), ''],
  ]), repo)
  assert.equal(allineate.length, 1)
  assert.deepEqual(allineate[0], { '090012': 'BE', '090013': null })
})

test('file senza NAZ_IBAN: nessun allineamento delle nazioni', async () => {
  const { repo, allineate } = repoFinto()
  await importAnagraficheXlsx(xlsx([BASE, riga('090014', 'FERRARI')]), repo)
  assert.equal(allineate.length, 0)
})

test("due nazioni diverse sulla stessa matricola: non si estende, e si dice", async () => {
  const { repo, allineate } = repoFinto()
  const res = await importAnagraficheXlsx(xlsx([
    [...BASE, 'NAZ_IBAN'],
    [...riga('090015', 'COLOMBO', 'DR', '01/11/2022', '31/10/2025'), 'IT'],
    [...riga('090015', 'COLOMBO', 'BS', '01/11/2025', ''),           'LT'],
  ]), repo)
  assert.deepEqual(allineate[0], {})
  assert.equal(res.errors.length, 1)
  assert.match(res.errors[0]!.message, /nazioni del conto diverse/)
})

test('nazioniPerMatricola: le righe illeggibili non votano', () => {
  assert.deepEqual(
    nazioniPerMatricola([
      { matricola: '090016', nazIban: undefined },
      { matricola: '090016', nazIban: 'IT' },
    ]),
    { nazioni: { '090016': 'IT' }, discordanti: [] },
  )
})
