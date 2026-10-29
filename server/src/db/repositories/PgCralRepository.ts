// ============================================================
// PAYROLL GANG SUITE — PgCralRepository
//
// Modulo CRAL (migrazione 0022): soci, sedi, tipi, eventi, scelte,
// magazzino biglietti, quote associative. Le validazioni dei JSON stanno
// in lib/cral.ts e le fa la route; qui si scrive, in transazione quando
// un'operazione tocca piu' righe.
// ============================================================

import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'
import type {
  ICralRepository, CralStato, CralSedeRow, CralTipoRow, CralTipologiaRow, CralParametriRow, CralTesseraParam,
  CralSocioRow, CralIniziativaRow, CralCaricoRow, CralRichiestaRow, CralQuotaRow, CralAnagraficaRow,
  CralNuovaPersona, CralModificaPersona, CralOperazioneImport, CralEsitoImport, CralErrore, CralAzioneStato,
  CralLottoRow, CralVariazioneRow, CralEsitoApplica,
} from '../IRepository.js'
import { baseTessera, erroreDati, prossimoDopo, quotaDopoModifica, rataMese, tesseraRiammissione, usiTolti, type ConfigEvento } from '../../lib/cral.js'
import {
  ORDINE_SEZIONI, anniEsentiDopoRipristino, personaDaRiga, statoDi, uguale, valorePersona,
  type CampoVar, type EventoArch, type PersonaArch, type QuotaArch, type SedeArch, type StatoComposto, type TipoArch, type TipologiaArch,
  type Variazione,
} from '../../lib/cralLotti.js'

type DB = PostgresJsDatabase<typeof schema>
type TX = Parameters<Parameters<DB['transaction']>[0]>[0]
type Conn = DB | TX
type RigaSocio = typeof schema.cralSoci.$inferSelect
type RigaIniz = typeof schema.cralIniziative.$inferSelect

/** Oggi a Roma, 'AAAA-MM-GG'. */
const oggi = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date())
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

/** Le operazioni che assegnano ID o tessere passano in fila: un lucchetto di transazione. */
const lucchetto = sql`SELECT pg_advisory_xact_lock(hashtext('pgs.cral'))`

function violazioneUnica(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null
  return e?.code === '23505' || e?.cause?.code === '23505'
}

/** Errore applicativo dentro una transazione: la annulla e torna come codice. */
class Annulla extends Error { constructor(readonly codice: CralErrore) { super(codice) } }
/** Una variazione del lotto che non si puo' applicare: resta in errore con il motivo. */
class Salta extends Error {}

interface CtxApplica {
  userId: string | null; ambiente: string; origine: 'T6' | 'T7' | 'ARCHIVIO'
  /** username → id degli utenti di qui */
  utenti: Map<string, string>
  /** ID dell'archivio → ID di qui (chi entra con un nuovo ID); resta nel lotto fra un'applicazione e l'altra */
  idMap: Map<string, string>
  /** ID dell'archivio che qui sono di un'altra persona: senza nuovo ID chi li cita si salta */
  vietati: Set<string>
  oggi: string
}

function toTessera(p: typeof schema.cralParametri.$inferSelect): CralTesseraParam {
  return {
    formato: p.tesseraFormato as CralTesseraParam['formato'], prefisso: p.tesseraPrefisso, cifre: p.tesseraCifre,
    prossimo: p.tesseraProssimo, riammissione: p.riammissione as CralTesseraParam['riammissione'],
    sepSuffisso: p.suffissoSep as CralTesseraParam['sepSuffisso'], cifreSuffisso: p.suffissoCifre,
  }
}

export class PgCralRepository implements ICralRepository {
  constructor(private readonly db: DB) {}

  // ── Lettura di tutto lo stato (poche centinaia di righe) ──
  async stato(): Promise<CralStato> {
    const [sedi, tipi, tipologie, parametri, soci, legami, storico, iniz, part, scelte, carichi, richieste, quoteAnno, quote, utenti] = await Promise.all([
      this.db.select().from(schema.cralSedi).orderBy(asc(schema.cralSedi.ordine), asc(schema.cralSedi.nome)),
      this.db.select().from(schema.cralTipi).orderBy(asc(schema.cralTipi.ordine), asc(schema.cralTipi.nome)),
      this.db.select().from(schema.cralTipologieProdotto).orderBy(asc(schema.cralTipologieProdotto.ordine), asc(schema.cralTipologieProdotto.nome)),
      this.parametri(),
      this.db.select().from(schema.cralSoci),
      this.db.select().from(schema.cralFamiliariLegami),
      this.db.select().from(schema.cralSociTessere).orderBy(asc(schema.cralSociTessere.al)),
      this.db.select().from(schema.cralIniziative).orderBy(asc(schema.cralIniziative.data)),
      this.db.select().from(schema.cralIniziativePartecipanti),
      this.db.select().from(schema.cralScelte),
      this.db.select().from(schema.cralCarichi).orderBy(asc(schema.cralCarichi.data), asc(schema.cralCarichi.createdAt)),
      this.db.select().from(schema.cralRichieste).orderBy(asc(schema.cralRichieste.dataRichiesta), asc(schema.cralRichieste.createdAt)),
      this.db.select().from(schema.cralQuoteAnno).orderBy(asc(schema.cralQuoteAnno.anno)),
      this.db.select().from(schema.cralQuote),
      this.db.select({ id: schema.users.id, username: schema.users.username }).from(schema.users),
    ])
    const nomeUtente = new Map(utenti.map(u => [u.id, u.username]))
    const leg = raggruppa(legami, l => l.familiareId)
    const sto = raggruppa(storico, t => t.socioId)
    const prt = raggruppa(part, p => p.iniziativaId)
    const sce = raggruppa(scelte, x => x.iniziativaId)
    const car = raggruppa(carichi, c => c.iniziativaId)
    const ric = raggruppa(richieste, r => r.iniziativaId)
    const q: CralStato['quote'] = {}
    for (const r of quote) (q[String(r.anno)] ??= {})[r.socioId] = toQuota(r)
    return {
      sedi: sedi.map(toSede), tipi: tipi.map(toTipo), tipologie: tipologie.map(toTipologia), parametri,
      soci: soci.map(s => toSocio(s, leg.get(s.id) ?? [], sto.get(s.id) ?? [], nomeUtente)),
      iniziative: iniz.map(i => toIniz(i, prt.get(i.id) ?? [], sce.get(i.id) ?? [], car.get(i.id) ?? [], ric.get(i.id) ?? [], nomeUtente)),
      quoteAnno: quoteAnno.map(a => ({ anno: a.anno, importo: a.importoCent })),
      quote: q,
    }
  }

  // ── Anagrafica PGS: tutte le matricole, cessati compresi (un pensionato
  //    socio riprende la sua matricola). Mai il codice fiscale. ──
  async anagrafica(): Promise<CralAnagraficaRow[]> {
    const rows = await this.db.execute(sql`
      SELECT DISTINCT ON (matricola)
        matricola, cogn_nome, cognome, nome, ruolo, druolo, id_ab, dt_nascita, fin_rap
      FROM anagrafiche
      ORDER BY matricola, decor_inq DESC, fin_rap DESC NULLS FIRST, ruolo
    `)
    return (rows as unknown as Array<Record<string, unknown>>).map(toAnag)
  }

  async cercaAnagrafica(q: string, limite: number): Promise<CralAnagraficaRow[]> {
    const parole = q.trim().split(/\s+/).filter(Boolean).slice(0, 4)
    if (!parole.length) return []
    const condizioni = parole.map(p => {
      const like = `%${p.replace(/[\\%_]/g, m => `\\${m}`)}%`
      return sql`(matricola ILIKE ${like} OR cogn_nome ILIKE ${like} OR cognome ILIKE ${like} OR nome ILIKE ${like})`
    })
    const rows = await this.db.execute(sql`
      SELECT * FROM (
        SELECT DISTINCT ON (matricola)
          matricola, cogn_nome, cognome, nome, ruolo, druolo, id_ab, dt_nascita, fin_rap
        FROM anagrafiche
        WHERE ${sql.join(condizioni, sql` AND `)}
        ORDER BY matricola, decor_inq DESC, fin_rap DESC NULLS FIRST, ruolo
      ) t ORDER BY cogn_nome LIMIT ${limite}
    `)
    return (rows as unknown as Array<Record<string, unknown>>).map(toAnag)
  }

  // ── Parametri ──────────────────────────────────────────────
  async parametri(conn: Conn = this.db): Promise<CralParametriRow> {
    const [p] = await conn.select().from(schema.cralParametri).where(eq(schema.cralParametri.id, 1))
    if (!p) throw new Error('cral_parametri vuota: applicare la migrazione 0022')
    return { tessera: toTessera(p), extProssimo: p.extProssimo, famProssimo: p.famProssimo }
  }

  async salvaTessera(t: CralTesseraParam, userId: string | null): Promise<void> {
    await this.db.update(schema.cralParametri).set({
      tesseraFormato: t.formato, tesseraPrefisso: t.prefisso, tesseraCifre: t.cifre, tesseraProssimo: t.prossimo,
      riammissione: t.riammissione, suffissoSep: t.sepSuffisso, suffissoCifre: t.cifreSuffisso,
      updatedBy: userId, updatedAt: new Date(),
    }).where(eq(schema.cralParametri.id, 1))
  }

  // ── Sedi, tipi, tipologie ──────────────────────────────────
  async creaSede(nome: string): Promise<CralSedeRow | 'NOME_GIA_USATO'> {
    // Il controllo della violazione sta FUORI dalla transazione: una query
    // fallita la annulla, e postgres.js la rilancia al COMMIT.
    try {
      return await this.db.transaction(async tx => {
        await tx.execute(lucchetto)
        const esistenti = await tx.select({ id: schema.cralSedi.id, ordine: schema.cralSedi.ordine }).from(schema.cralSedi)
        const id = nuovoCodice(nome, new Set(esistenti.map(e => e.id)))
        const [r] = await tx.insert(schema.cralSedi).values({ id, nome, ordine: Math.max(0, ...esistenti.map(e => e.ordine)) + 1 }).returning()
        return toSede(r!)
      })
    } catch (e) { if (violazioneUnica(e)) return 'NOME_GIA_USATO'; throw e }
  }

  async aggiornaSede(id: string, patch: { nome?: string; attiva?: boolean }): Promise<CralSedeRow | 'NOME_GIA_USATO' | null> {
    try {
      const [r] = await this.db.update(schema.cralSedi).set({ ...patch, updatedAt: new Date() }).where(eq(schema.cralSedi.id, id)).returning()
      return r ? toSede(r) : null
    } catch (e) { if (violazioneUnica(e)) return 'NOME_GIA_USATO'; throw e }
  }

  async creaTipo(t: { nome: string; colore: string; pagamento: boolean; modo: string | null }): Promise<CralTipoRow> {
    return this.db.transaction(async tx => {
      await tx.execute(lucchetto)
      const esistenti = await tx.select({ id: schema.cralTipi.id, ordine: schema.cralTipi.ordine }).from(schema.cralTipi)
      const [r] = await tx.insert(schema.cralTipi).values({
        id: nuovoCodice(t.nome, new Set(esistenti.map(e => e.id))), nome: t.nome, colore: t.colore,
        aPagamento: t.pagamento, modo: t.modo, ordine: Math.max(0, ...esistenti.map(e => e.ordine)) + 1,
      }).returning()
      return toTipo(r!)
    })
  }

