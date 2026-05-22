// ============================================================
// PAYROLL GANG SUITE — Routes Anagrafiche (/api/v1/anagrafiche)
// ============================================================

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { requireAdmin } from '../middleware/authenticate.js'
import { PgAnagraficheRepository } from '../db/repositories/PgAnagraficheRepository.js'
import { importAnagrafiche, importAnagraficheXlsx } from '../services/importService.js'

export async function anagraficheRoutes(app: FastifyInstance): Promise<void> {

  const repo = new PgAnagraficheRepository(app.db)

  // GET /api/v1/anagrafiche[?data=YYYY-MM-DD] — lista attivi (autenticato)
  // Con ?data= restituisce solo i record attivi alla data indicata (1 per matricola)
  app.get('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { data } = z.object({
      data: z.string().date().optional(),
    }).parse(req.query)

    const rows = data
      ? await repo.findAllAtDate(data)
      : await repo.findAll()

    return reply.send(rows)
  })

  // GET /api/v1/anagrafiche/last-import
  app.get('/last-import', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const date = await repo.getLastImportDate()
    return reply.send({ lastImport: date?.toISOString() ?? null })
  })

  /**
   * GET /api/v1/anagrafiche/ruolo-at?matricola=X[&data=YYYY-MM-DD]
   *
   * Ritorna il ruolo di una persona a una data specifica (o attuale).
   *
   * Risposta:
   *   - [] (0 elementi)  → nessun record in DB, usa fallback locale
   *   - [item]           → univoco, fill automatico
   *   - [item, ...]      → ambiguo (es. cambio ruolo a metà mese), mostra scelta
   */
  app.get('/ruolo-at', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { matricola, data } = z.object({
      matricola: z.string().min(1),
      data:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(req.query)

    const results = await repo.findRuoloAt(matricola, data)
    return reply.send(results)
  })

  // POST /api/v1/anagrafiche/import — upload XML (solo admin)
  // FIX M-3: bodyLimit 5 MB — prevenzione upload di file enormi
  app.post('/import', {
    preHandler: [app.authenticate, requireAdmin],
    bodyLimit: 5 * 1024 * 1024,
  }, async (request, reply) => {
    const schema = z.object({
      xml:               z.string().min(1),
      dataAggiornamento: z.string().datetime().optional(),
    })
    const { xml, dataAggiornamento } = schema.parse(request.body)

    let result
    try {
      result = await importAnagrafiche(
        xml,
        repo,
        dataAggiornamento ? new Date(dataAggiornamento) : new Date(),
      )
    } catch (err: any) {
      if (err.message?.startsWith('FILE_TOO_MANY_ROWS')) {
        return reply.status(413).send({ error: err.message })
      }
      throw err
    }

    return reply.code(200).send(result)
  })

  // POST /api/v1/anagrafiche/import-xlsx — upload XLSX SGE (solo admin)
  // Body: { xlsx: string (base64), nomeFile?: string, dataAggiornamento?: string }
  // Limite 10 MB — file SGE più grandi dell'XML
  app.post('/import-xlsx', {
    preHandler: [app.authenticate, requireAdmin],
    bodyLimit: 10 * 1024 * 1024,
  }, async (request, reply) => {
    const bodySchema = z.object({
      xlsx:              z.string().min(1),
      nomeFile:          z.string().optional(),
      dataAggiornamento: z.string().datetime().optional(),
    })
    const { xlsx, nomeFile, dataAggiornamento } = bodySchema.parse(request.body)

    const fileBuffer = Buffer.from(xlsx, 'base64')
    if (fileBuffer.byteLength > 10_000_000) {
      return reply.status(413).send({ error: 'File troppo grande (max 10 MB)' })
    }

    const dataAgg   = dataAggiornamento ? new Date(dataAggiornamento) : new Date()
    const userId    = (request as any).user?.id ?? null

    // Crea log entry — ottieni ID importazione
    const [logRow] = await app.db.execute(sql`
      INSERT INTO anag_import_log (nome_file, utente_importazione)
      VALUES (${nomeFile ?? null}, ${userId})
      RETURNING id
    `) as unknown as [{ id: number }]
    const importId = logRow!.id

    let result
    try {
      result = await importAnagraficheXlsx(fileBuffer, repo, dataAgg)
    } catch (err: any) {
      // Aggiorna log con errore
      await app.db.execute(sql`
        UPDATE anag_import_log SET
          esito = 'ERRORE',
          messaggio_errore = ${err.message ?? 'Errore sconosciuto'}
        WHERE id = ${importId}
      `)
      if (err.message?.startsWith('FILE_TOO_MANY_ROWS') || err.message?.startsWith('XLSX_EMPTY')) {
        return reply.status(413).send({ error: err.message })
      }
      throw err
    }

    // Aggiorna log con contatori finali
    await app.db.execute(sql`
      UPDATE anag_import_log SET
        num_record_file       = ${result.inserted + result.updated + result.skipped + result.errors.length},
        num_record_inseriti   = ${result.inserted},
        num_record_aggiornati = ${result.updated},
        num_record_invariati  = ${result.skipped},
        num_errori            = ${result.errors.length},
        esito                 = ${result.errors.length > 0 ? 'PARZIALE' : 'OK'}
      WHERE id = ${importId}
    `)

    return reply.code(200).send({ ...result, importId })
  })
}
