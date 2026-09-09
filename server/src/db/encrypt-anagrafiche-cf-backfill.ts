// ============================================================
// PAYROLL GANG SUITE — Backfill cifratura anagrafiche.cod_fis (F-1)
// Cifra a riposo (AES-256-GCM) il CF delle righe ESISTENTI in `anagrafiche`.
// Le nuove righe/import sono già cifrate dal repository; questo script protegge
// lo storico creato prima della migrazione.
//
// IDEMPOTENTE: le righe già cifrate (cod_fis con 3 segmenti iv:tag:cipher)
// vengono saltate. Ri-eseguibile senza doppia cifratura.
//
// PREREQUISITO: la colonna cod_fis deve essere già VARCHAR(255) (setup.sql /
// ALTER TABLE anagrafiche ALTER COLUMN cod_fis TYPE VARCHAR(255)). Va eseguito
// DOPO aver deployato il codice che cifra in scrittura.
//
// Uso (VPS):
//   npm run build:server
//   node --env-file=../.env dist/db/encrypt-anagrafiche-cf-backfill.js
//
// NB: postgres.js è configurato con transform camel (connection.ts) → nella
// query raw uso la colonna cod_fis, che arriva qui come proprietà camelCase
// `codFis`. (Evito alias con underscore, che diventerebbero camelCase.)
// ============================================================

import { sql } from 'drizzle-orm'
import { db, closeDb } from './connection.js'
import { encrypt } from '../services/cryptoService.js'

type Row = { id: number; codFis: string | null }

/** true se il CF è già cifrato (formato iv:tag:cipher base64, 3 segmenti). */
function cfEncrypted(cf: string): boolean {
  return cf.split(':').length === 3
}

async function main(): Promise<void> {
  console.log('\n🔒 F-1 — Backfill cifratura anagrafiche.cod_fis\n')

  const rows = await db.execute<Row>(sql`
    SELECT id, cod_fis
    FROM anagrafiche
    WHERE cod_fis IS NOT NULL AND cod_fis <> ''
  `)

  let cifrati = 0, giaCifrati = 0, errori = 0

  for (const r of rows as unknown as Row[]) {
    try {
      if (!r.codFis || cfEncrypted(r.codFis)) { giaCifrati++; continue }
      const enc = encrypt(r.codFis)
      await db.execute(sql`UPDATE anagrafiche SET cod_fis = ${enc} WHERE id = ${r.id}`)
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
