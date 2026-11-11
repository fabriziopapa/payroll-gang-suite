// ============================================================
// PAYROLL GANG SUITE — Rubrica d'Ateneo (servizio riutilizzabile)
//
// La rubrica pubblica del portale dell'Ateneo (ParthenopePortaleDidatticaRest):
//   · ricerca  GET /integration/ricercaPersonale/*/{cognome}/*/*/*/1?pageNumber&pageMaxElement
//              il secondo filtro e' il cognome (inizia per, senza maiuscole;
//              l'apostrofo va codificato); '*' = tutti. idAb, nome, cognome,
//              codice fiscale, ruolo, afferenza; email sempre null.
//              Misurato l'11/11/2026: per cognome ~0,6 s; l'elenco intero
//              (664 persone) ~18 s in una sola richiesta.
//   · dettaglio GET /integration/dettaglioPersonaleById/{idAb} — l'email
//              ('-' = non pubblicata), ~0,4 s; idAb inesistente = errorCode -99
//
// Regole:
//   · solo dal server, mai dal browser; una richiesta alla volta, con un
//     limite di tempo e UN nuovo tentativo su 429/5xx;
//   · tutto resta in memoria 12 ore: ricerche per cognome, dettagli,
//     elenco intero (quest'ultimo solo per chi lo chiede: il CRAL non lo usa);
//   · verifica TLS SEMPRE attiva, con l'intermedio mancante (certificati.ts),
//     mai un ripiego senza verifica. L'intermedio incorporato si controlla
//     all'avvio (impronta SHA-256 attesa, date): se non torna, non si usa e
//     ogni chiamata fallisce. A ogni connessione si annotano scadenza ed
//     emittente del certificato del server: `statoCertificati()` li espone
//     per l'avviso in anticipo (server in scadenza, intermedio in scadenza,
//     Ateneo che cambia autorita' di certificazione);
//   · il CODICE FISCALE non esce mai di qui verso il client: serve solo ad
//     abbinare una persona all'anagrafica PGS quando manca l'idAb. Non si
//     salva, non si scrive nei log.
//
// Il trasporto e' sostituibile (test, o un domani un proxy): `creaRubrica`.
// ============================================================

import https from 'node:https'
import tls, { type TLSSocket } from 'node:tls'
import { X509Certificate } from 'node:crypto'
import { GEANT_TLS_ECC_1, IMPRONTA_GEANT_TLS_ECC_1 } from './certificati.js'

export const RUBRICA_HOST = 'www.uniparthenope.it'
export const RUBRICA_PORTA = 8443
export const RUBRICA_BASE = '/ParthenopePortaleDidatticaRest/rest/integration'

/** Una persona dell'elenco. `codFisc` resta sul server (vedi `pubblica`). */
export interface PersonaRubrica {
  idAb: number; cognome: string; nome: string; codFisc: string
  ruolo: string; afferenza: string
}
/** Cio' che puo' uscire verso il client. */
export type PersonaPubblica = Omit<PersonaRubrica, 'codFisc'> & { email?: string }
export const pubblica = (p: PersonaRubrica, email?: string): PersonaPubblica =>
  ({ idAb: p.idAb, cognome: p.cognome, nome: p.nome, ruolo: p.ruolo, afferenza: p.afferenza, ...(email !== undefined ? { email } : {}) })

export class RubricaNonRaggiungibile extends Error {
  constructor(readonly motivo: string) { super(`RUBRICA_NON_RAGGIUNGIBILE: ${motivo}`); this.name = 'RubricaNonRaggiungibile' }
}

export type Trasporto = (percorso: string, timeoutMs?: number) => Promise<{ status: number; corpo: string }>

const TIMEOUT_MS = 20_000
/** L'elenco intero e' lento (~18 s): limite piu' largo, una pagina sola se possibile. */
const TIMEOUT_ELENCO_MS = 90_000
const PER_PAGINA = 1000
const MAX_PAGINE = 10

// ── Certificati ───────────────────────────────────────────────
/** Avviso in anticipo: giorni prima della scadenza. */
export const AVVISO_GIORNI = { server: 30, intermedio: 180 } as const
const GIORNO = 86_400_000

