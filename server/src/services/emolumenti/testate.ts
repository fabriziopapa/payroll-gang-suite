// ============================================================
// PAYROLL GANG SUITE — Conto per matricola dalle testate CSA
//
// Logica PURA: entra l'elenco delle testate gia' normalizzate (matricola,
// progressivo, nazione), esce una risposta per matricola. Nessuna chiamata,
// nessun database: si testa accanto (testate.test.ts).
//
// Serve al pulsante "Verifica conti da CSA" della lavorazione Emolumenti e
// servira', uguale, alla funzione Tipi conto.
//
// LE REGOLE (decise dall'autore il 2026-09-23):
//   1. progressivo '000' = compenso NON liquidato: non classifica nessuno;
//   2. chi compare SOLO fra le '000' non sparisce: da chiarire, "senza coordinata";
//   3. piu' testate liquidate della stessa matricola si fondono;
//   4. nazioni diverse fra le liquidate -> da chiarire, "coordinate discordanti"
//      (non si sceglie la prima: e' l'errore del dedupMap che decideva a caso);
//   5. liquidata senza nazione -> da chiarire, "nazione assente";
//      anche se un'altra testata della stessa matricola una nazione ce l'ha;
//   6. progressivo mancante o malformato -> da chiarire, "progressivo assente";
//   7. altrimenti l'area la da' lib/areaConto.ts, mai un elenco ricopiato.
// ============================================================

import { areaConto, type AreaConto } from '../../lib/areaConto.js'

/**
 * Di una testata CSA sopravvivono TRE campi, e nient'altro.
 * La risposta completa contiene IBAN, intestazioni, ABI/CAB, codici INPS:
 * si usa qui, dentro normalizzaTestate, e si butta. Non va in tabella, non
 * va nei log, non va nei messaggi d'errore, non va al client.
 */
export interface TestataNorm {
  /** Sei cifre, con gli zeri davanti. */
  matricola:         string
  /** Progressivo della liquidazione ('000' = compenso non liquidato), o null. */
  progrLiquidazione: string | null
  /** Paese dell'IBAN su cui CSA ha pagato: due lettere o null. Mai l'IBAN. */
  nazIban:           string | null
}

/**
 * NORMALIZZAZIONE IMMEDIATA. E' il punto in cui un domani qualcuno
 * aggiungera' un console.log "di comodo" sulla risposta grezza: NON FARLO.
 * Da qui in poi il resto della testata non esiste piu'.
 */
export function normalizzaTestate(body: unknown): TestataNorm[] | null {
  // null = formato inatteso: chi chiama lo trasforma in errore SENZA
  // riportare il corpo, che potrebbe contenere dati bancari.
  if (!Array.isArray(body)) return null
  const out: TestataNorm[] = []
  for (const t of body as Array<Record<string, unknown>>) {
    const m = t?.['matricola']
    const mat = typeof m === 'number' ? String(m) : typeof m === 'string' ? m.trim() : ''
    if (!/^\d{1,6}$/.test(mat)) continue
    const p = t['progrLiquidazione']
    const progr = typeof p === 'number' ? String(p).padStart(3, '0')
                : typeof p === 'string' && p.trim() !== '' ? p.trim() : null
    const n = t['nazIban']
    const naz = typeof n === 'string' && /^[A-Za-z]{2}$/.test(n.trim()) ? n.trim().toUpperCase() : null
    out.push({ matricola: mat.padStart(6, '0'), progrLiquidazione: progr, nazIban: naz })
  }
  return out
}

export type MotivoDaChiarire =
  | 'senza coordinata'
  | 'coordinate discordanti'
  | 'nazione assente'
  | 'progressivo assente'

export interface ContoDaCsa {
  matricola:   string
  /** Nazione su cui CSA ha pagato, null se da chiarire. */
  nazIban:     string | null
  /** Area calcolata dalla nazione, null se da chiarire. */
  area:        Exclude<AreaConto, 'NON_NOTO'> | null
  /** Valorizzato solo quando nazIban/area sono null. */
  motivo:      MotivoDaChiarire | null
  /** Progressivi visti, ordinati: '001,039'. Traccia della fusione. */
  progressivi: string
}

export interface EsitoTestate {
  conti:          ContoDaCsa[]
  testateLette:   number
  testateLiquide: number
}

const PROGRESSIVO = /^\d{3}$/

export function contiDaTestate(testate: ReadonlyArray<TestataNorm>): EsitoTestate {
  const perMatricola = new Map<string, TestataNorm[]>()
  for (const t of testate) {
    const l = perMatricola.get(t.matricola) ?? []
    l.push(t)
    perMatricola.set(t.matricola, l)
  }

  const conti: ContoDaCsa[] = []
  let testateLiquide = 0

  for (const [matricola, tutte] of [...perMatricola].sort(([a], [b]) => a.localeCompare(b))) {
    const progressivi = [...new Set(tutte.map(t => t.progrLiquidazione ?? '?'))].sort().join(',')
    const malformate  = tutte.filter(t => t.progrLiquidazione === null || !PROGRESSIVO.test(t.progrLiquidazione))
    const liquidate   = tutte.filter(t => t.progrLiquidazione !== null
                                       && PROGRESSIVO.test(t.progrLiquidazione)
                                       && t.progrLiquidazione !== '000')
    testateLiquide += liquidate.length

    const daChiarire = (motivo: MotivoDaChiarire): ContoDaCsa =>
      ({ matricola, nazIban: null, area: null, motivo, progressivi })

    if (malformate.length > 0)      { conti.push(daChiarire('progressivo assente')); continue }
    if (liquidate.length === 0)     { conti.push(daChiarire('senza coordinata'));    continue }
    if (liquidate.some(t => t.nazIban === null)) { conti.push(daChiarire('nazione assente')); continue }

    const nazioni = new Set(liquidate.map(t => t.nazIban as string))
    if (nazioni.size > 1)           { conti.push(daChiarire('coordinate discordanti')); continue }

    const naz  = [...nazioni][0]!
    const area = areaConto(naz)
    // Una nazione di due lettere non puo' dare NON_NOTO; il controllo tiene
    // il tipo onesto senza un cast.
    if (area === 'NON_NOTO')        { conti.push(daChiarire('nazione assente')); continue }
    conti.push({ matricola, nazIban: naz, area, motivo: null, progressivi })
  }

  return { conti, testateLette: testate.length, testateLiquide }
}
