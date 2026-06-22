// ============================================================
// PAYROLL GANG SUITE — Routes Voci Config (/api/v1/voci-config)
// Parametri manuali per voce (parti, scorporo, tag riferimento cedolino).
// Tabella separata da `voci` → non toccata dagli import XML.
// ============================================================

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PgVociConfigRepository } from '../db/repositories/PgVociConfigRepository.js'

const upsertSchema = z.object({
  parti:        z.number().int().min(0).nullable().optional(),
  tipoScorporo: z.enum(['none', 'standard', 'contoterzi']).nullable().optional(),
  tagDefault:   z.enum(['TL', 'WD', 'WE']).nullable().optional(),
  autoFiglio:   z.boolean().optional(),
})

export async function vociConfigRoutes(app: FastifyInstance): Promise<void> {

  const repo = new PgVociConfigRepository(app.db)

  // GET /api/v1/voci-config — tutte le config (mappa per codice lato client)
  app.get('/', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.send(await repo.findAll())
  })

  // PUT /api/v1/voci-config/:codice — upsert config voce
  app.put('/:codice', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { codice } = z.object({ codice: z.string().min(1).max(10) }).parse(req.params)
    const body = upsertSchema.parse(req.body)
    const row = await repo.upsert({ codice, ...body })
    return reply.send(row)
  })

  // DELETE /api/v1/voci-config/:codice — rimuove la config (torna ai default)
  app.delete('/:codice', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { codice } = z.object({ codice: z.string().min(1).max(10) }).parse(req.params)
    await repo.delete(codice)
    return reply.send({ success: true })
  })
}
