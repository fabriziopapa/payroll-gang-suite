// ============================================================
// PAYROLL GANG SUITE — Routes Verifica liquidato (/api/v1/verifica-liquidato)
// Proxy server-side verso CSA-WS (liquidato/dettaglio) + riconciliazione
// con gli invii PGS. PII/dato sensibile → solo admin + audit di ogni lettura.
// ============================================================

import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { cinecaConfigured } from '../config/env.js'
import { requireAdmin } from '../middleware/authenticate.js'
import { PgAuditRepository } from '../db/repositories/PgAuditRepository.js'
import {
  getLiquidatoDettaglio, CinecaApiError, CinecaNotConfiguredError,
} from '../services/cinecaService.js'
import { ricostruisciInviiPGS, riconcilia } from '../services/verificaLiquidato/riconciliazione.js'
import type { RigaPGS } from '../services/verificaLiquidato/types.js'

const periodo = {
  anno:      z.string().regex(/^\d{4}$/),
  mese:      z.string().regex(/^\d{2}$/),
  matricola: z.string().min(1).max(20),
}

const rigaPGSSchema = z.object({
  matricola:          z.string().min(1).max(20),
  voce:               z.string().min(1).max(10),
  capitolo:           z.string().min(1).max(10),
  dataCompetenzaVoce: z.string().min(10).max(10),
  riferimento:        z.string().max(200),
  importo:            z.number(),
  parti:              z.number().optional(),
  flagParti:          z.boolean().optional(),
})

export async function verificaLiquidatoRoutes(app: FastifyInstance): Promise<void> {
  const auditRepo = new PgAuditRepository(app.db)
  const pii = { preHandler: [app.authenticate, requireAdmin] }

  function audit(userId: string | undefined, ip: string, dettagli: Record<string, unknown>) {
    void auditRepo.log({
      userId: userId ?? undefined,
      azione: 'CINECA_LIQUIDATO_LOOKUP',
      entita: 'verifica-liquidato',
      dettagli,
      ip,
    }).catch(() => { /* audit best-effort */ })
  }

  // GET /dettaglio?anno&mese&matricola → { dettaglio grezzo, ricostruzione invii PGS }
  app.get('/dettaglio', pii, async (request, reply) => {
    const q = z.object(periodo).parse(request.query)
    audit(request.user?.id, request.ip, { endpoint: 'dettaglio', ...q })
    try {
      const dettaglio = await getLiquidatoDettaglio(q)
      return reply.send({ ...q, dettaglio, ricostruzione: ricostruisciInviiPGS(dettaglio) })
    } catch (err) {
      return errReply(reply, err)
    }
  })

  // POST /riconcilia { anno, mese, matricola, righePGS[] } → risultato riconciliazione
  app.post('/riconcilia', pii, async (request, reply) => {
    const b = z.object({ ...periodo, righePGS: z.array(rigaPGSSchema).max(5000) }).parse(request.body)
    audit(request.user?.id, request.ip, {
      endpoint: 'riconcilia', anno: b.anno, mese: b.mese, matricola: b.matricola, nRighePGS: b.righePGS.length,
    })
    try {
      const dettaglio = await getLiquidatoDettaglio({ anno: b.anno, mese: b.mese, matricola: b.matricola })
      return reply.send(riconcilia(dettaglio, b.righePGS as RigaPGS[]))
    } catch (err) {
      return errReply(reply, err)
    }
  })
}

// Errori CINECA → codice generico + solo lo STATUS numerico (mai il message
// interno, che può contenere PII/path). Distingue "irraggiungibile" (timeout/
// geo-block/proxy off → nessuno status) da "errore API" (status upstream).
function errReply(reply: FastifyReply, err: unknown) {
  if (!cinecaConfigured || err instanceof CinecaNotConfiguredError) {
    return reply.code(503).send({ error: 'CINECA_NON_CONFIGURATO' })
  }
  if (err instanceof CinecaApiError) {
    return err.status != null
      ? reply.code(502).send({ error: 'CINECA_API_ERROR', status: err.status })
      : reply.code(504).send({ error: 'CINECA_UNREACHABLE' })
  }
  throw err
}
