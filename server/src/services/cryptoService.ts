// ============================================================
// PAYROLL GANG SUITE — CryptoService
// AES-256-GCM per dati sensibili a riposo (es. TOTP secrets)
// ============================================================

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { env } from '../config/env.js'

const ALGORITHM  = 'aes-256-gcm'
const IV_LENGTH  = 12   // 96 bit — standard GCM
const TAG_LENGTH = 16   // 128 bit auth tag

/** Chiave derivata dall'env (32 byte da hex 64 chars) */
const KEY = Buffer.from(env.ENCRYPTION_KEY, 'hex')

/**
 * Cifra un testo in chiaro con AES-256-GCM.
 * @returns stringa Base64 nel formato: iv:authTag:ciphertext
 */
export function encrypt(plaintext: string): string {
  const iv         = randomBytes(IV_LENGTH)
  const cipher     = createCipheriv(ALGORITHM, KEY, iv)
  const encrypted  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag    = cipher.getAuthTag()

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':')
}

/**
 * Decifra un testo prodotto da `encrypt`.
 * Lancia un errore se l'auth tag non corrisponde (manomissione).
 */
export function decrypt(payload: string): string {
  const parts = payload.split(':')
  if (parts.length !== 3) throw new Error('Payload cifrato malformato')

  const [ivB64, tagB64, dataB64] = parts as [string, string, string]

  const iv         = Buffer.from(ivB64, 'base64')
  const authTag    = Buffer.from(tagB64, 'base64')
  const ciphertext = Buffer.from(dataB64, 'base64')

  const decipher = createDecipheriv(ALGORITHM, KEY, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return decrypted.toString('utf8')
}

/**
 * Genera N byte casuali crittograficamente sicuri.
 * @returns stringa hex
 */
export function generateSecureToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex')
}

/**
 * Fingerprint non reversibile per il refresh token
 * (hash SHA-256 di userAgent + IP). Funzione sincrona.
 */
export function fingerprintRequest(userAgent: string, ip: string): string {
  return createHash('sha256')
    .update(`${userAgent}|${ip}`)
    .digest('hex')
    .slice(0, 64)
}
