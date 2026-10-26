// ============================================================
// PAYROLL GANG SUITE — PgVersamentiRepository
//
// Rubrica degli enti e modelli mail del modulo Versamenti enti
// (migrazione 0021). Nessun dato personale passa di qui: le righe della
// stampa versamenti restano nel browser.
// ============================================================

import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import type {
  IVersamentiRepository, VersamentoEnteRow, VersamentoModelloRow,
  VersamentoModelloInput, EsitoSincronizzaEnti, EsitoImportEnti,
} from '../IRepository.js'
import { pianoImport, type RigaImportEnte } from '../../lib/versamenti.js'

type DB = PostgresJsDatabase<typeof schema>
type RigaEnte = typeof schema.versamentiEnti.$inferSelect
type RigaModello = typeof schema.versamentiModelli.$inferSelect

/** Oggi a Roma, 'AAAA-MM-GG': l'ufficio lavora in quel fuso. */
const oggi = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date())

/**
 * Sincronizzazione e import scrivono la rubrica in blocco: un lucchetto di
 * transazione li mette in fila. FOR UPDATE da solo non basta, perche' non
 * blocca le righe che ancora non esistono (due import con lo stesso ente
 * nuovo → chiave duplicata → 500).
 */
const lucchettoRubrica = sql`SELECT pg_advisory_xact_lock(hashtext('pgs.versamenti_enti'))`

function violazioneUnica(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null
  return e?.code === '23505' || e?.cause?.code === '23505'
}

export class PgVersamentiRepository implements IVersamentiRepository {
  constructor(private readonly db: DB) {}

  // ── Enti ──────────────────────────────────────────────────
  async enti(): Promise<VersamentoEnteRow[]> {
    const rows = await this.db.select().from(schema.versamentiEnti)
      .orderBy(asc(schema.versamentiEnti.descrizione), asc(schema.versamentiEnti.codice))
    return rows.map(toEnte)
  }

  async ente(codice: string): Promise<VersamentoEnteRow | null> {
    const [r] = await this.db.select().from(schema.versamentiEnti).where(eq(schema.versamentiEnti.codice, codice))
    return r ? toEnte(r) : null
  }

  async sincronizzaEnti(
    enti: Array<{ codice: string; descrizione: string }>, file: string, userId: string | null,
  ): Promise<EsitoSincronizzaEnti> {
    if (!enti.length) return { nuovi: [], descrizioni: [] }
    const giorno = oggi()
    return this.db.transaction(async tx => {
      await tx.execute(lucchettoRubrica)
      const codici = enti.map(e => e.codice)
      const esistenti = new Map(
        (await tx.select({ codice: schema.versamentiEnti.codice, descrizione: schema.versamentiEnti.descrizione })
          .from(schema.versamentiEnti)
          .where(inArray(schema.versamentiEnti.codice, codici))
          .for('update'))
          .map(r => [r.codice, r.descrizione]),
      )
      const nuovi = enti.filter(e => !esistenti.has(e.codice))
      const descrizioni = enti
        .filter(e => esistenti.has(e.codice) && e.descrizione && esistenti.get(e.codice) !== e.descrizione)
        .map(e => ({ codice: e.codice, prima: esistenti.get(e.codice)!, dopo: e.descrizione }))

      if (nuovi.length) {
        await tx.insert(schema.versamentiEnti).values(nuovi.map(e => ({
          codice: e.codice, descrizione: e.descrizione || e.codice,
          ultimoFile: file, ultimoVisto: giorno, createdBy: userId, updatedBy: userId,
        })))
      }
      for (const d of descrizioni) {
        await tx.update(schema.versamentiEnti)
          .set({ descrizione: d.dopo, updatedAt: new Date(), updatedBy: userId })
          .where(eq(schema.versamentiEnti.codice, d.codice))
      }
      // "Visto in questo file": non e' una modifica dell'ente, quindi non
      // tocca updated_at / updated_by.
      await tx.update(schema.versamentiEnti)
        .set({ ultimoFile: file, ultimoVisto: giorno })
        .where(inArray(schema.versamentiEnti.codice, codici))

      return { nuovi: nuovi.map(e => e.codice), descrizioni }
    })
  }

  async aggiornaEnte(
    codice: string, patch: { email?: string[]; abilitato?: boolean; modelloId?: string | null }, userId: string | null,
  ): Promise<VersamentoEnteRow | null> {
    const set: Partial<typeof schema.versamentiEnti.$inferInsert> = { updatedAt: new Date(), updatedBy: userId }
    if (patch.email !== undefined) set.email = patch.email
    if (patch.abilitato !== undefined) set.abilitato = patch.abilitato
    if (patch.modelloId !== undefined) set.modelloId = patch.modelloId
    const [r] = await this.db.update(schema.versamentiEnti).set(set)
      .where(eq(schema.versamentiEnti.codice, codice)).returning()
    return r ? toEnte(r) : null
  }

