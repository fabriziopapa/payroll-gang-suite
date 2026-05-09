// ============================================================
// PAYROLL GANG SUITE — Routes Capitoli (/api/v1/capitoli)
// Capitoli anagrafica standalone (Capitoli_STAMPA + Capitoli_Locali)
// ============================================================

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from '../middleware/authenticate.js'
import { PgCapitoliAnagRepository } from '../db/repositories/PgCapitoliAnagRepository.js'
import { importCapitoli } from '../services/importService.js'
import type { CapitoloSorgente } from '../db/IRepository.js'

const sorgenteSchema = z.enum(['standard', 'locali'])

export async function capitoliRoutes(app: FastifyInstance): Promise<void> {

  const repo = new PgCapitoliAnagRepository(app.db)

  // GET /api/v1/capitoli?sorgente=standard|locali
  app.get('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const q = z.object({ sorgente: sorgenteSchema.optional() }).parse(request.query)
    const data = await repo.findAll(q.sorgente as CapitoloSorgente | undefined)
    return reply.send(data)
  })

  // GET /api/v1/capitoli/last-import
  // Risponde: { standard: string|null, locali: string|null }
  app.get('/last-import', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const dates = await repo.getLastImportDates()
    return reply.send({
      standard: dates.standard?.toISOString() ?? null,
      locali:   dates.locali?.toISOString()   ?? null,
    })
  })

  // POST /api/v1/capitoli/import (solo admin)
  // Body: { xml: string, sorgente: 'standard' | 'locali' }
  // FIX M-3: bodyLimit 5 MB — prevenzione upload di file enormi
  app.post('/import', {
    preHandler: [app.authenticate, requireAdmin],
    bodyLimit: 5 * 1024 * 1024,
  }, async (request, reply) => {
    const schema = z.object({
      xml:      z.string().min(1),
      sorgente: sorgenteSchema,
    })
    const { xml, sorgente } = schema.parse(request.body)

    // FIX M-3: check esplicito sulla dimensione del payload XML in bytes
    if (Buffer.byteLength(xml, 'utf8') > 5_000_000) {
      return reply.status(413).send({ error: 'File troppo grande (max 5 MB)' })
    }

    let result
    try {
      result = await importCapitoli(xml, sorgente as CapitoloSorgente, repo)
    } catch (err: any) {
      if (err.message?.startsWith('FILE_TOO_MANY_ROWS')) {
        return reply.status(413).send({ error: err.message })
      }
      throw err
    }
    return reply.code(200).send(result)
  })
}