  async aggiornaTipo(id: string, patch: { nome?: string; colore?: string; pagamento?: boolean; attivo?: boolean }): Promise<CralTipoRow | null> {
    const set: Partial<typeof schema.cralTipi.$inferInsert> = {}
    if (patch.nome !== undefined) set.nome = patch.nome
    if (patch.colore !== undefined) set.colore = patch.colore
    if (patch.pagamento !== undefined) set.aPagamento = patch.pagamento
    if (patch.attivo !== undefined) set.attivo = patch.attivo
    const [r] = await this.db.update(schema.cralTipi).set(set).where(eq(schema.cralTipi.id, id)).returning()
    return r ? toTipo(r) : null
  }

  async creaTipologia(nome: string): Promise<CralTipologiaRow> {
    return this.db.transaction(async tx => {
      await tx.execute(lucchetto)
      const esistenti = await tx.select({ id: schema.cralTipologieProdotto.id, ordine: schema.cralTipologieProdotto.ordine }).from(schema.cralTipologieProdotto)
      const [r] = await tx.insert(schema.cralTipologieProdotto).values({
        id: nuovoCodice(nome, new Set(esistenti.map(e => e.id))), nome, ordine: Math.max(0, ...esistenti.map(e => e.ordine)) + 1,
      }).returning()
      return toTipologia(r!)
    })
  }

  async aggiornaTipologia(id: string, patch: { nome?: string; attiva?: boolean }): Promise<CralTipologiaRow | null> {
    const [r] = await this.db.update(schema.cralTipologieProdotto).set(patch).where(eq(schema.cralTipologieProdotto.id, id)).returning()
    return r ? toTipologia(r) : null
  }

  // ── Persone ────────────────────────────────────────────────
  async socio(id: string, conn: Conn = this.db): Promise<CralSocioRow | null> {
    const [s] = await conn.select().from(schema.cralSoci).where(eq(schema.cralSoci.id, id))
    if (!s) return null
    const [leg, sto, utenti] = await Promise.all([
      conn.select().from(schema.cralFamiliariLegami).where(eq(schema.cralFamiliariLegami.familiareId, id)),
      conn.select().from(schema.cralSociTessere).where(eq(schema.cralSociTessere.socioId, id)).orderBy(asc(schema.cralSociTessere.al)),
      conn.select({ id: schema.users.id, username: schema.users.username }).from(schema.users),
    ])
    return toSocio(s, leg, sto, new Map(utenti.map(u => [u.id, u.username])))
  }

  async creaPersona(p: CralNuovaPersona, userId: string | null): Promise<CralSocioRow | CralErrore> {
    return this.inTransazione(async tx => {
      const id = await this.nuovaPersona(tx, p, userId)
      if (p.perIniziativa) await tx.insert(schema.cralIniziativePartecipanti).values({ iniziativaId: p.perIniziativa, socioId: id }).onConflictDoNothing()
      return (await this.socio(id, tx))!
    })
  }

  /** Inserisce una persona e restituisce l'ID; tessera e prossimi numeri avanzano. */
  private async nuovaPersona(tx: TX, p: CralNuovaPersona, userId: string | null): Promise<string> {
    const par = await this.parametri(tx)
    let id: string
    if (p.matricola) {
      // anche chi e' passato a socio esterno con questa matricola: e' la stessa persona
      const [gia] = await tx.select({ id: schema.cralSoci.id }).from(schema.cralSoci)
        .where(sql`${schema.cralSoci.matricola} = ${p.matricola} OR ${schema.cralSoci.exMatricola} = ${p.matricola}`)
      if (gia) throw new Annulla('MATRICOLA_GIA_SOCIO')
      id = p.matricola
    } else if (p.tipo === 'FAM') {
      id = await this.prossimoId(tx, 'FAM', par.famProssimo)
    } else {
      id = await this.prossimoId(tx, 'EXT', par.extProssimo)
    }
    if (p.tipo === 'FAM' && !p.legami?.length) throw new Annulla('LEGAME_NON_VALIDO')
    if (p.legami?.length) await this.verificaLegami(tx, id, p.legami)
    if (p.sede) await this.verificaSede(tx, p.sede)
    const tessera = (p.tipo === 'SD' || p.tipo === 'SE') && p.tessera ? p.tessera : null
    try {
      await tx.insert(schema.cralSoci).values({
        id, tipo: p.tipo, matricola: p.matricola ?? null, cognome: p.cognome, nome: p.nome, nascita: p.nascita,
        email: p.email || null, sedeId: p.sede, tessera, stato: p.stato, provenienza: p.provenienza ?? 'Inserimento manuale',
        atipico: !!p.atipico, note: p.note, creatoDa: userId,
        ...(p.stato === 'ATTIVO' ? { validatoDa: userId, validatoIl: new Date() } : {}),
      })
    } catch (e) { if (violazioneUnica(e)) throw new Annulla('TESSERA_DOPPIA'); throw e }
    if (p.legami?.length) await tx.insert(schema.cralFamiliariLegami).values(p.legami.map(l => ({ familiareId: id, socioId: l.socio, relazione: l.relazione })))
    if (tessera) await this.avanzaTessera(tx, par.tessera, tessera)
    return id
  }

  private async prossimoId(tx: TX, pref: 'EXT' | 'FAM', da: number): Promise<string> {
    let n = da
    for (;;) {
      const id = `${pref}-${String(n).padStart(4, '0')}`
      const [c] = await tx.select({ id: schema.cralSoci.id }).from(schema.cralSoci).where(eq(schema.cralSoci.id, id))
      if (!c) {
        await tx.update(schema.cralParametri).set(pref === 'EXT' ? { extProssimo: n + 1 } : { famProssimo: n + 1 }).where(eq(schema.cralParametri.id, 1))
        return id
      }
      n++
    }
  }

  private async avanzaTessera(tx: TX, t: CralTesseraParam, tessera: string): Promise<void> {
    const n = prossimoDopo(t, tessera)
    if (n !== t.prossimo) await tx.update(schema.cralParametri).set({ tesseraProssimo: n }).where(and(eq(schema.cralParametri.id, 1), sql`tessera_prossimo < ${n}`))
  }

  private async verificaSede(tx: Conn, sede: string): Promise<void> {
    const [s] = await tx.select({ id: schema.cralSedi.id }).from(schema.cralSedi).where(eq(schema.cralSedi.id, sede))
    if (!s) throw new Annulla('SEDE_SCONOSCIUTA')
  }

  /** Un familiare si lega solo a soci (dipendenti o esterni), mai a se stesso. */
  private async verificaLegami(tx: Conn, id: string, legami: Array<{ socio: string }>): Promise<void> {
    const ids = [...new Set(legami.map(l => l.socio))]
    if (ids.length !== legami.length || ids.includes(id)) throw new Annulla('LEGAME_NON_VALIDO')
    const soci = await tx.select({ id: schema.cralSoci.id, tipo: schema.cralSoci.tipo }).from(schema.cralSoci).where(inArray(schema.cralSoci.id, ids))
    if (soci.length !== ids.length || soci.some(s => s.tipo !== 'SD' && s.tipo !== 'SE')) throw new Annulla('LEGAME_NON_VALIDO')
  }

  async modificaPersona(id: string, patch: CralModificaPersona, userId: string | null): Promise<CralSocioRow | CralErrore> {
    return this.inTransazione(async tx => {
      const [s] = await tx.select().from(schema.cralSoci).where(eq(schema.cralSoci.id, id)).for('update')
      if (!s) throw new Annulla('SOCIO_NON_TROVATO')
      const tipo = patch.tipo ?? s.tipo
      // Chi ha la matricola e' socio dipendente o esterno con matricola; senza: socio esterno o esterno.
      if (s.tipo === 'FAM' ? tipo !== 'FAM' : s.matricola ? !['SD', 'EST'].includes(tipo) : !['SE', 'EST'].includes(tipo)) throw new Annulla('STATO_NON_VALIDO')
      if (patch.sede) await this.verificaSede(tx, patch.sede)
      const set: Partial<typeof schema.cralSoci.$inferInsert> = { tipo, modificatoDa: userId, modificatoIl: new Date() }
      if (patch.cognome !== undefined && !s.matricola) set.cognome = patch.cognome
      if (patch.nome !== undefined && !s.matricola) set.nome = patch.nome
      if (patch.nascita !== undefined) set.nascita = patch.nascita
      if (patch.email !== undefined) set.email = patch.email || null
      if (patch.sede !== undefined) set.sedeId = patch.sede
      if (patch.note !== undefined) set.note = patch.note
      if (patch.atipico !== undefined) set.atipico = patch.atipico
      const conTessera = tipo === 'SD' || tipo === 'SE'
      if (!conTessera) set.tessera = null
      else if (patch.tessera !== undefined) set.tessera = patch.tessera || null
      // Un socio che diventa esterno non puo' piu' avere familiari legati a lui.
      if (!conTessera && (s.tipo === 'SD' || s.tipo === 'SE')) {
        const [f] = await tx.select({ id: schema.cralFamiliariLegami.familiareId }).from(schema.cralFamiliariLegami).where(eq(schema.cralFamiliariLegami.socioId, id)).limit(1)
        if (f) throw new Annulla('LEGAME_NON_VALIDO')
      }
      try { await tx.update(schema.cralSoci).set(set).where(eq(schema.cralSoci.id, id)) }
      catch (e) { if (violazioneUnica(e)) throw new Annulla('TESSERA_DOPPIA'); throw e }
      if (set.tessera) await this.avanzaTessera(tx, (await this.parametri(tx)).tessera, set.tessera)
      return (await this.socio(id, tx))!
    })
  }

  async impostaLegami(id: string, legami: Array<{ socio: string; relazione: 'CONIUGE' | 'FIGLIO' }>, userId: string | null): Promise<CralSocioRow | CralErrore> {
    return this.inTransazione(async tx => {
      const [s] = await tx.select({ tipo: schema.cralSoci.tipo }).from(schema.cralSoci).where(eq(schema.cralSoci.id, id))
      if (!s) throw new Annulla('SOCIO_NON_TROVATO')
      if (s.tipo !== 'FAM' || !legami.length) throw new Annulla('LEGAME_NON_VALIDO')
      await this.verificaLegami(tx, id, legami)
      await tx.delete(schema.cralFamiliariLegami).where(eq(schema.cralFamiliariLegami.familiareId, id))
      await tx.insert(schema.cralFamiliariLegami).values(legami.map(l => ({ familiareId: id, socioId: l.socio, relazione: l.relazione })))
      await tx.update(schema.cralSoci).set({ modificatoDa: userId, modificatoIl: new Date() }).where(eq(schema.cralSoci.id, id))
      return (await this.socio(id, tx))!
    })
  }

  async cambiaStato(ids: string[], azione: CralAzioneStato, userId: string | null): Promise<number> {
    if (!ids.length) return 0
    const ora = new Date()
    if (azione === 'elimina' || azione === 'ripristina') return this.eliminaRipristina(this.db, ids, azione, userId, oggi())
    const [da, set]: [string[], Partial<typeof schema.cralSoci.$inferInsert>] = {
      valida:   [['DA_VALIDARE'], { stato: 'ATTIVO', validatoDa: userId, validatoIl: ora }],
      rifiuta:  [['DA_VALIDARE'], { stato: 'RIFIUTATO' }],
      rimetti:  [['RIFIUTATO'],   { stato: 'DA_VALIDARE' }],
      cessa:    [['ATTIVO'],      { stato: 'CESSATO', cessatoIl: oggi() }],
      // solo per esterni e familiari: i soci rientrano con «riammetti» (tessera)
      riattiva: [['CESSATO'],     { stato: 'ATTIVO', cessatoIl: null }],
    }[azione] as [string[], Partial<typeof schema.cralSoci.$inferInsert>]
    const condTipo = azione === 'riattiva' ? sql`tipo IN ('EST', 'FAM')` : sql`TRUE`
    const r = await this.db.update(schema.cralSoci).set({ ...set, modificatoDa: userId, modificatoIl: ora })
      .where(and(inArray(schema.cralSoci.id, ids), inArray(schema.cralSoci.stato, da), condTipo)).returning({ id: schema.cralSoci.id })
    return r.length
  }

