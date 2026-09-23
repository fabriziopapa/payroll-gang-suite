// ============================================================
// PAYROLL GANG SUITE — PgPaesiContoRepository
//
// L'elenco dei paesi SEPA / EXTRA_UE (paesi_conto, migrazione 0019).
// Un cambio non sovrascrive mai: chiude la riga in vigore e ne apre una
// nuova, dentro una transazione. Che un paese non possa essere insieme
// SEPA ed EXTRA_UE lo garantisce l'indice unico parziale sul database.
// ============================================================

import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import type { IPaesiContoRepository, PaeseContoRow, EsitoCambioPaese } from '../IRepository.js'

type DB = PostgresJsDatabase<typeof schema>
type Riga = typeof schema.paesiConto.$inferSelect

export class PgPaesiContoRepository implements IPaesiContoRepository {
  constructor(private readonly db: DB) {}

  async tutte(): Promise<PaeseContoRow[]> {
    const rows = await this.db.select().from(schema.paesiConto)
      .orderBy(asc(schema.paesiConto.codice), asc(schema.paesiConto.validoDal))
    return rows.map(toRow)
  }

  async cambia(p: {
    codice: string; area: 'SEPA' | 'EXTRA_UE'; validoDal: string
    fonte: string; nota: string | null; userId: string | null
  }): Promise<EsitoCambioPaese> {
    return this.db.transaction(async tx => {
      // FOR UPDATE: due amministratori che cambiano lo stesso paese insieme
      // non possono aprire due righe in vigore (lo impedirebbe comunque
      // l'indice unico, ma cosi' il secondo vede lo stato del primo).
      const [inVigore] = await tx.select().from(schema.paesiConto)
        .where(and(eq(schema.paesiConto.codice, p.codice), isNull(schema.paesiConto.validoAl)))
        .for('update')

      if (inVigore && inVigore.area === p.area) return { esito: 'invariato' as const }
      if (inVigore && p.validoDal <= inVigore.validoDal) {
        return { esito: 'data-non-valida' as const, validoDalInVigore: inVigore.validoDal }
      }

      let chiusa: PaeseContoRow | null = null
      if (inVigore) {
        const [r] = await tx.update(schema.paesiConto)
          .set({ validoAl: sql`${p.validoDal}::date - 1` })
          .where(eq(schema.paesiConto.id, inVigore.id))
          .returning()
        chiusa = r ? toRow(r) : null
      }

      const [nuova] = await tx.insert(schema.paesiConto).values({
        codice: p.codice, area: p.area, validoDal: p.validoDal,
        fonte: p.fonte, nota: p.nota, createdBy: p.userId,
      }).returning()

      return { esito: 'fatto' as const, chiusa, nuova: toRow(nuova!) }
    })
  }
}

function toRow(r: Riga): PaeseContoRow {
  return {
    id:        r.id,
    codice:    r.codice,
    area:      r.area === 'SEPA' ? 'SEPA' : 'EXTRA_UE',
    validoDal: r.validoDal,
    validoAl:  r.validoAl ?? null,
    fonte:     r.fonte,
    nota:      r.nota ?? null,
    createdBy: r.createdBy ?? null,
    createdAt: r.createdAt,
  }
}
