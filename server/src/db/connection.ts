// ============================================================
// PAYROLL GANG SUITE — Connessione DB (Drizzle + postgres.js)
// ============================================================

import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema.js'
import { env } from '../config/env.js'

/** Client postgres.js con pool configurato da env */
const client = postgres({
  host:            env.DB_HOST,
  port:            env.DB_PORT,
  database:        env.DB_NAME,
  username:        env.DB_USER,
  password:        env.DB_PASSWORD,
  ssl:             env.DB_SSL ? { rejectUnauthorized: true } : false,
  max:             env.DB_POOL_MAX,
  idle_timeout:    env.DB_POOL_IDLE_TIMEOUT / 1000,
  connect_timeout: env.DB_CONNECTION_TIMEOUT / 1000,
  transform: {
    /** Converte automaticamente snake_case colonne ↔ camelCase JS */
    ...postgres.camel,
  },
  onnotice: () => { /* sopprime notice PostgreSQL in produzione */ },
})

/** Istanza Drizzle ORM — unica per tutta l'applicazione */
export const db = drizzle(client, { schema, logger: env.NODE_ENV === 'development' })

/** Chiude il pool (usato in graceful shutdown) */
export async function closeDb(): Promise<void> {
  await client.end()
}
