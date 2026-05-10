// ============================================================
// PAYROLL GANG SUITE — Routes Settings (/api/v1/settings)
// ============================================================

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from '../middleware/authenticate.js'
import { PgSettingsRepository } from '../db/repositories/PgSettingsRepository.js'

// SEC-H04: whitelist delle chiavi consentite in app_settings.
// Chiavi scritte dal server (import): last_import_*
// Chiavi scritte dal client (impostazioni): coefficienti, csvDefaults, tags, rubrica, modelliComunicazione, turnstileEnabled
// Aggiungere nuove chiavi qui quando si estende il modello dati.
const ALLOWED_SETTINGS_KEYS: ReadonlySet<string> = new Set([
  // Scritte dal server durante gli import
  'last_import_anagrafiche',
  'last_import_voci',
  'last_import_capitoli_standard',
  'last_import_capitoli_locali',
  // Scritte dal client (impostazioni applicazione)
  'coefficienti',
  'csvDefaults',
  'tags',
  'rubrica',
  'modelliComunicazione',
  'turnstileEnabled',
])

// Chiavi esposte senza autenticazione (solo valori non sensibili)
const PUBLIC_SETTINGS_KEYS: ReadonlySet<string> = new Set([
  'turnstileEnabled',
])

export async function settingsRoutes(app: FastifyInstance): Promise<void> {

  const repo = new PgSettingsRepository(app.db)

  // GET /settings/public — senza autenticazione
  // Espone solo le chiavi in PUBLIC_SETTINGS_KEYS (valori non sensibili)
  // Usato da LoginPage prima dell'autenticazione (es. turnstileEnabled)
  app.get('/public', async (_req, reply) => {
    const all = await repo.getAll()
    const filtered = Object.fromEntries(
      Object.entries(all).filter(([k]) => PUBLIC_SETTINGS_KEYS.has(k)),
    )
    // Default espliciti per chiavi non ancora scritte in DB
    return reply.send({ turnstileEnabled: true, ...filtered })
  })

  // SEC-H04: GET filtra solo le chiavi in whitelist per non esporre chiavi spurie
  app.get('/', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const all = await repo.getAll()
    const filtered = Object.fromEntries(
      Object.entries(all).filter(([k]) => ALLOWED_SETTINGS_KEYS.has(k)),
    )
    return reply.send(filtered)
  })

  /** Aggiornamento batch: { chiave1: valore1, chiave2: valore2, … } */
  app.put('/', { preHandler: [app.authenticate, requireAdmin] }, async (req, reply) => {
    const body = z.record(z.unknown()).parse(req.body)
    for (const [chiave, valore] of Object.entries(body)) {
      // SEC-H04: rifiuta chiavi non in whitelist
      if (!ALLOWED_SETTINGS_KEYS.has(chiave)) {
        return reply.status(400).send({ error: 'Chiave non consentita' })
      }
      await repo.set(chiave, valore)
    }
    return reply.send(await repo.getAll())
  })

  /** Aggiornamento singola chiave: PUT /:chiave { valore: … } */
  app.put('/:chiave', { preHandler: [app.authenticate, requireAdmin] }, async (req, reply) => {
    const { chiave } = z.object({ chiave: z.string().min(1) }).parse(req.params)
    // SEC-H04: rifiuta chiavi non in whitelist
    if (!ALLOWED_SETTINGS_KEYS.has(chiave)) {
      return reply.status(400).send({ error: 'Chiave non consentita' })
    }
    const { valore } = z.object({ valore: z.unknown() }).parse(req.body)
    await repo.set(chiave, valore)
    return reply.send({ success: true })
  })
}
