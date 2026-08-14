// ============================================================
// PAYROLL GANG SUITE — Test di architettura
//
// Quality gate meccanico: sopra il persistence layer NESSUN modulo
// deve parlare direttamente col database. Il progetto non usa ESLint,
// quindi la regola vive come test e gira con `npm test --workspace=server`.
//
// Cosa NON è vietato: importare le classi Pg*Repository e passare loro
// `app.db`. Le route possono CABLARE un repository, non INTERROGARE il DB.
// Il confine è: nessun import del driver/ORM, nessuna query eseguita qui.
//
// Esenzioni deliberate:
//  · db/**   → è il persistence layer, è casa sua;
//  · app.ts  → composition root: è l'unico punto che, per definizione,
//              conosce le implementazioni concrete e il tipo del pool.
// ============================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = dirname(fileURLToPath(import.meta.url))

/** Cartelle sopra il persistence layer, sorvegliate dal gate. */
const CARTELLE_SORVEGLIATE = ['routes', 'services', 'middleware', 'auth']

/** Pattern che segnalano accesso diretto al database. */
const PATTERN_VIETATI: Array<{ re: RegExp; motivo: string }> = [
  { re: /from\s+['"]drizzle-orm/,          motivo: "import statico di drizzle-orm" },
  { re: /import\(\s*['"]drizzle-orm/,      motivo: "import dinamico di drizzle-orm" },
  { re: /from\s+['"]postgres['"]/,         motivo: "import del driver postgres.js" },
  { re: /import\(\s*['"][^'"]*db\/connection\.js['"]\s*\)/, motivo: "import dinamico della connessione DB" },
  { re: /from\s+['"][^'"]*db\/connection\.js['"]/,          motivo: "import statico della connessione DB" },
  { re: /\.execute\(\s*sql/,               motivo: "esecuzione di SQL grezzo" },
]

function fileTypeScript(dir: string): string[] {
  const out: string[] = []
  for (const voce of readdirSync(dir)) {
    const percorso = join(dir, voce)
    if (statSync(percorso).isDirectory()) {
      out.push(...fileTypeScript(percorso))
    } else if (voce.endsWith('.ts')) {
      out.push(percorso)
    }
  }
  return out
}

test('nessun accesso diretto al DB sopra il persistence layer', () => {
  const violazioni: string[] = []

  for (const cartella of CARTELLE_SORVEGLIATE) {
    for (const file of fileTypeScript(join(SRC, cartella))) {
      const contenuto = readFileSync(file, 'utf-8')
      for (const { re, motivo } of PATTERN_VIETATI) {
        if (re.test(contenuto)) {
          violazioni.push(`${relative(SRC, file).split(sep).join('/')} → ${motivo}`)
        }
      }
    }
  }

  assert.deepEqual(
    violazioni,
    [],
    'Questi moduli accedono direttamente al database: la query va spostata in un ' +
    'repository sotto db/, esposta da un\'interfaccia in db/IRepository.ts e iniettata.\n' +
    violazioni.map(v => `  · ${v}`).join('\n'),
  )
})

test('il persistence layer espone interfacce, non tipi del driver', () => {
  // IRepository.ts è il contratto che il resto dell'applicazione vede:
  // se qui comparisse un tipo di Drizzle, l'ORM diventerebbe una dipendenza
  // del core anche restando formalmente confinato in db/.
  const contratto = readFileSync(join(SRC, 'db', 'IRepository.ts'), 'utf-8')

  for (const { re, motivo } of PATTERN_VIETATI) {
    assert.equal(
      re.test(contratto),
      false,
      `db/IRepository.ts contiene ${motivo}: il contratto deve restare in TypeScript puro.`,
    )
  }
})
