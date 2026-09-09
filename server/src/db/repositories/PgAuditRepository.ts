// ============================================================
// PAYROLL GANG SUITE — PgAuditRepository
// Tabella append-only: solo INSERT consentito (REVOKE a livello DB)
// ============================================================

import { desc, eq, and, or, ilike, gte, lte, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import type { IAuditRepository, AuditInput, AuditEntry, AuditEntryWithUser, AuditQueryOpts } from '../IRepository.js'

type DB = PostgresJsDatabase<typeof schema>

export class PgAuditRepository implements IAuditRepository {
  constructor(private readonly db: DB) {}

  async log(entry: AuditInput): Promise<void> {
    await this.db.insert(schema.auditLog).values({
      userId:    entry.userId   ?? null,
      azione:    entry.azione,
      entita:    entry.entita   ?? null,
      entitaId:  entry.entitaId ?? null,
      dettagli:  entry.dettagli ?? null,
      ip:        entry.ip       ?? null,
      userAgent: entry.userAgent ?? null,
    })
  }

  async findRecent(limit = 100): Promise<AuditEntry[]> {
    const rows = await this.db
      .select()
      .from(schema.auditLog)
      .orderBy(desc(schema.auditLog.timestamp))
      .limit(limit)

    return rows.map(r => ({
      id:        r.id,
      userId:    r.userId    ?? null,
      azione:    r.azione,
      entita:    r.entita    ?? null,
      entitaId:  r.entitaId  ?? null,
      dettagli:  r.dettagli  ?? null,
      ip:        r.ip        ?? null,
      timestamp: r.timestamp,
    }))
  }

  async query(opts: AuditQueryOpts): Promise<{ rows: AuditEntryWithUser[]; total: number }> {
    const conds = []
    if (opts.azione) conds.push(eq(schema.auditLog.azione, opts.azione))
    if (opts.userId) conds.push(eq(schema.auditLog.userId, opts.userId))
    if (opts.from)   conds.push(gte(schema.auditLog.timestamp, new Date(opts.from)))
    if (opts.to)     conds.push(lte(schema.auditLog.timestamp, new Date(opts.to)))
    if (opts.search && opts.search.trim()) {
      const q = `%${opts.search.trim()}%`
      conds.push(or(
        ilike(schema.auditLog.azione,   q),
        ilike(schema.auditLog.entita,   q),
        ilike(schema.auditLog.entitaId, q),
        ilike(schema.auditLog.ip,       q),
        ilike(schema.users.username,    q),
      ))
    }
    const where = conds.length > 0 ? and(...conds) : undefined

    const rows = await this.db
      .select({
        id:        schema.auditLog.id,
        userId:    schema.auditLog.userId,
        username:  schema.users.username,
        azione:    schema.auditLog.azione,
        entita:    schema.auditLog.entita,
        entitaId:  schema.auditLog.entitaId,
        dettagli:  schema.auditLog.dettagli,
        ip:        schema.auditLog.ip,
        userAgent: schema.auditLog.userAgent,
        timestamp: schema.auditLog.timestamp,
      })
      .from(schema.auditLog)
      .leftJoin(schema.users, eq(schema.auditLog.userId, schema.users.id))
      .where(where)
      .orderBy(desc(schema.auditLog.timestamp))
      .limit(opts.limit)
      .offset(opts.offset)

    const [{ total }] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.auditLog)
      .leftJoin(schema.users, eq(schema.auditLog.userId, schema.users.id))
      .where(where)

    return {
      total: total ?? 0,
      rows: rows.map(r => ({
        id:        r.id,
        userId:    r.userId    ?? null,
        username:  r.username  ?? null,
        azione:    r.azione,
        entita:    r.entita    ?? null,
        entitaId:  r.entitaId  ?? null,
        dettagli:  r.dettagli  ?? null,
        ip:        r.ip        ?? null,
        userAgent: r.userAgent ?? null,
        timestamp: r.timestamp,
      })),
    }
  }

  async distinctAzioni(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ azione: schema.auditLog.azione })
      .from(schema.auditLog)
      .orderBy(schema.auditLog.azione)
    return rows.map(r => r.azione)
  }
}
