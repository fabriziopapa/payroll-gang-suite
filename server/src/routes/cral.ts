// ============================================================
// PAYROLL GANG SUITE — Routes Modulo CRAL (/api/v1/cral)
//
// Solo admin (decisione del 27/10): menu e rotte nascosti e respinti per
// gli altri. Ogni modifica va nell'audit con ID e conteggi, mai nomi.
//
//   GET    /stato                              tutto lo stato del modulo
//   GET    /anagrafica?q=                      ricerca nell'anagrafica PGS (max 20)
//   POST   /file/leggi                         { nome, base64 } → { fogli } (non scrive nulla)
//   POST   /import/abbina                      { righe[] } → { esiti[] } (non scrive nulla)
//   POST   /import/conferma                    { file, operazioni[] } → { esito }
//   POST   /sedi | PATCH /sedi/:id             sedi di consegna
//   POST   /tipi | PATCH /tipi/:id             tipi di evento
//   POST   /tipologie | PATCH /tipologie/:id   tipologie di prodotto
//   PUT    /parametri/tessera                  formato della tessera
//   POST   /soci                               nuova persona (anche per un evento)
//   PATCH  /soci/:id                           dati, tipologia, sede, tessera
//   PUT    /soci/:id/legami                    soci di un familiare
//   POST   /soci/stato                         { ids, azione } valida/rifiuta/rimetti/cessa/riattiva
//   POST   /soci/:id/riammetti                 rientro di un socio cessato (tessera)
//   POST   /soci/:id/collega                   «Trova in anagrafica PGS» { matricola }
//   POST   /soci/sposta                        { ids, sede }
//   POST   /iniziative | PUT /iniziative/:id   evento (config validata)
//   POST   /iniziative/:id/archivia            { archiviata }
//   POST   /iniziative/:id/partecipanti        { aggiungi[], togli[] }
//   PATCH  /iniziative/:id/scelte/:socio       { dati, fonte? } (unione: null toglie)
//   POST   /iniziative/:id/scelte              { voci[] } import, predefinita
//   POST   /iniziative/:id/carichi             carico di biglietti
//   POST   /iniziative/:id/richieste           richiesta di biglietti
//   PATCH  /iniziative/:id/richieste/:rid      consegna, annulla, pagato, sconto
//   PUT    /quote-anno/:anno                   { importo }
//   PATCH  /quote/:anno/:socio                 { modo?, mesi?, pagataIl?, note? }
//   POST   /quote/:anno/trattenuta             { mese } rata del mese per chi ha la trattenuta
//   POST   /soci/tipologia                     { ids, tipo } tipologia in blocco
//   POST   /soci/:id/passa-esterno             socio dipendente → socio esterno (nuovo ID EXT)
//   POST   /export/soci                        { ids } → Excel soci + familiari (stesse colonne del T6)
//   GET    /export/archivio?sezioni=           archivio JSON per un altro ambiente
//   POST   /lotti/archivio                     { file, archivio, sezioni } → lotto da validare
//   POST   /lotti/t6                           { file, righe } → lotto da validare
//   POST   /lotti/t7                           { file, righe } quote versate → lotto da validare
//   POST   /export/quote                       { anno, ids } → Excel delle quote (stesse colonne del T7)
//   GET    /lotti | GET /lotti/:id             lotti e variazioni
//   PATCH  /lotti/:id                          accetta/scarta (voci o intera sezione)
//   POST   /lotti/:id/applica | /scarta        applica le accettate | scarta il lotto
// ============================================================

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from '../middleware/authenticate.js'
import { PgCralRepository } from '../db/repositories/PgCralRepository.js'
import { PgAuditRepository } from '../db/repositories/PgAuditRepository.js'
import type { CralErrore, CralOperazioneImport, CralQuotaRow } from '../db/IRepository.js'
import {
  abbina, erroreDati, erroreIniziativa, iniziativaSchema, parametriTesseraSchema, riga, sceltaSchema, scontoPersonale,
  unisciDati, usiTolti, type AnagraficaCral, type DatiScelta, type ConfigEvento,
} from '../lib/cral.js'
import { leggiFogli, MAX_BYTE_FILE } from '../services/cral/fogli.js'
import { foglioQuote, foglioSoci } from '../services/cral/esporta.js'
import {
  SEZIONI, archivioDaStato, archivioSchema, confrontaArchivio, confrontaT6, confrontaT7, conteggi, personaDaRiga, rigaT6Schema, rigaT7Schema, type Sezione,
} from '../lib/cralLotti.js'
import { readFileSync } from 'node:fs'

const VERSIONE = (() => {
  try { return String(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version ?? '') } catch { return '' }
})()
/** Nome dell'ambiente (pre-produzione, produzione): PGS_AMBIENTE, altrimenti il dominio. */
const ambienteDi = (r: FastifyRequest) => (process.env['PGS_AMBIENTE']?.trim() || r.hostname || 'PGS').slice(0, 80)
const MAX_BYTE_ARCHIVIO = 40 * 1024 * 1024

const ID_PERSONA = z.string().regex(/^([0-9]{1,10}|EXT-[0-9]{4,6}|FAM-[0-9]{4,6})$/)
const ID_SEDE    = z.string().regex(/^[A-Z0-9]{1,12}$/)
const ID_TIPO    = z.string().regex(/^[A-Z0-9]{1,10}$/)
const UUID       = z.string().uuid()
const DATA       = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const MATRICOLA  = z.string().regex(/^\d{1,10}$/)
const TESSERA    = z.string().trim().max(30).regex(/^[A-Za-z0-9 ._/-]*$/)
const EMAIL      = z.string().trim().max(254).refine(s => !s || /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[A-Za-z]{2,}$/.test(s), 'email')
const ANNO       = z.coerce.number().int().min(2000).max(2100)
const MAX_IDS    = 5000