  /**
   * Elimina: da qualunque stato, ricordando quello di prima. Ripristina:
   * torna allo stato di prima con la stessa tessera; gli anni passati da
   * eliminato restano esenti dalla quota (decisione del 29/10).
   */
  private async eliminaRipristina(conn: Conn, ids: string[], azione: 'elimina' | 'ripristina', userId: string | null, data: string): Promise<number> {
    const ora = new Date()
    if (azione === 'elimina') {
      const r = await conn.update(schema.cralSoci).set({
        stato: 'ELIMINATO', statoPrima: sql`${schema.cralSoci.stato}`, eliminatoIl: data, eliminatoDa: userId, modificatoDa: userId, modificatoIl: ora,
      }).where(and(inArray(schema.cralSoci.id, ids), sql`${schema.cralSoci.stato} <> 'ELIMINATO'`)).returning({ id: schema.cralSoci.id })
      return r.length
    }
    const anno = +oggi().slice(0, 4)
    const r = await conn.update(schema.cralSoci).set({
      stato: sql`${schema.cralSoci.statoPrima}`, statoPrima: null, eliminatoIl: null, eliminatoDa: null, modificatoDa: userId, modificatoIl: ora,
      anniEsenti: sql`ARRAY(SELECT DISTINCT y FROM unnest(${schema.cralSoci.anniEsenti} || ARRAY(SELECT generate_series(extract(year FROM ${schema.cralSoci.eliminatoIl})::int, ${anno - 1}::int))::smallint[]) AS y ORDER BY y)::smallint[]`,
    }).where(and(inArray(schema.cralSoci.id, ids), eq(schema.cralSoci.stato, 'ELIMINATO'))).returning({ id: schema.cralSoci.id })
    return r.length
  }

  /** Tipologia in blocco: le stesse regole della scheda, persona per persona; quelle non ammesse si saltano. */
  async cambiaTipologia(ids: string[], tipo: 'SD' | 'SE' | 'EST', userId: string | null): Promise<number> {
    let n = 0
    for (const id of ids) {
      const r = await this.modificaPersona(id, { tipo }, userId)
      if (typeof r !== 'string') n++
    }
    return n
  }

  /**
   * Socio dipendente che lascia l'Ateneo e resta socio: diventa socio
   * esterno con un nuovo ID EXT-nnnn. La matricola va in ex_matricola;
   * tessera, data d'iscrizione, familiari, scelte, ordini, richieste e
   * quote seguono il nuovo ID (ON UPDATE CASCADE). La trattenuta in busta
   * paga dell'anno in corso (e dei successivi) diventa mensile: i mesi gia'
   * registrati restano.
   */
  async passaEsterno(id: string, userId: string | null): Promise<CralSocioRow | CralErrore> {
    return this.inTransazione(async tx => {
      await tx.execute(lucchetto)
      const [s] = await tx.select().from(schema.cralSoci).where(eq(schema.cralSoci.id, id)).for('update')
      if (!s) throw new Annulla('SOCIO_NON_TROVATO')
      if (s.tipo !== 'SD' || !s.matricola || s.stato !== 'ATTIVO') throw new Annulla('STATO_NON_VALIDO')
      const par = await this.parametri(tx)
      const nuovo = await this.prossimoId(tx, 'EXT', par.extProssimo)
      const data = oggi()
      await tx.update(schema.cralSoci).set({
        id: nuovo, matricola: null, exMatricola: s.matricola, tipo: 'SE', modificatoDa: userId, modificatoIl: new Date(),
        note: `${s.note ? `${s.note} · ` : ''}Socio dipendente (matricola ${s.matricola}) fino al ${data.split('-').reverse().join('/')}`.slice(0, 1000),
      }).where(eq(schema.cralSoci.id, id))
      await tx.execute(sql`UPDATE cral_scelte SET dati = jsonb_set(dati, '{rif}', to_jsonb(${nuovo}::text)) WHERE dati->>'rif' = ${id}`)
      await tx.update(schema.cralQuote).set({ modo: 'MENSILE', updatedBy: userId, updatedAt: new Date() })
        .where(and(eq(schema.cralQuote.socioId, nuovo), eq(schema.cralQuote.modo, 'TRATTENUTA'), sql`${schema.cralQuote.anno} >= ${+data.slice(0, 4)}`))
      return (await this.socio(nuovo, tx))!
    })
  }

  async riammetti(id: string, userId: string | null): Promise<CralSocioRow | CralErrore> {
    return this.inTransazione(async tx => {
      await tx.execute(lucchetto)
      const [s] = await tx.select().from(schema.cralSoci).where(eq(schema.cralSoci.id, id)).for('update')
      if (!s) throw new Annulla('SOCIO_NON_TROVATO')
      if (s.stato !== 'CESSATO' || (s.tipo !== 'SD' && s.tipo !== 'SE')) throw new Annulla('STATO_NON_VALIDO')
      const par = await this.parametri(tx)
      const storico = await tx.select().from(schema.cralSociTessere).where(eq(schema.cralSociTessere.socioId, id)).orderBy(asc(schema.cralSociTessere.al))
      const primaTessera = storico[0]?.tessera ?? s.tessera
      const esito = tesseraRiammissione(par.tessera, primaTessera ? baseTessera(par.tessera, primaTessera) : null, s.riammissioni)
      if ('errore' in esito) throw new Annulla('SUFFISSI_ESAURITI')
      if (s.tessera) await tx.insert(schema.cralSociTessere).values({ socioId: id, tessera: s.tessera, dal: s.iscrittoIl, al: s.cessatoIl ?? oggi() })
      try {
        await tx.update(schema.cralSoci).set({
          tessera: esito.tessera, riammissioni: esito.nuovoNumero ? s.riammissioni : s.riammissioni + 1,
          stato: 'ATTIVO', iscrittoIl: oggi(), cessatoIl: null, modificatoDa: userId, modificatoIl: new Date(),
        }).where(eq(schema.cralSoci.id, id))
      } catch (e) { if (violazioneUnica(e)) throw new Annulla('TESSERA_DOPPIA'); throw e }
      if (esito.nuovoNumero) await this.avanzaTessera(tx, par.tessera, esito.tessera)
      return (await this.socio(id, tx))!
    })
  }

  /**
   * «Trova in anagrafica PGS»: l'ID diventa la matricola (le chiavi esterne
   * seguono per ON UPDATE CASCADE), cognome, nome e nascita vengono da PGS.
   * Il socio esterno diventa socio dipendente; l'esterno resta esterno.
   */
  async collegaPgs(id: string, a: CralAnagraficaRow, userId: string | null): Promise<CralSocioRow | CralErrore> {
    return this.inTransazione(async tx => {
      const [s] = await tx.select().from(schema.cralSoci).where(eq(schema.cralSoci.id, id)).for('update')
      if (!s) throw new Annulla('SOCIO_NON_TROVATO')
      if (s.matricola || s.tipo === 'FAM' || s.tipo === 'SD') throw new Annulla('STATO_NON_VALIDO')
      const [gia] = await tx.select({ id: schema.cralSoci.id }).from(schema.cralSoci)
        .where(sql`${schema.cralSoci.id} = ${a.matricola} OR (${schema.cralSoci.exMatricola} = ${a.matricola} AND ${schema.cralSoci.id} <> ${id})`)
      if (gia) throw new Annulla('MATRICOLA_GIA_SOCIO')
      const [cognome, nome] = a.cognome || a.nome ? [a.cognome ?? '', a.nome ?? ''] : [a.cognNome ?? s.cognome, '']
      await tx.update(schema.cralSoci).set({
        id: a.matricola, matricola: a.matricola, tipo: s.tipo === 'SE' ? 'SD' : 'EST', exMatricola: null,
        cognome: cognome || s.cognome, nome: nome || s.nome, nascita: a.nascita ?? s.nascita,
        stato: 'ATTIVO', validatoDa: userId, validatoIl: new Date(), modificatoDa: userId, modificatoIl: new Date(),
        note: `${s.note ? `${s.note} · ` : ''}Era ${s.id}`.slice(0, 1000),
      }).where(eq(schema.cralSoci.id, id))
      // il riferimento nei campi estivi e' un JSON: non segue da solo
      await tx.execute(sql`UPDATE cral_scelte SET dati = jsonb_set(dati, '{rif}', to_jsonb(${a.matricola}::text)) WHERE dati->>'rif' = ${id}`)
      return (await this.socio(a.matricola, tx))!
    })
  }

  async spostaSede(ids: string[], sede: string | null, userId: string | null): Promise<number> {
    if (!ids.length) return 0
    if (sede) await this.verificaSede(this.db, sede)
    const r = await this.db.update(schema.cralSoci).set({ sedeId: sede, modificatoDa: userId, modificatoIl: new Date() })
      .where(inArray(schema.cralSoci.id, ids)).returning({ id: schema.cralSoci.id })
    return r.length
  }

  /** Conferma dell'import del libro soci: tutto o niente. */
  async importaLibroSoci(ops: CralOperazioneImport[], file: string, userId: string | null): Promise<CralEsitoImport | CralErrore> {
    return this.inTransazione(async tx => {
      await tx.execute(lucchetto)
      const esito: CralEsitoImport = { nuoviPgs: 0, nuoviEsterni: 0, aggiornati: 0, tessere: 0, cessati: 0 }
      const ora = new Date()
      for (const o of ops) {
        if (o.op === 'aggiorna') {
          const [s] = await tx.select().from(schema.cralSoci).where(eq(schema.cralSoci.id, o.socio)).for('update')
          if (!s) throw new Annulla('SOCIO_NON_TROVATO')
          const set: Partial<typeof schema.cralSoci.$inferInsert> = {}
          if (o.sede !== undefined && o.sede !== s.sedeId) { if (o.sede) await this.verificaSede(tx, o.sede); set.sedeId = o.sede }
          if (o.tessera && o.tessera !== s.tessera && (s.tipo === 'SD' || s.tipo === 'SE')) { set.tessera = o.tessera; esito.tessere++ }
          if (o.atipico && !s.atipico) set.atipico = true
          if (o.nota) set.note = `${s.note ? `${s.note} · ` : ''}${o.nota}`.slice(0, 1000)
          if (!Object.keys(set).length) continue
          try { await tx.update(schema.cralSoci).set({ ...set, modificatoDa: userId, modificatoIl: ora }).where(eq(schema.cralSoci.id, o.socio)) }
          catch (e) { if (violazioneUnica(e)) throw new Annulla('TESSERA_DOPPIA'); throw e }
          if (set.tessera) await this.avanzaTessera(tx, (await this.parametri(tx)).tessera, set.tessera)
          esito.aggiornati++
        } else if (o.op === 'nuovoPgs') {
          await this.nuovaPersona(tx, {
            tipo: o.tipo, matricola: o.matricola, cognome: o.cognome, nome: o.nome, nascita: o.nascita, email: o.email,
            sede: o.sede, tessera: o.tessera, note: o.nota, atipico: o.atipico, stato: 'ATTIVO', provenienza: `Import ${file}`,
          }, userId)
          esito.nuoviPgs++
        } else if (o.op === 'nuovoEsterno') {
          await this.nuovaPersona(tx, {
            tipo: o.tipo, cognome: o.cognome, nome: o.nome, nascita: o.nascita, email: o.email,
            sede: o.sede, tessera: o.tessera, note: o.nota, atipico: o.atipico, stato: 'DA_VALIDARE', provenienza: `Import ${file}`,
          }, userId)
          esito.nuoviEsterni++
        } else {
          const r = await tx.update(schema.cralSoci).set({
            stato: 'CESSATO', cessatoIl: oggi(), modificatoDa: userId, modificatoIl: ora,
            note: sql`left(CASE WHEN note = '' THEN ${o.nota ?? `Non presente nel libro soci (${file})`} ELSE note || ' · ' || ${o.nota ?? `Non presente nel libro soci (${file})`} END, 1000)`,
          }).where(and(eq(schema.cralSoci.id, o.socio), eq(schema.cralSoci.stato, 'ATTIVO'))).returning({ id: schema.cralSoci.id })
          esito.cessati += r.length
        }
      }
      return esito
    })
  }

