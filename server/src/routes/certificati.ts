// ============================================================
// PAYROLL GANG SUITE — Routes Certificati (/api/v1/certificati)
//
// MODELLO DI ACCESSO (deciso esplicitamente): REGISTRO CONDIVISO D'UFFICIO.
// La lista e il download (GET /:id/docx) NON sono filtrati per createdBy:
// ogni operatore autenticato vede/scarica tutti i certificati. È intenzionale —
// gli account sono provisioned dall'admin (no signup pubblico), il protocollo
// è progressivo d'ufficio, e ogni download è auditato (CERTIFICATO_SCARICATO).
// NON è un IDOR: non scopare per utente è una scelta, non una svista.
//
// DATI A RIPOSO (deciso esplicitamente): dati_json (CF + retribuzioni/ritenute)
// è salvato in CHIARO nel JSONB, coerente con come l'app già tratta codFis nelle
// anagrafiche. Affidabilità sulla cifratura del volume DB lato VPS.
// ============================================================

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from '../middleware/authenticate.js'
import { PgCertificatiRepository } from '../db/repositories/PgCertificatiRepository.js'
import { PgTemplatiCertificatoRepository } from '../db/repositories/PgTemplatiCertificatoRepository.js'
import { PgAuditRepository } from '../db/repositories/PgAuditRepository.js'
import { parseCedolino } from '../services/cedolino/parser.js'
import { buildCertificatoDocx } from '../services/certificato/docx.js'
import type { CedolinoParsed } from '../services/cedolino/types.js'
import type { CertificatoTemplate, CertificatoMeta } from '../services/certificato/types.js'

const MAX_PDF_BYTES = 8 * 1024 * 1024

/** Shape persistita in certificati.dati_json: parser output + meta per regen. */
interface CertificatoDatiJson {
  parsed: CedolinoParsed
  meta: { data_rilascio: string; sesso?: 'M' | 'F'; bollo_testo?: string }
}

// SEC: schema STRETTO per il `parsed` ricevuto da POST / — l'operatore può
// editare l'anteprima, quindi il client rispedisce l'oggetto, MA va validato:
// numeri finiti, lunghezze stringa limitate, array limitati, chiavi note
// (lo strip di zod elimina chiavi extra incl. __proto__). Sostituisce il
// vecchio z.record(z.unknown()) che lasciava passare dati arbitrari.
const numFinite = z.number().finite()
const cedolinoParsedSchema = z.object({
  anagrafica: z.object({
    periodo_retribuzione: z.string().max(100).nullable(),
    matricola:            z.string().max(20).nullable(),
    cognome:              z.string().max(100).nullable(),
    nome:                 z.string().max(100).nullable(),
    codice_fiscale:       z.string().max(32).nullable(),
    data_nascita:         z.string().max(20).nullable(),
    luogo_nascita:        z.string().max(120).nullable(),
    inquadramento:        z.string().max(200).nullable(),
    area_profilo:         z.string().max(200).nullable(),
    ruolo:                z.string().max(40).nullable(),
    inizio_rapporto:      z.string().max(20).nullable(),
    anzianita_servizio:   z.string().max(120).nullable(),
    afferenza:            z.string().max(200).nullable(),
    sede:                 z.string().max(200).nullable(),
  }),
  voci_teoriche: z.array(z.object({
    descrizione: z.string().max(200),
    valore:      numFinite.nullable(),
    totale:      z.boolean(),
  })).max(200),
  voci_dettaglio: z.array(z.object({
    sezione:     z.string().max(40).nullable(),
    descrizione: z.string().max(200),
    valore:      numFinite,
    numeri_riga: z.array(numFinite).max(50),
    arretrato:   z.boolean(),
    conguaglio:  z.boolean(),
    scadenza:    z.string().max(20).nullable(),
    decorrenza:  z.string().max(20).nullable(),
  })).max(500),
  riepilogo_cedolino: z.record(z.string().max(40), numFinite.nullable()),
  certificato: z.object({
    lordo_teorico:          numFinite.nullable(),
    ritenute_fiscali:       numFinite.nullable(),
    ritenute_previdenziali: numFinite.nullable(),
    netto_ritenute_legge:   numFinite.nullable(),
    extraerariali_totale:   numFinite.nullable(),
    extraerariali_righe: z.array(z.object({
      descrizione: z.string().max(200),
      decorrenza:  z.string().max(20).nullable(),
      scadenza:    z.string().max(20).nullable(),
      valore:      numFinite.nullable(),
    })).max(200),
    netto_a_pagare: numFinite.nullable(),
    quinto:         numFinite.nullable(),
    settimo:        numFinite.nullable(),
  }),
})

