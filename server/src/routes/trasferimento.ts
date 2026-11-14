// ============================================================
// PAYROLL GANG SUITE — Esporta e importa (/api/v1/trasferimento)
//
// Porta i dati da un'installazione di PGS a un'altra (produzione ↔
// pre-produzione) in un file cifrato .pgsx. In questo rilascio la
// sezione disponibile e' il CRAL.
//
//   GET    /stato                     ambiente, schema, cosa si puo' esportare
//   POST   /esporta                   { cral: [sezioni], otp } → file + frase (una volta)
//   POST   /carica                    { nome, byte, pezzi } → id del caricamento
//   POST   /carica/:id/pezzo          { n, base64 } un pezzo del file
//   POST   /carica/:id/apri           { frase } → verifiche e contenuto dichiarato
//   POST   /carica/:id/confronta      { cral: [sezioni] } → lotto CRAL da validare
//   DELETE /carica/:id                abbandona il caricamento
//
// COSA NON FA, DI PROPOSITO. Non scrive nei dati: il confronto prepara un
// lotto (come gia' fanno gli import del CRAL), che si guarda, si accetta
// campo per campo e si PROVA dal modulo CRAL. L'applicazione di un lotto
// arrivato da file cifrato — tutto o niente — arriva col prossimo rilascio.
//
// IL FILE NON TOCCA IL DISCO. I pezzi e il contenuto decifrato vivono in
// memoria, per un quarto d'ora al massimo, legati a chi li ha caricati.
// Un riavvio del processo li perde: si ricarica il file.
//
// Tutte le rotte: solo amministratori. Esportare richiede di nuovo il
// codice OTP: un token rubato non deve bastare a portarsi via i dati.
// ============================================================

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from '../middleware/authenticate.js'
import { clientIp } from '../lib/clientIp.js'
import { PgAuditRepository } from '../db/repositories/PgAuditRepository.js'
import { PgCralRepository } from '../db/repositories/PgCralRepository.js'
import { PgTrasferimentoRepository } from '../db/repositories/PgTrasferimentoRepository.js'
import { SEZIONI, archivioDaStato, confrontaArchivio, conteggi, type Archivio, type Sezione } from '../lib/cralLotti.js'
import {
  BYTE_PEZZO, ErroreFile, FORMATO, MAX_BYTE_FILE, cifra, decifra, differenzaSchema, generaFrase, improntaSchema, improntaSezione,
  leggiContenuto, nomeFile, sha256, type Contenuto, type Schema,
} from '../lib/trasferimento.js'

const VERSIONE = (() => {
  try { return String(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version ?? '') } catch { return '' }
})()
const ambienteDi = (r: FastifyRequest) => (process.env['PGS_AMBIENTE']?.trim() || r.hostname || 'PGS').slice(0, 80)

const UUID = z.string().uuid()
const PARTI_CRAL = z.array(z.enum(SEZIONI)).min(1).max(5)
const DURATA_MS = 15 * 60 * 1000
const MAX_CARICAMENTI = 3
const MAX_FRASI_SBAGLIATE = 5

interface Caricamento {
  utente: string; nome: string; byte: number; pezzi: Array<Buffer | null>; creato: number
  frasiSbagliate: number
  /** Il contenuto, dopo che il file e' stato aperto: il file cifrato a quel punto si butta. */
  contenuto: Contenuto | null
}

/** Quante righe porta ogni parte del CRAL (per il manifesto e per chi sceglie cosa esportare). */
function righeCral(a: Archivio): Record<string, number> {
  const r: Record<string, number> = {}
  if (a.sedi) r['sedi'] = a.sedi.length
  if (a.tabelle) r['tabelle'] = a.tabelle.tipi.length + a.tabelle.tipologie.length + a.tabelle.quoteAnno.length + 1
  if (a.soci) r['soci'] = a.soci.length
  if (a.quote) r['quote'] = a.quote.length
  if (a.eventi) r['eventi'] = a.eventi.length
  return r
}