  // ── Eventi ─────────────────────────────────────────────────
  async iniziativa(id: string): Promise<CralIniziativaRow | null> {
    const [i] = await this.db.select().from(schema.cralIniziative).where(eq(schema.cralIniziative.id, id))
    if (!i) return null
    const [part, sce, car, ric, utenti] = await Promise.all([
      this.db.select().from(schema.cralIniziativePartecipanti).where(eq(schema.cralIniziativePartecipanti.iniziativaId, id)),
      this.db.select().from(schema.cralScelte).where(eq(schema.cralScelte.iniziativaId, id)),
      this.db.select().from(schema.cralCarichi).where(eq(schema.cralCarichi.iniziativaId, id)).orderBy(asc(schema.cralCarichi.data)),
      this.db.select().from(schema.cralRichieste).where(eq(schema.cralRichieste.iniziativaId, id)).orderBy(asc(schema.cralRichieste.dataRichiesta)),
      this.db.select({ id: schema.users.id, username: schema.users.username }).from(schema.users),
    ])
    return toIniz(i, part, sce, car, ric, new Map(utenti.map(u => [u.id, u.username])))
  }

  async usiIniziativa(id: string, conn: Conn = this.db): Promise<{ opz: Set<string>; prodotti: Set<string>; periodi: Set<string>; articoli: Set<string> }> {
    const sce = await conn.select({ dati: schema.cralScelte.dati }).from(schema.cralScelte).where(eq(schema.cralScelte.iniziativaId, id))
    const car = await conn.select({ art: schema.cralCarichi.articolo }).from(schema.cralCarichi).where(eq(schema.cralCarichi.iniziativaId, id))
    const ric = await conn.select({ art: schema.cralRichieste.articolo }).from(schema.cralRichieste).where(eq(schema.cralRichieste.iniziativaId, id))
    const opz = new Set<string>(), prodotti = new Set<string>(), periodi = new Set<string>()
    for (const { dati } of sce) {
      const d = dati as { opz?: string; q?: Record<string, number>; per?: Record<string, string> }
      if (d.opz) opz.add(d.opz)
      for (const [k, n] of Object.entries(d.q ?? {})) if (n > 0) prodotti.add(k)
      for (const [k, v] of Object.entries(d.per ?? {})) if (v) periodi.add(k)
    }
    return { opz, prodotti, periodi, articoli: new Set([...car, ...ric].map(x => x.art)) }
  }

  async salvaIniziativa(
    id: string | null,
    i: Omit<CralIniziativaRow, 'id' | 'archiviata' | 'archiviataDa' | 'archiviataIl' | 'partecipanti' | 'scelte' | 'carichi' | 'richieste'>,
    userId: string | null,
  ): Promise<CralIniziativaRow | 'TIPO_SCONOSCIUTO' | null> {
    const [t] = await this.db.select({ id: schema.cralTipi.id }).from(schema.cralTipi).where(eq(schema.cralTipi.id, i.tipo))
    if (!t) return 'TIPO_SCONOSCIUTO'
    const valori = {
      tipoId: i.tipo, titolo: i.titolo, anno: i.anno, data: i.data, scadenza: i.scadenza, stato: i.stato, modalita: i.modalita,
      partecipanti: i.modoPart, gruppi: i.gruppi, sedi: i.sedi, predefinita: i.predefinita, fornitore: i.fornitore,
      pagamento: i.pagamento, note: i.note, quotaCent: i.quota, config: i.config, updatedBy: userId, updatedAt: new Date(),
    }
    if (id) {
      const [r] = await this.db.update(schema.cralIniziative).set(valori).where(eq(schema.cralIniziative.id, id)).returning({ id: schema.cralIniziative.id })
      return r ? this.iniziativa(r.id) : null
    }
    const [r] = await this.db.insert(schema.cralIniziative).values({ ...valori, createdBy: userId }).returning({ id: schema.cralIniziative.id })
    return this.iniziativa(r!.id)
  }

  async archivia(id: string, archiviata: boolean, userId: string | null): Promise<boolean> {
    const r = await this.db.update(schema.cralIniziative).set({
      // archiviare chiude anche la raccolta: l'evento diventa di sola lettura
      archiviata, ...(archiviata ? { stato: 'CHIUSA' as const } : {}),
      archiviataDa: archiviata ? userId : null, archiviataIl: archiviata ? new Date() : null, updatedBy: userId, updatedAt: new Date(),
    }).where(eq(schema.cralIniziative.id, id)).returning({ id: schema.cralIniziative.id })
    return r.length > 0
  }

  async partecipanti(id: string, aggiungi: string[], togli: string[]): Promise<number> {
    return this.db.transaction(async tx => {
      let n = 0
      if (togli.length) n += (await tx.delete(schema.cralIniziativePartecipanti)
        .where(and(eq(schema.cralIniziativePartecipanti.iniziativaId, id), inArray(schema.cralIniziativePartecipanti.socioId, togli)))
        .returning({ s: schema.cralIniziativePartecipanti.socioId })).length
      if (aggiungi.length) n += (await tx.insert(schema.cralIniziativePartecipanti)
        .values(aggiungi.map(socioId => ({ iniziativaId: id, socioId }))).onConflictDoNothing()
        .returning({ s: schema.cralIniziativePartecipanti.socioId })).length
      return n
    })
  }

  async scelte(id: string, soci: string[]): Promise<Map<string, { dati: Record<string, unknown>; fonte: string }>> {
    if (!soci.length) return new Map()
    const rows = await this.db.select().from(schema.cralScelte)
      .where(and(eq(schema.cralScelte.iniziativaId, id), inArray(schema.cralScelte.socioId, soci)))
    return new Map(rows.map(r => [r.socioId, { dati: r.dati as Record<string, unknown>, fonte: r.fonte }]))
  }

  async salvaScelte(id: string, voci: Array<{ socio: string; dati: Record<string, unknown>; fonte: string }>, userId: string | null, conn: Conn = this.db): Promise<number> {
    if (!voci.length) return 0
    const ora = new Date()
    await conn.insert(schema.cralScelte)
      .values(voci.map(v => ({ iniziativaId: id, socioId: v.socio, dati: v.dati, fonte: v.fonte, updatedBy: userId, updatedAt: ora })))
      .onConflictDoUpdate({
        target: [schema.cralScelte.iniziativaId, schema.cralScelte.socioId],
        set: { dati: sql`excluded.dati`, fonte: sql`excluded.fonte`, updatedBy: userId, updatedAt: ora },
      })
    return voci.length
  }

  async creaCarico(id: string, c: { art: string; qta: number; data: string; note: string }, userId: string | null): Promise<CralCaricoRow> {
    const [r] = await this.db.insert(schema.cralCarichi).values({ iniziativaId: id, articolo: c.art, quantita: c.qta, data: c.data, note: c.note, createdBy: userId }).returning()
    return toCarico(r!)
  }

  async creaRichiesta(id: string, r: { persona: string; art: string; qta: number; dataRich: string; modo: 'MANO' | 'EMAIL'; note: string }, userId: string | null): Promise<CralRichiestaRow> {
    const [x] = await this.db.insert(schema.cralRichieste).values({
      iniziativaId: id, socioId: r.persona, articolo: r.art, quantita: r.qta, dataRichiesta: r.dataRich, modo: r.modo, note: r.note,
      createdBy: userId, updatedBy: userId,
    }).returning()
    return toRichiesta(x!, new Map())
  }

  async aggiornaRichiesta(
    id: string, rid: string, patch: Partial<Pick<CralRichiestaRow, 'stato' | 'dataCons' | 'modo' | 'pagato' | 'sconto' | 'note'>>, userId: string | null,
  ): Promise<CralRichiestaRow | null> {
    const set: Partial<typeof schema.cralRichieste.$inferInsert> = { updatedBy: userId, updatedAt: new Date() }
    if (patch.stato !== undefined) set.stato = patch.stato
    if (patch.dataCons !== undefined) set.dataConsegna = patch.dataCons
    if (patch.modo !== undefined) set.modo = patch.modo
    if (patch.pagato !== undefined) set.pagato = patch.pagato
    if (patch.sconto !== undefined) set.sconto = patch.sconto
    if (patch.note !== undefined) set.note = patch.note
    const [r] = await this.db.update(schema.cralRichieste).set(set)
      .where(and(eq(schema.cralRichieste.id, rid), eq(schema.cralRichieste.iniziativaId, id))).returning()
    return r ? toRichiesta(r, new Map()) : null
  }

  // ── Quote associative ──────────────────────────────────────
  async salvaQuotaAnno(anno: number, importo: number, userId: string | null): Promise<void> {
    await this.db.insert(schema.cralQuoteAnno).values({ anno, importoCent: importo, updatedBy: userId })
      .onConflictDoUpdate({ target: schema.cralQuoteAnno.anno, set: { importoCent: importo, updatedBy: userId, updatedAt: new Date() } })
  }

  async salvaQuota(anno: number, socio: string, patch: Partial<CralQuotaRow>, modoPredefinito: CralQuotaRow['modo'], userId: string | null): Promise<CralQuotaRow | null> {
    return this.db.transaction(async tx => {
      const [a] = await tx.select({ imp: schema.cralQuoteAnno.importoCent }).from(schema.cralQuoteAnno).where(eq(schema.cralQuoteAnno.anno, anno))
      if (!a) return null
      const [cur] = await tx.select().from(schema.cralQuote).where(and(eq(schema.cralQuote.anno, anno), eq(schema.cralQuote.socioId, socio))).for('update')
      const base = cur ? toQuota(cur) : quotaVuota(modoPredefinito)
      const q = quotaDopoModifica(base, patch, a.imp)
      const valori = { modo: q.modo, mesi: q.mesi, importi: q.importi, pagataIl: q.pagataIl, versatoUnica: q.versatoUnica, note: q.note, updatedBy: userId, updatedAt: new Date() }
      const [r] = cur
        ? await tx.update(schema.cralQuote).set(valori).where(and(eq(schema.cralQuote.anno, anno), eq(schema.cralQuote.socioId, socio))).returning()
        : await tx.insert(schema.cralQuote).values({ anno, socioId: socio, ...valori }).returning()
      return r ? toQuota(r) : null
    })
  }

  /** Segna pagata la rata di `mese` (1–12) per i soci indicati: modalità trattenuta. L'importo e' la rata (o resta quello registrato, se maggiore). */
  async registraTrattenuta(anno: number, mese: number, soci: string[], userId: string | null): Promise<number> {
    if (!soci.length) return 0
    return this.db.transaction(async tx => {
      const [a] = await tx.select({ imp: schema.cralQuoteAnno.importoCent }).from(schema.cralQuoteAnno).where(eq(schema.cralQuoteAnno.anno, anno))
      const rata = a ? rataMese(a.imp, mese - 1) : 0
      const vuoto = Array<boolean>(12).fill(false)
      await tx.insert(schema.cralQuote).values(soci.map(s => ({ anno, socioId: s, modo: 'TRATTENUTA', mesi: vuoto, updatedBy: userId })))
        .onConflictDoNothing()
      const r = await tx.execute(sql`
        UPDATE cral_quote SET mesi[${mese}] = true, importi[${mese}] = GREATEST(importi[${mese}], ${rata}::int), updated_by = ${userId}, updated_at = now()
        WHERE anno = ${anno} AND socio_id IN ${soci} AND modo = 'TRATTENUTA' RETURNING socio_id`)
      return (r as unknown as unknown[]).length
    })
  }

