import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  abbina, applicaSconto, baseTessera, configSchema, erroreDati, erroreIniziativa, formatTessera, iniziativaSchema,
  numeroTessera, prossimoDopo, sceltaSchema, spezzaNominativo, tesseraDaFile, tesseraRiammissione, unisciDati, usiTolti,
  type AnagraficaCral, type ParametriTessera,
} from './cral.js'

const T: ParametriTessera = { formato: 'NUM', prefisso: 'CRAL-', cifre: 4, prossimo: 56, riammissione: 'NUOVO', sepSuffisso: '/', cifreSuffisso: 2 }

test('tessera: formato numerico e con prefisso', () => {
  assert.equal(formatTessera(T, 42), '0042')
  assert.equal(formatTessera({ ...T, formato: 'PREF' }, 42), 'CRAL-0042')
  assert.equal(numeroTessera(T, '0042/01'), 42)
  assert.equal(numeroTessera({ ...T, formato: 'PREF' }, 'CRAL-0042'), 42)
})

test('tessera: dal libro soci arriva un intero', () => {
  assert.equal(tesseraDaFile(T, '42'), '0042')
  assert.equal(tesseraDaFile(T, ' 264 '), '0264')
  assert.equal(tesseraDaFile(T, '0042/01'), '0042/01')
})

test('tessera: il prossimo numero non ripete una tessera usata', () => {
  assert.equal(prossimoDopo(T, '0070'), 71)
  assert.equal(prossimoDopo(T, '0010'), 56)
})

test('rientro: nuovo numero di default, suffisso a scelta', () => {
  assert.deepEqual(tesseraRiammissione(T, '0042', 0), { tessera: '0056', nuovoNumero: true })
  const S: ParametriTessera = { ...T, riammissione: 'SUFFISSO' }
  assert.deepEqual(tesseraRiammissione(S, '0042', 0), { tessera: '0042/01', nuovoNumero: false })
  assert.deepEqual(tesseraRiammissione(S, '0042', 1), { tessera: '0042/02', nuovoNumero: false })
  assert.deepEqual(tesseraRiammissione({ ...S, cifreSuffisso: 1 }, '0042', 9), { errore: 'SUFFISSI_ESAURITI' })
  assert.equal(baseTessera(S, '0042/03'), '0042')
  assert.equal(baseTessera(S, '0042'), '0042')
})

test('sconto: percentuale, importo fisso per unità, nessuno', () => {
  assert.equal(applicaSconto(18000, { tipo: '%', val: 50 }), 9000)
  assert.equal(applicaSconto(54000, { tipo: '€', val: 2000 }, 3), 48000)
  assert.equal(applicaSconto(1500, { tipo: '€', val: 2000 }), 0)
  assert.equal(applicaSconto(1500, { tipo: 'NO' }), 1500)
  assert.equal(applicaSconto(1500, null), 1500)
})

const evento = (over: Partial<Record<string, unknown>> = {}) => iniziativaSchema.parse({
  tipo: 'PAN', titolo: 'Panettoni 2026', anno: 2026, data: '2026-12-15', scadenza: null, stato: 'APERTA',
  modalita: 'SCELTA', modoPart: 'GRUPPI', gruppi: ['SD', 'SE'], sedi: [], predefinita: 'O1',
  fornitore: '', pagamento: '', note: '', quota: 0,
  config: { opzioni: [{ id: 'O1', etichetta: 'Tradizionale' }, { id: 'O2', etichetta: 'Cioccolato' }] },
  ...over,
})

test('evento: coerenza fra modalità e config', () => {
  assert.equal(erroreIniziativa(evento()), null)
  assert.equal(erroreIniziativa(evento({ predefinita: 'O9' })), 'PREDEFINITA_SCONOSCIUTA')
  assert.equal(erroreIniziativa(evento({ config: { opzioni: [{ id: 'O1', etichetta: 'Una' }] } })), 'OPZIONI_INSUFFICIENTI')
  assert.equal(erroreIniziativa(evento({ modalita: 'TURNI', predefinita: null, config: { periodi: [{ id: 'W1', nome: 'Settimana 1', dal: '2026-06-29', al: '2026-07-03' }] } })), 'QUOTA_MANCANTE')
  assert.equal(erroreIniziativa(evento({ modoPart: 'GRUPPI', gruppi: [] })), 'NESSUN_GRUPPO')
  assert.throws(() => evento({ titolo: 'a\u0000b' }))
  assert.throws(() => evento({ config: { opzioni: [], sconti: { SD: { tipo: '%', val: 150 } } } }))
})

test('scelta: unione delle modifiche, null toglie, zeri spariscono', () => {
  const prima = sceltaSchema.parse({ q: { A: 2, B: 1 }, note: 'x', pagato: true })
  const dopo = unisciDati(prima, sceltaSchema.parse({ q: { A: 0, B: 3 }, note: null }))
  assert.deepEqual(dopo, { q: { B: 3 }, pagato: true })
  assert.throws(() => sceltaSchema.parse({ sconosciuto: 1 }))
})