/** Sanifica un segmento di filename (accenti/illegali → underscore). */
function safeName(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '')  // strip accenti
    .replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)
}

export async function certificatiRoutes(app: FastifyInstance): Promise<void> {
  const repo      = new PgCertificatiRepository(app.db)
  const templates = new PgTemplatiCertificatoRepository(app.db)
  const audit     = new PgAuditRepository(app.db)

  // ── POST /parse — estrazione cedolino, NESSUNA persistenza ─────────────
  // Body: { pdf: base64 }. Valida magic bytes + dimensione. PDF mai su disco.
  app.post('/parse', {
    preHandler: [app.authenticate],
    bodyLimit: 12 * 1024 * 1024, // base64 gonfia ~33%
  }, async (req, reply) => {
    // Audit Gate4 M2: cap esplicito anche a livello schema (mirror pdfRegionTemplates.ts)
    // — stesso valore del `bodyLimit` di route, limite auto-documentato nel contratto.
    const { pdf } = z.object({ pdf: z.string().min(1).max(12 * 1024 * 1024) }).parse(req.body)

    const buf = Buffer.from(pdf, 'base64')
    if (buf.byteLength === 0) return reply.code(400).send({ error: 'PDF_VUOTO' })
    if (buf.byteLength > MAX_PDF_BYTES) return reply.code(413).send({ error: 'PDF_TROPPO_GRANDE' })
    // Magic bytes: header PDF non falsificabile come il Content-Type
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return reply.code(400).send({ error: 'NON_E_UN_PDF' })
    }

    let parsed: CedolinoParsed
    try {
      parsed = await parseCedolino(buf)
    } catch (err) {
      app.log.error({ err }, 'Parsing cedolino fallito')
      return reply.code(422).send({ error: 'PARSING_FALLITO' })
    }
    return reply.send(parsed)
  })

  // ── POST / — crea record (protocollo atomico) + genera DOCX ────────────
  app.post('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = z.object({
      parsed:        cedolinoParsedSchema,
      templateId:    z.string().uuid(),
      siglaOperatore: z.string().min(1).max(20),
      dirigente:     z.string().max(200).optional(),
      dataRilascio:  z.string().min(1).max(20),
      sesso:         z.enum(['M', 'F']).optional(),
      anno:          z.number().int().min(2000).max(2100).optional(),
      bolloTesto:    z.string().min(1).max(300).optional(),
    }).parse(req.body)

    // post-validazione: la shape è ora sicura (numeri finiti, stringhe limitate,
    // chiavi note). Il cast è solo un ponte di tipo verso il union SezioneCedolino.
    const parsed = body.parsed as unknown as CedolinoParsed
    const tplRow = await templates.findById(body.templateId)
    if (!tplRow) return reply.code(404).send({ error: 'TEMPLATE_NON_TROVATO' })
    const tpl = tplRow.strutturaJson as CertificatoTemplate

    const anno = body.anno ?? new Date().getFullYear()
    const ana  = parsed.anagrafica ?? {}
    const nominativo = [ana.cognome, ana.nome].filter(Boolean).join(' ') || null

    const datiJson: CertificatoDatiJson = {
      parsed,
      meta: {
        data_rilascio: body.dataRilascio,
        ...(body.sesso ? { sesso: body.sesso } : {}),
        ...(body.bolloTesto ? { bollo_testo: body.bolloTesto } : {}),
      },
    }

    const record = await repo.create({
      anno,
      matricola:      ana.matricola ?? null,
      cf:             ana.codice_fiscale ?? null,
      periodo:        ana.periodo_retribuzione ?? null,
      nominativo,
      siglaOperatore: body.siglaOperatore,
      dirigente:      body.dirigente ?? null,
      templateId:     body.templateId,
      datiJson,
      createdBy:      req.user?.id ?? null,
    })

    const meta: CertificatoMeta = {
      protocollo:      record.protocollo,
      sigla_operatore: body.siglaOperatore,
      data_rilascio:   body.dataRilascio,
      dirigente:       body.dirigente ?? '',
      ...(body.sesso ? { sesso: body.sesso } : {}),
      ...(body.bolloTesto ? { bollo_testo: body.bolloTesto } : {}),
    }
    const docx = await buildCertificatoDocx(parsed, tpl, meta)
    const filename = `Certificato_${safeName(record.protocollo)}_${safeName(nominativo ?? '')}.docx`

    await audit.log({
      userId: req.user?.id, azione: 'CERTIFICATO_CREATO',
      entita: 'certificato', entitaId: record.id,
      dettagli: { protocollo: record.protocollo, matricola: record.matricola },
      ip: req.ip, userAgent: req.headers['user-agent'],
    })

    return reply.code(201).send({
      ...record,
      docx: { filename, base64: docx.toString('base64') },
    })
  })

  // ── GET / — lista per anno + ricerca matricola/nominativo/protocollo ───
  app.get('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { anno, search } = z.object({
      anno:   z.coerce.number().int().min(2000).max(2100).optional(),
      search: z.string().max(100).optional(),
    }).parse(req.query)
    const rows = await repo.findAll(anno, search)
    return reply.send(rows)
  })

  // ── GET /:id/docx — rigenera DOCX da datiJson ──────────────────────────
  app.get('/:id/docx', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const record = await repo.findById(id)
    if (!record) return reply.code(404).send({ error: 'CERTIFICATO_NON_TROVATO' })
    if (!record.templateId) return reply.code(409).send({ error: 'TEMPLATE_MANCANTE' })

    const tplRow = await templates.findById(record.templateId)
    if (!tplRow) return reply.code(409).send({ error: 'TEMPLATE_ELIMINATO' })
    const tpl = tplRow.strutturaJson as CertificatoTemplate

    const dati = record.datiJson as CertificatoDatiJson
    const meta: CertificatoMeta = {
      protocollo:      record.protocollo,
      sigla_operatore: record.siglaOperatore,
      data_rilascio:   dati.meta?.data_rilascio ?? '',
      dirigente:       record.dirigente ?? '',
      ...(dati.meta?.sesso ? { sesso: dati.meta.sesso } : {}),
      ...(dati.meta?.bollo_testo ? { bollo_testo: dati.meta.bollo_testo } : {}),
    }
    const docx = await buildCertificatoDocx(dati.parsed, tpl, meta)
    const filename = `Certificato_${safeName(record.protocollo)}_${safeName(record.nominativo ?? '')}.docx`

    await audit.log({
      userId: req.user?.id, azione: 'CERTIFICATO_SCARICATO',
      entita: 'certificato', entitaId: record.id,
      dettagli: { protocollo: record.protocollo },
      ip: req.ip, userAgent: req.headers['user-agent'],
    })

    return reply.send({ filename, base64: docx.toString('base64') })
  })

  // ── DELETE /:id — elimina definitivamente + risincronizza progressivo ──
  // Solo admin. Richiede header X-Confirm-Delete: true (op. distruttiva).
  app.delete('/:id', { preHandler: [app.authenticate, requireAdmin] }, async (req, reply) => {
    if (req.headers['x-confirm-delete'] !== 'true') {
      return reply.code(400).send({ error: 'MISSING_CONFIRM_HEADER' })
    }
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const del = await repo.delete(id)
    if (!del) return reply.code(404).send({ error: 'CERTIFICATO_NON_TROVATO' })

    await audit.log({
      userId: req.user?.id, azione: 'CERTIFICATO_ELIMINATO',
      entita: 'certificato', entitaId: id,
      dettagli: { protocollo: del.protocollo, anno: del.anno },
      ip: req.ip, userAgent: req.headers['user-agent'],
    })

    return reply.code(204).send()
  })
}
