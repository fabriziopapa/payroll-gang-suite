// ============================================================
// PAYROLL GANG SUITE — PgBozzeRepository
// dati JSONB: serializzazione completa liquidazioni + nominativi
// ============================================================

import { eq, and, sql, type SQL } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import { encrypt, decrypt } from '../../services/cryptoService.js'
import type { IBozzeRepository, BozzaRow, BozzaSummaryRow, BozzaInput, LiquidazioneInfo, BozzaSearchOpts } from '../IRepository.js'

type DB = PostgresJsDatabase<typeof schema>

// ------------------------------------------------------------
// PGS-05 — Cifratura a riposo dei SOLI codici fiscali nel JSONB `dati`
// (AES-256-GCM, stessa chiave/servizio di PGS-04):
//   · nominativi[].codFisc                     → sempre cifrato
//   · nominativi[].riferimentoCedolino         → cifrato se contiene un CF
//   · dettagli[].riferimentoCedolino           → cifrato se contiene un CF
// Il resto della bozza resta in chiaro (nessun impatto su Ricerca client-side,
// che riceve i dati già decifrati). Prefisso marker per idempotenza; le righe
// legacy in chiaro vengono lette in passthrough (backfill:
// encrypt-bozze-cf-backfill.ts).
// ------------------------------------------------------------

const ENC_PREFIX = 'PGS05:'
const CF_RE = /[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]/

function encField(v: string): string {
  if (v === '' || v.startsWith(ENC_PREFIX)) return v   // idempotente
  return ENC_PREFIX + encrypt(v)
}

function decField(v: string): string {
  if (!v.startsWith(ENC_PREFIX)) return v              // riga legacy in chiaro
  try { return decrypt(v.slice(ENC_PREFIX.length)) } catch { return v }
}

type DatiShape = { nominativi?: unknown[]; dettagli?: unknown[] }

/** Applica `fn` ai campi CF-sensibili di una copia profonda di `dati`. */
function mapCfFields(dati: unknown, fn: (v: string) => string, encrypting: boolean): unknown {
  if (typeof dati !== 'object' || dati === null) return dati
  const clone = structuredClone(dati) as DatiShape
  for (const n of clone.nominativi ?? []) {
    const o = n as Record<string, unknown>
    if (typeof o['codFisc'] === 'string') o['codFisc'] = fn(o['codFisc'])
    const rif = o['riferimentoCedolino']
    if (typeof rif === 'string' && (!encrypting || CF_RE.test(rif))) o['riferimentoCedolino'] = fn(rif)
  }
  for (const d of clone.dettagli ?? []) {
    const o = d as Record<string, unknown>
    const rif = o['riferimentoCedolino']
    if (typeof rif === 'string' && (!encrypting || CF_RE.test(rif))) o['riferimentoCedolino'] = fn(rif)
  }
  return clone
}

/** Cifra i CF prima della scrittura (create/update). */
export function protectCf(dati: unknown): unknown {
  return mapCfFields(dati, encField, true)
}

/** Decifra i CF dopo la lettura (findAll/findById). */
export function revealCf(dati: unknown): unknown {
  return mapCfFields(dati, decField, false)
}

