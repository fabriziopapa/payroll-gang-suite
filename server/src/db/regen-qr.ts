// ============================================================
// PAYROLL GANG SUITE — Rigenera QR per utente esistente
// Uso: tsx --env-file=../.env src/db/regen-qr.ts
// ============================================================

import { db, closeDb } from './connection.js'
import { users } from './schema.js'
import { decrypt } from '../services/cryptoService.js'
import { authenticator } from 'otplib'
import QRCode from 'qrcode'
import { writeFileSync } from 'node:fs'
import { env } from '../config/env.js'
import { eq } from 'drizzle-orm'
import readline from 'node:readline/promises'

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

async function main(): Promise<void> {
  console.log('\n🔄 PAYROLL GANG SUITE — Rigenera QR utente esistente\n')

  const username = await rl.question('Username: ')

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1)

  if (!user) {
    console.error(`❌ Utente "${username}" non trovato.`)
    process.exit(1)
  }

  // Decifra il secret esistente
  const secret = decrypt(user.totpSecret)

  // Rigenera URL QR con lo stesso secret
  const otpauthUrl = authenticator.keyuri(username, env.TOTP_ISSUER, secret)
  const qrCodeUrl  = await QRCode.toDataURL(otpauthUrl, {
    errorCorrectionLevel: 'H',
    width: 256,
  })

  const backupKey = secret.match(/.{1,4}/g)?.join('-') ?? secret

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>QR Rigenerat - Payroll Gang Suite</title></head>
<body style="font-family:monospace;text-align:center;padding:2rem">
<h2>Payroll Gang Suite — QR Rigenerato</h2>
<p>Utente: <strong>${username}</strong></p>
<img src="${qrCodeUrl}" alt="QR Code TOTP" style="width:256px;height:256px"/>
<p><strong>Chiave backup:</strong> ${backupKey}</p>
<p style="color:red"><strong>Elimina questo file dopo aver configurato l'app!</strong></p>
</body></html>`

  writeFileSync('admin-qr.html', html, 'utf-8')

  console.log('\n✅ QR rigenerato → admin-qr.html')
  console.log('🔑 Chiave di backup:', backupKey)
  console.log('\n⚠️  Elimina admin-qr.html dopo la scansione.\n')

  await closeDb()
  rl.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
