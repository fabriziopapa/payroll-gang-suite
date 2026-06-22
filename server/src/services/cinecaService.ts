// ============================================================
// PAYROLL GANG SUITE — CINECA CSA-WS client
// Proxy server-side: auth JWT (cache) + lookup familiari/figli (WE)
// e codice fiscale dipendente (WD, fallback al dato locale).
// Doc: https://docs.csa-ws.cineca.it/  — tenant: env.CINECA_TENANT
// Mai chiamato dal client: credenziali in .env, CF = dati personali.
// ============================================================

import { env, cinecaConfigured } from '../config/env.js'

export class CinecaNotConfiguredError extends Error {
  constructor() {
    super('CINECA_NOT_CONFIGURED')
    this.name = 'CinecaNotConfiguredError'
  }
}

export class CinecaApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'CinecaApiError'
  }
}

/** Familiare normalizzato (campi comuni alle due varianti d'API). */
export interface FamiliareNorm {
  codFisc:           string
  rapportoParentela: string
  cognome:           string | null
  nome:              string | null
  sesso:             string | null
  /** YYYY-MM-DD */
  dataNasc:          string | null
}

// ── Cache token (module-level) ────────────────────────────────
let cachedToken: string | null = null
let tokenExpiresAt = 0   // epoch ms

function baseUrl(): string {
  // base + tenant, senza slash doppi
  return `${env.CINECA_BASE_URL!.replace(/\/+$/, '')}/${env.CINECA_TENANT}`
}

/** Estrae l'exp (ms) da un JWT; null se non decodificabile. */
function jwtExpiryMs(token: string): number | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
    const exp = JSON.parse(json)?.exp
    return typeof exp === 'number' ? exp * 1000 : null
  } catch {
    return null
  }
}

/**
 * Autentica e restituisce un Bearer JWT, con cache fino a (exp - 30s).
 * POST {base}/{tenant}/authentication  body { username, password, group }.
 */
export async function authenticate(): Promise<string> {
  if (!cinecaConfigured) throw new CinecaNotConfiguredError()

  const now = Date.now()
  if (cachedToken && now < tokenExpiresAt) return cachedToken

  const res = await fetch(`${baseUrl()}/authentication`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      username: env.CINECA_USER,
      password: env.CINECA_PASSWORD,
      group:    env.CINECA_GROUPS,
    }),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new CinecaApiError(`Autenticazione CINECA fallita (${res.status})`, res.status)
  }

  // La risposta può essere il JWT grezzo o un JSON { token | jwt | access_token }
  let token = text.trim()
  try {
    const obj = JSON.parse(text)
    token = (obj?.token ?? obj?.jwt ?? obj?.access_token ?? '').toString().trim() || token
  } catch {
    // non-JSON → token grezzo, già in `token`
  }
  if (!token || token.split('.').length !== 3) {
    throw new CinecaApiError('Token CINECA non valido nella risposta di authentication')
  }

  cachedToken    = token
  tokenExpiresAt = (jwtExpiryMs(token) ?? now + 10 * 60_000) - 30_000
  return token
}

/** Invalida la cache token (forza re-auth alla prossima chiamata). */
export function resetTokenCache(): void {
  cachedToken = null
  tokenExpiresAt = 0
}

/** GET autenticato con un retry su 401 (token scaduto/revocato). */
async function authedGet(path: string): Promise<Response> {
  let token = await authenticate()
  let res = await fetch(`${baseUrl()}${path}`, {
    headers: { Authorization: `bearer ${token}`, Accept: 'application/json' },
  })
  if (res.status === 401) {
    resetTokenCache()
    token = await authenticate()
    res = await fetch(`${baseUrl()}${path}`, {
      headers: { Authorization: `bearer ${token}`, Accept: 'application/json' },
    })
  }
  return res
}

function normDate(s: unknown): string | null {
  if (!s || typeof s !== 'string') return null
  return s.slice(0, 10)   // "1968-08-29T..." → "1968-08-29"
}

/**
 * Elenco familiari di una risorsa umana.
 * Preferisce l'endpoint v1 (per idAb, non deprecato); fallback al
 * deprecated GET /familiari/{matricola} se idAb mancante.
 */
export async function getFamiliari(opts: { idAb?: number | null; matricola?: string | null }): Promise<FamiliareNorm[]> {
  if (!cinecaConfigured) throw new CinecaNotConfiguredError()

  // ── Variante v1: GET /v1/risorse-umane/familiari/{idAb}/nucleo ──
  if (opts.idAb != null) {
    const res = await authedGet(`/v1/risorse-umane/familiari/${opts.idAb}/nucleo`)
    if (res.ok) {
      const body = await res.json() as { nucleo?: Array<Record<string, unknown>> }
      return (body.nucleo ?? []).map(f => ({
        codFisc:           String(f.codiceFiscale ?? ''),
        rapportoParentela: String(f.rapportoParentela ?? ''),
        cognome:           (f.cognome as string) ?? null,
        nome:              (f.nome as string) ?? null,
        sesso:             (f.sesso as string) ?? null,
        dataNasc:          normDate(f.dataNascita),
      })).filter(f => f.codFisc)
    }
    if (res.status !== 404) {
      throw new CinecaApiError(`Lettura familiari (idAb ${opts.idAb}) fallita (${res.status})`, res.status)
    }
    // 404 → cade sul fallback matricola
  }

  // ── Fallback deprecated: GET /familiari/{matricola} ──
  if (opts.matricola) {
    const res = await authedGet(`/familiari/${encodeURIComponent(opts.matricola)}`)
    if (!res.ok) {
      throw new CinecaApiError(`Lettura familiari (matricola ${opts.matricola}) fallita (${res.status})`, res.status)
    }
    const arr = await res.json() as Array<Record<string, unknown>>
    return (Array.isArray(arr) ? arr : []).map(f => ({
      codFisc:           String(f.codFisc ?? ''),
      rapportoParentela: String(f.rapParentela ?? ''),
      cognome:           (f.cognome as string) ?? null,
      nome:              (f.nome as string) ?? null,
      sesso:             (f.sesso as string) ?? null,
      dataNasc:          normDate(f.dataNasc),
    })).filter(f => f.codFisc)
  }

  throw new CinecaApiError('getFamiliari richiede almeno idAb o matricola')
}

/**
 * Figlio (rapportoParentela = PARENTELA_FIGLIO) più giovane, ovvero
 * con dataNasc massima. null se non ci sono figli.
 */
export async function getFiglioPiuGiovane(opts: { idAb?: number | null; matricola?: string | null }): Promise<FamiliareNorm | null> {
  const figli = (await getFamiliari(opts))
    .filter(f => f.rapportoParentela.toUpperCase() === env.PARENTELA_FIGLIO.toUpperCase())
  if (figli.length === 0) return null
  // più giovane = dataNasc massima; i null in coda
  return figli.sort((a, b) => (b.dataNasc ?? '').localeCompare(a.dataNasc ?? ''))[0]!
}
