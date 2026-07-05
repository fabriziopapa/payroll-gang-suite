// ============================================================
// PAYROLL GANG SUITE — Routes PDF Region Templates (/api/v1/pdf-region-templates)
//
// CRUD template-come-dato VERSIONATO E IMMUTABILE (mirror templatiCertificato +
// pattern versioning Gate2/PgPdfRegionTemplatesRepository) + endpoint /:id/extract
// — preview estrazione, NESSUNA persistenza (mirror /certificati/parse, stesso
// pattern sicurezza: PDF mai su disco, magic-bytes %PDF-, cap dimensione pre-decode).
//
// Lettura/estrazione: ogni utente autenticato. Scrittura/versioning/eliminazione: solo admin.
// Riuso template SEMPRE manuale (mai automatch — vincolo Gate 0/1).
// ============================================================

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from '../middleware/authenticate.js'
import { PgPdfRegionTemplatesRepository } from '../db/repositories/PgPdfRegionTemplatesRepository.js'
import { PgTemplatiCertificatoRepository } from '../db/repositories/PgTemplatiCertificatoRepository.js'
import { PgAuditRepository } from '../db/repositories/PgAuditRepository.js'
import { extractRegions } from '../services/pdfRegion/extractor.js'
import { adaptToParsed } from '../services/pdfRegion/adapter.js'
import type { PdfRegionTemplateRow } from '../db/IRepository.js'
import type { PageGeometry, ParteTemplate } from '../services/pdfRegion/types.js'

const MAX_PDF_BYTES = 8 * 1024 * 1024

const SEZIONI = [
  'retribuzioni', 'accessorie', 'abbattimenti', 'contributi',
  'fiscali_correnti', 'fiscali_conguaglio', 'sindacali', 'altre_ritenute',
] as const

// ── Zod — porting verbatim dei contratti locked Gate 2 §C ───────────────
// (validazione boundary stretta — mirror cedolinoParsedSchema, niente z.unknown())

const regionRectSchema = z.object({
  pageIndex: z.number().int().min(0).max(199),     // mirror MAX_PAGES=40 cedolino, margine
  x:         z.number().min(0).max(1),
  y:         z.number().min(0).max(1),
  width:     z.number().min(0.001).max(1),
  height:    z.number().min(0.001).max(1),
})

const pageGeometrySchema = z.object({
  pageIndex: z.number().int().min(0).max(199),
  widthPt:   z.number().positive().max(5000),       // A0 ≈ 3370pt — margine ampio
  heightPt:  z.number().positive().max(5000),
  rotation:  z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
})

const parteAnagraficaSchema = z.object({
  kind:    z.literal('anagrafica'),
  id:      z.string().uuid(),
  label:   z.string().min(1).max(100),
  ruolo:   z.enum([
    'matricola', 'cognome_nome', 'periodo_retribuzione',
    'codice_fiscale', 'data_nascita', 'luogo_nascita',
    'inquadramento', 'area_profilo', 'ruolo',
    'inizio_rapporto', 'anzianita_servizio', 'afferenza', 'sede',
  ]),
  regione: regionRectSchema,
})

const parteVoceSchema = z.object({
  kind:               z.literal('voce'),
  id:                 z.string().uuid(),
  label:              z.string().min(1).max(100),
  regioneDescrizione: regionRectSchema,
  regioneImporto:     regionRectSchema,
  sezione:            z.enum(SEZIONI),
  sign:               z.enum(['+', '-']),
  isArretrato:        z.boolean(),
  decorrenza:         z.string().max(20).nullable().optional(),
  scadenza:           z.string().max(20).nullable().optional(),
})

// discriminatedUnion → Zod sceglie lo schema giusto in base a `kind`, errori precisi per ramo
const parteTemplateSchema = z.discriminatedUnion('kind', [parteAnagraficaSchema, parteVoceSchema])

const templateBodySchema = z.object({
  nome:                  z.string().min(1).max(200),
  nota:                  z.string().max(2000).nullable().optional(),  // client (PdfRegionTemplateBody) invia sempre string|null, mai omesso
  pageGeometry:          z.array(pageGeometrySchema).min(1).max(40),   // mirror MAX_PAGES cedolino
  parti:                 z.array(parteTemplateSchema).min(1).max(60),  // tetto operativo ragionevole
  certificatoTemplateId: z.string().uuid(),
})

