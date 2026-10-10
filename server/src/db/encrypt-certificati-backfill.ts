// ============================================================
// PAYROLL GANG SUITE — Backfill cifratura certificati (PGS-04)
// Cifra a riposo (AES-256-GCM) `cf` e `dati_json` delle righe ESISTENTI.
// Le nuove righe sono già cifrate dal repository; questo script protegge
// lo storico creato prima della migrazione.
//
// IDEMPOTENTE: le righe già cifrate (cf con 3 segmenti iv:tag:cipher,
// dati_json già in envelope { v, enc }) vengono saltate. Ri-eseguibile.
//
// NB: postgres.js è configurato con transform:postgres.camel (connection.ts)
// → un alias con underscore (es. "dati_text") verrebbe riconvertito in
// camelCase ("datiText"), e la proprietà letta in snake_case risulterebbe
// SEMPRE undefined. Per questo l'alias qui sotto è SENZA underscore
// ("datitext"), come in encrypt-bozze-cf-backfill.ts /
// encrypt-anagrafiche-cf-backfill.ts.
//
// DEFAULT = DRY-RUN: senza --apply lo script legge e verifica soltanto,
// stampa quante righe cifrerebbe, NON scrive nulla.
//
// PRIMA DEL PRIMO --apply REALE: backup della tabella (superuser, come da
// convenzione migrazioni):
//   pg_dump -h <HOST> -U <SUPERUSER> -d <DB> -t certificati -F c \
//     -f certificati_backup_$(date +%Y%m%d_%H%M%S).dump
//
// Uso (VPS, dopo aver allargato la colonna con encrypt_certificati.sql):
//   npm run build:server
//   node --env-file=../.env dist/db/encrypt-certificati-backfill.js            # dry-run
//   node --env-file=../.env dist/db/encrypt-certificati-backfill.js --apply    # scrive
// ============================================================

import { sql } from 'drizzle-orm'
import { db, closeDb } from './connection.js'
import { encrypt } from '../services/cryptoService.js'

type Row = { id: string; cf: string | null; datitext: string | null }
type Update = { id: string; cf?: string; dati?: string }

const APPLY = process.argv.includes('--apply')

/** true se il CF è già cifrato (formato iv:tag:cipher base64). */
function cfEncrypted(cf: string): boolean {
  return cf.split(':').length === 3
}

/** true se dati_json è già un envelope cifrato { v, enc }. */
function datiEncrypted(parsed: unknown): boolean {
  return typeof parsed === 'object' && parsed !== null &&
    typeof (parsed as { enc?: unknown }).enc === 'string'
}

async function main(): Promise<void> {
  console.log(`\n🔒 PGS-04 — Backfill cifratura certificati${APPLY ? '' : ' [DRY-RUN]'}\n`)

  // Alias SENZA underscore (vedi nota in testa al file).
  const rows = await db.execute<Row>(sql`
    SELECT id, cf, dati_json::text AS datitext
    FROM certificati
  `)

  const updates: Update[] = []
  let giaCifrati = 0

  for (const r of rows as unknown as Row[]) {
    // dati_json è NOT NULL in schema: undefined/null/'' qui è un'anomalia
    // di query, non un dato legittimo — niente skip silenzioso.
    if (r.datitext === undefined || r.datitext === null || r.datitext === '') {
      throw new Error(
        `Riga ${r.id}: dati_json letto come ${JSON.stringify(r.datitext)} ` +
        `(colonna NOT NULL in schema — verificare l'alias della query prima di procedere)`
      )
    }

    const update: Update = { id: r.id }

    if (r.cf && r.cf !== '' && !cfEncrypted(r.cf)) {
      update.cf = encrypt(r.cf)
    }

    const parsed = JSON.parse(r.datitext)
    if (!datiEncrypted(parsed)) {
      update.dati = JSON.stringify({ v: 1, enc: encrypt(JSON.stringify(parsed)) })
    }

    if (update.cf !== undefined || update.dati !== undefined) {
      updates.push(update)
    } else {
      giaCifrati++
    }
  }

  console.log(`Righe da cifrare: ${updates.length} · già cifrate: ${giaCifrati}`)

  if (!APPLY) {
    console.log('\nDRY-RUN: nessuna riga modificata. Rilanciare con --apply per scrivere.\n')
    await closeDb()
    process.exit(0)
  }

  let cifrati = 0, errori = 0
  try {
    await db.transaction(async (tx) => {
      for (const u of updates) {
        if (u.cf !== undefined && u.dati !== undefined) {
          await tx.execute(sql`UPDATE certificati SET cf = ${u.cf}, dati_json = ${u.dati}::jsonb WHERE id = ${u.id}`)
        } else if (u.cf !== undefined) {
          await tx.execute(sql`UPDATE certificati SET cf = ${u.cf} WHERE id = ${u.id}`)
        } else {
          await tx.execute(sql`UPDATE certificati SET dati_json = ${u.dati}::jsonb WHERE id = ${u.id}`)
        }
        cifrati++
      }
    })
  } catch (err) {
    errori = 1
    cifrati = 0
    console.error('❌ Transazione annullata (rollback completo, nessuna riga modificata):', (err as Error).message)
  }

  console.log(`\n✅ Fatto. Cifrate: ${cifrati} · già cifrate: ${giaCifrati} · errori: ${errori}\n`)
  await closeDb()
  process.exit(errori > 0 ? 1 : 0)
}

main().catch(async (err) => {
  console.error('❌ Backfill fallito:', err)
  await closeDb()
  process.exit(1)
})
