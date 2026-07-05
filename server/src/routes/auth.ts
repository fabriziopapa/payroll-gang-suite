// ============================================================
// PAYROLL GANG SUITE — Routes Auth (/api/v1/auth)
// ============================================================

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AuthService } from '../auth/AuthService.js'
import { requireAdmin } from '../middleware/authenticate.js'
import { env, REFRESH_TOKEN_MS } from '../config/env.js'
import { PgSettingsRepository } from '../db/repositories/PgSettingsRepository.js'

// SEC-A3 — Fail-closed: se Turnstile è ATTIVO (secret configurata + toggle
// runtime `turnstileEnabled` non disattivato), il token è obbligatorio e la
// verifica deve riuscire. Errore di rete verso Cloudflare ⇒ login rifiutato
// (resta il rate limit come protezione, ma il CAPTCHA non è più bypassabile
// causando un timeout). Se la secret manca o il toggle è spento ⇒ skip.
async function verifyTurnstile(
  enabled: boolean,
  token: string | undefined,
  ip: string,
): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY || !enabled) return true
  if (!token) return false
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
      signal:  AbortSignal.timeout(5000),
    })
    const data = await res.json() as { success: boolean }
    return data.success
  } catch {
    return false
  }
}
// MailerService è accessibile tramite app.mailer (decorato in app.ts)

const REFRESH_COOKIE = 'pgs_refresh'

const COOKIE_OPTS = {
  httpOnly:  true,
  secure:    process.env['NODE_ENV'] === 'production',
  sameSite:  'strict' as const,
  path:      '/api/v1/auth',
  // FIX: derivato da JWT_REFRESH_EXPIRES — allineato alla scadenza del token in DB
  maxAge:    Math.floor(REFRESH_TOKEN_MS / 1000),
}

