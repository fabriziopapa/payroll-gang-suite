// ============================================================
// PAYROLL GANG SUITE — Versamenti enti · allegati CSV e PDF
//
// Ogni modello di messaggio porta la sua configurazione degli allegati:
// quali file, nomi, colonne (ordine e intestazioni), opzioni CSV e PDF.
// Il predefinito riproduce il Java (ente_<COD>.csv/.pdf, «nome;voce;
// importo») con in piu' la data di nascita e, se i mesi sono piu' di uno,
// il mese.
//
// Le chiavi delle colonne sono le stesse di server/src/lib/versamenti.ts.
// ============================================================

import { encodeWindows1252 } from './biz'
import type { RigaVersamento } from './versamentiCsv'
import { applica, contesto, fmtEuro, meseLabel, periodoBreve, periodoFile, type Contesto } from './versamentiModelli'

export type ChiaveColonna = 'NOME' | 'DATA_NASCITA' | 'MATRICOLA' | 'COD_FISC' | 'MESE' | 'VOCE' | 'IMPORTO'
/**
 * Colonne in piu' per l'esportazione dalla scheda Consultazione, dove un
 * file puo' contenere piu' enti. Non sono ammesse nei modelli mail (il
 * server le rifiuta): un allegato e' sempre di un ente solo.
 */
export type ChiaveEstesa = ChiaveColonna | 'ENTE' | 'DESCR_ENTE'

export interface ColonnaAllegato {
  k:          ChiaveEstesa
  csv:        string
  pdf:        string
  on:         boolean
  /** Solo MESE: la colonna c'e' solo se l'EML copre piu' di un mese. */
  soloMulti?: boolean
}

export interface AllegatiConfig {
  nomeEml:      string
  nomeAllegati: string
  /** 'ente' solo per l'esportazione dalla Consultazione (righe di piu' enti). */
  ordine:       'mese' | 'nome' | 'importo' | 'ente'
  csv: { attivo: boolean; sep: ';' | ',' | 'tab'; decimali: 'virgola' | 'punto'; codifica: 'w1252' | 'utf8bom'; intestazione: boolean }
  pdf: { attivo: boolean; titolo: string; orient: 'p' | 'l'; subtotali: boolean; totale: boolean }
  colonne:      ColonnaAllegato[]
}

const fmtData = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

export const COLDEF: Record<ChiaveEstesa, {
  nome: string; peso: number; num?: true; pii?: true
  csv: (r: RigaVersamento) => string; pdf?: (r: RigaVersamento) => string
}> = {
  NOME:         { nome: 'Nominativo',      peso: 3,   csv: r => r.nome },
  DATA_NASCITA: { nome: 'Data di nascita', peso: 1.3, csv: r => (r.nascita.ok ? fmtData(r.nascita.iso) : ''), pdf: r => (r.nascita.ok ? fmtData(r.nascita.iso) : '—') },
  MATRICOLA:    { nome: 'Matricola',       peso: 1.1, csv: r => r.matr },
  COD_FISC:     { nome: 'Codice fiscale',  peso: 2,   csv: r => r.cf, pii: true },
  MESE:         { nome: 'Mese',            peso: 1.4, csv: r => r.mese, pdf: r => meseLabel(r.mese) },
  VOCE:         { nome: 'Voce',            peso: 1,   csv: r => r.voce },
  IMPORTO:      { nome: 'Importo',         peso: 1.4, csv: () => '', num: true },
  ENTE:         { nome: 'Codice ente',     peso: 1,   csv: r => r.ente },
  DESCR_ENTE:   { nome: 'Ente',            peso: 2.6, csv: r => r.descr || r.ente },
}

