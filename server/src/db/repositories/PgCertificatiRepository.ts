// ============================================================
// PAYROLL GANG SUITE — PgCertificatiRepository
// Assegnazione progressivo ATOMICA (fix #3): UPSERT su certificato_progressivi
// dentro una transazione → niente race su MAX(progressivo)+1.
// ============================================================

import { eq, and, desc, or, ilike, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import { encrypt, decrypt } from '../../services/cryptoService.js'
import type {
  ICertificatiRepository, CertificatoInput, CertificatoRow, CertificatoSummaryRow,
} from '../IRepository.js'

type DB = PostgresJsDatabase<typeof schema>

// ------------------------------------------------------------
// PGS-04 — Cifratura a riposo di cf + datiJson (AES-256-GCM).
// La lista/ricerca NON legge queste colonne → cifratura confinata a
// create()/findById(). Le righe legacy (pre-cifratura) sono lette in modo
// trasparente: se la decifratura fallisce si usa il valore grezzo.
// ------------------------------------------------------------

interface DatiJsonEnvelope { v: number; enc: string }

function isEnvelope(x: unknown): x is DatiJsonEnvelope {
  return typeof x === 'object' && x !== null &&
    typeof (x as { enc?: unknown }).enc === 'string'
}

/** Cifra il CF (null-safe). No-op se già cifrato (formato iv:tag:cipher). */
function encCf(cf: string | null | undefined): string | null {
  if (cf == null || cf === '') return cf ?? null
  if (cf.split(':').length === 3) return cf   // già cifrato (idempotenza backfill)
  return encrypt(cf)
}

/** Decifra il CF; fallback al grezzo per righe legacy pre-cifratura. */
function decCf(cf: string | null): string | null {
  if (cf == null) return null
  try { return decrypt(cf) } catch { return cf }
}

/** Avvolge il payload parser in un envelope cifrato jsonb. */
function encDatiJson(dati: unknown): DatiJsonEnvelope {
  return { v: 1, enc: encrypt(JSON.stringify(dati ?? null)) }
}

/** Estrae il payload dall'envelope cifrato; passthrough per righe legacy. */
function decDatiJson(raw: unknown): unknown {
  if (!isEnvelope(raw)) return raw   // riga legacy (payload in chiaro)
  try { return JSON.parse(decrypt(raw.enc)) } catch { return null }
}

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
          cf:             encCf(data.cf),
          periodo:        data.periodo        ?? null,
          nominativo:     data.nominativo     ?? null,
          siglaOperatore: data.siglaOperatore,
          dirigente:      data.dirigente      ?? null,
          templateId:     data.templateId     ?? null,
          datiJson:       encDatiJson(data.datiJson) as unknown as Record<string, unknown>,
          createdBy:      data.createdBy      ?? null,
        })
        .returning({ id: schema.certificati.id })

      if (!ins) throw new Error('INSERT certificato fallito')
      return ins.id
    })

    return (await this.findById(id))!
  }

  async delete(id: string): Promise<{ protocollo: string; anno: number } | null> {
    return this.db.transaction(async (tx) => {
      const [del] = await tx
        .delete(schema.certificati)
        .where(eq(schema.certificati.id, id))
        .returning({ protocollo: schema.certificati.protocollo, anno: schema.certificati.anno })
      if (!del) return null

      // Risincronizza il contatore dell'anno = MAX(progressivo) rimanente (o 0)
      const [m] = await tx
        .select({ max: sql<number>`coalesce(max(${schema.certificati.progressivo}), 0)` })
        .from(schema.certificati)
        .where(eq(schema.certificati.anno, del.anno))
      const ultimo = Number(m?.max ?? 0)

      await tx
        .update(schema.certificatoProgressivi)
        .set({ ultimo })
        .where(eq(schema.certificatoProgressivi.anno, del.anno))

      return del
    })
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
  // FIX: leggi il JSONB come TEXT (::text → tipo 25) per BYPASSARE il transform
  // postgres.camel.value.from, che camelizzerebbe ricorsivamente le chiavi del
  // JSONB (voci_teoriche → vociTeoriche) rompendo parser/merge/docx in regen.
  // Lo storage resta snake_case; qui lo ri-parsiamo a mano preservandolo.
  datiJson:       sql<string>`${schema.certificati.datiJson}::text`,
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
  // datiJson arriva come stringa (::text) → ri-parsa preservando snake_case,
  // poi decifra l'envelope (PGS-04). cf: decifrato con fallback al grezzo.
  const rawDati = typeof r.datiJson === 'string' ? safeParse(r.datiJson) : r.datiJson
  return {
    id: r.id, anno: r.anno, progressivo: r.progressivo, protocollo: r.protocollo,
    matricola: r.matricola, cf: decCf(r.cf), periodo: r.periodo, nominativo: r.nominativo,
    siglaOperatore: r.siglaOperatore, dirigente: r.dirigente, templateId: r.templateId,
    datiJson: decDatiJson(rawDati),
    createdBy: r.createdBy,
    createdByUsername: r.createdByUsername ?? null, createdAt: r.createdAt,
  }
}

/** Parse difensivo del JSONB letto come testo. */
function safeParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return null }
}
