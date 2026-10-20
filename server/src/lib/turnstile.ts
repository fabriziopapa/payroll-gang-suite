// ============================================================
// PAYROLL GANG SUITE — Verifica Cloudflare Turnstile (siteverify)
// ============================================================

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export interface TurnstileResult {
  ok:      boolean
  /** Motivo del rifiuto: solo per i log del server, mai inviato al client. */
  reason?: string
  /** `error-codes` restituiti da siteverify, quando Cloudflare risponde. */
  codes?:  string[]
  /** Durata della chiamata a siteverify, in millisecondi. */
  ms?:     number
}

/**
 * SEC-A3 — Fail-closed: se Turnstile e' ATTIVO (secret configurata + toggle
 * runtime `turnstileEnabled` non disattivato), il token e' obbligatorio e la
 * verifica deve riuscire. Errore di rete verso Cloudflare ⇒ login rifiutato
 * (resta il rate limit come protezione, ma il CAPTCHA non e' bypassabile
 * causando un timeout). Se la secret manca o il toggle e' spento ⇒ skip.
 *
 * 26.10.20: invece di un booleano restituisce anche il MOTIVO del rifiuto
 * (token mancante, HTTP, rifiuto con error-codes, timeout, rete), che la
 * route scrive nel log. Prima tutti questi casi diventavano un `false` muto.
 *
 * `secret` e `fetchFn` sono parametri per poter testare la funzione senza
 * caricare env.ts e senza rete.
 */
export async function verifyTurnstile(
  secret:    string | undefined,
  enabled:   boolean,
  token:     string | undefined,
  ip:        string,
  fetchFn:   typeof fetch = fetch,
  timeoutMs: number = 5000,
): Promise<TurnstileResult> {
  if (!secret || !enabled) return { ok: true }
  if (!token) return { ok: false, reason: 'missing_token' }

  const t0 = Date.now()
  try {
    const res = await fetchFn(SITEVERIFY_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ secret, response: token, remoteip: ip }),
      signal:  AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return { ok: false, reason: `http_${res.status}`, ms: Date.now() - t0 }

    const data  = await res.json() as { success?: boolean; 'error-codes'?: unknown }
    const ms    = Date.now() - t0
    if (data.success === true) return { ok: true, ms }
    const codes = Array.isArray(data['error-codes'])
      ? data['error-codes'].filter((c): c is string => typeof c === 'string')
      : []
    return { ok: false, reason: 'rejected', codes, ms }
  } catch (err) {
    const ms = Date.now() - t0
    const e  = err as { name?: string; code?: string; cause?: { code?: string } } | null
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      return { ok: false, reason: `timeout_${timeoutMs}ms`, ms }
    }
    return { ok: false, reason: `network:${e?.cause?.code ?? e?.code ?? e?.name ?? 'unknown'}`, ms }
  }
}
