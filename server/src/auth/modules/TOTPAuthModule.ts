// ============================================================
// PAYROLL GANG SUITE — TOTP Auth Module
// RFC 6238 — compatibile con Google Authenticator, Authy, ecc.
// ============================================================

import { authenticator } from 'otplib'
import QRCode from 'qrcode'
import { encrypt, decrypt } from '../../services/cryptoService.js'
import { env } from '../../config/env.js'
import type { IAuthModule, AuthRegistrationResult, AuthVerifyResult } from '../IAuthModule.js'

export class TOTPAuthModule implements IAuthModule {
  readonly name = 'totp'

  constructor() {
    // Finestra ±N step (30s ciascuno) per tollerare skew orario
    authenticator.options = {
      window: env.TOTP_WINDOW,
      digits: 6,
      step:   30,
    }
  }

  async register(userId: string, username: string): Promise<AuthRegistrationResult> {
    // 1. Genera secret Base32 crittograficamente sicuro
    const secret = authenticator.generateSecret(32)

    // 2. Costruisce URL otpauth:// (standard RFC 4226)
    const otpauthUrl = authenticator.keyuri(
      username,
      env.TOTP_ISSUER,
      secret,
    )

    // 3. Genera QR code come Data URL (PNG in base64)
    const qrCodeUrl = await QRCode.toDataURL(otpauthUrl, {
      errorCorrectionLevel: 'H',
      width: 256,
    })

    // 4. Cifra il secret con AES-256-GCM prima di salvarlo
    const secretForDb = encrypt(secret)

    // 5. Chiave di backup leggibile (gruppi di 4 caratteri)
    const backupKey = secret.match(/.{1,4}/g)?.join('-') ?? secret

    return { qrCodeUrl, backupKey, secretForDb }
  }

  async verify(
    _userId:   string,
    secretDb:  string,
    token:     string,
    lastToken: string | null,
  ): Promise<AuthVerifyResult> {
    // 1. Decifra il secret
    let secret: string
    try {
      secret = decrypt(secretDb)
    } catch {
      return { valid: false, reason: 'invalid_token' }
    }

    // 2. Previeni replay attack — stesso token già usato con successo
    if (lastToken !== null && lastToken === token) {
      return { valid: false, reason: 'replay' }
    }

    // 3. Verifica OTP
    const isValid = authenticator.verify({ token, secret })
    if (!isValid) {
      return { valid: false, reason: 'invalid_token' }
    }

    return { valid: true }
  }
}
