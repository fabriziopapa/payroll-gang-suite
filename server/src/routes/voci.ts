// ============================================================
// PAYROLL GANG SUITE — Routes Voci (/api/v1/voci)
// ============================================================

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from '../middleware/authenticate.js'
import { PgVociRepository } from '../db/repositories/PgVociRepository.js'
import { importVoci } from '../services/importService.js'

export async function vociRoutes(app: FastifyInstance): Promise<void> {

  const repo = new PgVociRepository(app.db)

  // GET /api/v1/voci
  app.get('/', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const data = await repo.findAll()
    return reply.send(data)
  })

  // GET /api/v1/voci/active?date=YYYY-MM-DD
  app.get('/active', { preHandler: [app.authenticate] }, async (request, reply) => {
    const q = z.object({ date: z.string().date().optional() }).parse(request.query)
    const data = await repo.findActive(q.date ? new Date(q.date) : undefined)
    return reply.send(data)
  })

  // GET /api/v1/voci/last-import
  app.get('/last-import', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const date = await repo.getLastImportDate()
    return reply.send({ lastImport: date?.toISOString() ?? null })
  })

  // POST /api/v1/voci/import (solo admin)
  // FIX M-3: bodyLimit 5 MB — prevenzione upload di file enormi
  app.post('/import', {
    preHandler: [app.authenticate, requireAdmin],
    bodyLimit: 5 * 1024 * 1024,
  }, async (request, reply) => {
    const schema = z.object({ xml: z.string().min(1) })
    const { xml } = schema.parse(request.body)

    // FIX M-3: check esplicito sulla dimensione del payload XML in bytes
    if (Buffer.byteLength(xml, 'utf8') > 5_000_000) {
      return reply.status(413).send({ error: 'File troppo grande (max 5 MB)' })
    }

    let result
    try {
      result = await importVoci(xml, repo)
    } catch (err: any) {
      if (err.message?.startsWith('FILE_TOO_MANY_ROWS')) {
        return reply.status(413).send({ error: err.message })
      }
      throw err
    }
    return reply.code(200).send(result)
  })
}