  async importaEnti(righe: RigaImportEnte[], userId: string | null): Promise<EsitoImportEnti> {
    if (!righe.length) return { nuovi: [], aggiornati: [], saltati: [], invariati: [] }
    return this.db.transaction(async tx => {
      await tx.execute(lucchettoRubrica)
      const codici = [...new Set(righe.map(r => r.codice))]
      const esistenti = new Map(
        (await tx.select({ codice: schema.versamentiEnti.codice, email: schema.versamentiEnti.email, abilitato: schema.versamentiEnti.abilitato })
          .from(schema.versamentiEnti)
          .where(inArray(schema.versamentiEnti.codice, codici))
          .for('update'))
          .map(r => [r.codice, { email: r.email ?? [], abilitato: r.abilitato }]),
      )
      const piano = pianoImport(righe, esistenti)
      if (piano.nuovi.length) {
        await tx.insert(schema.versamentiEnti).values(piano.nuovi.map(r => ({
          codice: r.codice, descrizione: r.descrizione || r.codice, email: r.email, abilitato: r.abilitato,
          createdBy: userId, updatedBy: userId,
        })))
      }
      for (const r of piano.aggiorna) {
        // La descrizione resta quella di PGS (viene dalla stampa CSA).
        await tx.update(schema.versamentiEnti)
          .set({ email: r.email, abilitato: r.abilitato, updatedAt: new Date(), updatedBy: userId })
          .where(eq(schema.versamentiEnti.codice, r.codice))
      }
      return { nuovi: piano.nuovi.map(r => r.codice), aggiornati: piano.aggiorna.map(r => r.codice), saltati: piano.saltati, invariati: piano.invariati }
    })
  }

  // ── Modelli ───────────────────────────────────────────────
  async modelli(): Promise<VersamentoModelloRow[]> {
    const rows = await this.db.select().from(schema.versamentiModelli)
      .orderBy(sql`${schema.versamentiModelli.predefinito} DESC`, asc(schema.versamentiModelli.nome))
    return rows.map(toModello)
  }

  async modello(id: string): Promise<VersamentoModelloRow | null> {
    const [r] = await this.db.select().from(schema.versamentiModelli).where(eq(schema.versamentiModelli.id, id))
    return r ? toModello(r) : null
  }

  private async nomeUsato(nome: string, tranneId?: string): Promise<boolean> {
    const cond = sql`lower(${schema.versamentiModelli.nome}) = lower(${nome})`
    const [r] = await this.db.select({ id: schema.versamentiModelli.id }).from(schema.versamentiModelli)
      .where(tranneId ? and(cond, ne(schema.versamentiModelli.id, tranneId)) : cond).limit(1)
    return !!r
  }

  async creaModello(m: VersamentoModelloInput, userId: string | null): Promise<VersamentoModelloRow | 'nome-duplicato'> {
    if (await this.nomeUsato(m.nome)) return 'nome-duplicato'
    try {
      const [r] = await this.db.insert(schema.versamentiModelli).values({
        nome: m.nome, oggetto: m.oggetto, testo: m.testo, allegati: m.allegati,
        predefinito: false, createdBy: userId, updatedBy: userId,
      }).returning()
      return toModello(r!)
    } catch (err) {
      if (violazioneUnica(err)) return 'nome-duplicato'
      throw err
    }
  }

  async aggiornaModello(id: string, m: VersamentoModelloInput, userId: string | null): Promise<VersamentoModelloRow | 'nome-duplicato' | null> {
    if (await this.nomeUsato(m.nome, id)) return 'nome-duplicato'
    try {
      const [r] = await this.db.update(schema.versamentiModelli).set({
        nome: m.nome, oggetto: m.oggetto, testo: m.testo, allegati: m.allegati,
        updatedAt: new Date(), updatedBy: userId,
      }).where(eq(schema.versamentiModelli.id, id)).returning()
      return r ? toModello(r) : null
    } catch (err) {
      if (violazioneUnica(err)) return 'nome-duplicato'
      throw err
    }
  }

  async impostaPredefinito(id: string, userId: string | null): Promise<VersamentoModelloRow | null> {
    return this.db.transaction(async tx => {
      const [esiste] = await tx.select({ id: schema.versamentiModelli.id }).from(schema.versamentiModelli)
        .where(eq(schema.versamentiModelli.id, id)).for('update')
      if (!esiste) return null
      // Prima si toglie, poi si da': l'indice unico parziale non tollera
      // due predefiniti nemmeno per un istante.
      await tx.update(schema.versamentiModelli).set({ predefinito: false })
        .where(and(eq(schema.versamentiModelli.predefinito, true), ne(schema.versamentiModelli.id, id)))
      const [r] = await tx.update(schema.versamentiModelli)
        .set({ predefinito: true, updatedAt: new Date(), updatedBy: userId })
        .where(eq(schema.versamentiModelli.id, id)).returning()
      return r ? toModello(r) : null
    })
  }

  async eliminaModello(id: string): Promise<{ esito: 'fatto'; entiRiportati: number } | { esito: 'predefinito' } | { esito: 'non-trovato' }> {
    return this.db.transaction(async tx => {
      const [m] = await tx.select().from(schema.versamentiModelli)
        .where(eq(schema.versamentiModelli.id, id)).for('update')
      if (!m) return { esito: 'non-trovato' as const }
      if (m.predefinito) return { esito: 'predefinito' as const }
      const riportati = await tx.update(schema.versamentiEnti).set({ modelloId: null })
        .where(eq(schema.versamentiEnti.modelloId, id)).returning({ codice: schema.versamentiEnti.codice })
      await tx.delete(schema.versamentiModelli).where(eq(schema.versamentiModelli.id, id))
      return { esito: 'fatto' as const, entiRiportati: riportati.length }
    })
  }
}

function toEnte(r: RigaEnte): VersamentoEnteRow {
  return {
    codice:      r.codice,
    descrizione: r.descrizione,
    email:       r.email ?? [],
    abilitato:   r.abilitato,
    modelloId:   r.modelloId ?? null,
    ultimoFile:  r.ultimoFile ?? null,
    ultimoVisto: r.ultimoVisto ?? null,
    updatedAt:   r.updatedAt,
  }
}

function toModello(r: RigaModello): VersamentoModelloRow {
  return {
    id:          r.id,
    nome:        r.nome,
    oggetto:     r.oggetto,
    testo:       r.testo,
    allegati:    r.allegati,
    predefinito: r.predefinito,
    updatedAt:   r.updatedAt,
  }
}
