// ============================================================
// PAYROLL GANG SUITE — Routes Bozze (/api/v1/bozze)
// ============================================================

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PgBozzeRepository } from '../db/repositories/PgBozzeRepository.js'
// BozzaSummaryRow is used by the list endpoint — no dati JSONB (FIX H-1)

export async function bozzeRoutes(app: FastifyInstance): Promise<void> {

  const repo = new PgBozzeRepository(app.db)

  // ── Helper: verifica proprietà bozza ───────────────────────

  async function requireOwner(id: string, userId: string, isAdmin: boolean, reply: any) {
    const bozza = await repo.findById(id)
    if (!bozza) { reply.code(404).send({ error: 'NOT_FOUND' }); return null }
    if (!isAdmin && bozza.createdBy !== userId) {
      reply.code(403).send({ error: 'FORBIDDEN' }); return null
    }
    return bozza
  }

  // GET / — admin vede tutte; utente normale solo le proprie
  // FIX H-1: usa findAllSummary() — omette dati JSONB (20KB/riga) dalla lista
  app.get('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.user!.isAdmin ? undefined : req.user!.id
    return reply.send(await repo.findAllSummary(userId))
  })

  // GET /:id — admin può accedere a qualsiasi bozza; utente solo la propria
  app.get('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const bozza  = await requireOwner(id, req.user!.id, req.user!.isAdmin, reply)
    if (!bozza) return
    return reply.send(bozza)
  })

  app.post('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const schema = z.object({
      nome:              z.string().min(1).max(200),
      protocolloDisplay: z.string().optional(),
      dati:              z.unknown(),
    })
    const body  = schema.parse(req.body)
    const bozza = await repo.create({ nome: body.nome, protocolloDisplay: body.protocolloDisplay, dati: body.dati ?? {}, createdBy: req.user!.id })
    return reply.code(201).send(bozza)
  })

  // PUT /:id — admin può modificare qualsiasi bozza
  app.put('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const schema = z.object({
      nome:              z.string().min(1).max(200).optional(),
      protocolloDisplay: z.string().optional(),
      dati:              z.unknown().optional(),
    })
    const existing = await requireOwner(id, req.user!.id, req.user!.isAdmin, reply)
    if (!existing) return
    const bozza = await repo.update(id, schema.parse(req.body))
    return reply.send(bozza)
  })

  // archive/restore — admin può gestire qualsiasi bozza
  app.post('/:id/archive', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const existing = await requireOwner(id, req.user!.id, req.user!.isAdmin, reply)
    if (!existing) return
    return reply.send(await repo.archive(id))
  })

  app.post('/:id/restore', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const existing = await requireOwner(id, req.user!.id, req.user!.isAdmin, reply)
    if (!existing) return
    return reply.send(await repo.restore(id))
  })

  // DELETE — solo il proprietario può eliminare; l'admin NON può eliminare bozze altrui
  // SEC-C03: richiede header X-Confirm-Delete: true per operazioni distruttive
  app.delete('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (req.headers['x-confirm-delete'] !== 'true') {
      return reply.code(400).send({ error: 'MISSING_CONFIRM_HEADER' })
    }
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const bozza  = await repo.findById(id)
    if (!bozza) return reply.code(404).send({ error: 'NOT_FOUND' })
    if (bozza.createdBy !== req.user!.id) {
      return reply.code(403).send({ error: 'CANNOT_DELETE_OTHERS_BOZZA' })
    }
    await repo.delete(id)
    return reply.code(204).send()
  })
}
