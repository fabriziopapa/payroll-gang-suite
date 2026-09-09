// ============================================================
// PAYROLL GANG SUITE — Verifica liquidato: riconciliazione CINECA ↔ PGS
// Dal dettaglio "esploso" di CINECA ricostruisce le VOCI DI INPUT inviate
// da PGS e le abbina 1-a-1 con l'export CSV/bozza.
//
// Regole (validate su feb/mag/giu/lug 2026):
//  - CINECA è denormalizzato: 1 voce PGS -> 1 riga input + N derivate
//    (contributi/ritenute/stipendio base). Si tengono solo le voci input.
//  - Voce input = flVoce===true E ( riferimento con tag TL@/WD@/WE@
//    OPPURE voce ∈ vociTestoLibero ) — la voce TL può avere testo nudo.
//  - Competenza = dataCompVoce (NON anno/mese, che è il cedolino).
//  - Confronto valore: 'importo' -> importoTotale ; 'parti' -> [parti, importo unit].
//  - "Conguagliabile sempre": rettifiche automatiche CSA nettate ed escluse.
//  - riferimento normalizzato accent/encoding-safe (mojibake compreso).
// ============================================================

import type {
  LiquidatoVoce, RigaPGS, RigaRicostruita, Ricostruzione,
  RisultatoRiconciliazione, Abbinamento,
} from './types.js'

const TAG_RE = /^(TL|WD|WE)@(.*?)@*$/
const VOCI_PGS_TESTO_LIBERO = new Set<string>(['00070']) // straordinario TL testo nudo (oggi)
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/** Normalizza il riferimento: toglie il wrapper TL@..@ e neutralizza accenti/mojibake. */
export function normRiferimento(rif: string | null | undefined): string | null {
  if (rif == null) return null
  const m = String(rif).match(TAG_RE)
  let s = m ? m[2] : String(rif)
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') // à->a, mojibake Ã->A
  s = s.replace(/[^\x20-\x7e]/g, '')                     // scarta residui non-ASCII
  return s.replace(/\s+/g, ' ').trim().toUpperCase()
}

export function isVoceInputPGS(r: LiquidatoVoce, vociExtra: Set<string> = VOCI_PGS_TESTO_LIBERO): boolean {
  if (r.flVoce !== true) return false
  if (r.riferimento && TAG_RE.test(r.riferimento)) return true
  return vociExtra.has(r.voce)
}

function chiaveGruppo(r: LiquidatoVoce): string {
  return [r.matricola, r.voce, r.capitolo, r.dataCompVoce, normRiferimento(r.riferimento)].join('|')
}

export interface OpzioniRicostruzione { vociTestoLibero?: Set<string> }

