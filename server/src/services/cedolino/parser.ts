// ============================================================
// PAYROLL GANG SUITE — Parser cedolini Cineca (TS)
// Riscrittura di cedolino_parser.py. Estrazione testo via pdfjs-dist
// (legacy build, Node) ricostruendo le righe per coordinate Y→X così da
// replicare il comportamento riga-per-riga di pdfplumber.extract_text().
//
// DINAMICO: nessun elenco fisso di voci. Le ancore di sezione del tracciato
// Cineca sono stabili; dentro ciascuna legge ogni riga-voce presente.
//
// PRIVACY (opzione A): NON estrae IBAN/banca né il nucleo familiare (CF figli).
// ============================================================

import { computeCertificato } from './calculator.js'
import type {
  CedolinoParsed,
  AnagraficaCedolino,
  VoceTeorica,
  VoceDettaglio,
  RiepilogoCedolino,
  SezioneCedolino,
} from './types.js'

// Numero italiano: 1.234,56 (con eventuale segno meno)
const NUM = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g

const SECTION_ANCHORS: Array<[string, SezioneCedolino]> = [
  ['Retribuzioni',        'retribuzioni'],
  ['Accessorie',          'accessorie'],
  ['Contributi',          'contributi'],
  ['Ritenute fiscali in', 'fiscali_correnti'],
  ['Ritenute fiscali da', 'fiscali_conguaglio'],
  ['Ritenute sindacali',  'sindacali'],
  ['Altre Ritenute',      'altre_ritenute'],
]
const END_DETTAGLIO = ['DATI PROGRESSIVI', 'ALIQUOTE E ALTRI', 'DATI ATTIVITA', 'DATI NUCLEO']

// Righe con numeri ma NON contabili (metadato / riepiloghi)
const NON_VOCE = /(Reddito stimato|Netto a pagare|Valore aliquota|Imponibile|Periodo retribuzione|Pagina \d)/i

// ── helpers numerici ─────────────────────────────────────────

/** "1.234,56" → 1234.56 ; null se non parsabile. */
export function toNum(s: string | null | undefined): number | null {
  if (s === null || s === undefined) return null
  const t = s.trim().replace(/\./g, '').replace(',', '.')
  if (t === '' || t === '-') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function allNums(line: string): number[] {
  const out: number[] = []
  for (const m of line.matchAll(NUM)) {
    const n = toNum(m[0])
    if (n !== null) out.push(n)
  }
  return out
}

const stripNums = (line: string): string => line.replace(NUM, '')

// ── estrazione testo PDF → righe ─────────────────────────────

/**
 * Estrae le righe di testo da un PDF ricostruendole per coordinate.
 * pdfjs restituisce frammenti (item) con transform[4]=x, transform[5]=y.
 * Raggruppiamo per Y (tolleranza) e ordiniamo per X per ottenere righe
 * leggibili come quelle prodotte da pdfplumber.
 */
export async function extractLines(buffer: Buffer): Promise<string[]> {
  // Import dinamico del legacy build (compatibile Node, niente DOM/worker)
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(buffer)
  // Opzioni anti-DOM per Node; alcune chiavi non sono nei tipi v6 → cast esplicito.
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  } as Parameters<typeof pdfjs.getDocument>[0])
  const doc = await loadingTask.promise

  const lines: string[] = []
  const Y_TOL = 2 // px: frammenti entro 2px sono sulla stessa riga

  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const tc = await page.getTextContent()

      // raccogli {x, y, str}
      const items = tc.items
        .filter((it: any) => typeof it.str === 'string')
        .map((it: any) => ({
          x: it.transform[4] as number,
          y: it.transform[5] as number,
          str: it.str as string,
        }))

      // raggruppa per Y (riga)
      const rows: Array<{ y: number; parts: Array<{ x: number; str: string }> }> = []
      for (const it of items) {
        let row = rows.find(r => Math.abs(r.y - it.y) <= Y_TOL)
        if (!row) { row = { y: it.y, parts: [] }; rows.push(row) }
        row.parts.push({ x: it.x, str: it.str })
      }

      // ordina righe top→bottom (Y decrescente), poi frammenti left→right
      rows.sort((a, b) => b.y - a.y)
      for (const r of rows) {
        r.parts.sort((a, b) => a.x - b.x)
        const text = r.parts.map(pt => pt.str).join(' ').replace(/\s+/g, ' ').trim()
        if (text) lines.push(text)
      }
    }
  } finally {
    await loadingTask.destroy()
  }
  return lines
}

// ── parsing header (anagrafica) — PRIVACY: no IBAN/banca ─────