/** Colonne selezionate con dati JSONB — usato solo da findById */
const SEL = {
  id:                schema.bozze.id,
  nome:              schema.bozze.nome,
  stato:             schema.bozze.stato,
  protocolloDisplay: schema.bozze.protocolloDisplay,
  dati:              schema.bozze.dati,
  dataLiquidazione:  schema.bozze.dataLiquidazione,
  idLiquidazioneCsa: schema.bozze.idLiquidazioneCsa,
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
  dataLiquidazione:  schema.bozze.dataLiquidazione,
  idLiquidazioneCsa: schema.bozze.idLiquidazioneCsa,
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

  /**
   * Ricerca server-side sul JSONB `dati.dettagli` — ritorna solo i riepiloghi
   * (nessun `dati` sul filo). I campi ricercabili del gruppo sono in chiaro
   * (solo i CF sono cifrati), quindi la query è diretta.
   * · mirate per campo → EXISTS di UN dettaglio che soddisfa TUTTI i criteri;
   * · full-text (token AND) → ogni token nel nome liquidazione o in un gruppo.
   * ILIKE = case-insensitive (accenti non normalizzati lato DB).
   */
  async search(o: BozzaSearchOpts): Promise<BozzaSummaryRow[]> {
    const conds: SQL[] = []
    if (o.userId) conds.push(sql`b.created_by = ${o.userId}`)
    if (o.stato)  conds.push(sql`b.stato = ${o.stato}`)

    const like = (v: string) => `%${v.trim()}%`
    const t: SQL[] = []
    if (o.titolo?.trim())      t.push(sql`(d->>'nomeDescrittivo') ILIKE ${like(o.titolo)}`)
    if (o.voce?.trim())        t.push(sql`(d->>'voce') ILIKE ${like(o.voce)}`)
    if (o.capitolo?.trim())    t.push(sql`(d->>'capitolo') ILIKE ${like(o.capitolo)}`)
    if (o.idProv?.trim())      t.push(sql`(d->>'identificativoProvvedimento') ILIKE ${like(o.idProv)}`)
    if (o.centroCosto?.trim()) t.push(sql`(d->>'centroCosto') ILIKE ${like(o.centroCosto)}`)
    if (o.note?.trim())        t.push(sql`(d->>'note') ILIKE ${like(o.note)}`)
    if (o.from)                t.push(sql`(d->>'dataCompetenzaVoce') >= ${o.from}`)
    if (o.to)                  t.push(sql`(d->>'dataCompetenzaVoce') <= ${o.to}`)
    if (t.length) {
      conds.push(sql`EXISTS (SELECT 1 FROM jsonb_array_elements(b.dati->'dettagli') d WHERE ${sql.join(t, sql` AND `)})`)
    }

    // haystack di un dettaglio (nome liquidazione incluso) per il full-text
    const hay = sql`(coalesce(b.nome,'') || ' ' || coalesce(d->>'nomeDescrittivo','') || ' ' || coalesce(d->>'voce','') || ' ' || coalesce(d->>'capitolo','') || ' ' || coalesce(d->>'identificativoProvvedimento','') || ' ' || coalesce(d->>'centroCosto','') || ' ' || coalesce(d->>'note','') || ' ' || coalesce(d->>'competenzaLiquidazione',''))`
    for (const tok of (o.text ?? '').trim().split(/\s+/).filter(Boolean)) {
      const pat = `%${tok}%`
      conds.push(sql`(b.nome ILIKE ${pat} OR EXISTS (SELECT 1 FROM jsonb_array_elements(b.dati->'dettagli') d WHERE ${hay} ILIKE ${pat}))`)
    }

    const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``

    const rows = await this.db.execute(sql`
      SELECT b.id, b.nome, b.stato,
             b.protocollo_display,
             b.data_liquidazione,
             b.id_liquidazione_csa,
             b.created_by,
             u.username AS created_by_username,
             b.created_at,
             b.updated_at
      FROM bozze b
      LEFT JOIN users u ON u.id = b.created_by
      ${where}
      ORDER BY b.updated_at DESC
    `)

    return (rows as unknown as SummaryRowShape[]).map(toSummaryRow)
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
        dati:              protectCf(data.dati)    as Record<string, unknown>,   // PGS-05
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
    if (data.dati              !== undefined) set.dati              = protectCf(data.dati) as Record<string, unknown>   // PGS-05

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

  async archive(id: string, info: LiquidazioneInfo): Promise<BozzaRow> {
    const [upd] = await this.db
      .update(schema.bozze)
      .set({
        stato:             'archiviata',
        dataLiquidazione:  info.dataLiquidazione,
        idLiquidazioneCsa: info.idLiquidazioneCsa ?? null,
        updatedAt:         new Date(),
      })
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

  /**
   * Aggiorna data liquidazione / ID CSA su una bozza GIÀ archiviata
   * (l'ID CSA è facoltativo all'archiviazione e integrabile in seguito).
   */
  async updateLiquidazioneInfo(id: string, info: LiquidazioneInfo): Promise<BozzaRow> {
    const [upd] = await this.db
      .update(schema.bozze)
      .set({
        dataLiquidazione:  info.dataLiquidazione,
        idLiquidazioneCsa: info.idLiquidazioneCsa ?? null,
        updatedAt:         new Date(),
      })
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
  dataLiquidazione: string | null; idLiquidazioneCsa: string | null
  createdBy: string | null; createdAt: Date; updatedAt: Date
  createdByUsername: string | null
}

function toRow(r: RowShape): BozzaRow {
  return {
    id:                r.id,
    nome:              r.nome,
    stato:             r.stato as 'bozza' | 'archiviata',
    protocolloDisplay: r.protocolloDisplay ?? null,
    dati:              revealCf(r.dati),   // PGS-05: CF decifrati in uscita
    dataLiquidazione:  r.dataLiquidazione  ?? null,
    idLiquidazioneCsa: r.idLiquidazioneCsa ?? null,
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
  dataLiquidazione: string | null; idLiquidazioneCsa: string | null
  createdBy: string | null; createdAt: Date; updatedAt: Date
  createdByUsername: string | null
}

function toSummaryRow(r: SummaryRowShape): BozzaSummaryRow {
  return {
    id:                r.id,
    nome:              r.nome,
    stato:             r.stato as 'bozza' | 'archiviata',
    protocolloDisplay: r.protocolloDisplay ?? null,
    dataLiquidazione:  r.dataLiquidazione  ?? null,
    idLiquidazioneCsa: r.idLiquidazioneCsa ?? null,
    createdBy:         r.createdBy         ?? null,
    createdByUsername: r.createdByUsername  ?? null,
    createdAt:         r.createdAt,
    updatedAt:         r.updatedAt,
  }
}
