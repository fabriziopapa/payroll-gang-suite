// ============================================================
// PAYROLL GANG SUITE — PgPdfRegionTemplatesRepository
// CRUD template-come-dato VERSIONATO E IMMUTABILE: ogni riga = una
// versione. createNewVersion() = pattern transazionale "progressivo
// atomico" (mirror PgCertificatiRepository.create): risolve famiglia/
// MAX(versione), disattiva il predecessore, inserisce la nuova riga —
// tutto in una transazione. Mai UPDATE in-place sui campi geometrici.
// ============================================================

import { eq, and, desc } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import type {
  IPdfRegionTemplatesRepository, PdfRegionTemplateRow, PdfRegionTemplateInput,
} from '../IRepository.js'

type DB = PostgresJsDatabase<typeof schema>

/**
 * NB: pageGeometryJson/partiJson NON usano il cast `::text` di PgCertificatiRepository.
 * Quel workaround serve solo dove il JSONB contiene chiavi snake_case (es. voci_teoriche)
 * che postgres.camel.value.from camelizzerebbe rompendo il contratto. I tipi
 * PageGeometry/ParteTemplate (Gate 1/2 — pageIndex, widthPt, regioneDescrizione, isArretrato...)
 * usano SOLO chiavi camelCase: la camelizzazione è un no-op. Stesso pattern di
 * PgBozzeRepository (campo `dati`) e PgTemplatiCertificatoRepository (`strutturaJson`).
 */
const SEL = {
  id:                    schema.templatiPdfRegion.id,
  templateFamilyId:      schema.templatiPdfRegion.templateFamilyId,
  nome:                  schema.templatiPdfRegion.nome,
  nota:                  schema.templatiPdfRegion.nota,
  versione:              schema.templatiPdfRegion.versione,
  versioneLabel:         schema.templatiPdfRegion.versioneLabel,
  attivo:                schema.templatiPdfRegion.attivo,
  pageGeometryJson:      schema.templatiPdfRegion.pageGeometryJson,
  partiJson:             schema.templatiPdfRegion.partiJson,
  certificatoTemplateId: schema.templatiPdfRegion.certificatoTemplateId,
  createdBy:             schema.templatiPdfRegion.createdBy,
  createdAt:             schema.templatiPdfRegion.createdAt,
  updatedAt:             schema.templatiPdfRegion.updatedAt,
  createdByUsername:     schema.users.username,
}

export class PgPdfRegionTemplatesRepository implements IPdfRegionTemplatesRepository {
  constructor(private readonly db: DB) {}

  async findAll(soloAttivi = false): Promise<PdfRegionTemplateRow[]> {
    const base = this.db
      .select(SEL)
      .from(schema.templatiPdfRegion)
      .leftJoin(schema.users, eq(schema.templatiPdfRegion.createdBy, schema.users.id))

    const rows = soloAttivi
      ? await base.where(eq(schema.templatiPdfRegion.attivo, true)).orderBy(desc(schema.templatiPdfRegion.updatedAt))
      : await base.orderBy(desc(schema.templatiPdfRegion.updatedAt))

    return rows.map(toRow)
  }

  async findById(id: string): Promise<PdfRegionTemplateRow | null> {
    const [row] = await this.db
      .select(SEL)
      .from(schema.templatiPdfRegion)
      .leftJoin(schema.users, eq(schema.templatiPdfRegion.createdBy, schema.users.id))
      .where(eq(schema.templatiPdfRegion.id, id))
      .limit(1)

    return row ? toRow(row) : null
  }

