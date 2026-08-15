// ============================================================
// PAYROLL GANG SUITE — Seed CLI
// Crea il primo utente admin e mostra il QR code
// Uso: npm run seed --workspace=server
// ============================================================

import { db, closeDb } from './connection.js'
import { users } from './schema.js'
import { TOTPAuthModule } from '../auth/modules/TOTPAuthModule.js'
import { PgUsersRepository } from './repositories/PgUsersRepository.js'
import { PgAuditRepository } from './repositories/PgAuditRepository.js'
import { PgRefreshTokensRepository } from './repositories/PgRefreshTokensRepository.js'
import { PgJwtBlocklistRepository } from './repositories/PgJwtBlocklistRepository.js'
import { AuthService } from '../auth/AuthService.js'
import readline from 'node:readline/promises'

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

async function main(): Promise<void> {
  console.log('\n🔑 PAYROLL GANG SUITE — Creazione primo utente admin\n')

  // Controlla se esiste già un admin
  const existing = await db.select().from(users).limit(1)
  if (existing.length > 0) {
    console.error('❌ Esistono già utenti nel database. Usa /api/v1/auth/register.')
    process.exit(1)
  }

  const username = await rl.question('Username admin: ')
  if (!username.match(/^[a-zA-Z0-9._-]{3,50}$/)) {
    console.error('❌ Username non valido (3-50 caratteri alfanumerici)')
    process.exit(1)
  }

  const authModule = new TOTPAuthModule()
  const usersRepo  = new PgUsersRepository(db)
  const auditRepo  = new PgAuditRepository(db)
  const authService = new AuthService(
    authModule,
    usersRepo,
    auditRepo,
    new PgRefreshTokensRepository(db),
    new PgJwtBlocklistRepository(db),
  )

  const { userId, activationToken, qrCodeUrl, backupKey } = await authService.registerUser(
    username, true, '127.0.0.1',
  )

  // Il token di attivazione e' salvato in DB solo come hash SHA-256: se non lo
  // si mostra QUI, non e' piu' recuperabile in alcun modo e l'account non puo'
  // essere attivato. Vale 24 ore.
  const { env } = await import('../config/env.js')
  const activateUrl = `${env.CLIENT_ORIGIN[0]}?activate=${activationToken}`

  console.log('\n✅ Utente creato. ID:', userId)
  console.log('\n📱 Scansiona il QR con Google Authenticator / Authy:')
  console.log('   (QR code salvato in admin-qr.html)\n')
  console.log('🔑 Chiave di backup:', backupKey)
  console.log('\n⚠️  Conserva la chiave di backup in un luogo sicuro!\n')
  console.log('🔗 LINK DI ATTIVAZIONE (valido 24 ore, mostrato una sola volta):')
  console.log('  ', activateUrl, '\n')

  // Salva QR in file HTML apribile nel browser
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Admin QR - Payroll Gang Suite</title></head>
<body style="font-family:monospace;text-align:center;padding:2rem">
<h2>Payroll Gang Suite — Admin Setup</h2>
<p>Scansiona con Google Authenticator / Authy</p>
<img src="${qrCodeUrl}" alt="QR Code TOTP" style="width:256px;height:256px"/>
<p><strong>Chiave backup:</strong> ${backupKey}</p>
<p><strong>Link di attivazione</strong> (valido 24 ore):<br>
<a href="${activateUrl}">${activateUrl}</a></p>
<p style="color:red"><strong>Elimina questo file dopo aver configurato l'app!</strong></p>
</body></html>`

  const { writeFileSync } = await import('node:fs')
  writeFileSync('admin-qr.html', html, 'utf-8')

  console.log('📄 Apri admin-qr.html nel browser, scansiona il QR, poi eliminalo (shred -u).')
  console.log('   Il file e\' scritto nella directory di lavoro corrente: con')
  console.log('   `npm run seed --workspace=server` finisce in server/.')
  console.log('   Per completare: apri il link di attivazione e inserisci il primo codice OTP.\n')

  await closeDb()
  rl.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
