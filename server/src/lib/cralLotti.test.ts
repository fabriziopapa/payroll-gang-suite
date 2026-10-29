import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  anniEsentiDopoRipristino, archivioSchema, azioneStato, confrontaArchivio, confrontaT6, confrontaT7, tenutoQuota,
  type Archivio, type PersonaArch,
} from './cralLotti.js'

// Nomi di fantasia (regola PII del progetto)
const P = (id: string, tipo: PersonaArch['tipo'], cognome: string, nome: string, extra: Partial<PersonaArch> = {}): PersonaArch => ({
  id, tipo, matricola: /^\d/.test(id) ? id : null, exMatricola: null, cognome, nome, nascita: null, email: '', sede: 'CD',
  tessera: '', riammissioni: 0, stato: 'ATTIVO', iscrittoIl: '2025-01-10', cessatoIl: null, eliminatoIl: null, statoPrima: null,
  anniEsenti: [], provenienza: null, atipico: false, note: '', creatoDa: 'admin', creatoIl: '2025-01-10T09:00:00.000Z',
  validatoDa: null, validatoIl: null, modificatoDa: null, modificatoIl: null, eliminatoDa: null, legami: [], storicoTessere: [], ...extra,
})
const TESSERA = { formato: 'NUM' as const, prefisso: 'CRAL-', cifre: 4, prossimo: 10, riammissione: 'NUOVO' as const, sepSuffisso: '/' as const, cifreSuffisso: 2 }
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
