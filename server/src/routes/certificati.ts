// ============================================================
// PAYROLL GANG SUITE — Routes Certificati (/api/v1/certificati)
// ============================================================

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PgCertificatiRepository } from '../db/repositories/PgCertificatiRepository.js'
import { PgTemplatiCertificatoRepository } from '../db/repositories/PgTemplatiCertificatoRepository.js'
import { PgAuditRepository } from '../db/repositories/PgAuditRepository.js'
import { parseCedolino } from '../services/cedolino/parser.js'
import { buildCertificatoDocx } from '../services/certificato/docx.js'
import type { CedolinoParsed } from '../services/cedolino/types.js'
import type { CertificatoTemplate, CertificatoMeta } from '../services/certificato/types.js'

const MAX_PDF_BYTES = 8 * 1024 * 1024

/** Shape persistita in certificati.dati_json: parser output + meta per regen. */
interface CertificatoDatiJson {
  parsed: CedolinoParsed
  meta: { data_rilascio: string; sesso?: 'M' | 'F' }
}

/** Sanifica un segmento di filename (accenti/illegali → underscore). */
function safeName(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '')  // strip accenti
    .replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)
}

export async function certificatiRoutes(app: FastifyInstance): Promise<void> {
  const repo      = new PgCertificatiRepository(app.db)
  const templates = new PgTemplatiCertificatoRepository(app.db)
  const audit     = new PgAuditRepository(app.db)

  // ── POST /parse — estrazione cedolino, NESSUNA persistenza ─────────────
  // Body: { pdf: base64 }. Valida magic bytes + dimensione. PDF mai su disco.
  app.post('/parse', {
    preHandler: [app.authenticate],
    bodyLimit: 12 * 1024 * 1024, // base64 gonfia ~33%
  }, async (req, reply) => {
    const { pdf } = z.object({ pdf: z.string().min(1) }).parse(req.body)

    const buf = Buffer.from(pdf, 'base64')
    if (buf.byteLength === 0) return reply.code(400).send({ error: 'PDF_VUOTO' })
    if (buf.byteLength > MAX_PDF_BYTES) return reply.code(413).send({ error: 'PDF_TROPPO_GRANDE' })
    // Magic bytes: header PDF non falsificabile come il Content-Type
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return reply.code(400).send({ error: 'NON_E_UN_PDF' })
    }

    let parsed: CedolinoParsed
    try {
      parsed = await parseCedolino(buf)
    } catch (err) {
      app.log.error({ err }, 'Parsing cedolino fallito')
      return reply.code(422).send({ error: 'PARSING_FALLITO' })
    }
    return reply.send(parsed)
  })

  // ── POST / — crea record (protocollo atomico) + genera DOCX ────────────
  app.post('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = z.object({
      parsed:        z.record(z.string(), z.unknown()),
      templateId:    z.string().uuid(),
      siglaOperatore: z.string().min(1).max(20),
      dirigente:     z.string().max(200).optional(),
      dataRilascio:  z.string().min(1).max(20),
      sesso:         z.enum(['M', 'F']).optional(),
      anno:          z.number().int().min(2000).max(2100).optional(),
    }).parse(req.body)

    const parsed = body.parsed as unknown as CedolinoParsed
    const tplRow = await templates.findById(body.templateId)
    if (!tplRow) return reply.code(404).send({ error: 'TEMPLATE_NON_TROVATO' })
    const tpl = tplRow.strutturaJson as CertificatoTemplate

    const anno = body.anno ?? new Date().getFullYear()
    const ana  = parsed.anagrafica ?? {}
    const nominativo = [ana.cognome, ana.nome].filter(Boolean).join(' ') || null

    const datiJson: CertificatoDatiJson = {
      parsed,
      meta: { data_rilascio: body.dataRilascio, ...(body.sesso ? { sesso: body.sesso } : {}) },
    }

    const record = await repo.create({
      anno,
      matricola:      ana.matricola ?? null,
      cf:             ana.codice_fiscale ?? null,
      periodo:        ana.periodo_retribuzione ?? null,
      nominativo,
      siglaOperatore: body.siglaOperatore,
      dirigente:      body.dirigente ?? null,
      templateId:     body.templateId,
      datiJson,
      createdBy:      req.user?.id ?? null,
    })

    const meta: CertificatoMeta = {
      protocollo:      record.protocollo,
      sigla_operatore: body.siglaOperatore,
      data_rilascio:   body.dataRilascio,
      dirigente:       body.dirigente ?? '',
      ...(body.sesso ? { sesso: body.sesso } : {}),
    }
    const docx = await buildCertificatoDocx(parsed, tpl, meta)
    const filename = `Certificato_${safeName(record.protocollo)}_${safeName(nominativo ?? '')}.docx`

    await audit.log({
      userId: req.user?.id, azione: 'CERTIFICATO_CREATO',
      entita: 'certificato', entitaId: record.id,
      dettagli: { protocollo: record.protocollo, matricola: record.matricola },
      ip: req.ip, userAgent: req.headers['user-agent'],
    })

    return reply.code(201).send({
      ...record,
      docx: { filename, base64: docx.toString('base64') },
    })
  })

  // ── GET / — lista per anno + ricerca matricola/nominativo/protocollo ───
  app.get('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { anno, search } = z.object({
      anno:   z.coerce.number().int().min(2000).max(2100).optional(),
      search: z.string().max(100).optional(),
    }).parse(req.query)
    const rows = await repo.findAll(anno, search)
    return reply.send(rows)
  })

  // ── GET /:id/docx — rigenera DOCX da datiJson ──────────────────────────
  app.get('/:id/docx', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const record = await repo.findById(id)
    if (!record) return reply.code(404).send({ error: 'CERTIFICATO_NON_TROVATO' })
    if (!record.templateId) return reply.code(409).send({ error: 'TEMPLATE_MANCANTE' })

    const tplRow = await templates.findById(record.templateId)
    if (!tplRow) return reply.code(409).send({ error: 'TEMPLATE_ELIMINATO' })
    const tpl = tplRow.strutturaJson as CertificatoTemplate

    const dati = record.datiJson as CertificatoDatiJson
    const meta: CertificatoMeta = {
      protocollo:      record.protocollo,
      sigla_operatore: record.siglaOperatore,
      data_rilascio:   dati.meta?.data_rilascio ?? '',
      dirigente:       record.dirigente ?? '',
      ...(dati.meta?.sesso ? { sesso: dati.meta.sesso } : {}),
    }
    const docx = await buildCertificatoDocx(dati.parsed, tpl, meta)
    const filename = `Certificato_${safeName(record.protocollo)}_${safeName(record.nominativo ?? '')}.docx`

    await audit.log({
      userId: req.user?.id, azione: 'CERTIFICATO_SCARICATO',
      entita: 'certificato', entitaId: record.id,
      dettagli: { protocollo: record.protocollo },
      ip: req.ip, userAgent: req.headers['user-agent'],
    })

    return reply.send({ filename, base64: docx.toString('base64') })
  })
}
