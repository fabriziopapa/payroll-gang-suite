// ============================================================
// PAYROLL GANG SUITE — Server Entry Point (Fastify v5)
// ============================================================

import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'

import { env } from './config/env.js'
import { db, closeDb } from './db/connection.js'
import { TOTPAuthModule } from './auth/modules/TOTPAuthModule.js'
import { AuthService } from './auth/AuthService.js'
import { MailerService } from './services/mailerService.js'
import { makeAuthMiddleware } from './middleware/authenticate.js'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type * as schema from './db/schema.js'

// Estende il tipo FastifyInstance con i decorator custom
declare module 'fastify' {
  interface FastifyInstance {
    db:           PostgresJsDatabase<typeof schema>
    authService:  AuthService
    mailer:       MailerService
    authenticate: (req: FastifyRequest, rep: FastifyReply) => Promise<void>
  }
}

// --- Routes (da implementare nelle fasi successive) ---
import { authRoutes }         from './routes/auth.js'
import { usersRoutes }        from './routes/users.js'
import { anagraficheRoutes }  from './routes/anagrafiche.js'
import { vociRoutes }         from './routes/voci.js'
import { bozzeRoutes }        from './routes/bozze.js'
import { settingsRoutes }     from './routes/settings.js'
import { capitoliRoutes }     from './routes/capitoli.js'

// ============================================================

const app = Fastify({
  logger: env.NODE_ENV === 'development' ? {
    transport: { target: 'pino-pretty', options: { colorize: true } },
  } : true,
  trustProxy: true,  // necessario dietro reverse proxy aapanel/nginx
  // Limita dimensione payload a 10MB (sufficiente per file XML HR)
  bodyLimit: 10 * 1024 * 1024,
})

// ------------------------------------------------------------
// Plugin sicurezza
// ------------------------------------------------------------

await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", 'https://challenges.cloudflare.com'],
      styleSrc:       ["'self'", "'unsafe-inline'"],  // Tailwind CSS
      imgSrc:         ["'self'", 'data:'],             // QR code data URL
      frameSrc:       ['https://challenges.cloudflare.com'],  // Turnstile iframe
      connectSrc:     ["'self'", 'https://challenges.cloudflare.com'],
      fontSrc:        ["'self'"],
      objectSrc:      ["'none'"],
      upgradeInsecureRequests: env.NODE_ENV === 'production' ? [] : null,
    },
  },
  hsts: env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
})

await app.register(cors, {
  // Callback esplicita — supporta lista CLIENT_ORIGIN separata da virgole
  origin: (origin, cb) => {
    // Richieste senza Origin (es. curl, server-to-server) sempre consentite
    if (!origin) return cb(null, true)
    if ((env.CLIENT_ORIGIN as string[]).includes(origin)) return cb(null, true)
    cb(new Error('ORIGIN_NOT_ALLOWED'), false)
  },
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
})

await app.register(cookie, {
  secret: env.ENCRYPTION_KEY,  // firma i cookie
  hook:   'onRequest',
})

// Rate limiting globale
await app.register(rateLimit, {
  max:        env.RATE_LIMIT_MAX,
  timeWindow: env.RATE_LIMIT_WINDOW_MS,
  errorResponseBuilder: () => ({
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Troppe richieste. Riprova tra poco.',
  }),
})

// ------------------------------------------------------------
// Dipendenze (Composition Root)
// ------------------------------------------------------------

const totpModule  = new TOTPAuthModule()

// Le repository vengono iniettate qui — swap driver = cambia solo questa sezione
// In futuro: const { createRepositoryFactory } = await import('./db/factory.js')
// const repos = createRepositoryFactory(env.DB_DRIVER)
// Per ora importiamo le implementazioni PostgreSQL direttamente:
const { PgUsersRepository }   = await import('./db/repositories/PgUsersRepository.js')
const { PgAuditRepository }   = await import('./db/repositories/PgAuditRepository.js')

const usersRepo   = new PgUsersRepository(db)
const auditRepo   = new PgAuditRepository(db)
const authService = new AuthService(totpModule, usersRepo, auditRepo)
const authenticate = makeAuthMiddleware(authService)

const mailer = new MailerService({
  host:   env.SMTP_HOST,
  port:   env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  user:   env.SMTP_USER,
  pass:   env.SMTP_PASS,
  from:   env.SMTP_FROM,
})

// ------------------------------------------------------------
// Decorators Fastify (iniettano dipendenze nelle routes)
// ------------------------------------------------------------

app.decorate('authService', authService)
app.decorate('mailer',      mailer)
app.decorate('authenticate', authenticate)
app.decorate('db', db)

// ------------------------------------------------------------
// Routes — versionate sotto /api/v1
// ------------------------------------------------------------

await app.register(authRoutes,        { prefix: '/api/v1/auth' })
await app.register(usersRoutes,       { prefix: '/api/v1/users' })
await app.register(anagraficheRoutes, { prefix: '/api/v1/anagrafiche' })
await app.register(vociRoutes,        { prefix: '/api/v1/voci' })
await app.register(capitoliRoutes,    { prefix: '/api/v1/capitoli' })
await app.register(bozzeRoutes,       { prefix: '/api/v1/bozze' })
await app.register(settingsRoutes,    { prefix: '/api/v1/settings' })

// Health check (no auth) — SEC-M07: solo status minimale, nessuna info di versione/sistema
app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

// ------------------------------------------------------------
// SEC-C02: pulizia periodica jwt_blocklist — ogni ora
// Rimuove i record scaduti per evitare crescita illimitata della tabella
// ------------------------------------------------------------
{
  const { jwtBlocklist } = await import('./db/schema.js')
  const { lt } = await import('drizzle-orm')

  const cleanupJwtBlocklist = async (): Promise<void> => {
    try {
      await db.delete(jwtBlocklist).where(lt(jwtBlocklist.expiresAt, new Date()))
    } catch (err) {
      app.log.warn({ err }, 'Cleanup jwt_blocklist fallito')
    }
  }

  // Prima pulizia dopo 1 minuto dall'avvio, poi ogni ora.
  // FIX D: conserva il riferimento all'interval e lo cancella nell'hook onClose
  // per permettere a Node.js di drenare l'event loop durante il graceful shutdown
  // (PM2 kill_timeout non deve scattare per un setInterval fantasma).
  let cleanupInterval: ReturnType<typeof setInterval> | undefined

  setTimeout(() => {
    void cleanupJwtBlocklist()
    cleanupInterval = setInterval(() => { void cleanupJwtBlocklist() }, 60 * 60 * 1000)
  }, 60 * 1000)

  app.addHook('onClose', async () => {
    if (cleanupInterval !== undefined) {
      clearInterval(cleanupInterval)
      cleanupInterval = undefined
    }
  })
}

// ------------------------------------------------------------
// Avvio
// ------------------------------------------------------------

const start = async (): Promise<void> => {
  try {
    await app.listen({ port: env.PORT, host: '127.0.0.1' })
    app.log.info(`Payroll Gang Suite server avviato su porta ${env.PORT}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

// Graceful shutdown
const shutdown = async (): Promise<void> => {
  app.log.info('Graceful shutdown in corso...')
  await app.close()
  await closeDb()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT',  shutdown)

await start()
