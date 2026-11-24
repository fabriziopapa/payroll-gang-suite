import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  abbina, allineaQuoteSchema, applicaSconto, azioneVietata, azioniScelta, baseTessera, confezioniUsate, copiaEventoSchema, erroreLuogo, PERMESSI_REGOLA, statoEventoSchema, configSchema, erroreAllinea, erroreDati, erroreIniziativa, formatTessera, iniziativaSchema,
  numeroTessera, prossimoDopo, quotaDopoModifica, rataMese, sceltaSchema, versato, spezzaNominativo, tesseraDaFile, tesseraNelFormato, tesseraRiammissione, unisciDati, usiTolti,
  type AnagraficaCral, type ParametriTessera,
} from './cral.js'

const T: ParametriTessera = { formato: 'NUM', prefisso: 'CRAL-', cifre: 4, prossimo: 56, riammissione: 'NUOVO', sepSuffisso: '/', cifreSuffisso: 2, vincolante: false }

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

test('quota a mano (0024): accendere un mese registra la rata, spegnerlo la azzera; unica soluzione', () => {
  const q0 = { modo: 'MENSILE' as const, mesi: Array<boolean>(12).fill(false), importi: Array<number>(12).fill(0), pagataIl: null, versatoUnica: null, note: '' }
  const q1 = quotaDopoModifica(q0, { mesi: [true, true, ...Array<boolean>(10).fill(false)] }, 6000)
  assert.deepEqual(q1.importi.slice(0, 3), [500, 500, 0]); assert.equal(versato(q1), 1000)
  const q2 = quotaDopoModifica({ ...q1, importi: [700, 500, ...Array<number>(10).fill(0)] }, { mesi: [true, false, ...Array<boolean>(10).fill(false)] }, 6000)
  assert.deepEqual(q2.importi.slice(0, 2), [700, 0], 'un importo maggiore della rata resta')
  const q3 = quotaDopoModifica(q0, { pagataIl: '2026-03-01' }, 6000)
  assert.equal(q3.versatoUnica, 6000); assert.equal(quotaDopoModifica(q3, { pagataIl: null }, 6000).versatoUnica, null)
  assert.equal(rataMese(6001, 11), 6001 - 11 * 500)
  const q4 = quotaDopoModifica(q0, { importi: [6000, ...Array<number>(11).fill(0)] }, 6000)
  assert.ok(q4.mesi.every(Boolean), 'un versamento della quota annua copre tutto l\'anno')
})

test('tessera nel formato (26.11.11.2): spento come prima, acceso completa o rifiuta', () => {
  // spento: com'e', tolti gli spazi
  assert.deepEqual(tesseraNelFormato(T, ' 175 '), { tessera: '175' })
  assert.deepEqual(tesseraNelFormato(T, 'A12'), { tessera: 'A12' })
  const V = { ...T, vincolante: true }
  assert.deepEqual(tesseraNelFormato(V, '175'), { tessera: '0175' })
  assert.deepEqual(tesseraNelFormato(V, '1'), { tessera: '0001' })
  assert.deepEqual(tesseraNelFormato(V, '0175'), { tessera: '0175' })
  assert.deepEqual(tesseraNelFormato(V, '9999'), { tessera: '9999' })
  assert.deepEqual(tesseraNelFormato(V, ''), { tessera: '' })
  assert.match((tesseraNelFormato(V, '12345') as { errore: string }).errore, /al massimo 4 cifre/)
  assert.match((tesseraNelFormato(V, '0') as { errore: string }).errore, /parte da 1/)
  assert.match((tesseraNelFormato(V, 'A12') as { errore: string }).errore, /formato 0042/)
  assert.ok('errore' in tesseraNelFormato(V, '0175/01'))
  assert.ok('errore' in tesseraNelFormato(V, '01 75'))
  // con la parte testuale
  const P = { ...V, formato: 'PREF' as const }
  assert.deepEqual(tesseraNelFormato(P, '175'), { tessera: 'CRAL-0175' })
  assert.deepEqual(tesseraNelFormato(P, 'cral-0175'), { tessera: 'CRAL-0175' })
  assert.ok('errore' in tesseraNelFormato(P, 'XX-0175'))
  // col suffisso del rientro
  const S = { ...V, riammissione: 'SUFFISSO' as const }
  assert.deepEqual(tesseraNelFormato(S, '0042/01'), { tessera: '0042/01' })
  assert.match((tesseraNelFormato(S, '42/1') as { errore: string }).errore, /al rientro 0042\/01/)
  const S0 = { ...S, sepSuffisso: '' as const }
  assert.deepEqual(tesseraNelFormato(S0, '004201'), { tessera: '004201' })
  assert.deepEqual(tesseraNelFormato(S0, '42'), { tessera: '0042' })
})

