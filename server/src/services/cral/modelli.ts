// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · modelli Excel dei tracciati (26.11.11.1)
//
// Un modello per ogni importazione (T1–T7): il primo foglio ha le sole
// intestazioni, scritte come l'import le riconosce da solo, e le celle in
// formato testo (cosi' Excel non cambia numeri di telefono, tessere e
// date); il foglio «Esempio» mostra due o tre righe compilate, di fantasia.
// I modelli degli eventi sono costruiti sull'evento: le opzioni (T2), una
// colonna per prodotto (T3), una per settimana (T5). A richiesta arrivano
// gia' con una riga per partecipante (ID e nominativo): si completa e si
// ricarica, l'aggancio e' per ID.
// Gli import leggono il PRIMO foglio: quelli in piu' non danno fastidio.
// ============================================================

import * as XLSX from 'xlsx'
import type { CralIniziativaRow, CralSocioRow, CralStato } from '../../db/IRepository.js'
import { COLONNE_T6, COLONNE_T7 } from './esporta.js'

export const TRACCIATI_MODELLO = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T7V'] as const
export type TracciatoModello = typeof TRACCIATI_MODELLO[number]
/** Tracciati che vogliono un evento, e con quale modalita'. */
export const MODALITA_MODELLO: Partial<Record<TracciatoModello, CralIniziativaRow['modalita'][]>> = { T2: ['SCELTA'], T3: ['ORDINE'], T5: ['TURNI'] }

interface Foglio { nome: string; intest: string[]; righe: string[][] }
export interface Modello { file: string; fogli: Foglio[]; persone: number }

const RIGHE_VUOTE = 400
const nominativo = (s: CralSocioRow) => `${s.cognome} ${s.nome}`.trim()
const perNome = (a: CralSocioRow, b: CralSocioRow) => nominativo(a).localeCompare(nominativo(b), 'it')
const slug = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

interface Config { opzioni?: Array<{ id: string; etichetta: string }>; prodotti?: Array<{ id: string; tipologia: string; nome: string; unita: string; max: number | null }>; periodi?: Array<{ id: string; nome: string; dal: string; al: string }> }

/**
 * `persone`: chi mettere gia' nel modello (solo T2, T3, T5), una riga a testa.
 * `anno`: per il T7. Nomi e numeri degli esempi sono di fantasia.
 */
