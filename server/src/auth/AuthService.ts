// ============================================================
// PAYROLL GANG SUITE — AuthService
// Orchestratore: TOTP verify → JWT access + refresh token rotante
// ============================================================

import jwt from 'jsonwebtoken'
import argon2 from 'argon2'
import { randomBytes, createHash } from 'node:crypto'
import { jwtKeys, env, REFRESH_TOKEN_MS } from '../config/env.js'
import type { IAuthModule } from './IAuthModule.js'
import type { IUsersRepository, IAuditRepository, UserRow } from '../db/IRepository.js'

// ------------------------------------------------------------
// Tipi pubblici
// ------------------------------------------------------------

export interface AccessTokenPayload {
  sub:      string   // userId
  username: string
  isAdmin:  boolean
  iat:      number
  exp:      number
}

export interface LoginResult {
  accessToken:  string
  refreshToken: string   // token grezzo — da mettere in cookie HttpOnly
  user: {
    id:       string
    username: string
    isAdmin:  boolean
  }
}

// ------------------------------------------------------------
// AuthService
// ------------------------------------------------------------

export class AuthService {
  constructor(
    private readonly authModule: IAuthModule,
    private readonly usersRepo:  IUsersRepository,
    private readonly auditRepo:  IAuditRepository,
  ) {}

  // ----------------------------------------------------------
  // Registrazione utente (solo admin o primo utente)
  // ----------------------------------------------------------

  async registerUser(
    username:    string,
    isAdmin:     boolean,
    createdByIp: string,
  ): Promise<{ userId: string; activationToken: string; qrCodeUrl: string; backupKey: string }> {
    const existing = await this.usersRepo.findByUsername(username)
    if (existing) throw new Error('USERNAME_TAKEN')

    // Crea utente con secret TOTP — non ancora attivo (totp_verified = false)
    const { qrCodeUrl, backupKey, secretForDb } = await this.authModule.register(
      'pending', // verrà aggiornato con l'ID reale dopo la creazione
      username,
    )

    const user = await this.usersRepo.create({ username, totpSecret: secretForDb, isAdmin })

    // FIX #4: genera token di attivazione con scadenza 24h
    const activationToken = await this.#generateAndStoreActivationToken(user.id)

    await this.auditRepo.log({
      userId:   user.id,
      azione:   'USER_REGISTERED',
      entita:   'users',
      entitaId: user.id,
      ip:       createdByIp,
    })

    return { userId: user.id, activationToken, qrCodeUrl, backupKey }
  }

  // ----------------------------------------------------------
  // Attivazione account (prima verifica OTP dopo scansione QR)
  // ----------------------------------------------------------

  /**
   * FIX #4: attivazione via token opaco con scadenza 24h.
   * Lancia 'ACTIVATION_TOKEN_EXPIRED' se il token esiste ma è scaduto.
   * Restituisce false se il token non esiste o l'OTP è errato.
   */
  async activateUser(activationToken: string, otpToken: string): Promise<boolean> {
    const tokenHash = createHash('sha256').update(activationToken).digest('hex')
    const user = await this.usersRepo.findByActivationTokenHash(tokenHash)

    // Token non trovato o utente già attivato
    if (!user || user.totpVerified) return false

    // Controlla scadenza — errore distinto per dare feedback utile all'admin
    if (!user.activationExpiresAt || user.activationExpiresAt < new Date()) {
      throw new Error('ACTIVATION_TOKEN_EXPIRED')
    }

    const result = await this.authModule.verify(
      user.id, user.totpSecret, otpToken, user.lastOtpToken,
    )
    if (!result.valid) return false

    await this.usersRepo.setTotpVerified(user.id)
    await this.usersRepo.updateLastOtpToken(user.id, otpToken)
    await this.usersRepo.clearActivationToken(user.id)
    await this.auditRepo.log({ userId: user.id, azione: 'USER_ACTIVATED', entita: 'users', entitaId: user.id })
    return true
  }

  // ----------------------------------------------------------
  // Login — verifica OTP → emette access + refresh token
  // ----------------------------------------------------------

