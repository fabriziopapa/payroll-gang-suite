// ============================================================
// PAYROLL GANG SUITE — Routes Versamenti enti (/api/v1/versamenti)
//
// La stampa versamenti di CSA (STAMPA_VERSAMENTI_*.CSV) si elabora nel
// BROWSER: nominativi, matricole, codici fiscali, date di nascita e importi
// non arrivano mai qui. Il server tiene solo la rubrica degli enti e i
// modelli mail, e registra nell'audit chi ha fatto cosa.
//
// Accesso: tutti gli utenti autenticati (decisione dell'ufficio).
//
//   GET    /enti                       { enti[] }
//   POST   /enti/sincronizza           { file, enti:[{codice,descrizione}] } → { enti[], nuovi[] }
//   PATCH  /enti/:codice               { email?, abilitato?, modelloId? }    → { ente }
//   POST   /enti/importa               { file, righe:[{codice,descrizione,email,abilitato}] }
//                                       → { enti[], nuovi[], aggiornati[], saltati[], invariati[] }
//   GET    /modelli                    { modelli[] }
//   POST   /modelli                    modello                               → { modello }
//   PUT    /modelli/:id                modello                               → { modello }
//   POST   /modelli/:id/predefinito                                          → { modello }
//   DELETE /modelli/:id                                                      → { entiRiportati }
//   POST   /eventi/generazione         { enti[], eml, righe, mesi[], modo, selezione? } → { ok }
//   POST   /eventi/esportazione        { formato, modo, enti[], righe, persone, file_generati, codiceFiscale } → { ok }
// ============================================================

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { PgVersamentiRepository } from '../db/repositories/PgVersamentiRepository.js'
import { PgAuditRepository } from '../db/repositories/PgAuditRepository.js'
import { modelloSchema, erroreModello, normalizzaEmail, rigaSicura } from '../lib/versamenti.js'

const CODICE  = z.string().trim().regex(/^[A-Za-z0-9._-]{1,20}$/)
const MESE    = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const MAX_ENTI = 2000
// Nome file e descrizione finiscono nel DB e nell'audit: ripuliti (V-6).
const NOME_FILE   = rigaSicura(200, 1)
const DESCRIZIONE = rigaSicura(200)