export interface InfoCertificato { soggetto: string; emittente: string; dal: string; scade: string; giorni: number; impronta: string }
function info(c: X509Certificate, ora = Date.now()): InfoCertificato {
  const scade = new Date(c.validTo)
  return {
    soggetto: c.subject.replace(/\n/g, ', '), emittente: c.issuer.replace(/\n/g, ', '),
    dal: new Date(c.validFrom).toISOString(), scade: scade.toISOString(),
    giorni: Math.floor((scade.getTime() - ora) / GIORNO), impronta: c.fingerprint256,
  }
}
/** L'intermedio incorporato, controllato una volta all'avvio: impronta e date. */
export function controllaIntermedio(pem = GEANT_TLS_ECC_1, attesa = IMPRONTA_GEANT_TLS_ECC_1, ora = Date.now()):
  { ok: true; info: InfoCertificato } | { ok: false; motivo: string; info?: InfoCertificato } {
  let c: X509Certificate
  try { c = new X509Certificate(pem) } catch { return { ok: false, motivo: 'certificato intermedio illeggibile' } }
  const i = info(c, ora)
  if (i.impronta !== attesa) return { ok: false, motivo: 'impronta del certificato intermedio diversa da quella attesa: file alterato', info: i }
  if (ora < new Date(c.validFrom).getTime()) return { ok: false, motivo: 'certificato intermedio non ancora valido', info: i }
  if (i.giorni < 0) return { ok: false, motivo: 'certificato intermedio scaduto', info: i }
  return { ok: true, info: i }
}
const intermedio = controllaIntermedio()
// se l'intermedio non torna NON si aggiunge: la connessione fallira' per verifica, mai il contrario
const ca = intermedio.ok ? [...tls.rootCertificates, GEANT_TLS_ECC_1] : [...tls.rootCertificates]
const agent = new https.Agent({ keepAlive: false, ca, maxSockets: 1 })

export interface UltimoContatto { il: string; esito: 'OK' | 'ERRORE'; errore?: string; server?: InfoCertificato }
let ultimo: UltimoContatto | null = null

/** Errori TLS in parole: il codice resta tra parentesi per chi deve intervenire. */
export function erroreTls(e: unknown): string {
  const code = (e as { code?: string })?.code ?? ''
  const m: Record<string, string> = {
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "certificato del server non verificabile: l'Ateneo puo' aver cambiato autorita' di certificazione, va aggiornato il certificato intermedio in PGS",
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "certificato del server non verificabile: l'Ateneo puo' aver cambiato autorita' di certificazione, va aggiornato il certificato intermedio in PGS",
    CERT_HAS_EXPIRED: "certificato del server dell'Ateneo scaduto",
    CERT_NOT_YET_VALID: "certificato del server dell'Ateneo non ancora valido (orologio del server?)",
    ERR_TLS_CERT_ALTNAME_INVALID: "il certificato non e' di www.uniparthenope.it",
    DEPTH_ZERO_SELF_SIGNED_CERT: 'certificato autofirmato: connessione rifiutata',
    SELF_SIGNED_CERT_IN_CHAIN: 'certificato autofirmato nella catena: connessione rifiutata',
  }
  const base = e instanceof Error ? e.message : 'errore di rete'
  return m[code] ? `${m[code]} (${code})` : code ? `${base} (${code})` : base
}

/** Stato dei certificati per l'avviso: intermedio incorporato e ultimo contatto col server. */
export function statoCertificati(ora = Date.now()): {
  intermedio: { ok: boolean; motivo?: string; info?: InfoCertificato; inScadenza: boolean }
  ultimo: UltimoContatto | null
  avvisi: string[]
} {
  const ci = controllaIntermedio(GEANT_TLS_ECC_1, IMPRONTA_GEANT_TLS_ECC_1, ora)
  const avvisi: string[] = []
  const inScadenza = !!ci.info && ci.info.giorni <= AVVISO_GIORNI.intermedio
  if (!ci.ok) avvisi.push(ci.motivo)
  else if (inScadenza) avvisi.push(`il certificato intermedio scade fra ${ci.info.giorni} giorni: va sostituito in PGS`)
  if (ultimo?.esito === 'ERRORE') avvisi.push(`ultimo contatto fallito: ${ultimo.errore}`)
  if (ultimo?.server) {
    const g = Math.floor((new Date(ultimo.server.scade).getTime() - ora) / GIORNO)
    if (g <= AVVISO_GIORNI.server) avvisi.push(`il certificato del server dell'Ateneo scade fra ${g} giorni`)
    if (!/CN=GEANT TLS ECC 1\b/.test(ultimo.server.emittente)) avvisi.push(`il certificato del server ora e' firmato da «${ultimo.server.emittente}»: controllare l'intermedio`)
  }
  return { intermedio: { ok: ci.ok, ...(ci.ok ? {} : { motivo: ci.motivo }), ...(ci.info ? { info: ci.info } : {}), inScadenza }, ultimo, avvisi }
}

