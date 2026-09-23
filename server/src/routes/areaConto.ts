// ============================================================
// PAYROLL GANG SUITE — Routes Area del conto (/api/v1/area-conto)
//
// GET /api/v1/area-conto?naz=IT,LT,BE
//   → { epcVersione, epcData, risultati: [{ naz, area }] }
//
// Dato il paese dell'IBAN, restituisce IT / SEPA / EXTRA_UE; quello che non
// si risolve torna NON_NOTO. Una risposta per ogni nazione richiesta, nello
// stesso ordine.
//
// NESSUNA REGOLA QUI. La classificazione e' lib/areaConto.ts, la stessa
// funzione che il server usa quando restituisce un'anagrafica o i risultati
// di risolvi-nominativi: chi chiama l'endpoint e chi legge un'anagrafica
// vedono per costruzione la stessa risposta.
//
// La versione dell'elenco EPC viaggia con ogni risposta: chi salva un'area
// (la riga di una lavorazione Emolumenti) salva anche con quale elenco e'
// stata calcolata.
//
// Non e' un dato personale: entrano ed escono codici nazione. Basta essere
// autenticati, non serve il ruolo di amministratore, e non si scrive audit.
// ============================================================

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { classificaNazioni, EPC_VERSIONE, EPC_DATA } from '../lib/areaConto.js'

/** Quante nazioni per richiesta. I paesi del mondo sono meno di 250. */
const MAX_NAZIONI = 250

const QuerySchema = z.object({
  naz: z.string().trim().min(1).max(MAX_NAZIONI * 4),
})

export async function areaContoRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { naz } = QuerySchema.parse(request.query)
    const nazioni = naz.split(',')
    if (nazioni.length > MAX_NAZIONI) {
      return reply.code(400).send({ error: 'troppe_nazioni', max: MAX_NAZIONI })
    }
    return reply.send({
      epcVersione: EPC_VERSIONE,
      epcData:     EPC_DATA,
      risultati:   classificaNazioni(nazioni),
    })
  })
}