export async function authRoutes(app: FastifyInstance): Promise<void> {

  // SEC-A3: toggle runtime letto dal DB a ogni tentativo (endpoint già
  // rate-limitati). Default true: se la chiave non è mai stata scritta
  // il comportamento coincide con /settings/public.
  const settingsRepo = new PgSettingsRepository(app.db)
  const turnstileEnabled = async (): Promise<boolean> =>
    (await settingsRepo.get<boolean>('turnstileEnabled')) !== false

  // ----------------------------------------------------------
  // GET /api/v1/auth/me — identità utente corrente
  // NOTA: fuori dal rate limit auth stretto — ha già un JWT valido,
  // non è un tentativo di autenticazione. Coperto solo dal global RL (100/60s).
  // ----------------------------------------------------------
  app.get('/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    return reply.send({ user: request.user })
  })

  // Rate limit stretto sugli endpoint di autenticazione critica
  await app.register(import('@fastify/rate-limit'), {
    max:        env.AUTH_RATE_LIMIT_MAX,
    timeWindow: env.AUTH_RATE_LIMIT_WINDOW_MS,
  })

  // ----------------------------------------------------------
  // POST /api/v1/auth/register — solo admin
  // ----------------------------------------------------------
  app.post('/register', {
    preHandler: [app.authenticate, requireAdmin],
  }, async (request, reply) => {
    const schema = z.object({
      // Username = indirizzo email
      username: z.string().email().max(100),
      isAdmin:  z.boolean().default(false),
    })
    const body = schema.parse(request.body)

    const result = await app.authService.registerUser(
      body.username,
      body.isAdmin,
      request.ip,
    )

    // FIX L-3: invia la risposta prima dell'email — sendQrCode è fire-and-forget.
    // Il client riceve immediatamente il 201 senza attendere l'I/O SMTP.
    // QR code restituito UNA SOLA VOLTA — non viene mai riloggato.
    // emailSent = false in questa risposta; l'email è best-effort asincrono.
    reply.code(201).send({ ...result, emailSent: app.mailer.isConfigured() })

    // Invia QR via email dopo aver già risposto al client (truly fire-and-forget)
    if (app.mailer.isConfigured()) {
      // FIX #4: URL contiene il token opaco (non l'UUID utente)
      const activateUrl = `${env.CLIENT_ORIGIN[0]}?activate=${result.activationToken}`
      app.mailer.sendQrCode({
        to:          body.username,
        username:    body.username,
        qrCodeUrl:   result.qrCodeUrl,
        backupKey:   result.backupKey,
        activateUrl,
      }).catch((mailErr: unknown) => {
        app.log.warn({ mailErr }, 'Invio email QR fallito — l\'utente è stato creato ugualmente')
      })
    }
  })

  // ----------------------------------------------------------
  // POST /api/v1/auth/activate — primo OTP dopo scansione QR
  // FIX #4: accetta token opaco (non userId) con scadenza 24h
  // ----------------------------------------------------------
  app.post('/activate', async (request, reply) => {
    const schema = z.object({
      activationToken:  z.string().length(64).regex(/^[0-9a-f]{64}$/),
      token:            z.string().length(6).regex(/^\d{6}$/),
      cfTurnstileToken: z.string().optional(),
    })
    const { activationToken, token, cfTurnstileToken } = schema.parse(request.body)

    if (!(await verifyTurnstile(await turnstileEnabled(), cfTurnstileToken, request.ip))) {
      return reply.code(400).send({ error: 'CAPTCHA_FAILED' })
    }

    try {
      const ok = await app.authService.activateUser(activationToken, token)
      if (!ok) return reply.code(400).send({ error: 'ACTIVATION_FAILED' })
      return reply.send({ success: true })
    } catch (err: any) {
      if (err.message === 'ACTIVATION_TOKEN_EXPIRED') {
        return reply.code(400).send({ error: 'ACTIVATION_TOKEN_EXPIRED' })
      }
      throw err
    }
  })

  // ----------------------------------------------------------
  // POST /api/v1/auth/login
  // ----------------------------------------------------------
  app.post('/login', async (request, reply) => {
    const schema = z.object({
      username:         z.string().min(1).max(100),
      token:            z.string().length(6).regex(/^\d{6}$/),
      cfTurnstileToken: z.string().optional(),
    })
    const { username, token, cfTurnstileToken } = schema.parse(request.body)

    if (!(await verifyTurnstile(await turnstileEnabled(), cfTurnstileToken, request.ip))) {
      return reply.code(400).send({ error: 'CAPTCHA_FAILED' })
    }

    let result
    try {
      result = await app.authService.login(
        username, token,
        request.headers['user-agent'] ?? '',
        request.ip,
      )
    } catch (err: any) {
      // SEC-M01: account bloccato — informazione differenziata
      if (err.message === 'ACCOUNT_LOCKED') {
        return reply.code(423).send({ error: 'ACCOUNT_LOCKED' })
      }
      // Risposta generica — non rivela se l'utente esiste
      return reply.code(401).send({ error: 'AUTH_FAILED' })
    }

    // Refresh token → HttpOnly cookie (non accessibile da JS)
    reply.setCookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTS)

    return reply.send({
      accessToken: result.accessToken,
      user:        result.user,
    })
  })

  // ----------------------------------------------------------
  // POST /api/v1/auth/refresh
  // Limite dedicato generoso (override del RL auth stretto): chiamato a ogni
  // reload/multi-tab, cookie-gated con token ad alta entropia → 5/5min rompeva
  // la UX (5 F5 = logout apparente). /login resta a AUTH_RATE_LIMIT_MAX.
  // ----------------------------------------------------------
  app.post('/refresh', {
    config: {
      rateLimit: {
        max:        env.REFRESH_RATE_LIMIT_MAX,
        timeWindow: env.AUTH_RATE_LIMIT_WINDOW_MS,
      },
    },
  }, async (request, reply) => {
    const rawToken = request.cookies[REFRESH_COOKIE]
    if (!rawToken) return reply.code(401).send({ error: 'NO_REFRESH_TOKEN' })

    let tokens
    try {
      tokens = await app.authService.refresh(
        rawToken,
        request.headers['user-agent'] ?? '',
        request.ip,
      )
    } catch (err: any) {
      reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' })
      return reply.code(401).send({ error: err.message ?? 'REFRESH_FAILED' })
    }

    reply.setCookie(REFRESH_COOKIE, tokens.newRefreshToken, COOKIE_OPTS)
    return reply.send({ accessToken: tokens.accessToken, user: tokens.user })
  })

  // ----------------------------------------------------------
  // POST /api/v1/auth/logout
  // SEC-C02: estrae anche il JWT access token dall'Authorization header
  // per inserirlo nella blocklist ed evitare uso post-logout (finestra 15m)
  // ----------------------------------------------------------
  app.post('/logout', async (request, reply) => {
    const rawRefreshToken = request.cookies[REFRESH_COOKIE]
    // Estrai JWT grezzo dall'header Authorization (se presente)
    const authHeader      = request.headers.authorization
    const rawAccessToken  = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : undefined

    if (rawRefreshToken) {
      await app.authService.logout(rawRefreshToken, rawAccessToken)
    }

    reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' })
    return reply.send({ success: true })
  })

}
