// ============================================================
// PAYROLL GANG SUITE — PgFamiliariRepository
// Cache nucleo familiare da CINECA CSA-WS (figli per tag cedolino WE).
// replaceForMatricola = snapshot atomico (delete + insert in transazione).
// ============================================================

import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import type {
  IFamiliariRepository,
  FamiliareCacheRow,
  FamiliareCacheInput,
} from '../IRepository.js'

type DB = PostgresJsDatabase<typeof schema>

export class PgFamiliariRepository implements IFamiliariRepository {
  constructor(private readonly db: DB) {}

  async findByMatricola(matricola: string): Promise<FamiliareCacheRow[]> {
    const rows = await this.db
      .select()
      .from(schema.familiariCache)
      .where(eq(schema.familiariCache.matricola, matricola))
    return rows.map(r => ({
      idAb:              r.idAb ?? null,
      matricola:         r.matricola ?? null,
      codFisc:           r.codFisc,
      cognome:           r.cognome ?? null,
      nome:              r.nome ?? null,
      sesso:             r.sesso ?? null,
      rapportoParentela: r.rapportoParentela,
      dataNasc:          r.dataNasc ?? null,
      aggiornatoAt:      r.aggiornatoAt,
    }))
  }

  async replaceForMatricola(matricola: string, rows: FamiliareCacheInput[]): Promise<void> {
    await this.db.transaction(async tx => {
      await tx.delete(schema.familiariCache).where(eq(schema.familiariCache.matricola, matricola))
      if (rows.length === 0) return
      await tx.insert(schema.familiariCache).values(rows.map(r => ({
        idAb:              r.idAb ?? null,
        matricola:         r.matricola,
        codFisc:           r.codFisc,
        cognome:           r.cognome ?? null,
        nome:              r.nome ?? null,
        sesso:             r.sesso ?? null,
        rapportoParentela: r.rapportoParentela,
        dataNasc:          r.dataNasc ?? null,
        aggiornatoAt:      new Date(),
      })))
    })
  }
}
