// ============================================================
// PAYROLL GANG SUITE — PgBozzeRepository
// dati JSONB: serializzazione completa liquidazioni + nominativi
// ============================================================

import { eq, and } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import type { IBozzeRepository, BozzaRow, BozzaSummaryRow, BozzaInput } from '../IRepository.js'

type DB = PostgresJsDatabase<typeof schema>

/** Colonne selezionate con dati JSONB — usato solo da findById */
const SEL = {
  id:                schema.bozze.id,
  nome:              schema.bozze.nome,
  stato:             schema.bozze.stato,
  protocolloDisplay: schema.bozze.protocolloDisplay,
  dati:              schema.bozze.dati,
  createdBy:         schema.bozze.createdBy,
  createdAt:         schema.bozze.createdAt,
  updatedAt:         schema.bozze.updatedAt,
  createdByUsername: schema.users.username,
}

/** FIX H-1: colonne senza dati JSONB — usato dalla lista (GET /bozze) */
const SEL_SUMMARY = {
  id:                schema.bozze.id,
  nome:              schema.bozze.nome,
  stato:             schema.bozze.stato,
  protocolloDisplay: schema.bozze.protocolloDisplay,
  createdBy:         schema.bozze.createdBy,
  createdAt:         schema.bozze.createdAt,
  updatedAt:         schema.bozze.updatedAt,
  createdByUsername: schema.users.username,
}

export class PgBozzeRepository implements IBozzeRepository {
  constructor(private readonly db: DB) {}

  async findAll(userId?: string): Promise<BozzaRow[]> {
    const base = this.db
      .select(SEL)
      .from(schema.bozze)
      .leftJoin(schema.users, eq(schema.bozze.createdBy, schema.users.id))

    const rows = userId
      ? await base.where(eq(schema.bozze.createdBy, userId)).orderBy(schema.bozze.updatedAt)
      : await base.orderBy(schema.bozze.updatedAt)

    return rows.map(toRow)
  }

  /**
   * FIX H-1: versione lista senza il campo `dati` JSONB (20 KB avg per riga).
   * Usata dal GET /bozze — evita di trasferire 5 MB ad ogni apertura dashboard.
   * `findById()` continua a restituire la bozza completa (con `dati`).
   */
  async findAllSummary(userId?: string): Promise<BozzaSummaryRow[]> {
    const base = this.db
      .select(SEL_SUMMARY)
      .from(schema.bozze)
      .leftJoin(schema.users, eq(schema.bozze.createdBy, schema.users.id))

    const rows = userId
      ? await base.where(eq(schema.bozze.createdBy, userId)).orderBy(schema.bozze.updatedAt)
      : await base.orderBy(schema.bozze.updatedAt)

    return rows.map(toSummaryRow)
  }

  async findById(id: string): Promise<BozzaRow | null> {
    const [row] = await this.db
      .select(SEL)
      .from(schema.bozze)
      .leftJoin(schema.users, eq(schema.bozze.createdBy, schema.users.id))
      .where(eq(schema.bozze.id, id))
      .limit(1)

    return row ? toRow(row) : null
  }

  async create(data: BozzaInput): Promise<BozzaRow> {
    const [ins] = await this.db
      .insert(schema.bozze)
      .values({
        nome:              data.nome,
        stato:             data.stato             ?? 'bozza',
        protocolloDisplay: data.protocolloDisplay  ?? null,
        dati:              data.dati               as Record<string, unknown>,
        createdBy:         data.createdBy          ?? null,
      })
      .returning({ id: schema.bozze.id })

    if (!ins) throw new Error('INSERT bozze fallito')
    return (await this.findById(ins.id))!
  }

  async update(id: string, data: Partial<BozzaInput>): Promise<BozzaRow> {
    const set: Partial<typeof schema.bozze.$inferInsert> = {
      updatedAt: new Date(),
    }
    if (data.nome              !== undefined) set.nome              = data.nome
    if (data.protocolloDisplay !== undefined) set.protocolloDisplay = data.protocolloDisplay
    if (data.dati              !== undefined) set.dati              = data.dati as Record<string, unknown>

    const [upd] = await this.db
      .update(schema.bozze)
      .set(set)
      .where(and(
        eq(schema.bozze.id,    id),
        eq(schema.bozze.stato, 'bozza'),   // non si può modificare un archivio
      ))
      .returning({ id: schema.bozze.id })

    if (!upd) throw new Error(`Bozza ${id} non trovata o già archiviata`)
    return (await this.findById(upd.id))!
  }

  async archive(id: string): Promise<BozzaRow> {
    const [upd] = await this.db
      .update(schema.bozze)
      .set({ stato: 'archiviata', updatedAt: new Date() })
      .where(and(
        eq(schema.bozze.id,    id),
        eq(schema.bozze.stato, 'bozza'),
      ))
      .returning({ id: schema.bozze.id })

    if (!upd) throw new Error(`Bozza ${id} non trovata o già archiviata`)
    return (await this.findById(upd.id))!
  }

  async restore(id: string): Promise<BozzaRow> {
    const [upd] = await this.db
      .update(schema.bozze)
      .set({ stato: 'bozza', updatedAt: new Date() })
      .where(and(
        eq(schema.bozze.id,    id),
        eq(schema.bozze.stato, 'archiviata'),
      ))
      .returning({ id: schema.bozze.id })

    if (!upd) throw new Error(`Bozza ${id} non trovata o non archiviata`)
    return (await this.findById(upd.id))!
  }

  async delete(id: string): Promise<void> {
    await this.db
      .delete(schema.bozze)
      .where(eq(schema.bozze.id, id))
  }
}

// ------------------------------------------------------------

type RowShape = {
  id: string; nome: string; stato: string
  protocolloDisplay: string | null; dati: unknown
  createdBy: string | null; createdAt: Date; updatedAt: Date
  createdByUsername: string | null
}

function toRow(r: RowShape): BozzaRow {
  return {
    id:                r.id,
    nome:              r.nome,
    stato:             r.stato as 'bozza' | 'archiviata',
    protocolloDisplay: r.protocolloDisplay ?? null,
    dati:              r.dati,
    createdBy:         r.createdBy         ?? null,
    createdByUsername: r.createdByUsername  ?? null,
    createdAt:         r.createdAt,
    updatedAt:         r.updatedAt,
  }
}

// FIX H-1: mapper per la lista senza dati JSONB
type SummaryRowShape = {
  id: string; nome: string; stato: string
  protocolloDisplay: string | null
  createdBy: string | null; createdAt: Date; updatedAt: Date
  createdByUsername: string | null
}

function toSummaryRow(r: SummaryRowShape): BozzaSummaryRow {
  return {
    id:                r.id,
    nome:              r.nome,
    stato:             r.stato as 'bozza' | 'archiviata',
    protocolloDisplay: r.protocolloDisplay ?? null,
    createdBy:         r.createdBy         ?? null,
    createdByUsername: r.createdByUsername  ?? null,
    createdAt:         r.createdAt,
    updatedAt:         r.updatedAt,
  }
}
