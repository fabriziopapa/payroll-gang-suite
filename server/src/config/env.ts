// ============================================================
// PAYROLL GANG SUITE — Configurazione Ambiente
// Validazione Zod a runtime — fallisce in avvio se mancano variabili
// ============================================================

import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(3001),
  CLIENT_ORIGIN: z.string().url(),

  // Database
  DB_DRIVER: z.enum(['postgres']).default('postgres'),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().default(5432),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  // SEC-H05: default true — le connessioni in produzione devono essere cifrate.
  // Per sviluppo locale con PostgreSQL senza TLS, impostare DB_SSL=false nel .env
  DB_SSL: z.enum(['true', 'false']).default('true').transform(v => v === 'true'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_POOL_IDLE_TIMEOUT: z.coerce.number().int().default(30000),
  DB_CONNECTION_TIMEOUT: z.coerce.number().int().default(5000),

  // JWT ES256
  JWT_PRIVATE_KEY_BASE64: z.string().min(1),
  JWT_PUBLIC_KEY_BASE64: z.string().min(1),
  JWT_ACCESS_EXPIRES: z.string().default('15m'),
  JWT_REFRESH_EXPIRES: z.string().default('7d'),

  // Crittografia AES-256-GCM (hex 64 chars = 32 bytes)
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/, {
    message: 'ENCRYPTION_KEY deve essere hex a 64 caratteri (32 byte)',
  }),

  // Rate limiting
  RATE_LIMIT_MAX: z.coerce.number().int().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().default(60000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().default(5),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().default(300000),

  // TOTP
  TOTP_ISSUER: z.string().default('PayrollGangSuite'),
  TOTP_WINDOW: z.coerce.number().int().min(0).max(2).default(1),

  // Cloudflare Turnstile (opzionale — se assente, verifica CAPTCHA saltata)
  TURNSTILE_SECRET_KEY: z.string().optional(),

  // SMTP mailer (opzionale — il server parte senza, ma non invia email)
  SMTP_HOST:   z.string().optional(),
  SMTP_PORT:   z.coerce.number().int().default(587),
  SMTP_SECURE: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  SMTP_USER:   z.string().optional(),
  SMTP_PASS:   z.string().optional(),
  SMTP_FROM:   z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Configurazione ambiente non valida:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data

/** Chiavi JWT decodificate da Base64 (usate da AuthService) */
export const jwtKeys = {
  private: Buffer.from(env.JWT_PRIVATE_KEY_BASE64, 'base64').toString('utf-8'),
  public:  Buffer.from(env.JWT_PUBLIC_KEY_BASE64,  'base64').toString('utf-8'),
} as const

/**
 * Converte una stringa di durata tipo '7d', '24h', '30m', '3600s' in millisecondi.
 * Usato per derivare i valori numerici da JWT_REFRESH_EXPIRES.
 */
export function parseDurationMs(s: string): number {
  const m = s.match(/^(\d+)(ms|s|m|h|d)$/)
  if (!m) throw new Error(`parseDurationMs: formato non valido "${s}" — usa es. 7d, 24h, 30m, 3600s`)
  const n = parseInt(m[1], 10)
  switch (m[2]) {
    case 'ms': return n
    case 's':  return n * 1_000
    case 'm':  return n * 60 * 1_000
    case 'h':  return n * 3_600 * 1_000
    case 'd':  return n * 86_400 * 1_000
    default:   throw new Error(`parseDurationMs: unità sconosciuta "${m[2]}"`)
  }
}

/**
 * Durata del refresh token in millisecondi — derivata da JWT_REFRESH_EXPIRES.
 * Unica sorgente di verità: cambiare JWT_REFRESH_EXPIRES in .env aggiorna
 * automaticamente sia la scadenza del token in DB sia il maxAge del cookie.
 */
export const REFRESH_TOKEN_MS = parseDurationMs(env.JWT_REFRESH_EXPIRES)
