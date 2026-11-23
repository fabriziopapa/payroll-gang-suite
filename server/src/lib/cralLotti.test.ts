import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  anniEsentiDopoRipristino, archivioSchema, azioneStato, confrontaArchivio, confrontaT6, confrontaT7, tenutoQuota,
  type EventoArch, type StatoEventoArch,
  type Archivio, type PersonaArch,
} from './cralLotti.js'
import { ALIMENTARI_VUOTI, CONTATTI_VUOTI } from './cralContatti.js'

// Nomi di fantasia (regola PII del progetto)
const P = (id: string, tipo: PersonaArch['tipo'], cognome: string, nome: string, extra: Partial<PersonaArch> = {}): PersonaArch => ({
  id, tipo, matricola: /^\d/.test(id) ? id : null, exMatricola: null, cognome, nome, nascita: null, email: '', sede: 'CD',
  tessera: '', riammissioni: 0, stato: 'ATTIVO', iscrittoIl: '2025-01-10', cessatoIl: null, eliminatoIl: null, statoPrima: null,
  anniEsenti: [], provenienza: null, atipico: false, note: '', creatoDa: 'admin', creatoIl: '2025-01-10T09:00:00.000Z',
  validatoDa: null, validatoIl: null, modificatoDa: null, modificatoIl: null, eliminatoDa: null, legami: [], storicoTessere: [],
  contatti: { ...CONTATTI_VUOTI }, alimentari: { ...ALIMENTARI_VUOTI }, ...extra,
})
const TESSERA = { formato: 'NUM' as const, prefisso: 'CRAL-', cifre: 4, prossimo: 10, riammissione: 'NUOVO' as const, sepSuffisso: '/' as const, cifreSuffisso: 2, vincolante: false }
const A = (x: Partial<Archivio>): Archivio => ({
  formato: 'pgs-cral-archivio', versione: 1, app: '26.10.29', ambiente: 'pre', esportato: '2026-10-29T10:00:00Z',
  sezioni: ['sedi', 'tabelle', 'soci', 'quote', 'eventi'], sedi: [{ id: 'CD', nome: 'Sede del Centro Direzionale', attiva: true, ordine: 1 }],
  tabelle: { tipi: [], tipologie: [], tessera: TESSERA, extProssimo: 1, famProssimo: 1, quoteAnno: [{ anno: 2026, importo: 6000 }] },
  soci: [], quote: [], eventi: [], ...x,
})

test('quota: l\'eliminato la deve solo per gli anni prima dell\'eliminazione', () => {
  const s = P('090001', 'SD', 'COLOMBO', 'Anna', { stato: 'ELIMINATO', statoPrima: 'ATTIVO', eliminatoIl: '2026-03-02', iscrittoIl: '2024-02-01' })
  assert.equal(tenutoQuota(s, 2025), true)
  assert.equal(tenutoQuota(s, 2026), false)
  assert.equal(tenutoQuota(s, 2027), false)
  // eliminato mentre era da validare: mai socio, mai quota
  assert.equal(tenutoQuota({ ...s, statoPrima: 'DA_VALIDARE' }, 2025), false)
  // ripristinato: gli anni passati da eliminato restano esenti
  const r = P('090001', 'SD', 'COLOMBO', 'Anna', { anniEsenti: [2026], iscrittoIl: '2024-02-01' })
  assert.equal(tenutoQuota(r, 2026), false)
  assert.equal(tenutoQuota(r, 2027), true)
  assert.equal(tenutoQuota(P('EXT-0001', 'EST', 'NERI', 'Luca'), 2026), false)
})

test('ripristino: esenti dall\'anno dell\'eliminazione all\'anno prima del ripristino', () => {
  assert.deepEqual(anniEsentiDopoRipristino([], '2026-05-01', '2026-11-20'), [])
  assert.deepEqual(anniEsentiDopoRipristino([2022], '2024-05-01', '2026-01-10'), [2022, 2024, 2025])
})

