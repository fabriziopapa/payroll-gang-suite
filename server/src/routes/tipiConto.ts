// ============================================================
// PAYROLL GANG SUITE — Emolumenti · Tipi conto
// Prefisso: /api/v1/emolumenti/tipi-conto  (solo amministratori)
//
// Per un mese: si leggono da CSA le testate del liquidato DR (comparto 1),
// si classifica ogni matricola in IT / SEPA / EXTRA_UE / DA CHIARIRE con la
// regola di lib/areaConto.ts, si salva, si conferma, si scaricano i TXT.
//
//   GET    /                        elenco (non archiviate)
//   POST   /recupera                { anno, mese, progrLiquidazione? } -> { id }
//   GET    /:id                     testata + righe (+ suggerimento anagrafica sulle DA CHIARIRE)
//   POST   /:id/riclassifica        rilegge lo stesso mese da CSA
//   POST   /:id/conferma            409 se il mese ha gia' una confermata
//   PATCH  /:id/righe/:matricola    nazione a mano su una riga DA CHIARIRE
//   GET    /:id/txt/:tipo           { nomeFile, contenuto } — solo confermate
//   DELETE /:id                     archiviazione logica
//
// PRIVACY. Dalle testate restano matricola, progressivi e due lettere di
// nazione (normalizzaTestate): nessun IBAN arriva al database o al client.
// ============================================================

import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { cinecaConfigured } from '../config/env.js'
import { requireAdmin } from '../middleware/authenticate.js'
import { PgAnagraficheRepository } from '../db/repositories/PgAnagraficheRepository.js'
import { PgAuditRepository } from '../db/repositories/PgAuditRepository.js'
import { PgEmolumentiTipiContoRepository } from '../db/repositories/PgEmolumentiTipiContoRepository.js'
import {
  getLiquidatoTestate, CinecaApiError, CinecaNotConfiguredError,
} from '../services/cinecaService.js'
import { contiDaTestate } from '../services/emolumenti/testate.js'
import {
  righeDaConti, ultimoGiornoMese, fileTxt,
} from '../services/emolumenti/tipiConto.js'
import {
  areaConto, EPC_VERSIONE, elencoDalDatabase, normalizzaNazione,
} from '../lib/areaConto.js'
import type { NuoveRigheTipoConto } from '../db/IRepository.js'

// Decisione dell'ufficio: la pagina lavora sui dottorandi, comparto 1.
const RUOLO    = 'DR'
const COMPARTO = '1'
const ANNO_MIN = 1990
const ANNO_MAX = 2100

