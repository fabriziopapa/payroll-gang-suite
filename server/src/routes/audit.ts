// ============================================================
// PAYROLL GANG SUITE — Routes Audit (/api/v1/audit)
// Sola lettura del registro audit — SOLO admin.
// La tabella audit_log è append-only (INSERT via auditRepo.log).
// ============================================================

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from '../middleware/authenticate.js'
import { PgAuditRepository } from '../db/repositories/PgAuditRepository.js'

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  const repo = new PgAuditRepository(app.db)

  // Tutti gli endpoint richiedono autenticazione + ruolo admin
  const preHandler = [app.authenticate, requireAdmin]

  // GET /api/v1/audit — elenco paginato e filtrato
  app.get('/', { preHandler }, async (req, reply) => {
    const q = z.object({
      page:     z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(50),
      azione:   z.string().max(100).optional(),
      userId:   z.string().uuid().optional(),
      search:   z.string().max(200).optional(),
      from:     z.string().max(40).optional(),
      to:       z.string().max(40).optional(),
    }).parse(req.query)

    const { rows, total } = await repo.query({
      limit:  q.pageSize,
      offset: (q.page - 1) * q.pageSize,
      azione: q.azione,
      userId: q.userId,
      search: q.search,
      from:   q.from,
      to:     q.to,
    })

    return reply.send({ rows, total, page: q.page, pageSize: q.pageSize })
  })

  // GET /api/v1/audit/azioni — elenco distinto azioni (per il filtro)
  app.get('/azioni', { preHandler }, async (_req, reply) => {
    return reply.send(await repo.distinctAzioni())
  })
}
