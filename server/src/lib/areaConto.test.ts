import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  areaConto, segmentoNomeFile, PREFISSI_SEPA, EPC_VERSIONE,
} from './areaConto.js'

// ── L'elenco: quantita' e contenuto ──────────────────────────
// Il conteggio e' fissato di proposito: EPC v8.0 ha 42 prefissi. Se
// qualcuno ne aggiunge o ne toglie uno per distrazione, questo test cade
// prima che la classificazione cambi in silenzio.
test('EPC v8.0: esattamente 42 prefissi', () => {
  assert.equal(PREFISSI_SEPA.size, 42)
  assert.equal(EPC_VERSIONE, 'v8.0')
})

// ── LA REGRESSIONE CHE CONTA ─────────────────────────────────
// Sei sigle entrate in SEPA fra il 2023 e il 2025 mancavano dall'elenco
// scritto a mano dentro l'estrazione Oracle. Oggi, in produzione, chi e'
// pagato su uno di questi IBAN e' etichettato EXTRA_UE. Non e' un'ipotesi:
// e' quello che fa il CASE attualmente in uso.
test('le sei sigle mancanti in produzione sono SEPA, non EXTRA_UE', () => {
  for (const naz of ['AL', 'GI', 'MD', 'ME', 'MK', 'RS']) {
    assert.equal(areaConto(naz), 'SEPA', `${naz} deve essere SEPA`)
  }
})

// ── Italia ───────────────────────────────────────────────────
test("l'Italia e' un gruppo a se', non SEPA generico", () => {
  assert.equal(areaConto('IT'), 'IT')
  // IT sta anche nell'elenco EPC, ma l'ordine dei controlli la separa:
  // l'ufficio vuole tre gruppi, non due.
  assert.ok(PREFISSI_SEPA.has('IT'))
})

// ── Il conto non sta dove sta la banca ───────────────────────
// Casi reali di settembre 2026: Revolut (REVOITM2) e Poste (BPPIITRRXXX)
// hanno IBAN italiani. Classificare dal BIC li manderebbe fuori
// dall'Italia. Questa funzione riceve la nazione dell'IBAN e nient'altro:
// il BIC non entra, per costruzione.
test('nazione IBAN italiana: resta IT qualunque sia la banca', () => {
  assert.equal(areaConto('IT'), 'IT')
})

// ── SEPA non-italiani visti davvero ──────────────────────────
// In settembre le 16 non italiane erano LT (11) e BE (5).
test('i SEPA realmente incontrati', () => {
  assert.equal(areaConto('LT'), 'SEPA')
  assert.equal(areaConto('BE'), 'SEPA')
})

// ── Fuori area ───────────────────────────────────────────────
test('fuori dai 42 prefissi: EXTRA_UE', () => {
  for (const naz of ['US', 'CN', 'BR', 'AU', 'JP', 'TR', 'RU']) {
    assert.equal(areaConto(naz), 'EXTRA_UE', `${naz} deve essere EXTRA_UE`)
  }
})

// ── I territori francesi d'oltremare ─────────────────────────
// GF GP MQ YT RE BL MF PM non stanno nell'elenco perche' i loro IBAN
// iniziano per FR. Se arrivassero come codice territorio sarebbero
// EXTRA_UE, ed e' corretto: non e' il prefisso di un IBAN.
test('i codici territorio francesi non sono prefissi IBAN', () => {
  assert.equal(areaConto('FR'), 'SEPA')
  assert.equal(areaConto('GP'), 'EXTRA_UE')
})

// ── Assenza: NON_NOTO, e il motivo lo sa chi chiama ──────────
test('assente, vuoto o malformato: NON_NOTO', () => {
  assert.equal(areaConto(null),      'NON_NOTO')
  assert.equal(areaConto(undefined), 'NON_NOTO')
  assert.equal(areaConto(''),        'NON_NOTO')
  assert.equal(areaConto('   '),     'NON_NOTO')
  assert.equal(areaConto('I'),       'NON_NOTO')
  assert.equal(areaConto('ITA'),     'NON_NOTO')  // tre lettere non sono un prefisso IBAN
  assert.equal(areaConto('1T'),      'NON_NOTO')
})

// ── Normalizzazione ──────────────────────────────────────────
test('minuscole e spazi non cambiano la risposta', () => {
  assert.equal(areaConto('it'),   'IT')
  assert.equal(areaConto(' lt '), 'SEPA')
  assert.equal(areaConto('Us'),   'EXTRA_UE')
})

// ── Nome file: l'unico punto dove IT diventa ITA ─────────────
test("'ITA' vive solo nel nome del file", () => {
  assert.equal(segmentoNomeFile('IT'),       'ITA')
  assert.equal(segmentoNomeFile('SEPA'),     'SEPA')
  assert.equal(segmentoNomeFile('EXTRA_UE'), 'EXTRA_UE')
})

// ── Tutti e 42 rispondono ────────────────────────────────────
test('ogni prefisso dell elenco classifica IT o SEPA, mai EXTRA_UE', () => {
  for (const naz of PREFISSI_SEPA) {
    const a = areaConto(naz)
    assert.ok(a === 'IT' || a === 'SEPA', `${naz} ha dato ${a}`)
  }
})
