// ============================================================
// PAYROLL GANG SUITE — Backfill cifratura certificati (PGS-04)
// Cifra a riposo (AES-256-GCM) `cf` e `dati_json` delle righe ESISTENTI.
// Le nuove righe sono già cifrate dal repository; questo script protegge
// lo storico creato prima della migrazione.
//
// IDEMPOTENTE: le righe già cifrate (cf con 3 segmenti iv:tag:cipher,
// dati_json già in envelope { v, enc }) vengono saltate. Ri-eseguibile.
//
// Uso (VPS, dopo aver allargato la colonna con encrypt_certificati.sql):
//   npm run build:server
//   node --env-file=../.env dist/db/encrypt-certificati-backfill.js
// ============================================================

import { sql } from 'drizzle-orm'
import { db, closeDb } from './connection.js'
import { encrypt } from '../services/cryptoService.js'

type Row = { id: string; cf: string | null; dati_text: string | null }

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
  console.log('\n🔒 PGS-04 — Backfill cifratura certificati\n')

  // Legge dati_json come TEXT: preserva le chiavi snake_case senza camelize.
  const rows = await db.execute<Row>(sql`
    SELECT id, cf, dati_json::text AS dati_text
    FROM certificati
  `)

  let cifrati = 0, giaCifrati = 0, errori = 0

  for (const r of rows as unknown as Row[]) {
    try {
      const setParts: string[] = []

      // ── cf ────────────────────────────────────────────────
      let nextCf: string | null | undefined
      if (r.cf && r.cf !== '' && !cfEncrypted(r.cf)) {
        nextCf = encrypt(r.cf)
      }

      // ── dati_json ─────────────────────────────────────────
      let nextDati: string | undefined
      const parsed = r.dati_text ? JSON.parse(r.dati_text) : null
      if (!datiEncrypted(parsed)) {
        const envelope = { v: 1, enc: encrypt(JSON.stringify(parsed)) }
        nextDati = JSON.stringify(envelope)
      }

      if (nextCf === undefined && nextDati === undefined) { giaCifrati++; continue }

      // UPDATE mirato — solo i campi effettivamente cambiati
      if (nextCf !== undefined && nextDati !== undefined) {
        await db.execute(sql`
          UPDATE certificati SET cf = ${nextCf}, dati_json = ${nextDati}::jsonb WHERE id = ${r.id}
        `)
      } else if (nextCf !== undefined) {
        await db.execute(sql`UPDATE certificati SET cf = ${nextCf} WHERE id = ${r.id}`)
      } else {
        await db.execute(sql`UPDATE certificati SET dati_json = ${nextDati}::jsonb WHERE id = ${r.id}`)
      }
      cifrati++
    } catch (err) {
      errori++
      console.error(`  ⚠️  Riga ${r.id} — errore:`, (err as Error).message)
    }
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
