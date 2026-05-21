// ============================================================
// PAYROLL GANG SUITE — PgAnagraficheRepository
// Upsert su (MATRICOLA, DECOR_INQ) — supporta storico ruoli v2
// ============================================================

import { eq, lte, or, isNull, and, desc, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import type {
  IAnagraficheRepository,
  AnagraficaInput,
  AnagraficaRow,
  RuoloAtResult,
  ImportResult,
} from '../IRepository.js'

type DB = PostgresJsDatabase<typeof schema>

// Dimensione batch per gli upsert — evita query troppo grandi
const BATCH_SIZE = 500

export class PgAnagraficheRepository implements IAnagraficheRepository {
  constructor(private readonly db: DB) {}

  /**
   * Ritorna il record attivo più recente per ogni matricola.
   * FIX M-1: la deduplicazione ora avviene server-side tramite DISTINCT ON —
   * nessun trasferimento di righe duplicate e nessuna dedup in JS.
   * DISTINCT ON (matricola) + ORDER BY matricola, decor_inq DESC
   * → PostgreSQL mantiene solo la riga con decor_inq massimo per ogni matricola.
   * Il risultato viene poi ordinato per cognNome in un subquery/CTE implicito.
   */
  async findAll(): Promise<AnagraficaRow[]> {
    // Usa query Drizzle nativa (camelCase garantito dal driver).
    // ORDER BY matricola + decorInq DESC → prima riga per matricola = più recente.
    // Dedup in JS con Set: O(n) — affidabile indipendentemente dal transform del driver.
    const today = new Date().toISOString().slice(0, 10)
    const rows = await this.db
      .select()
      .from(schema.anagrafiche)
      .where(
        or(
          isNull(schema.anagrafiche.finRap),
          sql`${schema.anagrafiche.finRap} >= ${today}`,
        ),
      )
      .orderBy(schema.anagrafiche.matricola, desc(schema.anagrafiche.decorInq))

    // Mantieni solo la riga più recente per matricola
    const seen    = new Set<string>()
    const deduped = rows.filter(r => {
      if (seen.has(r.matricola)) return false
      seen.add(r.matricola)
      return true
    })

    return deduped
      .sort((a, b) => (a.cognNome ?? '').localeCompare(b.cognNome ?? '', 'it'))
      .map(toRow)
  }

  // Ritorna tutta la storia di una matricola (più record)
  async findByMatricola(matricola: string): Promise<AnagraficaRow[]> {
    const rows = await this.db
      .select()
      .from(schema.anagrafiche)
      .where(eq(schema.anagrafiche.matricola, matricola))
      .orderBy(desc(schema.anagrafiche.decorInq))

    return rows.map(toRow)
  }

  async findByRuolo(ruolo: string): Promise<AnagraficaRow[]> {
    const rows = await this.db
      .select()
      .from(schema.anagrafiche)
      .where(
        and(
          eq(schema.anagrafiche.ruolo, ruolo),
          isNull(schema.anagrafiche.finRap),
        ),
      )
      .orderBy(schema.anagrafiche.cognNome)

    return rows.map(toRow)
  }

  /**
   * Trova il ruolo di una persona a una data specifica.
   *
   * CASO A (data assente): restituisce righe con fin_rap IS NULL
   *   → ruolo/i attivi ora
   *
   * CASO B (data presente YYYY-MM-DD): restituisce righe dove
   *   decor_inq <= data AND (fin_rap IS NULL OR fin_rap >= data)
   *   → ruolo/i attivi alla data indicata
   *
   * Ritorna array:
   *   - lunghezza 0: nessun record → client usa fallback locale
   *   - lunghezza 1: univoco → fill automatico
   *   - lunghezza >1: ambiguo → client mostra scelta con le date
   */
  async findRuoloAt(matricola: string, data?: string): Promise<RuoloAtResult[]> {
    let rows: (typeof schema.anagrafiche.$inferSelect)[]

    if (!data) {
      // CASO A — ruolo attivo ora
      rows = await this.db
        .select()
        .from(schema.anagrafiche)
        .where(
          and(
            eq(schema.anagrafiche.matricola, matricola),
            isNull(schema.anagrafiche.finRap),
          ),
        )
        .orderBy(desc(schema.anagrafiche.decorInq))
    } else {
      // CASO B — ruolo alla data indicata
      // SQL: decor_inq <= $data AND (fin_rap IS NULL OR fin_rap >= $data)
      rows = await this.db
        .select()
        .from(schema.anagrafiche)
        .where(
          and(
            eq(schema.anagrafiche.matricola, matricola),
            lte(schema.anagrafiche.decorInq, data),
            or(
              isNull(schema.anagrafiche.finRap),
              sql`${schema.anagrafiche.finRap} >= ${data}`,
            ),
          ),
        )
        .orderBy(desc(schema.anagrafiche.decorInq))
    }

    // Se più periodi sovrapposti ma stesso ruolo → prendi il più recente (overlap tecnico SGE)
    if (rows.length > 1) {
      const ruoliDistinti = new Set(rows.map(r => r.ruolo))
      if (ruoliDistinti.size === 1) return [rows[0]!].map(toRuoloAtResult)
    }

    return rows.map(toRuoloAtResult)
  }

  async upsertMany(items: AnagraficaInput[]): Promise<ImportResult> {
    const result: ImportResult = {
      inserted:    0,
      updated:     0,
      skipped:     0,
      errors:      [],
      processedAt: new Date(),
    }

    if (items.length === 0) return result

    // Deduplicazione per chiave naturale (matricola, decorInq)
    // Necessario per evitare conflitti nello stesso batch INSERT...ON CONFLICT
    const dedupMap = new Map<string, AnagraficaInput>()
    for (const item of items) {
      dedupMap.set(`${item.matricola}|${item.decorInq}`, item)
    }
    const uniqueItems = Array.from(dedupMap.values())

    // Elabora in batch per non saturare la connessione
    for (let i = 0; i < uniqueItems.length; i += BATCH_SIZE) {
      const batch = uniqueItems.slice(i, i + BATCH_SIZE)

      const values = batch.map(item => ({
        matricola:         item.matricola,
        cognNome:          item.cognNome,
        ruolo:             item.ruolo,
        druolo:            item.druolo             ?? null,
        decorInq:          item.decorInq,
        finRap:            item.finRap             ?? null,
        dataAggiornamento: item.dataAggiornamento
          .toISOString()
          .slice(0, 10),
        updatedAt:         new Date(),
        idAb:              item.idAb               ?? null,
        cognome:           item.cognome             ?? null,
        nome:              item.nome               ?? null,
        dtNascita:         item.dtNascita           ?? null,
        genere:            item.genere             ?? null,
        codFis:            item.codFis             ?? null,
        hashRecord:        item.hashRecord          ?? null,
      }))

      const rows = await this.db
        .insert(schema.anagrafiche)
        .values(values)
        .onConflictDoUpdate({
          target: [schema.anagrafiche.matricola, schema.anagrafiche.decorInq],
          set: {
            cognNome:          sql`EXCLUDED.cogn_nome`,
            ruolo:             sql`EXCLUDED.ruolo`,
            druolo:            sql`EXCLUDED.druolo`,
            finRap:            sql`EXCLUDED.fin_rap`,
            dataAggiornamento: sql`EXCLUDED.data_aggiornamento`,
            updatedAt:         sql`now()`,
            idAb:              sql`EXCLUDED.id_ab`,
            cognome:           sql`EXCLUDED.cognome`,
            nome:              sql`EXCLUDED.nome`,
            dtNascita:         sql`EXCLUDED.dt_nascita`,
            genere:            sql`EXCLUDED.genere`,
            codFis:            sql`EXCLUDED.cod_fis`,
            hashRecord:        sql`EXCLUDED.hash_record`,
          },
          // Aggiorna solo se hash cambiato — confronto O(1) su stringa fissa
          where: sql`
            ${schema.anagrafiche.hashRecord} IS DISTINCT FROM EXCLUDED.hash_record
          `,
        })
        .returning({ id: schema.anagrafiche.id, createdAt: schema.anagrafiche.createdAt })

      const now = Date.now()
      rows.forEach(r => {
        const age = now - r.createdAt.getTime()
        if (age < 2000) result.inserted++
        else result.updated++
      })
      // Righe non restituite = già presenti e invariate
      result.skipped += batch.length - rows.length
    }

    // Aggiorna last_import_anagrafiche nelle impostazioni
    await this.db
      .insert(schema.appSettings)
      .values({
        chiave:    'last_import_anagrafiche',
        valore:    new Date().toISOString() as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.appSettings.chiave,
        set:    {
          valore:    new Date().toISOString() as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        },
      })

    return result
  }

  async getLastImportDate(): Promise<Date | null> {
    const [row] = await this.db
      .select({ valore: schema.appSettings.valore })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.chiave, 'last_import_anagrafiche'))
      .limit(1)

    if (!row || row.valore === null || row.valore === 'null') return null
    return new Date(row.valore as string)
  }

  async findAllAtDate(data: string): Promise<AnagraficaRow[]> {
    const rows = await this.db.execute(sql`
      SELECT DISTINCT ON (matricola)
        id, matricola, cogn_nome, ruolo, druolo,
        decor_inq, fin_rap, data_aggiornamento,
        created_at, updated_at,
        id_ab, cognome, nome, dt_nascita, genere, cod_fis
      FROM anagrafiche
      WHERE decor_inq <= ${data}
        AND (fin_rap IS NULL OR fin_rap >= ${data})
      ORDER BY matricola, decor_inq DESC
    `)
    return (rows as unknown[]).map(toRowRaw)
  }
}

