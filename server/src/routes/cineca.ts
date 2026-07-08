// ============================================================
// PAYROLL GANG SUITE — Routes CINECA (/api/v1/cineca)
// Proxy server-side verso CSA-WS. Dati PII (CF dipendenti/figli):
//  - solo admin (requireAdmin) + audit log di ogni lookup
//  - cache familiari con cod_fisc CIFRATO (AES-256-GCM) + TTL
//  - bulk figli: cache-first + concorrenza limitata + timeout (no hang)
// ============================================================

import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { env, cinecaConfigured } from '../config/env.js'
import { requireAdmin } from '../middleware/authenticate.js'
import { PgAnagraficheRepository } from '../db/repositories/PgAnagraficheRepository.js'
import { PgFamiliariRepository } from '../db/repositories/PgFamiliariRepository.js'
import { PgAuditRepository } from '../db/repositories/PgAuditRepository.js'
import { encrypt, decrypt } from '../services/cryptoService.js'
import {
  getFamiliari,
  CinecaApiError,
  CinecaNoIdAbError,
  type FamiliareNorm,
} from '../services/cinecaService.js'
import type { FamiliareCacheRow, FamiliareCacheInput } from '../db/IRepository.js'

// Freschezza cache familiari: oltre questa soglia si ribatte CINECA
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000   // 7 giorni
// Concorrenza massima verso CSA-WS nel recupero bulk dei figli
const CINECA_CONCURRENCY = 6

