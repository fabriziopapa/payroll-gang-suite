// ============================================================
// PAYROLL GANG SUITE — Backfill cifratura CF nelle bozze (PGS-05)
// Cifra a riposo (AES-256-GCM) i SOLI codici fiscali dentro il JSONB
// `dati` delle bozze ESISTENTI:
//   · nominativi[].codFisc
//   · nominativi[].riferimentoCedolino (se contiene un CF)
//   · dettagli[].riferimentoCedolino   (se contiene un CF)
// Le nuove scritture sono già cifrate dal repository; questo script
// protegge lo storico creato prima della modifica.
//
// IDEMPOTENTE: i valori già cifrati (prefisso PGS05:) vengono saltati.
// Ri-eseguibile senza effetti collaterali.
//
// Uso (VPS):
//   npm run build:server
//   node --env-file=../.env dist/db/encrypt-bozze-cf-backfill.js
// ============================================================

import { sql } from 'drizzle-orm'
import { db, closeDb } from './connection.js'
import { protectCf } from './repositories/PgBozzeRepository.js'

type Row = { id: string; datitext: string | null }

async function main(): Promise<void> {
  console.log('\n🔒 PGS-05 — Backfill cifratura CF nelle bozze\n')

  // Legge dati come TEXT. NB: alias SENZA underscore (`datitext`, non
  // `dati_text`): la connessione usa transform:postgres.camel, che
  // convertirebbe `dati_text` -> `datiText` rendendo la proprietà illeggibile.
  const rows = await db.execute<Row>(sql`
    SELECT id, dati::text AS datitext
    FROM bozze
  `)

  let cifrate = 0, giaCifrate = 0, errori = 0

  for (const r of rows as unknown as Row[]) {
    try {
      if (!r.datitext) { giaCifrate++; continue }
      const parsed = JSON.parse(r.datitext) as unknown
      const next   = protectCf(parsed)
      const nextText = JSON.stringify(next)

      // protectCf è idempotente: se nulla cambia la riga era già protetta
      // (o non contiene CF).
      if (JSON.stringify(parsed) === nextText) { giaCifrate++; continue }

      await db.execute(sql`
        UPDATE bozze SET dati = ${nextText}::jsonb WHERE id = ${r.id}
      `)
      cifrate++
    } catch (err) {
      errori++
      console.error(`  ⚠️  Bozza ${r.id} — errore:`, (err as Error).message)
    }
  }

  console.log(`\n✅ Fatto. Cifrate: ${cifrate} · già protette/senza CF: ${giaCifrate} · errori: ${errori}\n`)
  await closeDb()
  process.exit(errori > 0 ? 1 : 0)
}

main().catch(async (err) => {
  console.error('❌ Backfill fallito:', err)
  await closeDb()
  process.exit(1)
})