function parseHeader(lines: string[]): AnagraficaCedolino {
  const full = lines.join('\n')
  const grab = (re: RegExp): string | null => {
    const m = full.match(re)
    return m && m[1] ? m[1].trim() : null
  }
  return {
    periodo_retribuzione: grab(/Periodo retribuzione:\s*([A-ZÀ-Ù]+\s+\d{4})/),
    matricola:            grab(/Matricola:\s*(\d+)/),
    cognome:              grab(/Cognome:\s*([A-ZÀ-Ù']+)/),
    nome:                 grab(/Nome:\s*([A-Za-zÀ-ù']+)/),
    codice_fiscale:       grab(/Codice fiscale:\s*([A-Z0-9]{16})/),
    data_nascita:         grab(/Data di nascita:\s*(\d{2}\/\d{2}\/\d{4})/),
    luogo_nascita:        grab(/Luogo di nascita:\s*([A-ZÀ-Ù\s']+\([A-Z]{2}\))/),
    inquadramento:        grab(/Inquadramento:\s*([^\n]+)/),
    area_profilo:         grab(/Area\/profilo:\s*([^\n]+?)(?:\s+Inquadramento:|$)/m),
    ruolo:                grab(/Ruolo:\s*(\S+)/),
    inizio_rapporto:      grab(/Inizio rapporto:\s*(\d{2}\/\d{2}\/\d{4})/),
    anzianita_servizio:   grab(/Anz\. Servizio:\s*([^\n]+?)(?:\s+Afferenza:|$)/m),
    afferenza:            grab(/Afferenza:\s*([^\n]+)/),
    sede:                 grab(/Sede:\s*([^\n]+)/),
  }
}

// ── voci teoriche ────────────────────────────────────────────

function parseTeoriche(lines: string[]): VoceTeorica[] {
  const out: VoceTeorica[] = []
  let inside = false
  for (const ln of lines) {
    if (ln.includes('DATI TEORICI STIPENDIO')) { inside = true; continue }
    if (inside && (ln.includes('DATI RIEPILOGATIVI') || ln.includes('DATI DI DETTAGLIO'))) break
    if (!inside) continue
    const nums = allNums(ln)
    const desc = stripNums(ln).replace(/\s+/g, ' ').trim()
    const low = desc.toLowerCase()
    if (nums.length && desc && low !== 'valore' && low !== 'valori tabellari') {
      out.push({
        descrizione: desc,
        valore: nums[nums.length - 1]!,
        totale: desc.toUpperCase().startsWith('TOTALE'),
      })
    }
  }
  return out
}

// ── dettaglio voci ───────────────────────────────────────────

function detectSection(line: string, current: SezioneCedolino | null): SezioneCedolino | null {
  for (const [anchor, key] of SECTION_ANCHORS) {
    if (line.startsWith(anchor)) return key
  }
  return current
}

function parseDettaglio(lines: string[]): VoceDettaglio[] {
  const voci: VoceDettaglio[] = []
  let inDett = false
  let sez: SezioneCedolino | null = null
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!
    if (ln.includes('DATI DI DETTAGLIO CEDOLINO')) { inDett = true; continue }
    if (!inDett) continue
    if (END_DETTAGLIO.some(e => ln.includes(e))) break
    if (NON_VOCE.test(ln)) continue
    sez = detectSection(ln, sez)
    const nums = allNums(ln)
    if (!nums.length) continue
    let desc = stripNums(ln).trim()
    for (const [anchor] of SECTION_ANCHORS) {
      if (desc.startsWith(anchor)) desc = desc.slice(anchor.length).trim()
    }
    desc = desc.replace(/\s+/g, ' ')
    if (!desc || desc.toUpperCase().startsWith('TOTALE')) continue
    const nxt = i + 1 < lines.length ? lines[i + 1]! : ''
    const ctx = ln + ' ' + nxt
    const scad = ctx.match(/Scadenza:\s*(\d{2}\/\d{2}\/\d{4})/)
    const deco = ctx.match(/[Dd]ecorrenza:\s*(\d{2}\/\d{2}\/\d{4})/)
    voci.push({
      sezione: sez,
      descrizione: desc,
      valore: nums[nums.length - 1]!,
      numeri_riga: nums,
      arretrato: ctx.includes('Arretrato'),
      conguaglio: ctx.includes('Conguaglio') || ln.includes('Cong.'),
      scadenza: scad ? scad[1]! : null,
      decorrenza: deco ? deco[1]! : null,
    })
  }
  return voci
}

// ── riepilogo cedolino ───────────────────────────────────────

function parseRiepilogo(lines: string[]): RiepilogoCedolino {
  const full = lines.join('\n')
  const N = NUM.source
  const grab = (re: RegExp): number | null => {
    const m = full.match(re)
    return m && m[1] ? toNum(m[1]) : null
  }
  return {
    retribuzioni:   grab(new RegExp('Retribuzioni\\s+(' + N + ')')),
    accessorie:     grab(new RegExp('Accessorie\\s+(' + N + ')')),
    contributi:     grab(new RegExp('Contributi Assistenziali e Previdenziali CD\\s+[\\d.,]+\\s+(' + N + ')')),
    fiscali_totali: grab(new RegExp('Ritenute fiscali totali\\s+[\\d.,]+\\s+(' + N + ')')),
    altre_ritenute: grab(new RegExp('Altre ritenute\\s+[\\d.,]+\\s+(' + N + ')')),
    netto_cedolino: grab(new RegExp('Netto a pagare:\\s*(' + N + ')')),
  }
}

// ── orchestrazione ───────────────────────────────────────────

/** Parsa un cedolino (buffer PDF) → CedolinoParsed con certificato calcolato. */
export async function parseCedolino(buffer: Buffer): Promise<CedolinoParsed> {
  const lines = await extractLines(buffer)
  const teoriche = parseTeoriche(lines)
  const voci = parseDettaglio(lines)
  const riepilogo = parseRiepilogo(lines)
  const certificato = computeCertificato(teoriche, voci, riepilogo)
  return {
    anagrafica: parseHeader(lines),
    voci_teoriche: teoriche,
    voci_dettaglio: voci,
    riepilogo_cedolino: riepilogo,
    certificato,
  }
}