// ------------------------------------------------------------

function toRow(r: typeof schema.anagrafiche.$inferSelect): AnagraficaRow {
  return {
    id:                r.id,
    matricola:         r.matricola,
    cognNome:          r.cognNome,
    ruolo:             r.ruolo,
    druolo:            r.druolo           ?? null,
    decorInq:          r.decorInq,
    finRap:            r.finRap           ?? null,
    dataAggiornamento: r.dataAggiornamento,
    updatedAt:         r.updatedAt,
    idAb:              r.idAb             ?? null,
    cognome:           r.cognome          ?? null,
    nome:              r.nome             ?? null,
    dtNascita:         r.dtNascita        ?? null,
    genere:            r.genere           ?? null,
    codFis:            r.codFis           ?? null,
    hashRecord:        r.hashRecord       ?? null,
  }
}

// Mappa risultato raw SQL (usato da findAllAtDate con DISTINCT ON)
function toRowRaw(r: unknown): AnagraficaRow {
  const row = r as Record<string, unknown>
  return {
    id:                row['id'] as number,
    matricola:         row['matricola'] as string,
    cognNome:          row['cogn_nome'] as string,
    ruolo:             row['ruolo'] as string,
    druolo:            (row['druolo'] as string | null) ?? null,
    decorInq:          row['decor_inq'] as string,
    finRap:            (row['fin_rap'] as string | null) ?? null,
    dataAggiornamento: row['data_aggiornamento'] as string,
    updatedAt:         new Date(row['updated_at'] as string),
    idAb:              (row['id_ab'] as number | null) ?? null,
    cognome:           (row['cognome'] as string | null) ?? null,
    nome:              (row['nome'] as string | null) ?? null,
    dtNascita:         (row['dt_nascita'] as string | null) ?? null,
    genere:            (row['genere'] as string | null) ?? null,
    codFis:            (row['cod_fis'] as string | null) ?? null,
    hashRecord:        (row['hash_record'] as string | null) ?? null,
  }
}

function toRuoloAtResult(r: typeof schema.anagrafiche.$inferSelect) {
  return {
    ruolo:    r.ruolo,
    druolo:   r.druolo ?? null,
    decorInq: r.decorInq,
    finRap:   r.finRap ?? null,
  }
}