  async create(data: PdfRegionTemplateInput): Promise<PdfRegionTemplateRow> {
    const [ins] = await this.db
      .insert(schema.templatiPdfRegion)
      .values({
        // templateFamilyId omesso: DB applica gen_random_uuid() (defaultRandom in schema)
        nome:                  data.nome,
        nota:                  data.nota ?? null,
        versione:              1,
        versioneLabel:         oggiVersioneLabel(),
        attivo:                true,
        pageGeometryJson:      data.pageGeometryJson as Record<string, unknown>,
        partiJson:             data.partiJson         as Record<string, unknown>,
        certificatoTemplateId: data.certificatoTemplateId,
        createdBy:             data.createdBy ?? null,
      })
      .returning({ id: schema.templatiPdfRegion.id })

    if (!ins) throw new Error('INSERT template PDF region fallito')
    return (await this.findById(ins.id))!
  }

  /**
   * Nuova versione in transazione atomica — mirror del pattern "progressivo
   * atomico" di PgCertificatiRepository.create():
   *  1) risolve templateFamilyId dalla riga precedente
   *  2) prossimaVersione = MAX(versione) della famiglia + 1
   *  3) disattiva (attivo=false) la riga attualmente attiva della famiglia
   *  4) inserisce la nuova riga: stesso family, versione+1, attiva
   * Mai UPDATE in-place sui campi geometrici — immutabilità delle versioni preservata.
   */
  async createNewVersion(precedenteId: string, data: PdfRegionTemplateInput): Promise<PdfRegionTemplateRow> {
    const newId = await this.db.transaction(async (tx) => {
      // Audit Gate4 H1: SELECT MAX + INSERT separati NON sono atomici sotto
      // READ COMMITTED (default postgres.js) — due PUT concorrenti sulla stessa
      // famiglia leggono lo stesso MAX, calcolano la stessa prossimaVersione e
      // collidono sull'unique (templateFamilyId, versione) con 23505 non gestito.
      // FOR UPDATE serializza le transazioni concorrenti su questa famiglia:
      // la seconda attende il commit della prima e rilegge un MAX aggiornato.
      // templateFamilyId è immutabile una volta creata la riga — lettura senza
      // lock qui è sicura (non può "invecchiare" durante la transazione).
      const [prec] = await tx
        .select({ familyId: schema.templatiPdfRegion.templateFamilyId })
        .from(schema.templatiPdfRegion)
        .where(eq(schema.templatiPdfRegion.id, precedenteId))
        .limit(1)
      if (!prec) throw new Error(`Template PDF region ${precedenteId} non trovato`)

      // Lock su TUTTE le righe della famiglia, ordinate per id. Niente
      // SELECT...FOR UPDATE con max(): Postgres lo rifiuta ("FOR UPDATE is not
      // allowed with aggregate functions") — quindi blocchiamo le righe e
      // calcoliamo il MAX lato applicazione dal set bloccato.
      // L'ORDER BY garantisce un ordine di lock IDENTICO per ogni transazione
      // concorrente sulla stessa famiglia (a prescindere da quale versione sia
      // il precedenteId di partenza): la seconda si accoda sulla prima riga già
      // bloccata invece di formare un ciclo wait-for → niente deadlock 40P01.
      const famiglia = await tx
        .select({ versione: schema.templatiPdfRegion.versione })
        .from(schema.templatiPdfRegion)
        .where(eq(schema.templatiPdfRegion.templateFamilyId, prec.familyId))
        .orderBy(schema.templatiPdfRegion.id)
        .for('update')
      const prossimaVersione = famiglia.reduce((mx, r) => Math.max(mx, r.versione), 0) + 1

      await tx
        .update(schema.templatiPdfRegion)
        .set({ attivo: false, updatedAt: new Date() })
        .where(and(
          eq(schema.templatiPdfRegion.templateFamilyId, prec.familyId),
          eq(schema.templatiPdfRegion.attivo, true),
        ))

      const [ins] = await tx
        .insert(schema.templatiPdfRegion)
        .values({
          templateFamilyId:      prec.familyId,
          nome:                  data.nome,
          nota:                  data.nota ?? null,
          versione:              prossimaVersione,
          versioneLabel:         oggiVersioneLabel(),
          attivo:                true,
          pageGeometryJson:      data.pageGeometryJson as Record<string, unknown>,
          partiJson:             data.partiJson         as Record<string, unknown>,
          certificatoTemplateId: data.certificatoTemplateId,
          createdBy:             data.createdBy ?? null,
        })
        .returning({ id: schema.templatiPdfRegion.id })

      if (!ins) throw new Error('INSERT nuova versione template PDF region fallito')
      return ins.id
    })

    return (await this.findById(newId))!
  }

