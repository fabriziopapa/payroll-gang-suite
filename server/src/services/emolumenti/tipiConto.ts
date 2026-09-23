// ============================================================
// PAYROLL GANG SUITE — Tipi conto: logica pura
//
// Dalle testate gia' ridotte a ContoDaCsa (testate.ts) alle righe da
// salvare, e dalle righe salvate al TXT per l'ufficio. Nessun accesso a
// database o rete: si prova da solo (tipiConto.test.ts).
// ============================================================

import { segmentoNomeFile } from '../../lib/areaConto.js'
import type { ContoDaCsa } from './testate.js'

export type TipoContoFile = 'IT' | 'SEPA' | 'EXTRA_UE'
export type TipoContoRigaTipo = TipoContoFile | 'DA_CHIARIRE'

export interface RigaCalcolata {
  matricola:   string
  nazIban:     string | null
  tipoConto:   TipoContoRigaTipo
  motivo:      string | null
  progressivi: string
}

/** Un conto letto da CSA diventa una riga: senza area = DA CHIARIRE. */
export function righeDaConti(conti: ReadonlyArray<ContoDaCsa>): RigaCalcolata[] {
  return conti.map(c => ({
    matricola:   c.matricola,
    nazIban:     c.area ? c.nazIban : null,
    tipoConto:   c.area ?? 'DA_CHIARIRE',
    motivo:      c.area ? null : c.motivo,
    // La colonna e' VARCHAR(40): un elenco piu' lungo si tronca con un segno
    // visibile, non fa fallire il salvataggio.
    progressivi: c.progressivi.length > 40 ? c.progressivi.slice(0, 39) + '…' : c.progressivi,
  }))
}

/** Ultimo giorno del mese, 'AAAA-MM-GG': la data con cui si classifica. */
export function ultimoGiornoMese(anno: number, mese: number): string {
  const g = new Date(Date.UTC(anno, mese, 0)).getUTCDate()
  return `${anno}-${String(mese).padStart(2, '0')}-${String(g).padStart(2, '0')}`
}

/**
 * Il TXT per l'ufficio: DR_MM_AA_TIPO.txt, una matricola per riga, in
 * ordine crescente, fine riga CRLF, nessuna intestazione. Il BOM non c'e':
 * lo aggiunge (o no) chi scrive i byte, e qui non lo aggiunge nessuno.
 * null se per quel tipo non c'e' nessuna matricola: un file vuoto non si
 * produce.
 */
export function fileTxt(
  elab: { ruolo: string; anno: number; mese: number },
  righe: ReadonlyArray<{ matricola: string; tipoConto: string }>,
  tipo: TipoContoFile,
): { nomeFile: string; contenuto: string; righe: number } | null {
  const matricole = [...new Set(righe.filter(r => r.tipoConto === tipo).map(r => r.matricola))].sort()
  if (matricole.length === 0) return null
  const mm = String(elab.mese).padStart(2, '0')
  const aa = String(elab.anno % 100).padStart(2, '0')
  return {
    nomeFile:  `${elab.ruolo}_${mm}_${aa}_${segmentoNomeFile(tipo)}.txt`,
    contenuto: matricole.join('\r\n') + '\r\n',
    righe:     matricole.length,
  }
}