  // ── Lotti di variazioni (0023) ─────────────────────────────
  async creaLotto(
    l: { origine: 'T6' | 'T7' | 'ARCHIVIO'; file: string; ambiente: string; esportato: string | null; sezioni: string[]; riepilogo: Record<string, unknown> },
    vs: Variazione[], userId: string | null,
  ): Promise<string> {
    return this.db.transaction(async tx => {
      const [r] = await tx.insert(schema.cralLotti).values({
        origine: l.origine, file: l.file.slice(0, 200), ambiente: l.ambiente.slice(0, 80), esportato: l.esportato ? new Date(l.esportato) : null,
        sezioni: l.sezioni, riepilogo: l.riepilogo, creatoDa: userId,
      }).returning({ id: schema.cralLotti.id })
      const id = r!.id
      // in ordine di applicazione: sedi, tabelle, soci (prima i soci, poi i familiari), quote, eventi
      const ordinate = vs.map((v, k) => ({ v, k })).sort((a, b) => ORDINE_SEZIONI[a.v.sezione] - ORDINE_SEZIONI[b.v.sezione] || a.k - b.k)
      for (let i = 0; i < ordinate.length; i += 500) {
        await tx.insert(schema.cralLottiVariazioni).values(ordinate.slice(i, i + 500).map(({ v }, j) => ({
          lottoId: id, ordine: i + j, sezione: v.sezione, entita: v.entita, chiave: v.chiave.slice(0, 80), tipo: v.tipo, delicata: v.delicata,
          dati: { etichetta: v.etichetta, campi: v.campi, record: v.record, ...(v.avviso ? { avviso: v.avviso } : {}), ...(v.bloccata ? { bloccata: v.bloccata } : {}) },
        })))
      }
      return id
    })
  }

  async lotti(): Promise<CralLottoRow[]> {
    const [ls, conti, utenti] = await Promise.all([
      this.db.select().from(schema.cralLotti).orderBy(sql`${schema.cralLotti.creatoIl} DESC`).limit(50),
      this.db.execute(sql`SELECT lotto_id, esito, count(*)::int AS n FROM cral_lotti_variazioni GROUP BY lotto_id, esito`),
      this.utenti(this.db),
    ])
    const c = new Map<string, Record<string, number>>()
    for (const r of conti as unknown as Array<{ lottoId: string; esito: string; n: number }>) (c.get(r.lottoId) ?? c.set(r.lottoId, {}).get(r.lottoId)!)[r.esito] = r.n
    return ls.map(l => ({ ...toLotto(l, utenti), conteggi: c.get(l.id) ?? {} }))
  }

  async lotto(id: string): Promise<{ lotto: CralLottoRow; variazioni: CralVariazioneRow[] } | null> {
    const [l] = await this.db.select().from(schema.cralLotti).where(eq(schema.cralLotti.id, id))
    if (!l) return null
    const vs = await this.db.select().from(schema.cralLottiVariazioni).where(eq(schema.cralLottiVariazioni.lottoId, id)).orderBy(asc(schema.cralLottiVariazioni.ordine))
    return { lotto: toLotto(l, await this.utenti(this.db)), variazioni: vs.map(toVariazione) }
  }

  /**
   * Accetta o scarta. Una variazione bloccata non si accetta; di una
   * modifica si accettano solo campi non bloccati. «accettaTutte» salta le
   * delicate (stati, ID, avvisi): quelle si confermano una per una.
   */
  async decidiVariazioni(
    id: string,
    d: { voci?: Array<{ id: number; esito: 'ACCETTATA' | 'SCARTATA' | 'ATTESA'; accettati?: string[] }>; sezione?: string; azione?: 'accettaTutte' | 'scartaTutte' | 'azzera' },
  ): Promise<number | CralErrore> {
    return this.inTransazione(async tx => {
      const [l] = await tx.select({ stato: schema.cralLotti.stato }).from(schema.cralLotti).where(eq(schema.cralLotti.id, id)).for('update')
      if (!l) throw new Annulla('LOTTO_NON_TROVATO')
      if (l.stato !== 'APERTO') throw new Annulla('LOTTO_CHIUSO')
      const vs = await tx.select().from(schema.cralLottiVariazioni).where(eq(schema.cralLottiVariazioni.lottoId, id))
      const perId = new Map(vs.map(v => [v.id, v]))
      const nuove: Array<{ id: number; esito: string; acc: string[] }> = []
      const liberi = (v: typeof vs[number]) => ((v.dati as { campi?: CampoVar[] }).campi ?? []).filter(c => !c.blocco).map(c => c.campo)
      const accetta = (v: typeof vs[number], scelti?: string[]): string[] | null => {
        if ((v.dati as { bloccata?: string }).bloccata) return null
        if (v.tipo !== 'MODIFICA') return ['*']
        const ok = liberi(v).filter(c => !scelti || scelti.includes(c))
        return ok.length ? ok : null
      }
      for (const x of d.voci ?? []) {
        const v = perId.get(x.id)
        if (!v || v.esito === 'APPLICATA') continue
        if (x.esito === 'ACCETTATA') { const acc = accetta(v, x.accettati); if (acc) nuove.push({ id: v.id, esito: 'ACCETTATA', acc }) }
        else nuove.push({ id: v.id, esito: x.esito, acc: [] })
      }
      if (d.azione && d.sezione) {
        for (const v of vs) {
          if (v.sezione !== d.sezione || v.esito === 'APPLICATA') continue
          if (d.azione === 'accettaTutte') {
            if (v.esito !== 'ATTESA' || v.delicata) continue
            const acc = accetta(v); if (acc) nuove.push({ id: v.id, esito: 'ACCETTATA', acc })
          } else nuove.push({ id: v.id, esito: d.azione === 'scartaTutte' ? 'SCARTATA' : 'ATTESA', acc: [] })
        }
      }
      if (!nuove.length) return 0
      await tx.execute(sql`
        UPDATE cral_lotti_variazioni v SET esito = j.esito, accettati = ARRAY(SELECT jsonb_array_elements_text(j.acc)), nota = ''
        FROM jsonb_to_recordset(${JSON.stringify(nuove)}::jsonb) AS j(id int, esito text, acc jsonb)
        WHERE v.id = j.id AND v.lotto_id = ${id} AND v.esito <> 'APPLICATA'`)
      return nuove.length
    })
  }

  /** Scarta il lotto intero: le variazioni si svuotano, resta il riepilogo. */
  async scartaLotto(id: string, userId: string | null): Promise<boolean | CralErrore> {
    return this.inTransazione(async tx => {
      const [l] = await tx.select({ stato: schema.cralLotti.stato }).from(schema.cralLotti).where(eq(schema.cralLotti.id, id)).for('update')
      if (!l) throw new Annulla('LOTTO_NON_TROVATO')
      if (l.stato !== 'APERTO') throw new Annulla('LOTTO_CHIUSO')
      await this.chiudiLotto(tx, id, 'SCARTATO', userId)
      return true
    })
  }

  private async chiudiLotto(tx: TX, id: string, stato: 'CHIUSO' | 'SCARTATO', userId: string | null): Promise<void> {
    const conti = await tx.execute(sql`SELECT sezione, esito, count(*)::int AS n FROM cral_lotti_variazioni WHERE lotto_id = ${id} GROUP BY sezione, esito`)
    const esiti: Record<string, Record<string, number>> = {}
    for (const r of conti as unknown as Array<{ sezione: string; esito: string; n: number }>) (esiti[r.sezione] ??= {})[r.esito] = r.n
    await tx.update(schema.cralLotti).set({
      stato, chiusoDa: userId, chiusoIl: new Date(), riepilogo: sql`${schema.cralLotti.riepilogo} || ${JSON.stringify({ esiti })}::jsonb`,
    }).where(eq(schema.cralLotti.id, id))
    // i dati personali copiati nel lotto non servono piu': restano chiave ed esito
    await tx.update(schema.cralLottiVariazioni).set({ dati: {} }).where(eq(schema.cralLottiVariazioni.lottoId, id))
  }

