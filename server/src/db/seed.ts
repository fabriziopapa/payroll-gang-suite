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
  const authService = new AuthService(authModule, usersRepo, auditRepo)

  const { userId, qrCodeUrl, backupKey } = await authService.registerUser(
    username, true, '127.0.0.1',
  )

  console.log('\n✅ Utente creato. ID:', userId)
  console.log('\n📱 Scansiona il QR con Google Authenticator / Authy:')
  console.log('   (QR code salvato in admin-qr.html)\n')
  console.log('🔑 Chiave di backup:', backupKey)
  console.log('\n⚠️  Conserva la chiave di backup in un luogo sicuro!\n')

  // Salva QR in file HTML apribile nel browser
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Admin QR - Payroll Gang Suite</title></head>
<body style="font-family:monospace;text-align:center;padding:2rem">
<h2>Payroll Gang Suite — Admin Setup</h2>
<p>Scansiona con Google Authenticator / Authy</p>
<img src="${qrCodeUrl}" alt="QR Code TOTP" style="width:256px;height:256px"/>
<p><strong>Chiave backup:</strong> ${backupKey}</p>
<p style="color:red"><strong>Elimina questo file dopo aver configurato l'app!</strong></p>
</body></html>`

  const { writeFileSync } = await import('node:fs')
  writeFileSync('admin-qr.html', html, 'utf-8')

  console.log('📄 Apri admin-qr.html nel browser, scansiona il QR, poi eliminalo.')
  console.log('   Poi chiama POST /api/v1/auth/activate con userId e il primo OTP.\n')

  await closeDb()
  rl.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
