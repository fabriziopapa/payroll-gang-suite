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
import type { CralQuotaRow, CralSedeRow, CralSocioRow, CralStato } from '../../db/IRepository.js'
import { ORIGINI, contattabile, mostraTelefono, nomiEsigenze } from '../../lib/cralContatti.js'

export const TIPOLOGIA_TESTO: Record<CralSocioRow['tipo'], string> = { SD: 'Socio dipendente', SE: 'Socio esterno', EST: 'Esterno', FAM: 'Familiare' }
export const STATO_TESTO: Record<CralSocioRow['stato'], string> = { ATTIVO: 'Attivo', DA_VALIDARE: 'Da validare', RIFIUTATO: 'Rifiutato', CESSATO: 'Cessato', ELIMINATO: 'Eliminato' }
/** 0025: telefono, consensi, WhatsApp, dati alimentari: in coda al T6, si reimportano cosi' come sono. */
export const COLONNE_CONTATTI = ['Telefono', 'Consenso telefono', 'Data consenso', 'Origine consenso', 'Data revoca', 'WhatsApp', 'WA ID', 'Consenso dati alimentari', 'Esigenze alimentari', 'Allergie'] as const
const CONSENSO_TESTO = { SI: 'Sì', NO: 'No', REVOCATO: 'Revocato' } as const
const WA_TESTO = { SI: 'Sì', NO: 'No', NV: 'Non verificato' } as const
const origineTesto = (o: string | null) => ORIGINI.find(x => x.id === o)?.nome ?? ''
const celleContatti = (s: CralSocioRow) => {
  const c = s.contatti, a = s.alimentari
  return [c.telefono, c.telefono ? CONSENSO_TESTO[c.consenso] : '', gma(c.consensoIl), origineTesto(c.origine), gma(c.revocatoIl), c.telefono ? WA_TESTO[c.whatsapp] : '', c.waId,
    a.consenso ? 'Sì' : '', nomiEsigenze(a.esigenze), a.allergie]
}
export const COLONNE_T6 = ['ID', 'Ex matricola', 'Tipologia', 'Stato', 'Data stato', 'Cognome', 'Nome', 'Data di nascita', 'Email', 'Sede', 'Sede (nome)', 'Tessera', 'Iscritto il', 'Note', ...COLONNE_CONTATTI] as const

const gma = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')

