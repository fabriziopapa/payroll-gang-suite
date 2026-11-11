// Test del motore di aggancio (un solo motore per T2–T7).
// Dati SINTETICI: nomi inventati, matricole 09xxxx, numeri di fantasia.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agganciaRiga, chiaveIntestazione, trovaColonne } from './aggancio'
import { CONTATTI_VUOTI, ALIMENTARI_VUOTI } from './contatti'
import type { Persona } from './tipi'

const P = (id: string, cognome: string, nome: string, extra: Partial<Persona> = {}): Persona => ({
  id, tipo: /^\d/.test(id) ? 'SD' : id.startsWith('FAM') ? 'FAM' : 'SE', origine: /^\d/.test(id) ? 'PGS' : 'EST', matricola: /^\d/.test(id) ? id : null,
  cognome, nome, nascita: null, email: '', sede: null, tessera: '', riammissioni: 0, stato: 'ATTIVO', iscrittoIl: '2025-01-10', cessatoIl: null,
  provenienza: null, atipico: false, note: '', creatoDa: null, creatoIl: '2025-01-10T09:00:00.000Z', validatoDa: null, validatoIl: null,
  modificatoDa: null, modificatoIl: null, eliminatoIl: null, eliminatoDa: null, statoPrima: null, anniEsenti: [], exMatricola: null,
  contatti: { ...CONTATTI_VUOTI }, alimentari: { ...ALIMENTARI_VUOTI }, legami: [], storicoTessere: [], ...extra,
})
const tel = (n: string) => ({ ...CONTATTI_VUOTI, telefono: n, waId: n.slice(1) })
const ELENCO = [
  P('090001', 'ROSSI', 'Mario', { contatti: tel('+393330000001'), email: 'mario.rossi@example.org', tessera: '0012' }),
  P('090002', 'BIANCHI', 'Anna Maria', { contatti: tel('+393330000002'), email: 'famiglia@example.org' }),
  P('FAM-0001', 'BIANCHI', 'Luca', { contatti: tel('+393330000002'), email: 'famiglia@example.org' }),
  P('EXT-0003', 'VERDI', 'Paola', { nascita: '1980-05-01' }),
  P('EXT-0004', 'VERDI', 'Paola', { nascita: '1991-09-09' }),
  P('EXT-0005', 'NERI', 'Ugo', { exMatricola: '090009' }),
]
const O = { prefisso: '39' }
const ag = (k: Parameters<typeof agganciaRiga>[1]) => agganciaRiga(ELENCO, k, O)