export function allegatiDefault(): AllegatiConfig {
  return {
    nomeEml: 'email_{CODICE_ENTE}', nomeAllegati: 'ente_{CODICE_ENTE}', ordine: 'mese',
    csv: { attivo: true, sep: ';', decimali: 'virgola', codifica: 'w1252', intestazione: true },
    pdf: { attivo: true, titolo: "Dettagli per l'ente: {CODICE_ENTE}", orient: 'p', subtotali: true, totale: true },
    colonne: [
      { k: 'NOME',         csv: 'nome',         pdf: 'Nominativo',      on: true },
      { k: 'DATA_NASCITA', csv: 'data_nascita', pdf: 'Data di nascita', on: true },
      { k: 'MATRICOLA',    csv: 'matricola',    pdf: 'Matricola',       on: false },
      { k: 'COD_FISC',     csv: 'cod_fisc',     pdf: 'Codice fiscale',  on: false },
      { k: 'MESE',         csv: 'mese',         pdf: 'Mese',            on: true, soloMulti: true },
      { k: 'VOCE',         csv: 'voce',         pdf: 'Voce',            on: true },
      { k: 'IMPORTO',      csv: 'importo',      pdf: 'Importo',         on: true },
    ],
  }
}

/**
 * Un modello salvato prima che esistesse una colonna nuova non la perde:
 * le chiavi mancanti si aggiungono in coda, spente.
 */
export function completaAllegati(a: AllegatiConfig): AllegatiConfig {
  const def = allegatiDefault()
  const presenti = new Set(a.colonne.map(c => c.k))
  return { ...a, colonne: [...a.colonne, ...def.colonne.filter(c => !presenti.has(c.k)).map(c => ({ ...c, on: false }))] }
}

export const colonneAttive = (cfg: AllegatiConfig, multi: boolean) =>
  cfg.colonne.filter(c => c.on && COLDEF[c.k] && (!c.soloMulti || multi))

export function ordina(righe: readonly RigaVersamento[], ordine: AllegatiConfig['ordine'] = 'mese'): RigaVersamento[] {
  const cmp: Record<AllegatiConfig['ordine'], (a: RigaVersamento, b: RigaVersamento) => number> = {
    mese:    (a, b) => a.mese.localeCompare(b.mese) || a.nome.localeCompare(b.nome) || a.voce.localeCompare(b.voce),
    nome:    (a, b) => a.nome.localeCompare(b.nome) || a.mese.localeCompare(b.mese) || a.voce.localeCompare(b.voce),
    importo: (a, b) => b.cents - a.cents || a.nome.localeCompare(b.nome),
    ente:    (a, b) => (a.descr || a.ente).localeCompare(b.descr || b.ente) || a.ente.localeCompare(b.ente)
      || a.nome.localeCompare(b.nome) || a.mese.localeCompare(b.mese) || a.voce.localeCompare(b.voce),
  }
  return [...righe].sort(cmp[ordine] ?? cmp.mese)
}

/** Centesimi → '1234,56' (o '1234.56'), sempre due decimali, senza separatore delle migliaia. */
export function fmtImporto(cents: number, decimali: AllegatiConfig['csv']['decimali'] = 'virgola'): string {
  const a = Math.abs(cents)
  const s = `${cents < 0 ? '-' : ''}${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}`
  return decimali === 'punto' ? s.replace(',', '.') : s
}

