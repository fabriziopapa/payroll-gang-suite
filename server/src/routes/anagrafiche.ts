// ============================================================
// PAYROLL GANG SUITE — Routes Anagrafiche (/api/v1/anagrafiche)
// ============================================================

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from '../middleware/authenticate.js'
import { PgAnagraficheRepository } from '../db/repositories/PgAnagraficheRepository.js'
import { importAnagrafiche } from '../services/importService.js'

export async function anagraficheRoutes(app: FastifyInstance): Promise<void> {

  const repo = new PgAnagraficheRepository(app.db)

  // GET /api/v1/anagrafiche — lista completa attivi (autenticato)
  app.get('/', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const data = await repo.findAll()
    return reply.send(data)
  })

  // GET /api/v1/anagrafiche/last-import
  app.get('/last-import', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const date = await repo.getLastImportDate()
    return reply.send({ lastImport: date?.toISOString() ?? null })
  })

  /**
   * GET /api/v1/anagrafiche/ruolo-at?matricola=X[&data=YYYY-MM-DD]
   *
   * Ritorna il ruolo di una persona a una data specifica (o attuale).
   *
   * Risposta:
   *   - [] (0 elementi)  → nessun record in DB, usa fallback locale
   *   - [item]           → univoco, fill automatico
   *   - [item, ...]      → ambiguo (es. cambio ruolo a metà mese), mostra scelta
   */
  app.get('/ruolo-at', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { matricola, data } = z.object({
      matricola: z.string().min(1),
      data:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(req.query)

    const results = await repo.findRuoloAt(matricola, data)
    return reply.send(results)
  })

  // POST /api/v1/anagrafiche/import — upload XML (solo admin)
  app.post('/import', {
    preHandler: [app.authenticate, requireAdmin],
  }, async (request, reply) => {
    const schema = z.object({
      xml:               z.string().min(1),
      dataAggiornamento: z.string().datetime().optional(),
    })
    const { xml, dataAggiornamento } = schema.parse(request.body)

    const result = await importAnagrafiche(
      xml,
      repo,
      dataAggiornamento ? new Date(dataAggiornamento) : new Date(),
    )

    return reply.code(200).send(result)
  })
}
