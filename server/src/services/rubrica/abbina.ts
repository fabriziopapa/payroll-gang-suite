// ============================================================
// PAYROLL GANG SUITE — Rubrica d'Ateneo · abbinamento a una persona
//
// Regola pura, senza I/O. In quest'ordine:
//   1. idAb  — l'anagrafica PGS ha lo stesso idAb della rubrica (verificato
//              l'11/11/2026 su tre matricole): e' la strada sicura;
//   2. codice fiscale — solo se l'idAb manca o non e' in rubrica; il CF
//              arriva dal server e non esce di qui;
//   3. cognome e nome — senza accenti, apostrofi, maiuscole e ordine delle
//              parole: una persona sola = trovata, piu' persone = candidati
//              da scegliere a mano (mai indovinare).
// ============================================================

import type { PersonaRubrica } from './rubricaAteneo.js'

export type Come = 'idAb' | 'codice fiscale' | 'nome'
export type Abbinamento =
  | { esito: 'TROVATA'; persona: PersonaRubrica; come: Come }
  | { esito: 'CANDIDATI'; candidati: PersonaRubrica[] }
  | { esito: 'NON_TROVATA' }

/** «D'Arco Anna Rita» e «ANNA RITA DARCO» → stessa chiave. */
export function chiaveNome(...parti: Array<string | null | undefined>): string {
  return parti.join(' ').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/['’`]/g, '').replace(/[^A-Z]+/g, ' ').trim().split(' ').filter(Boolean).sort().join(' ')
}

export function abbina(elenco: readonly PersonaRubrica[], chi: { idAb?: number | null; codFisc?: string | null; cognome?: string | null; nome?: string | null }): Abbinamento {
  if (chi.idAb) {
    const p = elenco.find(x => x.idAb === chi.idAb)
    if (p) return { esito: 'TROVATA', persona: p, come: 'idAb' }
  }
  const cf = (chi.codFisc ?? '').trim().toUpperCase()
  if (/^[A-Z0-9]{16}$/.test(cf)) {
    const ps = elenco.filter(x => x.codFisc === cf)
    if (ps.length === 1) return { esito: 'TROVATA', persona: ps[0]!, come: 'codice fiscale' }
  }
  const k = chiaveNome(chi.cognome, chi.nome)
  if (!k || !(chi.cognome ?? '').trim()) return { esito: 'NON_TROVATA' }
  const ps = elenco.filter(x => chiaveNome(x.cognome, x.nome) === k)
  if (ps.length === 1) return { esito: 'TROVATA', persona: ps[0]!, come: 'nome' }
  if (ps.length > 1) return { esito: 'CANDIDATI', candidati: ps.slice(0, 8) }
  return { esito: 'NON_TROVATA' }
}