// Audit Gate4 M2: cap esplicito a livello schema, non solo route-level `bodyLimit`
// — il base64 del PDF è la STRINGA che arriva qui; senza .max() lo schema da solo
// accetterebbe payload arbitrariamente grandi (memoria/CPU di parsing/validazione)
// se mai riusato fuori da una route con `bodyLimit` configurato. Stesso valore
// di `bodyLimit: 12 * 1024 * 1024` impostato sulla route — limite esplicito e
// auto-documentato anche a livello di contratto/validazione.
const extractBodySchema = z.object({ pdf: z.string().min(1).max(12 * 1024 * 1024) })

// ── mapper Row(snake/Json interno) → forma contratto API (camelCase, mirror BozzaApi) ──
function toApi(row: PdfRegionTemplateRow) {
  return {
    id:                    row.id,
    templateFamilyId:      row.templateFamilyId,
    nome:                  row.nome,
    nota:                  row.nota,
    versione:              row.versione,
    versioneLabel:         row.versioneLabel,
    attivo:                row.attivo,
    pageGeometry:          row.pageGeometryJson as PageGeometry[],
    parti:                 row.partiJson as ParteTemplate[],
    certificatoTemplateId: row.certificatoTemplateId,
    createdBy:             row.createdBy,
    createdByUsername:     row.createdByUsername,
    createdAt:             row.createdAt.toISOString(),
    updatedAt:             row.updatedAt.toISOString(),
  }
}

