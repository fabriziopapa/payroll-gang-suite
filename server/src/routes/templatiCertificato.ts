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

// SEC/ROBUSTEZZA: schema STRETTO per strutturaJson — mirror cedolinoParsedSchema
// (routes/certificati.ts). Sostituisce il vecchio z.record(z.unknown()) che
// lasciava passare qualunque oggetto: un template-come-dato incompleto (es.
// inquadramentoMap assente) passava la validazione e faceva esplodere
// prepareData() con TypeError a runtime, in fase di generazione DOCX — tardi,
// con un 500 generico. Qui, invece, l'intera shape di CertificatoTemplate
// (services/certificato/types.ts) è verificata in scrittura: niente più
// template malformati persistibili via API.
const rigaEmolumentoSchema = z.object({
  voce:  z.string().min(1).max(200),
  segno: z.string().min(1).max(10),
  /** path nel contesto resolve, es. "teo.stipendio" | "cert.netto_a_pagare" */
  src:   z.string().min(1).max(100),
  bold:  z.boolean().optional(),
})

const matchTeoricaSchema = z.object({
  field:    z.string().min(1).max(60),
  keywords: z.array(z.string().min(1).max(100)).min(1).max(20),
})

/** inquadramentoMap / extraRename — entrambe Record<string,string> a lunghezza limitata */
const stringMapSchema = z.record(z.string().min(1).max(200), z.string().max(200))

const certificatoTemplateSchema = z.object({
  bollo:        z.object({ testo: z.string().max(2000) }),
  intestazione: z.object({
    protocollo: z.string().max(500),
    posizione:  z.string().max(500),
  }),
  titolo:             z.string().min(1).max(300),
  corpo:              z.array(z.string().max(5000)).max(50),
  tabellaEmolumenti:  z.array(rigaEmolumentoSchema).max(50),
  testoExtraerariali: z.string().max(2000),
  testoNetto:         z.string().max(2000),
  chiusura:           z.string().max(2000),
  luogoData:          z.string().max(500),
  firma:              z.array(z.string().max(500)).max(20),
  matchTeoriche:      z.array(matchTeoricaSchema).max(50),
  inquadramentoMap:   stringMapSchema,
  extraRename:        stringMapSchema,
})

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
    strutturaJson: certificatoTemplateSchema,
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