test('quote (0028): «Allinea soci» accetta solo soci, uno per volta, e vuole il motivo', () => {
  const ok = allineaQuoteSchema.parse({ voci: [{ socio: '090001', stato: 'NON_DOVUTA', motivo: '  inserita per errore ' }, { socio: 'EXT-0003', stato: 'DOVUTA', motivo: '' }] })
  assert.equal(ok.voci[0]!.motivo, 'inserita per errore')
  assert.equal(erroreAllinea(ok.voci), null)
  // un familiare non ha quota; uno stato inventato non passa; campi in piu' nemmeno
  assert.ok(!allineaQuoteSchema.safeParse({ voci: [{ socio: 'FAM-0001', stato: 'ESENTE', motivo: 'x' }] }).success)
  assert.ok(!allineaQuoteSchema.safeParse({ voci: [{ socio: '090001', stato: 'GRATIS', motivo: 'x' }] }).success)
  assert.ok(!allineaQuoteSchema.safeParse({ voci: [{ socio: '090001', stato: 'ESENTE', motivo: 'x', anno: 2025 }] }).success)
  assert.ok(!allineaQuoteSchema.safeParse({ voci: [] }).success)
  // esente e non dovuta senza motivo (anche di soli spazi), stesso socio due volte
  assert.equal(erroreAllinea(allineaQuoteSchema.parse({ voci: [{ socio: '090001', stato: 'ESENTE', motivo: '   ' }] }).voci), 'MOTIVO_MANCANTE')
  assert.equal(erroreAllinea([{ socio: '090001', stato: 'DOVUTA', motivo: '' }, { socio: '090001', stato: 'ESENTE', motivo: 'x' }]), 'SOCI_RIPETUTI')
  // tornare dovuta non chiede il motivo
  assert.equal(erroreAllinea([{ socio: '090001', stato: 'DOVUTA', motivo: '' }]), null)
})

test('stati (0030): cosa permette ogni regola', () => {
  assert.equal(azioneVietata('RACCOLTA', ['raccolta', 'gestione', 'consegna']), null)
  assert.equal(azioneVietata('PREPARAZIONE', ['raccolta', 'gestione']), null)
  assert.equal(azioneVietata('PREPARAZIONE', ['consegna']), 'consegna', 'in bozza le consegne non si registrano')
  assert.equal(azioneVietata('RACCOLTA_CHIUSA', ['gestione', 'consegna']), null, 'a raccolta chiusa si consegna e si incassa')
  assert.equal(azioneVietata('RACCOLTA_CHIUSA', ['consegna', 'raccolta']), 'raccolta')
  for (const r of ['SOSPESO', 'CONCLUSO', 'ANNULLATO']) for (const a of ['raccolta', 'gestione', 'consegna'] as const) assert.equal(azioneVietata(r, [a]), a, `${r}: ${a}`)
  assert.equal(azioneVietata(null, ['gestione']), 'gestione', 'stato sconosciuto: nulla')
  assert.equal(azioneVietata('SOSPESO', []), null, 'nessuna azione: nulla da vietare')
  assert.deepEqual(Object.keys(PERMESSI_REGOLA).sort(), ['ANNULLATO', 'CONCLUSO', 'PREPARAZIONE', 'RACCOLTA', 'RACCOLTA_CHIUSA', 'SOSPESO'])
})

