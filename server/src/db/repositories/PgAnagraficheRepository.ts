// ============================================================
// PAYROLL GANG SUITE — PgAnagraficheRepository
// Upsert su (MATRICOLA, DECOR_INQ) — supporta storico ruoli v2
// ============================================================

import { eq, lte, gte, or, isNull, and, desc, sql, inArray } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import { encrypt, decrypt } from '../../services/cryptoService.js'
import { areaConto } from '../../lib/areaConto.js'
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

/**
 * L'ordine di una storia anagrafica: dalla decorrenza piu' recente, e a
 * parita' di decorrenza (possibile dalla 0017, ruolo nella chiave) prima il
 * rapporto che dura di piu', poi il ruolo. Sempre lo stesso, ovunque.
 */
const ORDINE_STORICO = [
  desc(schema.anagrafiche.decorInq),
  sql`${schema.anagrafiche.finRap} DESC NULLS FIRST`,
  schema.anagrafiche.ruolo,
]

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
    // DISTINCT ON (matricola) esegue la dedup lato PostgreSQL — nessun oggetto
    // superfluo allocato in Node.js, trasferimento ridotto al solo record più recente
    // per matricola. Allineato con findAllAtDate() che usa lo stesso pattern.
    // idx_anag_storico (matricola, decor_inq, fin_rap) supporta questo ORDER BY.
    const rows = await this.db.execute(sql`
      SELECT DISTINCT ON (matricola)
        id, matricola, cogn_nome, ruolo, druolo,
        decor_inq, fin_rap, data_aggiornamento,
        created_at, updated_at,
        id_ab, cognome, nome, dt_nascita, genere, cod_fis, hash_record, naz_iban
      FROM anagrafiche
      WHERE fin_rap IS NULL
         OR fin_rap >= (CURRENT_DATE - INTERVAL '3 years')
      -- Spareggio esplicito (0017): con il ruolo nella chiave due rapporti
      -- possono iniziare lo stesso giorno. A parita' di decorrenza vince
      -- quello che dura di piu' (aperto prima di tutti), poi il ruolo in
      -- ordine alfabetico: una regola fissa, non l'ordine fisico delle righe.
      ORDER BY matricola, decor_inq DESC, fin_rap DESC NULLS FIRST, ruolo
    `)

    // Sort finale per cognNome in JS: PostgreSQL non consente ORDER BY su colonne
    // non incluse nel DISTINCT ON senza una subquery/CTE aggiuntiva.
    return (rows as unknown[])
      .map(toRowRaw)
      .sort((a, b) => (a.cognNome ?? '').localeCompare(b.cognNome ?? '', 'it'))
  }

  // Ritorna tutta la storia di una matricola (più record)
  async findByMatricola(matricola: string): Promise<AnagraficaRow[]> {
    const rows = await this.db
      .select()
      .from(schema.anagrafiche)
      .where(eq(schema.anagrafiche.matricola, matricola))
      .orderBy(...ORDINE_STORICO)

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
        .orderBy(...ORDINE_STORICO)
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
        .orderBy(...ORDINE_STORICO)
    }

    // Se più periodi sovrapposti ma stesso ruolo → prendi il più recente (overlap tecnico SGE)
    if (rows.length > 1) {
      const ruoliDistinti = new Set(rows.map(r => r.ruolo))
      if (ruoliDistinti.size === 1) return [rows[0]!].map(toRuoloAtResult)
    }

    return rows.map(toRuoloAtResult)
  }

  /**
   * Versione bulk di findRuoloAt: UNA sola query con `matricola IN (...)`,
   * poi raggruppamento per matricola in memoria. Sostituisce le N richieste
   * HTTP dell'"Aggiorna Ruolo" (evita il rate-limit su gruppi grandi).
   */
  async findRuoloAtBulk(matricole: string[], data?: string): Promise<Record<string, RuoloAtResult[]>> {
    const out: Record<string, RuoloAtResult[]> = {}
    if (matricole.length === 0) return out
    const uniq = [...new Set(matricole)]

    const rows = await (data
      ? this.db.select().from(schema.anagrafiche).where(
          and(
            inArray(schema.anagrafiche.matricola, uniq),
            lte(schema.anagrafiche.decorInq, data),
            or(
              isNull(schema.anagrafiche.finRap),
              sql`${schema.anagrafiche.finRap} >= ${data}`,
            ),
          ),
        ).orderBy(schema.anagrafiche.matricola, ...ORDINE_STORICO)
      : this.db.select().from(schema.anagrafiche).where(
          and(
            inArray(schema.anagrafiche.matricola, uniq),
            isNull(schema.anagrafiche.finRap),
          ),
        ).orderBy(schema.anagrafiche.matricola, ...ORDINE_STORICO)
    )

    // Raggruppa per matricola (già ordinata per decorInq desc → [0] = più recente)
    const byMat = new Map<string, (typeof schema.anagrafiche.$inferSelect)[]>()
    for (const r of rows) {
      const list = byMat.get(r.matricola) ?? []
      list.push(r)
      byMat.set(r.matricola, list)
    }

    for (const [mat, rs] of byMat) {
      // Stesso ruolo su più periodi sovrapposti → tieni il più recente
      if (rs.length > 1 && new Set(rs.map(r => r.ruolo)).size === 1) {
        out[mat] = [toRuoloAtResult(rs[0]!)]
      } else {
        out[mat] = rs.map(toRuoloAtResult)
      }
    }

    return out
  }

  /** CF locale (da SGE) per N matricole. Una query; tiene il primo CF non nullo. */
  async getCodFisByMatricole(matricole: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    if (matricole.length === 0) return out
    const uniq = [...new Set(matricole)]
    const rows = await this.db
      .select({ matricola: schema.anagrafiche.matricola, codFis: schema.anagrafiche.codFis })
      .from(schema.anagrafiche)
      .where(inArray(schema.anagrafiche.matricola, uniq))
    for (const r of rows) {
      if (r.codFis && !out[r.matricola]) {
        const cf = decCf(r.codFis)     // F-1: decifra il CF a riposo
        if (cf) out[r.matricola] = cf
      }
    }
    return out
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

    // Deduplicazione per chiave naturale (matricola, decorInq, ruolo) — 0017.
    // Necessario per evitare conflitti nello stesso batch INSERT...ON CONFLICT.
    // Un doppione vero (stessa persona, stesso giorno, STESSO ruolo) l'import
    // lo ha gia' segnalato nel referto.
    const dedupMap = new Map<string, AnagraficaInput>()
    for (const item of items) {
      dedupMap.set(`${item.matricola}|${item.decorInq}|${item.ruolo}`, item)
    }
    const uniqueItems = Array.from(dedupMap.values())

    // Due gruppi, due istruzioni: chi porta la nazione (anche null = "nessuna
    // coordinata") e chi non la porta (undefined = file senza colonna
    // NAZ_IBAN). Nell'ON CONFLICT il valore EXCLUDED.naz_iban sarebbe NULL in
    // entrambi i casi e non li distinguerebbe: la differenza va decisa qui,
    // prima dell'INSERT, cambiando il SET. Non con un COALESCE, che non
    // saprebbe mai cancellare un conto sparito.
    const gruppi: Array<{ conNazione: boolean; items: AnagraficaInput[] }> = [
      { conNazione: true,  items: uniqueItems.filter(it => it.nazIban !== undefined) },
      { conNazione: false, items: uniqueItems.filter(it => it.nazIban === undefined) },
    ]

    for (const { conNazione, items: gruppo } of gruppi) {
      // Elabora in batch per non saturare la connessione
      for (let i = 0; i < gruppo.length; i += BATCH_SIZE) {
        const batch = gruppo.slice(i, i + BATCH_SIZE)

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
          // F-1: cifra il CF a riposo (encrypt sul plaintext sorgente). EXCLUDED.
          // cod_fis nell'ON CONFLICT eredita questo valore già cifrato.
          codFis:            item.codFis ? encrypt(item.codFis) : null,
          hashRecord:        item.hashRecord          ?? null,
          nazIban:           item.nazIban             ?? null,
        }))

        const rows = await this.db
          .insert(schema.anagrafiche)
          .values(values)
          .onConflictDoUpdate({
            target: [schema.anagrafiche.matricola, schema.anagrafiche.decorInq, schema.anagrafiche.ruolo],
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
              // naz_iban si aggiorna SOLO se il file porta la colonna NAZ_IBAN
              // (vedi il partizionamento qui sopra). Un file senza la colonna
              // non cancella la nazione gia' nota; un file con la colonna e la
              // cella vuota la cancella, perche' quello e' un fatto.
              ...(conNazione ? { nazIban: sql`EXCLUDED.naz_iban` } : {}),
            },
            // Aggiorna solo se hash cambiato — confronto O(1) su stringa fissa
            where: sql`
              ${schema.anagrafiche.hashRecord} IS DISTINCT FROM EXCLUDED.hash_record
            `,
          })
          .returning({
            id:         schema.anagrafiche.id,
            wasInserted: sql<boolean>`(created_at = updated_at)`,
          })

        rows.forEach(r => {
          if (r.wasInserted) result.inserted++
          else result.updated++
        })
        // Righe non restituite = già presenti e invariate
        result.skipped += batch.length - rows.length
      }
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

  /**
   * La nazione del conto e' della PERSONA, non del singolo rapporto:
   * l'estrazione la calcola per id_ab e la ripete uguale su tutte le righe
   * della stessa matricola. Ma le righe che il file non porta (ruoli fuori
   * lista, periodi usciti dalla finestra dei BE, avanzi di import vecchi)
   * restavano con la nazione di allora o vuota, e se una di loro era la
   * piu' recente l'area della persona risultava NON_NOTO.
   *
   * Qui la nazione del file si scrive su TUTTE le righe della matricola.
   *
   * NON tocca `updated_at`, di proposito: la bonifica dopo l'import usa
   * "non scritta dall'import di oggi" per trovare le righe che il file non
   * contiene. Allineare un fatto della persona non e' riscrivere il
   * rapporto, e non deve confondere quel conteggio.
   *
   * @returns quante righe sono cambiate davvero
   */
  async allineaNazioni(nazioni: Record<string, string | null>): Promise<number> {
    const voci = Object.entries(nazioni)
    let cambiate = 0
    for (let i = 0; i < voci.length; i += BATCH_SIZE) {
      const lotto = voci.slice(i, i + BATCH_SIZE)
      const valori = sql.join(
        lotto.map(([matricola, naz]) => sql`(${matricola}::text, ${naz}::text)`),
        sql`, `,
      )
      const rows = await this.db.execute(sql`
        UPDATE anagrafiche AS a
           SET naz_iban = v.naz
          FROM (VALUES ${valori}) AS v(matricola, naz)
         WHERE a.matricola = v.matricola
           AND a.naz_iban IS DISTINCT FROM v.naz
        RETURNING a.id
      `)
      cambiate += (rows as unknown[]).length
    }
    return cambiate
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
        id_ab, cognome, nome, dt_nascita, genere, cod_fis, naz_iban
      FROM anagrafiche
      WHERE decor_inq <= ${data}
        AND (fin_rap IS NULL OR fin_rap >= ${data})
      -- Stesso spareggio di findAll (0017).
      ORDER BY matricola, decor_inq DESC, fin_rap DESC NULLS FIRST, ruolo
    `)
    return (rows as unknown[]).map(toRowRaw)
  }
}

// ------------------------------------------------------------
// F-1: CF cifrato a riposo. decCf decifra in lettura con fallback al valore
// grezzo per le righe pre-cifratura (in chiaro) o non decifrabili — così una
// base dati mista (backfill in corso) resta leggibile. La cifratura in
// scrittura usa encrypt() sul PLAINTEXT (importService passa il CF grezzo),
// quindi nessun rischio di doppia cifratura sui re-import.
function decCf(v: string | null | undefined): string | null {
  if (!v) return null
  try { return decrypt(v) } catch { return v }
}

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
    codFis:            decCf(r.codFis),   // F-1: decifra a riposo
    hashRecord:        r.hashRecord       ?? null,
    nazIban:           r.nazIban          ?? null,
    // Calcolata, non letta: la regola sta in lib/areaConto.ts.
    areaConto:         areaConto(r.nazIban),
  }
}

// Mappa risultato raw SQL (usato da findAll e findAllAtDate con DISTINCT ON).
// IMPORTANTE: postgres.js è configurato con postgres.camel (connection.ts) →
// tutti i nomi colonna snake_case vengono convertiti in camelCase PRIMA di
// arrivare qui. Usare le chiavi camelCase, non snake_case.
function toRowRaw(r: unknown): AnagraficaRow {
  const row = r as Record<string, unknown>
  return {
    id:                row['id'] as number,
    matricola:         row['matricola'] as string,
    cognNome:          row['cognNome'] as string,           // cogn_nome → cognNome
    ruolo:             row['ruolo'] as string,
    druolo:            (row['druolo'] as string | null) ?? null,
    decorInq:          row['decorInq'] as string,           // decor_inq → decorInq
    finRap:            (row['finRap'] as string | null) ?? null,   // fin_rap → finRap
    dataAggiornamento: row['dataAggiornamento'] as string,  // data_aggiornamento → dataAggiornamento
    updatedAt:         new Date(row['updatedAt'] as string), // updated_at → updatedAt
    idAb:              (row['idAb'] as number | null) ?? null,     // id_ab → idAb
    cognome:           (row['cognome'] as string | null) ?? null,
    nome:              (row['nome'] as string | null) ?? null,
    dtNascita:         (row['dtNascita'] as string | null) ?? null, // dt_nascita → dtNascita
    genere:            (row['genere'] as string | null) ?? null,
    codFis:            decCf(row['codFis'] as string | null),       // cod_fis → codFis, F-1 decifra
    hashRecord:        (row['hashRecord'] as string | null) ?? null, // hash_record → hashRecord
    nazIban:           (row['nazIban']    as string | null) ?? null, // naz_iban → nazIban
    // Calcolata, non letta: la regola sta in lib/areaConto.ts.
    areaConto:         areaConto(row['nazIban'] as string | null),
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
