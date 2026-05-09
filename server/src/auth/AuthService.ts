// ============================================================
// PAYROLL GANG SUITE — AuthService
// Orchestratore: TOTP verify → JWT access + refresh token rotante
// ============================================================

import jwt from 'jsonwebtoken'
import argon2 from 'argon2'
import { randomBytes, createHash, randomUUID } from 'node:crypto'
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
  jti:      string   // SEC-C02: JWT ID — usato per revoca al logout
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

    // SEC-M01: controlla lockout per-utente — prima di qualsiasi verifica OTP
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.#logFailedLogin(username, ip, 'ACCOUNT_LOCKED')
      throw new Error('ACCOUNT_LOCKED')
    }

    const result = await this.authModule.verify(
      user.id, user.totpSecret, otpToken, user.lastOtpToken,
    )

    if (!result.valid) {
      await this.#logFailedLogin(username, ip, result.reason ?? 'INVALID_OTP')
      // SEC-M01: incrementa contatore fallimenti; blocca dopo 5 tentativi
      await this.usersRepo.incrementFailedOtp(user.id)
      throw new Error('AUTH_FAILED')
    }

    // SEC-M01: reset contatore dopo login riuscito
    await this.usersRepo.resetFailedOtp(user.id)
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

    // FIX C-1: estrai selector (primi 16 char hex = primi 8 byte) dal raw token (hex 64 chars)
    // Il raw token è ora 32 byte hex (64 chars); il selector sono i primi 16 chars.
    const tokenSelector = rawToken.slice(0, 16)

    // Lookup O(1) tramite selector — un solo record, nessuna iterazione Argon2
    const [matchedToken] = await db
      .select()
      .from(refreshTokens)
      .where(and(
        eq(refreshTokens.tokenSelector, tokenSelector),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ))
      .limit(1)

    if (!matchedToken) throw new Error('INVALID_REFRESH_TOKEN')

    // Verifica Argon2 su UN solo record — non più O(n)
    if (!(await argon2.verify(matchedToken.tokenHash, rawToken))) {
      throw new Error('INVALID_REFRESH_TOKEN')
    }

    // Verifica fingerprint (possibile segnale di furto o cambio User-Agent)
    // SEC-H03: Argon2 verify (sopra) È l'autenticazione reale — il fingerprint è
    // un segnale secondario. Se Argon2 ha passato ma il fingerprint non corrisponde,
    // logghiamo il cambio senza revocare la sessione: l'utente potrebbe aver cambiato
    // browser/dispositivo o aggiornato il browser stesso.
    // Revochiamo TUTTI i token solo se anche il User-Agent manca completamente
    // (comportamento anomalo che nessun browser legittimo produce).
    const fingerprint = this.#fingerprint(userAgent, ip)
    if (matchedToken.fingerprint !== fingerprint) {
      await this.auditRepo.log({
        userId: matchedToken.userId,
        azione: 'REFRESH_FINGERPRINT_CHANGED',
        ip, userAgent,
      })
      // Se userAgent è vuoto (non inviato dal client) → comportamento anomalo → revoca tutto
      if (!userAgent) {
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
      // userAgent presente ma cambiato (cambio browser/aggiornamento): continua normalmente
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

  async logout(rawToken: string, rawAccessToken?: string): Promise<void> {
    const { db } = await import('../db/connection.js')
    const { refreshTokens, jwtBlocklist } = await import('../db/schema.js')
    const { eq, and, isNull, gt } = await import('drizzle-orm')

    // FIX C-1: lookup O(1) tramite selector — evita la scansione O(n) con Argon2
    const tokenSelector = rawToken.slice(0, 16)

    const [token] = await db
      .select()
      .from(refreshTokens)
      .where(and(
        eq(refreshTokens.tokenSelector, tokenSelector),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ))
      .limit(1)

    if (token) {
      // Verifica Argon2 su UN solo record
      if (await argon2.verify(token.tokenHash, rawToken)) {
        await db
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(eq(refreshTokens.id, token.id))
      }
    }

    // SEC-C02: blocklist il JWT access token se presente
    if (rawAccessToken) {
      try {
        const payload = this.verifyAccessToken(rawAccessToken)
        if (payload.jti && payload.exp) {
          const expiresAt = new Date(payload.exp * 1000)
          // Inserisci in blocklist; ignora conflitti (logout doppio)
          await db
            .insert(jwtBlocklist)
            .values({ jti: payload.jti, expiresAt })
            .onConflictDoNothing()
        }
      } catch {
        // Token già scaduto o invalido — non serve blocklisting
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
    // SEC-C02: jti (JWT ID) univoco per ogni token — permette revoca al logout
    const jti = randomUUID()
    return jwt.sign(
      { sub: userId, username, isAdmin, jti },
      jwtKeys.private,
      { algorithm: 'ES256', expiresIn: env.JWT_ACCESS_EXPIRES as jwt.SignOptions['expiresIn'] },
    )
  }

  async #issueRefreshToken(userId: string, userAgent: string, ip: string): Promise<string> {
    const { db } = await import('../db/connection.js')
    const { refreshTokens } = await import('../db/schema.js')

    // FIX C-1: rawToken = 32 byte hex (64 chars).
    // tokenSelector = primi 8 byte in hex = primi 16 chars del rawToken.
    // Il selector è non-segreto ma univoco — permette lookup O(1).
    const rawBytes     = randomBytes(32)
    const rawToken     = rawBytes.toString('hex')            // 64 char hex
    const tokenSelector = rawToken.slice(0, 16)              // primi 8 byte = 16 char hex

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

    await db.insert(refreshTokens).values({ userId, tokenHash, tokenSelector, fingerprint, expiresAt })

    return rawToken
  }

  // SEC-H03: fingerprint basato solo su User-Agent — IP escluso.
  // IP mobility (VPN, cambio rete mobile, DHCP) è comune e non è un segnale
  // di furto affidabile nel 2026. Il cambio di User-Agent è un segnale molto
  // più forte. L'IP continua ad essere registrato nell'audit log.
  // Firma: ip mantenuto per compatibilità dei caller, non usato nell'hash.
  #fingerprint(userAgent: string, _ip: string): string {
    return createHash('sha256')
      .update(userAgent)
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
  /**
   * SEC-M01 FIX G: sblocca un account bloccato per troppi OTP falliti.
   * Solo admin può chiamare questo metodo; la route verifica requireAdmin.
   * Emette audit log per tracciabilità.
   */
  async unlockUser(userId: string, adminId: string, ip: string): Promise<void> {
    const user = await this.usersRepo.findById(userId)
    if (!user) throw new Error('USER_NOT_FOUND')
    await this.usersRepo.unlockUser(userId)
    await this.auditRepo.log({
      userId:   adminId,
      azione:   'USER_UNLOCKED',
      entita:   'users',
      entitaId: userId,
      ip,
    })
  }

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

  // SEC-M05: GDPR Art.5 data minimisation — username (PII) rimosso dai dettagli.
  // Se l'utente esiste, userId nel log è sufficiente per correlazione.
  // Se non esiste (login con username inesistente), si salva solo un hash troncato
  // a 16 hex chars (64-bit) — sufficiente per correlazione, non reversibile.
  async #logFailedLogin(username: string, ip: string, reason: string): Promise<void> {
    const usernameHash = createHash('sha256').update(username).digest('hex').slice(0, 16)
    await this.auditRepo.log({
      azione:   'LOGIN_FAILED',
      dettagli: { usernameHash, reason },
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