export function ricostruisciInviiPGS(
  dettaglio: LiquidatoVoce[],
  opts: OpzioniRicostruzione = {},
): Ricostruzione {
  const vociExtra = opts.vociTestoLibero ?? VOCI_PGS_TESTO_LIBERO
  const input = dettaglio.filter((r) => isVoceInputPGS(r, vociExtra))

  const gruppi = new Map<string, LiquidatoVoce[]>()
  for (const r of input) {
    const k = chiaveGruppo(r)
    const arr = gruppi.get(k)
    if (arr) arr.push(r); else gruppi.set(k, [r])
  }

  const inviiPGS: RigaRicostruita[] = []
  const conguagli: RigaRicostruita[] = []
  const storni: RigaRicostruita[] = []
  const rettifiche: RigaRicostruita[] = []

  for (const [k, righe] of gruppi) {
    const nettoParti  = round2(righe.reduce((s, r) => s + (r.parti || 0), 0))
    const nettoTotale = round2(righe.reduce((s, r) => s + r.importoTotale, 0))
    const hasNeg = righe.some((r) => r.importoTotale < 0)
    const hasPos = righe.some((r) => r.importoTotale > 0)
    const perParti = righe.some((r) => r.parti !== 0)
    const first = righe[0]
    const base = {
      chiave: k, matricola: first.matricola, voce: first.voce, capitolo: first.capitolo,
      dataCompVoce: first.dataCompVoce, riferimento: first.riferimento,
      riferimentoNorm: normRiferimento(first.riferimento),
      modalita: (perParti ? 'parti' : 'importo') as 'parti' | 'importo',
      progrLiquidazione: first.progrLiquidazione, nRighe: righe.length,
    }

    if (hasNeg && !hasPos) {
      storni.push({ ...base, tipo: 'STORNO', valore: nettoTotale })
    } else if (hasNeg && hasPos && perParti && nettoParti === 0) {
      conguagli.push({ ...base, tipo: 'CONGUAGLIO_TARIFFA', valoreNetto: nettoTotale })
    } else if (hasNeg && hasPos && !perParti && Math.abs(nettoTotale) < 0.01) {
      rettifiche.push({ ...base, tipo: 'RETTIFICA_ANNULLO', valoreNetto: nettoTotale })
    } else if (hasNeg && hasPos) {
      rettifiche.push({ ...base, tipo: 'RETTIFICA', valoreNetto: nettoTotale })
    } else {
      const nuovo: RigaRicostruita = { ...base, tipo: 'NUOVO' }
      if (perParti) {
        const pos = righe.filter((r) => r.importoTotale > 0)
          .sort((a, b) => (b.progrVoce || '').localeCompare(a.progrVoce || ''))[0]
        nuovo.parti = round2(righe.reduce((s, r) => s + (r.parti > 0 ? r.parti : 0), 0))
        nuovo.importoUnitario = pos.importo
        nuovo.importoTotale = round2(nuovo.parti * pos.importo)
      } else {
        nuovo.importoTotale = nettoTotale
      }
      inviiPGS.push(nuovo)
    }
  }
  const ord = (a: RigaRicostruita, b: RigaRicostruita) =>
    a.matricola.localeCompare(b.matricola) || a.voce.localeCompare(b.voce) ||
    a.dataCompVoce.localeCompare(b.dataCompVoce)
  return {
    inviiPGS: inviiPGS.sort(ord), conguagli: conguagli.sort(ord),
    storni: storni.sort(ord), rettifiche: rettifiche.sort(ord),
  }
}

export function chiavePGS(p: RigaPGS): string {
  return [p.matricola, p.voce, p.capitolo, p.dataCompetenzaVoce, normRiferimento(p.riferimento)].join('|')
}

function valoreOk(p: RigaPGS, c: RigaRicostruita): boolean {
  return p.flagParti
    ? (round2(p.parti ?? 0) === round2(c.parti ?? NaN) && round2(p.importo) === round2(c.importoUnitario ?? NaN))
    : (round2(p.importo) === round2(c.importoTotale ?? NaN))
}

/**
 * Riconcilia il dettaglio CINECA con le righe PGS.
 * Value-aware: a parità di chiave sceglie il candidato col valore giusto e
 * segnala gli altri in `ambigui` invece di sommarli.
 */
export function riconcilia(
  dettaglioCineca: LiquidatoVoce[],
  righePGS: RigaPGS[],
  opts: OpzioniRicostruzione = {},
): RisultatoRiconciliazione {
  const rec = ricostruisciInviiPGS(dettaglioCineca, opts)
  const idx = new Map<string, Array<RigaRicostruita & { _usato?: boolean }>>()
  for (const c of rec.inviiPGS) {
    const arr = idx.get(c.chiave)
    if (arr) arr.push(c); else idx.set(c.chiave, [{ ...c }])
  }

  const abbinati: Abbinamento[] = []
  const soloPGS: RigaPGS[] = []
  const ambigui: (Abbinamento & { candidati: number })[] = []

  for (const p of righePGS) {
    const cand = (idx.get(chiavePGS(p)) ?? []).filter((c) => !c._usato)
    if (cand.length === 0) { soloPGS.push(p); continue }
    const scelto = cand.find((c) => valoreOk(p, c)) ?? cand[0]
    scelto._usato = true
    const ab: Abbinamento = { chiave: scelto.chiave, pgs: p, cineca: scelto, valoreOk: valoreOk(p, scelto) }
    abbinati.push(ab)
    if (cand.length > 1) ambigui.push({ ...ab, candidati: cand.length })
  }

  const soloCineca: RigaRicostruita[] = []
  for (const list of idx.values()) for (const c of list) if (!c._usato) soloCineca.push(c)

  return { ...rec, abbinati, soloPGS, soloCineca, ambigui }
}
