// ============================================================
// PAYROLL GANG SUITE — PgVociConfigRepository
// Config manuale per voce (parti, scorporo, tag riferimento cedolino).
// Tabella separata da `voci` → sopravvive ai reimport XML.
// ============================================================

import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import type {
  IVociConfigRepository,
  VoceConfigInput,
  VoceConfigRow,
  TipoScorporoConfig,
  TagDefaultConfig,
} from '../IRepository.js'

type DB = PostgresJsDatabase<typeof schema>

function toRow(r: schema.VoceConfig): VoceConfigRow {
  return {
    codice:       r.codice,
    parti:        r.parti ?? null,
    tipoScorporo: (r.tipoScorporo as TipoScorporoConfig | null) ?? null,
    tagDefault:   (r.tagDefault as TagDefaultConfig | null) ?? null,
    autoFiglio:   r.autoFiglio,
    updatedAt:    r.updatedAt,
  }
}

export class PgVociConfigRepository implements IVociConfigRepository {
  constructor(private readonly db: DB) {}

  async findAll(): Promise<VoceConfigRow[]> {
    const rows = await this.db.select().from(schema.vociConfig).orderBy(schema.vociConfig.codice)
    return rows.map(toRow)
  }

  async findByCodice(codice: string): Promise<VoceConfigRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.vociConfig)
      .where(eq(schema.vociConfig.codice, codice))
      .limit(1)
    return row ? toRow(row) : null
  }

  async upsert(input: VoceConfigInput): Promise<VoceConfigRow> {
    const values = {
      codice:       input.codice,
      parti:        input.parti        ?? null,
      tipoScorporo: input.tipoScorporo ?? null,
      tagDefault:   input.tagDefault   ?? null,
      autoFiglio:   input.autoFiglio   ?? false,
      updatedAt:    new Date(),
    }
    const [row] = await this.db
      .insert(schema.vociConfig)
      .values(values)
      .onConflictDoUpdate({
        target: schema.vociConfig.codice,
        set: {
          parti:        values.parti,
          tipoScorporo: values.tipoScorporo,
          tagDefault:   values.tagDefault,
          autoFiglio:   values.autoFiglio,
          updatedAt:    values.updatedAt,
        },
      })
      .returning()
    return toRow(row!)
  }

  async delete(codice: string): Promise<void> {
    await this.db.delete(schema.vociConfig).where(eq(schema.vociConfig.codice, codice))
  }
}