export async function cinecaRoutes(app: FastifyInstance): Promise<void> {

  const anagRepo  = new PgAnagraficheRepository(app.db)
  const famRepo   = new PgFamiliariRepository(app.db)
  const auditRepo = new PgAuditRepository(app.db)

  // Tutte le route PII: autenticazione + admin
  const pii = { preHandler: [app.authenticate, requireAdmin] }

  const qMatricola = z.object({ matricola: z.string().min(1).max(20) })

  function audit(userId: string | undefined, ip: string, dettagli: Record<string, unknown>) {
    void auditRepo.log({
      userId: userId ?? undefined,
      azione: 'CINECA_CF_LOOKUP',
      entita: 'cineca',
      dettagli,
      ip,
    }).catch(() => { /* audit best-effort */ })
  }

  // idAb locale (da SGE) — preferito dall'API v1 familiari
  async function localIdAb(matricola: string): Promise<number | null> {
    const rows = await anagRepo.findByMatricola(matricola)
    return rows.find(r => r.idAb != null)?.idAb ?? null
  }

  function toCacheInput(matricola: string, idAb: number | null) {
    return (f: FamiliareNorm): FamiliareCacheInput => ({
      matricola,
      idAb,
      codFisc:           encrypt(f.codFisc),   // PII cifrata a riposo
      cognome:           f.cognome,
      nome:              f.nome,
      sesso:             f.sesso,
      rapportoParentela: f.rapportoParentela,
      dataNasc:          f.dataNasc,
    })
  }

  // Nucleo CACHE-FIRST: usa la cache se fresca, altrimenti CINECA (con timeout
  // nel service) + aggiorna cache. In errore, ripiega sulla cache anche stantia.
  async function resolveNucleo(matricola: string): Promise<{ familiari: FamiliareNorm[]; fromCache: boolean }> {
    const cached = await famRepo.findByMatricola(matricola)
    const fresh  = cached.length > 0 &&
      cached.every(r => Date.now() - new Date(r.aggiornatoAt).getTime() < CACHE_TTL_MS)
    if (fresh) return { familiari: cached.map(cacheToNorm), fromCache: true }

    if (!cinecaConfigured) {
      return { familiari: cached.map(cacheToNorm), fromCache: true }
    }

    // L'API familiari v1 richiede idAb (da SGE). Senza, non interrogabile.
    const idAb = await localIdAb(matricola)
    if (idAb == null) {
      app.log.warn({ matricola }, 'CINECA familiari: idAb locale assente — serve import SGE per questa matricola')
      return { familiari: cached.map(cacheToNorm), fromCache: true }
    }

    try {
      const familiari = await getFamiliari({ idAb })
      await famRepo.replaceForMatricola(matricola, familiari.map(toCacheInput(matricola, idAb)))
      return { familiari, fromCache: false }
    } catch (err) {
      if (err instanceof CinecaNoIdAbError) {
        return { familiari: cached.map(cacheToNorm), fromCache: true }
      }
      if (!(err instanceof CinecaApiError)) throw err
      app.log.warn({ matricola, idAb, status: err.status, msg: err.message }, 'CINECA familiari fallita')
      if (cached.length > 0) return { familiari: cached.map(cacheToNorm), fromCache: true }
      throw err
    }
  }

  // Tutti i figli (FG), ordinati dal più giovane al più anziano.
  function figliFG(familiari: FamiliareNorm[]): FamiliareNorm[] {
    return familiari
      .filter(f => f.rapportoParentela.toUpperCase() === env.PARENTELA_FIGLIO.toUpperCase())
      .sort((a, b) => (b.dataNasc ?? '').localeCompare(a.dataNasc ?? ''))
  }

  function figlioPiuGiovane(familiari: FamiliareNorm[]): FamiliareNorm | null {
    return figliFG(familiari)[0] ?? null
  }

  // GET /cf?matricola=  — CF dipendente dal dato locale (SGE)
  app.get('/cf', pii, async (request, reply) => {
    const { matricola } = qMatricola.parse(request.query)
    audit(request.user?.id, request.ip, { endpoint: 'cf', matricola })
    const rows = await anagRepo.findByMatricola(matricola)
    const codFisc = rows.find(r => r.codFis)?.codFis ?? null
    if (!codFisc) return reply.code(404).send({ error: 'CF_NON_DISPONIBILE' })
    return reply.send({ matricola, codFisc, source: 'local' })
  })

  // GET /familiari?matricola=
  app.get('/familiari', pii, async (request, reply) => {
    const { matricola } = qMatricola.parse(request.query)
    audit(request.user?.id, request.ip, { endpoint: 'familiari', matricola })
    try {
      const { familiari, fromCache } = await resolveNucleo(matricola)
      return reply.send({ matricola, familiari, fromCache })
    } catch (err) {
      return cinecaErrorReply(reply, err)
    }
  })

  // POST /cf-bulk  { matricole[] }  → { [matricola]: { codFisc } }  (locale SGE)
  app.post('/cf-bulk', pii, async (request, reply) => {
    const { matricole } = z.object({
      matricole: z.array(z.string().min(1).max(20)).min(1).max(2000),
    }).parse(request.body)
    audit(request.user?.id, request.ip, { endpoint: 'cf-bulk', count: matricole.length })
    const map = await anagRepo.getCodFisByMatricole(matricole)
    const out: Record<string, { codFisc: string }> = {}
    for (const [mat, codFisc] of Object.entries(map)) out[mat] = { codFisc }
    return reply.send(out)
  })

  // POST /figli-giovane-bulk  { matricole[] }  → { [matricola]: figlio | null }
  // Cache-first + concorrenza limitata + timeout (service). Errori per-matricola
  // non bloccano il batch.
  app.post('/figli-giovane-bulk', pii, async (request, reply) => {
    const { matricole } = z.object({
      matricole: z.array(z.string().min(1).max(20)).min(1).max(200),
    }).parse(request.body)
    audit(request.user?.id, request.ip, { endpoint: 'figli-giovane-bulk', count: matricole.length })

    const out: Record<string, FamiliareNorm | null> = {}
    let risolti = 0, errori = 0
    await mapLimit(matricole, CINECA_CONCURRENCY, async matricola => {
      try {
        const { familiari } = await resolveNucleo(matricola)
        const figlio = figlioPiuGiovane(familiari)
        out[matricola] = figlio
        if (figlio) risolti++
      } catch {
        out[matricola] = null
        errori++
      }
    })
    app.log.info({ totale: matricole.length, risolti, senzaFiglioOrIdAb: matricole.length - risolti - errori, errori }, 'figli-giovane-bulk')
    return reply.send(out)
  })

  // POST /figli-bulk  { matricole[] }  → { [matricola]: FamiliareNorm[] }
  // Tutti i figli (FG) per matricola — per la scelta manuale in blocco (tag WE
  // senza scelta automatica). Cache-first + concorrenza limitata + timeout.
  // Errori per-matricola non bloccano il batch (→ array vuoto).
  app.post('/figli-bulk', pii, async (request, reply) => {
    const { matricole } = z.object({
      matricole: z.array(z.string().min(1).max(20)).min(1).max(200),
    }).parse(request.body)
    audit(request.user?.id, request.ip, { endpoint: 'figli-bulk', count: matricole.length })

    const out: Record<string, FamiliareNorm[]> = {}
    let conFigli = 0, errori = 0
    await mapLimit(matricole, CINECA_CONCURRENCY, async matricola => {
      try {
        const { familiari } = await resolveNucleo(matricola)
        const figli = figliFG(familiari)
        out[matricola] = figli
        if (figli.length > 0) conFigli++
      } catch {
        out[matricola] = []
        errori++
      }
    })
    app.log.info({ totale: matricole.length, conFigli, errori }, 'figli-bulk')
    return reply.send(out)
  })

  // GET /figlio-giovane?matricola=
  app.get('/figlio-giovane', pii, async (request, reply) => {
    const { matricola } = qMatricola.parse(request.query)
    audit(request.user?.id, request.ip, { endpoint: 'figlio-giovane', matricola })
    try {
      const { familiari, fromCache } = await resolveNucleo(matricola)
      const figlio = figlioPiuGiovane(familiari)
      if (!figlio) return reply.code(404).send({ error: 'NESSUN_FIGLIO', fromCache })
      return reply.send({ matricola, figlio, fromCache })
    } catch (err) {
      return cinecaErrorReply(reply, err)
    }
  })
}

// Decifra il cod_fisc dalla cache; fallback al valore grezzo per righe
// pre-cifratura (compat) o payload non valido.
function cacheToNorm(r: FamiliareCacheRow): FamiliareNorm {
  let codFisc = r.codFisc
  try { codFisc = decrypt(r.codFisc) } catch { /* riga pre-cifratura: usa grezzo */ }
  return {
    codFisc,
    rapportoParentela: r.rapportoParentela,
    cognome:           r.cognome,
    nome:              r.nome,
    sesso:             r.sesso,
    dataNasc:          r.dataNasc,
  }
}

// Concorrenza limitata senza dipendenze esterne.
async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      await fn(items[idx]!)
    }
  })
  await Promise.all(workers)
}

// Errori CINECA → codice generico, MAI il message interno (può contenere PII/path)
function cinecaErrorReply(reply: FastifyReply, err: unknown) {
  if (!cinecaConfigured) return reply.code(503).send({ error: 'CINECA_NON_CONFIGURATO' })
  if (err instanceof CinecaApiError) return reply.code(502).send({ error: 'CINECA_API_ERROR' })
  throw err
}
