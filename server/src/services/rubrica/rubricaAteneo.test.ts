import { test } from 'node:test'
import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import { controllaIntermedio, creaRubrica, emailPulita, erroreTls, pubblica, RubricaNonRaggiungibile, type Trasporto } from './rubricaAteneo.js'
import { GEANT_TLS_ECC_1, IMPRONTA_GEANT_TLS_ECC_1 } from './certificati.js'
import { abbina, chiaveNome } from './abbina.js'

const P = (idAb: number, cognome: string, nome: string, codFisc = '') => ({ idAb, cognome, nome, codFisc, tipoRuoloDesc: 'Personale tecnico amministrativo', afferenza: 'Ufficio X', email: null })
/** Portale finto: 250 persone; elenco a pagine, ricerca per cognome, dettaglio con email o '-'. */
function finto(opz: { errori?: number[] } = {}): { t: Trasporto; chiamate: string[] } {
  const tutti = Array.from({ length: 250 }, (_, i) => P(1000 + i, i < 3 ? 'ROSSINI' : `COGNOME${i}`, `Nome${i}`))
  const chiamate: string[] = []
  const errori = [...(opz.errori ?? [])]
  const t: Trasporto = async percorso => {
    chiamate.push(percorso)
    const e = errori.shift(); if (e) return { status: e, corpo: '' }
    const m = percorso.match(/ricercaPersonale\/\*\/([^/]+)\/.*pageNumber=(\d+)&pageMaxElement=(\d+)/)
    if (m) {
      const cogn = decodeURIComponent(m[1]!), pg = +m[2]!, n = +m[3]!
      const sel = cogn === '*' ? tutti : tutti.filter(x => x.cognome.toUpperCase().startsWith(cogn.toUpperCase()))
      return { status: 200, corpo: JSON.stringify({ errorCode: 0, totalCount: sel.length, personaleList: sel.slice((pg - 1) * n, pg * n) }) }
    }
    const d = percorso.match(/dettaglioPersonaleById\/(\d+)/)
    if (d) {
      const p = tutti.find(x => x.idAb === +d[1]!)
      if (!p) return { status: 200, corpo: JSON.stringify({ errorCode: -99, errorMessage: 'Errore server [null]', personale: null }) }
      return { status: 200, corpo: JSON.stringify({ errorCode: 0, personale: { ...p, email: p.idAb % 2 ? '-' : `p${p.idAb}@UNIPARTHENOPE.IT` } }) }
    }
    return { status: 404, corpo: '' }
  }
  return { t, chiamate }
}

test('rubrica: elenco intero, una volta sola grazie alla memoria', async () => {
  const f = finto()
  const r = creaRubrica({ trasporto: f.t, attesaRiprova: 1 })
  const [a, b] = await Promise.all([r.elenco(), r.elenco()])
  assert.equal(a.length, 250); assert.equal(b, a)
  assert.equal(f.chiamate.length, 1, 'una pagina da 1000, richieste contemporanee unite')
  await r.elenco(); assert.equal(f.chiamate.length, 1)
})

