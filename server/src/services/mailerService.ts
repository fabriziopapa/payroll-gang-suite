// ============================================================
// PAYROLL GANG SUITE — MailerService
// Invio email transazionali via SMTP (nodemailer)
// Configurato per iCloud SMTP + dominio fabriziopapa.com
//
// Requisiti reputazione:
//   SPF  : v=spf1 include:icloud.com -all         ✓ già presente
//   DKIM : firmato automaticamente da smtp.mail.me.com ✓
//   DMARC: v=DMARC1; p=reject                      ✓ già presente
//   From : deve essere @fabriziopapa.com per allineamento DMARC
// ============================================================

import nodemailer from 'nodemailer'
import { randomBytes } from 'node:crypto'

// ── Config ────────────────────────────────────────────────────

interface MailerConfig {
  host?:   string
  port?:   number
  secure?: boolean
  user?:   string
  pass?:   string
  from?:   string
}

// ── Service ───────────────────────────────────────────────────

export class MailerService {
  private readonly transporter: nodemailer.Transporter | null
  private readonly from: string
  private readonly domain: string

  constructor(config: MailerConfig) {
    if (config.host && config.user && config.pass) {
      this.transporter = nodemailer.createTransport({
        host:   config.host,
        port:   config.port  ?? 587,
        secure: config.secure ?? false,
        auth:   { user: config.user, pass: config.pass },
        // iCloud richiede STARTTLS su 587
        tls: {
          ciphers:            'SSLv3',
          rejectUnauthorized: true,
        },
        // Riprova automatica in caso di errore temporaneo
        pool:           true,
        maxConnections: 2,
        rateDelta:      1000,
        rateLimit:      5,
      })
      this.from   = config.from ?? `Payroll Gang Suite <${config.user}>`
      // Estrae il dominio dalla from address per il Message-ID
      this.domain = (config.from ?? config.user).replace(/^.*@/, '').replace(/[>].*$/, '')
    } else {
      this.transporter = null
      this.from        = 'noreply@payrollgang.local'
      this.domain      = 'payrollgang.local'
    }
  }

  /** true se SMTP è configurato e le email vengono realmente inviate */
  isConfigured(): boolean {
    return this.transporter !== null
  }

  /**
   * Invia QR code TOTP al nuovo utente.
   * Il QR è incluso come allegato inline con Content-ID.
   * Se SMTP non configurato, no-op silenzioso.
   */
  async sendQrCode(opts: {
    to:          string   // email destinatario (= username)
    username:    string
    qrCodeUrl:   string   // data:image/png;base64,...
    backupKey:   string   // chiave di backup formattata XXXX-XXXX-...
    activateUrl: string   // link diretto all'attivazione
  }): Promise<void> {
    if (!this.transporter) return

    // Estrai il payload base64 dalla data URL
    const b64 = opts.qrCodeUrl.split(',')[1] ?? ''

    const html      = buildQrEmail(opts)
    const messageId = `<${randomBytes(16).toString('hex')}@${this.domain}>`

    await this.transporter.sendMail({
      from:    this.from,
      to:      opts.to,
      replyTo: this.from,
      subject: 'Payroll Gang Suite — Attivazione account',

      // ── Header di reputazione ────────────────────────────────
      messageId,
      headers: {
        // Email transazionale — non è spam né newsletter
        'Auto-Submitted':    'auto-generated',
        'X-Auto-Response-Suppress': 'OOF, AutoReply',
        // Priorità normale (evita classificazione come bulk)
        'X-Priority':        '3',
        'X-MSMail-Priority': 'Normal',
        'Importance':        'Normal',
        // Identifica il mittente applicativo senza rivelare dettagli tecnici
        'X-Mailer':          'Payroll Gang Suite Mailer',
        // Impedisce ai client di generare auto-reply
        'Precedence':        'transactional',
      },

      // ── Corpo ────────────────────────────────────────────────
      html,
      // Versione testo plain — riduce score spam e migliora deliverability
      text: buildTextEmail(opts),

      // ── Allegato QR inline ───────────────────────────────────
      attachments: [
        {
          filename:    'qrcode.png',
          content:     Buffer.from(b64, 'base64'),
          contentType: 'image/png',
          cid:         'qrcode@payrollgang',
          // Inline — non appare come allegato separato
          contentDisposition: 'inline',
        },
      ],
    })
  }
}

// ── Template testo plain ──────────────────────────────────────
// Versione plain text obbligatoria per non essere classificati spam