test('stati (0030): che cosa tocca una modifica ai dati di una persona', () => {
  const a = (prima: Record<string, unknown> | undefined, dopo: Record<string, unknown>) => [...azioniScelta(prima, dopo)].sort()
  assert.deepEqual(a(undefined, { opz: 'A' }), ['raccolta'])
  assert.deepEqual(a({ opz: 'A' }, { opz: 'A', consegnato: true }), ['consegna'])
  assert.deepEqual(a({ q: { P1: 2 } }, { q: { P1: 2 }, pagato: true, note: 'resto 5 €' }), ['gestione'])
  assert.deepEqual(a({ q: { P1: 2 } }, { q: { P1: 3 } }), ['raccolta'])
  // campi: una settimana nuova o tolta del tutto è raccolta; Prenotata → Frequentata o Tolta è consegna
  assert.deepEqual(a({ per: { W1: 'P' } }, { per: { W1: 'P', W2: 'P' } }), ['raccolta'])
  assert.deepEqual(a({ per: { W1: 'P' } }, { per: { W1: 'F' } }), ['consegna'])
  assert.deepEqual(a({ per: { W1: 'P' } }, { per: { W1: 'T' } }), ['consegna'])
  assert.deepEqual(a({ per: { W1: 'P' } }, { per: {} }), ['raccolta'])
  assert.deepEqual(a({ per: { W1: 'P' }, versato: 0 }, { per: { W1: 'P' }, versato: 18000 }), ['gestione'])
  // nulla di cambiato, o vuoti equivalenti: nessuna azione
  assert.deepEqual(a({ opz: 'A', consegnato: false }, { opz: 'A' }), [])
  assert.deepEqual(a({ fonte: 'modulo', opz: 'A' } as Record<string, unknown>, { opz: 'A' }), [])
  // scelta e consegna insieme
  assert.deepEqual(a(undefined, { opz: 'B', consegnato: true }), ['consegna', 'raccolta'])
})

test('stati (0030): schema di uno stato e della copia', () => {
  assert.ok(statoEventoSchema.safeParse({ nome: 'In consegna', colore: '#7C3AED', regola: 'RACCOLTA_CHIUSA' }).success)
  assert.ok(!statoEventoSchema.safeParse({ nome: 'X', colore: '#7C3AED', regola: 'APERTISSIMO' }).success)
  assert.ok(!statoEventoSchema.safeParse({ nome: '  ', colore: '#7C3AED', regola: 'RACCOLTA' }).success)
  const evento = {
    tipo: 'PAN', titolo: 'Panettoni 2026', anno: 2026, data: '2026-12-18', scadenza: null, stato: 'BOZZA', modalita: 'SCELTA', modoPart: 'SINGOLI',
    gruppi: [], sedi: [], predefinita: 'O1', fornitore: '', pagamento: '', note: '', quota: 0,
    config: { opzioni: [{ id: 'O1', etichetta: 'Tradizionale' }, { id: 'O2', etichetta: 'Cioccolato' }] },
  }
  const ok = copiaEventoSchema.parse({ da: '8b0f6c1e-5d2a-4c3b-9a1e-0f2d3c4b5a69', evento, partecipanti: ['090001', 'EXT-0002', 'FAM-0003'], scelte: [{ socio: '090001', opz: 'O2' }] })
  assert.equal(ok.evento.stato, 'BOZZA'); assert.equal(ok.partecipanti.length, 3)
  assert.ok(copiaEventoSchema.safeParse({ da: '8b0f6c1e-5d2a-4c3b-9a1e-0f2d3c4b5a69', evento: { ...evento, stato: 'CONSEGNA' } }).success, 'uno stato nuovo di Parametri')
  assert.ok(!copiaEventoSchema.safeParse({ da: 'non-un-uuid', evento }).success)
  assert.ok(!copiaEventoSchema.safeParse({ da: '8b0f6c1e-5d2a-4c3b-9a1e-0f2d3c4b5a69', evento: { ...evento, stato: 'bozza' } }).success)
  assert.ok(!copiaEventoSchema.safeParse({ da: '8b0f6c1e-5d2a-4c3b-9a1e-0f2d3c4b5a69', evento, scelte: [{ socio: '090001', opz: 'O2', pagato: true }] }).success, 'dalla copia arriva solo l\'opzione')
})

