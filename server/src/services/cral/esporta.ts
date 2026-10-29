// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · export dei soci in Excel
//
// Stesse colonne del tracciato T6 (aggiornamento dati): il file esportato
// si corregge in Excel e si reimporta cosi' com'e', con l'anteprima
// prima → dopo. Due fogli: Soci (soci dipendenti, soci esterni, esterni)
// e Familiari, legati al socio per ID. Date in gg/mm/aaaa come testo,
// cosi' Excel non le cambia di fuso o di formato.
// ============================================================

import * as XLSX from 'xlsx'
import type { CralSedeRow, CralSocioRow } from '../../db/IRepository.js'

export const TIPOLOGIA_TESTO: Record<CralSocioRow['tipo'], string> = { SD: 'Socio dipendente', SE: 'Socio esterno', EST: 'Esterno', FAM: 'Familiare' }
export const STATO_TESTO: Record<CralSocioRow['stato'], string> = { ATTIVO: 'Attivo', DA_VALIDARE: 'Da validare', RIFIUTATO: 'Rifiutato', CESSATO: 'Cessato', ELIMINATO: 'Eliminato' }
export const COLONNE_T6 = ['ID', 'Ex matricola', 'Tipologia', 'Stato', 'Data stato', 'Cognome', 'Nome', 'Data di nascita', 'Email', 'Sede', 'Sede (nome)', 'Tessera', 'Iscritto il', 'Note'] as const

const gma = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')

export function foglioSoci(soci: CralSocioRow[], familiari: CralSocioRow[], sedi: CralSedeRow[]): Buffer {
  const nomeSede = new Map(sedi.map(s => [s.id, s.nome]))
  const ord = (a: CralSocioRow, b: CralSocioRow) => `${a.cognome} ${a.nome}`.localeCompare(`${b.cognome} ${b.nome}`, 'it')
  const dataStato = (s: CralSocioRow) => gma(s.stato === 'ELIMINATO' ? s.eliminatoIl : s.stato === 'CESSATO' ? s.cessatoIl : null)
  const righe = [...soci].sort(ord).map(s => [
    s.id, s.exMatricola ?? '', TIPOLOGIA_TESTO[s.tipo], STATO_TESTO[s.stato], dataStato(s), s.cognome, s.nome, gma(s.nascita), s.email,
    s.sede ?? '', s.sede ? nomeSede.get(s.sede) ?? '' : '', s.tessera, gma(s.iscrittoIl), s.note,
  ])
  const fam = [...familiari].sort(ord).map(s => [
    s.id, s.legami.map(l => l.socio).join(', '), s.legami.map(l => (l.relazione === 'CONIUGE' ? 'Coniuge' : 'Figlio/Figlia')).join(', '),
    STATO_TESTO[s.stato], dataStato(s), s.cognome, s.nome, gma(s.nascita), s.email, s.sede ?? '', s.sede ? nomeSede.get(s.sede) ?? '' : '', s.note,
  ])
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([[...COLONNE_T6], ...righe])
  ws['!cols'] = [10, 10, 16, 11, 11, 20, 18, 12, 26, 7, 30, 10, 11, 30].map(wch => ({ wch }))
  XLSX.utils.book_append_sheet(wb, ws, 'Soci')
  const wf = XLSX.utils.aoa_to_sheet([['ID', 'Familiare di', 'Relazione', 'Stato', 'Data stato', 'Cognome', 'Nome', 'Data di nascita', 'Email', 'Sede', 'Sede (nome)', 'Note'], ...fam])
  wf['!cols'] = [10, 18, 16, 11, 11, 20, 18, 12, 26, 7, 30, 30].map(wch => ({ wch }))
  XLSX.utils.book_append_sheet(wb, wf, 'Familiari')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