test('azioni di stato del T6', () => {
  assert.deepEqual(azioneStato({ stato: 'ATTIVO', tipo: 'SD', statoPrima: null }, 'CESSATO'), { azione: 'cessa' })
  assert.deepEqual(azioneStato({ stato: 'DA_VALIDARE', tipo: 'SE', statoPrima: null }, 'ELIMINATO'), { azione: 'elimina' })
  assert.deepEqual(azioneStato({ stato: 'ELIMINATO', tipo: 'SD', statoPrima: 'ATTIVO' }, 'ATTIVO'), { azione: 'ripristina' })
  assert.deepEqual(azioneStato({ stato: 'CESSATO', tipo: 'EST', statoPrima: null }, 'ATTIVO'), { azione: 'riattiva' })
  assert.ok('blocco' in (azioneStato({ stato: 'CESSATO', tipo: 'SD', statoPrima: null }, 'ATTIVO') ?? {}))
  assert.equal(azioneStato({ stato: 'ATTIVO', tipo: 'SD', statoPrima: null }, 'ATTIVO'), null)
})

test('archivio verso un ambiente vuoto: tutto nuovo, la sede si ritrova per nome', () => {
  const src = A({
    sedi: [{ id: 'CDX', nome: 'Sede del Centro Direzionale', attiva: true, ordine: 1 }, { id: 'NOL', nome: 'Sede di Nola', attiva: true, ordine: 2 }],
    soci: [P('090001', 'SD', 'COLOMBO', 'Anna', { sede: 'CDX', tessera: '0001' }), P('EXT-0001', 'SE', 'DE ROSSI', 'Marta', { stato: 'DA_VALIDARE', sede: 'NOL' }),
      P('FAM-0001', 'FAM', 'COLOMBO', 'Pietro', { legami: [{ socio: '090001', relazione: 'FIGLIO' }] })],
    quote: [{ anno: 2026, socio: '090001', modo: 'TRATTENUTA', mesi: Array(12).fill(false).map((_, k) => k < 3), pagataIl: null, note: '', importi: Array(12).fill(0), versatoUnica: null }],
  })
  const dst = A({ soci: [], quote: [] })
  const { variazioni, sediTradotte } = confrontaArchivio(src, dst, ['sedi', 'tabelle', 'soci', 'quote'], new Set(['090001']))
  assert.equal(sediTradotte['CDX'], 'CD')
  const sedi = variazioni.filter(v => v.sezione === 'sedi')
  assert.deepEqual(sedi.map(v => v.chiave), ['NOL'])
  const soci = variazioni.filter(v => v.sezione === 'soci')
  assert.deepEqual(soci.map(v => [v.chiave, v.tipo]), [['090001', 'NUOVO'], ['EXT-0001', 'NUOVO'], ['FAM-0001', 'NUOVO']])
  assert.equal((soci[0]!.record as PersonaArch).sede, 'CD')
  assert.ok(soci.every(v => !v.delicata && !v.bloccata))
  assert.equal(variazioni.filter(v => v.sezione === 'quote').length, 1)
})

test('archivio: un valore vuoto non svuota, i mesi pagati qui restano, la tessera doppia si blocca', () => {
  const qui = P('090001', 'SD', 'COLOMBO', 'Anna', { email: 'anna@esempio.it', tessera: '0001', note: 'nota di qui' })
  const altro = P('090002', 'SD', 'VIOLA', 'Marco', { tessera: '0007' })
  const src = A({
    soci: [{ ...qui, email: '', tessera: '0007', note: '', sede: 'CD' }, altro],
    quote: [{ anno: 2026, socio: '090001', modo: 'TRATTENUTA', mesi: [true, false, false, false, false, false, false, false, false, false, false, false], pagataIl: null, note: '', importi: Array(12).fill(0), versatoUnica: null }],
  })
  const dst = A({
    soci: [qui, altro],
    quote: [{ anno: 2026, socio: '090001', modo: 'TRATTENUTA', mesi: [false, true, false, false, false, false, false, false, false, false, false, false], pagataIl: null, note: '', importi: Array(12).fill(0), versatoUnica: null }],
  })
  const { variazioni } = confrontaArchivio(src, dst, ['soci', 'quote'], new Set())
  const v = variazioni.find(x => x.chiave === '090001')!
  assert.deepEqual(v.campi.map(c => c.campo), ['tessera'])
  assert.match(v.campi[0]!.blocco ?? '', /già di VIOLA Marco/)
  const q = variazioni.find(x => x.sezione === 'quote')!
  assert.deepEqual((q.campi[0]!.dopo as boolean[]).slice(0, 3), [true, true, false])
})

