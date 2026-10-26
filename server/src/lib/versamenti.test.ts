// Test delle regole del modulo Versamenti enti (email e modelli).
// Indirizzi e codici inventati: il repository e' pubblico.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizzaEmail, segnapostoIgnoti, modelloSchema, erroreModello, pianoImport, rigaSicura, pulisciRiga, SEGNAPOSTO_TESTO } from './versamenti.js'

test('email: virgole e punti e virgola, spazi, maiuscole e doppioni', () => {
  assert.deepEqual(
    normalizzaEmail(' Segreteria@Ente.example , tesoreria@ente.example; segreteria@ente.example '),
    { ok: true, lista: ['segreteria@ente.example', 'tesoreria@ente.example'] },
  )
  assert.deepEqual(normalizzaEmail(['a@b.example', 'c@d.example']), { ok: true, lista: ['a@b.example', 'c@d.example'] })
})

test('email: vuoto e lecito (ente senza indirizzo)', () => {
  assert.deepEqual(normalizzaEmail(''), { ok: true, lista: [] })
  assert.deepEqual(normalizzaEmail(' , ; '), { ok: true, lista: [] })
})

test('email: un indirizzo sbagliato ferma tutto e viene indicato', () => {
  assert.deepEqual(normalizzaEmail('ok@ente.example, sbagliato.ente.example'), { ok: false, errata: 'sbagliato.ente.example' })
  assert.deepEqual(normalizzaEmail('a b@ente.example'), { ok: false, errata: 'a b@ente.example' })
  assert.deepEqual(normalizzaEmail('x@ente'), { ok: false, errata: 'x@ente' })
})

test('email: al massimo 20 indirizzi', () => {
  const tanti = Array.from({ length: 21 }, (_, i) => `u${i}@ente.example`).join(',')
  assert.deepEqual(normalizzaEmail(tanti), { ok: false, troppe: true })
})

test('segnaposto: solo quelli ammessi, in maiuscolo', () => {
  assert.deepEqual(segnapostoIgnoti('Spett.le {DESCRIZIONE_ENTE} {PERIODO}', SEGNAPOSTO_TESTO), [])
  assert.deepEqual(segnapostoIgnoti('{periodo} {PIPPO} {TOTALE}', SEGNAPOSTO_TESTO), ['periodo', 'PIPPO'])
})

function modelloBase() {
  return modelloSchema.parse({
    nome: 'Prova', oggetto: 'Versamenti {DESCRIZIONE_ENTE}', testo: 'Spett.le {DESCRIZIONE_ENTE}, {PERIODO}.',
    allegati: {
      nomeEml: 'email_{CODICE_ENTE}', nomeAllegati: 'ente_{CODICE_ENTE}_{PERIODO_FILE}', ordine: 'mese',
      csv: { attivo: true, sep: ';', decimali: 'virgola', codifica: 'w1252', intestazione: true },
      pdf: { attivo: true, titolo: "Dettagli per l'ente: {CODICE_ENTE}", orient: 'p', subtotali: true, totale: true },
      colonne: [
        { k: 'NOME', csv: 'nome', pdf: 'Nominativo', on: true },
        { k: 'IMPORTO', csv: 'importo', pdf: 'Importo', on: true },
      ],
    },
  })
}

test('modello valido: nessun errore', () => {
  assert.equal(erroreModello(modelloBase()), null)
})

test('modello: segnaposto sconosciuti nel testo, nel titolo e nei nomi dei file', () => {
  const a = modelloBase(); a.testo += ' {IBAN}'
  assert.equal(erroreModello(a), 'SEGNAPOSTO_SCONOSCIUTO')
  const b = modelloBase(); b.allegati.pdf.titolo = 'Riepilogo {MESE}'
  assert.equal(erroreModello(b), 'SEGNAPOSTO_SCONOSCIUTO')
  const c = modelloBase(); c.allegati.nomeEml = 'email_{DESCRIZIONE_ENTE}'
  assert.equal(erroreModello(c), 'SEGNAPOSTO_FILE_SCONOSCIUTO')
})

