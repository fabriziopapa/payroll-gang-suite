// ============================================================
// PAYROLL GANG SUITE — Interfaccia Abstract Auth Module
// Ogni modulo di autenticazione implementa questa interfaccia.
// Moduli pluggabili: TOTP (attivo), LDAP, OAuth2, MagicLink (futuri)
// ============================================================

export interface AuthRegistrationResult {
  /** URL da passare alla libreria QR (per TOTP: otpauth://totp/...) */
  qrCodeUrl:   string
  /** Chiave di backup leggibile dall'utente (Base32) */
  backupKey:   string
  /** Secret cifrato pronto per la persistenza in DB */
  secretForDb: string
}

export interface AuthVerifyResult {
  valid:   boolean
  /** Motivo del fallimento (solo per logging interno, non esporre al client) */
  reason?: 'invalid_token' | 'expired' | 'replay' | 'user_not_found'
}

export interface IAuthModule {
  /** Nome identificativo del modulo (es. "totp", "ldap") */
  readonly name: string

  /**
   * Genera le credenziali iniziali per un nuovo utente.
   * Per TOTP: genera secret, URL QR e chiave di backup.
   * L'utente deve scansionare il QR e verificare il primo OTP prima che
   * l'account venga attivato.
   */
  register(userId: string, username: string): Promise<AuthRegistrationResult>

  /**
   * Verifica il token presentato dall'utente.
   * Deve prevenire i replay attack (token già usato nella finestra corrente).
   * @param userId     - ID utente nel DB
   * @param secretDb   - Secret cifrato salvato nel DB
   * @param token      - OTP presentato dall'utente
   * @param lastToken  - Ultimo token usato con successo (per replay prevention)
   */
  verify(
    userId:    string,
    secretDb:  string,
    token:     string,
    lastToken: string | null,
  ): Promise<AuthVerifyResult>
}