  /**
   * Applica le variazioni accettate, in una transazione: ognuna nel suo
   * savepoint, cosi' una che fallisce (un vincolo, un dato cambiato nel
   * frattempo) resta in errore e le altre passano. Un campo il cui valore
   * qui non e' piu' quello visto nel lotto si salta. Il lotto si chiude
   * (e si svuota) quando non resta nulla da decidere.
   */
  async applicaLotto(id: string, userId: string | null): Promise<CralEsitoApplica | CralErrore> {
    return this.inTransazione(async tx => {
      await tx.execute(lucchetto)
      const [l] = await tx.select().from(schema.cralLotti).where(eq(schema.cralLotti.id, id)).for('update')
      if (!l) throw new Annulla('LOTTO_NON_TROVATO')
      if (l.stato !== 'APERTO') throw new Annulla('LOTTO_CHIUSO')
      const vs = await tx.select().from(schema.cralLottiVariazioni)
        .where(and(eq(schema.cralLottiVariazioni.lottoId, id), eq(schema.cralLottiVariazioni.esito, 'ACCETTATA'))).orderBy(asc(schema.cralLottiVariazioni.ordine))
      const utenti = new Map((await tx.select({ id: schema.users.id, username: schema.users.username }).from(schema.users)).map(u => [u.username, u.id]))
      const rie = l.riepilogo as { mappaId?: Record<string, string>; daRimappare?: string[] }
      const ctx: CtxApplica = {
        userId, ambiente: l.ambiente, origine: l.origine as 'T6' | 'T7' | 'ARCHIVIO', utenti, oggi: oggi(),
        idMap: new Map(Object.entries(rie.mappaId ?? {})), vietati: new Set(rie.daRimappare ?? []),
      }
      const esito: CralEsitoApplica = { applicate: 0, errori: 0, campiSaltati: 0, chiuso: false }
      for (const v of vs) {
        let ok = false, nota = ''
        try {
          const r = await tx.transaction(sp => this.applicaVariazione(sp as unknown as TX, v, ctx))
          ok = r.fatti > 0; esito.campiSaltati += r.saltati.length
          nota = r.saltati.length ? `Saltati: ${r.saltati.join('; ')}` : ''
          if (!ok && !nota) nota = 'Niente da applicare'
        } catch (e) {
          nota = e instanceof Salta ? e.message : e instanceof Annulla ? e.codice : violazioneUnica(e) ? 'valore già usato (tessera o matricola)' : `errore del database${(e as { code?: string })?.code ? ` (${(e as { code?: string }).code})` : ''}`
        }
        await tx.update(schema.cralLottiVariazioni).set({ esito: ok ? 'APPLICATA' : 'ERRORE', nota: nota.slice(0, 300) }).where(eq(schema.cralLottiVariazioni.id, v.id))
        if (ok) esito.applicate++; else esito.errori++
      }
      if (ctx.idMap.size) {
        await tx.update(schema.cralLotti).set({ riepilogo: sql`${schema.cralLotti.riepilogo} || ${JSON.stringify({ mappaId: Object.fromEntries(ctx.idMap) })}::jsonb` }).where(eq(schema.cralLotti.id, id))
      }
      // i prossimi EXT-/FAM- non devono ripetere un ID arrivato dall'archivio
      await tx.execute(sql`
        UPDATE cral_parametri SET
          ext_prossimo = GREATEST(ext_prossimo, COALESCE((SELECT max(substring(id FROM 5)::int) FROM cral_soci WHERE id LIKE 'EXT-%'), 0) + 1),
          fam_prossimo = GREATEST(fam_prossimo, COALESCE((SELECT max(substring(id FROM 5)::int) FROM cral_soci WHERE id LIKE 'FAM-%'), 0) + 1)
        WHERE id = 1`)
      const [resto] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.cralLottiVariazioni)
        // le bloccate non si possono accettare: non tengono aperto il lotto
        .where(and(eq(schema.cralLottiVariazioni.lottoId, id), sql`(${schema.cralLottiVariazioni.esito} IN ('ACCETTATA', 'ERRORE') OR (${schema.cralLottiVariazioni.esito} = 'ATTESA' AND NOT (${schema.cralLottiVariazioni.dati} ? 'bloccata')))`))
      if (!resto?.n) { await this.chiudiLotto(tx, id, 'CHIUSO', userId); esito.chiuso = true }
      return esito
    })
  }

  private async applicaVariazione(tx: TX, v: typeof schema.cralLottiVariazioni.$inferSelect, c: CtxApplica): Promise<{ fatti: number; saltati: string[] }> {
    const d = v.dati as { campi: CampoVar[]; record: unknown }
    const campi = v.tipo === 'MODIFICA' ? d.campi.filter(x => v.accettati.includes(x.campo) && !x.blocco) : []
    switch (v.entita) {
      case 'sede': return this.applicaSede(tx, v.tipo, d.record as SedeArch, campi)
      case 'tipo': case 'tipologia': return this.applicaTabella(tx, v.entita, v.tipo, d.record as TipoArch | TipologiaArch, campi)
      case 'tessera': return this.applicaTessera(tx, d.record as CralTesseraParam, campi)
      case 'quotaAnno': return this.applicaQuotaAnno(tx, v.tipo, d.record as { anno: number; importo: number }, campi, c)
      case 'persona': return v.tipo === 'MODIFICA' ? this.applicaModificaPersona(tx, v.chiave, d.record as PersonaArch, campi, c)
        : this.applicaNuovaPersona(tx, v.tipo === 'CONFLITTO', d.record as PersonaArch, d.campi, c)
      case 'quota': return this.applicaQuota(tx, v.tipo, d.record as QuotaArch, campi, c)
      case 'evento': return this.applicaEvento(tx, v.tipo, d.record as EventoArch, campi, c)
      default: throw new Salta('tipo di record sconosciuto')
    }
  }

  private async applicaSede(tx: TX, tipo: string, s: SedeArch, campi: CampoVar[]) {
    const [cur] = await tx.select().from(schema.cralSedi).where(eq(schema.cralSedi.id, s.id))
    if (tipo !== 'MODIFICA') {
      if (cur) throw new Salta('la sede c\'è già')
      await tx.insert(schema.cralSedi).values({ id: s.id, nome: s.nome, attiva: s.attiva, ordine: s.ordine })
      return { fatti: 1, saltati: [] }
    }
    if (!cur) throw new Salta('la sede non c\'è più')
    return this.aggiornaCampi(campi, toSede(cur) as unknown as Record<string, unknown>, set => tx.update(schema.cralSedi).set({ ...set, updatedAt: new Date() }).where(eq(schema.cralSedi.id, s.id)))
  }

  private async applicaTabella(tx: TX, entita: 'tipo' | 'tipologia', tipo: string, t: TipoArch | TipologiaArch, campi: CampoVar[]) {
    if (entita === 'tipo') {
      const x = t as TipoArch
      const [cur] = await tx.select().from(schema.cralTipi).where(eq(schema.cralTipi.id, x.id))
      if (tipo !== 'MODIFICA') {
        if (cur) throw new Salta('il tipo c\'è già')
        await tx.insert(schema.cralTipi).values({ id: x.id, nome: x.nome, colore: x.colore, aPagamento: x.pagamento, modo: x.modo, attivo: x.attivo, ordine: x.ordine })
        return { fatti: 1, saltati: [] }
      }
      if (!cur) throw new Salta('il tipo non c\'è più')
      return this.aggiornaCampi(campi, toTipo(cur) as unknown as Record<string, unknown>,
        set => tx.update(schema.cralTipi).set(Object.fromEntries(Object.entries(set).map(([k, v]) => [k === 'pagamento' ? 'aPagamento' : k, v]))).where(eq(schema.cralTipi.id, x.id)))
    }
    const [cur] = await tx.select().from(schema.cralTipologieProdotto).where(eq(schema.cralTipologieProdotto.id, t.id))
    if (tipo !== 'MODIFICA') {
      if (cur) throw new Salta('la tipologia c\'è già')
      const x = t as TipologiaArch
      await tx.insert(schema.cralTipologieProdotto).values({ id: x.id, nome: x.nome, attiva: x.attiva, ordine: x.ordine })
      return { fatti: 1, saltati: [] }
    }
    if (!cur) throw new Salta('la tipologia non c\'è più')
    return this.aggiornaCampi(campi, toTipologia(cur) as unknown as Record<string, unknown>, set => tx.update(schema.cralTipologieProdotto).set(set).where(eq(schema.cralTipologieProdotto.id, t.id)))
  }

  private async applicaTessera(tx: TX, t: CralTesseraParam, campi: CampoVar[]) {
    const cur = (await this.parametri(tx)).tessera
    const col: Record<string, string> = { formato: 'tesseraFormato', prefisso: 'tesseraPrefisso', cifre: 'tesseraCifre', riammissione: 'riammissione', sepSuffisso: 'suffissoSep', cifreSuffisso: 'suffissoCifre' }
    const r = await this.aggiornaCampi(campi, cur as unknown as Record<string, unknown>,
      set => tx.update(schema.cralParametri).set(Object.fromEntries(Object.entries(set).map(([k, v]) => [col[k] ?? k, v]))).where(eq(schema.cralParametri.id, 1)))
    // il prossimo numero non torna mai indietro
    await tx.update(schema.cralParametri).set({ tesseraProssimo: sql`GREATEST(tessera_prossimo, ${t.prossimo})` }).where(eq(schema.cralParametri.id, 1))
    return r
  }

  private async applicaQuotaAnno(tx: TX, tipo: string, a: { anno: number; importo: number }, campi: CampoVar[], c: CtxApplica) {
    const [cur] = await tx.select().from(schema.cralQuoteAnno).where(eq(schema.cralQuoteAnno.anno, a.anno))
    if (tipo !== 'MODIFICA') {
      if (cur) throw new Salta('l\'anno c\'è già')
      await tx.insert(schema.cralQuoteAnno).values({ anno: a.anno, importoCent: a.importo, updatedBy: c.userId })
      return { fatti: 1, saltati: [] }
    }
    if (!cur) throw new Salta('l\'anno non c\'è più')
    return this.aggiornaCampi(campi, { importo: cur.importoCent }, set => tx.update(schema.cralQuoteAnno).set({ importoCent: set['importo'] as number, updatedBy: c.userId, updatedAt: new Date() }).where(eq(schema.cralQuoteAnno.anno, a.anno)))
  }

  /** Per ogni campo accettato: si scrive solo se qui vale ancora quel che si e' visto nel lotto. */
  private async aggiornaCampi(campi: CampoVar[], attuale: Record<string, unknown>, scrivi: (set: Record<string, unknown>) => Promise<unknown>) {
    const set: Record<string, unknown> = {}, saltati: string[] = []
    for (const x of campi) {
      if (!uguale(attuale[x.campo], x.prima)) { saltati.push(`${x.etichetta} cambiato nel frattempo`); continue }
      set[x.campo] = x.dopo
    }
    if (Object.keys(set).length) await scrivi(set)
    return { fatti: Object.keys(set).length, saltati }
  }

  /** L'ID di qui di una persona citata dall'archivio; null = non c'e' (o e' di un'altra persona). */
  private mappa(c: CtxApplica, id: string): string | null {
    return c.idMap.get(id) ?? (c.vietati.has(id) ? null : id)
  }

  private async esiste(tx: TX, id: string): Promise<boolean> {
    const [x] = await tx.select({ id: schema.cralSoci.id }).from(schema.cralSoci).where(eq(schema.cralSoci.id, id))
    return !!x
  }
  private async sedeEsiste(tx: TX, id: string | null): Promise<boolean> {
    if (!id) return true
    const [x] = await tx.select({ id: schema.cralSedi.id }).from(schema.cralSedi).where(eq(schema.cralSedi.id, id))
    return !!x
  }
  private async tesseraLibera(tx: TX, tessera: string, di: string | null): Promise<boolean> {
    const [x] = await tx.select({ id: schema.cralSoci.id }).from(schema.cralSoci).where(sql`lower(${schema.cralSoci.tessera}) = lower(${tessera})`)
    return !x || x.id === di
  }

  private async applicaNuovaPersona(tx: TX, conNuovoId: boolean, p: PersonaArch, campi: CampoVar[], c: CtxApplica) {
    const saltati: string[] = []
    const bloccato = (campo: string) => campi.some(x => x.campo === campo && x.blocco)
    let id = p.id
    if (conNuovoId) {
      if (p.matricola) throw new Salta('una matricola non cambia ID')
      const par = await this.parametri(tx)
      id = await this.prossimoId(tx, p.tipo === 'FAM' ? 'FAM' : 'EXT', p.tipo === 'FAM' ? par.famProssimo : par.extProssimo)
    } else if (await this.esiste(tx, id)) throw new Salta('c\'è già: reimporta l\'archivio per vedere le differenze')
    if (p.matricola || p.exMatricola) {
      const m = [p.matricola, p.exMatricola].filter((x): x is string => !!x)
      const [gia] = await tx.select({ id: schema.cralSoci.id }).from(schema.cralSoci)
        .where(sql`${schema.cralSoci.matricola} IN ${m} OR ${schema.cralSoci.exMatricola} IN ${m}`)
      if (gia) throw new Salta(`matricola già nel CRAL (${gia.id})`)
    }
    let sede = bloccato('sede') ? null : p.sede
    if (sede && !(await this.sedeEsiste(tx, sede))) { saltati.push(`sede ${sede} non presente`); sede = null }
    let tessera = (p.tipo === 'SD' || p.tipo === 'SE') && !bloccato('tessera') ? p.tessera : ''
    if (tessera && !(await this.tesseraLibera(tx, tessera, null))) { saltati.push(`tessera ${tessera} già usata`); tessera = '' }
    const legami: Array<{ socio: string; relazione: 'CONIUGE' | 'FIGLIO' }> = []
    for (const l of p.legami) { const s = this.mappa(c, l.socio); if (s && (await this.esiste(tx, s))) legami.push({ socio: s, relazione: l.relazione }) }
    if (p.tipo === 'FAM' && !legami.length) throw new Salta('nessuno dei suoi soci è presente')
    if (p.tipo === 'FAM' && legami.length < p.legami.length) saltati.push(`${p.legami.length - legami.length} soci collegati non presenti`)
    const { u, ignoti } = this.mappaUtenti(c, [p.creatoDa, p.validatoDa, p.eliminatoDa])
    // da dove viene (e chi l'ha creato o validato, se qui quell'utente non c'e'): nella provenienza, non nelle note
    const provenienza = [p.provenienza ?? '', `archivio ${c.ambiente || ''}`.trim(), conNuovoId ? `era ${p.id}` : '', ignoti.length ? `utenti ${ignoti.join(', ')}` : '']
      .filter(Boolean).join(' · ').slice(0, 200)
    await tx.insert(schema.cralSoci).values({
      id, tipo: p.tipo, matricola: p.matricola, exMatricola: p.exMatricola, cognome: p.cognome, nome: p.nome, nascita: p.nascita,
      email: p.email || null, sedeId: sede, tessera: tessera || null, riammissioni: p.riammissioni, stato: p.stato,
      iscrittoIl: p.iscrittoIl, cessatoIl: p.cessatoIl, eliminatoIl: p.eliminatoIl, eliminatoDa: u(p.eliminatoDa), statoPrima: p.statoPrima,
      anniEsenti: p.anniEsenti, provenienza, atipico: p.atipico, note: p.note,
      creatoDa: u(p.creatoDa), creatoIl: p.creatoIl ? new Date(p.creatoIl) : new Date(), validatoDa: u(p.validatoDa),
      validatoIl: p.validatoIl ? new Date(p.validatoIl) : null, modificatoDa: c.userId, modificatoIl: new Date(),
    })
    c.idMap.set(p.id, id)
    if (legami.length) await tx.insert(schema.cralFamiliariLegami).values(legami.map(l => ({ familiareId: id, socioId: l.socio, relazione: l.relazione })))
    if (p.storicoTessere.length) await tx.insert(schema.cralSociTessere).values(p.storicoTessere.map(t => ({ socioId: id, tessera: t.tessera, dal: t.dal, al: t.al })))
    if (tessera) await this.avanzaTessera(tx, (await this.parametri(tx)).tessera, tessera)
    return { fatti: 1, saltati }
  }

  /** Utenti dell'altro ambiente: si ricollegano per username; chi non c'e' resta scritto nelle note. */
  private mappaUtenti(c: CtxApplica, nomi: Array<string | null>) {
    const ignoti = [...new Set(nomi.filter((n): n is string => !!n && !c.utenti.has(n)))]
    return { u: (n: string | null) => (n ? c.utenti.get(n) ?? null : null), ignoti }
  }

  private async applicaModificaPersona(tx: TX, id: string, p: PersonaArch | { id: string }, campi: CampoVar[], c: CtxApplica) {
    const riga = await this.socio(id, tx)
    if (!riga) throw new Salta('la persona non c\'è più')
    const cur = personaDaRiga(riga)
    const set: Partial<typeof schema.cralSoci.$inferInsert> = {}
    const saltati: string[] = []
    let fatti = 0
    const legamiNuovi: Array<{ socio: string; relazione: 'CONIUGE' | 'FIGLIO' }> = []
    const storicoNuovo: PersonaArch['storicoTessere'] = []
    for (const x of campi) {
      if (!uguale(valorePersona(cur, x.campo), x.prima)) { saltati.push(`${x.etichetta} cambiato nel frattempo`); continue }
      const dopo = x.dopo as never
      switch (x.campo) {
        case 'tipo': set.tipo = dopo; if (dopo === 'EST') set.tessera = null; break
        case 'cognome': case 'nome': case 'note': set[x.campo] = (dopo ?? '') as string; break
        case 'nascita': set.nascita = dopo; break
        case 'email': set.email = (dopo || null) as string | null; break
        case 'atipico': set.atipico = dopo; break
        case 'iscrittoIl': set.iscrittoIl = dopo; break
        case 'exMatricola': set.exMatricola = dopo; break
        case 'anniEsenti': set.anniEsenti = dopo; break
        case 'sede':
          if (!(await this.sedeEsiste(tx, dopo))) { saltati.push(`sede ${String(dopo)} non presente`); continue }
          set.sedeId = dopo; break
        case 'tessera':
          if (dopo && !(await this.tesseraLibera(tx, dopo, id))) { saltati.push(`tessera ${String(dopo)} già usata`); continue }
          set.tessera = (dopo || null) as string | null; break
        case 'legami':
          for (const l of dopo as Array<{ socio: string; relazione: 'CONIUGE' | 'FIGLIO' }>) {
            const s = this.mappa(c, l.socio)
            if (s && !cur.legami.some(y => y.socio === s) && (await this.esiste(tx, s))) legamiNuovi.push({ socio: s, relazione: l.relazione })
          }
          break
        case 'storicoTessere':
          for (const t of dopo as PersonaArch['storicoTessere']) if (!cur.storicoTessere.some(y => y.tessera === t.tessera && y.al === t.al)) storicoNuovo.push(t)
          break
        case 'stato': { // dall'archivio: lo stato con le sue date, cosi' com'e'
          const s = dopo as StatoComposto
          Object.assign(set, { stato: s.stato, cessatoIl: s.cessatoIl, eliminatoIl: s.eliminatoIl, statoPrima: s.statoPrima, riammissioni: s.riammissioni, eliminatoDa: s.stato === 'ELIMINATO' ? c.userId : null })
          break
        }
        case 'azioneStato': { // dal T6: le stesse azioni della scheda
          const a = dopo as { azione: string; data: string }
          if (a.azione === 'cessa') Object.assign(set, { stato: 'CESSATO', cessatoIl: a.data })
          else if (a.azione === 'elimina') Object.assign(set, { stato: 'ELIMINATO', statoPrima: cur.stato, eliminatoIl: a.data, eliminatoDa: c.userId })
          else if (a.azione === 'ripristina') Object.assign(set, { stato: cur.statoPrima, statoPrima: null, eliminatoIl: null, eliminatoDa: null, anniEsenti: anniEsentiDopoRipristino(cur.anniEsenti, cur.eliminatoIl ?? c.oggi, c.oggi) })
          else if (a.azione === 'riattiva') Object.assign(set, { stato: 'ATTIVO', cessatoIl: null })
          else { saltati.push('azione sconosciuta'); continue }
          break
        }
        default: saltati.push(`${x.etichetta}: non si aggiorna`); continue
      }
      fatti++
    }
    void p
    if (Object.keys(set).length) {
      await tx.update(schema.cralSoci).set({ ...set, modificatoDa: c.userId, modificatoIl: new Date() }).where(eq(schema.cralSoci.id, id))
      if (set.tessera) await this.avanzaTessera(tx, (await this.parametri(tx)).tessera, set.tessera)
    }
    if (legamiNuovi.length) await tx.insert(schema.cralFamiliariLegami).values(legamiNuovi.map(l => ({ familiareId: id, socioId: l.socio, relazione: l.relazione })))
    if (storicoNuovo.length) await tx.insert(schema.cralSociTessere).values(storicoNuovo.map(t => ({ socioId: id, tessera: t.tessera, dal: t.dal, al: t.al })))
    return { fatti, saltati }
  }

  private async applicaQuota(tx: TX, tipo: string, q: QuotaArch, campi: CampoVar[], c: CtxApplica) {
    const socio = this.mappa(c, q.socio)
    if (!socio) throw new Salta('la persona qui ha l\'ID di un\'altra: accetta prima il suo conflitto (nuovo ID)')
    const [s] = await tx.select({ matricola: schema.cralSoci.matricola, tipo: schema.cralSoci.tipo }).from(schema.cralSoci).where(eq(schema.cralSoci.id, socio))
    if (!s) throw new Salta('la persona non c\'è')
    if (s.tipo !== 'SD' && s.tipo !== 'SE') throw new Salta('non è un socio')
    const [a] = await tx.select({ anno: schema.cralQuoteAnno.anno }).from(schema.cralQuoteAnno).where(eq(schema.cralQuoteAnno.anno, q.anno))
    if (!a) throw new Salta(`l'anno ${q.anno} non è impostato`)
    const [cur] = await tx.select().from(schema.cralQuote).where(and(eq(schema.cralQuote.anno, q.anno), eq(schema.cralQuote.socioId, socio)))
    const saltati: string[] = []
    // senza matricola niente trattenuta in busta paga
    const modo = (m: string) => (m === 'TRATTENUTA' && !s.matricola ? (saltati.push('trattenuta senza matricola: mensile'), 'MENSILE') : m)
    if (tipo !== 'MODIFICA') {
      if (cur) throw new Salta('la quota c\'è già: reimporta per vedere le differenze')
      await tx.insert(schema.cralQuote).values({
        anno: q.anno, socioId: socio, modo: modo(q.modo), mesi: q.mesi, importi: q.importi, pagataIl: q.pagataIl, versatoUnica: q.versatoUnica, note: q.note, updatedBy: c.userId,
      })
      return { fatti: 1, saltati }
    }
    if (!cur) throw new Salta('la quota non c\'è più')
    const qc = toQuota(cur)
    // T7: i versamenti (mesi + importi) e l'unica soluzione (data + importo) vanno a coppie
    const attuale = { ...qc, versamenti: { mesi: qc.mesi, importi: qc.importi }, unica: { pagataIl: qc.pagataIl, versatoUnica: qc.versatoUnica } }
    const r = await this.aggiornaCampi(campi, attuale as unknown as Record<string, unknown>, set => {
      if (set['modo']) set['modo'] = modo(set['modo'] as string)
      if (set['versamenti']) { Object.assign(set, set['versamenti']); delete set['versamenti'] }
      if (set['unica']) { Object.assign(set, set['unica']); delete set['unica'] }
      return tx.update(schema.cralQuote).set({ ...set, updatedBy: c.userId, updatedAt: new Date() }).where(and(eq(schema.cralQuote.anno, q.anno), eq(schema.cralQuote.socioId, socio)))
    })
    return { fatti: r.fatti, saltati: [...r.saltati, ...saltati] }
  }

  private async applicaEvento(tx: TX, tipo: string, e: EventoArch, campi: CampoVar[], c: CtxApplica) {
    const saltati: string[] = []
    // chi qui ha l'ID di un'altra persona e non e' entrato con un nuovo ID: '' = si salta
    const mappa = (id: string) => this.mappa(c, id) ?? ''
    const [cur] = await tx.select().from(schema.cralIniziative).where(eq(schema.cralIniziative.id, e.id))
    const accetta = new Set(tipo === 'MODIFICA' ? campi.map(x => x.campo) : ['partecipanti', 'scelte', 'carichi', 'richieste'])
    let scritti = 0
    if (tipo !== 'MODIFICA') {
      if (cur) throw new Salta('l\'evento c\'è già')
      const [t] = await tx.select({ id: schema.cralTipi.id }).from(schema.cralTipi).where(eq(schema.cralTipi.id, e.tipo))
      if (!t) throw new Salta(`tipo di evento ${e.tipo} non presente`)
      const { u } = this.mappaUtenti(c, [e.archiviataDa])
      await tx.insert(schema.cralIniziative).values({
        id: e.id, tipoId: e.tipo, titolo: e.titolo, anno: e.anno, data: e.data, scadenza: e.scadenza, stato: e.stato, modalita: e.modalita,
        partecipanti: e.modoPart, gruppi: e.gruppi, sedi: e.sedi, predefinita: e.predefinita, fornitore: e.fornitore, pagamento: e.pagamento,
        note: e.note, quotaCent: e.quota, config: e.config, archiviata: e.archiviata, archiviataDa: u(e.archiviataDa),
        archiviataIl: e.archiviataIl ? new Date(e.archiviataIl) : null, createdBy: c.userId, updatedBy: c.userId,
      })
    } else {
      if (!cur) throw new Salta('l\'evento non c\'è più')
      const attuale: Record<string, unknown> = {
        titolo: cur.titolo, anno: cur.anno, data: cur.data, scadenza: cur.scadenza, stato: cur.stato, modalita: cur.modalita, modoPart: cur.partecipanti,
        gruppi: cur.gruppi, sedi: cur.sedi, predefinita: cur.predefinita, fornitore: cur.fornitore, pagamento: cur.pagamento, note: cur.note,
        quota: cur.quotaCent, archiviata: cur.archiviata,
      }
      const col: Record<string, string> = { modoPart: 'partecipanti', quota: 'quotaCent' }
      const set: Record<string, unknown> = {}
      for (const x of campi) {
        if (x.campo in attuale) {
          if (!uguale(attuale[x.campo], x.prima)) { saltati.push(`${x.etichetta} cambiato nel frattempo`); continue }
          set[col[x.campo] ?? x.campo] = x.dopo
        } else if (x.campo === 'config') {
          const tolto = usiTolti(e.config as ConfigEvento, await this.usiIniziativa(e.id, tx))
          if (tolto) { saltati.push(`configurazione: ${tolto}`); continue }
          set['config'] = e.config
        }
      }
      if (Object.keys(set).length) await tx.update(schema.cralIniziative).set({ ...set, updatedBy: c.userId, updatedAt: new Date() }).where(eq(schema.cralIniziative.id, e.id))
      scritti = Object.keys(set).length
    }
    const [fin] = await tx.select({ config: schema.cralIniziative.config }).from(schema.cralIniziative).where(eq(schema.cralIniziative.id, e.id))
    const config = fin!.config as ConfigEvento
    const presenti = async (tutti: string[]) => {
      const ids = tutti.filter(Boolean)
      if (!ids.length) return new Set<string>()
      return new Set((await tx.select({ id: schema.cralSoci.id }).from(schema.cralSoci).where(inArray(schema.cralSoci.id, ids))).map(x => x.id))
    }
    let n = scritti ? 1 : 0
    if (accetta.has('partecipanti') && e.partecipanti.length) {
      const ok = await presenti(e.partecipanti.map(mappa))
      const ids = e.partecipanti.map(mappa).filter(x => ok.has(x))
      if (ids.length < e.partecipanti.length) saltati.push(`${e.partecipanti.length - ids.length} partecipanti non presenti`)
      if (ids.length) await tx.insert(schema.cralIniziativePartecipanti).values(ids.map(socioId => ({ iniziativaId: e.id, socioId }))).onConflictDoNothing()
      n++
    }
    if (accetta.has('scelte') && e.scelte.length) {
      const ok = await presenti(e.scelte.map(x => mappa(x.socio)))
      const voci = e.scelte.map(x => ({ ...x, socio: mappa(x.socio), dati: x.dati.rif ? { ...x.dati, rif: mappa(x.dati.rif) || null } : x.dati }))
        .filter(x => ok.has(x.socio) && !erroreDati(x.dati, config))
      if (voci.length < e.scelte.length) saltati.push(`${e.scelte.length - voci.length} scelte non applicabili`)
      if (voci.length) await this.salvaScelte(e.id, voci.map(x => ({ socio: x.socio, dati: x.dati as Record<string, unknown>, fonte: x.fonte })), c.userId, tx)
      n++
    }
    if (accetta.has('carichi') && e.carichi.length) {
      await tx.insert(schema.cralCarichi).values(e.carichi.map(k => ({ id: k.id, iniziativaId: e.id, articolo: k.art, quantita: k.qta, data: k.data, note: k.note, createdBy: c.userId }))).onConflictDoNothing()
      n++
    }
    if (accetta.has('richieste') && e.richieste.length) {
      const ok = await presenti(e.richieste.map(r => mappa(r.persona)))
      const rr = e.richieste.map(r => ({ ...r, persona: mappa(r.persona) })).filter(r => ok.has(r.persona))
      if (rr.length < e.richieste.length) saltati.push(`${e.richieste.length - rr.length} richieste di persone non presenti`)
      for (const r of rr) {
        const val = { socioId: r.persona, articolo: r.art, quantita: r.qta, dataRichiesta: r.dataRich, stato: r.stato, dataConsegna: r.dataCons, modo: r.modo, pagato: r.pagato, sconto: r.sconto, note: r.note, updatedBy: c.userId, updatedAt: new Date() }
        await tx.insert(schema.cralRichieste).values({ id: r.id, iniziativaId: e.id, ...val, createdBy: c.userId })
          .onConflictDoUpdate({ target: schema.cralRichieste.id, set: val, where: sql`${schema.cralRichieste.iniziativaId} = ${e.id}` })
      }
      n++
    }
    return { fatti: tipo === 'MODIFICA' ? n : 1, saltati }
  }

  private async utenti(conn: Conn): Promise<Map<string, string>> {
    return new Map((await conn.select({ id: schema.users.id, username: schema.users.username }).from(schema.users)).map(u => [u.id, u.username]))
  }

  // ── Transazioni con errori applicativi ─────────────────────
  private async inTransazione<T>(fn: (tx: TX) => Promise<T>): Promise<T | CralErrore> {
    try { return await this.db.transaction(fn) }
    catch (e) { if (e instanceof Annulla) return e.codice; throw e }
  }
}

