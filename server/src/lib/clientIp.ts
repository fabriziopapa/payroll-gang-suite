// ============================================================
// PAYROLL GANG SUITE — Derivazione dell'IP del client
// ============================================================

import { isIP } from 'node:net'
import type { FastifyRequest } from 'fastify'

/**
 * IP del client su cui basare audit_log e rate limiting.
 *
 * SEC-A5 (audit 2026-08-17): dietro Cloudflare l'unico valore affidabile è
 * `CF-Connecting-IP`. Cloudflare lo IMPOSTA sempre con il vero IP del
 * visitatore e sovrascrive qualsiasi valore inviato dal client, quindi non è
 * falsificabile — A PATTO che l'origine accetti connessioni solo dai range
 * Cloudflare (vedi pgs-cf-origin-lock.sh). Senza quel firewall, un attaccante
 * colpisce l'origine diretta e si imposta CF-Connecting-IP da sé: per questo
 * il firewall e questa funzione vanno insieme.
 *
 * `request.ip` (derivato da X-Forwarded-For tramite trustProxy) NON è
 * affidabile dietro Cloudflare: la catena XFF è pilotabile dal client e un
 * hop loopback in coda fa sì che proxy-addr restituisca il valore falso.
 *
 * Fallback a `request.ip` quando l'header è assente (sviluppo locale o
 * deployment senza CDN): lì X-Forwarded-For + trustProxy loopback bastano.
 */
export function clientIp(req: FastifyRequest): string {
  const cf = req.headers['cf-connecting-ip']
  if (typeof cf === 'string' && isIP(cf) !== 0) return cf
  return req.ip
}
