import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALIMENTARI_VUOTI, CONTATTI_VUOTI, alimentariDopo, contattabile, contattiDopo, leggiConsenso, leggiEsigenze, leggiOrigine,
  leggiTelefono, leggiWhatsapp, mostraTelefono, perWhatsapp, riassuntoContatti, type Contatti,
} from './contatti'

const tel = (s: string, p?: string) => { const r = leggiTelefono(s, p); return r && 'e164' in r ? r.e164 : r && 'errore' in r ? 'ERR' : null }

test('telefono: cellulari italiani in tutte le scritture', () => {
  for (const s of ['3331234567', '333 123 4567', '333-1234567', '333.123.45.67', '+39 333 1234567', '0039 333 1234567', '393331234567', '(+39) 333/1234567', 'cell. 333 1234567', '3331234567.0', '3.331234567E9'])
    assert.equal(tel(s), '+393331234567', s)
  assert.equal(tel('391 234 5678'), '+393912345678') // 391 e' un prefisso mobile, non il +39
})
test('telefono: waId, fissi, esteri, errori', () => {
  assert.deepEqual(leggiTelefono('3331234567'), { e164: '+393331234567', waId: '393331234567', tipo: 'MOBILE' })
  const f = leggiTelefono('081 5551234'); assert.ok(f && 'tipo' in f && f.tipo === 'FISSO' && f.e164 === '+390815551234' && f.avviso)
  assert.equal(tel('+44 7911 123456'), '+447911123456')
  assert.equal(tel('0044 7911 123456'), '+447911123456')
  assert.equal(tel(''), null); assert.equal(tel('-'), null)
  assert.equal(tel('12345'), 'ERR'); assert.equal(tel('abc'), 'ERR'); assert.equal(tel('+39 123'), 'ERR'); assert.equal(tel('7911123456'), 'ERR')
  assert.equal(tel('7911123456', '44'), '+447911123456'); assert.equal(tel('07911123456', '44'), '+447911123456')
  assert.equal(mostraTelefono('+393331234567'), '+39 333 123 4567')
})
test('letture da file', () => {
  assert.equal(leggiConsenso('Sì'), 'SI'); assert.equal(leggiConsenso('x'), 'SI'); assert.equal(leggiConsenso('NO'), 'NO'); assert.equal(leggiConsenso('Revocato'), 'REVOCATO'); assert.equal(leggiConsenso('boh'), null)
  assert.equal(leggiWhatsapp('si'), 'SI'); assert.equal(leggiWhatsapp('Non verificato'), 'NV'); assert.equal(leggiWhatsapp(''), null)
  assert.equal(leggiOrigine('modulo cartaceo'), 'CARTACEO'); assert.equal(leggiOrigine('Form online'), 'ONLINE'); assert.equal(leggiOrigine('e-mail'), 'EMAIL'); assert.equal(leggiOrigine('a voce'), 'VOCE')
  assert.deepEqual(leggiEsigenze('Vegano; celiaco / kosher'), { esigenze: ['VEGANO', 'CELIACO'], ignote: ['kosher'] })
  assert.deepEqual(leggiEsigenze('vegetaliano, senza glutine, intollerante al lattosio, Vegetariana').esigenze, ['VEGETARIANO', 'VEGANO', 'CELIACO', 'LATTOSIO'])
  assert.deepEqual(leggiEsigenze('nessuna'), { esigenze: [], ignote: [] })
})
const OGGI = '2026-11-11'
const ok = (r: ReturnType<typeof contattiDopo>): Contatti => { assert.ok(!('errore' in r), JSON.stringify(r)); return r as Contatti }
test('contatti: numero, consenso, revoca', () => {
  let c = ok(contattiDopo(CONTATTI_VUOTI, { telefono: '+393331234567' }, OGGI, 'MANO'))
  assert.equal(c.waId, '393331234567'); assert.equal(c.consenso, 'NO'); assert.equal(contattabile(c), false)
  c = ok(contattiDopo(c, { consenso: 'SI', origine: 'CARTACEO', whatsapp: 'SI' }, OGGI, 'MANO'))
  assert.deepEqual([c.consenso, c.consensoIl, c.origine, c.whatsapp, c.waIl, c.waFonte], ['SI', OGGI, 'CARTACEO', 'SI', OGGI, 'MANO'])
  assert.ok(perWhatsapp(c)); assert.match(riassuntoContatti(c), /consenso sì dal 11\/11\/2026 \(modulo cartaceo\) · WhatsApp sì/)
  // «no» su un consenso dato = revoca
  const r = ok(contattiDopo(c, { consenso: 'NO' }, OGGI, 'FILE'))
  assert.deepEqual([r.consenso, r.revocatoIl, r.consensoIl], ['REVOCATO', OGGI, OGGI]); assert.equal(perWhatsapp(r), false)
  // dopo la revoca il file non rimette il sì senza una data nuova
  assert.deepEqual(contattiDopo({ ...r, revocatoIl: '2026-11-05' }, { consenso: 'SI' }, OGGI, 'FILE'), { errore: 'CONSENSO_REVOCATO' })
  assert.deepEqual(contattiDopo({ ...r, revocatoIl: '2026-11-05' }, { consenso: 'SI', consensoIl: '2026-11-01' }, OGGI, 'FILE'), { errore: 'CONSENSO_REVOCATO' })
  const di = ok(contattiDopo({ ...r, revocatoIl: '2026-11-05' }, { consenso: 'SI', consensoIl: '2026-11-10', origine: 'EMAIL' }, OGGI, 'FILE'))
  assert.deepEqual([di.consenso, di.consensoIl, di.revocatoIl, di.origine], ['SI', '2026-11-10', null, 'EMAIL'])
  // a mano: nuovo consenso con la data di oggi
  assert.equal(ok(contattiDopo({ ...r, revocatoIl: '2026-11-05' }, { consenso: 'SI', origine: 'VOCE' }, OGGI, 'MANO')).consensoIl, OGGI)
})
test('contatti: numero cambiato o tolto, errori', () => {
  const c: Contatti = { ...CONTATTI_VUOTI, telefono: '+393331234567', waId: '393331234567', consenso: 'SI', consensoIl: '2026-01-01', origine: 'ONLINE', whatsapp: 'SI', waIl: '2026-01-01', waFonte: 'MANO' }
  const n = ok(contattiDopo(c, { telefono: '+393339999999' }, OGGI, 'MANO'))
  assert.deepEqual([n.consenso, n.whatsapp, n.waId], ['NO', 'NV', '393339999999'])
  assert.deepEqual(contattiDopo(c, { telefono: '' }, OGGI, 'MANO'), CONTATTI_VUOTI)
  assert.deepEqual(contattiDopo(c, {}, OGGI, 'MANO'), c)
  assert.deepEqual(contattiDopo(CONTATTI_VUOTI, { consenso: 'SI' }, OGGI, 'MANO'), { errore: 'TELEFONO_MANCANTE' })
  assert.deepEqual(contattiDopo(CONTATTI_VUOTI, { telefono: '333' }, OGGI, 'MANO'), { errore: 'TELEFONO_NON_VALIDO' })
  assert.deepEqual(contattiDopo(c, { consensoIl: '2027-01-01' }, OGGI, 'MANO'), { errore: 'DATA_NON_VALIDA' })
  assert.equal(ok(contattiDopo(c, { waId: '5215512345678' }, OGGI, 'FILE')).waId, '5215512345678')
  assert.equal(ok(contattiDopo(c, { whatsapp: 'NV' }, OGGI, 'MANO')).waIl, null)
  // stesso valore: nulla cambia (nessuna variazione finta)
  assert.deepEqual(contattiDopo(c, { consenso: 'SI', whatsapp: 'SI', telefono: c.telefono }, OGGI, 'FILE'), c)
})
test('alimentari: senza consenso non resta nulla', () => {
  assert.deepEqual(alimentariDopo(ALIMENTARI_VUOTI, { esigenze: ['VEGANO'], allergie: 'arachidi' }, OGGI), ALIMENTARI_VUOTI)
  const a = alimentariDopo(ALIMENTARI_VUOTI, { consenso: true, esigenze: ['CELIACO', 'VEGANO'], allergie: ' arachidi ' }, OGGI)
  assert.deepEqual(a, { consenso: true, consensoIl: OGGI, esigenze: ['VEGANO', 'CELIACO'], allergie: 'arachidi' })
  assert.deepEqual(alimentariDopo(a, { consenso: false }, OGGI), ALIMENTARI_VUOTI)
  assert.deepEqual(alimentariDopo(a, { allergie: '' }, OGGI).esigenze, ['VEGANO', 'CELIACO'])
})