export function csvTesto(righe: readonly RigaVersamento[], cfg: AllegatiConfig, multi: boolean): string {
  const sep = cfg.csv.sep === 'tab' ? '\t' : cfg.csv.sep
  const cols = colonneAttive(cfg, multi)
  const q = (v: string) => (v.includes(sep) || /["\r\n]/.test(v)) ? `"${v.replace(/"/g, '""')}"` : v
  // SEC (F-10, come biz.ts): un testo che inizia con = + - @ TAB o CR, aperto
  // in Excel dall'ente, diventerebbe una formula. L'apostrofo lo forza a
  // testo. Gli importi non passano di qui: i negativi restano numeri.
  const testo = (v: string) => q(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v)
  const out: string[] = []
  if (cfg.csv.intestazione) out.push(cols.map(c => testo(c.csv)).join(sep))
  for (const r of ordina(righe, cfg.ordine)) {
    out.push(cols.map(c => (COLDEF[c.k].num ? q(fmtImporto(r.cents, cfg.csv.decimali)) : testo(COLDEF[c.k].csv(r)))).join(sep))
  }
  return out.join('\r\n') + '\r\n'
}

export function csvBytes(righe: readonly RigaVersamento[], cfg: AllegatiConfig, multi: boolean): Uint8Array<ArrayBuffer> {
  const t = csvTesto(righe, cfg, multi)
  if (cfg.csv.codifica === 'utf8bom') {
    const u = new TextEncoder().encode(t)
    const b = new Uint8Array(new ArrayBuffer(u.length + 3))
    b.set([0xEF, 0xBB, 0xBF]); b.set(u, 3)
    return b
  }
  return encodeWindows1252(t)
}

export async function pdfBytes(
  codice: string, descr: string, righe: readonly RigaVersamento[], mesi: readonly string[], cfg: AllegatiConfig,
  periodo: readonly string[] = mesi,
): Promise<Uint8Array<ArrayBuffer>> {
  const { jsPDF } = await import('jspdf')
  const land = cfg.pdf.orient === 'l'
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: land ? 'landscape' : 'portrait' })
  const multi = mesi.length > 1
  const W = land ? 267 : 180, YMAX = land ? 195 : 282, X0 = 15
  const att = colonneAttive(cfg, multi)
  const somma = att.reduce((s, c) => s + COLDEF[c.k].peso, 0) || 1
  const cols = att.map(c => ({ k: c.k, t: c.pdf, w: W * COLDEF[c.k].peso / somma, destra: !!COLDEF[c.k].num }))
  const iImp = cols.findIndex(c => c.k === 'IMPORTO')
  const ctx = contesto(codice, descr, righe, periodo)
  const oggi = new Date().toLocaleDateString('it-IT')

  let y = 18
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14)
  doc.text(applica(cfg.pdf.titolo, ctx), X0, y); y += 6
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  doc.text(descr, X0, y); y += 5
  doc.setTextColor(90)
  doc.text(`Periodo: ${periodoBreve(periodo)}  ·  ${righe.length} righe  ·  generato il ${oggi}`, X0, y)
  doc.setTextColor(0); y += 8

  const testo = (t: string, x: number, w: number, destra: boolean) => {
    let s = t
    while (s && doc.getTextWidth(s) > w - 4) s = s.slice(0, -1)
    doc.text(s, destra ? x + w - 2 : x + 2, y, { align: destra ? 'right' : 'left' })
  }
  const intestazione = () => {
    doc.setFillColor(235, 238, 245); doc.rect(X0, y - 4.2, W, 6.2, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
    let x = X0
    for (const c of cols) { testo(c.t, x, c.w, c.destra); x += c.w }
    doc.setFont('helvetica', 'normal'); y += 6
  }
  const riga = (vals: string[], grassetto = false) => {
    if (y > YMAX) { doc.addPage(); y = 18; intestazione() }
    doc.setFont('helvetica', grassetto ? 'bold' : 'normal'); doc.setFontSize(9)
    let x = X0
    cols.forEach((c, i) => { testo(vals[i] ?? '', x, c.w, c.destra); x += c.w })
    doc.setDrawColor(225); doc.line(X0, y + 1.6, X0 + W, y + 1.6)
    y += 5.6
  }
  // L'etichetta di un totale occupa anche le colonne vuote che la seguono
  // fino all'importo: «Totale Unione Personale …» non si tronca nella
  // colonna stretta del codice ente.
  const rigaTotale = (etichetta: string, cents: number) => {
    if (iImp < 0 || !cols.length) return
    if (y > YMAX) { doc.addPage(); y = 18; intestazione() }
    const largo = cols.slice(0, iImp).reduce((s, c) => s + c.w, 0)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
    testo(etichetta, X0, largo, false)
    let x = X0; for (let i = 0; i < iImp; i++) x += cols[i]!.w
    testo(fmtEuro(cents), x, cols[iImp]!.w, true)
    doc.setDrawColor(225); doc.line(X0, y + 1.6, X0 + W, y + 1.6)
    y += 5.6
  }

  intestazione()
  // Subtotali: per mese negli allegati; per ente nell'esportazione di piu' enti.
  const perEnte = cfg.ordine === 'ente'
  const gruppo = (r: RigaVersamento) => (perEnte ? r.ente : r.mese)
  const etichetta = (r: RigaVersamento) => (perEnte ? r.descr || r.ente : meseLabel(r.mese))
  const subtotali = perEnte ? new Set(righe.map(r => r.ente)).size > 1 : multi && cfg.pdf.subtotali && cfg.ordine === 'mese'
  let corrente: string | null = null, nomeGruppo = '', sub = 0, tot = 0
  const chiudiMese = () => { if (subtotali && corrente) rigaTotale(`Totale ${nomeGruppo}`, sub) }
  for (const r of ordina(righe, cfg.ordine)) {
    if (subtotali && gruppo(r) !== corrente) { chiudiMese(); corrente = gruppo(r); nomeGruppo = etichetta(r); sub = 0 }
    sub += r.cents; tot += r.cents
    riga(cols.map(c => COLDEF[c.k].num ? fmtEuro(r.cents) : (COLDEF[c.k].pdf ?? COLDEF[c.k].csv)(r)))
  }
  chiudiMese()
  if (cfg.pdf.totale) { y += 1.5; rigaTotale('Totale', tot) }

  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120)
    doc.text(`Pagina ${i} di ${n}`, X0 + W, YMAX + 8, { align: 'right' }); doc.setTextColor(0)
  }
  return new Uint8Array(doc.output('arraybuffer'))
}

/**
 * Nome file da modello: segnaposto sostituiti, caratteri non sicuri a '_'.
 * Con «un EML per mese», se il nome non contiene {PERIODO_FILE} il periodo
 * si aggiunge in coda: dodici file con lo stesso nome non servono a nessuno.
 */
export function nomeFile(pattern: string, ctx: Contesto, estensione: string, perMese: boolean): string {
  let base = applica(pattern, ctx)
  if (perMese && !pattern.includes('{PERIODO_FILE}')) base += `_${ctx['PERIODO_FILE'] ?? ''}`
  const pulito = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  return `${pulito || 'file'}.${estensione}`
}

export interface Allegato {
  nome:     string
  bytes:    Uint8Array<ArrayBuffer>
  tipo:     string
  charset?: string
}

export async function allegatiPer(
  codice: string, descr: string, righe: readonly RigaVersamento[], mesi: readonly string[],
  cfg: AllegatiConfig, perMese: boolean, solo?: 'csv' | 'pdf', periodo: readonly string[] = mesi,
): Promise<Allegato[]> {
  const ctx = { CODICE_ENTE: codice, PERIODO_FILE: periodoFile(periodo) }
  const multi = mesi.length > 1
  const out: Allegato[] = []
  if (solo ? solo === 'csv' : cfg.csv.attivo) {
    out.push({
      nome: nomeFile(cfg.nomeAllegati, ctx, 'csv', perMese), bytes: csvBytes(righe, cfg, multi),
      tipo: 'text/csv', charset: cfg.csv.codifica === 'utf8bom' ? 'UTF-8' : 'windows-1252',
    })
  }
  if (solo ? solo === 'pdf' : cfg.pdf.attivo) {
    out.push({ nome: nomeFile(cfg.nomeAllegati, ctx, 'pdf', perMese), bytes: await pdfBytes(codice, descr, righe, mesi, cfg, periodo), tipo: 'application/pdf' })
  }
  return out
}