test('archivio: stesso ID esterno ma persona diversa = conflitto; cambio di stato = delicato', () => {
  const src = A({ soci: [P('EXT-0003', 'SE', 'NERI', 'Luca'), P('090001', 'SD', 'COLOMBO', 'Anna', { stato: 'CESSATO', cessatoIl: '2026-06-30' })] })
  const dst = A({ soci: [P('EXT-0003', 'SE', 'BIANCHI', 'Giulia'), P('090001', 'SD', 'COLOMBO', 'Anna')] })
  const { variazioni } = confrontaArchivio(src, dst, ['soci'], new Set())
  const c = variazioni.find(x => x.chiave === 'EXT-0003')!
  assert.equal(c.tipo, 'CONFLITTO'); assert.ok(c.delicata && !c.bloccata)
  const s = variazioni.find(x => x.chiave === '090001')!
  assert.equal(s.tipo, 'MODIFICA'); assert.ok(s.delicata)
  assert.deepEqual(s.campi.map(x => x.campo), ['stato'])
})

test('archivio: ex matricola, in un ambiente sì e nell\'altro no', () => {
  // passato a socio esterno nell'archivio, qui ancora socio dipendente
  const src = A({ soci: [P('EXT-0009', 'SE', 'COLOMBO', 'Anna', { exMatricola: '090001' })] })
  const dst = A({ soci: [P('090001', 'SD', 'COLOMBO', 'Anna')] })
  const v = confrontaArchivio(src, dst, ['soci'], new Set()).variazioni[0]!
  assert.equal(v.tipo, 'CONFLITTO'); assert.match(v.bloccata ?? '', /ancora socio dipendente/)
  // al contrario: qui e' gia' passato, l'archivio lo ha ancora con la matricola
  const w = confrontaArchivio(A({ soci: [P('090001', 'SD', 'COLOMBO', 'Anna')] }), A({ soci: [P('EXT-0009', 'SE', 'COLOMBO', 'Anna', { exMatricola: '090001' })] }), ['soci'], new Set(['090001'])).variazioni[0]!
  assert.match(w.bloccata ?? '', /passata a socio esterno/)
})

