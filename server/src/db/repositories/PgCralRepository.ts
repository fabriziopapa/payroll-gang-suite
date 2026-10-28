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
  CralNuovaPersona, CralModificaPersona, CralOperazioneImport, CralEsitoImport, CralErrore,
} from '../IRepository.js'
import { baseTessera, formatTessera, prossimoDopo, tesseraRiammissione } from '../../lib/cral.js'

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
      const [gia] = await tx.select({ id: schema.cralSoci.id }).from(schema.cralSoci).where(eq(schema.cralSoci.matricola, p.matricola))
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

  async cambiaStato(ids: string[], azione: 'valida' | 'rifiuta' | 'rimetti' | 'cessa' | 'riattiva', userId: string | null): Promise<number> {
    if (!ids.length) return 0
    const ora = new Date()
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
      const [gia] = await tx.select({ id: schema.cralSoci.id }).from(schema.cralSoci).where(eq(schema.cralSoci.id, a.matricola))
      if (gia) throw new Annulla('MATRICOLA_GIA_SOCIO')
      const [cognome, nome] = a.cognome || a.nome ? [a.cognome ?? '', a.nome ?? ''] : [a.cognNome ?? s.cognome, '']
      await tx.update(schema.cralSoci).set({
        id: a.matricola, matricola: a.matricola, tipo: s.tipo === 'SE' ? 'SD' : 'EST',
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

  async usiIniziativa(id: string): Promise<{ opz: Set<string>; prodotti: Set<string>; periodi: Set<string>; articoli: Set<string> }> {
    const [sce, car, ric] = await Promise.all([
      this.db.select({ dati: schema.cralScelte.dati }).from(schema.cralScelte).where(eq(schema.cralScelte.iniziativaId, id)),
      this.db.select({ art: schema.cralCarichi.articolo }).from(schema.cralCarichi).where(eq(schema.cralCarichi.iniziativaId, id)),
      this.db.select({ art: schema.cralRichieste.articolo }).from(schema.cralRichieste).where(eq(schema.cralRichieste.iniziativaId, id)),
    ])
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

  async salvaScelte(id: string, voci: Array<{ socio: string; dati: Record<string, unknown>; fonte: string }>, userId: string | null): Promise<number> {
    if (!voci.length) return 0
    const ora = new Date()
    await this.db.insert(schema.cralScelte)
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
    const [a] = await this.db.select({ anno: schema.cralQuoteAnno.anno }).from(schema.cralQuoteAnno).where(eq(schema.cralQuoteAnno.anno, anno))
    if (!a) return null
    const vuoto = Array<boolean>(12).fill(false)
    const ora = new Date()
    const [r] = await this.db.insert(schema.cralQuote).values({
      anno, socioId: socio, modo: patch.modo ?? modoPredefinito, mesi: patch.mesi ?? vuoto, pagataIl: patch.pagataIl ?? null,
      note: patch.note ?? '', updatedBy: userId, updatedAt: ora,
    }).onConflictDoUpdate({
      target: [schema.cralQuote.anno, schema.cralQuote.socioId],
      set: {
        ...(patch.modo !== undefined ? { modo: patch.modo } : {}),
        ...(patch.mesi !== undefined ? { mesi: patch.mesi } : {}),
        ...(patch.pagataIl !== undefined ? { pagataIl: patch.pagataIl } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
        updatedBy: userId, updatedAt: ora,
      },
    }).returning()
    return r ? toQuota(r) : null
  }

  /** Segna pagata la rata di `mese` (1–12) per i soci indicati: modalità trattenuta. */
  async registraTrattenuta(anno: number, mese: number, soci: string[], userId: string | null): Promise<number> {
    if (!soci.length) return 0
    return this.db.transaction(async tx => {
      const vuoto = Array<boolean>(12).fill(false)
      await tx.insert(schema.cralQuote).values(soci.map(s => ({ anno, socioId: s, modo: 'TRATTENUTA', mesi: vuoto, updatedBy: userId })))
        .onConflictDoNothing()
      const r = await tx.update(schema.cralQuote)
        .set({ mesi: sql`array_cat(array_cat(mesi[1:${mese - 1}], ARRAY[true]), mesi[${mese + 1}:12])`, updatedBy: userId, updatedAt: new Date() })
        .where(and(eq(schema.cralQuote.anno, anno), inArray(schema.cralQuote.socioId, soci), eq(schema.cralQuote.modo, 'TRATTENUTA')))
        .returning({ s: schema.cralQuote.socioId })
      return r.length
    })
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
    legami: legami.map(l => ({ socio: l.socioId, relazione: l.relazione as 'CONIUGE' | 'FIGLIO' })),
    storicoTessere: storico.map(t => ({ tessera: t.tessera, dal: t.dal, al: t.al })),
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
  return { modo: r.modo as CralQuotaRow['modo'], mesi: r.mesi, pagataIl: r.pagataIl, note: r.note }
}
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
