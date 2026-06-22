// ============================================================
// PAYROLL GANG SUITE — Routes CINECA (/api/v1/cineca)
// Proxy server-side verso CSA-WS. Mai esposto al client senza auth.
//  GET /cf?matricola=               → CF dipendente (locale, per tag WD)
//  GET /familiari?matricola=        → nucleo familiare (live + cache fallback)
//  GET /figlio-giovane?matricola=   → figlio più giovane (per tag WE)
// ============================================================

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { env, cinecaConfigured } from '../config/env.js'
import { PgAnagraficheRepository } from '../db/repositories/PgAnagraficheRepository.js'
import { PgFamiliariRepository } from '../db/repositories/PgFamiliariRepository.js'
import {
  getFamiliari,
  CinecaApiError,
  type FamiliareNorm,
} from '../services/cinecaService.js'
import type { FamiliareCacheRow } from '../db/IRepository.js'

export async function cinecaRoutes(app: FastifyInstance): Promise<void> {

  const anagRepo = new PgAnagraficheRepository(app.db)
  const famRepo  = new PgFamiliariRepository(app.db)

  const qMatricola = z.object({ matricola: z.string().min(1) })

  // idAb locale (da SGE) per la matricola — preferito dall'API v1 familiari
  async function localIdAb(matricola: string): Promise<number | null> {
    const rows = await anagRepo.findByMatricola(matricola)
    return rows.find(r => r.idAb != null)?.idAb ?? null
  }

  // Risolve il nucleo: live CINECA (+ aggiorna cache) con fallback alla
  // cache se l'API è giù o non configurata.
  async function resolveNucleo(matricola: string): Promise<{ familiari: FamiliareNorm[]; fromCache: boolean }> {
    if (cinecaConfigured) {
      try {
        const idAb = await localIdAb(matricola)
        const familiari = await getFamiliari({ idAb, matricola })
        await famRepo.replaceForMatricola(matricola, familiari.map(f => ({
          matricola,
          idAb,
          codFisc:           f.codFisc,
          cognome:           f.cognome,
          nome:              f.nome,
          sesso:             f.sesso,
          rapportoParentela: f.rapportoParentela,
          dataNasc:          f.dataNasc,
        })))
        return { familiari, fromCache: false }
      } catch (err) {
        if (!(err instanceof CinecaApiError)) throw err
        const cached = await famRepo.findByMatricola(matricola)
        if (cached.length > 0) return { familiari: cached.map(cacheToNorm), fromCache: true }
        throw err
      }
    }
    const cached = await famRepo.findByMatricola(matricola)
    return { familiari: cached.map(cacheToNorm), fromCache: true }
  }

  // GET /api/v1/cineca/cf?matricola=  — CF dipendente dal dato locale (SGE)
  app.get('/cf', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { matricola } = qMatricola.parse(request.query)
    const rows = await anagRepo.findByMatricola(matricola)
    const codFisc = rows.find(r => r.codFis)?.codFis ?? null
    if (!codFisc) {
      return reply.code(404).send({ error: 'CF_NON_DISPONIBILE', matricola })
    }
    return reply.send({ matricola, codFisc, source: 'local' })
  })

  // GET /api/v1/cineca/familiari?matricola=
  app.get('/familiari', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { matricola } = qMatricola.parse(request.query)
    try {
      const { familiari, fromCache } = await resolveNucleo(matricola)
      return reply.send({ matricola, familiari, fromCache })
    } catch (err) {
      return cinecaErrorReply(reply, err)
    }
  })

  // GET /api/v1/cineca/figlio-giovane?matricola=  — figlio FG più giovane (WE)
  app.get('/figlio-giovane', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { matricola } = qMatricola.parse(request.query)
    try {
      const { familiari, fromCache } = await resolveNucleo(matricola)
      const figli = familiari.filter(
        f => f.rapportoParentela.toUpperCase() === env.PARENTELA_FIGLIO.toUpperCase(),
      )
      if (figli.length === 0) {
        return reply.code(404).send({ error: 'NESSUN_FIGLIO', matricola, fromCache })
      }
      const figlio = figli.sort((a, b) => (b.dataNasc ?? '').localeCompare(a.dataNasc ?? ''))[0]!
      return reply.send({ matricola, figlio, fromCache })
    } catch (err) {
      return cinecaErrorReply(reply, err)
    }
  })
}

function cacheToNorm(r: FamiliareCacheRow): FamiliareNorm {
  return {
    codFisc:           r.codFisc,
    rapportoParentela: r.rapportoParentela,
    cognome:           r.cognome,
    nome:              r.nome,
    sesso:             r.sesso,
    dataNasc:          r.dataNasc,
  }
}

function cinecaErrorReply(reply: import('fastify').FastifyReply, err: unknown) {
  if (!cinecaConfigured) {
    return reply.code(503).send({ error: 'CINECA_NON_CONFIGURATO' })
  }
  if (err instanceof CinecaApiError) {
    return reply.code(502).send({ error: 'CINECA_API_ERROR', message: err.message })
  }
  throw err
}
