// ============================================================
// PAYROLL GANG SUITE — PgJwtBlocklistRepository
// SEC-C02: revoca degli access token al logout (per jti).
// Spostamento letterale delle query che stavano in AuthService.logout(),
// middleware/authenticate.ts e nel job di pulizia in app.ts.
// ============================================================

import { eq, lt } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import type { IJwtBlocklistRepository } from '../IRepository.js'

type DB = PostgresJsDatabase<typeof schema>

export class PgJwtBlocklistRepository implements IJwtBlocklistRepository {
  constructor(private readonly db: DB) {}

  async add(jti: string, expiresAt: Date): Promise<void> {
    // onConflictDoNothing: il logout doppio non deve produrre errori
    await this.db
      .insert(schema.jwtBlocklist)
      .values({ jti, expiresAt })
      .onConflictDoNothing()
  }

  async isBlocked(jti: string): Promise<boolean> {
    const [row] = await this.db
      .select({ jti: schema.jwtBlocklist.jti })
      .from(schema.jwtBlocklist)
      .where(eq(schema.jwtBlocklist.jti, jti))
      .limit(1)

    return row !== undefined
  }

  async purgeExpired(now: Date): Promise<void> {
    await this.db
      .delete(schema.jwtBlocklist)
      .where(lt(schema.jwtBlocklist.expiresAt, now))
  }
}
