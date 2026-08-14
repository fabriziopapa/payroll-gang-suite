// ============================================================
// PAYROLL GANG SUITE — PgRefreshTokensRepository
// Persistenza dei refresh token della sessione PGS.
// Le query qui dentro sono lo spostamento LETTERALE di quelle che
// stavano in AuthService (refresh/logout/#issueRefreshToken): stesse
// condizioni, stesso ordine, stessa semantica.
// ============================================================

import { and, eq, gt, isNull } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import type {
  IRefreshTokensRepository,
  RefreshTokenInput,
  RefreshTokenRow,
} from '../IRepository.js'

type DB = PostgresJsDatabase<typeof schema>

export class PgRefreshTokensRepository implements IRefreshTokensRepository {
  constructor(private readonly db: DB) {}

  async create(input: RefreshTokenInput): Promise<void> {
    await this.db.insert(schema.refreshTokens).values({
      userId:        input.userId,
      tokenHash:     input.tokenHash,
      tokenSelector: input.tokenSelector,
      fingerprint:   input.fingerprint,
      expiresAt:     input.expiresAt,
    })
  }

  async findActiveBySelector(selector: string, now: Date): Promise<RefreshTokenRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.refreshTokens)
      .where(and(
        eq(schema.refreshTokens.tokenSelector, selector),
        isNull(schema.refreshTokens.revokedAt),
        gt(schema.refreshTokens.expiresAt, now),
      ))
      .limit(1)

    if (!row) return null

    return {
      id:            row.id,
      userId:        row.userId,
      tokenHash:     row.tokenHash,
      tokenSelector: row.tokenSelector,
      fingerprint:   row.fingerprint,
      expiresAt:     row.expiresAt,
      revokedAt:     row.revokedAt ?? null,
    }
  }

  async revokeById(id: number, now: Date): Promise<void> {
    await this.db
      .update(schema.refreshTokens)
      .set({ revokedAt: now })
      .where(eq(schema.refreshTokens.id, id))
  }

  async revokeAllForUser(userId: string, now: Date): Promise<void> {
    await this.db
      .update(schema.refreshTokens)
      .set({ revokedAt: now })
      .where(eq(schema.refreshTokens.userId, userId))
  }
}