// ── Conversioni ──────────────────────────────────────────────
function raggruppa<T>(xs: T[], k: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const x of xs) { const c = k(x); const l = m.get(c); if (l) l.push(x); else m.set(c, [x]) }
  return m
}

/** Codice breve da un nome: tre lettere, con un numero se gia' usato. */
function nuovoCodice(nome: string, usati: Set<string>): string {
  const b = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'X'
  let id = b, k = 2
  while (usati.has(id)) id = `${b}${k++}`
  return id
}

function toSede(r: typeof schema.cralSedi.$inferSelect): CralSedeRow {
  return { id: r.id, nome: r.nome, attiva: r.attiva, ordine: r.ordine }
}
function toTipo(r: typeof schema.cralTipi.$inferSelect): CralTipoRow {
  return { id: r.id, nome: r.nome, colore: r.colore, pagamento: r.aPagamento, modo: r.modo, attivo: r.attivo, ordine: r.ordine }
}
function toTipologia(r: typeof schema.cralTipologieProdotto.$inferSelect): CralTipologiaRow {
  return { id: r.id, nome: r.nome, attiva: r.attiva, ordine: r.ordine }
}
function toAnag(r: Record<string, unknown>): CralAnagraficaRow {
  const d = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null)
  return {
    matricola: String(r['matricola']), cognNome: (r['cognNome'] as string) ?? null, cognome: (r['cognome'] as string) ?? null,
    nome: (r['nome'] as string) ?? null, ruolo: (r['ruolo'] as string) ?? null, druolo: (r['druolo'] as string) ?? null,
    idAb: r['idAb'] == null ? null : Number(r['idAb']), nascita: d(r['dtNascita']), finRap: d(r['finRap']),
  }
}
function toSocio(
  s: RigaSocio, legami: Array<typeof schema.cralFamiliariLegami.$inferSelect>, storico: Array<typeof schema.cralSociTessere.$inferSelect>,
  utenti: Map<string, string>,
): CralSocioRow {
  const u = (id: string | null) => (id ? utenti.get(id) ?? null : null)
  return {
    id: s.id, tipo: s.tipo as CralSocioRow['tipo'], origine: s.matricola ? 'PGS' : 'EST', matricola: s.matricola,
    cognome: s.cognome, nome: s.nome, nascita: s.nascita, email: s.email ?? '', sede: s.sedeId, tessera: s.tessera ?? '',
    riammissioni: s.riammissioni, stato: s.stato as CralSocioRow['stato'], iscrittoIl: s.iscrittoIl, cessatoIl: s.cessatoIl,
    provenienza: s.provenienza, atipico: s.atipico, note: s.note,
    creatoDa: u(s.creatoDa), creatoIl: s.creatoIl.toISOString(), validatoDa: u(s.validatoDa), validatoIl: iso(s.validatoIl),
    modificatoDa: u(s.modificatoDa), modificatoIl: iso(s.modificatoIl),
    eliminatoIl: s.eliminatoIl, eliminatoDa: u(s.eliminatoDa), statoPrima: (s.statoPrima ?? null) as CralSocioRow['statoPrima'],
    anniEsenti: s.anniEsenti ?? [], exMatricola: s.exMatricola,
    legami: legami.map(l => ({ socio: l.socioId, relazione: l.relazione as 'CONIUGE' | 'FIGLIO' })),
    storicoTessere: storico.map(t => ({ tessera: t.tessera, dal: t.dal, al: t.al })),
  }
}
function toLotto(l: typeof schema.cralLotti.$inferSelect, utenti: Map<string, string>): CralLottoRow {
  return {
    id: l.id, origine: l.origine as CralLottoRow['origine'], file: l.file, ambiente: l.ambiente, esportato: iso(l.esportato), sezioni: l.sezioni,
    stato: l.stato as CralLottoRow['stato'], riepilogo: l.riepilogo as Record<string, unknown>,
    creatoDa: l.creatoDa ? utenti.get(l.creatoDa) ?? null : null, creatoIl: l.creatoIl.toISOString(),
    chiusoDa: l.chiusoDa ? utenti.get(l.chiusoDa) ?? null : null, chiusoIl: iso(l.chiusoIl),
  }
}
function toVariazione(v: typeof schema.cralLottiVariazioni.$inferSelect): CralVariazioneRow {
  const d = v.dati as { etichetta?: string; campi?: CralVariazioneRow['campi']; avviso?: string; bloccata?: string }
  return {
    id: v.id, sezione: v.sezione, entita: v.entita, chiave: v.chiave, tipo: v.tipo as CralVariazioneRow['tipo'], delicata: v.delicata,
    bloccata: d.bloccata ?? null, esito: v.esito as CralVariazioneRow['esito'], accettati: v.accettati, etichetta: d.etichetta ?? v.chiave,
    campi: d.campi ?? [], avviso: d.avviso ?? null, nota: v.nota,
  }
}
function toCarico(r: typeof schema.cralCarichi.$inferSelect): CralCaricoRow {
  return { id: r.id, art: r.articolo, qta: r.quantita, data: r.data, note: r.note }
}
function toRichiesta(r: typeof schema.cralRichieste.$inferSelect, _u: Map<string, string>): CralRichiestaRow {
  return {
    id: r.id, persona: r.socioId, art: r.articolo, qta: r.quantita, dataRich: r.dataRichiesta,
    stato: r.stato as CralRichiestaRow['stato'], dataCons: r.dataConsegna, modo: r.modo as CralRichiestaRow['modo'],
    pagato: r.pagato, sconto: r.sconto ?? null, note: r.note,
  }
}
function toQuota(r: typeof schema.cralQuote.$inferSelect): CralQuotaRow {
  return { modo: r.modo as CralQuotaRow['modo'], mesi: r.mesi, pagataIl: r.pagataIl, note: r.note, importi: r.importi ?? Array<number>(12).fill(0), versatoUnica: r.versatoUnica ?? null }
}
const quotaVuota = (modo: CralQuotaRow['modo']): CralQuotaRow =>
  ({ modo, mesi: Array<boolean>(12).fill(false), importi: Array<number>(12).fill(0), pagataIl: null, versatoUnica: null, note: '' })