export function foglioSoci(soci: CralSocioRow[], familiari: CralSocioRow[], sedi: CralSedeRow[]): Buffer {
  const nomeSede = new Map(sedi.map(s => [s.id, s.nome]))
  const ord = (a: CralSocioRow, b: CralSocioRow) => `${a.cognome} ${a.nome}`.localeCompare(`${b.cognome} ${b.nome}`, 'it')
  const dataStato = (s: CralSocioRow) => gma(s.stato === 'ELIMINATO' ? s.eliminatoIl : s.stato === 'CESSATO' ? s.cessatoIl : null)
  const righe = [...soci].sort(ord).map(s => [
    s.id, s.exMatricola ?? '', TIPOLOGIA_TESTO[s.tipo], STATO_TESTO[s.stato], dataStato(s), s.cognome, s.nome, gma(s.nascita), s.email,
    s.sede ?? '', s.sede ? nomeSede.get(s.sede) ?? '' : '', s.tessera, gma(s.iscrittoIl), s.note, ...celleContatti(s),
  ])
  const fam = [...familiari].sort(ord).map(s => [
    s.id, s.legami.map(l => l.socio).join(', '), s.legami.map(l => (l.relazione === 'CONIUGE' ? 'Coniuge' : 'Figlio/Figlia')).join(', '),
    STATO_TESTO[s.stato], dataStato(s), s.cognome, s.nome, gma(s.nascita), s.email, s.sede ?? '', s.sede ? nomeSede.get(s.sede) ?? '' : '', s.note, ...celleContatti(s),
  ])
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([[...COLONNE_T6], ...righe])
  const LC = [16, 10, 11, 16, 11, 14, 15, 10, 26, 30]
  ws['!cols'] = [10, 10, 16, 11, 11, 20, 18, 12, 26, 7, 30, 10, 11, 30, ...LC].map(wch => ({ wch }))
  XLSX.utils.book_append_sheet(wb, ws, 'Soci')
  const wf = XLSX.utils.aoa_to_sheet([['ID', 'Familiare di', 'Relazione', 'Stato', 'Data stato', 'Cognome', 'Nome', 'Data di nascita', 'Email', 'Sede', 'Sede (nome)', 'Note', ...COLONNE_CONTATTI], ...fam])
  wf['!cols'] = [10, 18, 16, 11, 11, 20, 18, 12, 26, 7, 30, 30, ...LC].map(wch => ({ wch }))
  XLSX.utils.book_append_sheet(wb, wf, 'Familiari')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

// ── Elenco a scelta (0025) ───────────────────────────────────
// Il catalogo delle colonne: chi esporta sceglie quali e in che ordine.
// `dato`: 'telefono' esce solo per chi ha dato il consenso (e non l'ha
// revocato); 'alimentari' esiste solo col consenso. Lo STESSO elenco di id
// e' nel client (components/cral/Esporta.tsx).
export interface ColonnaElenco {
  id: string; nome: string; larghezza: number; dato?: 'telefono' | 'alimentari'
  val: (s: CralSocioRow, c: { sede: Map<string, string>; persone: Map<string, CralSocioRow> }) => string
}
const tel = (f: (s: CralSocioRow) => string) => (s: CralSocioRow) => (contattabile(s.contatti) ? f(s) : '')
export const COLONNE_ELENCO: ColonnaElenco[] = [
  { id: 'id', nome: 'ID', larghezza: 10, val: s => s.id },
  { id: 'matricola', nome: 'Matricola', larghezza: 10, val: s => s.matricola ?? '' },
  { id: 'tessera', nome: 'Tessera', larghezza: 10, val: s => s.tessera },
  { id: 'tipologia', nome: 'Tipologia', larghezza: 16, val: s => TIPOLOGIA_TESTO[s.tipo] },
  { id: 'stato', nome: 'Stato', larghezza: 11, val: s => STATO_TESTO[s.stato] },
  { id: 'cognome', nome: 'Cognome', larghezza: 20, val: s => s.cognome },
  { id: 'nome', nome: 'Nome', larghezza: 18, val: s => s.nome },
  { id: 'nominativo', nome: 'Nominativo', larghezza: 30, val: s => `${s.cognome} ${s.nome}`.trim() },
  { id: 'nascita', nome: 'Data di nascita', larghezza: 12, val: s => gma(s.nascita) },
  { id: 'email', nome: 'Email', larghezza: 28, val: s => s.email },
  { id: 'sede', nome: 'Sede', larghezza: 7, val: s => s.sede ?? '' },
  { id: 'sedeNome', nome: 'Sede (nome)', larghezza: 30, val: (s, c) => (s.sede ? c.sede.get(s.sede) ?? '' : '') },
  { id: 'iscrittoIl', nome: 'Iscritto il', larghezza: 11, val: s => gma(s.iscrittoIl) },
  { id: 'familiareDi', nome: 'Familiare di', larghezza: 30, val: (s, c) => s.legami.map(l => { const p = c.persone.get(l.socio); return p ? `${p.cognome} ${p.nome}`.trim() : l.socio }).join(', ') },
  { id: 'note', nome: 'Note', larghezza: 30, val: s => s.note },
  { id: 'waId', nome: 'wa_id', larghezza: 15, dato: 'telefono', val: tel(s => s.contatti.waId) },
  { id: 'telefono', nome: 'Telefono', larghezza: 16, dato: 'telefono', val: tel(s => s.contatti.telefono) },
  { id: 'telefonoLeggibile', nome: 'Telefono (leggibile)', larghezza: 18, dato: 'telefono', val: tel(s => mostraTelefono(s.contatti.telefono)) },
  { id: 'whatsapp', nome: 'WhatsApp', larghezza: 14, dato: 'telefono', val: tel(s => WA_TESTO[s.contatti.whatsapp]) },
  { id: 'consensoIl', nome: 'Data consenso', larghezza: 12, dato: 'telefono', val: tel(s => gma(s.contatti.consensoIl)) },
  { id: 'consensoOrigine', nome: 'Origine consenso', larghezza: 16, dato: 'telefono', val: tel(s => origineTesto(s.contatti.origine)) },
  { id: 'esigenze', nome: 'Esigenze alimentari', larghezza: 28, dato: 'alimentari', val: s => nomiEsigenze(s.alimentari.esigenze) },
  { id: 'allergie', nome: 'Allergie', larghezza: 30, dato: 'alimentari', val: s => s.alimentari.allergie },
]

/** Anti formula-injection nei CSV/Excel: un testo che inizia per = + - @ diventa testo. Il «+» dei numeri di telefono resta. */
const sicuro = (v: string, eTelefono: boolean) => (/^[=\-@\t\r]/.test(v) || (!eTelefono && v.startsWith('+')) ? `'${v}` : v)

export function elencoSoci(soci: CralSocioRow[], colonne: ColonnaElenco[], st: Pick<CralStato, 'sedi' | 'soci'>, formato: 'xlsx' | 'csv', separatore: ';' | ',', titolo: string): Buffer {
  const c = { sede: new Map(st.sedi.map(x => [x.id, x.nome])), persone: new Map(st.soci.map(x => [x.id, x])) }
  const righe = [...soci].sort((a, b) => `${a.cognome} ${a.nome}`.localeCompare(`${b.cognome} ${b.nome}`, 'it'))
    .map(s => colonne.map(k => sicuro(k.val(s, c), k.id === 'telefono' || k.id === 'telefonoLeggibile')))
  if (formato === 'csv') {
    const cella = (v: string) => (/["\n\r]/.test(v) || v.includes(separatore) ? `"${v.replace(/"/g, '""')}"` : v)
    return Buffer.from('\uFEFF' + [colonne.map(k => k.nome), ...righe].map(r => r.map(cella).join(separatore)).join('\r\n') + '\r\n', 'utf8')
  }
  const wb = XLSX.utils.book_new()
  // tutto testo: i numeri di telefono e le tessere non devono diventare numeri
  const ws = XLSX.utils.aoa_to_sheet([colonne.map(k => k.nome), ...righe.map(r => r.map(v => ({ t: 's', v })))])
  ws['!cols'] = colonne.map(k => ({ wch: k.larghezza }))
  XLSX.utils.book_append_sheet(wb, ws, titolo.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Elenco')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

export const MESI_COLONNE = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'] as const
export const COLONNE_T7 = ['ID', 'Tessera', 'Cognome', 'Nome', 'Data di nascita', 'Anno', 'Modalità', ...MESI_COLONNE, 'Unica', 'Pagata il', 'Versato', 'Saldo', 'Note'] as const
const MODO_TESTO: Record<CralQuotaRow['modo'], string> = { UNICA: 'Unica soluzione', MENSILE: 'Mensile', TRATTENUTA: 'Trattenuta in busta paga' }

/**
 * Quote dell'anno nel formato del T7 (una riga per socio): gli importi in
 * euro come numeri, cosi' in Excel si sommano; «Versato» e «Saldo» sono
 * solo da leggere (all'import si ignorano).
 */
export function foglioQuote(anno: number, imp: number, righe: Array<{ s: CralSocioRow; q: CralQuotaRow }>): Buffer {
  const e = (c: number | null | undefined) => (c ? c / 100 : '')
  const dati = [...righe].sort((a, b) => `${a.s.cognome} ${a.s.nome}`.localeCompare(`${b.s.cognome} ${b.s.nome}`, 'it')).map(({ s, q }) => {
    const v = q.importi.reduce((a, x) => a + x, 0) + (q.versatoUnica ?? 0)
    return [s.id, s.tessera, s.cognome, s.nome, gma(s.nascita), anno, MODO_TESTO[q.modo], ...q.importi.map(e), e(q.versatoUnica), gma(q.pagataIl), v / 100, (imp - v) / 100, q.note]
  })
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([[...COLONNE_T7], ...dati])
  ws['!cols'] = [10, 9, 18, 16, 12, 6, 22, ...MESI_COLONNE.map(() => 7), 8, 11, 9, 9, 30].map(wch => ({ wch }))
  XLSX.utils.book_append_sheet(wb, ws, `Quote ${anno}`)
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