function buildTextEmail(opts: {
  username:    string
  backupKey:   string
  activateUrl: string
}): string {
  return `Payroll Gang Suite — Attivazione account
==========================================

Benvenuto, ${opts.username}.

È stato creato un account per te su Payroll Gang Suite.
Per accedere devi configurare Google Authenticator (o app TOTP compatibile).

Come procedere:
1. Installa Google Authenticator o Authy sul tuo telefono
2. Apri il link qui sotto per attivare l'account e scansionare il QR
3. Inserisci il codice a 6 cifre generato dall'app
4. Da quel momento potrai accedere con la tua email e il codice OTP

Link di attivazione:
${opts.activateUrl}

Chiave di backup (conservala in un luogo sicuro):
${opts.backupKey}

Questa chiave serve per recuperare l'accesso se perdi il telefono.
Non condividere questa email.

---
Autenticazione passwordless TOTP · RFC 6238
Payroll Gang Suite — ${new Date().getFullYear()}
`
}

// ── Template HTML email ───────────────────────────────────────

function buildQrEmail(opts: {
  username:    string
  qrCodeUrl:   string
  backupKey:   string
  activateUrl: string
}): string {
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <title>Attivazione account Payroll Gang Suite</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:system-ui,-apple-system,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 16px">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0"
          style="max-width:520px;background:#1e293b;border-radius:16px;overflow:hidden;
                 border:1px solid #334155">

          <!-- Header -->
          <tr>
            <td style="padding:28px 32px 24px;border-bottom:1px solid #334155">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:40px;height:40px;background:#4f46e5;border-radius:10px;
                              text-align:center;vertical-align:middle">
                    <span style="color:#fff;font-size:20px;font-weight:700">P</span>
                  </td>
                  <td style="padding-left:12px">
                    <p style="margin:0;color:#fff;font-size:16px;font-weight:600">
                      Payroll Gang Suite
                    </p>
                    <p style="margin:0;color:#64748b;font-size:12px">
                      Attivazione account
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px 32px">
              <p style="margin:0 0 8px;color:#94a3b8;font-size:13px">Benvenuto in</p>
              <h1 style="margin:0 0 20px;color:#f1f5f9;font-size:22px;font-weight:700">
                Il tuo account è stato creato
              </h1>
              <p style="margin:0 0 24px;color:#94a3b8;font-size:14px;line-height:1.6">
                È stato creato un account per <strong style="color:#f1f5f9">${opts.username}</strong>.
                Per accedere all'applicazione devi configurare Google Authenticator (o app compatibile TOTP)
                e attivare il tuo account.
              </p>

              <!-- Steps -->
              <table cellpadding="0" cellspacing="0" width="100%"
                style="background:#0f172a;border-radius:10px;padding:20px;margin-bottom:24px">
                <tr>
                  <td>
                    <p style="margin:0 0 14px;color:#f1f5f9;font-size:13px;font-weight:600">
                      Come procedere:
                    </p>
                    ${['Installa Google Authenticator o Authy sul telefono',
                       'Scansiona il QR code qui sotto con l\'app',
                       'Clicca il bottone "Attiva account" e inserisci il codice a 6 cifre',
                       'Da quel momento potrai accedere con la tua email e il codice OTP'].map((s, i) => `
                    <p style="margin:0 0 8px;color:#94a3b8;font-size:13px">
                      <span style="color:#6366f1;font-weight:700">${i + 1}.</span> ${s}
                    </p>`).join('')}
                  </td>
                </tr>
              </table>

              <!-- QR Code -->
              <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px">
                <tr>
                  <td align="center" style="background:#fff;border-radius:12px;padding:16px">
                    <img src="cid:qrcode@payrollgang" width="180" height="180"
                      alt="QR Code TOTP"
                      style="display:block;border-radius:8px">
                    <p style="margin:10px 0 0;color:#475569;font-size:11px">
                      Scansiona con Google Authenticator / Authy
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Activate button -->
              <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px">
                <tr>
                  <td align="center">
                    <a href="${opts.activateUrl}"
                      style="display:inline-block;padding:13px 28px;background:#4f46e5;
                             color:#fff;text-decoration:none;border-radius:10px;
                             font-size:14px;font-weight:600">
                      Attiva il tuo account &#8594;
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Backup key -->
              <table cellpadding="0" cellspacing="0" width="100%"
                style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:16px">
                <tr>
                  <td>
                    <p style="margin:0 0 6px;color:#f59e0b;font-size:12px;font-weight:600">
                      Chiave di backup &#8212; conservala in un luogo sicuro
                    </p>
                    <p style="margin:0;color:#fbbf24;font-family:monospace;font-size:13px;
                               letter-spacing:2px;word-break:break-all">
                      ${opts.backupKey}
                    </p>
                    <p style="margin:6px 0 0;color:#64748b;font-size:11px">
                      Usala per recuperare l'accesso se perdi il telefono.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #1e293b">
              <p style="margin:0;color:#475569;font-size:11px;text-align:center">
                Autenticazione passwordless TOTP &middot; RFC 6238<br>
                Questo messaggio è generato automaticamente. Non condividere questa email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
