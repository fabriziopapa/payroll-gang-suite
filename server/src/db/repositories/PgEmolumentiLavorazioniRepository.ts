// ============================================================
// PAYROLL GANG SUITE — PgEmolumentiLavorazioniRepository
//
// Persistenza delle lavorazioni dell'area Emolumenti (dottorandi/borsisti).
// Tabella SEPARATA da `bozze`: l'area Liquidazioni non si tocca (piano §8.1).
//
// La lista NON restituisce `dati`: e' un JSONB che con 200 nominativi e lo
// snapshot CSA pesa parecchio, e nell'elenco non serve. Si carica solo
// aprendo la singola lavorazione.
// ============================================================

import { and, desc, eq, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'

type DB = PostgresJsDatabase<typeof schema>

export type StatoLavorazione = 'bozza' | 'archiviata'

/** Riga di elenco — senza il payload. */
export interface LavorazioneRow {
  id:               string
  nome:             string
  stato:            string
  tipo:             string | null
  dataLiquidazione:  string | null
  idLiquidazioneCsa: string | null
  createdBy:        string | null
  createdAt:        Date
  updatedAt:        Date
}

/** Lavorazione completa — con il payload. */
export interface LavorazioneFull extends LavorazioneRow {
  dati: unknown
}

const COLONNE_ELENCO = {
  id:               schema.emolumentiLavorazioni.id,
  nome:             schema.emolumentiLavorazioni.nome,
  stato:            schema.emolumentiLavorazioni.stato,
  tipo:             schema.emolumentiLavorazioni.tipo,
  dataLiquidazione: schema.emolumentiLavorazioni.dataLiquidazione,
  idLiquidazioneCsa: schema.emolumentiLavorazioni.idLiquidazioneCsa,
  createdBy:        schema.emolumentiLavorazioni.createdBy,
  createdAt:        schema.emolumentiLavorazioni.createdAt,
  updatedAt:        schema.emolumentiLavorazioni.updatedAt,
}

export class PgEmolumentiLavorazioniRepository {
  constructor(private readonly db: DB) {}

  /** Elenco (senza `dati`), piu' recenti in cima. */
  async list(stato?: StatoLavorazione): Promise<LavorazioneRow[]> {
    const q = this.db.select(COLONNE_ELENCO).from(schema.emolumentiLavorazioni)
    const rows = stato
      ? await q.where(eq(schema.emolumentiLavorazioni.stato, stato))
               .orderBy(desc(schema.emolumentiLavorazioni.updatedAt))
      : await q.orderBy(desc(schema.emolumentiLavorazioni.updatedAt))
    return rows as LavorazioneRow[]
  }

  async get(id: string): Promise<LavorazioneFull | null> {
    const [row] = await this.db
      .select()
      .from(schema.emolumentiLavorazioni)
      .where(eq(schema.emolumentiLavorazioni.id, id))
      .limit(1)
    return (row as LavorazioneFull | undefined) ?? null
  }

  async create(input: {
    nome:      string
    tipo?:     string | null
    dati:      unknown
    createdBy?: string | null
  }): Promise<LavorazioneFull> {
    const [row] = await this.db
      .insert(schema.emolumentiLavorazioni)
      .values({
        nome:      input.nome,
        tipo:      input.tipo ?? null,
        dati:      input.dati as Record<string, unknown>,
        createdBy: input.createdBy ?? null,
      })
      .returning()
    return row as LavorazioneFull
  }

  /**
   * Aggiorna nome/tipo/dati. Non tocca stato e data di liquidazione: quelli
   * passano da archivia()/riapri(), cosi' un salvataggio distratto non puo'
   * far uscire una lavorazione dall'archivio.
   */
  async update(id: string, patch: {
    nome?: string
    tipo?: string | null
    dati?: unknown
  }): Promise<LavorazioneFull | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (patch.nome !== undefined) set['nome'] = patch.nome
    if (patch.tipo !== undefined) set['tipo'] = patch.tipo
    if (patch.dati !== undefined) set['dati'] = patch.dati

    const [row] = await this.db
      .update(schema.emolumentiLavorazioni)
      .set(set)
      .where(eq(schema.emolumentiLavorazioni.id, id))
      .returning()
    return (row as LavorazioneFull | undefined) ?? null
  }

  /** Archivia: data di liquidazione obbligatoria, ID CSA facoltativo —
   *  esattamente come per le bozze di liquidazione. */
  async archivia(
    id: string, dataLiquidazione: string, idLiquidazioneCsa?: string | null,
  ): Promise<LavorazioneFull | null> {
    const [row] = await this.db
      .update(schema.emolumentiLavorazioni)
      .set({
        stato: 'archiviata',
        dataLiquidazione,
        // undefined = non toccare; stringa vuota normalizzata a null.
        ...(idLiquidazioneCsa !== undefined
          ? { idLiquidazioneCsa: idLiquidazioneCsa || null }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.emolumentiLavorazioni.id, id),
        eq(schema.emolumentiLavorazioni.stato, 'bozza'),
      ))
      .returning()
    return (row as LavorazioneFull | undefined) ?? null
  }

  /** Riporta in lavorazione. La data di liquidazione resta: e' un fatto
   *  avvenuto, non uno stato dell'interfaccia. */
  async riapri(id: string): Promise<LavorazioneFull | null> {
    const [row] = await this.db
      .update(schema.emolumentiLavorazioni)
      .set({ stato: 'bozza', updatedAt: new Date() })
      .where(and(
        eq(schema.emolumentiLavorazioni.id, id),
        eq(schema.emolumentiLavorazioni.stato, 'archiviata'),
      ))
      .returning()
    return (row as LavorazioneFull | undefined) ?? null
  }

  /** Elimina — solo bozze. Una lavorazione archiviata e' un atto concluso e
   *  va prima riaperta esplicitamente: cancellarla per sbaglio non deve
   *  bastare un click. */
  async remove(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(schema.emolumentiLavorazioni)
      .where(and(
        eq(schema.emolumentiLavorazioni.id, id),
        eq(schema.emolumentiLavorazioni.stato, 'bozza'),
      ))
      .returning({ id: schema.emolumentiLavorazioni.id })
    return rows.length > 0
  }

  /** Nome gia' in uso? Evita due "Emolumenti DR 1" indistinguibili. */
  async nomeEsiste(nome: string, escludiId?: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.emolumentiLavorazioni.id })
      .from(schema.emolumentiLavorazioni)
      .where(sql`lower(${schema.emolumentiLavorazioni.nome}) = lower(${nome})`)
      .limit(2)
    return rows.some(r => r.id !== escludiId)
  }
}
