// ============================================================
// PAYROLL GANG SUITE — CINECA CSA-WS client
// Proxy server-side: auth JWT (cache) + lookup familiari/figli (WE)
// e codice fiscale dipendente (WD, fallback al dato locale).
// Doc: https://docs.csa-ws.cineca.it/  — tenant: env.CINECA_TENANT
// Mai chiamato dal client: credenziali in .env, CF = dati personali.
// ============================================================

import { env, cinecaConfigured, cinecaProxyConfigured } from '../config/env.js'

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

/** idAb locale assente: l'endpoint familiari v1 richiede idAb, non interrogabile. */
export class CinecaNoIdAbError extends Error {
  constructor(readonly matricola: string) {
    super(`idAb assente per matricola ${matricola}`)
    this.name = 'CinecaNoIdAbError'
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

// Timeout per ogni chiamata verso CSA-WS — evita hang illimitati (DoS/UX).
const FETCH_TIMEOUT_MS = 8000

// ── Modalità proxy (runtime, toggle 'cinecaUseProxy' in Impostazioni) ─
// CSA-WS geo-blocca gli IP extra-UE: con proxy attivo le chiamate passano
// dal reverse proxy in Italia (CINECA_PROXY_URL + header X-Proxy-Auth).
let useProxy = false

/** Attiva/disattiva il proxy. No-op (con warn del chiamante) se il proxy non è in .env. */
export function setCinecaProxyMode(on: boolean): void {
  useProxy = on && cinecaProxyConfigured
  resetTokenCache()   // il token va richiesto dal nuovo percorso di rete
}

/** true se le chiamate CSA-WS stanno passando dal proxy. */
export function cinecaProxyActive(): boolean {
  return useProxy
}

function baseUrl(): string {
  // base + tenant, senza slash doppi
  const base = useProxy ? env.CINECA_PROXY_URL! : env.CINECA_BASE_URL!
  return `${base.replace(/\/+$/, '')}/${env.CINECA_TENANT}`
}

/** Header aggiuntivi quando si passa dal proxy (auth verso il Caddy italiano). */
function proxyHeaders(): Record<string, string> {
  return useProxy ? { 'X-Proxy-Auth': env.CINECA_PROXY_SECRET! } : {}
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

  let res: Response
  try {
    res = await fetch(`${baseUrl()}/authentication`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...proxyHeaders() },
      body: JSON.stringify({
        username: env.CINECA_USER,
        password: env.CINECA_PASSWORD,
        group:    env.CINECA_GROUPS,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    throw new CinecaApiError('Autenticazione CINECA non raggiungibile (timeout)')
  }

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
  const doFetch = (token: string) =>
    fetch(`${baseUrl()}${path}`, {
      headers: { Authorization: `bearer ${token}`, Accept: 'application/json', ...proxyHeaders() },
      signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  let token = await authenticate()
  let res: Response
  try {
    res = await doFetch(token)
  } catch {
    throw new CinecaApiError(`CSA-WS non raggiungibile (timeout) su ${path}`)
  }
  if (res.status === 401) {
    resetTokenCache()
    token = await authenticate()
    try {
      res = await doFetch(token)
    } catch {
      throw new CinecaApiError(`CSA-WS non raggiungibile (timeout) su ${path}`)
    }
  }
  return res
}

function normDate(s: unknown): string | null {
  if (!s || typeof s !== 'string') return null
  return s.slice(0, 10)   // "1968-08-29T..." → "1968-08-29"
}

/**
 * Elenco familiari di una risorsa umana — SOLO endpoint v1 per idAb:
 *   GET /v1/risorse-umane/familiari/{idAb}/nucleo
 * L'endpoint deprecato per matricola NON è interrogabile (non risponde) →
 * senza idAb si lancia CinecaNoIdAbError (CF inseribile a mano lato UI).
 */
export async function getFamiliari(opts: { idAb?: number | null; matricola?: string | null }): Promise<FamiliareNorm[]> {
  if (!cinecaConfigured) throw new CinecaNotConfiguredError()
  if (opts.idAb == null) throw new CinecaNoIdAbError(opts.matricola ?? '')

  const res = await authedGet(`/v1/risorse-umane/familiari/${opts.idAb}/nucleo`)
  if (!res.ok) {
    throw new CinecaApiError(`Lettura familiari (idAb ${opts.idAb}) fallita (${res.status})`, res.status)
  }
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
