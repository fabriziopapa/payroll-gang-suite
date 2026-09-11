// ============================================================
// PAYROLL GANG SUITE — Routes Emolumenti (/api/v1/emolumenti)
// Pannello CSA dell'area Emolumenti (dottorandi e borsisti).
//
// Fase 1: sola LETTURA. Si incollano le matricole, si sceglie un anno o un
// intervallo, e si vede che cosa e' GIA' presente in CSA per una voce (default
// 09834, maggiorazione estero). Serve a non ricaricare un mese gia' inserito:
// e' il controllo che avrebbe evitato la riga doppia di 090025 nel CSV del
// 2026-09-08. Cfr. il piano dell'area Emolumenti (documentazione interna), §5.4 e §6.1.
//
// L'idAb NON si chiede a CSA: e' gia' in anagrafiche (import SGE). La chiamata
// a stato-giuridico-economico/status senza dataRiferimento restituisce migliaia
// di record ed e' inusabile (§5.2.2 punto 4).
//
// Dati di retribuzione → stessa postura delle altre rotte CSA: solo admin +
// audit awaited di ogni lettura.
// ============================================================

import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { cinecaConfigured } from '../config/env.js'
import { requireAdmin } from '../middleware/authenticate.js'
import { PgAnagraficheRepository } from '../db/repositories/PgAnagraficheRepository.js'
import { PgAuditRepository } from '../db/repositories/PgAuditRepository.js'
import { PgEmolumentiLavorazioniRepository } from '../db/repositories/PgEmolumentiLavorazioniRepository.js'
import {
  getVociVariabili,
  CinecaApiError,
  CinecaNotConfiguredError,
  type VoceVariabileNorm,
} from '../services/cinecaService.js'
import { risolviElenco, type AnagraficaPerRicerca } from '../services/emolumenti/nominativi.js'

/** Voce della maggiorazione per estero: il caso d'uso che ha originato l'area. */
const VOCE_MAGGIORAZIONE_ESTERO = '09834'

/** Chiamate CSA-WS in parallelo. Come in routes/cineca.ts: CSA-WS via reverse
 *  proxy e' lento (~8s a chiamata), ma non va martellato. */
const CINECA_CONCURRENCY = 6

/** Tetto di matricole per richiesta: a 6 in parallelo e ~8s l'una, 200 sono
 *  gia' ~4 minuti. Oltre, l'operatore deve spezzare l'elenco. */
const MAX_MATRICOLE = 200

const ANNO_MIN = 1990
const ANNO_MAX = 2100

/** Matricola canonica CSA-WS/PGS: 6 cifre con zero-padding ('1950' → '090005'). */
function padMatricola(m: string): string {
  const t = m.trim()
  return /^\d+$/.test(t) ? t.padStart(6, '0') : t
}

export interface RisultatoMatricola {
  matricola: string
  idAb:      number | null
  /** Presente in anagrafiche PGS. */
  anagrafica: boolean
  /** Errore CSA per questa sola matricola (le altre proseguono). */
  errore:    string | null
  voci:      VoceVariabileNorm[]
}

