// ============================================================
// PAYROLL GANG SUITE — Rubrica d'Ateneo · trovare una persona e la sua email
//
// Usa solo le chiamate veloci del portale: il dettaglio per idAb (~0,4 s) e
// la ricerca per cognome (~0,6 s), mai l'elenco intero. Ordine e regole in
// abbina.ts. Restituisce SOLO dati pubblicabili: il codice fiscale serve
// all'abbinamento e si ferma qui.
// ============================================================

import { abbina, type Come } from './abbina.js'
import { pubblica, type PersonaPubblica, type Rubrica } from './rubricaAteneo.js'

export type EsitoRubrica =
  | { esito: 'TROVATA'; persona: PersonaPubblica & { email: string }; come: Come }
  | { esito: 'CANDIDATI'; candidati: Array<PersonaPubblica & { email: string }> }
  | { esito: 'NON_TROVATA' }

export async function trovaInRubrica(r: Rubrica, chi: { idAb?: number | null; codFisc?: string | null; cognome?: string | null; nome?: string | null }): Promise<EsitoRubrica> {
  if (chi.idAb) {
    const d = await r.dettaglio(chi.idAb)
    if (d) return { esito: 'TROVATA', persona: { ...pubblica(d.persona), email: d.email }, come: 'idAb' }
  }
  const cognome = (chi.cognome ?? '').trim()
  if (cognome.length < 2) return { esito: 'NON_TROVATA' }
  const a = abbina(await r.cerca(cognome), { codFisc: chi.codFisc ?? null, cognome, nome: chi.nome ?? '' })
  if (a.esito === 'TROVATA') return { esito: 'TROVATA', persona: { ...pubblica(a.persona), email: await r.email(a.persona.idAb) }, come: a.come }
  if (a.esito === 'CANDIDATI') {
    const candidati: Array<PersonaPubblica & { email: string }> = []
    for (const p of a.candidati) candidati.push({ ...pubblica(p), email: await r.email(p.idAb) })
    return { esito: 'CANDIDATI', candidati }
  }
  return { esito: 'NON_TROVATA' }
}
