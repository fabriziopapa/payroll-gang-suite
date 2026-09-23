// ============================================================
// PAYROLL GANG SUITE — PgEmolumentiTipiContoRepository
//
// Elaborazioni «Tipi conto» (migrazione 0020): per un mese, dalle testate
// CSA, chi e' pagato su conto IT, SEPA, EXTRA_UE o e' da chiarire.
// Una sola elaborazione confermata per mese/ruolo/comparto: lo garantisce
// l'indice unico parziale, qui tradotto in 'conflitto'.
// ============================================================

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import type {
  ITipiContoRepository, NuoveRigheTipoConto, TipoConto, TipoContoElab, TipoContoRiga,
} from '../IRepository.js'

type DB = PostgresJsDatabase<typeof schema>
type RigaElab = typeof schema.tipiContoElab.$inferSelect

const E = schema.tipiContoElab
const R = schema.tipiContoRighe

const TIPI: TipoConto[] = ['IT', 'SEPA', 'EXTRA_UE', 'DA_CHIARIRE']

function conteggiVuoti(): Record<TipoConto, number> {
  return { IT: 0, SEPA: 0, EXTRA_UE: 0, DA_CHIARIRE: 0 }
}

function toElab(r: RigaElab, conteggi: Record<TipoConto, number>): TipoContoElab {
  return {
    id: r.id, anno: r.anno, mese: r.mese, ruolo: r.ruolo, comparto: r.comparto,
    progrLiquidazione: r.progrLiquidazione,
    stato: r.stato as TipoContoElab['stato'],
    testateLette: r.testateLette, testateLiquid: r.testateLiquid,
    elencoPaesi: r.elencoPaesi, recuperataIl: r.recuperataIl,
    createdBy: r.createdBy, updatedBy: r.updatedBy,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
    conteggi,
  }
}

function isUniqueViolation(e: unknown): boolean {
  const c = (e as { code?: string; cause?: { code?: string } } | null)
  return c?.code === '23505' || c?.cause?.code === '23505'
}

export class PgEmolumentiTipiContoRepository implements ITipiContoRepository {
  constructor(private readonly db: DB) {}

  private async conteggi(ids: string[]): Promise<Map<string, Record<TipoConto, number>>> {
    const out = new Map<string, Record<TipoConto, number>>()
    for (const id of ids) out.set(id, conteggiVuoti())
    if (ids.length === 0) return out
    const rows = await this.db
      .select({ elabId: R.elabId, tipo: R.tipoConto, n: sql<number>`count(*)::int` })
      .from(R)
      .where(sql`${R.elabId} IN (${sql.join(ids.map(i => sql`${i}::uuid`), sql`, `)})`)
      .groupBy(R.elabId, R.tipoConto)
    for (const r of rows) {
      const c = out.get(r.elabId)
      if (c && (TIPI as string[]).includes(r.tipo)) c[r.tipo as TipoConto] = Number(r.n)
    }
    return out
  }

  async elenco(): Promise<TipoContoElab[]> {
    const rows = await this.db.select().from(E)
      .where(isNull(E.archiviataIl))
      .orderBy(desc(E.anno), desc(E.mese), desc(E.createdAt))
    const c = await this.conteggi(rows.map(r => r.id))
    return rows.map(r => toElab(r, c.get(r.id) ?? conteggiVuoti()))
  }

  async leggi(id: string): Promise<{ elab: TipoContoElab; righe: TipoContoRiga[] } | null> {
    const [r] = await this.db.select().from(E).where(and(eq(E.id, id), isNull(E.archiviataIl)))
    if (!r) return null
    const righe = await this.db.select().from(R).where(eq(R.elabId, id)).orderBy(asc(R.matricola))
    const c = conteggiVuoti()
    for (const x of righe) if ((TIPI as string[]).includes(x.tipoConto)) c[x.tipoConto as TipoConto]++
    return {
      elab: toElab(r, c),
      righe: righe.map(x => ({
        matricola: x.matricola, nazIban: x.nazIban, tipoConto: x.tipoConto as TipoConto,
        motivo: x.motivo, progressivi: x.progressivi,
        fonte: x.fonte as TipoContoRiga['fonte'], nota: x.nota,
      })),
    }
  }

