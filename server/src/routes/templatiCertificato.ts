// ============================================================
// PAYROLL GANG SUITE — Routes Templati Certificato
// (/api/v1/templati-certificato) — CRUD template-come-dato.
// Lettura: ogni utente autenticato. Scrittura: solo admin.
// ============================================================

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from '../middleware/authenticate.js'
import { PgTemplatiCertificatoRepository } from '../db/repositories/PgTemplatiCertificatoRepository.js'
import { PgAuditRepository } from '../db/repositories/PgAuditRepository.js'

export async function templatiCertificatoRoutes(app: FastifyInstance): Promise<void> {
  const repo  = new PgTemplatiCertificatoRepository(app.db)
  const audit = new PgAuditRepository(app.db)

  // GET / — lista (?soloAttivi=true per i soli attivi)
  app.get('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { soloAttivi } = z.object({
      soloAttivi: z.coerce.boolean().optional(),
    }).parse(req.query)
    return reply.send(await repo.findAll(soloAttivi))
  })

  // GET /:id
  app.get('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const row = await repo.findById(id)
    if (!row) return reply.code(404).send({ error: 'TEMPLATE_NON_TROVATO' })
    return reply.send(row)
  })

  const bodySchema = z.object({
    nome:          z.string().min(1).max(200),
    strutturaJson: z.record(z.string(), z.unknown()),
    attivo:        z.boolean().optional(),
  })

  // POST / — crea (admin)
  app.post('/', { preHandler: [app.authenticate, requireAdmin] }, async (req, reply) => {
    const data = bodySchema.parse(req.body)
    const row = await repo.create(data)
    await audit.log({
      userId: req.user?.id, azione: 'TEMPLATE_CREATO',
      entita: 'templato_certificato', entitaId: row.id,
      dettagli: { nome: row.nome }, ip: req.ip, userAgent: req.headers['user-agent'],
    })
    return reply.code(201).send(row)
  })

  // PUT /:id — aggiorna (admin)
  app.put('/:id', { preHandler: [app.authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const data = bodySchema.partial().parse(req.body)
    const row = await repo.update(id, data)
    await audit.log({
      userId: req.user?.id, azione: 'TEMPLATE_MODIFICATO',
      entita: 'templato_certificato', entitaId: row.id,
      dettagli: { nome: row.nome }, ip: req.ip, userAgent: req.headers['user-agent'],
    })
    return reply.send(row)
  })

  // DELETE /:id — elimina (admin)
  app.delete('/:id', { preHandler: [app.authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    await repo.delete(id)
    await audit.log({
      userId: req.user?.id, azione: 'TEMPLATE_ELIMINATO',
      entita: 'templato_certificato', entitaId: id,
      ip: req.ip, userAgent: req.headers['user-agent'],
    })
    return reply.code(204).send()
  })
}