export async function emolumentiRoutes(app: FastifyInstance): Promise<void> {

  const anagRepo  = new PgAnagraficheRepository(app.db)
  const auditRepo = new PgAuditRepository(app.db)
  const lavRepo   = new PgEmolumentiLavorazioniRepository(app.db)

  const pii = { preHandler: [app.authenticate, requireAdmin] }

  // Audit NON best-effort: se il log non si scrive, la lettura non viene
  // restituita (stessa scelta di routes/cineca.ts e verificaLiquidato.ts).
  async function audit(userId: string | undefined, ip: string, dettagli: Record<string, unknown>) {
    await auditRepo.log({
      userId: userId ?? undefined,
      azione: 'CINECA_EMOLUMENTI_LOOKUP',
      entita: 'emolumenti',
      dettagli,
      ip,
    })
  }

  const bodySchema = z.object({
    matricole:  z.array(z.string().min(1).max(20)).min(1).max(MAX_MATRICOLE),
    /** Vuoto/omesso = tutte le voci; default = maggiorazione estero. */
    codiceVoce: z.string().max(10).optional(),
    annoDa:     z.number().int().min(ANNO_MIN).max(ANNO_MAX).optional(),
    annoA:      z.number().int().min(ANNO_MIN).max(ANNO_MAX).optional(),
  })

  /** idAb locale (import SGE). La storia anagrafica ha piu' righe: basta una con idAb. */
  async function localIdAb(matricola: string): Promise<number | null> {
    const rows = await anagRepo.findByMatricola(matricola)
    return rows.find(r => r.idAb != null)?.idAb ?? null
  }

  // POST /csa/voci  { matricole[], codiceVoce?, annoDa?, annoA? }
  //   → { risultati[], parametri }
  app.post('/csa/voci', pii, async (request, reply) => {
    const b = bodySchema.parse(request.body)

    // Intervallo normalizzato: se invertito lo si raddrizza invece di rifiutarlo
    // (l'operatore ha scritto 2026-2025: l'intenzione e' chiara).
    const [annoDa, annoA] = b.annoDa != null && b.annoA != null && b.annoDa > b.annoA
      ? [b.annoA, b.annoDa]
      : [b.annoDa, b.annoA]

    const codiceVoce = b.codiceVoce === undefined ? VOCE_MAGGIORAZIONE_ESTERO : b.codiceVoce.trim()

    // Deduplica preservando l'ordine di inserimento dell'operatore.
    const matricole = [...new Set(b.matricole.map(padMatricola))]

    await audit(request.user?.id, request.ip, {
      endpoint: 'csa/voci', nMatricole: matricole.length, codiceVoce, annoDa, annoA,
    })

    if (!cinecaConfigured) return reply.code(503).send({ error: 'CINECA_NON_CONFIGURATO' })

    const risultati: RisultatoMatricola[] = new Array(matricole.length)

    // Errore trasversale (CINECA giu', proxy spento): inutile insistere su 200
    // matricole. Alla prima irraggiungibilita' si interrompe e si risponde 504.
    let fatal: unknown = null

    async function worker(startIndex: number): Promise<void> {
      for (let i = startIndex; i < matricole.length; i += CINECA_CONCURRENCY) {
        if (fatal) return
        const matricola = matricole[i]!
        const idAb = await localIdAb(matricola)
        if (idAb == null) {
          risultati[i] = { matricola, idAb: null, anagrafica: false, errore: null, voci: [] }
          continue
        }
        try {
          const tutte = await getVociVariabili(idAb)
          const voci = tutte.filter(v =>
            (codiceVoce === '' || v.codiceVoce === codiceVoce) &&
            (annoDa == null || (v.anno != null && v.anno >= annoDa)) &&
            (annoA  == null || (v.anno != null && v.anno <= annoA)),
          ).sort((x, y) => (x.dataCompetenzaVoce ?? '').localeCompare(y.dataCompetenzaVoce ?? ''))
          risultati[i] = { matricola, idAb, anagrafica: true, errore: null, voci }
        } catch (err) {
          // Timeout/irraggiungibile (nessuno status) = problema di rete, non
          // della singola matricola → ferma tutto.
          if (err instanceof CinecaApiError && err.status == null) { fatal = err; return }
          if (err instanceof CinecaNotConfiguredError)             { fatal = err; return }
          if (err instanceof CinecaApiError) {
            risultati[i] = {
              matricola, idAb, anagrafica: true,
              errore: `CSA ha risposto ${err.status}`, voci: [],
            }
            continue
          }
          fatal = err
          return
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CINECA_CONCURRENCY, matricole.length) }, (_, k) => worker(k)),
    )

    if (fatal) return errReply(reply, fatal)

    return reply.send({
      parametri: { codiceVoce, annoDa: annoDa ?? null, annoA: annoA ?? null },
      risultati,
    })
  })

  // POST /risolvi-nominativi  { righe: [{ nominativo, numeroProvvedimento? }] }
  //   → { risultati[] }
  //
  // L'ufficio incolla da Excel "Cognome Nome<TAB>numero". Qui i nomi diventano
  // matricole, contro l'anagrafica locale: nessuna chiamata a CSA, e' istantaneo.
  // Sta apposta in un passo separato dalla lettura CSA (lenta, minuti su elenchi
  // lunghi): prima si sistemano i nomi sbagliati, poi si spende il tempo.
  app.post('/risolvi-nominativi', pii, async (request, reply) => {
    const b = z.object({
      righe: z.array(z.object({
        nominativo:          z.string().min(1).max(200),
        numeroProvvedimento: z.string().max(30).optional(),
      })).min(1).max(MAX_MATRICOLE),
    }).parse(request.body)

    await audit(request.user?.id, request.ip, {
      endpoint: 'risolvi-nominativi', nRighe: b.righe.length,
    })

    // findAll() e' gia' deduplicata per matricola (DISTINCT ON) e limitata ai
    // rapporti attivi o chiusi da meno di tre anni: e' esattamente la platea
    // su cui ha senso cercare un nome.
    const anagAll = await anagRepo.findAll()

    const anagrafiche: AnagraficaPerRicerca[] = anagAll.map(a => ({
      matricola: a.matricola,
      cognNome:  a.cognNome,
      cognome:   a.cognome,
      nome:      a.nome,
      ruolo:     a.ruolo,
      idAb:      a.idAb,
    }))

    // L'area del conto (IT / SEPA / EXTRA_UE) serve al TXT delle matricole per
    // area. La agganciamo QUI e non dentro risolviElenco: quel modulo e' logica
    // pura sui nomi, con i suoi test, e non deve sapere nulla di conti bancari.
    // NB: e' una classificazione, non un IBAN — l'IBAN non entra mai in PGS.
    const areaPerMatricola = new Map(anagAll.map(a => [a.matricola, a.areaConto ?? null]))

    const risultati = risolviElenco(b.righe, anagrafiche).map(r => ({
      ...r,
      areaConto: r.matricola ? (areaPerMatricola.get(r.matricola) ?? null) : null,
    }))

    return reply.send({ risultati })
  })

  // GET /storico-ruoli/:matricola
  //   → { matricola, storico[] }
  //
  // Tutta la storia anagrafica di una matricola, un rapporto per riga.
  //
  // Perche' esiste: findAll() — quella che alimenta risolvi-nominativi — fa
  // DISTINCT ON (matricola) ORDER BY decor_inq DESC, cioe' restituisce UNA
  // riga sola, quella con la decorrenza piu' alta. Per PA/PO/RU va bene: un
  // ruolo dura anni. Per DR/BS/BE no: sono contratti brevi in catena (evento
  // 169, 018/024, 060 di proroga) intervallati da rapporti PE/AR/TU che
  // l'estrazione SGE scarta, e "l'ultimo per decorrenza" non e' detto sia il
  // ruolo giusto per il mese che si sta liquidando. Qui si vedono tutti e
  // sceglie l'operatore.
  //
  // La scelta NON torna in anagrafica: resta nella lavorazione. L'anagrafica
  // si corregge solo re-importando da SGE, che e' la sua unica sorgente.
  //
  // Il codice fiscale non esce di qui: si mappano solo i campi elencati sotto
  // (findByMatricola lo restituisce decifrato, quindi lo scarto e' voluto).
  app.get('/storico-ruoli/:matricola', pii, async (request, reply) => {
    const { matricola } = z.object({
      matricola: z.string().trim().regex(/^\d{1,6}$/),
    }).parse(request.params)

    const mat  = padMatricola(matricola)
    const rows = await anagRepo.findByMatricola(mat)

    await audit(request.user?.id, request.ip, {
      endpoint: 'storico-ruoli', matricola: mat, nRighe: rows.length,
    })

    return reply.send({
      matricola: mat,
      storico: rows.map(r => ({
        ruolo:     r.ruolo,
        druolo:    r.druolo,
        decorInq:  r.decorInq,
        finRap:    r.finRap,
        idAb:      r.idAb,
        areaConto: r.areaConto,
      })),
    })
  })

  // POST /storico-ruoli  { matricole[] }  → { storici: { matricola: [...] } }
  //
  // Versione in blocco della rotta qui sopra: una sola chiamata per tutto
  // l'elenco, invece di una per riga. Serve perche' l'interfaccia deve poter
  // segnalare l'ambiguita' PRIMA che l'operatore apra i dettagli: su
  // dottorandi e borsisti i ruoli si sovrappongono davvero — la stessa persona
  // puo' avere borsa e dottorato attivi nello stesso mese — e chi liquida deve
  // vedere subito su quali righe c'e' da scegliere.
  //
  // Sono N letture indicizzate su una tabella piccola, tutte locali: il costo
  // sta nel viaggio HTTP, ed e' quello che si risparmia.
  app.post('/storico-ruoli', pii, async (request, reply) => {
    const b = z.object({
      matricole: z.array(z.string().min(1).max(20)).min(1).max(MAX_MATRICOLE),
    }).parse(request.body)

    const matricole = [...new Set(b.matricole.map(padMatricola))]

    await audit(request.user?.id, request.ip, {
      endpoint: 'storico-ruoli-bulk', nMatricole: matricole.length,
    })

    const storici: Record<string, unknown[]> = {}
    for (const m of matricole) {
      const rows = await anagRepo.findByMatricola(m)
      storici[m] = rows.map(r => ({
        ruolo:     r.ruolo,
        druolo:    r.druolo,
        decorInq:  r.decorInq,
        finRap:    r.finRap,
        idAb:      r.idAb,
        areaConto: r.areaConto,
      }))
    }

    return reply.send({ storici })
  })

  // ==========================================================
  // LAVORAZIONI — salvataggio e recupero del lavoro in corso
  //
  // Stessa idea dei gruppi di liquidazione (nome, archiviazione, data di
  // liquidazione) ma su tabella propria: `bozze` e l'area Liquidazioni non
  // si toccano (§8.1).
  //
  // `dati` contiene nominativi, matricole e importi -> stessa postura del
  // resto dell'area: admin + audit su OGNI operazione, letture comprese.
  // ==========================================================

  /** Il payload porta fino a 200 righe con lo snapshot CSA: 1 MB (default
   *  Fastify) sta stretto. 8 MB e' abbondante e resta comunque un tetto. */
  const LIMITE_PAYLOAD = 8 * 1024 * 1024

  async function auditLav(
    userId: string | undefined, ip: string, dettagli: Record<string, unknown>,
  ) {
    await auditRepo.log({
      userId: userId ?? undefined,
      azione: 'EMOLUMENTI_LAVORAZIONE',
      entita: 'emolumenti_lavorazione',
      entitaId: typeof dettagli['id'] === 'string' ? dettagli['id'] : undefined,
      dettagli,
      ip,
    })
  }

  const idParam = z.object({ id: z.string().uuid() })

  // GET /lavorazioni[?stato=bozza|archiviata] — elenco SENZA il payload
  app.get('/lavorazioni', pii, async (request, reply) => {
    const q = z.object({
      stato: z.enum(['bozza', 'archiviata']).optional(),
    }).parse(request.query)

    const righe = await lavRepo.list(q.stato)
    await auditLav(request.user?.id, request.ip, {
      op: 'list', stato: q.stato ?? 'tutte', n: righe.length,
    })
    return reply.send({ lavorazioni: righe })
  })

  // GET /lavorazioni/:id — lavorazione completa, con `dati`
  app.get('/lavorazioni/:id', pii, async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const row = await lavRepo.get(id)
    if (!row) return reply.code(404).send({ error: 'LAVORAZIONE_NON_TROVATA' })

    await auditLav(request.user?.id, request.ip, { op: 'get', id, nome: row.nome })
    return reply.send(row)
  })

  // POST /lavorazioni  { nome, tipo?, dati }
  app.post('/lavorazioni', { ...pii, bodyLimit: LIMITE_PAYLOAD }, async (request, reply) => {
    const b = z.object({
      nome: z.string().trim().min(1).max(200),
      tipo: z.string().trim().max(10).optional(),
      dati: z.record(z.unknown()),
    }).parse(request.body)

    if (await lavRepo.nomeEsiste(b.nome)) {
      return reply.code(409).send({ error: 'NOME_GIA_USATO' })
    }

    const row = await lavRepo.create({
      nome: b.nome, tipo: b.tipo ?? null, dati: b.dati, createdBy: request.user?.id ?? null,
    })
    await auditLav(request.user?.id, request.ip, { op: 'create', id: row.id, nome: row.nome })
    return reply.code(201).send(row)
  })

  // PUT /lavorazioni/:id  { nome?, tipo?, dati? }
  app.put('/lavorazioni/:id', { ...pii, bodyLimit: LIMITE_PAYLOAD }, async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const b = z.object({
      nome: z.string().trim().min(1).max(200).optional(),
      tipo: z.string().trim().max(10).nullable().optional(),
      dati: z.record(z.unknown()).optional(),
    }).parse(request.body)

    if (b.nome && await lavRepo.nomeEsiste(b.nome, id)) {
      return reply.code(409).send({ error: 'NOME_GIA_USATO' })
    }

    const row = await lavRepo.update(id, b)
    if (!row) return reply.code(404).send({ error: 'LAVORAZIONE_NON_TROVATA' })

    await auditLav(request.user?.id, request.ip, { op: 'update', id, nome: row.nome })
    return reply.send(row)
  })

  // POST /lavorazioni/:id/archivia  { dataLiquidazione }
  app.post('/lavorazioni/:id/archivia', pii, async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const b = z.object({
      dataLiquidazione:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      idLiquidazioneCsa: z.string().trim().max(40).optional(),
    }).parse(request.body)

    const row = await lavRepo.archivia(id, b.dataLiquidazione, b.idLiquidazioneCsa)
    // 404 anche se la lavorazione esiste ma non e' piu' una bozza: il client
    // ha una vista vecchia e deve ricaricare, non insistere.
    if (!row) return reply.code(404).send({ error: 'LAVORAZIONE_NON_ARCHIVIABILE' })

    await auditLav(request.user?.id, request.ip, {
      op: 'archivia', id, nome: row.nome, dataLiquidazione: b.dataLiquidazione,
    })
    return reply.send(row)
  })

  // POST /lavorazioni/:id/riapri
  app.post('/lavorazioni/:id/riapri', pii, async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const row = await lavRepo.riapri(id)
    if (!row) return reply.code(404).send({ error: 'LAVORAZIONE_NON_RIAPRIBILE' })

    await auditLav(request.user?.id, request.ip, { op: 'riapri', id, nome: row.nome })
    return reply.send(row)
  })

  // DELETE /lavorazioni/:id — solo bozze (il repository lo impone)
  app.delete('/lavorazioni/:id', pii, async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const esistente = await lavRepo.get(id)
    const fatto = await lavRepo.remove(id)
    if (!fatto) return reply.code(404).send({ error: 'LAVORAZIONE_NON_ELIMINABILE' })

    await auditLav(request.user?.id, request.ip, {
      op: 'delete', id, nome: esistente?.nome ?? null,
    })
    return reply.code(204).send()
  })
}

// Errori CINECA → codice generico + solo lo STATUS numerico (mai il message
// interno, che puo' contenere PII/path).
function errReply(reply: FastifyReply, err: unknown) {
  if (!cinecaConfigured || err instanceof CinecaNotConfiguredError) {
    return reply.code(503).send({ error: 'CINECA_NON_CONFIGURATO' })
  }
  if (err instanceof CinecaApiError) {
    return err.status != null
      ? reply.code(502).send({ error: 'CINECA_API_ERROR', status: err.status })
      : reply.code(504).send({ error: 'CINECA_UNREACHABLE' })
  }
  throw err
}
