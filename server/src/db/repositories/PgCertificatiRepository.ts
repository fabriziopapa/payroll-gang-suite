// ============================================================
// PAYROLL GANG SUITE — PgCertificatiRepository
// Assegnazione progressivo ATOMICA (fix #3): UPSERT su certificato_progressivi
// dentro una transazione → niente race su MAX(progressivo)+1.
// ============================================================

import { eq, and, desc, or, ilike, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import type {
  ICertificatiRepository, CertificatoInput, CertificatoRow, CertificatoSummaryRow,
} from '../IRepository.js'

type DB = PostgresJsDatabase<typeof schema>

export class PgCertificatiRepository implements ICertificatiRepository {
  constructor(private readonly db: DB) {}

  async create(data: CertificatoInput): Promise<CertificatoRow> {
    const id = await this.db.transaction(async (tx) => {
      // 1) progressivo atomico per anno: INSERT ... ON CONFLICT DO UPDATE +1 RETURNING
      const [seq] = await tx
        .insert(schema.certificatoProgressivi)
        .values({ anno: data.anno, ultimo: 1 })
        .onConflictDoUpdate({
          target: schema.certificatoProgressivi.anno,
          set: { ultimo: sql`${schema.certificatoProgressivi.ultimo} + 1` },
        })
        .returning({ ultimo: schema.certificatoProgressivi.ultimo })

      if (!seq) throw new Error('Assegnazione progressivo fallita')
      const progressivo = seq.ultimo
      const protocollo = `${data.anno}/${String(progressivo).padStart(3, '0')}`

      // 2) insert certificato con il protocollo calcolato in app
      const [ins] = await tx
        .insert(schema.certificati)
        .values({
          anno:           data.anno,
          progressivo,
          protocollo,
          matricola:      data.matricola      ?? null,
          cf:             data.cf             ?? null,
          periodo:        data.periodo        ?? null,
          nominativo:     data.nominativo     ?? null,
          siglaOperatore: data.siglaOperatore,
          dirigente:      data.dirigente      ?? null,
          templateId:     data.templateId     ?? null,
          datiJson:       data.datiJson       as Record<string, unknown>,
          createdBy:      data.createdBy      ?? null,
        })
        .returning({ id: schema.certificati.id })

      if (!ins) throw new Error('INSERT certificato fallito')
      return ins.id
    })

    return (await this.findById(id))!
  }

  async findById(id: string): Promise<CertificatoRow | null> {
    const [row] = await this.db
      .select({ ...SEL, createdByUsername: schema.users.username })
      .from(schema.certificati)
      .leftJoin(schema.users, eq(schema.certificati.createdBy, schema.users.id))
      .where(eq(schema.certificati.id, id))
      .limit(1)
    return row ? toRow(row) : null
  }

  async findAll(anno?: number, search?: string): Promise<CertificatoSummaryRow[]> {
    const year = anno ?? new Date().getFullYear()
    const conds = [eq(schema.certificati.anno, year)]
    if (search && search.trim()) {
      const q = `%${search.trim()}%`
      conds.push(or(
        ilike(schema.certificati.matricola, q),
        ilike(schema.certificati.nominativo, q),
        ilike(schema.certificati.protocollo, q),
      )!)
    }
    const rows = await this.db
      .select({
        id:             schema.certificati.id,
        anno:           schema.certificati.anno,
        progressivo:    schema.certificati.progressivo,
        protocollo:     schema.certificati.protocollo,
        matricola:      schema.certificati.matricola,
        nominativo:     schema.certificati.nominativo,
        periodo:        schema.certificati.periodo,
        siglaOperatore: schema.certificati.siglaOperatore,
        createdByUsername: schema.users.username,
        createdAt:      schema.certificati.createdAt,
      })
      .from(schema.certificati)
      .leftJoin(schema.users, eq(schema.certificati.createdBy, schema.users.id))
      .where(and(...conds))
      .orderBy(desc(schema.certificati.progressivo))
    return rows.map(r => ({ ...r, createdByUsername: r.createdByUsername ?? null }))
  }
}

const SEL = {
  id:             schema.certificati.id,
  anno:           schema.certificati.anno,
  progressivo:    schema.certificati.progressivo,
  protocollo:     schema.certificati.protocollo,
  matricola:      schema.certificati.matricola,
  cf:             schema.certificati.cf,
  periodo:        schema.certificati.periodo,
  nominativo:     schema.certificati.nominativo,
  siglaOperatore: schema.certificati.siglaOperatore,
  dirigente:      schema.certificati.dirigente,
  templateId:     schema.certificati.templateId,
  datiJson:       schema.certificati.datiJson,
  createdBy:      schema.certificati.createdBy,
  createdAt:      schema.certificati.createdAt,
}

type RowShape = {
  id: string; anno: number; progressivo: number; protocollo: string
  matricola: string | null; cf: string | null; periodo: string | null; nominativo: string | null
  siglaOperatore: string; dirigente: string | null; templateId: string | null
  datiJson: unknown; createdBy: string | null; createdByUsername: string | null; createdAt: Date
}

function toRow(r: RowShape): CertificatoRow {
  return {
    id: r.id, anno: r.anno, progressivo: r.progressivo, protocollo: r.protocollo,
    matricola: r.matricola, cf: r.cf, periodo: r.periodo, nominativo: r.nominativo,
    siglaOperatore: r.siglaOperatore, dirigente: r.dirigente, templateId: r.templateId,
    datiJson: r.datiJson, createdBy: r.createdBy,
    createdByUsername: r.createdByUsername ?? null, createdAt: r.createdAt,
  }
}