test('sede di consegna (26.11.23.1): una sede dell\'elenco, attiva, solo dove si consegna per sede; conta come gestione', () => {
  const sedi = [{ id: 'S1', attiva: true }, { id: 'S2', attiva: false }]
  assert.equal(erroreLuogo('S1', undefined, 'SCELTA', sedi), null)
  assert.equal(erroreLuogo(undefined, 'S1', 'ORDINE', sedi), null, 'togliere si può sempre')
  assert.equal(erroreLuogo('S9', undefined, 'NESSUNA', sedi), 'SEDE_SCONOSCIUTA')
  assert.equal(erroreLuogo('S2', undefined, 'SCELTA', sedi), 'SEDE_NON_ATTIVA')
  assert.equal(erroreLuogo('S2', 'S2', 'SCELTA', sedi), null, 'chi ce l\'ha già la tiene anche se la sede è stata disattivata')
  assert.equal(erroreLuogo('S1', undefined, 'TURNI', sedi), 'LUOGO_NON_AMMESSO')
  assert.equal(erroreLuogo('S1', undefined, 'MAGAZZINO', sedi), 'LUOGO_NON_AMMESSO')
  assert.ok(sceltaSchema.safeParse({ luogo: 'S1' }).success); assert.ok(!sceltaSchema.safeParse({ luogo: 's 1' }).success); assert.ok(sceltaSchema.safeParse({ luogo: null }).success)
  // cambiarla è come pagamenti e note: si fa anche a raccolta chiusa, non da sospeso
  assert.deepEqual([...azioniScelta({ opz: 'O1' }, { opz: 'O1', luogo: 'S1' })], ['gestione'])
  assert.deepEqual([...azioniScelta({ luogo: 'S1' }, {})], ['gestione'])
  assert.equal(azioneVietata('RACCOLTA_CHIUSA', ['gestione']), null)
  assert.ok(azioneVietata('SOSPESO', ['gestione']))
  // copia: per persona la scelta, la sede o tutte e due; mai nessuna delle due
  const ev = { tipo: 'PAN', titolo: 'X', anno: 2026, data: '2026-12-18', scadenza: null, stato: 'BOZZA', modalita: 'SCELTA', modoPart: 'SINGOLI', gruppi: [], sedi: [], predefinita: null, fornitore: '', pagamento: '', note: '', quota: 0, config: { opzioni: [{ id: 'O1', etichetta: 'A' }, { id: 'O2', etichetta: 'B' }] } }
  const da = '11111111-1111-4111-8111-111111111111'
  assert.ok(copiaEventoSchema.safeParse({ da, evento: ev, scelte: [{ socio: '090001', luogo: 'S1' }, { socio: '090002', opz: 'O1' }, { socio: '090003', opz: 'O1', luogo: 'S1' }] }).success)
  assert.ok(!copiaEventoSchema.safeParse({ da, evento: ev, scelte: [{ socio: '090001' }] }).success)
})

// ── Confezioni (26.11.25) ────────────────────────────────────
const cConf = configSchema.parse({
  prodotti: [
    { id: 'CA', tipologia: 'TER', nome: 'Castagne', prezzo: 400, unita: 'kg', confezioni: [{ id: 'F1', tipo: 'SAC', q: 1 }, { id: 'F2', tipo: 'SAC', q: 2 }] },
    { id: 'OL', tipologia: 'OLI', nome: 'Olio sfuso', prezzo: 900, unita: 'lt' },
  ],
})

test('confezioni: formati nella config, «al litro» con i decimali, niente confezioni a cassetta', () => {
  assert.deepEqual(cConf.prodotti[1]!.confezioni, [])
  assert.equal(erroreDati({ q: { OL: 2.5 } }, cConf), null)
  const base = { tipo: 'VEN', titolo: 'Castagne', anno: 2026, data: '2026-12-01', scadenza: null, stato: 'BOZZA', modalita: 'ORDINE', modoPart: 'GRUPPI', gruppi: ['SD'], sedi: [], predefinita: null, fornitore: '', pagamento: '', note: '', quota: 0 }
  const prod = (x: Record<string, unknown>) => iniziativaSchema.parse({ ...base, config: { prodotti: [{ id: 'P', tipologia: 'TER', nome: 'X', prezzo: 100, unita: 'kg', ...x }] } })
  assert.equal(erroreIniziativa(prod({ confezioni: [{ id: 'F1', tipo: 'SAC', q: 1 }] })), null)
  assert.equal(erroreIniziativa(prod({ confezioni: [{ id: 'F1', tipo: 'SAC', q: 1 }, { id: 'F1', tipo: 'PAC', q: 2 }] })), 'ID_RIPETUTI')
  assert.equal(erroreIniziativa(prod({ unita: 'cas', confezioni: [{ id: 'F1', tipo: 'SAC', q: 1 }] })), 'CONFEZIONI_NON_AMMESSE')
  assert.throws(() => prod({ confezioni: [{ id: 'F1', tipo: 'sacco', q: 1 }] }))
  assert.throws(() => prod({ confezioni: [{ id: 'F1', tipo: 'SAC', q: 0 }] }))
})