export async function pdfRegionTemplatesRoutes(app: FastifyInstance): Promise<void> {
  const repo     = new PgPdfRegionTemplatesRepository(app.db)
  const certTpls = new PgTemplatiCertificatoRepository(app.db)
  const audit    = new PgAuditRepository(app.db)

  // ── GET / — lista (?all=true → storico completo tutte le versioni; default solo attivi) ──
  app.get('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { all } = z.object({ all: z.coerce.boolean().optional() }).parse(req.query)
    const rows = await repo.findAll(!all)
    return reply.send(rows.map(toApi))
  })

  // ── GET /:id ─────────────────────────────────────────────────────────
  app.get('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const row = await repo.findById(id)
    if (!row) return reply.code(404).send({ error: 'TEMPLATE_NON_TROVATO' })
    return reply.send(toApi(row))
  })

  // ── POST / — crea v1 (admin) ─────────────────────────────────────────
  app.post('/', { preHandler: [app.authenticate, requireAdmin] }, async (req, reply) => {
    const body = templateBodySchema.parse(req.body)

    // FK certificatoTemplateId fissata a CREAZIONE (Gate1 Q6) — verifica esistenza
    const certTpl = await certTpls.findById(body.certificatoTemplateId)
    if (!certTpl) return reply.code(404).send({ error: 'CERTIFICATO_TEMPLATE_NON_TROVATO' })

    const row = await repo.create({
      nome:                  body.nome,
      nota:                  body.nota ?? null,
      pageGeometryJson:      body.pageGeometry,
      partiJson:             body.parti,
      certificatoTemplateId: body.certificatoTemplateId,
      createdBy:             req.user?.id ?? null,
    })

    await audit.log({
      userId: req.user?.id, azione: 'PDF_REGION_TEMPLATE_CREATO',
      entita: 'templato_pdf_region', entitaId: row.id,
      dettagli: { nome: row.nome, templateFamilyId: row.templateFamilyId, versione: row.versione },
      ip: req.ip, userAgent: req.headers['user-agent'],
    })
    return reply.code(201).send(toApi(row))
  })

  // ── PUT /:id — nuova versione (admin, sostituzione completa: mai patch parziale) ──
  app.put('/:id', { preHandler: [app.authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const body = templateBodySchema.parse(req.body)

    const prec = await repo.findById(id)
    if (!prec) return reply.code(404).send({ error: 'TEMPLATE_NON_TROVATO' })
    // certificatoTemplateId fissato alla CREAZIONE, mai modificabile (Gate1 Q6 / Gate2 §A:
    // "un layout-sorgente produce sempre la stessa forma di certificato") — ignora un eventuale
    // valore diverso nel body, eredita sempre dalla versione precedente. Riconvalida la FK:
    // potrebbe essere stata eliminata medio tempore (situazione anomala, blocca la versione).
    const certTpl = await certTpls.findById(prec.certificatoTemplateId)
    if (!certTpl) return reply.code(409).send({ error: 'CERTIFICATO_TEMPLATE_NON_TROVATO' })

    const row = await repo.createNewVersion(id, {
      nome:                  body.nome,
      nota:                  body.nota ?? null,
      pageGeometryJson:      body.pageGeometry,
      partiJson:             body.parti,
      certificatoTemplateId: prec.certificatoTemplateId,
      createdBy:             req.user?.id ?? null,
    })

    await audit.log({
      userId: req.user?.id, azione: 'PDF_REGION_TEMPLATE_VERSIONATO',
      entita: 'templato_pdf_region', entitaId: row.id,
      dettagli: {
        nome: row.nome, templateFamilyId: row.templateFamilyId,
        versione: row.versione, precedenteId: id,
      },
      ip: req.ip, userAgent: req.headers['user-agent'],
    })
    return reply.code(201).send(toApi(row))
  })

  // ── DELETE /:id — elimina riga/versione (admin, X-Confirm-Delete: distruttiva) ──
  app.delete('/:id', { preHandler: [app.authenticate, requireAdmin] }, async (req, reply) => {
    if (req.headers['x-confirm-delete'] !== 'true') {
      return reply.code(400).send({ error: 'MISSING_CONFIRM_HEADER' })
    }
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const row = await repo.findById(id)
    if (!row) return reply.code(404).send({ error: 'TEMPLATE_NON_TROVATO' })

    await repo.delete(id)
    await audit.log({
      userId: req.user?.id, azione: 'PDF_REGION_TEMPLATE_ELIMINATO',
      entita: 'templato_pdf_region', entitaId: id,
      dettagli: { nome: row.nome, templateFamilyId: row.templateFamilyId, versione: row.versione },
      ip: req.ip, userAgent: req.headers['user-agent'],
    })
    return reply.code(204).send()
  })

  // ── POST /:id/extract — preview estrazione, NESSUNA persistenza ─────
  // Body: { pdf: base64 }. Stesso pattern sicurezza di /certificati/parse:
  // PDF mai su disco, magic-bytes %PDF- (non Content-Type, falsificabile),
  // cap dimensione pre-decode. Audit traccia chi ha applicato quale template.
  app.post('/:id/extract', {
    preHandler: [app.authenticate],
    bodyLimit: 12 * 1024 * 1024, // base64 gonfia ~33% — mirror /certificati/parse
  }, async (req, reply) => {
    const { id }  = z.object({ id: z.string().uuid() }).parse(req.params)
    const { pdf } = extractBodySchema.parse(req.body)

    const row = await repo.findById(id)
    if (!row) return reply.code(404).send({ error: 'TEMPLATE_NON_TROVATO' })

    const buf = Buffer.from(pdf, 'base64')
    if (buf.byteLength === 0) return reply.code(400).send({ error: 'PDF_VUOTO' })
    if (buf.byteLength > MAX_PDF_BYTES) return reply.code(413).send({ error: 'PDF_TROPPO_GRANDE' })
    // Magic bytes: header PDF non falsificabile come il Content-Type
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return reply.code(400).send({ error: 'NON_E_UN_PDF' })
    }

    const pageGeometry = row.pageGeometryJson as PageGeometry[]
    const parti        = row.partiJson         as ParteTemplate[]

    let result
    try {
      const extraction = await extractRegions(buf, pageGeometry, parti)
      result = adaptToParsed(extraction, parti)
    } catch (err) {
      app.log.error({ err }, 'Estrazione regioni PDF fallita')
      return reply.code(422).send({ error: 'ESTRAZIONE_FALLITA' })
    }

    await audit.log({
      userId: req.user?.id, azione: 'PDF_REGION_TEMPLATE_ESTRATTO',
      entita: 'templato_pdf_region', entitaId: row.id,
      dettagli: {
        nome: row.nome, templateFamilyId: row.templateFamilyId, versione: row.versione,
        matricola: result.parsed.anagrafica.matricola,
        warnings: result.warnings.length, errors: result.errors.length,
      },
      ip: req.ip, userAgent: req.headers['user-agent'],
    })

    return reply.send(result)
  })
}