export async function trasferimentoRoutes(app: FastifyInstance): Promise<void> {
  const cral      = new PgCralRepository(app.db)
  const catalogo  = new PgTrasferimentoRepository(app.db)
  const auditRepo = new PgAuditRepository(app.db)
  const admin     = { preHandler: [app.authenticate, requireAdmin] }

  // Audit NON best-effort: se non si registra, l'operazione risponde errore.
  async function audit(request: FastifyRequest, azione: string, entitaId: string | undefined, dettagli: Record<string, unknown>) {
    await auditRepo.log({ userId: request.user?.id, azione, entita: 'trasferimento', entitaId, dettagli, ip: clientIp(request) })
  }
  const schemaDiQui = async (): Promise<Schema> => improntaSchema(await catalogo.migrazioni(), await catalogo.struttura())

  // ── Caricamenti in corso (in memoria) ──────────────────────
  const caricamenti = new Map<string, Caricamento>()
  const pulisci = () => { const ora = Date.now(); for (const [k, c] of caricamenti) if (ora - c.creato > DURATA_MS) caricamenti.delete(k) }
  const pulizia = setInterval(pulisci, 60_000)
  pulizia.unref()
  app.addHook('onClose', async () => { clearInterval(pulizia); caricamenti.clear() })
  /** Il caricamento, solo a chi l'ha iniziato. */
  function mio(request: FastifyRequest, reply: FastifyReply): { id: string; c: Caricamento } | null {
    pulisci()
    const p = z.object({ id: UUID }).safeParse(request.params)
    const c = p.success ? caricamenti.get(p.data.id) : undefined
    if (!p.success || !c || c.utente !== request.user?.id) { void reply.code(404).send({ error: 'CARICAMENTO_NON_TROVATO' }); return null }
    return { id: p.data.id, c }
  }

  // ── Stato ──────────────────────────────────────────────────
  app.get('/stato', admin, async (request, reply) => {
    const [schema, st] = await Promise.all([schemaDiQui(), cral.stato()])
    return reply.send({
      app: VERSIONE, ambiente: ambienteDi(request),
      schema: { migrazioni: schema.migrazioni, ultima: schema.ultima },
      limiti: { byteFile: MAX_BYTE_FILE, bytePezzo: BYTE_PEZZO },
      sezioni: { cral: righeCral(archivioDaStato(st, { app: VERSIONE, ambiente: '', esportato: '' }, SEZIONI)) },
    })
  })

  // ── Esportazione ───────────────────────────────────────────
  app.post('/esporta', admin, async (request, reply) => {
    const b = z.object({ cral: PARTI_CRAL, otp: z.string().regex(/^\d{6}$/) }).strict().parse(request.body)
    const u = request.user!
    try { await app.authService.confermaOtp(u.id, u.username, b.otp, clientIp(request), 'TRASFERIMENTO_EXPORT') }
    catch (e) {
      const codice = e instanceof Error ? e.message : ''
      // mai 401: il client lo prenderebbe per un token scaduto e rimanderebbe la richiesta con lo stesso codice
      if (codice === 'ACCOUNT_LOCKED') return reply.code(423).send({ error: 'ACCOUNT_LOCKED' })
      if (codice === 'OTP_NON_VALIDO') return reply.code(403).send({ error: 'OTP_NON_VALIDO' })
      throw e
    }
    const parti = SEZIONI.filter(s => b.cral.includes(s))
    const adesso = new Date()
    const archivio = archivioDaStato(await cral.stato(), { app: VERSIONE, ambiente: ambienteDi(request), esportato: adesso.toISOString() }, parti)
    const righe = righeCral(archivio)
    const contenuto: Contenuto = {
      formato: FORMATO, versione: 1,
      manifesto: {
        app: VERSIONE, ambiente: ambienteDi(request), esportato: adesso.toISOString(), da: u.username.slice(0, 100),
        schema: await schemaDiQui(),
        sezioni: { cral: { sha256: improntaSezione(archivio), parti: [...parti], righe } },
      },
      sezioni: { cral: archivio },
    }
    const frase = generaFrase()
    let file: Buffer
    try { file = await cifra(contenuto, frase) }
    catch (e) { if (e instanceof ErroreFile) return reply.code(413).send({ error: e.codice }); throw e }
    const nome = nomeFile(adesso)
    // nel registro: cosa e' uscito e l'impronta del file. Mai la frase.
    await audit(request, 'TRASFERIMENTO_EXPORT', undefined, { file: nome, byte: file.length, sha256: sha256(file), ambiente: ambienteDi(request), cral: righe })
    return reply.send({ nome, byte: file.length, base64: file.toString('base64'), frase, righe: { cral: righe } })
  })

  // ── Caricamento a pezzi ────────────────────────────────────
  app.post('/carica', admin, async (request, reply) => {
    const b = z.object({
      nome: z.string().trim().min(1).max(200).regex(/^[^\u0000-\u001f<>]*$/),
      byte: z.number().int().min(1).max(MAX_BYTE_FILE), pezzi: z.number().int().min(1).max(Math.ceil(MAX_BYTE_FILE / BYTE_PEZZO)),
    }).strict().parse(request.body)
    if (b.pezzi !== Math.ceil(b.byte / BYTE_PEZZO)) return reply.code(400).send({ error: 'PEZZI_NON_VALIDI' })
    pulisci()
    const utente = request.user!.id
    // un nuovo caricamento prende il posto dei precedenti dello stesso utente
    for (const [k, c] of caricamenti) if (c.utente === utente) caricamenti.delete(k)
    if (caricamenti.size >= MAX_CARICAMENTI) return reply.code(409).send({ error: 'TROPPI_CARICAMENTI' })
    const id = randomUUID()
    caricamenti.set(id, { utente, nome: b.nome, byte: b.byte, pezzi: Array<Buffer | null>(b.pezzi).fill(null), creato: Date.now(), frasiSbagliate: 0, contenuto: null })
    return reply.code(201).send({ id, bytePezzo: BYTE_PEZZO })
  })

  app.post('/carica/:id/pezzo', { ...admin, bodyLimit: 1024 * 1024 }, async (request, reply) => {
    const m = mio(request, reply); if (!m) return reply
    const b = z.object({ n: z.number().int().min(0).max(m.c.pezzi.length - 1), base64: z.string().min(1).max(Math.ceil(BYTE_PEZZO / 3) * 4 + 4).regex(/^[A-Za-z0-9+/]*={0,2}$/) }).strict().parse(request.body)
    if (m.c.contenuto) return reply.code(409).send({ error: 'FILE_GIA_APERTO' })
    const pezzo = Buffer.from(b.base64, 'base64')
    const ultimo = b.n === m.c.pezzi.length - 1
    const atteso = ultimo ? m.c.byte - BYTE_PEZZO * (m.c.pezzi.length - 1) : BYTE_PEZZO
    if (pezzo.length !== atteso) return reply.code(400).send({ error: 'PEZZO_NON_VALIDO' })
    m.c.pezzi[b.n] = pezzo
    return reply.send({ ricevuti: m.c.pezzi.filter(Boolean).length, di: m.c.pezzi.length })
  })

  app.post('/carica/:id/apri', admin, async (request, reply) => {
    const m = mio(request, reply); if (!m) return reply
    const b = z.object({ frase: z.string().min(1).max(200) }).strict().parse(request.body)
    if (m.c.contenuto) return reply.code(409).send({ error: 'FILE_GIA_APERTO' })
    if (m.c.pezzi.some(p => !p)) return reply.code(409).send({ error: 'FILE_INCOMPLETO' })
    const file = Buffer.concat(m.c.pezzi as Buffer[])
    const impronta = sha256(file)
    let contenuto: Contenuto
    try { contenuto = leggiContenuto(await decifra(file, b.frase)) }
    catch (e) {
      if (!(e instanceof ErroreFile)) throw e
      if (e.codice === 'FILE_O_FRASE_NON_VALIDI') m.c.frasiSbagliate++
      const esaurito = m.c.frasiSbagliate >= MAX_FRASI_SBAGLIATE
      // un file che non e' un .pgsx, o che non si aprira' mai, non resta in memoria
      if (esaurito || e.codice !== 'FILE_O_FRASE_NON_VALIDI') caricamenti.delete(m.id)
      await audit(request, 'TRASFERIMENTO_FILE_RIFIUTATO', undefined, { file: m.c.nome, byte: file.length, sha256: impronta, motivo: e.codice, dove: e.dove, tentativi: m.c.frasiSbagliate })
      return reply.code(e.codice === 'FILE_O_FRASE_NON_VALIDI' ? 403 : 400).send({ error: esaurito ? 'TROPPI_TENTATIVI' : e.codice, dove: e.dove, restano: Math.max(0, MAX_FRASI_SBAGLIATE - m.c.frasiSbagliate) })
    }
    const qui = await schemaDiQui()
    const diverso = differenzaSchema(contenuto.manifesto.schema, qui)
    const man = contenuto.manifesto
    const esito = {
      file: m.c.nome, byte: file.length,
      app: man.app, ambiente: man.ambiente, esportato: man.esportato, da: man.da,
      stessoAmbiente: man.ambiente === ambienteDi(request), ambienteQui: ambienteDi(request), appQui: VERSIONE,
      schema: { uguale: !diverso, motivo: diverso, file: { migrazioni: man.schema.migrazioni, ultima: man.schema.ultima }, qui: { migrazioni: qui.migrazioni, ultima: qui.ultima } },
      sezioni: { cral: man.sezioni.cral ? { parti: man.sezioni.cral.parti, righe: man.sezioni.cral.righe } : null },
    }
    await audit(request, 'TRASFERIMENTO_FILE_APERTO', undefined, { file: m.c.nome, byte: file.length, sha256: impronta, ambiente: man.ambiente, app: man.app, schemaUguale: !diverso, cral: man.sezioni.cral?.righe ?? null })
    // schema diverso: il file non si usa, e non resta in memoria
    if (diverso) { caricamenti.delete(m.id); return reply.send({ ...esito, aperto: false }) }
    m.c.contenuto = contenuto
    m.c.pezzi = []
    return reply.send({ ...esito, aperto: true })
  })

  app.post('/carica/:id/confronta', admin, async (request, reply) => {
    const m = mio(request, reply); if (!m) return reply
    const b = z.object({ cral: PARTI_CRAL }).strict().parse(request.body)
    const src = m.c.contenuto?.sezioni.cral
    if (!m.c.contenuto) return reply.code(409).send({ error: 'FILE_NON_APERTO' })
    if (!src) return reply.code(400).send({ error: 'NESSUNA_SEZIONE' })
    // fra l'apertura e il confronto lo schema di qui potrebbe essere cambiato (un deploy): si ricontrolla
    if (differenzaSchema(m.c.contenuto.manifesto.schema, await schemaDiQui())) { caricamenti.delete(m.id); return reply.code(409).send({ error: 'SCHEMA_DIVERSO' }) }
    const sezioni = SEZIONI.filter((s): s is Sezione => b.cral.includes(s) && src.sezioni.includes(s))
    if (!sezioni.length) return reply.code(400).send({ error: 'NESSUNA_SEZIONE' })
    const dst = archivioDaStato(await cral.stato(), { app: VERSIONE, ambiente: ambienteDi(request), esportato: '' }, SEZIONI)
    const matricole = new Set((await cral.anagrafica()).map(a => a.matricola))
    const { variazioni, daRimappare } = confrontaArchivio(src, dst, sezioni, matricole)
    const riepilogo = { variazioni: conteggi(variazioni), app: src.app, stessoAmbiente: src.ambiente === ambienteDi(request), daRimappare }
    const lotto = await cral.creaLotto({ origine: 'PGSX', file: m.c.nome, ambiente: src.ambiente, esportato: src.esportato || null, sezioni, riepilogo }, variazioni, request.user?.id ?? null)
    caricamenti.delete(m.id)
    await audit(request, 'TRASFERIMENTO_CONFRONTO', lotto, { file: m.c.nome, ambiente: src.ambiente, cral: sezioni, variazioni: conteggi(variazioni) })
    return reply.code(201).send({ lotto, variazioni: variazioni.length })
  })

  app.delete('/carica/:id', admin, async (request, reply) => {
    const m = mio(request, reply); if (!m) return reply
    caricamenti.delete(m.id)
    return reply.code(204).send()
  })
}