  async login(
    username:  string,
    otpToken:  string,
    userAgent: string,
    ip:        string,
  ): Promise<LoginResult> {
    const user = await this.usersRepo.findByUsername(username)

    if (!user || !user.isActive || !user.totpVerified) {
      await this.#logFailedLogin(username, ip, 'USER_NOT_FOUND_OR_INACTIVE')
      throw new Error('AUTH_FAILED')
    }

    const result = await this.authModule.verify(
      user.id, user.totpSecret, otpToken, user.lastOtpToken,
    )

    if (!result.valid) {
      await this.#logFailedLogin(username, ip, result.reason ?? 'INVALID_OTP')
      throw new Error('AUTH_FAILED')
    }

    // Aggiorna last token usato (replay prevention)
    await this.usersRepo.updateLastOtpToken(user.id, otpToken)
    await this.usersRepo.updateLastLogin(user.id)

    const accessToken  = this.#issueAccessToken(user.id, user.username, user.isAdmin)
    const refreshToken = await this.#issueRefreshToken(user.id, userAgent, ip)

    await this.auditRepo.log({
      userId: user.id, azione: 'LOGIN_SUCCESS',
      entita: 'users', entitaId: user.id, ip, userAgent,
    })

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, username: user.username, isAdmin: user.isAdmin },
    }
  }

  // ----------------------------------------------------------
  // Refresh token rotante
  // ----------------------------------------------------------

  async refresh(
    rawToken:  string,
    userAgent: string,
    ip:        string,
  ): Promise<{ accessToken: string; newRefreshToken: string }> {
    const { db } = await import('../db/connection.js')
    const { refreshTokens, users } = await import('../db/schema.js')
    const { eq, and, gt, isNull } = await import('drizzle-orm')

    // Cerca tutti i token attivi dell'utente e verifica con Argon2
    const activeTokens = await db
      .select()
      .from(refreshTokens)
      .where(and(
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ))
      .limit(50)

    let matchedToken = null
    for (const t of activeTokens) {
      if (await argon2.verify(t.tokenHash, rawToken)) {
        matchedToken = t
        break
      }
    }

    if (!matchedToken) throw new Error('INVALID_REFRESH_TOKEN')

    // Verifica fingerprint (rileva token theft)
    const fingerprint = this.#fingerprint(userAgent, ip)
    if (matchedToken.fingerprint !== fingerprint) {
      // Possibile furto — revoca tutti i token dell'utente
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.userId, matchedToken.userId))

      await this.auditRepo.log({
        userId: matchedToken.userId,
        azione: 'REFRESH_TOKEN_THEFT_SUSPECTED',
        ip, userAgent,
      })
      throw new Error('TOKEN_THEFT_SUSPECTED')
    }

    // Revoca token usato (rotazione)
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, matchedToken.id))

    // Recupera utente
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, matchedToken.userId))
      .limit(1)

    if (!user || !user.isActive) throw new Error('USER_INACTIVE')

    const accessToken     = this.#issueAccessToken(user.id, user.username, user.isAdmin)
    const newRefreshToken = await this.#issueRefreshToken(user.id, userAgent, ip)

    return { accessToken, newRefreshToken }
  }

  // ----------------------------------------------------------
  // Logout — revoca refresh token
  // ----------------------------------------------------------

  async logout(rawToken: string): Promise<void> {
    const { db } = await import('../db/connection.js')
    const { refreshTokens } = await import('../db/schema.js')
    const { isNull, gt, and } = await import('drizzle-orm')

    const activeTokens = await db
      .select()
      .from(refreshTokens)
      .where(and(isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, new Date())))
      .limit(50)

    for (const t of activeTokens) {
      if (await argon2.verify(t.tokenHash, rawToken)) {
        const { eq } = await import('drizzle-orm')
        await db
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(eq(refreshTokens.id, t.id))
        break
      }
    }
  }

  // ----------------------------------------------------------
  // Verifica access token (usato nel middleware)
  // ----------------------------------------------------------

  verifyAccessToken(token: string): AccessTokenPayload {
    return jwt.verify(token, jwtKeys.public, {
      algorithms: ['ES256'],
    }) as AccessTokenPayload
  }

  // ----------------------------------------------------------
  // Privati
  // ----------------------------------------------------------

  #issueAccessToken(userId: string, username: string, isAdmin: boolean): string {
    return jwt.sign(
      { sub: userId, username, isAdmin },
      jwtKeys.private,
      { algorithm: 'ES256', expiresIn: env.JWT_ACCESS_EXPIRES as jwt.SignOptions['expiresIn'] },
    )
  }

  async #issueRefreshToken(userId: string, userAgent: string, ip: string): Promise<string> {
    const { db } = await import('../db/connection.js')
    const { refreshTokens } = await import('../db/schema.js')

    const rawToken    = randomBytes(48).toString('base64url')
    const tokenHash   = await argon2.hash(rawToken, {
      type:        argon2.argon2id,
      // Parametri espliciti — immunizza da cambi di default nelle versioni future
      // Valori OWASP-compliant (min: memoryCost ≥ 19456, timeCost ≥ 2)
      timeCost:    3,       // iterazioni (più alto = più lento per l'attaccante)
      memoryCost:  65536,   // 64 MB di RAM per hash (rende il brute-force costoso)
      parallelism: 4,       // thread paralleli
    })
    const fingerprint = this.#fingerprint(userAgent, ip)

    // FIX: usa REFRESH_TOKEN_MS da env — unica sorgente di verità con il cookie
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_MS)

    await db.insert(refreshTokens).values({ userId, tokenHash, fingerprint, expiresAt })

    return rawToken
  }

  #fingerprint(userAgent: string, ip: string): string {
    return createHash('sha256')
      .update(`${userAgent}|${ip}`)
      .digest('hex')
      .slice(0, 64)
  }

  // ----------------------------------------------------------
  // Gestione utenti (admin)
  // ----------------------------------------------------------

  async listUsers(): Promise<UserRow[]> {
    return this.usersRepo.findAll()
  }

  async deleteUser(userId: string, adminId: string, ip: string): Promise<void> {
    const user = await this.usersRepo.findById(userId)
    if (!user) throw new Error('USER_NOT_FOUND')
    await this.usersRepo.delete(userId)
    await this.auditRepo.log({
      userId:   adminId,
      azione:   'USER_DELETED',
      entita:   'users',
      entitaId: userId,
      ip,
    })
  }

  async setUserActive(userId: string, active: boolean, adminId: string, ip: string): Promise<void> {
    const user = await this.usersRepo.findById(userId)
    if (!user) throw new Error('USER_NOT_FOUND')
    await this.usersRepo.setActive(userId, active)
    await this.auditRepo.log({
      userId:   adminId,
      azione:   active ? 'USER_ENABLED' : 'USER_DISABLED',
      entita:   'users',
      entitaId: userId,
      ip,
    })
  }

  /**
   * Promuove o declassa un utente.
   * Regole:
   *  - Un admin non può cambiare il proprio ruolo.
   *  - L'utente con username "admin" non può essere declassato da nessuno.
   */
  async setUserAdmin(
    userId:  string,
    isAdmin: boolean,
    adminId: string,
    ip:      string,
  ): Promise<void> {
    if (userId === adminId) throw new Error('CANNOT_CHANGE_OWN_ROLE')

    const user = await this.usersRepo.findById(userId)
    if (!user) throw new Error('USER_NOT_FOUND')

    // L'utente "admin" è protetto — non può mai essere declassato
    if (user.username === 'admin' && !isAdmin) {
      throw new Error('CANNOT_DEMOTE_SUPERADMIN')
    }

    await this.usersRepo.setAdmin(userId, isAdmin)
    await this.auditRepo.log({
      userId:   adminId,
      azione:   isAdmin ? 'USER_PROMOTED_ADMIN' : 'USER_DEMOTED_ADMIN',
      entita:   'users',
      entitaId: userId,
      ip,
    })
  }

  async regenQr(
    userId:  string,
    adminId: string,
    ip:      string,
  ): Promise<{ activationToken: string; qrCodeUrl: string; backupKey: string; username: string }> {
    const user = await this.usersRepo.findById(userId)
    if (!user) throw new Error('USER_NOT_FOUND')

    const { qrCodeUrl, backupKey, secretForDb } = await this.authModule.register(
      userId,
      user.username,
    )
    await this.usersRepo.updateTotpSecret(userId, secretForDb)

    // FIX #4: nuovo token di attivazione con scadenza 24h
    const activationToken = await this.#generateAndStoreActivationToken(userId)

    await this.auditRepo.log({
      userId:   adminId,
      azione:   'USER_QR_REGENERATED',
      entita:   'users',
      entitaId: userId,
      ip,
    })

    return { activationToken, qrCodeUrl, backupKey, username: user.username }
  }

  // ----------------------------------------------------------

  async #logFailedLogin(username: string, ip: string, reason: string): Promise<void> {
    await this.auditRepo.log({
      azione:   'LOGIN_FAILED',
      dettagli: { username, reason },
      ip,
    })
  }

  /**
   * FIX #4: genera token casuale a 32 byte (hex = 64 chars),
   * ne salva il SHA-256 hash nel DB con scadenza a 24h.
   * Restituisce il token grezzo da includere nel link di attivazione.
   */
  async #generateAndStoreActivationToken(userId: string): Promise<string> {
    const rawToken  = randomBytes(32).toString('hex')     // 64 char hex
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // +24h
    await this.usersRepo.setActivationToken(userId, tokenHash, expiresAt)
    return rawToken
  }
}
