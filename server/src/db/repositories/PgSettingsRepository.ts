// ============================================================
// PAYROLL GANG SUITE — PgSettingsRepository
// Chiave/valore JSONB — coefficienti, csv defaults, tags, ecc.
// ============================================================

import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import type { ISettingsRepository } from '../IRepository.js'

type DB = PostgresJsDatabase<typeof schema>

export class PgSettingsRepository implements ISettingsRepository {
  constructor(private readonly db: DB) {}

  async get<T>(chiave: string): Promise<T | null> {
    const [row] = await this.db
      .select({ valore: schema.appSettings.valore })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.chiave, chiave))
      .limit(1)

    return row ? (row.valore as T) : null
  }

  async set<T>(chiave: string, valore: T): Promise<void> {
    await this.db
      .insert(schema.appSettings)
      .values({ chiave, valore: valore as Record<string, unknown>, updatedAt: new Date() })
      .onConflictDoUpdate({
        target:  schema.appSettings.chiave,
        set:     { valore: valore as Record<string, unknown>, updatedAt: new Date() },
      })
  }

  async getAll(): Promise<Record<string, unknown>> {
    const rows = await this.db
      .select({ chiave: schema.appSettings.chiave, valore: schema.appSettings.valore })
      .from(schema.appSettings)

    return Object.fromEntries(rows.map(r => [r.chiave, r.valore]))
  }
}