export async function versamentiRoutes(app: FastifyInstance): Promise<void> {
  const repo      = new PgVersamentiRepository(app.db)
  const auditRepo = new PgAuditRepository(app.db)
  const auth      = { preHandler: [app.authenticate] }

  // Audit NON best-effort: se non si registra, l'operazione risponde errore.
  async function audit(request: FastifyRequest, azione: string, entitaId: string | undefined, dettagli: Record<string, unknown>) {
    await auditRepo.log({
      userId: request.user?.id, azione, entita: 'versamenti', entitaId, dettagli, ip: request.ip,
    })
  }

  // ── Enti ──────────────────────────────────────────────────
  app.get('/enti', auth, async (_request, reply) => reply.send({ enti: await repo.enti() }))

  app.post('/enti/sincronizza', auth, async (request, reply) => {
    const b = z.object({
      file: NOME_FILE,
      enti: z.array(z.object({
        codice:      CODICE,
        descrizione: DESCRIZIONE,
      })).max(MAX_ENTI),
    }).parse(request.body)

    // Un codice una volta sola: vale la prima descrizione che si incontra.
    const unici = new Map<string, string>()
    for (const e of b.enti) if (!unici.has(e.codice)) unici.set(e.codice, e.descrizione)
    const esito = await repo.sincronizzaEnti(
      [...unici].map(([codice, descrizione]) => ({ codice, descrizione })), b.file, request.user?.id ?? null,
    )
    if (esito.nuovi.length || esito.descrizioni.length) {
      await audit(request, 'VERSAMENTI_ENTI_SINCRONIZZATI', undefined, {
        file: b.file, nuovi: esito.nuovi, descrizioni: esito.descrizioni,
      })
    }
    return reply.send({ enti: await repo.enti(), nuovi: esito.nuovi })
  })

  // Import di una rubrica (es. dal Java GestioneSaldiEnti): non sovrascrive
  // mai un ente che in PGS ha gia' un'email. Un indirizzo non valido ferma
  // tutto e dice in quale ente si trova.
  app.post('/enti/importa', auth, async (request, reply) => {
    const b = z.object({
      file:  NOME_FILE,
      righe: z.array(z.object({
        codice:      CODICE,
        descrizione: DESCRIZIONE,
        email:       z.string().max(6000),
        abilitato:   z.boolean(),
      })).min(1).max(MAX_ENTI),
    }).parse(request.body)

    const righe = []
    for (const r of b.righe) {
      const n = normalizzaEmail(r.email)
      if (!n.ok) {
        return reply.code(400).send('errata' in n
          ? { error: 'EMAIL_NON_VALIDA', codice: r.codice, valore: n.errata }
          : { error: 'TROPPE_EMAIL', codice: r.codice })
      }
      righe.push({ codice: r.codice, descrizione: r.descrizione, email: n.lista, abilitato: r.abilitato })
    }
    const esito = await repo.importaEnti(righe, request.user?.id ?? null)
    await audit(request, 'VERSAMENTI_ENTI_IMPORTATI', undefined, {
      file: b.file, righe: b.righe.length,
      nuovi: esito.nuovi, aggiornati: esito.aggiornati, saltati: esito.saltati.length, invariati: esito.invariati.length,
    })
    return reply.send({ enti: await repo.enti(), ...esito })
  })

  app.patch('/enti/:codice', auth, async (request, reply) => {
    const { codice } = z.object({ codice: CODICE }).parse(request.params)
    const b = z.object({
      email:     z.union([z.string().max(6000), z.array(z.string().max(254)).max(50)]).optional(),
      abilitato: z.boolean().optional(),
      modelloId: z.string().uuid().nullable().optional(),
    }).refine(x => x.email !== undefined || x.abilitato !== undefined || x.modelloId !== undefined)
      .parse(request.body)

    const prima = await repo.ente(codice)
    if (!prima) return reply.code(404).send({ error: 'ENTE_NON_TROVATO' })

    const patch: { email?: string[]; abilitato?: boolean; modelloId?: string | null } = {}
    if (b.email !== undefined) {
      const n = normalizzaEmail(b.email)
      if (!n.ok) {
        return reply.code(400).send('errata' in n
          ? { error: 'EMAIL_NON_VALIDA', valore: n.errata }
          : { error: 'TROPPE_EMAIL' })
      }
      patch.email = n.lista
    }
    if (b.abilitato !== undefined) patch.abilitato = b.abilitato
    if (b.modelloId !== undefined) {
      if (b.modelloId && !(await repo.modello(b.modelloId))) return reply.code(404).send({ error: 'MODELLO_NON_TROVATO' })
      patch.modelloId = b.modelloId
    }

    const dopo = await repo.aggiornaEnte(codice, patch, request.user?.id ?? null)
    if (!dopo) return reply.code(404).send({ error: 'ENTE_NON_TROVATO' })

    const cambi: Record<string, { prima: unknown; dopo: unknown }> = {}
    if (patch.email !== undefined && prima.email.join(',') !== dopo.email.join(',')) cambi['email'] = { prima: prima.email, dopo: dopo.email }
    if (patch.abilitato !== undefined && prima.abilitato !== dopo.abilitato) cambi['abilitato'] = { prima: prima.abilitato, dopo: dopo.abilitato }
    if (patch.modelloId !== undefined && prima.modelloId !== dopo.modelloId) cambi['modello'] = { prima: prima.modelloId, dopo: dopo.modelloId }
    if (Object.keys(cambi).length) {
      await audit(request, 'VERSAMENTI_ENTE_MODIFICATO', codice, { codice, descrizione: dopo.descrizione, cambi })
    }
    return reply.send({ ente: dopo })
  })

  // ── Modelli ───────────────────────────────────────────────
  app.get('/modelli', auth, async (_request, reply) => reply.send({ modelli: await repo.modelli() }))

  app.post('/modelli', auth, async (request, reply) => {
    const m = modelloSchema.parse(request.body)
    const err = erroreModello(m)
    if (err) return reply.code(400).send({ error: err })
    const r = await repo.creaModello(m, request.user?.id ?? null)
    if (r === 'nome-duplicato') return reply.code(409).send({ error: 'NOME_GIA_USATO' })
    await audit(request, 'VERSAMENTI_MODELLO_CREATO', r.id, { nome: r.nome })
    return reply.send({ modello: r })
  })

  app.put('/modelli/:id', auth, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const m = modelloSchema.parse(request.body)
    const err = erroreModello(m)
    if (err) return reply.code(400).send({ error: err })
    const prima = await repo.modello(id)
    if (!prima) return reply.code(404).send({ error: 'MODELLO_NON_TROVATO' })
    const r = await repo.aggiornaModello(id, m, request.user?.id ?? null)
    if (r === 'nome-duplicato') return reply.code(409).send({ error: 'NOME_GIA_USATO' })
    if (!r) return reply.code(404).send({ error: 'MODELLO_NON_TROVATO' })
    const campi = (['nome', 'oggetto', 'testo'] as const).filter(k => prima[k] !== r[k]) as string[]
    if (JSON.stringify(prima.allegati) !== JSON.stringify(r.allegati)) campi.push('allegati')
    await audit(request, 'VERSAMENTI_MODELLO_MODIFICATO', r.id, { nome: r.nome, nomePrima: prima.nome, campi })
    return reply.send({ modello: r })
  })

  app.post('/modelli/:id/predefinito', auth, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const prima = (await repo.modelli()).find(x => x.predefinito)
    const r = await repo.impostaPredefinito(id, request.user?.id ?? null)
    if (!r) return reply.code(404).send({ error: 'MODELLO_NON_TROVATO' })
    if (prima?.id !== r.id) {
      await audit(request, 'VERSAMENTI_MODELLO_PREDEFINITO', r.id, { nome: r.nome, prima: prima?.nome ?? null })
    }
    return reply.send({ modello: r })
  })

  app.delete('/modelli/:id', auth, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const m = await repo.modello(id)
    const esito = await repo.eliminaModello(id)
    if (esito.esito === 'non-trovato') return reply.code(404).send({ error: 'MODELLO_NON_TROVATO' })
    if (esito.esito === 'predefinito') return reply.code(409).send({ error: 'MODELLO_PREDEFINITO' })
    await audit(request, 'VERSAMENTI_MODELLO_ELIMINATO', id, { nome: m?.nome ?? null, entiRiportati: esito.entiRiportati })
    return reply.send({ entiRiportati: esito.entiRiportati })
  })

  // ── Generazione EML: solo l'evento, nessun dato delle persone ──
  app.post('/eventi/generazione', auth, async (request, reply) => {
    const b = z.object({
      file:  rigaSicura(200),
      enti:  z.array(CODICE).min(1).max(MAX_ENTI),
      eml:   z.number().int().min(1).max(100_000),
      righe: z.number().int().min(0).max(10_000_000),
      mesi:  z.array(MESE).min(1).max(240),
      modo:  z.enum(['unico', 'mese']),
      // EML costruiti con i soli versamenti scelti nella Consultazione
      selezione: z.boolean().optional(),
    }).parse(request.body)
    await audit(request, 'VERSAMENTI_EML_GENERATI', b.enti.length === 1 ? b.enti[0] : undefined, b)
    return reply.send({ ok: true })
  })

  // Esportazione CSV/PDF dalla Consultazione: anche qui solo l'evento.
  // I file si costruiscono nel browser; il server registra chi ha esportato
  // quanto (enti, righe, persone) e se con il codice fiscale.
  app.post('/eventi/esportazione', auth, async (request, reply) => {
    const b = z.object({
      file:          rigaSicura(200),
      formato:       z.enum(['csv', 'pdf']),
      modo:          z.enum(['unico', 'ente']),
      enti:          z.array(CODICE).min(1).max(MAX_ENTI),
      righe:         z.number().int().min(1).max(10_000_000),
      persone:       z.number().int().min(1).max(10_000_000),
      file_generati: z.number().int().min(1).max(MAX_ENTI),
      codiceFiscale: z.boolean(),
    }).parse(request.body)
    await audit(request, 'VERSAMENTI_ESPORTAZIONE', b.enti.length === 1 ? b.enti[0] : undefined, b)
    return reply.send({ ok: true })
  })
}