const STATO_HTTP: Record<CralErrore, number> = {
  TESSERA_DOPPIA: 409, MATRICOLA_GIA_SOCIO: 409, NOME_GIA_USATO: 409, SOCIO_NON_TROVATO: 404,
  SEDE_SCONOSCIUTA: 400, LEGAME_NON_VALIDO: 400, STATO_NON_VALIDO: 409, SUFFISSI_ESAURITI: 409, TIPO_SCONOSCIUTO: 400,
  LOTTO_NON_TROVATO: 404, LOTTO_CHIUSO: 409,
}
const eErrore = (x: unknown): x is CralErrore => typeof x === 'string' && x in STATO_HTTP

export async function cralRoutes(app: FastifyInstance): Promise<void> {
  const repo      = new PgCralRepository(app.db)
  const auditRepo = new PgAuditRepository(app.db)
  const admin     = { preHandler: [app.authenticate, requireAdmin] }
  const uid       = (r: FastifyRequest) => r.user?.id ?? null

  // Audit NON best-effort: se non si registra, l'operazione risponde errore.
  async function audit(request: FastifyRequest, azione: string, entitaId: string | undefined, dettagli: Record<string, unknown>) {
    await auditRepo.log({ userId: request.user?.id, azione, entita: 'cral', entitaId, dettagli, ip: request.ip })
  }
  const errore = (reply: FastifyReply, e: CralErrore) => reply.code(STATO_HTTP[e]).send({ error: e })

  // ── Lettura ────────────────────────────────────────────────
  app.get('/stato', admin, async (_request, reply) => reply.send(await repo.stato()))

  app.get('/anagrafica', admin, async (request, reply) => {
    const { q } = z.object({ q: z.string().trim().min(2).max(60) }).parse(request.query)
    const righe = await repo.cercaAnagrafica(q, 20)
    return reply.send({ risultati: righe.map(a => ({ ...a, cognome: a.cognome ?? a.cognNome ?? '', nome: a.nome ?? '' })) })
  })

  // ── File e import del libro soci ──────────────────────────
  app.post('/file/leggi', { ...admin, bodyLimit: Math.ceil(MAX_BYTE_FILE * 1.4) + 4096 }, async (request, reply) => {
    const b = z.object({ nome: riga(200, 1), base64: z.string().min(4).max(Math.ceil(MAX_BYTE_FILE * 1.37)) }).parse(request.body)
    let fogli: Record<string, string[][]>
    try { fogli = leggiFogli(b.nome, Buffer.from(b.base64, 'base64')) }
    catch (e) {
      const m = e instanceof Error ? e.message : ''
      if (m === 'FILE_TROPPO_GRANDE') return reply.code(413).send({ error: m })
      return reply.code(400).send({ error: m === 'FORMATO_NON_SUPPORTATO' ? m : 'FILE_NON_LEGGIBILE' })
    }
    await audit(request, 'CRAL_FILE_LETTO', undefined, {
      file: b.nome, fogli: Object.keys(fogli).length, righe: Object.values(fogli).reduce((a, f) => a + f.length, 0),
    })
    return reply.send({ fogli })
  })

  app.post('/import/abbina', admin, async (request, reply) => {
    const b = z.object({
      righe: z.array(z.object({
        i: z.number().int().min(0), nominativo: z.string().max(200), matricola: z.string().max(20).optional(), nascita: DATA.optional(),
      })).min(1).max(MAX_IDS),
    }).parse(request.body)
    const anag: AnagraficaCral[] = await repo.anagrafica()
    const perMatricola = new Map(anag.map(a => [a.matricola, a]))
    await audit(request, 'CRAL_IMPORT_ABBINAMENTO', undefined, { righe: b.righe.length })
    return reply.send({ esiti: b.righe.map(r => abbina(r, anag, perMatricola)) })
  })

  const PERSONA_IMPORT = {
    cognome: riga(100, 1), nome: riga(100), nascita: DATA.nullable(), email: EMAIL, sede: ID_SEDE.nullable(),
    tessera: TESSERA, atipico: z.boolean(), nota: riga(300),
  }
  app.post('/import/conferma', admin, async (request, reply) => {
    const b = z.object({
      file: riga(200, 1),
      operazioni: z.array(z.discriminatedUnion('op', [
        z.object({ op: z.literal('aggiorna'), socio: ID_PERSONA, sede: ID_SEDE.nullable().optional(), tessera: TESSERA.optional(), atipico: z.boolean().optional(), nota: riga(300).optional() }),
        z.object({ op: z.literal('nuovoPgs'), matricola: MATRICOLA, tipo: z.enum(['SD', 'EST']), ...PERSONA_IMPORT }),
        z.object({ op: z.literal('nuovoEsterno'), tipo: z.enum(['SE', 'EST']), ...PERSONA_IMPORT }),
        z.object({ op: z.literal('cessa'), socio: ID_PERSONA, nota: riga(300).optional() }),
      ])).min(1).max(MAX_IDS),
    }).parse(request.body)
    // Le matricole nuove devono esistere in anagrafica PGS: cognome, nome e nascita si prendono da li'.
    const anag = new Map((await repo.anagrafica()).map(a => [a.matricola, a]))
    const ops: CralOperazioneImport[] = []
    for (const o of b.operazioni) {
      if (o.op !== 'nuovoPgs') { ops.push(o as CralOperazioneImport); continue }
      const a = anag.get(o.matricola)
      if (!a) return reply.code(400).send({ error: 'MATRICOLA_NON_IN_ANAGRAFICA', matricola: o.matricola })
      ops.push({ ...o, cognome: a.cognome ?? a.cognNome ?? o.cognome, nome: a.nome ?? (a.cognome ? '' : o.nome), nascita: a.nascita ?? o.nascita })
    }
    const esito = await repo.importaLibroSoci(ops, b.file, uid(request))
    if (eErrore(esito)) return errore(reply, esito)
    await audit(request, 'CRAL_IMPORT_CONFERMATO', undefined, { file: b.file, ...esito })
    return reply.send({ esito })
  })

  // ── Sedi, tipi, tipologie, parametri ──────────────────────
  app.post('/sedi', admin, async (request, reply) => {
    const { nome } = z.object({ nome: riga(120, 1) }).parse(request.body)
    const r = await repo.creaSede(nome)
    if (r === 'NOME_GIA_USATO') return errore(reply, r)
    await audit(request, 'CRAL_SEDE_CREATA', r.id, {})
    return reply.code(201).send({ sede: r })
  })
  app.patch('/sedi/:id', admin, async (request, reply) => {
    const { id } = z.object({ id: ID_SEDE }).parse(request.params)
    const b = z.object({ nome: riga(120, 1).optional(), attiva: z.boolean().optional() }).parse(request.body)
    const r = await repo.aggiornaSede(id, b)
    if (r === 'NOME_GIA_USATO') return errore(reply, r)
    if (!r) return reply.code(404).send({ error: 'SEDE_NON_TROVATA' })
    await audit(request, 'CRAL_SEDE_MODIFICATA', id, { campi: Object.keys(b) })
    return reply.send({ sede: r })
  })

  const COLORE = z.string().regex(/^#[0-9A-Fa-f]{6}$/)
  app.post('/tipi', admin, async (request, reply) => {
    const b = z.object({ nome: riga(60, 1), colore: COLORE, pagamento: z.boolean(), modo: z.enum(['SCELTA', 'NESSUNA', 'ORDINE', 'TURNI', 'MAGAZZINO']).nullable().default(null) }).parse(request.body)
    const r = await repo.creaTipo(b)
    await audit(request, 'CRAL_TIPO_CREATO', r.id, {})
    return reply.code(201).send({ tipo: r })
  })
  app.patch('/tipi/:id', admin, async (request, reply) => {
    const { id } = z.object({ id: ID_TIPO }).parse(request.params)
    const b = z.object({ nome: riga(60, 1).optional(), colore: COLORE.optional(), pagamento: z.boolean().optional(), attivo: z.boolean().optional() }).parse(request.body)
    const r = await repo.aggiornaTipo(id, b)
    if (!r) return reply.code(404).send({ error: 'TIPO_NON_TROVATO' })
    await audit(request, 'CRAL_TIPO_MODIFICATO', id, { campi: Object.keys(b) })
    return reply.send({ tipo: r })
  })
  app.post('/tipologie', admin, async (request, reply) => {
    const { nome } = z.object({ nome: riga(80, 1) }).parse(request.body)
    const r = await repo.creaTipologia(nome)
    await audit(request, 'CRAL_TIPOLOGIA_CREATA', r.id, {})
    return reply.code(201).send({ tipologia: r })
  })
  app.patch('/tipologie/:id', admin, async (request, reply) => {
    const { id } = z.object({ id: ID_TIPO }).parse(request.params)
    const b = z.object({ nome: riga(80, 1).optional(), attiva: z.boolean().optional() }).parse(request.body)
    const r = await repo.aggiornaTipologia(id, b)
    if (!r) return reply.code(404).send({ error: 'TIPOLOGIA_NON_TROVATA' })
    await audit(request, 'CRAL_TIPOLOGIA_MODIFICATA', id, { campi: Object.keys(b) })
    return reply.send({ tipologia: r })
  })
  app.put('/parametri/tessera', admin, async (request, reply) => {
    const t = parametriTesseraSchema.parse(request.body)
    await repo.salvaTessera(t, uid(request))
    await audit(request, 'CRAL_PARAMETRI_TESSERA', undefined, { ...t })
    return reply.send({ parametri: await repo.parametri() })
  })

  // ── Persone ────────────────────────────────────────────────
  const LEGAMI = z.array(z.object({ socio: ID_PERSONA, relazione: z.enum(['CONIUGE', 'FIGLIO']) })).max(10)
  app.post('/soci', admin, async (request, reply) => {
    const b = z.object({
      tipo: z.enum(['SD', 'SE', 'EST', 'FAM']), matricola: MATRICOLA.optional(),
      cognome: riga(100).default(''), nome: riga(100).default(''), nascita: DATA.nullable().default(null),
      email: EMAIL.default(''), sede: ID_SEDE.nullable().default(null), tessera: TESSERA.default(''), note: riga(1000).default(''),
      legami: LEGAMI.optional(), perIniziativa: UUID.optional(),
    }).parse(request.body)
    if (b.tipo === 'SD' && !b.matricola) return reply.code(400).send({ error: 'MATRICOLA_MANCANTE' })
    let { cognome, nome, nascita } = b
    if (b.matricola) {
      if (b.tipo !== 'SD' && b.tipo !== 'EST') return reply.code(400).send({ error: 'STATO_NON_VALIDO' })
      const a = (await repo.anagrafica()).find(x => x.matricola === b.matricola)
      if (!a) return reply.code(400).send({ error: 'MATRICOLA_NON_IN_ANAGRAFICA' })
      cognome = a.cognome ?? a.cognNome ?? ''; nome = a.nome ?? ''; nascita = a.nascita ?? nascita
    } else if (!cognome) return reply.code(400).send({ error: 'COGNOME_MANCANTE' })
    if (b.perIniziativa && !(await repo.iniziativa(b.perIniziativa))) return reply.code(404).send({ error: 'EVENTO_NON_TROVATO' })
    // Dall'anagrafica PGS e i familiari: subito attivi. Socio esterno ed esterno: da validare.
    const stato = b.matricola || b.tipo === 'FAM' ? 'ATTIVO' : 'DA_VALIDARE'
    const r = await repo.creaPersona({
      tipo: b.tipo, ...(b.matricola ? { matricola: b.matricola } : {}), cognome: b.matricola ? cognome : cognome.toUpperCase(), nome, nascita,
      email: b.email, sede: b.sede, tessera: b.tessera, note: b.note, ...(b.legami ? { legami: b.legami } : {}),
      stato, ...(b.perIniziativa ? { perIniziativa: b.perIniziativa } : {}),
    }, uid(request))
    if (eErrore(r)) return errore(reply, r)
    await audit(request, 'CRAL_PERSONA_CREATA', r.id, { tipo: r.tipo, stato: r.stato, ...(b.perIniziativa ? { evento: b.perIniziativa } : {}) })
    return reply.code(201).send({ socio: r })
  })

  app.patch('/soci/:id', admin, async (request, reply) => {
    const { id } = z.object({ id: ID_PERSONA }).parse(request.params)
    const b = z.object({
      tipo: z.enum(['SD', 'SE', 'EST']).optional(), cognome: riga(100, 1).optional(), nome: riga(100).optional(),
      nascita: DATA.nullable().optional(), email: EMAIL.optional(), sede: ID_SEDE.nullable().optional(),
      tessera: TESSERA.optional(), note: riga(1000).optional(), atipico: z.boolean().optional(),
    }).parse(request.body)
    const r = await repo.modificaPersona(id, { ...b, ...(b.cognome ? { cognome: b.cognome.toUpperCase() } : {}) }, uid(request))
    if (eErrore(r)) return errore(reply, r)
    await audit(request, 'CRAL_PERSONA_MODIFICATA', id, { campi: Object.keys(b) })
    return reply.send({ socio: r })
  })

  app.put('/soci/:id/legami', admin, async (request, reply) => {
    const { id } = z.object({ id: ID_PERSONA }).parse(request.params)
    const { legami } = z.object({ legami: LEGAMI.min(1) }).parse(request.body)
    const r = await repo.impostaLegami(id, legami, uid(request))
    if (eErrore(r)) return errore(reply, r)
    await audit(request, 'CRAL_LEGAMI_FAMILIARE', id, { soci: legami.map(l => l.socio) })
    return reply.send({ socio: r })
  })

  app.post('/soci/stato', admin, async (request, reply) => {
    const b = z.object({ ids: z.array(ID_PERSONA).min(1).max(MAX_IDS), azione: z.enum(['valida', 'rifiuta', 'rimetti', 'cessa', 'riattiva', 'elimina', 'ripristina']) }).parse(request.body)
    const n = await repo.cambiaStato(b.ids, b.azione, uid(request))
    await audit(request, `CRAL_PERSONE_${b.azione.toUpperCase()}`, b.ids.length === 1 ? b.ids[0] : undefined, { richieste: b.ids.length, fatte: n })
    return reply.send({ fatte: n })
  })

  app.post('/soci/tipologia', admin, async (request, reply) => {
    const b = z.object({ ids: z.array(ID_PERSONA).min(1).max(MAX_IDS), tipo: z.enum(['SD', 'SE', 'EST']) }).parse(request.body)
    const n = await repo.cambiaTipologia(b.ids, b.tipo, uid(request))
    await audit(request, 'CRAL_TIPOLOGIA_IN_BLOCCO', undefined, { tipo: b.tipo, richieste: b.ids.length, fatte: n })
    return reply.send({ fatte: n })
  })

  app.post('/soci/:id/passa-esterno', admin, async (request, reply) => {
    const { id } = z.object({ id: ID_PERSONA }).parse(request.params)
    const r = await repo.passaEsterno(id, uid(request))
    if (eErrore(r)) return errore(reply, r)
    await audit(request, 'CRAL_PASSAGGIO_SOCIO_ESTERNO', r.id, { era: id })
    return reply.send({ socio: r })
  })

  app.post('/soci/:id/riammetti', admin, async (request, reply) => {
    const { id } = z.object({ id: ID_PERSONA }).parse(request.params)
    const r = await repo.riammetti(id, uid(request))
    if (eErrore(r)) return errore(reply, r)
    await audit(request, 'CRAL_SOCIO_RIAMMESSO', id, { tessera: r.tessera })
    return reply.send({ socio: r })
  })

  app.post('/soci/:id/collega', admin, async (request, reply) => {
    const { id } = z.object({ id: ID_PERSONA }).parse(request.params)
    const { matricola } = z.object({ matricola: MATRICOLA }).parse(request.body)
    const a = (await repo.anagrafica()).find(x => x.matricola === matricola)
    if (!a) return reply.code(400).send({ error: 'MATRICOLA_NON_IN_ANAGRAFICA' })
    const r = await repo.collegaPgs(id, a, uid(request))
    if (eErrore(r)) return errore(reply, r)
    await audit(request, 'CRAL_TROVATO_IN_PGS', matricola, { era: id, tipo: r.tipo })
    return reply.send({ socio: r })
  })

  app.post('/soci/sposta', admin, async (request, reply) => {
    const b = z.object({ ids: z.array(ID_PERSONA).min(1).max(MAX_IDS), sede: ID_SEDE.nullable() }).parse(request.body)
    try {
      const n = await repo.spostaSede(b.ids, b.sede, uid(request))
      await audit(request, 'CRAL_SEDE_ASSEGNATA', b.sede ?? undefined, { persone: n })
      return reply.send({ fatte: n })
    } catch (e) { if (e instanceof Error && e.message === 'SEDE_SCONOSCIUTA') return errore(reply, 'SEDE_SCONOSCIUTA'); throw e }
  })

  // ── Export: Excel dei soci e archivio per un altro ambiente ─
  app.post('/export/soci', admin, async (request, reply) => {
    const { ids } = z.object({ ids: z.array(ID_PERSONA).max(50_000) }).parse(request.body)
    const st = await repo.stato()
    const scelti = new Set(ids)
    const soci = st.soci.filter(s => s.tipo !== 'FAM' && scelti.has(s.id))
    const presi = new Set(soci.map(s => s.id))
    const familiari = st.soci.filter(s => s.tipo === 'FAM' && s.legami.some(l => presi.has(l.socio)))
    const buf = foglioSoci(soci, familiari, st.sedi)
    await audit(request, 'CRAL_EXPORT_SOCI', undefined, { soci: soci.length, familiari: familiari.length, ambiente: ambienteDi(request) })
    return reply.send({ ambiente: ambienteDi(request), base64: buf.toString('base64') })
  })

  app.post('/export/quote', admin, async (request, reply) => {
    const b = z.object({ anno: ANNO, ids: z.array(ID_PERSONA).max(50_000) }).parse(request.body)
    const st = await repo.stato()
    const imp = st.quoteAnno.find(a => a.anno === b.anno)?.importo
    if (!imp) return reply.code(404).send({ error: 'ANNO_NON_IMPOSTATO' })
    const scelti = new Set(b.ids)
    const righe = st.soci.filter(s => scelti.has(s.id)).map(s => ({
      s, q: st.quote[String(b.anno)]?.[s.id] ?? { modo: s.matricola ? 'TRATTENUTA' as const : 'UNICA' as const, mesi: Array<boolean>(12).fill(false), importi: Array<number>(12).fill(0), pagataIl: null, versatoUnica: null, note: '' },
    }))
    await audit(request, 'CRAL_EXPORT_QUOTE', String(b.anno), { soci: righe.length, ambiente: ambienteDi(request) })
    return reply.send({ ambiente: ambienteDi(request), base64: foglioQuote(b.anno, imp, righe).toString('base64') })
  })

  app.get('/export/archivio', admin, async (request, reply) => {
    const q = z.object({ sezioni: z.string().max(100).default(SEZIONI.join(',')) }).parse(request.query)
    const sezioni = [...new Set(q.sezioni.split(',').map(x => x.trim()))].filter((x): x is Sezione => (SEZIONI as readonly string[]).includes(x))
    if (!sezioni.length) return reply.code(400).send({ error: 'NESSUNA_SEZIONE' })
    const a = archivioDaStato(await repo.stato(), { app: VERSIONE, ambiente: ambienteDi(request), esportato: new Date().toISOString() }, sezioni)
    await audit(request, 'CRAL_EXPORT_ARCHIVIO', undefined, {
      ambiente: a.ambiente, sezioni, sedi: a.sedi?.length ?? 0, soci: a.soci?.length ?? 0, quote: a.quote?.length ?? 0, eventi: a.eventi?.length ?? 0,
    })
    return reply.send(a)
  })

  // ── Lotti di variazioni da validare ───────────────────────
  app.post('/lotti/archivio', { ...admin, bodyLimit: MAX_BYTE_ARCHIVIO }, async (request, reply) => {
    const b = z.object({ file: riga(200, 1), sezioni: z.array(z.enum(SEZIONI)).min(1).max(5), archivio: z.unknown() }).parse(request.body)
    const p = archivioSchema.safeParse(b.archivio)
    if (!p.success) {
      const primo = p.error.issues[0]
      return reply.code(400).send({ error: 'ARCHIVIO_NON_VALIDO', dove: primo ? primo.path.slice(0, 4).join('.') : '' })
    }
    const src = p.data
    const sezioni = b.sezioni.filter(x => src.sezioni.includes(x))
    if (!sezioni.length) return reply.code(400).send({ error: 'NESSUNA_SEZIONE' })
    const dst = archivioDaStato(await repo.stato(), { app: VERSIONE, ambiente: ambienteDi(request), esportato: '' }, SEZIONI)
    const matricole = new Set((await repo.anagrafica()).map(a => a.matricola))
    const { variazioni, daRimappare } = confrontaArchivio(src, dst, sezioni, matricole)
    const riepilogo = { variazioni: conteggi(variazioni), app: src.app, stessoAmbiente: src.ambiente === ambienteDi(request), daRimappare }
    const id = await repo.creaLotto({ origine: 'ARCHIVIO', file: b.file, ambiente: src.ambiente, esportato: src.esportato || null, sezioni, riepilogo }, variazioni, uid(request))
    await audit(request, 'CRAL_LOTTO_ARCHIVIO', id, { file: b.file, ambiente: src.ambiente, sezioni, variazioni: conteggi(variazioni) })
    return reply.code(201).send({ id, variazioni: variazioni.length })
  })

  app.post('/lotti/t6', { ...admin, bodyLimit: 20 * 1024 * 1024 }, async (request, reply) => {
    const b = z.object({ file: riga(200, 1), righe: z.array(rigaT6Schema).min(1).max(MAX_IDS * 4) }).parse(request.body)
    const st = await repo.stato()
    const anag = await repo.anagrafica()
    const nascita = new Map(anag.map(a => [a.matricola, a.nascita]))
    const oggi = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date())
    const variazioni = confrontaT6(b.righe, st.soci.map(personaDaRiga), new Set(st.sedi.map(s => s.id)), nascita, oggi)
    if (!variazioni.length) return reply.send({ id: null, variazioni: 0 })
    const riepilogo = { variazioni: conteggi(variazioni), righe: b.righe.length }
    const id = await repo.creaLotto({ origine: 'T6', file: b.file, ambiente: ambienteDi(request), esportato: null, sezioni: ['soci'], riepilogo }, variazioni, uid(request))
    await audit(request, 'CRAL_LOTTO_T6', id, { file: b.file, righe: b.righe.length, variazioni: variazioni.length })
    return reply.code(201).send({ id, variazioni: variazioni.length })
  })

  app.post('/lotti/t7', { ...admin, bodyLimit: 20 * 1024 * 1024 }, async (request, reply) => {
    const b = z.object({ file: riga(200, 1), righe: z.array(rigaT7Schema).min(1).max(MAX_IDS * 12) }).parse(request.body)
    const st = await repo.stato()
    const oggi = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date())
    const quote = Object.entries(st.quote).flatMap(([anno, perSocio]) => Object.entries(perSocio).map(([socio, q]) => ({ anno: +anno, socio, ...q })))
    const variazioni = confrontaT7(b.righe, st.soci.map(personaDaRiga), quote, new Map(st.quoteAnno.map(a => [a.anno, a.importo])), oggi)
    if (!variazioni.length) return reply.send({ id: null, variazioni: 0 })
    const riepilogo = { variazioni: conteggi(variazioni), righe: b.righe.length }
    const id = await repo.creaLotto({ origine: 'T7', file: b.file, ambiente: ambienteDi(request), esportato: null, sezioni: ['quote'], riepilogo }, variazioni, uid(request))
    await audit(request, 'CRAL_LOTTO_T7', id, { file: b.file, righe: b.righe.length, variazioni: variazioni.length })
    return reply.code(201).send({ id, variazioni: variazioni.length })
  })

  app.get('/lotti', admin, async (_request, reply) => reply.send({ lotti: await repo.lotti() }))

  app.get('/lotti/:id', admin, async (request, reply) => {
    const { id } = z.object({ id: UUID }).parse(request.params)
    const r = await repo.lotto(id)
    if (!r) return errore(reply, 'LOTTO_NON_TROVATO')
    return reply.send(r)
  })

  app.patch('/lotti/:id', admin, async (request, reply) => {
    const { id } = z.object({ id: UUID }).parse(request.params)
    const b = z.object({
      voci: z.array(z.object({ id: z.number().int().positive(), esito: z.enum(['ACCETTATA', 'SCARTATA', 'ATTESA']), accettati: z.array(z.string().max(40)).max(40).optional() })).max(200_000).optional(),
      sezione: z.enum(SEZIONI).optional(), azione: z.enum(['accettaTutte', 'scartaTutte', 'azzera']).optional(),
    }).parse(request.body)
    const r = await repo.decidiVariazioni(id, b)
    if (eErrore(r)) return errore(reply, r)
    return reply.send({ fatte: r })
  })

  app.post('/lotti/:id/applica', admin, async (request, reply) => {
    const { id } = z.object({ id: UUID }).parse(request.params)
    const r = await repo.applicaLotto(id, uid(request))
    if (eErrore(r)) return errore(reply, r)
    await audit(request, 'CRAL_LOTTO_APPLICATO', id, { ...r })
    return reply.send({ esito: r })
  })

  app.post('/lotti/:id/scarta', admin, async (request, reply) => {
    const { id } = z.object({ id: UUID }).parse(request.params)
    const r = await repo.scartaLotto(id, uid(request))
    if (eErrore(r)) return errore(reply, r)
    await audit(request, 'CRAL_LOTTO_SCARTATO', id, {})
    return reply.send({ ok: true })
  })

  // ── Eventi ─────────────────────────────────────────────────
  async function salvaEvento(request: FastifyRequest, reply: FastifyReply, id: string | null) {
    const i = iniziativaSchema.parse(request.body)
    const err = erroreIniziativa(i)
    if (err) return reply.code(400).send({ error: err })
    if (id) {
      const prima = await repo.iniziativa(id)
      if (!prima) return reply.code(404).send({ error: 'EVENTO_NON_TROVATO' })
      if (prima.archiviata) return reply.code(409).send({ error: 'EVENTO_ARCHIVIATO' })
      if (prima.modalita !== i.modalita && (Object.keys(prima.scelte).length || prima.richieste.length || prima.carichi.length)) {
        return reply.code(409).send({ error: 'MODALITA_IN_USO' })
      }
      const tolto = usiTolti(i.config, await repo.usiIniziativa(id))
      if (tolto) return reply.code(409).send({ error: tolto })
    }
    const r = await repo.salvaIniziativa(id, i, uid(request))
    if (r === 'TIPO_SCONOSCIUTO') return errore(reply, r)
    if (!r) return reply.code(404).send({ error: 'EVENTO_NON_TROVATO' })
    await audit(request, id ? 'CRAL_EVENTO_MODIFICATO' : 'CRAL_EVENTO_CREATO', r.id, { tipo: r.tipo, modalita: r.modalita, stato: r.stato })
    return reply.code(id ? 200 : 201).send({ iniziativa: r })
  }
  app.post('/iniziative', admin, async (request, reply) => salvaEvento(request, reply, null))
  app.put('/iniziative/:id', admin, async (request, reply) => salvaEvento(request, reply, z.object({ id: UUID }).parse(request.params).id))

  app.post('/iniziative/:id/archivia', admin, async (request, reply) => {
    const { id } = z.object({ id: UUID }).parse(request.params)
    const { archiviata } = z.object({ archiviata: z.boolean() }).parse(request.body)
    if (!(await repo.archivia(id, archiviata, uid(request)))) return reply.code(404).send({ error: 'EVENTO_NON_TROVATO' })
    await audit(request, archiviata ? 'CRAL_EVENTO_ARCHIVIATO' : 'CRAL_EVENTO_RIPRISTINATO', id, {})
    return reply.send({ ok: true })
  })

  /** L'evento esiste e non è archiviato: le modifiche lo richiedono. */
  async function eventoModificabile(reply: FastifyReply, id: string) {
    const i = await repo.iniziativa(id)
    if (!i) { reply.code(404).send({ error: 'EVENTO_NON_TROVATO' }); return null }
    if (i.archiviata) { reply.code(409).send({ error: 'EVENTO_ARCHIVIATO' }); return null }
    return i
  }

  app.post('/iniziative/:id/partecipanti', admin, async (request, reply) => {
    const { id } = z.object({ id: UUID }).parse(request.params)
    const b = z.object({ aggiungi: z.array(ID_PERSONA).max(MAX_IDS).default([]), togli: z.array(ID_PERSONA).max(MAX_IDS).default([]) }).parse(request.body)
    if (!(await eventoModificabile(reply, id))) return
    const n = await repo.partecipanti(id, b.aggiungi, b.togli)
    await audit(request, 'CRAL_PARTECIPANTI', id, { aggiunti: b.aggiungi.length, tolti: b.togli.length })
    return reply.send({ fatte: n })
  })

  const FONTE = z.enum(['manuale', 'modulo', 'predefinita'])
  /** Unisce e valida i dati di una scelta contro la config dell'evento. */
  function datiValidi(prima: Record<string, unknown> | undefined, patch: DatiScelta, config: ConfigEvento): DatiScelta | string {
    const { fonte: _f, ...vecchi } = (prima ?? {}) as Record<string, unknown>
    const uniti = unisciDati(sceltaSchema.parse(vecchi), patch)
    return erroreDati(uniti, config) ?? uniti
  }

  app.patch('/iniziative/:id/scelte/:socio', admin, async (request, reply) => {
    const { id, socio } = z.object({ id: UUID, socio: ID_PERSONA }).parse(request.params)
    const b = z.object({ dati: sceltaSchema, fonte: FONTE.default('manuale') }).parse(request.body)
    const i = await eventoModificabile(reply, id)
    if (!i) return
    const d = datiValidi(i.scelte[socio], b.dati, i.config as ConfigEvento)
    if (typeof d === 'string') return reply.code(400).send({ error: d })
    await repo.salvaScelte(id, [{ socio, dati: d, fonte: b.fonte }], uid(request))
    await audit(request, 'CRAL_SCELTA', id, { socio, campi: Object.keys(b.dati) })
    return reply.send({ dati: d })
  })

  app.post('/iniziative/:id/scelte', admin, async (request, reply) => {
    const { id } = z.object({ id: UUID }).parse(request.params)
    const b = z.object({
      voci: z.array(z.object({ socio: ID_PERSONA, dati: sceltaSchema, sostituisci: z.boolean().default(false) })).min(1).max(MAX_IDS),
      fonte: FONTE.default('modulo'),
    }).parse(request.body)
    const i = await eventoModificabile(reply, id)
    if (!i) return
    const voci = []
    for (const v of b.voci) {
      const d = datiValidi(v.sostituisci ? undefined : i.scelte[v.socio], v.dati, i.config as ConfigEvento)
      if (typeof d === 'string') return reply.code(400).send({ error: d, socio: v.socio })
      voci.push({ socio: v.socio, dati: d, fonte: b.fonte })
    }
    await repo.salvaScelte(id, voci, uid(request))
    await audit(request, 'CRAL_SCELTE_IN_BLOCCO', id, { voci: voci.length, fonte: b.fonte })
    return reply.send({ fatte: voci.length })
  })

  app.post('/iniziative/:id/carichi', admin, async (request, reply) => {
    const { id } = z.object({ id: UUID }).parse(request.params)
    const b = z.object({ art: z.string().max(30), qta: z.number().int().min(1).max(100_000), data: DATA, note: riga(300).default('') }).parse(request.body)
    const i = await eventoModificabile(reply, id)
    if (!i) return
    if (!(i.config as ConfigEvento).articoli?.some(a => a.id === b.art)) return reply.code(400).send({ error: 'ARTICOLO_SCONOSCIUTO' })
    const r = await repo.creaCarico(id, b, uid(request))
    await audit(request, 'CRAL_CARICO', id, { articolo: b.art, quantita: b.qta })
    return reply.code(201).send({ carico: r })
  })

  app.post('/iniziative/:id/richieste', admin, async (request, reply) => {
    const { id } = z.object({ id: UUID }).parse(request.params)
    const b = z.object({
      persona: ID_PERSONA, art: z.string().max(30), qta: z.number().int().min(1).max(1000), dataRich: DATA,
      modo: z.enum(['MANO', 'EMAIL']).default('MANO'), note: riga(300).default(''),
    }).parse(request.body)
    const i = await eventoModificabile(reply, id)
    if (!i) return
    if (!(i.config as ConfigEvento).articoli?.some(a => a.id === b.art)) return reply.code(400).send({ error: 'ARTICOLO_SCONOSCIUTO' })
    if (!(await repo.socio(b.persona))) return reply.code(404).send({ error: 'SOCIO_NON_TROVATO' })
    const r = await repo.creaRichiesta(id, b, uid(request))
    await audit(request, 'CRAL_RICHIESTA', id, { richiesta: r.id, socio: b.persona, quantita: b.qta })
    return reply.code(201).send({ richiesta: r })
  })

  app.patch('/iniziative/:id/richieste/:rid', admin, async (request, reply) => {
    const { id, rid } = z.object({ id: UUID, rid: UUID }).parse(request.params)
    const b = z.object({
      stato: z.enum(['ATTESA', 'CONSEGNATA', 'ANNULLATA']).optional(), dataCons: DATA.nullable().optional(),
      modo: z.enum(['MANO', 'EMAIL']).optional(), pagato: z.boolean().optional(), sconto: scontoPersonale.nullable().optional(),
      note: riga(300).optional(),
    }).parse(request.body)
    if (b.stato === 'CONSEGNATA' && !b.dataCons) return reply.code(400).send({ error: 'DATA_CONSEGNA_MANCANTE' })
    if (b.stato && b.stato !== 'CONSEGNATA') b.dataCons = null
    if (!(await eventoModificabile(reply, id))) return
    const r = await repo.aggiornaRichiesta(id, rid, b, uid(request))
    if (!r) return reply.code(404).send({ error: 'RICHIESTA_NON_TROVATA' })
    await audit(request, 'CRAL_RICHIESTA_MODIFICATA', id, { richiesta: rid, campi: Object.keys(b), ...(b.stato ? { stato: b.stato } : {}) })
    return reply.send({ richiesta: r })
  })

  // ── Quote associative ─────────────────────────────────────
  app.put('/quote-anno/:anno', admin, async (request, reply) => {
    const { anno } = z.object({ anno: ANNO }).parse(request.params)
    const { importo } = z.object({ importo: z.number().int().min(1).max(10_000_000) }).parse(request.body)
    await repo.salvaQuotaAnno(anno, importo, uid(request))
    await audit(request, 'CRAL_QUOTA_ANNO', String(anno), { importo })
    return reply.send({ ok: true })
  })

  app.patch('/quote/:anno/:socio', admin, async (request, reply) => {
    const { anno, socio } = z.object({ anno: ANNO, socio: ID_PERSONA }).parse(request.params)
    const b = z.object({
      modo: z.enum(['UNICA', 'MENSILE', 'TRATTENUTA']).optional(), mesi: z.array(z.boolean()).length(12).optional(),
      pagataIl: DATA.nullable().optional(), note: riga(300).optional(),
    }).parse(request.body)
    const s = await repo.socio(socio)
    if (!s) return errore(reply, 'SOCIO_NON_TROVATO')
    if (s.tipo !== 'SD' && s.tipo !== 'SE') return reply.code(400).send({ error: 'NON_E_SOCIO' })
    if (b.modo === 'TRATTENUTA' && !s.matricola) return reply.code(400).send({ error: 'TRATTENUTA_SENZA_MATRICOLA' })
    const predef: CralQuotaRow['modo'] = s.matricola ? 'TRATTENUTA' : 'UNICA'
    const r = await repo.salvaQuota(anno, socio, b, predef, uid(request))
    if (!r) return reply.code(404).send({ error: 'ANNO_NON_IMPOSTATO' })
    await audit(request, 'CRAL_QUOTA_SOCIO', socio, { anno, campi: Object.keys(b) })
    return reply.send({ quota: r })
  })

  app.post('/quote/:anno/trattenuta', admin, async (request, reply) => {
    const { anno } = z.object({ anno: ANNO }).parse(request.params)
    const b = z.object({ mese: z.number().int().min(1).max(12), soci: z.array(ID_PERSONA).max(MAX_IDS) }).parse(request.body)
    const n = await repo.registraTrattenuta(anno, b.mese, b.soci, uid(request))
    await audit(request, 'CRAL_TRATTENUTA_MESE', String(anno), { mese: b.mese, soci: n })
    return reply.send({ fatte: n })
  })
}