/** Trasporto vero: HTTPS con verifica, intestazioni richieste dal portale. */
export const trasportoHttps: Trasporto = (percorso, timeoutMs = TIMEOUT_MS) => new Promise((resolve, reject) => {
  const req = https.get({
    host: RUBRICA_HOST, port: RUBRICA_PORTA, path: RUBRICA_BASE + percorso, agent, timeout: timeoutMs,
    headers: {
      Accept: 'application/json',
      // senza Origin e Referer del portale il server risponde 403
      Origin: `https://${RUBRICA_HOST}`, Referer: `https://${RUBRICA_HOST}/`,
      'User-Agent': 'PayrollGangSuite (Ufficio Stipendi, Universita Parthenope)',
    },
  }, res => {
    const pezzi: Buffer[] = []
    let n = 0
    res.on('data', (b: Buffer) => { n += b.length; if (n > 20 * 1024 * 1024) { req.destroy(new Error('risposta troppo grande')); return } pezzi.push(b) })
    res.on('end', () => resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(pezzi).toString('utf8') }))
    res.on('error', reject)
  })
  // il certificato appena verificato (scadenza, emittente) per l'avviso: alla fine
  // dell'handshake, perche' a risposta arrivata Node non lo espone piu'.
  // agente senza keep-alive: ogni richiesta rifa' (e riverifica) l'handshake.
  req.on('socket', (s: TLSSocket) => s.once('secureConnect', () => {
    try { const pc = s.getPeerX509Certificate(); ultimo = { il: new Date().toISOString(), esito: 'OK', ...(pc ? { server: info(pc) } : {}) } } catch { /* solo diagnostica */ }
  }))
  req.on('timeout', () => req.destroy(new Error('timeout')))
  req.on('error', e => { ultimo = { il: new Date().toISOString(), esito: 'ERRORE', errore: erroreTls(e) }; reject(e) })
})

const testo = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())
/** '-', vuoto, null → '' ; altrimenti minuscolo. */
export const emailPulita = (v: unknown): string => {
  const s = testo(v).toLowerCase()
  return s && s !== '-' && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(s) ? s : ''
}
function persona(x: Record<string, unknown>): PersonaRubrica | null {
  const idAb = Number(x['idAb'])
  if (!Number.isInteger(idAb) || idAb <= 0) return null
  return {
    idAb, cognome: testo(x['cognome']), nome: testo(x['nome']), codFisc: testo(x['codFisc']).toUpperCase(),
    ruolo: testo(x['tipoRuoloDesc']), afferenza: testo(x['afferenza']),
  }
}

export interface Rubrica {
  /** Persone il cui cognome inizia per `cognome` (veloce: una richiesta). */
  cerca(cognome: string): Promise<PersonaRubrica[]>
  /** Una persona per idAb, con l'email pubblicata ('' se non c'e'); null se l'idAb non c'e'. */
  dettaglio(idAb: number): Promise<{ persona: PersonaRubrica; email: string } | null>
  /** Solo l'email pubblicata ('' se non c'e'). */
  email(idAb: number): Promise<string>
  /** Tutto l'elenco (lento la prima volta: ~18 s). */
  elenco(): Promise<PersonaRubrica[]>
  /** Una richiesta minima, senza memoria: per «Verifica ora» (connessione e certificato). */
  verifica(): Promise<void>
  /** Svuota la memoria. */
  dimentica(): void
}

