// ============================================================
// PAYROLL GANG SUITE — Middleware Autenticazione
// Verifica JWT ES256 su ogni richiesta protetta
// ============================================================

import type { FastifyRequest, FastifyReply } from 'fastify'
import type { AuthService } from '../auth/AuthService.js'

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id:       string
      username: string
      isAdmin:  boolean
    }
  }
}

export function makeAuthMiddleware(authService: AuthService) {
  return async function authenticate(
    request: FastifyRequest,
    reply:   FastifyReply,
  ): Promise<void> {
    const header = request.headers.authorization

    if (!header?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' })
    }

    const token = header.slice(7)

    try {
      const payload = authService.verifyAccessToken(token)
      request.user  = { id: payload.sub, username: payload.username, isAdmin: payload.isAdmin }
    } catch {
      return reply.code(401).send({ error: 'TOKEN_EXPIRED_OR_INVALID' })
    }
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