test('rubrica: ricerca per cognome, codificata, in memoria; la memoria scade', async () => {
  const f = finto(); let ora = 0
  const r = creaRubrica({ trasporto: f.t, ttlMs: 1000, ora: () => ora })
  assert.equal((await r.cerca('rossini')).length, 3)
  await r.cerca('ROSSINI'); assert.equal(f.chiamate.length, 1)
  ora = 1001; await r.cerca('Rossini'); assert.equal(f.chiamate.length, 2)
  await r.cerca("D'ARCO"); assert.match(f.chiamate.at(-1)!, /D'ARCO|D%27ARCO/)
  assert.deepEqual(await r.cerca('x'), [])
})

test('rubrica: dettaglio con email; «-» = non pubblicata; idAb inesistente = null', async () => {
  const r = creaRubrica({ trasporto: finto().t })
  const d = await r.dettaglio(1002)
  assert.equal(d?.email, 'p1002@uniparthenope.it'); assert.equal(d?.persona.cognome, 'ROSSINI')
  assert.equal(await r.email(1003), '')
  assert.equal(await r.dettaglio(99999), null)
  assert.equal(emailPulita(' - '), ''); assert.equal(emailPulita(null), ''); assert.equal(emailPulita('non è una mail'), '')
})

test('rubrica: un nuovo tentativo su 429/5xx, poi errore chiaro', async () => {
  const ok = finto({ errori: [503] })
  assert.equal((await creaRubrica({ trasporto: ok.t, attesaRiprova: 1 }).elenco()).length, 250)
  const ko = finto({ errori: [500, 500] })
  await assert.rejects(creaRubrica({ trasporto: ko.t, attesaRiprova: 1 }).elenco(), (e: unknown) => e instanceof RubricaNonRaggiungibile && /HTTP 500/.test(e.message))
  const no = finto({ errori: [403] })
  await assert.rejects(creaRubrica({ trasporto: no.t, attesaRiprova: 1 }).cerca('ROSSINI'), /HTTP 403/)
})

test('rubrica: il codice fiscale non esce verso il client', () => {
  const x = pubblica({ idAb: 1, cognome: 'A', nome: 'B', codFisc: 'BNCGLI85M41F839X', ruolo: 'r', afferenza: 'a' }, 'a@b.it')
  assert.ok(!('codFisc' in x)); assert.equal(x.email, 'a@b.it')
})

test('certificato intermedio: impronta attesa, date, alterazione', () => {
  const c = new X509Certificate(GEANT_TLS_ECC_1)
  assert.equal(c.fingerprint256, IMPRONTA_GEANT_TLS_ECC_1)
  assert.match(c.subject, /CN=GEANT TLS ECC 1/); assert.match(c.issuer, /HARICA TLS ECC Root CA 2021/)
  const ok = controllaIntermedio(GEANT_TLS_ECC_1, IMPRONTA_GEANT_TLS_ECC_1, Date.parse('2026-11-11'))
  assert.ok(ok.ok); assert.ok(ok.ok && ok.info.giorni > 4700)
  assert.match((controllaIntermedio(GEANT_TLS_ECC_1, 'AA:BB', Date.parse('2026-11-11')) as { motivo: string }).motivo, /alterato/)
  assert.match((controllaIntermedio(GEANT_TLS_ECC_1, IMPRONTA_GEANT_TLS_ECC_1, Date.parse('2040-01-01')) as { motivo: string }).motivo, /scaduto/)
  assert.ok(!controllaIntermedio('non e un pem').ok)
  assert.match(erroreTls(Object.assign(new Error('x'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' })), /aggiornato il certificato intermedio/)
})

test('abbinamento: idAb, poi codice fiscale, poi nome; omonimi = candidati', () => {
  const el = [
    { idAb: 9001, cognome: 'ROSSINI', nome: 'Giulia', codFisc: 'RSSMRA80A01F839Z', ruolo: 'Professore Associato', afferenza: 'Dip.' },
    { idAb: 9002, cognome: 'ROSSINI', nome: 'Giulia', codFisc: 'VRDLGU85M15H501X', ruolo: 'Personale tecnico amministrativo', afferenza: 'Uff.' },
    { idAb: 5, cognome: "D'ARCO", nome: 'Anna Rita', codFisc: '', ruolo: '', afferenza: '' },
  ]
  assert.deepEqual(abbina(el, { idAb: 9001, cognome: 'ROSSINI', nome: 'Giulia' }), { esito: 'TROVATA', persona: el[0], come: 'idAb' })
  assert.equal((abbina(el, { idAb: 999, codFisc: 'vrdlgu85m15h501x', cognome: 'ROSSINI', nome: 'Giulia' }) as { come: string }).come, 'codice fiscale')
  assert.equal(abbina(el, { cognome: 'Rossini', nome: 'Giulia' }).esito, 'CANDIDATI')
  assert.equal((abbina(el, { cognome: 'Darco', nome: 'ANNA RITA' }) as { come: string }).come, 'nome')
  assert.equal(abbina(el, { cognome: 'NESSUNO', nome: 'X' }).esito, 'NON_TROVATA')
  assert.equal(abbina(el, { cognome: '', nome: 'Giulia' }).esito, 'NON_TROVATA')
  assert.equal(chiaveNome('DELLA RAGIONE', 'Ileana'), chiaveNome('Ileana Della Ragione'))
})