test('confezioni a mano: formati del prodotto e quantità che torna', () => {
  assert.equal(erroreDati({ q: { CA: 4 }, conf: { CA: { F1: 4, F2: 0 } } }, cConf), null)
  assert.equal(erroreDati({ q: { CA: 4 }, conf: { CA: { F2: 2 } } }, cConf), null)
  assert.equal(erroreDati({ q: { CA: 3 }, conf: { CA: { F2: 2 } } }, cConf), 'CONFEZIONI_NON_TORNANO')
  assert.equal(erroreDati({ q: { CA: 2 }, conf: { CA: { F9: 1 } } }, cConf), 'CONFEZIONE_SCONOSCIUTA')
  assert.equal(erroreDati({ q: { CA: 2 }, conf: { XX: { F1: 2 } } }, cConf), 'PRODOTTO_SCONOSCIUTO')
  assert.throws(() => sceltaSchema.parse({ conf: { CA: { F1: 1.5 } } }))
})

test('confezioni a mano: la quantità riscritta senza confezioni torna al calcolo automatico', () => {
  const prima = sceltaSchema.parse({ q: { CA: 4, OL: 1 }, conf: { CA: { F1: 4 } }, pagato: true })
  // un altro campo: la scelta a mano resta
  assert.deepEqual(unisciDati(prima, sceltaSchema.parse({ note: 'x' })).conf, { CA: { F1: 4 } })
  // la stessa quantità (es. il file ricaricato): resta
  assert.deepEqual(unisciDati(prima, sceltaSchema.parse({ q: { CA: 4, OL: 2 } })).conf, { CA: { F1: 4 } })
  // quantità diversa: si toglie
  assert.equal(unisciDati(prima, sceltaSchema.parse({ q: { CA: 5, OL: 1 } })).conf, undefined)
  // quantità e confezioni insieme: valgono quelle mandate
  assert.deepEqual(unisciDati(prima, sceltaSchema.parse({ q: { CA: 6, OL: 1 }, conf: { CA: { F2: 3 } } })).conf, { CA: { F2: 3 } })
  // prodotto tolto dall'ordine o confezioni tutte a zero: niente
  assert.equal(unisciDati(prima, sceltaSchema.parse({ q: { OL: 1 }, conf: { CA: { F1: 4 } } })).conf, undefined)
  assert.equal(unisciDati(prima, sceltaSchema.parse({ conf: { CA: { F1: 0 } } })).conf, undefined)
  // «Automatico»
  assert.equal(unisciDati(prima, sceltaSchema.parse({ conf: null })).conf, undefined)
})

test('confezioni a mano: un formato usato non si toglie e non cambia misura', () => {
  const usate = confezioniUsate([{ conf: { CA: { F1: 4, F2: 0 } } }, { conf: { CA: { F2: 1 } } }, {}], cConf)
  assert.deepEqual([...usate.entries()].sort(), [['CA|F1', 1], ['CA|F2', 2]])
  const usi = { opz: new Set<string>(), prodotti: new Set(['CA']), periodi: new Set<string>(), articoli: new Set<string>(), confezioni: usate }
  assert.equal(usiTolti(cConf, usi), null)
  const senza = (fs: Array<{ id: string; tipo: string; q: number }>) => ({ ...cConf, prodotti: cConf.prodotti.map(p => p.id === 'CA' ? { ...p, confezioni: fs } : p) })
  assert.equal(usiTolti(senza([{ id: 'F1', tipo: 'SAC', q: 1 }]), usi), 'CONFEZIONE_IN_USO')
  assert.equal(usiTolti(senza([{ id: 'F1', tipo: 'SAC', q: 1 }, { id: 'F2', tipo: 'SAC', q: 2.5 }]), usi), 'CONFEZIONE_IN_USO')
  // il tipo si può cambiare (sacco → pacco): la misura è la stessa
  assert.equal(usiTolti(senza([{ id: 'F1', tipo: 'PAC', q: 1 }, { id: 'F2', tipo: 'SAC', q: 2 }, { id: 'F3', tipo: 'SAC', q: 5 }]), usi), null)
  // config letta dal database prima della 26.11.25 (senza formati): nessun uso
  assert.equal(confezioniUsate([{ conf: { CA: { F1: 1 } } }], { ...cConf, prodotti: [{ ...cConf.prodotti[0]!, confezioni: undefined as never }] }).size, 0)
})