  async crea(p: {
    anno: number; mese: number; ruolo: string; comparto: string; progrLiquidazione: string | null
    userId: string | null
  } & NuoveRigheTipoConto): Promise<string> {
    return this.db.transaction(async tx => {
      const [e] = await tx.insert(E).values({
        anno: p.anno, mese: p.mese, ruolo: p.ruolo, comparto: p.comparto,
        progrLiquidazione: p.progrLiquidazione, stato: 'anteprima',
        testateLette: p.testateLette, testateLiquid: p.testateLiquid,
        elencoPaesi: p.elencoPaesi, recuperataIl: new Date(),
        createdBy: p.userId, updatedBy: p.userId,
      }).returning({ id: E.id })
      const id = e!.id
      if (p.righe.length > 0) {
        await tx.insert(R).values(p.righe.map(x => ({ ...x, elabId: id, fonte: 'CSA' })))
      }
      return id
    })
  }

  async riclassifica(id: string, dati: NuoveRigheTipoConto, userId: string | null): Promise<boolean> {
    return this.db.transaction(async tx => {
      const [e] = await tx.select({ id: E.id }).from(E)
        .where(and(eq(E.id, id), isNull(E.archiviataIl))).for('update')
      if (!e) return false
      // Una nazione inserita a mano sopravvive se CSA continua a non darla.
      const manuali = new Map(
        (await tx.select().from(R).where(and(eq(R.elabId, id), eq(R.fonte, 'manuale'))))
          .map(x => [x.matricola, x] as const),
      )
      await tx.delete(R).where(eq(R.elabId, id))
      if (dati.righe.length > 0) {
        await tx.insert(R).values(dati.righe.map(x => {
          const m = manuali.get(x.matricola)
          if (m && x.tipoConto === 'DA_CHIARIRE') {
            return { ...x, elabId: id, nazIban: m.nazIban, tipoConto: m.tipoConto, fonte: 'manuale', nota: m.nota }
          }
          return { ...x, elabId: id, fonte: 'CSA' }
        }))
      }
      await tx.update(E).set({
        stato: 'anteprima', testateLette: dati.testateLette, testateLiquid: dati.testateLiquid,
        elencoPaesi: dati.elencoPaesi, recuperataIl: new Date(),
        updatedBy: userId, updatedAt: new Date(),
      }).where(eq(E.id, id))
      return true
    })
  }

  async conferma(id: string, userId: string | null): Promise<'fatto' | 'conflitto' | 'non-trovata'> {
    try {
      const r = await this.db.update(E)
        .set({ stato: 'confermata', updatedBy: userId, updatedAt: new Date() })
        .where(and(eq(E.id, id), isNull(E.archiviataIl)))
        .returning({ id: E.id })
      return r.length > 0 ? 'fatto' : 'non-trovata'
    } catch (e) {
      if (isUniqueViolation(e)) return 'conflitto'
      throw e
    }
  }

  async nazioneManuale(p: {
    id: string; matricola: string; nazIban: string; tipoConto: Exclude<TipoConto, 'DA_CHIARIRE'>
    nota: string; userId: string | null
  }): Promise<'fatto' | 'non-trovata' | 'non-ammessa'> {
    return this.db.transaction(async tx => {
      const [e] = await tx.select({ id: E.id }).from(E)
        .where(and(eq(E.id, p.id), isNull(E.archiviataIl))).for('update')
      if (!e) return 'non-trovata'
      const [riga] = await tx.select().from(R)
        .where(and(eq(R.elabId, p.id), eq(R.matricola, p.matricola)))
      if (!riga) return 'non-trovata'
      if (riga.fonte !== 'manuale' && riga.tipoConto !== 'DA_CHIARIRE') return 'non-ammessa'
      await tx.update(R)
        .set({ nazIban: p.nazIban, tipoConto: p.tipoConto, fonte: 'manuale', nota: p.nota })
        .where(and(eq(R.elabId, p.id), eq(R.matricola, p.matricola)))
      // Una modifica cambia i file: si torna in anteprima.
      await tx.update(E).set({ stato: 'anteprima', updatedBy: p.userId, updatedAt: new Date() })
        .where(eq(E.id, p.id))
      return 'fatto'
    })
  }

  async archivia(id: string, userId: string | null): Promise<boolean> {
    const r = await this.db.update(E)
      .set({ archiviataIl: new Date(), updatedBy: userId, updatedAt: new Date() })
      .where(and(eq(E.id, id), isNull(E.archiviataIl)))
      .returning({ id: E.id })
    return r.length > 0
  }
}
