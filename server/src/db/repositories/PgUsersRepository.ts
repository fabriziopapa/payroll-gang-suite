// ============================================================
// PAYROLL GANG SUITE — PgUsersRepository
// ============================================================

import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import type { IUsersRepository, UserRow, ActivationUserRow } from '../IRepository.js'

type DB = PostgresJsDatabase<typeof schema>

export class PgUsersRepository implements IUsersRepository {
  constructor(private readonly db: DB) {}

  async findAll(): Promise<UserRow[]> {
    const rows = await this.db
      .select({
        id:           schema.users.id,
        username:     schema.users.username,
        isAdmin:      schema.users.isAdmin,
        isActive:     schema.users.isActive,
        totpVerified: schema.users.totpVerified,
        createdAt:    schema.users.createdAt,
        lastLoginAt:  schema.users.lastLoginAt,
      })
      .from(schema.users)
      .orderBy(schema.users.createdAt)

    return rows.map(toUserRow)
  }

  async findById(id: string): Promise<UserRow | null> {
    const [row] = await this.db
      .select({
        id:           schema.users.id,
        username:     schema.users.username,
        isAdmin:      schema.users.isAdmin,
        isActive:     schema.users.isActive,
        totpVerified: schema.users.totpVerified,
        createdAt:    schema.users.createdAt,
        lastLoginAt:  schema.users.lastLoginAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1)

    return row ? toUserRow(row) : null
  }

  async findByUsername(username: string): Promise<(UserRow & {
    totpSecret:   string
    lastOtpToken: string | null
  }) | null> {
    const [row] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, username))
      .limit(1)

    if (!row) return null

    return {
      ...toUserRow(row),
      totpSecret:   row.totpSecret,
      lastOtpToken: row.lastOtpToken ?? null,
    }
  }

  async create(data: {
    username:   string
    totpSecret: string
    isAdmin:    boolean
  }): Promise<UserRow> {
    const [row] = await this.db
      .insert(schema.users)
      .values({
        username:   data.username,
        totpSecret: data.totpSecret,
        isAdmin:    data.isAdmin,
        isActive:   false,
        totpVerified: false,
      })
      .returning({
        id:           schema.users.id,
        username:     schema.users.username,
        isAdmin:      schema.users.isAdmin,
        isActive:     schema.users.isActive,
        totpVerified: schema.users.totpVerified,
        createdAt:    schema.users.createdAt,
        lastLoginAt:  schema.users.lastLoginAt,
      })

    if (!row) throw new Error('INSERT users fallito')
    return toUserRow(row)
  }

  async setTotpVerified(id: string): Promise<void> {
    await this.db
      .update(schema.users)
      .set({ totpVerified: true, isActive: true })
      .where(eq(schema.users.id, id))
  }

  async updateLastLogin(id: string): Promise<void> {
    await this.db
      .update(schema.users)
      .set({ lastLoginAt: new Date() })
      .where(eq(schema.users.id, id))
  }

  async updateLastOtpToken(id: string, token: string): Promise<void> {
    await this.db
      .update(schema.users)
      .set({ lastOtpToken: token })
      .where(eq(schema.users.id, id))
  }

  async setActive(id: string, active: boolean): Promise<void> {
    await this.db
      .update(schema.users)
      .set({ isActive: active })
      .where(eq(schema.users.id, id))
  }

  async delete(id: string): Promise<void> {
    await this.db
      .delete(schema.users)
      .where(eq(schema.users.id, id))
  }

  async updateTotpSecret(id: string, totpSecret: string): Promise<void> {
    await this.db
      .update(schema.users)
      .set({ totpSecret, totpVerified: false, isActive: false })
      .where(eq(schema.users.id, id))
  }

  // ── FIX #4: Activation token con scadenza ──────────────────

  async findByActivationTokenHash(tokenHash: string): Promise<ActivationUserRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.activationTokenHash, tokenHash))
      .limit(1)

    if (!row) return null

    return {
      ...toUserRow(row),
      totpSecret:          row.totpSecret,
      lastOtpToken:        row.lastOtpToken ?? null,
      activationExpiresAt: row.activationExpiresAt ?? null,
    }
  }

  async setActivationToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.db
      .update(schema.users)
      .set({ activationTokenHash: tokenHash, activationExpiresAt: expiresAt })
      .where(eq(schema.users.id, userId))
  }

  async clearActivationToken(userId: string): Promise<void> {
    await this.db
      .update(schema.users)
      .set({ activationTokenHash: null, activationExpiresAt: null })
      .where(eq(schema.users.id, userId))
  }

  async setAdmin(id: string, isAdmin: boolean): Promise<void> {
    await this.db
      .update(schema.users)
      .set({ isAdmin })
      .where(eq(schema.users.id, id))
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function toUserRow(row: {
  id:           string
  username:     string
  isAdmin:      boolean
  isActive:     boolean
  totpVerified: boolean
  createdAt:    Date
  lastLoginAt:  Date | null
}): UserRow {
  return {
    id:           row.id,
    username:     row.username,
    isAdmin:      row.isAdmin,
    isActive:     row.isActive,
    totpVerified: row.totpVerified,
    createdAt:    row.createdAt,
    lastLoginAt:  row.lastLoginAt ?? null,
  }
}