export async function tipiContoRoutes(app: FastifyInstance): Promise<void> {
  const repo      = new PgEmolumentiTipiContoRepository(app.db)
  const anagRepo  = new PgAnagraficheRepository(app.db)
  const auditRepo = new PgAuditRepository(app.db)

  const pii = { preHandler: [app.authenticate, requireAdmin] }
  const idParam = z.object({ id: z.string().uuid() })

  // Audit NON best-effort, come nel resto di Emolumenti.
  async function audit(
    userId: string | undefined, ip: string, dettagli: Record<string, unknown>,
    azione = 'EMOLUMENTI_TIPICONTO',
  ) {
    await auditRepo.log({
      userId: userId ?? undefined,
      azione,
      entita: 'emolumenti_tipiconto',
      entitaId: typeof dettagli['id'] === 'string' ? dettagli['id'] : undefined,
      dettagli,
      ip,
    })
  }

  /** Legge da CSA e calcola le righe. Lancia gli errori CINECA al chiamante. */
  async function leggiDaCsa(anno: number, mese: number, progr: string | null): Promise<NuoveRigheTipoConto> {
    const testate = await getLiquidatoTestate({
      anno, mese, ruolo: RUOLO, comparto: COMPARTO,
      ...(progr ? { progrLiquidazione: progr } : {}),
    })
    const esito = contiDaTestate(testate)
    const oggi  = new Date().toISOString().slice(0, 10)
    // Le aree sono calcolate da contiDaTestate con l'elenco in vigore oggi:
    // l'elaborazione registra QUALE elenco ha usato.
    return {
      testateLette:  esito.testateLette,
      testateLiquid: esito.testateLiquide,
      elencoPaesi:   elencoDalDatabase() ? `paesi_conto ${oggi}` : `EPC ${EPC_VERSIONE}`,
      righe:         righeDaConti(esito.conti),
    }
  }

  app.get('/', pii, async (_request, reply) => {
    return reply.send({ elaborazioni: await repo.elenco() })
  })

  app.post('/recupera', pii, async (request, reply) => {
    const b = z.object({
      anno:              z.number().int().min(ANNO_MIN).max(ANNO_MAX),
      mese:              z.number().int().min(1).max(12),
      progrLiquidazione: z.string().trim().regex(/^\d{3}$/).optional(),
    }).parse(request.body)

    await audit(request.user?.id, request.ip, {
      endpoint: 'tipi-conto/recupera', anno: b.anno, mese: b.mese, ruolo: RUOLO,
      comparto: COMPARTO, progrLiquidazione: b.progrLiquidazione ?? null,
    }, 'CINECA_EMOLUMENTI_LOOKUP')

    if (!cinecaConfigured) return reply.code(503).send({ error: 'CINECA_NON_CONFIGURATO' })

    let dati: NuoveRigheTipoConto
    try {
      dati = await leggiDaCsa(b.anno, b.mese, b.progrLiquidazione ?? null)
    } catch (err) {
      return errReply(reply, err)
    }
    if (dati.righe.length === 0) {
      return reply.code(404).send({ error: 'NESSUNA_TESTATA', testateLette: dati.testateLette })
    }

    const id = await repo.crea({
      anno: b.anno, mese: b.mese, ruolo: RUOLO, comparto: COMPARTO,
      progrLiquidazione: b.progrLiquidazione ?? null,
      userId: request.user?.id ?? null, ...dati,
    })
    await audit(request.user?.id, request.ip, {
      op: 'crea', id, anno: b.anno, mese: b.mese, nRighe: dati.righe.length,
    })
    return reply.code(201).send({ id })
  })

  app.get('/:id', pii, async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const letta = await repo.leggi(id)
    if (!letta) return reply.code(404).send({ error: 'ELABORAZIONE_NON_TROVATA' })

    // Nomi e suggerimento dall'anagrafica in vigore l'ultimo giorno del mese.
    // Il suggerimento e' SOLO mostrato: la nazione vera e' quella su cui CSA
    // ha pagato, e sulle righe DA CHIARIRE si inserisce a mano.
    const data = ultimoGiornoMese(letta.elab.anno, letta.elab.mese)
    const anag = new Map<string, { cognNome: string; nazIban: string | null }>()
    for (const a of await anagRepo.findAllAtDate(data)) {
      const prec = anag.get(a.matricola)
      if (!prec || a.ruolo === RUOLO) anag.set(a.matricola, { cognNome: a.cognNome, nazIban: a.nazIban ?? null })
    }

    const righe = letta.righe.map(r => {
      const a = anag.get(r.matricola)
      const nazAnag = normalizzaNazione(a?.nazIban ?? null)
      return {
        ...r,
        nominativo: a?.cognNome ?? null,
        suggerimento: r.tipoConto === 'DA_CHIARIRE' && nazAnag
          ? { nazIban: nazAnag, tipoConto: areaConto(nazAnag, data) }
          : null,
      }
    })
    return reply.send({ elaborazione: letta.elab, righe })
  })

  app.post('/:id/riclassifica', pii, async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const letta = await repo.leggi(id)
    if (!letta) return reply.code(404).send({ error: 'ELABORAZIONE_NON_TROVATA' })
    const e = letta.elab

    await audit(request.user?.id, request.ip, {
      endpoint: 'tipi-conto/riclassifica', id, anno: e.anno, mese: e.mese,
      ruolo: e.ruolo, comparto: e.comparto, progrLiquidazione: e.progrLiquidazione,
    }, 'CINECA_EMOLUMENTI_LOOKUP')

    if (!cinecaConfigured) return reply.code(503).send({ error: 'CINECA_NON_CONFIGURATO' })

    let dati: NuoveRigheTipoConto
    try {
      dati = await leggiDaCsa(e.anno, e.mese, e.progrLiquidazione)
    } catch (err) {
      return errReply(reply, err)
    }
    // Se CSA non restituisce piu' nulla (la liquidazione "a mazza secca" e'
    // stata cancellata) l'elaborazione salvata NON si svuota.
    if (dati.righe.length === 0) {
      return reply.code(404).send({ error: 'NESSUNA_TESTATA', testateLette: dati.testateLette })
    }

    const ok = await repo.riclassifica(id, dati, request.user?.id ?? null)
    if (!ok) return reply.code(404).send({ error: 'ELABORAZIONE_NON_TROVATA' })
    await audit(request.user?.id, request.ip, { op: 'riclassifica', id, nRighe: dati.righe.length })
    return reply.send({ ok: true })
  })

  app.post('/:id/conferma', pii, async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const esito = await repo.conferma(id, request.user?.id ?? null)
    if (esito === 'non-trovata') return reply.code(404).send({ error: 'ELABORAZIONE_NON_TROVATA' })
    if (esito === 'conflitto')   return reply.code(409).send({ error: 'MESE_GIA_CONFERMATO' })
    await audit(request.user?.id, request.ip, { op: 'conferma', id })
    return reply.send({ ok: true })
  })

  app.patch('/:id/righe/:matricola', pii, async (request, reply) => {
    const { id, matricola } = z.object({
      id: z.string().uuid(), matricola: z.string().regex(/^\d{6}$/),
    }).parse(request.params)
    const b = z.object({
      nazIban: z.string().trim().regex(/^[A-Za-z]{2}$/),
      nota:    z.string().trim().min(3).max(300),
    }).parse(request.body)

    const letta = await repo.leggi(id)
    if (!letta) return reply.code(404).send({ error: 'ELABORAZIONE_NON_TROVATA' })
    const naz  = b.nazIban.toUpperCase()
    const tipo = areaConto(naz, ultimoGiornoMese(letta.elab.anno, letta.elab.mese))
    if (tipo === 'NON_NOTO') return reply.code(400).send({ error: 'NAZIONE_NON_VALIDA' })

    const esito = await repo.nazioneManuale({
      id, matricola, nazIban: naz, tipoConto: tipo, nota: b.nota, userId: request.user?.id ?? null,
    })
    if (esito === 'non-trovata') return reply.code(404).send({ error: 'RIGA_NON_TROVATA' })
    if (esito === 'non-ammessa') return reply.code(409).send({ error: 'RIGA_GIA_CLASSIFICATA_DA_CSA' })
    // Nell'audit la matricola si': e' la traccia di chi ha deciso cosa.
    await audit(request.user?.id, request.ip, { op: 'nazione-manuale', id, matricola, nazIban: naz, tipoConto: tipo })
    return reply.send({ ok: true, tipoConto: tipo })
  })

  app.get('/:id/txt/:tipo', pii, async (request, reply) => {
    const { id, tipo } = z.object({
      id: z.string().uuid(), tipo: z.enum(['IT', 'SEPA', 'EXTRA_UE']),
    }).parse(request.params)
    const letta = await repo.leggi(id)
    if (!letta) return reply.code(404).send({ error: 'ELABORAZIONE_NON_TROVATA' })
    if (letta.elab.stato !== 'confermata') return reply.code(409).send({ error: 'NON_CONFERMATA' })
    const f = fileTxt(letta.elab, letta.righe, tipo)
    if (!f) return reply.code(404).send({ error: 'NESSUNA_MATRICOLA' })
    await audit(request.user?.id, request.ip, { op: 'txt', id, tipo, nomeFile: f.nomeFile, righe: f.righe })
    return reply.send({ nomeFile: f.nomeFile, contenuto: f.contenuto })
  })

  app.delete('/:id', pii, async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const ok = await repo.archivia(id, request.user?.id ?? null)
    if (!ok) return reply.code(404).send({ error: 'ELABORAZIONE_NON_TROVATA' })
    await audit(request.user?.id, request.ip, { op: 'archivia', id })
    return reply.code(204).send()
  })
}

// Errori CINECA -> codice generico + solo lo status numerico.
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