test('archivio: una matricola che qui non è in anagrafica è un avviso, non entra con «accetta tutte»', () => {
  const v = confrontaArchivio(A({ soci: [P('090005', 'SD', 'VIOLA', 'Marco')] }), A({ soci: [] }), ['soci'], new Set()).variazioni[0]!
  assert.equal(v.tipo, 'NUOVO'); assert.ok(v.delicata); assert.match(v.avviso ?? '', /non è nell'anagrafica PGS/)
})

test('T6: data di nascita di un socio dipendente solo se in PGS manca; tessera doppia; stato', () => {
  const soci = [P('090001', 'SD', 'COLOMBO', 'Anna', { tessera: '0001' }), P('090002', 'SD', 'VIOLA', 'Marco', { tessera: '0002' }), P('EXT-0001', 'SE', 'NERI', 'Luca')]
  const nascitaPgs = new Map<string, string | null>([['090001', '1970-03-07'], ['090002', null]])
  const vs = confrontaT6([
    { socio: '090001', riga: 2, valori: { nascita: '1970-03-08', sede: 'NOL' } },
    { socio: '090002', riga: 3, valori: { nascita: '1981-01-01', tessera: '0001' } },
    { socio: 'EXT-0001', riga: 4, valori: { stato: 'ELIMINATO', email: null } },
  ], soci, new Set(['CD', 'NOL']), nascitaPgs, '2026-10-29')
  const a = vs.find(v => v.chiave === '090001')!
  assert.match(a.campi.find(c => c.campo === 'nascita')!.blocco ?? '', /in PGS è 07\/03\/1970/)
  assert.ok(!a.campi.find(c => c.campo === 'sede')!.blocco)
  const b = vs.find(v => v.chiave === '090002')!
  assert.ok(!b.campi.find(c => c.campo === 'nascita')!.blocco)
  assert.match(b.campi.find(c => c.campo === 'tessera')!.blocco ?? '', /già di COLOMBO/)
  const c = vs.find(v => v.chiave === 'EXT-0001')!
  assert.ok(c.delicata)
  assert.deepEqual((c.campi.find(x => x.campo === 'azioneStato')!.dopo as { azione: string }).azione, 'elimina')
})

test('archivio: il formato si valida (e i campi nuovi hanno un default)', () => {
  const a = A({ soci: [P('090001', 'SD', 'COLOMBO', 'Anna')] })
  const { exMatricola: _e, anniEsenti: _a, ...vecchio } = a.soci![0]!
  assert.ok(archivioSchema.safeParse({ ...a, soci: [vecchio] }).success)
  assert.ok(!archivioSchema.safeParse({ ...a, formato: 'altro' }).success)
  assert.ok(!archivioSchema.safeParse({ ...a, soci: [{ ...a.soci![0], id: 'X; DROP' }] }).success)
})

test('T7: importo che copre la rata = mese pagato; quota annua in un colpo = anno pagato; mai togliere da file', () => {
  const soci = [P('090001', 'SD', 'COLOMBO', 'Anna', { iscrittoIl: '2020-01-01' }), P('EXT-0001', 'SE', 'DE ROSSI', 'Marta', { iscrittoIl: '2020-01-01' }), P('FAM-0001', 'FAM', 'COLOMBO', 'Pietro')]
  const z = () => Array<number>(12).fill(0)
  const quote = [{ anno: 2026, socio: '090001', modo: 'TRATTENUTA' as const, mesi: [true, ...Array(11).fill(false)], importi: [500, ...Array(11).fill(0)], pagataIl: null, versatoUnica: null, note: '' }]
  const anni = new Map([[2026, 6000]])
  const vs = confrontaT7([
    { socio: '090001', riga: 2, anno: 2026, mesi: { '1': 400, '2': 500, '3': 450 } },          // gennaio pagato: 4,00 non si scrive
    { socio: '090001', riga: 3, anno: 2026, mesi: { '4': 'X' } },                             // un'altra riga dello stesso socio si unisce
    { socio: 'EXT-0001', riga: 4, anno: 2026, mesi: { '10': 6000 } },                         // quota annua in una volta
    { socio: 'FAM-0001', riga: 5, anno: 2026, mesi: { '1': 500 } },                           // non è socio
    { socio: 'EXT-0001', riga: 6, anno: 2027, unica: { importo: 'X' } },                       // anno non impostato
  ], soci, quote, anni, '2026-10-29')
  const a = vs.find(v => v.chiave === '2026|090001')!
  assert.equal(a.tipo, 'MODIFICA'); assert.ok(a.delicata)
  const d = a.campi.find(c => c.campo === 'versamenti')!.dopo as { mesi: boolean[]; importi: number[] }
  assert.deepEqual(d.importi.slice(0, 4), [500, 500, 450, 500])
  assert.deepEqual(d.mesi.slice(0, 4), [true, true, false, true])
  assert.match(a.avviso ?? '', /gennaio è già pagato/); assert.match(a.avviso ?? '', /marzo: 4,50 € invece della rata di 5,00 €/)
  const b = vs.find(v => v.chiave === '2026|EXT-0001')!
  assert.equal(b.tipo, 'NUOVO'); assert.ok(!b.delicata)
  assert.ok((b.campi.find(c => c.campo === 'versamenti')!.dopo as { mesi: boolean[] }).mesi.every(Boolean))
  assert.match(vs.find(v => v.chiave === '2026|FAM-0001')!.bloccata ?? '', /non è un socio/)
  assert.match(vs.find(v => v.chiave === '2027|EXT-0001')!.bloccata ?? '', /anno 2027 non è impostato/)
  // stesso mese con importi diversi nel file
  const c = confrontaT7([{ socio: 'EXT-0001', riga: 2, anno: 2026, mesi: { '5': 500 } }, { socio: 'EXT-0001', riga: 9, anno: 2026, mesi: { '5': 300 } }], soci, [], anni, '2026-10-29')
  assert.match(c[0]!.bloccata ?? '', /valori diversi per maggio/)
  // solo un importo minore su un mese pagato: niente da applicare, si spiega perché
  const s = confrontaT7([{ socio: '090001', riga: 2, anno: 2026, mesi: { '1': 100 } }], soci, quote, anni, '2026-10-29')
  assert.match(s[0]!.bloccata ?? '', /si corregge a mano/)
  // unica soluzione: X = la quota, con la data
  const u = confrontaT7([{ socio: 'EXT-0001', riga: 2, anno: 2026, unica: { importo: 'X', data: '2026-02-01' } }], soci, [], anni, '2026-10-29')
  assert.deepEqual(u[0]!.campi.find(x => x.campo === 'unica')!.dopo, { pagataIl: '2026-02-01', versatoUnica: 6000 })
  void z
})

// ── 0025: telefono, consensi, dati alimentari ────────────────
test('T6: telefono e consenso; revoca non scavalcata; alimentari solo col consenso', () => {
  const tel = { ...CONTATTI_VUOTI, telefono: '+393331234567', waId: '393331234567' }
  const soci = [
    P('1001', 'SD', 'ROSSI', 'Mario'),
    P('1002', 'SD', 'BIANCHI', 'Anna', { contatti: { ...tel, consenso: 'REVOCATO', consensoIl: '2026-01-10', revocatoIl: '2026-06-01' } }),
    P('EXT-0001', 'SE', 'VERDI', 'Luca', { contatti: tel }),
  ]
  const v = confrontaT6([
    { socio: '1001', riga: 2, valori: { contatti: { telefono: '+393331234567', consenso: 'SI', origine: 'CARTACEO', whatsapp: 'SI' }, alimentari: { consenso: true, esigenze: ['VEGANO'], allergie: 'arachidi' } } },
    { socio: '1002', riga: 3, valori: { contatti: { consenso: 'SI' }, alimentari: { esigenze: ['CELIACO'] } } },
    { socio: 'EXT-0001', riga: 4, valori: { contatti: { telefono: '+393331234567' } } },
  ], soci, new Set(['CD']), new Map(), '2026-11-11')
  assert.equal(v.length, 2)
  const a = v.find(x => x.chiave === '1001')!
  const c = a.campi.find(x => x.campo === 'contatti')!.dopo as typeof tel
  assert.deepEqual([c.telefono, c.consenso, c.consensoIl, c.origine, c.whatsapp, c.waFonte], ['+393331234567', 'SI', '2026-11-11', 'CARTACEO', 'SI', 'FILE'])
  assert.match(a.avviso ?? '', /Stesso numero di BIANCHI Anna \(1002\), VERDI Luca \(EXT-0001\)/)
  assert.deepEqual(a.campi.find(x => x.campo === 'alimentari')!.dopo, { consenso: true, consensoIl: '2026-11-11', esigenze: ['VEGANO'], allergie: 'arachidi' })
  const b = v.find(x => x.chiave === '1002')!
  assert.match(b.bloccata ?? '', /consenso revocato/); assert.match(b.bloccata ?? '', /manca il consenso ai dati alimentari/)
})
test('archivio 26.10.29 senza contatti: si legge; contatti nuovi diventano variazione', () => {
  const vecchia = { ...P('EXT-0001', 'SE', 'VERDI', 'Luca') } as Record<string, unknown>
  delete vecchia['contatti']; delete vecchia['alimentari']
  const base = { formato: 'pgs-cral-archivio', versione: 1, ambiente: 'pre', app: '26.10.29', esportato: '2026-10-29T10:00:00.000Z' }
  const letto = archivioSchema.parse({ ...base, sezioni: ['soci'], soci: [vecchia] })
  assert.equal(letto.soci![0]!.contatti.consenso, 'NO')
  const src: Archivio = { ...letto, soci: [P('EXT-0001', 'SE', 'VERDI', 'Luca', { contatti: { ...CONTATTI_VUOTI, telefono: '+393331234567', waId: '393331234567', consenso: 'SI', consensoIl: '2026-05-01', origine: 'ONLINE' } })] }
  const dst: Archivio = { ...letto, sezioni: ['sedi', 'tabelle', 'soci', 'quote', 'eventi'], sedi: [{ id: 'CD', nome: 'Centro', attiva: true, ordine: 0 }],
    soci: [P('EXT-0001', 'SE', 'VERDI', 'Luca', { contatti: { ...CONTATTI_VUOTI, telefono: '+393331234567', waId: '393331234567', consenso: 'REVOCATO', consensoIl: '2026-05-01', revocatoIl: '2026-09-01' } })] }
  const { variazioni } = confrontaArchivio(src, dst, ['soci'], new Set())
  assert.equal(variazioni.length, 1); assert.match(variazioni[0]!.bloccata ?? '', /revocato dopo/)
})

test('T6 col formato della tessera obbligatorio: completa, blocca, non tocca quella gia\' assegnata', () => {
  const soci = [P('090001', 'SD', 'COLOMBO', 'Anna', { tessera: '0001' }), P('090002', 'SD', 'VIOLA', 'Marco', { tessera: '94' }), P('EXT-0001', 'SE', 'NERI', 'Luca')]
  const V = { ...TESSERA, vincolante: true }
  const vs = confrontaT6([
    { socio: 'EXT-0001', riga: 2, valori: { tessera: '175' } },
    { socio: '090001', riga: 3, valori: { tessera: 'A12' } },
    { socio: '090002', riga: 4, valori: { tessera: '94' } },
  ], soci, new Set(['CD']), new Map(), '2026-11-11', V)
  const a = vs.find(v => v.chiave === 'EXT-0001')!.campi.find(c => c.campo === 'tessera')!
  assert.equal(a.dopo, '0175'); assert.ok(!a.blocco)
  const b = vs.find(v => v.chiave === '090001')!.campi.find(c => c.campo === 'tessera')!
  assert.match(b.blocco ?? '', /formato 0042/)
  assert.ok(!vs.find(v => v.chiave === '090002'), 'la tessera gia\' assegnata, anche fuori formato, non e\' una variazione')
  // spento: come prima
  const vs2 = confrontaT6([{ socio: 'EXT-0001', riga: 2, valori: { tessera: 'A12' } }], soci, new Set(['CD']), new Map(), '2026-11-11', TESSERA)
  assert.equal(vs2[0]!.campi.find(c => c.campo === 'tessera')!.dopo, 'A12')
})

test('quote (0028): un versamento del T7 non entra su una quota esente o non dovuta', () => {
  const soci = [P('090001', 'SD', 'COLOMBO', 'Anna', { iscrittoIl: '2020-01-01' }), P('090002', 'SD', 'VIOLA', 'Marco', { iscrittoIl: '2020-01-01' }), P('EXT-0001', 'SE', 'DE ROSSI', 'Marta', { iscrittoIl: '2020-01-01' })]
  const riga = (socio: string, stato?: 'DOVUTA' | 'ESENTE' | 'NON_DOVUTA') =>
    ({ anno: 2026, socio, modo: 'UNICA' as const, mesi: Array<boolean>(12).fill(false), importi: Array<number>(12).fill(0), pagataIl: null, versatoUnica: null, note: '', ...(stato ? { stato, motivo: stato === 'DOVUTA' ? '' : 'motivo di prova' } : {}) })
  const vs = confrontaT7([
    { socio: '090001', riga: 2, anno: 2026, mesi: { '1': 500 } },
    { socio: '090002', riga: 3, anno: 2026, mesi: { '1': 500 } },
    { socio: 'EXT-0001', riga: 4, anno: 2026, mesi: { '1': 500 } },
  ], soci, [riga('090001', 'NON_DOVUTA'), riga('090002', 'ESENTE'), riga('EXT-0001')], new Map([[2026, 6000]]), '2026-11-14')
  assert.match(vs.find(v => v.chiave === '2026|090001')!.bloccata ?? '', /«non dovuta».*rimessa dovuta/)
  assert.match(vs.find(v => v.chiave === '2026|090002')!.bloccata ?? '', /«esente»/)
  // una quota senza stato (riga di prima della 0028) e' dovuta: il versamento entra
  const c = vs.find(v => v.chiave === '2026|EXT-0001')!
  assert.ok(!c.bloccata); assert.deepEqual(c.campi.map(x => x.campo), ['versamenti'])
})

test('quote (0028): l\'archivio porta stato e motivo insieme, come variazione da confermare a parte', () => {
  const soci = [P('090001', 'SD', 'COLOMBO', 'Anna'), P('090002', 'SD', 'VIOLA', 'Marco'), P('090003', 'SD', 'DE ROSSI', 'Marta')]
  const q = (socio: string, extra: Record<string, unknown> = {}) =>
    ({ anno: 2026, socio, modo: 'UNICA' as const, mesi: Array<boolean>(12).fill(false), importi: Array<number>(12).fill(0), pagataIl: null, versatoUnica: null, note: '', ...extra })
  const src = A({ soci, quote: [q('090001', { stato: 'ESENTE', motivo: 'socio onorario' }), q('090002', { stato: 'NON_DOVUTA', motivo: 'inserito per errore' }), q('090003')] })
  // un archivio di prima della 0028 non ha i due campi: si legge, e vale «dovuta»
  assert.ok(archivioSchema.safeParse(A({ soci, quote: [q('090003')] })).success)
  assert.ok(!archivioSchema.safeParse(A({ soci, quote: [q('090003', { stato: 'GRATIS' })] })).success)
  const dst = A({ soci, quote: [q('090001'), q('090003', { stato: 'DOVUTA', motivo: '' })] })
  const vs = confrontaArchivio(src, dst, ['quote'], new Set()).variazioni
  // 090001: qui e' dovuta, in arrivo esente → un solo campo «dovuta», delicata
  const a = vs.find(v => v.chiave === '2026|090001')!
  assert.equal(a.tipo, 'MODIFICA'); assert.ok(a.delicata)
  assert.deepEqual(a.campi.map(c => [c.campo, c.prima, c.dopo]), [['dovuta', { stato: 'DOVUTA', motivo: '' }, { stato: 'ESENTE', motivo: 'socio onorario' }]])
  // 090002: qui la quota non c'e' → nuova, con lo stato in evidenza e delicata
  const b = vs.find(v => v.chiave === '2026|090002')!
  assert.equal(b.tipo, 'NUOVO'); assert.ok(b.delicata)
  assert.deepEqual(b.campi.find(c => c.campo === 'dovuta')!.dopo, { stato: 'NON_DOVUTA', motivo: 'inserito per errore' })
  // 090003: dovuta da entrambe le parti (con e senza i campi) → nessuna differenza
  assert.equal(vs.find(v => v.chiave === '2026|090003'), undefined)
})

test('stati degli eventi (0030): l\'archivio li porta; un evento con uno stato che qui non c\'è resta fermo', () => {
  const STATI: StatoEventoArch[] = [
    { id: 'BOZZA', nome: 'Bozza', colore: '#64748B', regola: 'PREPARAZIONE' as const, attivo: true, ordine: 1 },
    { id: 'APERTA', nome: 'Raccolta aperta', colore: '#16A34A', regola: 'RACCOLTA' as const, attivo: true, ordine: 2 },
    { id: 'CHIUSA', nome: 'Raccolta chiusa', colore: '#0891B2', regola: 'RACCOLTA_CHIUSA' as const, attivo: true, ordine: 3 },
  ]
  const tab = (stati?: StatoEventoArch[]) => ({ tipi: [{ id: 'PAN', nome: 'Panettone', colore: '#D97706', pagamento: false, modo: null, attivo: true, ordine: 1 }], tipologie: [], ...(stati ? { stati } : {}), tessera: TESSERA, extProssimo: 1, famProssimo: 1, quoteAnno: [] })
  const ev = (id: string, stato: string, extra: Partial<EventoArch> = {}): EventoArch => ({
    id, tipo: 'PAN', titolo: `Panettoni ${id.slice(0, 4)}`, anno: 2026, data: '2026-12-18', scadenza: null, stato, modalita: 'NESSUNA', modoPart: 'GRUPPI',
    gruppi: ['SD'], sedi: [], predefinita: null, fornitore: '', pagamento: '', note: '', quota: 0,
    config: { opzioni: [], prodotti: [], periodi: [], articoli: [], sconti: {} }, archiviata: false, archiviataDa: null, archiviataIl: null,
    partecipanti: [], scelte: [], carichi: [], richieste: [], ...extra,
  })
  const ID1 = '11111111-1111-4111-8111-111111111111', ID2 = '22222222-2222-4222-8222-222222222222', ID3 = '33333333-3333-4333-8333-333333333333', ID4 = '44444444-4444-4444-8444-444444444444'
  const nuovoStato = { id: 'CONSEGNA', nome: 'In consegna', colore: '#7C3AED', regola: 'RACCOLTA_CHIUSA' as const, attivo: true, ordine: 4 }
  const src = A({ tabelle: tab([...STATI.map(s => s.id === 'CHIUSA' ? { ...s, regola: 'CONCLUSO' as const } : s), nuovoStato]),
    eventi: [ev(ID1, 'CONSEGNA'), ev(ID2, 'SOSPESO'), ev(ID3, 'CONSEGNA', { copiatoDa: ID1 }), ev(ID4, 'APERTA')] })
  const dst = A({ tabelle: tab(STATI), eventi: [ev(ID4, 'BOZZA')] })
  assert.ok(archivioSchema.safeParse(JSON.parse(JSON.stringify(src))).success)
  const vs = confrontaArchivio(src, dst, ['tabelle', 'eventi'], new Set()).variazioni
  const di = (k: string) => vs.find(v => v.chiave === k)!
  // lo stato nuovo arriva; cambiare la regola di uno stato che c'è è delicato
  assert.equal(di('CONSEGNA').tipo, 'NUOVO'); assert.equal(di('CONSEGNA').entita, 'stato')
  assert.equal(di('CHIUSA').tipo, 'MODIFICA'); assert.ok(di('CHIUSA').delicata); assert.deepEqual(di('CHIUSA').campi.map(c => c.campo), ['regola'])
  // l'evento con uno stato in arrivo passa; quello con uno stato che non c'è né arriva resta fermo
  assert.ok(!di(ID1).bloccata); assert.ok(!di(ID3).bloccata)
  assert.match(di(ID2).bloccata ?? '', /stato SOSPESO non c'è qui/)
  // un evento che c'è: il cambio di stato passa (APERTA c'è)
  assert.deepEqual(di(ID4).campi.find(c => c.campo === 'stato'), { campo: 'stato', etichetta: 'Stato', prima: 'BOZZA', dopo: 'APERTA' })
  // un archivio di prima della 0030 (senza stati) si legge, e i suoi BOZZA/APERTA/CHIUSA sono noti
  const vecchio = A({ tabelle: tab(), eventi: [ev(ID2, 'CHIUSA')] })
  assert.ok(archivioSchema.safeParse(JSON.parse(JSON.stringify(vecchio))).success)
  assert.ok(!confrontaArchivio(vecchio, A({ tabelle: tab(STATI) }), ['eventi'], new Set()).variazioni[0]!.bloccata)
})