test('scelta: solo opzioni, prodotti e settimane dell\'evento', () => {
  const c = configSchema.parse({
    opzioni: [{ id: 'O1', etichetta: 'A' }],
    prodotti: [{ id: 'P1', tipologia: 'TER', nome: 'Mele', prezzo: 250, unita: 'kg' }, { id: 'P2', tipologia: 'TER', nome: 'Cassetta', prezzo: 1000, unita: 'cas', max: 2 }],
    periodi: [{ id: 'W1', nome: 'Settimana 1', dal: '2026-06-29', al: '2026-07-03' }],
  })
  assert.equal(erroreDati({ opz: 'O1', q: { P1: 1.5 }, per: { W1: 'P' } }, c), null)
  assert.equal(erroreDati({ opz: 'O2' }, c), 'OPZIONE_SCONOSCIUTA')
  assert.equal(erroreDati({ q: { P2: 1.5 } }, c), 'QUANTITA_NON_INTERA')
  assert.equal(erroreDati({ q: { P2: 3 } }, c), 'OLTRE_IL_MASSIMO')
  assert.equal(erroreDati({ per: { W9: 'P' } }, c), 'PERIODO_SCONOSCIUTO')
  assert.equal(usiTolti(c, { opz: new Set(['O1']), prodotti: new Set(['P1']), periodi: new Set(), articoli: new Set() }), null)
  assert.equal(usiTolti(c, { opz: new Set(['O3']), prodotti: new Set(), periodi: new Set(), articoli: new Set() }), 'OPZIONE_IN_USO')
})

test('nominativo tutto maiuscolo: cognome con le particelle', () => {
  assert.deepEqual(spezzaNominativo('COLOMBO Anna'), ['COLOMBO', 'Anna'])
  assert.deepEqual(spezzaNominativo('DE ROSSI MICHELE'), ['DE ROSSI', 'MICHELE'])
  assert.deepEqual(spezzaNominativo('ROSSI MARIA ROSA'), ['ROSSI', 'MARIA ROSA'])
  assert.deepEqual(spezzaNominativo('DELLA VALLE ANNA'), ['DELLA VALLE', 'ANNA'])
})

// Anagrafica inventata (matricole sintetiche 09xxxx, come da convenzione del progetto)
const A = (matricola: string, cognome: string, nome: string, nascita: string | null = null): AnagraficaCral =>
  ({ matricola, cognNome: `${cognome} ${nome}`, cognome, nome, ruolo: 'ND', druolo: null, idAb: null, nascita, finRap: null })
const ANAG = [
  A('090001', 'COLOMBO', 'ANNA', '1971-05-12'), A('090002', 'COLOMBO', 'ANNA', '1984-11-03'),
  A('090003', 'BIANCHI', 'GIULIA MARIA'), A('090004', "D'ANGELO", 'MARCO', '1970-01-01'), A('090005', 'ROSSI', 'LUCA'),
]
const PM = new Map(ANAG.map(a => [a.matricola, a]))

test('abbinamento: matricola, esatto, parziale, omonimi, data di nascita', () => {
  assert.equal(abbina({ i: 0, nominativo: '', matricola: '90005' }, ANAG, PM).candidati[0]?.matricola, '090005')
  assert.equal(abbina({ i: 0, nominativo: 'ROSSI LUCA' }, ANAG, PM).esito, 'trovato')
  assert.equal(abbina({ i: 0, nominativo: 'DANGELO MARCO' }, ANAG, PM).esito, 'trovato')
  assert.equal(abbina({ i: 0, nominativo: 'BIANCHI GIULIA' }, ANAG, PM).esito, 'parziale')
  assert.equal(abbina({ i: 0, nominativo: 'COLOMBO ANNA' }, ANAG, PM).esito, 'ambiguo')
  const n = abbina({ i: 0, nominativo: 'COLOMBO ANNA', nascita: '1984-11-03' }, ANAG, PM)
  assert.equal(n.esito, 'trovato'); assert.equal(n.via, 'nominativo e data di nascita'); assert.equal(n.candidati[0]?.matricola, '090002')
  assert.equal(abbina({ i: 0, nominativo: "D'ANGELO MARCO", nascita: '1971-02-02' }, ANAG, PM).nascitaDiversa, '1970-01-01')
  assert.equal(abbina({ i: 0, nominativo: 'VERDI CARLA' }, ANAG, PM).esito, 'non-trovato')
  const ign = abbina({ i: 0, nominativo: 'ROSSI LUCA', matricola: '099999' }, ANAG, PM)
  assert.equal(ign.matricolaIgnota, '099999'); assert.equal(ign.esito, 'trovato')
})
