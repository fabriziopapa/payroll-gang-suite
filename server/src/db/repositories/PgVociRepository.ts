// ============================================================
// PAYROLL GANG SUITE — PgVociRepository
// Upsert su (codice, data_in) — capitoli gestiti in cascata
// ============================================================

import { eq, and, lte, gte, or, inArray, sql, type SQL } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import type {
  IVociRepository,
  VoceInput,
  VoceRow,
  ImportResult,
} from '../IRepository.js'

type DB = PostgresJsDatabase<typeof schema>

const BATCH_SIZE = 200

export class PgVociRepository implements IVociRepository {
  constructor(private readonly db: DB) {}

  async findAll(): Promise<VoceRow[]> {
    return this.#queryWithCapitoli()
  }

  async findByCodice(codice: string): Promise<VoceRow | null> {
    const rows = await this.#queryWithCapitoli(eq(schema.voci.codice, codice))
    return rows[0] ?? null
  }

  /**
   * Restituisce le voci attive alla data di riferimento.
   * Una voce è attiva se dataIn <= data <= dataFin.
   * dataFin "22220202" = illimitata.
   */
  async findActive(dataRiferimento?: Date): Promise<VoceRow[]> {
    const ref = dataRiferimento ?? new Date()
    // Formato YYYYMMDD per confronto stringa (funziona perché il formato è ordinabile)
    const refStr = ref.toISOString().slice(0, 10).replace(/-/g, '')

    return this.#queryWithCapitoli(
      and(
        lte(schema.voci.dataIn,  refStr),
        or(
          gte(schema.voci.dataFin, refStr),
          eq(schema.voci.dataFin,  '22220202'),
        ),
      ),
    )
  }

  async upsertMany(items: VoceInput[]): Promise<ImportResult> {
    const result: ImportResult = {
      inserted:    0,
      updated:     0,
      skipped:     0,
      errors:      [],
      processedAt: new Date(),
    }

    if (items.length === 0) return result

    // FIX H-2: un'unica transazione esterna — un bulk upsert per tutte le voci,
    // poi un bulk upsert per tutti i capitoli. Riduce N transazioni a 2 query.
    await this.db.transaction(async tx => {
      // ── Fase 1: bulk upsert di tutte le voci in batch ──────────────────────
      const allVoceRows: Array<{ id: number; createdAt: Date; codice: string; dataIn: string }> = []

      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE)

        const rows = await tx
          .insert(schema.voci)
          .values(batch.map(item => ({
            codice:      item.codice,
            descrizione: item.descrizione,
            dataIn:      item.dataIn,
            dataFin:     item.dataFin,
            tipo:        item.tipo        ?? null,
            personale:   item.personale   ?? null,
            immissione:  item.immissione  ?? null,
            conguaglio:  item.conguaglio  ?? null,
            updatedAt:   new Date(),
          })))
          .onConflictDoUpdate({
            target: [schema.voci.codice, schema.voci.dataIn],
            set: {
              descrizione: sql`EXCLUDED.descrizione`,
              dataFin:     sql`EXCLUDED.data_fin`,
              tipo:        sql`EXCLUDED.tipo`,
              personale:   sql`EXCLUDED.personale`,
              immissione:  sql`EXCLUDED.immissione`,
              conguaglio:  sql`EXCLUDED.conguaglio`,
              updatedAt:   sql`now()`,
            },
            where: sql`
              ${schema.voci.descrizione} IS DISTINCT FROM EXCLUDED.descrizione
              OR ${schema.voci.dataFin}  IS DISTINCT FROM EXCLUDED.data_fin
              OR ${schema.voci.tipo}     IS DISTINCT FROM EXCLUDED.tipo
              OR ${schema.voci.personale} IS DISTINCT FROM EXCLUDED.personale
              OR ${schema.voci.immissione} IS DISTINCT FROM EXCLUDED.immissione
              OR ${schema.voci.conguaglio} IS DISTINCT FROM EXCLUDED.conguaglio
            `,
          })
          .returning({ id: schema.voci.id, createdAt: schema.voci.createdAt, codice: schema.voci.codice, dataIn: schema.voci.dataIn })

        const now = Date.now()
        rows.forEach(r => {
          const age = now - r.createdAt.getTime()
          if (age < 2000) result.inserted++
          else result.updated++
        })
        // Righe non restituite = già presenti e invariate
        result.skipped += batch.length - rows.length

        allVoceRows.push(...rows)
      }

      // ── Fase 2: bulk upsert di tutti i capitoli in un unico batch ───────────
      // Mappa (codice|dataIn) → voce_id per collegare capitoli alle voci
      const voceIdMap = new Map<string, number>()
      for (const r of allVoceRows) {
        voceIdMap.set(`${r.codice}|${r.dataIn}`, r.id)
      }

      // Per le voci skippate (non restituite dall'upsert), recupera gli id esistenti
      // usando i valori di codice+dataIn degli item originali non trovati in allVoceRows
      const missingKeys = items
        .filter(item => !voceIdMap.has(`${item.codice}|${item.dataIn}`))
        .map(item => `${item.codice}|${item.dataIn}`)

      if (missingKeys.length > 0) {
        // Recupera gli id delle voci già presenti non restituite dall'upsert
        const existingRows = await tx
          .select({ id: schema.voci.id, codice: schema.voci.codice, dataIn: schema.voci.dataIn })
          .from(schema.voci)
          .where(inArray(
            sql`(${schema.voci.codice} || '|' || ${schema.voci.dataIn})`,
            missingKeys,
          ))
        for (const r of existingRows) {
          voceIdMap.set(`${r.codice}|${r.dataIn}`, r.id)
        }
      }

      // Raccoglie tutti i capitoli con voce_id risolto
      const allCapitoli: Array<{ voceId: number; codice: string; descrizione: string | null }> = []
      for (const item of items) {
        const voceId = voceIdMap.get(`${item.codice}|${item.dataIn}`)
        if (voceId === undefined) continue  // voce non trovata: skip sicuro
        for (const c of item.capitoli) {
          allCapitoli.push({
            voceId,
            codice:      c.codice,
            descrizione: c.descrizione ?? null,
          })
        }
      }

      if (allCapitoli.length > 0) {
        for (let i = 0; i < allCapitoli.length; i += BATCH_SIZE) {
          await tx
            .insert(schema.capitoli)
            .values(allCapitoli.slice(i, i + BATCH_SIZE))
            .onConflictDoUpdate({
              target: [schema.capitoli.voceId, schema.capitoli.codice],
              set: { descrizione: sql`EXCLUDED.descrizione` },
              where: sql`${schema.capitoli.descrizione} IS DISTINCT FROM EXCLUDED.descrizione`,
            })
        }
      }
    })

    // Aggiorna last_import_voci
    await this.db
      .insert(schema.appSettings)
      .values({
        chiave:    'last_import_voci',
        valore:    new Date().toISOString() as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.appSettings.chiave,
        set:    { valore: new Date().toISOString() as unknown as Record<string, unknown>, updatedAt: new Date() },
      })

    return result
  }

  async getLastImportDate(): Promise<Date | null> {
    const [row] = await this.db
      .select({ valore: schema.appSettings.valore })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.chiave, 'last_import_voci'))
      .limit(1)

    if (!row || row.valore === null || row.valore === 'null') return null
    return new Date(row.valore as string)
  }

  // ------------------------------------------------------------
  // Query helper: voci + capitoli aggregati
  // ------------------------------------------------------------

  async #queryWithCapitoli(condition?: SQL): Promise<VoceRow[]> {
    const voceRows = await (condition
      ? this.db.select().from(schema.voci).where(condition).orderBy(schema.voci.codice, schema.voci.dataIn)
      : this.db.select().from(schema.voci).orderBy(schema.voci.codice, schema.voci.dataIn)
    )

    if (voceRows.length === 0) return []

    const voceIds = voceRows.map(v => v.id)

    // Carica tutti i capitoli per le voci trovate in una sola query
    const capRows = await this.db
      .select()
      .from(schema.capitoli)
      .where(
        voceIds.length === 1
          ? eq(schema.capitoli.voceId, voceIds[0]!)
          : inArray(schema.capitoli.voceId, voceIds),
      )

    // Raggruppa capitoli per voce_id
    const capByVoce = new Map<number, Array<{ codice: string; descrizione: string | null }>>()
    for (const cap of capRows) {
      const list = capByVoce.get(cap.voceId) ?? []
      list.push({ codice: cap.codice, descrizione: cap.descrizione ?? null })
      capByVoce.set(cap.voceId, list)
    }

    return voceRows.map(v => ({
      id:          v.id,
      codice:      v.codice,
      descrizione: v.descrizione,
      dataIn:      v.dataIn,
      dataFin:     v.dataFin,
      tipo:        v.tipo ?? null,
      capitoli:    capByVoce.get(v.id) ?? [],
    }))
  }
}