test('solo il telefono: basta', () => {
  for (const t of ['333 0000001', '+39 333-0000001', '00393330000001', '3330000001.0']) {
    const e = ag({ telefono: t }); assert.equal(e.socio?.id, '090001', t); assert.equal(e.via, 'telefono')
  }
})
test('ordine delle chiavi: ID, ex matricola, tessera prima di tutto', () => {
  assert.equal(ag({ id: '90001', telefono: '3330000002' }).socio?.id, '090001')
  assert.match(ag({ id: '090009' }).via, /ex matricola \(ora EXT-0005\)/)
  assert.equal(ag({ id: '0012' }).via, 'tessera')
  const e = ag({ id: '999999', nominativo: 'Rossi Mario' }); assert.equal(e.socio?.id, '090001'); assert.match(e.avvisi.join(), /ID 999999 non presente/)
})
test('telefono condiviso: decide il nome, altrimenti sceglie l\'utente', () => {
  assert.equal(ag({ telefono: '3330000002', nominativo: 'Bianchi Luca' }).socio?.id, 'FAM-0001')
  assert.equal(ag({ telefono: '3330000002', nominativo: 'BIANCHI ANNA' }).socio?.id, '090002')
  const e = ag({ telefono: '3330000002' }); assert.equal(e.stato, 'AMBIGUA'); assert.deepEqual(e.candidati.map(c => c.id), ['090002', 'FAM-0001']); assert.match(e.motivo, /condiviso da 2 persone/)
})
test('figlio iscritto col telefono del genitore: il familiare, non un conflitto', () => {
  const el = [...ELENCO, P('FAM-0009', 'ROSSI', 'Giulia', { legami: [{ socio: '090001', relazione: 'FIGLIO' }] })]
  const e = agganciaRiga(el, { telefono: '3330000001', nominativo: 'Rossi Giulia' }, O)
  assert.equal(e.socio?.id, 'FAM-0009'); assert.match(e.via, /telefono di ROSSI Mario/); assert.equal(e.stato, 'OK')
})
test('telefono e nome in disaccordo: conflitto, la riga resta ferma', () => {
  const e = ag({ telefono: '3330000001', nominativo: 'Neri Ugo' })
  assert.equal(e.socio, null); assert.equal(e.stato, 'CONFLITTO'); assert.deepEqual(e.candidati.map(c => c.id), ['090001', 'EXT-0005']); assert.match(e.motivo, /telefono è di ROSSI Mario.*indica NERI Ugo/)
  const f = ag({ telefono: '3330000001', nominativo: 'Rossi Giulia' }); assert.equal(f.stato, 'CONFLITTO'); assert.equal(f.candidati[0]?.id, '090001')
})
test('numero mai visto: persona per nome, il numero si propone; ignota se niente combacia', () => {
  const e = ag({ telefono: '347 1112223', nominativo: 'Neri Ugo' })
  assert.equal(e.socio?.id, 'EXT-0005'); assert.equal(e.telefono, '+393471112223'); assert.equal(e.telefonoNuovo, true)
  const f = ag({ telefono: '347 1112223', nominativo: 'Rossi Mario' }); assert.equal(f.telefonoNuovo, false); assert.match(f.avvisi.join(), /altro numero/)
  const g = ag({ telefono: '347 1112223' }); assert.equal(g.stato, 'IGNOTA'); assert.match(g.motivo, /\+39 347 111 2223 non è in anagrafica/)
  const h = ag({ telefono: '12', nominativo: 'Rossi Mario' }); assert.equal(h.socio?.id, '090001'); assert.match(h.avvisi.join(), /telefono «12»/)
})
test('email e nominativo', () => {
  assert.equal(ag({ email: 'MARIO.ROSSI@example.org' }).via, 'email')
  assert.equal(ag({ email: 'famiglia@example.org', nominativo: 'Luca Bianchi' }).socio?.id, 'FAM-0001')
  assert.equal(ag({ email: 'famiglia@example.org' }).stato, 'AMBIGUA')
  assert.equal(ag({ email: 'mario.rossi@example.org', nominativo: 'Neri Ugo' }).stato, 'CONFLITTO')
  assert.equal(ag({ nominativo: 'Verdi Paola' }).stato, 'AMBIGUA')
  assert.equal(ag({ nominativo: 'Verdi Paola', nascita: '1991-09-09' }).socio?.id, 'EXT-0004')
  assert.equal(ag({ nominativo: 'Bianchi Anna' }).stato, 'AMBIGUA') // parziale: negli eventi si conferma
  assert.equal(agganciaRiga(ELENCO, { nominativo: 'Bianchi Anna' }, { ...O, parziale: true }).socio?.id, '090002')
  assert.equal(ag({}).stato, 'IGNOTA')
})
test('intestazioni: sinonimi e scelte ricordate', () => {
  assert.equal(chiaveIntestazione(' N. Tel. '), 'n tel')
  const R: Array<'id' | 'telefono' | 'email' | 'nominativo' | 'cognome' | 'nome'> = ['id', 'telefono', 'email', 'nominativo', 'cognome', 'nome']
  for (const h of ['Cell', 'Cellulare', 'cell.', 'Mobile', 'Tel', 'N. telefono', 'Numero di telefono', 'WhatsApp', 'Recapito telefonico', 'Numero di cellulare', 'Telefono'])
    assert.equal(trovaColonne(['Cognome', h], R).telefono, 1, h)
  const c = trovaColonne(['Data', 'Tessera', 'Indirizzo e-mail', 'Cognome e Nome', 'Scelta'], R)
  assert.deepEqual([c.id, c.email, c.nominativo, c.telefono], [1, 2, 3, -1])
  // «Riferimento» non è riconosciuta: una volta indicata a mano, la volta dopo vale
  assert.equal(trovaColonne(['Riferimento', 'Nome'], R).telefono, -1)
  assert.equal(trovaColonne(['Riferimento', 'Nome'], R, { riferimento: 'telefono' }).telefono, 0)
  assert.equal(trovaColonne(['Telefono', 'Nome'], R, { telefono: '' }).telefono, -1)
})
