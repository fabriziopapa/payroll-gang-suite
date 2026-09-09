// ============================================================
// PAYROLL GANG SUITE — PgTemplatiCertificatoRepository
// CRUD template-come-dato (strutturaJson editabile da UI).
// ============================================================

import { eq, desc } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import type {
  ITemplatiCertificatoRepository, TemplateRow, TemplateInput,
} from '../IRepository.js'

type DB = PostgresJsDatabase<typeof schema>

export class PgTemplatiCertificatoRepository implements ITemplatiCertificatoRepository {
  constructor(private readonly db: DB) {}

  async findAll(soloAttivi = false): Promise<TemplateRow[]> {
    const base = this.db.select().from(schema.templatiCertificato)
    const rows = soloAttivi
      ? await base.where(eq(schema.templatiCertificato.attivo, true)).orderBy(desc(schema.templatiCertificato.updatedAt))
      : await base.orderBy(desc(schema.templatiCertificato.updatedAt))
    return rows.map(toRow)
  }

  async findById(id: string): Promise<TemplateRow | null> {
    const [row] = await this.db
      .select().from(schema.templatiCertificato)
      .where(eq(schema.templatiCertificato.id, id)).limit(1)
    return row ? toRow(row) : null
  }

  async create(data: TemplateInput): Promise<TemplateRow> {
    const [ins] = await this.db
      .insert(schema.templatiCertificato)
      .values({
        nome:          data.nome,
        strutturaJson: data.strutturaJson as Record<string, unknown>,
        attivo:        data.attivo ?? true,
      })
      .returning({ id: schema.templatiCertificato.id })
    if (!ins) throw new Error('INSERT template fallito')
    return (await this.findById(ins.id))!
  }

  async update(id: string, data: Partial<TemplateInput>): Promise<TemplateRow> {
    const set: Partial<typeof schema.templatiCertificato.$inferInsert> = { updatedAt: new Date() }
    if (data.nome          !== undefined) set.nome          = data.nome
    if (data.strutturaJson !== undefined) set.strutturaJson = data.strutturaJson as Record<string, unknown>
    if (data.attivo        !== undefined) set.attivo        = data.attivo

    const [upd] = await this.db
      .update(schema.templatiCertificato).set(set)
      .where(eq(schema.templatiCertificato.id, id))
      .returning({ id: schema.templatiCertificato.id })
    if (!upd) throw new Error(`Template ${id} non trovato`)
    return (await this.findById(upd.id))!
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(schema.templatiCertificato).where(eq(schema.templatiCertificato.id, id))
  }
}

type Shape = typeof schema.templatiCertificato.$inferSelect
function toRow(r: Shape): TemplateRow {
  return {
    id: r.id, nome: r.nome, strutturaJson: r.strutturaJson,
    attivo: r.attivo, createdAt: r.createdAt, updatedAt: r.updatedAt,
  }
}
