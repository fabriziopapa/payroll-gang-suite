// ============================================================
// PAYROLL GANG SUITE — Middleware Autenticazione
// Verifica JWT ES256 su ogni richiesta protetta
// ============================================================

import type { FastifyRequest, FastifyReply } from 'fastify'
import type { AuthService } from '../auth/AuthService.js'
import { env } from '../config/env.js'

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id:       string
      username: string
      isAdmin:  boolean
    }
  }
}

// SEC-M04: metodi che modificano stato — soggetti al controllo Origin
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH'])

// SEC-M04: path esclusi dal controllo Origin (auth via cookie SameSite=Strict)
const ORIGIN_CHECK_SKIP_PATHS = new Set(['/api/v1/auth/refresh'])

export function makeAuthMiddleware(authService: AuthService) {
  return async function authenticate(
    request: FastifyRequest,
    reply:   FastifyReply,
  ): Promise<void> {
    // SEC-M04: verifica Origin header su richieste state-changing
    const method = request.method.toUpperCase()
    if (
      STATE_CHANGING_METHODS.has(method) &&
      !ORIGIN_CHECK_SKIP_PATHS.has(request.url.split('?')[0] ?? '')
    ) {
      const origin = request.headers.origin
      // SEC-M04: controlla Origin solo se PRESENTE e non corrispondente.
      // I browser NON inviano Origin per richieste same-origin → passano.
      // CLI/Postman senza Origin → passano (stesso comportamento).
      // Richieste cross-origin con Origin sbagliato → bloccate.
      if (origin !== undefined && !(env.CLIENT_ORIGIN as string[]).includes(origin)) {
        return reply.code(403).send({ error: 'ORIGIN_NOT_ALLOWED' })
      }
    }

    const header = request.headers.authorization

    if (!header?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' })
    }

    const token = header.slice(7)

    let payload
    try {
      payload = authService.verifyAccessToken(token)
    } catch {
      return reply.code(401).send({ error: 'TOKEN_EXPIRED_OR_INVALID' })
    }

    // SEC-C02: controlla la JWT blocklist (logout → revoca immediata)
    if (payload.jti) {
      const { db } = await import('../db/connection.js')
      const { jwtBlocklist } = await import('../db/schema.js')
      const { eq } = await import('drizzle-orm')

      const [blocked] = await db
        .select({ jti: jwtBlocklist.jti })
        .from(jwtBlocklist)
        .where(eq(jwtBlocklist.jti, payload.jti))
        .limit(1)

      if (blocked) {
        return reply.code(401).send({ error: 'TOKEN_REVOKED' })
      }
    }

    request.user = { id: payload.sub, username: payload.username, isAdmin: payload.isAdmin }
  }
}

/** Richiede che l'utente autenticato sia admin */
export async function requireAdmin(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  if (!request.user?.isAdmin) {
    return reply.code(403).send({ error: 'FORBIDDEN' })
  }
}