export function costruisciModello(t: TracciatoModello, st: Pick<CralStato, 'tipologie' | 'sedi'>, ini: CralIniziativaRow | null, persone: CralSocioRow[], anno: number): Modello {
  const cfg = (ini?.config ?? {}) as Config
  const CHIAVI = ['ID', 'Telefono', 'Email', 'Nominativo']
  const conPersone = persone.length > 0
  // con le persone: ID e nominativo ci sono gia', telefono ed email non servono
  const chiavi = conPersone ? ['ID', 'Nominativo'] : CHIAVI
  const vuote = (n: number) => Array<string>(n).fill('')
  const righePersone = (n: number) => [...persone].sort(perNome).map(s => [s.id, nominativo(s), ...vuote(n)])
  const es = (id: string, tel: string, email: string, nom: string, resto: string[]) => (conPersone ? [id || '090123', nom || 'ROSSI Maria', ...resto] : [id, tel, email, nom, ...resto])
  const evento = ini ? `_${slug(ini.titolo)}` : ''
  const fine = (sigla: string, foglio: string, intest: string[], righe: string[][], esempi: string[][], altri: Foglio[] = []): Modello => ({
    file: `CRAL_${sigla}_modello${evento}${conPersone ? '_con-partecipanti' : ''}.xlsx`, persone: righe.length,
    fogli: [{ nome: foglio, intest, righe }, { nome: 'Esempio', intest, righe: esempi }, ...altri],
  })

  if (t === 'T1') {
    const h = ['NOMINATIVO', 'DATA NASCITA', 'N.ISCR.SOCIO', 'ESTERNI', 'MATRICOLA', 'SEDE DI CONSEGNA', 'EMAIL', 'TELEFONO']
    return fine('T1', 'LIBRO SOCI', h, [], [
      ['ROSSI MARIA', '07/03/1958', '2', '', '', 'Sede di Via Acton', 'maria.rossi@ateneo.example', '333 123 4567'],
      ['D\'ANGELO MARCO', '', '240', 'ESTERNO', '', '', '', ''],
      ['BIANCHI GIULIA', '12/05/1961', '', '', '090123', '', '', ''],
    ])
  }
  if (t === 'T6') {
    const h = [...COLONNE_T6]
    const r = (v: Record<string, string>) => h.map(c => v[c] ?? '')
    return fine('T6', 'Soci', h, [], [
      r({ ID: '090123', Email: 'maria.rossi@ateneo.example', Sede: st.sedi[0]?.id ?? 'ACT', Telefono: '333 123 4567', 'Consenso telefono': 'Sì', 'Data consenso': '03/11/2026', 'Origine consenso': 'Modulo cartaceo', WhatsApp: 'Sì', 'Consenso dati alimentari': 'Sì', 'Esigenze alimentari': 'Vegano', Allergie: 'arachidi' }),
      r({ ID: 'EXT-0004', Stato: 'Cessato', 'Data stato': '31/12/2026', 'Consenso telefono': 'Revocato', 'Data revoca': '10/11/2026' }),
      r({ Cognome: 'FERRARI', Nome: 'MATTEO', 'Data di nascita': '02/02/1975', Sede: '-', Note: 'senza ID: aggancio per nominativo e data di nascita; «-» svuota la sede' }),
    ])
  }
  if (t === 'T7') {
    const h = COLONNE_T7.filter(c => c !== 'Versato' && c !== 'Saldo')
    const r = (v: Record<string, string>) => h.map(c => v[c] ?? '')
    return { ...fine('T7', `Quote ${anno}`, h, [], [
      r({ ID: '090123', Anno: String(anno), 'Modalità': 'Trattenuta in busta paga', Gen: '5', Feb: '5', Mar: '4,50' }),
      r({ ID: 'EXT-0004', Anno: String(anno), 'Modalità': 'Unica soluzione', Unica: '60,00', 'Pagata il': `15/02/${anno}` }),
      r({ Cognome: 'FERRARI', Nome: 'MATTEO', 'Data di nascita': '02/02/1975', Anno: String(anno), Apr: 'X', Note: 'X = la rata intera' }),
    ]), file: `CRAL_T7_modello_${anno}.xlsx` }
  }
  if (t === 'T7V') {
    const h = ['MATRICOLA', 'NOMINATIVO', 'ANNO', 'MESE', 'IMPORTO', 'DATA VERSAMENTO']
    return { ...fine('T7', 'Versamenti', h, [], [
      ['090123', '', String(anno), '1', '5,00', `27/01/${anno}`], ['090123', '', String(anno), '2', '5,00', `27/02/${anno}`], ['', 'BIANCHI GIULIA', String(anno), 'UNICA', '60,00', `15/02/${anno}`],
    ]), file: `CRAL_T7_modello_per-versamento_${anno}.xlsx` }
  }
  if (t === 'T4') {
    return fine('T4', 'Partecipanti', CHIAVI, [], [['090123', '', '', ''], ['', '333 123 4567', '', ''], ['', '', 'giulia.bianchi@ateneo.example', ''], ['', '347 765 4321', '', 'VERDI Carla']])
  }
  if (t === 'T2') {
    const opz = cfg.opzioni ?? []
    const o = (k: number) => opz[k % Math.max(1, opz.length)]?.etichetta ?? 'Opzione'
    return fine('T2', 'Risposte', [...chiavi, 'Scelta'], righePersone(1),
      [es('090123', '', '', '', [o(0)]), es('', '333 123 4567', '', '', [o(1)]), es('', '', 'giulia.bianchi@ateneo.example', 'BIANCHI Giulia', [o(0)])],
      [{ nome: 'Opzioni', intest: ['Scelte ammesse: copia il testo nella colonna «Scelta»'], righe: opz.map(x => [x.etichetta]) }])
  }
  if (t === 'T3') {
    const tip = new Map(st.tipologie.map(x => [x.id, x.nome]))
    const prod = cfg.prodotti ?? []
    // «Tipologia - Prodotto»: l'intestazione che l'import riconosce
    const col = prod.map(p => `${tip.get(p.tipologia) ?? p.tipologia} - ${p.nome}`)
    const q = (k: number) => prod.map((p, j) => (j === k % Math.max(1, prod.length) ? (p.unita === 'kg' ? '1,5' : '2') : ''))
    return fine('T3', 'Ordini', [...chiavi, ...col, 'PAGATO', 'NOTE'], righePersone(col.length + 2),
      [es('090123', '', '', '', [...q(0), 'SI', '']), es('', '333 123 4567', '', '', [...q(1), '', '']), es('', '', '', 'ROSSI Carla', [...q(0), '', 'ritira il collega'])],
      [{ nome: 'Prodotti', intest: ['Colonna', 'Quantità', 'Massimo a testa'], righe: prod.map((p, j) => [col[j]!, p.unita === 'kg' ? 'in kg, anche con la virgola' : 'numero intero', p.max ? String(p.max) : '']) }])
  }
  // T5
  const per = cfg.periodi ?? []
  const x = (...quali: number[]) => per.map((_, j) => (quali.includes(j) ? 'X' : ''))
  const gma = (d: string) => d.split('-').reverse().join('/')
  const testa = conPersone ? ['ID', 'Nominativo', 'Riferimento'] : [...CHIAVI, 'Riferimento']
  const righe = [...persone].sort(perNome).map(s => [s.id, nominativo(s), '', ...vuote(per.length + 2)])
  const e5 = (id: string, tel: string, nom: string, rif: string, resto: string[]) => (conPersone ? [id || 'FAM-0002', nom || 'FERRARI Matteo', rif, ...resto] : [id, tel, '', nom, rif, ...resto])
  return fine('T5', 'Iscrizioni', [...testa, ...per.map(p => p.nome), 'Versato', 'Note'], righe,
    [e5('FAM-0002', '', '', '', [...x(0, 1), '180,00', '']), e5('', '333 123 4567', 'COLOMBO Nicolò', '', [...x(0, per.length - 1), '', conPersone ? 'prima e ultima settimana' : 'col telefono del genitore']), e5('', '', 'ROSSI Chiara', '090123', [...x(0), '', 'figlia di dipendente non socio'])],
    [{ nome: 'Settimane', intest: ['Colonna', 'Dal', 'Al'], righe: per.map(p => [p.nome, gma(p.dal), gma(p.al)]) }])
}

/** Tutte le celle sono testo; nel primo foglio anche quelle ancora vuote, cosi' quello che si scrive resta com'e'. */
export function scriviModello(m: Modello): Buffer {
  const wb = XLSX.utils.book_new()
  m.fogli.forEach((f, k) => {
    // una cella vuota ma di tipo testo: e' il modo in cui il formato «testo» arriva anche dove non c'e' ancora nulla
    const cella = (v: string) => ({ t: 's', v, z: '@' })
    const aoa: unknown[][] = [f.intest.map(cella), ...f.righe.map(r => f.intest.map((_, j) => cella(r[j] ?? '')))]
    if (k === 0) for (let i = f.righe.length; i < RIGHE_VUOTE; i++) aoa.push(f.intest.map(() => cella('')))
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = f.intest.map((h, j) => ({ wch: Math.min(48, Math.max(10, h.length + 2, ...f.righe.slice(0, 200).map(r => (r[j] ?? '').length + 2))) }))
    XLSX.utils.book_append_sheet(wb, ws, f.nome.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31))
  })
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
