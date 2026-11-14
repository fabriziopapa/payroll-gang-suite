// ============================================================
// PAYROLL GANG SUITE — PgTrasferimentoRepository
// Quel che il modulo Esporta e importa legge dal catalogo di PostgreSQL:
// le migrazioni registrate e la struttura reale del database, da cui
// lib/trasferimento.ts ricava l'impronta dello schema.
//
// Solo lettura. Niente funzioni XML e niente estensioni: il PostgreSQL di
// produzione e' compilato senza libxml e non ha pgcrypto.
// ============================================================

import { sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type * as schema from '../schema.js'
import type { ITrasferimentoRepository } from '../IRepository.js'

type DB = PostgresJsDatabase<typeof schema>

export class PgTrasferimentoRepository implements ITrasferimentoRepository {
  constructor(private readonly db: DB) {}

  /** Versione e checksum delle migrazioni registrate da pgs-migra.sh (vuoto se il registro non esiste). */
  async migrazioni(): Promise<Array<{ versione: string; checksum: string }>> {
    const [c] = await this.db.execute(sql`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS presente`) as unknown as Array<{ presente: boolean }>
    if (!c?.presente) return []
    const righe = await this.db.execute(sql`SELECT versione, checksum FROM schema_migrations ORDER BY versione`)
    return (righe as unknown as Array<{ versione: string; checksum: string }>).map(r => ({ versione: r.versione, checksum: r.checksum }))
  }

  /**
   * Una riga per colonna, per vincolo e per indice unico dello schema
   * `public`. Dei CHECK entra il NOME, non il testo: PostgreSQL lo
   * riscrive a ogni dump e ripristino. Il registro delle migrazioni e'
   * escluso: ha la sua impronta.
   */
  async struttura(): Promise<string[]> {
    const righe = await this.db.execute(sql`
      SELECT 'C|' || c.relname || '|' || a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull::text AS riga
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped AND c.relname <> 'schema_migrations'
      UNION ALL
      SELECT 'K|' || c.relname || '|' || k.conname || '|' || k.contype::text || '|' || CASE WHEN k.contype = 'c' THEN '' ELSE pg_get_constraintdef(k.oid) END
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname <> 'schema_migrations'
      UNION ALL
      SELECT 'I|' || i.tablename || '|' || i.indexname || '|' || i.indexdef
      FROM pg_indexes i
      WHERE i.schemaname = 'public' AND i.tablename <> 'schema_migrations' AND i.indexdef LIKE 'CREATE UNIQUE%'`)
    return (righe as unknown as Array<{ riga: string }>).map(r => r.riga)
  }
}