  async delete(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [target] = await tx
        .select({ familyId: schema.templatiPdfRegion.templateFamilyId })
        .from(schema.templatiPdfRegion)
        .where(eq(schema.templatiPdfRegion.id, id))
        .limit(1)
      if (!target) return // già assente — delete idempotente

      // Stesso identico pattern/ordine di lock di createNewVersion (righe
      // famiglia, ordinate per id, FOR UPDATE): garantisce che questa
      // transazione e una createNewVersion() concorrente sulla stessa
      // famiglia acquisiscano sempre i lock nello STESSO ordine — niente
      // ciclo wait-for, niente deadlock 40P01.
      const famiglia = await tx
        .select({
          id:       schema.templatiPdfRegion.id,
          versione: schema.templatiPdfRegion.versione,
          attivo:   schema.templatiPdfRegion.attivo,
        })
        .from(schema.templatiPdfRegion)
        .where(eq(schema.templatiPdfRegion.templateFamilyId, target.familyId))
        .orderBy(schema.templatiPdfRegion.id)
        .for('update')

      const row = famiglia.find(r => r.id === id)
      if (!row) return // sparita fra le due select (race concorrente) — niente da fare

      await tx.delete(schema.templatiPdfRegion).where(eq(schema.templatiPdfRegion.id, id))

      // Audit Gate4 M3: se la riga eliminata era la versione ATTIVA, la famiglia
      // resterebbe ORFANA — zero righe attivo=true, viola l'invariante strutturale
      // di H2 (e priva l'utente del template "in uso" senza preavviso). Riattiviamo
      // la versione restante con il numero più alto, se ne resta almeno una;
      // famiglia svuotata → nessuna riattivazione necessaria.
      if (row.attivo) {
        const restanti = famiglia.filter(r => r.id !== id)
        const next = restanti.reduce<typeof restanti[number] | null>(
          (best, r) => (!best || r.versione > best.versione) ? r : best, null,
        )
        if (next) {
          await tx
            .update(schema.templatiPdfRegion)
            .set({ attivo: true, updatedAt: new Date() })
            .where(eq(schema.templatiPdfRegion.id, next.id))
        }
      }
    })
  }
}

// ------------------------------------------------------------

type RowShape = {
  id: string; templateFamilyId: string; nome: string; nota: string | null
  versione: number; versioneLabel: string; attivo: boolean
  pageGeometryJson: unknown; partiJson: unknown
  certificatoTemplateId: string
  createdBy: string | null; createdAt: Date; updatedAt: Date
  createdByUsername: string | null
}

function toRow(r: RowShape): PdfRegionTemplateRow {
  return {
    id:                    r.id,
    templateFamilyId:      r.templateFamilyId,
    nome:                  r.nome,
    nota:                  r.nota,
    versione:              r.versione,
    versioneLabel:         r.versioneLabel,
    attivo:                r.attivo,
    pageGeometryJson:      r.pageGeometryJson,
    partiJson:             r.partiJson,
    certificatoTemplateId: r.certificatoTemplateId,
    createdBy:             r.createdBy         ?? null,
    createdByUsername:     r.createdByUsername ?? null,
    createdAt:             r.createdAt,
    updatedAt:             r.updatedAt,
  }
}

/** Label versione formato AA.MM.GG — mirror convenzione APP_VERSION (puramente cosmetico/audit). */
function oggiVersioneLabel(): string {
  const d  = new Date()
  const aa = String(d.getFullYear() % 100).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const gg = String(d.getDate()).padStart(2, '0')
  return `${aa}.${mm}.${gg}`
}
