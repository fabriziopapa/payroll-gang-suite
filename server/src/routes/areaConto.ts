// ============================================================
// PAYROLL GANG SUITE — Routes Area del conto (/api/v1/area-conto)
//
// GET  /                 ?naz=IT,LT,BE[&data=AAAA-MM-GG]
//   → { epcVersione, epcData, data, elenco, risultati: [{ naz, area }] }
//     Dato il paese dell'IBAN restituisce IT / SEPA / EXTRA_UE; quello che
//     non si risolve torna NON_NOTO. Con `data`, risponde con l'elenco dei
//     paesi in vigore quel giorno (storia di paesi_conto).
//
// GET  /paesi            → { inVigore[], storia[] }         (autenticato)
// POST /paesi            { codice, area, validoDal?, nota } (admin + audit)
//     Cambia l'area di un paese da una data. Non sovrascrive: chiude la riga
//     in vigore e ne apre una nuova. Un paese non puo' essere insieme SEPA
//     ed EXTRA_UE (lo garantisce il database).
//
// NESSUNA REGOLA QUI. La regola e' lib/areaConto.ts; l'elenco che consulta
// viene da paesi_conto ed e' tenuto in memoria (ricaricaElencoPaesi).
//
// Nessun dato personale: entrano ed escono codici paese.
// ============================================================

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from '../middleware/authenticate.js'
import { PgPaesiContoRepository } from '../db/repositories/PgPaesiContoRepository.js'
import { PgAuditRepository } from '../db/repositories/PgAuditRepository.js'
import type { IPaesiContoRepository } from '../db/IRepository.js'
import {
  classificaNazioni, impostaElencoPaesi, elencoDalDatabase, EPC_VERSIONE, EPC_DATA,
} from '../lib/areaConto.js'

/** Quante nazioni per richiesta. I paesi del mondo sono meno di 250. */
const MAX_NAZIONI = 250

const DATA = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)

/**
 * Carica in memoria l'elenco da paesi_conto. Se la tabella non c'e' ancora
 * (migrazione 0019 non applicata) o il database non risponde, resta
 * l'elenco scritto nel codice e lo si dice nel log: la classificazione non
 * si ferma, e il fatto non passa in silenzio.
 */
export async function ricaricaElencoPaesi(
  repo: IPaesiContoRepository,
  log: { warn: (o: unknown, m?: string) => void },
): Promise<void> {
  try {
    impostaElencoPaesi(await repo.tutte())
  } catch (err) {
    impostaElencoPaesi(null)
    log.warn({ err: (err as Error).message }, 'paesi_conto non leggibile: uso l\'elenco EPC scritto nel codice')
  }
}

export async function areaContoRoutes(app: FastifyInstance): Promise<void> {
  const repo      = new PgPaesiContoRepository(app.db)
  const auditRepo = new PgAuditRepository(app.db)

  app.get('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const q = z.object({
      naz:  z.string().trim().min(1).max(MAX_NAZIONI * 4),
      data: DATA.optional(),
    }).parse(request.query)
    const nazioni = q.naz.split(',')
    if (nazioni.length > MAX_NAZIONI) {
      return reply.code(400).send({ error: 'troppe_nazioni', max: MAX_NAZIONI })
    }
    return reply.send({
      epcVersione: EPC_VERSIONE,
      epcData:     EPC_DATA,
      data:        q.data ?? null,
      /** 'database' = paesi_conto; 'codice' = elenco di ripiego scritto nel codice. */
      elenco:      elencoDalDatabase() ? 'database' : 'codice',
      risultati:   classificaNazioni(nazioni, q.data),
    })
  })

  app.get('/paesi', { preHandler: [app.authenticate] }, async (_request, reply) => {
    const storia = await repo.tutte()
    return reply.send({
      inVigore: storia.filter(r => r.validoAl === null),
      storia,
    })
  })

  app.post('/paesi', { preHandler: [app.authenticate, requireAdmin] }, async (request, reply) => {
    const b = z.object({
      codice:    z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
      area:      z.enum(['SEPA', 'EXTRA_UE']),
      validoDal: DATA.optional(),
      nota:      z.string().trim().min(3).max(300),
    }).parse(request.body)

    // IT e' un caso a se' della regola: cambiarlo in tabella non avrebbe
    // alcun effetto, e farlo credere sarebbe peggio che vietarlo.
    if (b.codice === 'IT') return reply.code(400).send({ error: 'IT_NON_MODIFICABILE' })

    const validoDal = b.validoDal
      ?? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date())

    const esito = await repo.cambia({
      codice: b.codice, area: b.area, validoDal,
      fonte: 'manuale', nota: b.nota, userId: request.user?.id ?? null,
    })

    if (esito.esito === 'invariato') return reply.code(409).send({ error: 'AREA_GIA_IN_VIGORE' })
    if (esito.esito === 'data-non-valida') {
      return reply.code(409).send({ error: 'DATA_NON_VALIDA', validoDalInVigore: esito.validoDalInVigore })
    }

    // Audit NON best-effort, come per le altre scritture amministrative.
    await auditRepo.log({
      userId:   request.user?.id,
      azione:   'PAESI_CONTO_CAMBIO',
      entita:   'paesi_conto',
      entitaId: String(esito.nuova.id),
      dettagli: {
        codice: b.codice, area: b.area, validoDal, nota: b.nota,
        prima:  esito.chiusa ? { area: esito.chiusa.area, validoDal: esito.chiusa.validoDal } : null,
      },
      ip:       request.ip,
    })

    await ricaricaElencoPaesi(repo, request.log)
    return reply.send({ nuova: esito.nuova, chiusa: esito.chiusa })
  })
}
