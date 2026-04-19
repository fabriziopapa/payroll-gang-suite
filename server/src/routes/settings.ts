// ============================================================
// PAYROLL GANG SUITE — Routes Settings (/api/v1/settings)
// ============================================================

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from '../middleware/authenticate.js'
import { PgSettingsRepository } from '../db/repositories/PgSettingsRepository.js'

export async function settingsRoutes(app: FastifyInstance): Promise<void> {

  const repo = new PgSettingsRepository(app.db)

  app.get('/', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.send(await repo.getAll())
  })

  /** Aggiornamento batch: { chiave1: valore1, chiave2: valore2, … } */
  app.put('/', { preHandler: [app.authenticate, requireAdmin] }, async (req, reply) => {
    const body = z.record(z.unknown()).parse(req.body)
    for (const [chiave, valore] of Object.entries(body)) {
      await repo.set(chiave, valore)
    }
    return reply.send(await repo.getAll())
  })

  /** Aggiornamento singola chiave: PUT /:chiave { valore: … } */
  app.put('/:chiave', { preHandler: [app.authenticate, requireAdmin] }, async (req, reply) => {
    const { chiave } = z.object({ chiave: z.string().min(1) }).parse(req.params)
    const { valore } = z.object({ valore: z.unknown() }).parse(req.body)
    await repo.set(chiave, valore)
    return reply.send({ success: true })
  })
}
