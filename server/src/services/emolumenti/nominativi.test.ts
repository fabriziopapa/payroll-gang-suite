import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizza, tokens, risolviNominativo, risolviElenco, type AnagraficaPerRicerca } from './nominativi.js'

const A = (matricola: string, cognome: string, nome: string, idAb: number | null = null): AnagraficaPerRicerca =>
  ({ matricola, cognNome: `${cognome} ${nome}`, cognome, nome, ruolo: 'DR', idAb })

const ANAG: AnagraficaPerRicerca[] = [
  A('090027', 'VERDI', 'LUIGI', 99005),
  A('090025', 'DANGELO', 'MARCO', 99003),
  A('090031', 'BIANCHI', 'GIULIA', 99009),
  A('090030', 'FERRARI', 'ANNA MARIA', 99008),
  A('090019', 'COLOMBO', 'LUCA', 99010),
  A('090029', 'COLOMBO', 'MARIA', 99007),
]

test('normalizza: via accenti e maiuscole, punteggiatura a spazio', () => {
  assert.equal(normalizza('Perquè-Nò'), 'PERQUE NO')
})

test('normalizza: due grafie per l apostrofo', () => {
  assert.equal(normalizza("D'Angelo  Marco", 'unito'),  'DANGELO MARCO')
  assert.equal(normalizza("D'Angelo  Marco", 'diviso'), 'D ANGELO MARCO')
})

test('tokens: scarta i frammenti di una lettera', () => {
  assert.deepEqual(tokens("D'Angelo Marco", 'diviso'), ['ANGELO', 'MARCO'])
})

// L'apostrofo e' il caso che rompe: le tre grafie devono trovarsi tutte,
// qualunque sia quella in anagrafica e qualunque quella incollata.
test('apostrofo: le tre grafie si trovano fra loro, in ogni combinazione', () => {
  const scritture = ['DANGELO', "D'ANGELO", 'D ANGELO']
  for (const inAnagrafica of scritture) {
    const anag = [A('090025', inAnagrafica, 'MARCO', 99003)]
    for (const cercato of [
      "D'Angelo Marco", 'Dangelo Marco', 'Marco D Angelo', "Marco D'Angelo",
    ]) {
      const r = risolviNominativo(cercato, anag)
      assert.equal(r.esito, 'trovato', `anagrafica "${inAnagrafica}" cercando "${cercato}"`)
      assert.equal(r.candidati[0]!.matricola, '090025')
    }
  }
})

test('ordine invertito: nome cognome risolve come cognome nome', () => {
  const r = risolviNominativo('Giulia Bianchi', ANAG)
  assert.equal(r.esito, 'trovato')
  assert.equal(r.candidati[0]!.matricola, '090031')
})

test('tutto maiuscolo con piu nomi', () => {
  const r = risolviNominativo('FERRARI ANNA MARIA', ANAG)
  assert.equal(r.esito, 'trovato')
  assert.equal(r.candidati[0]!.matricola, '090030')
})

test('cognome parziale su omonimi: ambiguo, mai una scelta a caso', () => {
  const r = risolviNominativo('Colombo', ANAG)
  assert.equal(r.esito, 'ambiguo')
  assert.equal(r.candidati.length, 2)
})

test('la corrispondenza esatta vince sulla parziale', () => {
  const r = risolviNominativo('Colombo Luca', ANAG)
  assert.equal(r.esito, 'trovato')
  assert.equal(r.candidati[0]!.matricola, '090019')
})

test('nome inesistente: non trovato, nessun candidato inventato', () => {
  assert.equal(risolviNominativo('Bianchi Ignazio', ANAG).esito, 'non-trovato')
  assert.deepEqual(risolviNominativo('Bianchi Ignazio', ANAG).candidati, [])
})

test('una matricola al posto del nome si risolve, anche senza zeri davanti', () => {
  assert.equal(risolviNominativo('11524', ANAG).candidati[0]!.matricola, '090027')
  assert.equal(risolviNominativo('090027', ANAG).esito, 'trovato')
})

test('riga vuota: non trovato, senza eccezioni', () => {
  assert.equal(risolviNominativo('   ', ANAG).esito, 'non-trovato')
})

test('elenco: il numero provvedimento resta agganciato alla riga', () => {
  const out = risolviElenco([
    { nominativo: "D'Angelo Marco", numeroProvvedimento: '900002' },
    { nominativo: 'Colombo',             numeroProvvedimento: '900003' },
    { nominativo: 'Chi Sara',           numeroProvvedimento: '900007' },
  ], ANAG)

  assert.equal(out[0]!.esito, 'trovato')
  assert.equal(out[0]!.matricola, '090025')
  assert.equal(out[0]!.numeroProvvedimento, '900002')

  assert.equal(out[1]!.esito, 'ambiguo')
  assert.equal(out[1]!.matricola, null)
  assert.equal(out[1]!.candidati.length, 2)
  assert.equal(out[1]!.numeroProvvedimento, '900003')

  assert.equal(out[2]!.esito, 'non-trovato')
})