function toIniz(
  i: RigaIniz, part: Array<typeof schema.cralIniziativePartecipanti.$inferSelect>, sce: Array<typeof schema.cralScelte.$inferSelect>,
  car: Array<typeof schema.cralCarichi.$inferSelect>, ric: Array<typeof schema.cralRichieste.$inferSelect>, utenti: Map<string, string>,
): CralIniziativaRow {
  return {
    id: i.id, tipo: i.tipoId, titolo: i.titolo, anno: i.anno, data: i.data, scadenza: i.scadenza,
    stato: i.stato as CralIniziativaRow['stato'], modalita: i.modalita as CralIniziativaRow['modalita'],
    modoPart: i.partecipanti as CralIniziativaRow['modoPart'], gruppi: i.gruppi, sedi: i.sedi, predefinita: i.predefinita,
    fornitore: i.fornitore, pagamento: i.pagamento, note: i.note, quota: i.quotaCent, config: i.config,
    archiviata: i.archiviata, archiviataDa: i.archiviataDa ? utenti.get(i.archiviataDa) ?? null : null, archiviataIl: iso(i.archiviataIl),
    partecipanti: part.map(p => p.socioId),
    scelte: Object.fromEntries(sce.map(x => [x.socioId, { ...(x.dati as Record<string, unknown>), fonte: x.fonte }])),
    carichi: car.map(toCarico),
    richieste: ric.map(r => toRichiesta(r, utenti)),
  }
}