test('modello: colonne ripetute o nessuna colonna con allegati attivi', () => {
  const a = modelloBase(); a.allegati.colonne.push({ k: 'NOME', csv: 'n', pdf: 'N', on: false })
  assert.equal(erroreModello(a), 'COLONNE_RIPETUTE')
  const b = modelloBase(); b.allegati.colonne.forEach(c => { c.on = false })
  assert.equal(erroreModello(b), 'NESSUNA_COLONNA')
  b.allegati.csv.attivo = false; b.allegati.pdf.attivo = false
  assert.equal(erroreModello(b), null, 'senza allegati le colonne non contano')
})

test('modello: lo schema rifiuta colonne e opzioni inventate', () => {
  const grezzo = JSON.parse(JSON.stringify(modelloBase()))
  grezzo.allegati.colonne.push({ k: 'IBAN', csv: 'iban', pdf: 'IBAN', on: true })
  assert.equal(modelloSchema.safeParse(grezzo).success, false)
  const g2 = JSON.parse(JSON.stringify(modelloBase())); g2.allegati.csv.sep = '|'
  assert.equal(modelloSchema.safeParse(g2).success, false)
})

test('import rubrica: crea i nuovi, completa chi non ha email, non tocca chi ce l\'ha', () => {
  const r = (codice: string, email: string[], abilitato = true) => ({ codice, descrizione: 'Ente ' + codice, email, abilitato })
  const esistenti = new Map([
    ['A1', { email: [] as string[], abilitato: true }], ['B2', { email: ['x@y.example'], abilitato: true }],
    ['D4', { email: [] as string[], abilitato: false }], ['E5', { email: [] as string[], abilitato: true }],
  ])
  const p = pianoImport([
    r('A1', ['a@ente.example'], false), r('B2', ['nuova@ente.example']), r('C3', []), r('C3', ['dopo@ente.example']),
    r('D4', [], false), r('E5', [], false),
  ], esistenti)
  assert.deepEqual(p.nuovi.map(x => [x.codice, x.email]), [['C3', []]])
  assert.deepEqual(p.aggiorna.map(x => [x.codice, x.abilitato]), [['A1', false], ['E5', false]])
  assert.deepEqual(p.saltati, ['B2'])
  assert.deepEqual(p.invariati, ['D4'], 'niente email e stessa abilitazione: non si riscrive')
})

test('email: solo ASCII — niente omografi, invisibili, controlli, a capo (V-7)', () => {
  for (const x of [
    'tesoreria@un\u0456versita.example',  // «і» cirillica
    'cr\u0430l@ente.example',           // «а» cirillica
    'a@ente\u200b.example',             // spazio a larghezza zero
    'a\u0000@ente.example', 'a@ente.exa\u0001mple', 'a@ente.example\r\nBcc: x@y.example',
    'a@ente\u00a0.example', 'a@ent\u00e8.example',
  ]) assert.equal(normalizzaEmail(x).ok, false, JSON.stringify(x))
  // uno spazio non separabile in coda e' solo spazio: lo toglie il trim
  assert.deepEqual(normalizzaEmail('a@ente.example\u00a0'), { ok: true, lista: ['a@ente.example'] })
  assert.deepEqual(normalizzaEmail("o'neil+cral@xn--ent-6ma.example"), { ok: true, lista: ["o'neil+cral@xn--ent-6ma.example"] })
  const t = performance.now()
  normalizzaEmail(Array.from({ length: 20 }, () => 'a@' + 'a.'.repeat(120) + '1').join(','))
  assert.ok(performance.now() - t < 50, 'regex lineare')
})

test('testi salvati: via NUL, controlli, invisibili e override bidi (V-6)', () => {
  assert.equal(pulisciRiga(' Ente\u0000 demo\r\nBcc\u202e:x\u200b '), 'Ente  demo  Bcc :x')
  assert.equal(rigaSicura(200, 1).safeParse('\u0000\u0001').success, false, 'resta vuoto: rifiutato')
  assert.equal(rigaSicura(5).safeParse('abcdef').success, false)
  const m = modelloSchema.parse({ ...modelloBase(), nome: 'Nome\u0000', testo: 'Riga 1\r\nRiga\u0000 2\u202e' })
  assert.equal(m.nome, 'Nome')
  assert.equal(m.testo, 'Riga 1\r\nRiga 2')
})
