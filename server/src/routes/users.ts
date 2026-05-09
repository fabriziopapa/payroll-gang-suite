// ============================================================
// PAYROLL GANG SUITE — Routes Utenti (/api/v1/users)
// Gestione utenti — solo admin
// ============================================================

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from '../middleware/authenticate.js'
import { env } from '../config/env.js'

export async function usersRoutes(app: FastifyInstance): Promise<void> {

  // Tutti gli endpoint richiedono autenticazione + ruolo admin
  const preHandler = [app.authenticate, requireAdmin]

  // ----------------------------------------------------------
  // GET /api/v1/users — lista tutti gli utenti
  // ----------------------------------------------------------
  app.get('/', { preHandler }, async (_req, reply) => {
    const users = await app.authService.listUsers()
    return reply.send(users)
  })

  // ----------------------------------------------------------
  // DELETE /api/v1/users/:id — elimina utente
  // SEC-C03: richiede header X-Confirm-Delete: true per operazioni distruttive
  // ----------------------------------------------------------
  app.delete('/:id', { preHandler }, async (request, reply) => {
    // SEC-C03: protezione CSRF-like su operazioni distruttive
    if (request.headers['x-confirm-delete'] !== 'true') {
      return reply.code(400).send({ error: 'MISSING_CONFIRM_HEADER' })
    }

    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    // Impedisce l'auto-cancellazione
    if (id === request.user!.id) {
      return reply.code(400).send({ error: 'CANNOT_DELETE_SELF' })
    }

    try {
      await app.authService.deleteUser(id, request.user!.id, request.ip)
      return reply.code(204).send()
    } catch (err: any) {
      if (err.message === 'USER_NOT_FOUND') {
        return reply.code(404).send({ error: 'USER_NOT_FOUND' })
      }
      throw err
    }
  })

  // ----------------------------------------------------------
  // PUT /api/v1/users/:id/active — abilita / disabilita utente
  // ----------------------------------------------------------
  app.put('/:id/active', { preHandler }, async (request, reply) => {
    const { id }    = z.object({ id: z.string().uuid() }).parse(request.params)
    const { active } = z.object({ active: z.boolean() }).parse(request.body)

    // Impedisce l'auto-disabilitazione
    if (id === request.user!.id && !active) {
      return reply.code(400).send({ error: 'CANNOT_DISABLE_SELF' })
    }

    try {
      await app.authService.setUserActive(id, active, request.user!.id, request.ip)
      return reply.send({ success: true })
    } catch (err: any) {
      if (err.message === 'USER_NOT_FOUND') {
        return reply.code(404).send({ error: 'USER_NOT_FOUND' })
      }
      throw err
    }
  })

  // ----------------------------------------------------------
  // PUT /api/v1/users/:id/admin — promuovi / declassa utente
  // Regole: non puoi cambiare il tuo ruolo; "admin" non è declassabile
  // ----------------------------------------------------------
  app.put('/:id/admin', { preHandler }, async (request, reply) => {
    const { id }      = z.object({ id: z.string().uuid() }).parse(request.params)
    const { isAdmin } = z.object({ isAdmin: z.boolean() }).parse(request.body)

    try {
      await app.authService.setUserAdmin(id, isAdmin, request.user!.id, request.ip)
      return reply.send({ success: true })
    } catch (err: any) {
      switch (err.message) {
        case 'CANNOT_CHANGE_OWN_ROLE':
          return reply.code(400).send({ error: 'CANNOT_CHANGE_OWN_ROLE' })
        case 'CANNOT_DEMOTE_SUPERADMIN':
          return reply.code(400).send({ error: 'CANNOT_DEMOTE_SUPERADMIN' })
        case 'USER_NOT_FOUND':
          return reply.code(404).send({ error: 'USER_NOT_FOUND' })
        default:
          throw err
      }
    }
  })

  // ----------------------------------------------------------
  // POST /api/v1/users/:id/unlock — sblocca account OTP (admin only)
  // SEC-M01 FIX G: rimuove il lockout TOTP senza reimpostare la password
  // ----------------------------------------------------------
  app.post('/:id/unlock', { preHandler }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    try {
      await app.authService.unlockUser(id, request.user!.id, request.ip)
      return reply.send({ success: true })
    } catch (err: any) {
      if (err.message === 'USER_NOT_FOUND') {
        return reply.code(404).send({ error: 'USER_NOT_FOUND' })
      }
      throw err
    }
  })

  // ----------------------------------------------------------
  // POST /api/v1/users/:id/regen-qr — rigenera QR TOTP
  // Invia la nuova email all'utente se SMTP è configurato
  // ----------------------------------------------------------
  app.post('/:id/regen-qr', { preHandler }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    try {
      const result = await app.authService.regenQr(id, request.user!.id, request.ip)

      let emailSent = false
      if (app.mailer.isConfigured()) {
        try {
          // FIX #4: URL contiene il token opaco (non l'UUID utente)
          const activateUrl = `${env.CLIENT_ORIGIN}?activate=${result.activationToken}`
          await app.mailer.sendQrCode({
            to:          result.username,
            username:    result.username,
            qrCodeUrl:   result.qrCodeUrl,
            backupKey:   result.backupKey,
            activateUrl,
          })
          emailSent = true
        } catch (mailErr) {
          app.log.warn({ mailErr }, 'Invio email QR rigenerato fallito')
        }
      }

      return reply.send({ activationToken: result.activationToken, qrCodeUrl: result.qrCodeUrl, backupKey: result.backupKey, emailSent })
    } catch (err: any) {
      if (err.message === 'USER_NOT_FOUND') {
        return reply.code(404).send({ error: 'USER_NOT_FOUND' })
      }
      throw err
    }
  })
}
