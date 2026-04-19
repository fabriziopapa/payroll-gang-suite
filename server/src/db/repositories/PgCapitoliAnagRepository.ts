// ============================================================
// PAYROLL GANG SUITE — PgCapitoliAnagRepository
// Capitoli standalone da Capitoli_STAMPA.xml / Capitoli_Locali_STAMPA.xml
// ============================================================

import { eq, and, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import type {
  ICapitoliAnagRepository,
  CapitoloAnagInput,
  CapitoloAnagRow,
  CapitoloSorgente,
  ImportResult,
} from '../IRepository.js'

type DB = PostgresJsDatabase<typeof schema>

const BATCH_SIZE = 500

export class PgCapitoliAnagRepository implements ICapitoliAnagRepository {
  constructor(private readonly db: DB) {}

  async findAll(sorgente?: CapitoloSorgente): Promise<CapitoloAnagRow[]> {
    const rows = sorgente
      ? await this.db
          .select()
          .from(schema.capitoliAnag)
          .where(eq(schema.capitoliAnag.sorgente, sorgente))
          .orderBy(schema.capitoliAnag.codice)
      : await this.db
          .select()
          .from(schema.capitoliAnag)
          .orderBy(schema.capitoliAnag.sorgente, schema.capitoliAnag.codice)

    return rows.map(r => ({
      id:          r.id,
      codice:      r.codice,
      sorgente:    r.sorgente,
      descrizione: r.descrizione ?? null,
      breve:       r.breve       ?? null,
      tipoLiq:     r.tipoLiq     ?? null,
      fCapitolo:   r.fCapitolo   ?? null,
      dataIns:     r.dataIns     ?? null,
      dataMod:     r.dataMod     ?? null,
      operatore:   r.operatore   ?? null,
      updatedAt:   r.updatedAt,
    }))
  }

  async findByCodice(codice: string): Promise<CapitoloAnagRow[]> {
    const rows = await this.db
      .select()
      .from(schema.capitoliAnag)
      .where(eq(schema.capitoliAnag.codice, codice))

    return rows.map(r => ({
      id:          r.id,
      codice:      r.codice,
      sorgente:    r.sorgente,
      descrizione: r.descrizione ?? null,
      breve:       r.breve       ?? null,
      tipoLiq:     r.tipoLiq     ?? null,
      fCapitolo:   r.fCapitolo   ?? null,
      dataIns:     r.dataIns     ?? null,
      dataMod:     r.dataMod     ?? null,
      operatore:   r.operatore   ?? null,
      updatedAt:   r.updatedAt,
    }))
  }

  async upsertMany(items: CapitoloAnagInput[]): Promise<ImportResult> {
    const result: ImportResult = {
      inserted:    0,
      updated:     0,
      skipped:     0,
      errors:      [],
      processedAt: new Date(),
    }

    if (items.length === 0) return result

    // Deduplication: mantiene l'ultimo per (codice, sorgente)
    const dedupMap = new Map<string, CapitoloAnagInput>()
    for (const item of items) dedupMap.set(`${item.codice}|${item.sorgente}`, item)
    const uniqueItems = Array.from(dedupMap.values())

    for (let i = 0; i < uniqueItems.length; i += BATCH_SIZE) {
      const batch = uniqueItems.slice(i, i + BATCH_SIZE)

      const returned = await this.db
        .insert(schema.capitoliAnag)
        .values(batch.map(item => ({
          codice:      item.codice,
          sorgente:    item.sorgente,
          descrizione: item.descrizione ?? null,
          breve:       item.breve       ?? null,
          tipoLiq:     item.tipoLiq     ?? null,
          fCapitolo:   item.fCapitolo   ?? null,
          dataIns:     item.dataIns     ?? null,
          dataMod:     item.dataMod     ?? null,
          operatore:   item.operatore   ?? null,
          updatedAt:   new Date(),
        })))
        .onConflictDoUpdate({
          target:  [schema.capitoliAnag.codice, schema.capitoliAnag.sorgente],
          set: {
            descrizione: sql`EXCLUDED.descrizione`,
            breve:       sql`EXCLUDED.breve`,
            tipoLiq:     sql`EXCLUDED.tipo_liq`,
            fCapitolo:   sql`EXCLUDED.f_capitolo`,
            dataIns:     sql`EXCLUDED.data_ins`,
            dataMod:     sql`EXCLUDED.data_mod`,
            operatore:   sql`EXCLUDED.operatore`,
            updatedAt:   sql`now()`,
          },
          // Aggiorna solo se qualcosa è cambiato
          where: sql`
            ${schema.capitoliAnag.descrizione} IS DISTINCT FROM EXCLUDED.descrizione
            OR ${schema.capitoliAnag.breve}    IS DISTINCT FROM EXCLUDED.breve
            OR ${schema.capitoliAnag.tipoLiq}  IS DISTINCT FROM EXCLUDED.tipo_liq
            OR ${schema.capitoliAnag.fCapitolo} IS DISTINCT FROM EXCLUDED.f_capitolo
            OR ${schema.capitoliAnag.dataMod}  IS DISTINCT FROM EXCLUDED.data_mod
            OR ${schema.capitoliAnag.operatore} IS DISTINCT FROM EXCLUDED.operatore
          `,
        })
        .returning({ id: schema.capitoliAnag.id, createdAt: schema.capitoliAnag.createdAt })

      for (const row of returned) {
        const age = Date.now() - row.createdAt.getTime()
        if (age < 2000) result.inserted++
        else result.updated++
      }
      result.skipped += batch.length - returned.length
    }

    // Aggiorna last_import per la sorgente specifica
    if (uniqueItems.length > 0) {
      const sorgente = uniqueItems[0]!.sorgente
      const chiave   = `last_import_capitoli_${sorgente}`
      await this.db
        .insert(schema.appSettings)
        .values({
          chiave,
          valore:    new Date().toISOString() as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.appSettings.chiave,
          set: {
            valore:    new Date().toISOString() as unknown as Record<string, unknown>,
            updatedAt: new Date(),
          },
        })
    }

    return result
  }

  async getLastImportDates(): Promise<{ standard: Date | null; locali: Date | null }> {
    const rows = await this.db
      .select({ chiave: schema.appSettings.chiave, valore: schema.appSettings.valore })
      .from(schema.appSettings)
      .where(
        and(
          eq(schema.appSettings.chiave, 'last_import_capitoli_standard'),
        ),
      )

    const rows2 = await this.db
      .select({ chiave: schema.appSettings.chiave, valore: schema.appSettings.valore })
      .from(schema.appSettings)
      .where(
        eq(schema.appSettings.chiave, 'last_import_capitoli_locali'),
      )

    const parseDate = (val: unknown): Date | null => {
      if (!val || val === 'null') return null
      try { return new Date(val as string) } catch { return null }
    }

    return {
      standard: parseDate(rows[0]?.valore),
      locali:   parseDate(rows2[0]?.valore),
    }
  }
}
