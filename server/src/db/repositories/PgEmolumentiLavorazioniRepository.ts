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
import { alias } from 'drizzle-orm/pg-core'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'

type DB = PostgresJsDatabase<typeof schema>

export type StatoLavorazione = 'bozza' | 'archiviata'

/**
 * Riga di elenco — senza il payload.
 *
 * I due `*Username` sono **facoltativi** di proposito: l'elenco li risolve
 * con un join, le altre operazioni (create/update/get) restituiscono la riga
 * cosi' come sta in tabella e non li hanno. Dichiararli obbligatori
 * significherebbe promettere al chiamante un dato che in quei casi non c'e'.
 */
export interface LavorazioneRow {
  id:               string
  nome:             string
  stato:            string
  tipo:             string | null
  dataLiquidazione:  string | null
  idLiquidazioneCsa: string | null
  createdBy:        string | null
  updatedBy:        string | null
  createdAt:        Date
  updatedAt:        Date
  createdByUsername?: string | null
  updatedByUsername?: string | null
}

/** Lavorazione completa — con il payload. */
export interface LavorazioneFull extends LavorazioneRow {
  dati: unknown
}

/** Due join sulla STESSA tabella `users`: servono due alias distinti,
 *  altrimenti Postgres non sa a quale dei due ci si riferisce. */
const autore       = alias(schema.users, 'autore')
const modificatore = alias(schema.users, 'modificatore')

const COLONNE_ELENCO = {
  id:               schema.emolumentiLavorazioni.id,
  nome:             schema.emolumentiLavorazioni.nome,
  stato:            schema.emolumentiLavorazioni.stato,
  tipo:             schema.emolumentiLavorazioni.tipo,
  dataLiquidazione: schema.emolumentiLavorazioni.dataLiquidazione,
  idLiquidazioneCsa: schema.emolumentiLavorazioni.idLiquidazioneCsa,
  createdBy:        schema.emolumentiLavorazioni.createdBy,
  updatedBy:        schema.emolumentiLavorazioni.updatedBy,
  createdAt:        schema.emolumentiLavorazioni.createdAt,
  updatedAt:        schema.emolumentiLavorazioni.updatedAt,
  createdByUsername: autore.username,
  updatedByUsername: modificatore.username,
}

export class PgEmolumentiLavorazioniRepository {
  constructor(private readonly db: DB) {}

  /** Elenco (senza `dati`), piu' recenti in cima, con gli username di chi ha
   *  creato e di chi ha salvato per ultimo.
   *
   *  `leftJoin` e non `innerJoin`: un utente cancellato azzera il riferimento
   *  (ON DELETE SET NULL) e la lavorazione deve comunque comparire in elenco. */
  async list(stato?: StatoLavorazione): Promise<LavorazioneRow[]> {
    const q = this.db
      .select(COLONNE_ELENCO)
      .from(schema.emolumentiLavorazioni)
      .leftJoin(autore,       eq(autore.id,       schema.emolumentiLavorazioni.createdBy))
      .leftJoin(modificatore, eq(modificatore.id, schema.emolumentiLavorazioni.updatedBy))
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
        // Chi crea e' anche l'ultimo che ha salvato: non e' un'ipotesi, e'
        // successo adesso. Cosi' la colonna e' subito significativa.
        updatedBy: input.createdBy ?? null,
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
  }, userId?: string | null): Promise<LavorazioneFull | null> {
    // `updatedBy` accanto a `updatedAt`: chi e quando sono lo stesso fatto e
    // vanno scritti insieme, altrimenti prima o poi divergono.
    const set: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy: userId ?? null,
    }
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
    userId?: string | null,
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
        updatedBy: userId ?? null,
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
  async riapri(id: string, userId?: string | null): Promise<LavorazioneFull | null> {
    const [row] = await this.db
      .update(schema.emolumentiLavorazioni)
      .set({ stato: 'bozza', updatedAt: new Date(), updatedBy: userId ?? null })
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
