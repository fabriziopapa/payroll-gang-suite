// ============================================================
// PAYROLL GANG SUITE — PgImportLogRepository
// Log delle importazioni anagrafiche SGE (anag_import_log).
// Sostituisce i 3 statement SQL grezzi che stavano dentro
// routes/anagrafiche.ts (import-xlsx): stessi campi, stessi valori.
// ============================================================

import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import type { IImportLogRepository, ImportLogCounters } from '../IRepository.js'

type DB = PostgresJsDatabase<typeof schema>

export class PgImportLogRepository implements IImportLogRepository {
  constructor(private readonly db: DB) {}

  async start(nomeFile: string | null, userId: string | null): Promise<number> {
    const [row] = await this.db
      .insert(schema.anagImportLog)
      .values({
        nomeFile:           nomeFile,
        utenteImportazione: userId,
      })
      .returning({ id: schema.anagImportLog.id })

    if (!row) throw new Error('INSERT anag_import_log fallito')
    return row.id
  }

  async fail(id: number, messaggio: string): Promise<void> {
    await this.db
      .update(schema.anagImportLog)
      .set({
        esito:           'ERRORE',
        messaggioErrore: messaggio,
      })
      .where(eq(schema.anagImportLog.id, id))
  }

  async finish(id: number, c: ImportLogCounters): Promise<void> {
    await this.db
      .update(schema.anagImportLog)
      .set({
        numRecordFile:       c.file,
        numRecordInseriti:   c.inseriti,
        numRecordAggiornati: c.aggiornati,
        numRecordInvariati:  c.invariati,
        numErrori:           c.errori,
        esito:               c.esito,
      })
      .where(eq(schema.anagImportLog.id, id))
  }
}
