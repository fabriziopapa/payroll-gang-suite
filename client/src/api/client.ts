// ============================================================
// PAYROLL GANG SUITE — API Client
// Fetch wrapper con JWT auto-refresh e retry automatico
// ============================================================

const BASE = '/api/v1'

// ── Token storage (in-memory — sicuro contro XSS) ────────────
let _token: string | null = null
let _onUnauth: (() => void) | null = null

export const setAccessToken = (t: string | null): void => { _token = t }
export const getAccessToken  = (): string | null => _token
export const setOnUnauthorized = (fn: () => void): void => { _onUnauth = fn }

// ── Mutex per evitare refresh paralleli ──────────────────────
let _refreshing = false
let _queue: Array<(t: string | null) => void> = []

async function tryRefresh(): Promise<string | null> {
  try {
    const r = await fetch(`${BASE}/auth/refresh`, {
      method:      'POST',
      credentials: 'include',
    })
    if (!r.ok) return null
    return ((await r.json()) as { accessToken: string }).accessToken
  } catch {
    return null
  }
}

// ── Fetch principale ─────────────────────────────────────────
export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<T> {
  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), timeoutMs)

  const req = (tok: string | null) =>
    fetch(`${BASE}${path}`, {
      ...init,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
        ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
      },
    })

  try {
  let res = await req(_token)

  // Token scaduto → tenta refresh
  if (res.status === 401) {
    let newTok: string | null

    if (_refreshing) {
      newTok = await new Promise<string | null>(ok => _queue.push(ok))
    } else {
      _refreshing = true
      newTok = await tryRefresh()
      _refreshing = false
      _queue.forEach(ok => ok(newTok))
      _queue = []
    }

    if (newTok) {
      _token = newTok
      res = await req(newTok)
    } else {
      _onUnauth?.()
      throw new ApiError('UNAUTHORIZED', 401)
    }
  }

  if (!res.ok) {
    let code = `HTTP_${res.status}`
    try { code = ((await res.json()) as { error?: string }).error ?? code } catch { /* ignore */ }
    throw new ApiError(code, res.status)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
  } finally {
    clearTimeout(timeoutId)
  }
}

// ── Errore tipizzato ─────────────────────────────────────────
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code)
    this.name = 'ApiError'
  }
}
