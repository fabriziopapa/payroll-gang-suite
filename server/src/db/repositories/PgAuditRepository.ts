// ============================================================
// PAYROLL GANG SUITE — PgAuditRepository
// Tabella append-only: solo INSERT consentito (REVOKE a livello DB)
// ============================================================

import { desc } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import type { IAuditRepository, AuditInput, AuditEntry } from '../IRepository.js'

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
}