export function creaRubrica(o: { trasporto?: Trasporto; ttlMs?: number; ora?: () => number; attesaRiprova?: number } = {}): Rubrica {
  const trasporto = o.trasporto ?? trasportoHttps
  const ttl = o.ttlMs ?? 12 * 3600_000
  const ora = o.ora ?? Date.now
  let cache: { il: number; righe: PersonaRubrica[] } | null = null
  let inCorso: Promise<PersonaRubrica[]> | null = null
  const dettagli = new Map<number, { il: number; v: { persona: PersonaRubrica; email: string } | null }>()
  const ricerche = new Map<string, { il: number; v: PersonaRubrica[] }>()
  const fresco = (il: number) => ora() - il < ttl

  /** `nonTrovato`: errorCode che vuol dire «non c'e'» invece che errore. */
  async function json(percorso: string, timeoutMs?: number, nonTrovato?: (d: Record<string, unknown>) => boolean): Promise<Record<string, unknown> | null> {
    for (let tentativo = 0; ; tentativo++) {
      let r: { status: number; corpo: string }
      try { r = await trasporto(percorso, timeoutMs) } catch (e) {
        if (tentativo === 0) { await new Promise(f => setTimeout(f, o.attesaRiprova ?? 1000)); continue }
        throw new RubricaNonRaggiungibile(erroreTls(e))
      }
      if ((r.status === 429 || r.status >= 500) && tentativo === 0) { await new Promise(f => setTimeout(f, o.attesaRiprova ?? 1000)); continue }
      if (r.status !== 200) throw new RubricaNonRaggiungibile(`HTTP ${r.status}`)
      let d: Record<string, unknown>
      try { d = JSON.parse(r.corpo) as Record<string, unknown> } catch { throw new RubricaNonRaggiungibile('risposta non JSON') }
      if (Number(d['errorCode'] ?? 0) !== 0) {
        if (nonTrovato?.(d)) return null
        throw new RubricaNonRaggiungibile(`errore del portale: ${testo(d['errorMessage']) || d['errorCode']}`)
      }
      return d
    }
  }
  const lista = (d: Record<string, unknown> | null) =>
    (Array.isArray(d?.['personaleList']) ? d!['personaleList'] as Array<Record<string, unknown>> : []).map(persona).filter((p): p is PersonaRubrica => !!p)

  async function scarica(): Promise<PersonaRubrica[]> {
    const righe = new Map<number, PersonaRubrica>()
    let totale = Infinity
    for (let pagina = 1; pagina <= MAX_PAGINE && righe.size < totale; pagina++) {
      const d = await json(`/ricercaPersonale/*/*/*/*/*/1?pageNumber=${pagina}&pageMaxElement=${PER_PAGINA}`, TIMEOUT_ELENCO_MS)
      const t = Number(d?.['totalCount']); if (Number.isFinite(t) && t >= 0) totale = t
      const l = lista(d)
      if (!l.length) break
      for (const p of l) righe.set(p.idAb, p)
    }
    if (!righe.size) throw new RubricaNonRaggiungibile('elenco vuoto')
    return [...righe.values()]
  }

  const r: Rubrica = {
    async cerca(cognome) {
      const c = cognome.trim().replace(/\s+/g, ' ')
      if (c.length < 2) return []
      const k = c.toUpperCase()
      const g = ricerche.get(k); if (g && fresco(g.il)) return g.v
      // la ricerca del portale e' «inizia per»: qui si tiene tutto, il filtro esatto lo fa chi chiama
      const d = await json(`/ricercaPersonale/*/${encodeURIComponent(c)}/*/*/*/1?pageNumber=1&pageMaxElement=100`)
      const v = lista(d)
      ricerche.set(k, { il: ora(), v })
      return v
    },
    async dettaglio(idAb) {
      if (!Number.isInteger(idAb) || idAb <= 0) return null
      const g = dettagli.get(idAb); if (g && fresco(g.il)) return g.v
      // idAb inesistente: errorCode -99 senza «personale»
      const d = await json(`/dettaglioPersonaleById/${idAb}`, undefined, x => !x['personale'])
      const p = d ? persona((d['personale'] ?? {}) as Record<string, unknown>) : null
      const v = p ? { persona: p, email: emailPulita((d!['personale'] as Record<string, unknown>)['email']) } : null
      dettagli.set(idAb, { il: ora(), v })
      return v
    },
    async email(idAb) { return (await r.dettaglio(idAb))?.email ?? '' },
    async elenco() {
      if (cache && fresco(cache.il)) return cache.righe
      // richieste contemporanee: un solo scaricamento
      inCorso ??= scarica().then(x => { cache = { il: ora(), righe: x }; return x }).finally(() => { inCorso = null })
      return inCorso
    },
    async verifica() { await json('/ricercaPersonale/*/ROSSI/*/*/*/1?pageNumber=1&pageMaxElement=1') },
    dimentica() { cache = null; dettagli.clear(); ricerche.clear() },
  }
  return r
}

/** Il servizio condiviso da tutto il server. */
export const rubricaAteneo = creaRubrica()
