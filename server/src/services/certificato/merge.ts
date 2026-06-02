// ============================================================
// PAYROLL GANG SUITE — Motore "stampa unione" certificato
// Porting di certificato_template.js. Risolve segnaposto {{path}} e tag
// genere [[m|f]], deduce il sesso dal CF, e prepara i dati derivati per il
// template. Le regole di matching/etichette vengono dal TEMPLATE (configurabili).
// ============================================================

import type { CedolinoParsed } from '../cedolino/types.js'
import type { CertificatoTemplate, CertificatoMeta } from './types.js'

// SEC: chiavi vietate nella risoluzione path — evita traversal sulla catena
// prototype (__proto__/prototype/constructor) da segnaposto o `src` malevoli.
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

/** Risolve un path puntato (es. "anagrafica.cognome") con blocklist prototype
 *  e accesso solo a proprietà proprie (own). Ritorna undefined su chiave non valida. */
export function getByPath(root: unknown, path: string): unknown {
  let cur: unknown = root
  for (const k of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    if (FORBIDDEN_KEYS.has(k)) return undefined
    if (!Object.prototype.hasOwnProperty.call(cur, k)) return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

/** Sesso dedotto dal codice fiscale: giorno di nascita > 40 ⇒ femmina. */
export function sessoFromCF(cf: string | null | undefined): 'M' | 'F' {
  if (!cf || cf.length < 11) return 'M'
  const giorno = parseInt(cf.substring(9, 11), 10)
  return giorno > 40 ? 'F' : 'M'
}

/**
 * Risolve tag genere [[formaM|formaF]] e segnaposto {{path.to.field}}
 * dentro una stringa, leggendo i valori dal contesto `data`.
 */
export function resolve(text: string, data: Record<string, unknown>, sesso: 'M' | 'F'): string {
  // 1) genere: [[m|f]]
  let out = text.replace(/\[\[([^|\]]*)\|([^\]]*)\]\]/g, (_, m, f) => (sesso === 'F' ? f : m))
  // 2) segnaposto: {{path}} — risolto con blocklist prototype (getByPath)
  out = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = getByPath(data, key)
    return v == null ? '' : String(v)
  })
  return out
}

/** Formatta importo come "€ 1.234,56" (negativo: "€ -1.234,56"). */
export function eur(n: number | null | undefined): string {
  if (n == null) return ''
  const neg = n < 0
  const [int, dec] = Math.abs(n).toFixed(2).split('.')
  const withSep = int!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return '€ ' + (neg ? '-' : '') + withSep + ',' + dec
}

/** "MAGGIO 2026" → "Maggio 2026". */
export function meseAnnoCapitalize(periodo: string | null | undefined): string {
  if (!periodo) return ''
  return periodo.replace(/\S+/g, w =>
    /^\d+$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase())
}

/** Pulisce l'etichetta extra-erariale trascinata dal PDF. */
function cleanLabel(s: string): string {
  return s
    .replace(/\s+\d+$/, '')        // "Quota C.R.A.L. 1" → "Quota C.R.A.L."
    .replace(/\s+stipendio$/i, '') // "Cessione V stipendio" → "Cessione V"
    .replace(/circ\.1/i, 'circ. 1')
    .trim()
}

export interface PreparedContext {
  sesso: 'M' | 'F'
  /** mappa valori per la tabella emolumenti (keyword→valore teorico) */
  teo: Record<string, number | null>
  /** righe extra-erariali pronte per il rendering */
  extra: Array<{ voce: string; decorrenza: string; scadenza: string; importo: string }>
  /** dati piatti per resolve() dei segnaposto */
  flat: Record<string, unknown>
}

/**
 * Arricchisce l'output del parser coi campi derivati che il template usa.
 * Usa le regole CONFIGURABILI del template (matchTeoriche/inquadramentoMap/extraRename).
 */
export function prepareData(
  parsed: CedolinoParsed,
  meta: CertificatoMeta,
  tpl: CertificatoTemplate,
): PreparedContext {
  const sesso = meta.sesso ?? sessoFromCF(parsed.anagrafica.codice_fiscale)

  // Etichette anagrafica (regole dal template)
  const inq = parsed.anagrafica.inquadramento ?? ''
  parsed.anagrafica.inquadramento_label = tpl.inquadramentoMap[inq] ?? inq
  parsed.anagrafica.settore = (parsed.anagrafica.area_profilo ?? '').replace(/^Settore\s+/i, '')

  // Matching voci teoriche → campi template (CONFIGURABILE, fix #5)
  const teo: Record<string, number | null> = {}
  for (const t of parsed.voci_teoriche) {
    if (t.totale) continue
    const d = t.descrizione.toLowerCase()
    for (const rule of tpl.matchTeoriche) {
      if (rule.keywords.some(k => d.includes(k.toLowerCase()))) {
        if (teo[rule.field] == null) teo[rule.field] = t.valore
        break
      }
    }
  }
  // IVC può stare nel dettaglio retribuzioni
  if (teo.ivc == null) {
    const v = parsed.voci_dettaglio.find(
      x => x.sezione === 'retribuzioni' && /vacanza/i.test(x.descrizione))
    if (v) teo.ivc = v.valore
  }

  // Extra-erariali: etichette pulite + rename dal template
  const extra = parsed.certificato.extraerariali_righe.map(v => {
    const lbl = cleanLabel(v.descrizione)
    return {
      voce:       tpl.extraRename[lbl] ?? lbl,
      decorrenza: v.decorrenza ?? '',
      scadenza:   v.scadenza ?? '',
      importo:    eur(v.valore),
    }
  })

  const flat: Record<string, unknown> = {
    ...parsed,
    periodo_label:      meseAnnoCapitalize(parsed.anagrafica.periodo_retribuzione),
    netto_pagare_label: eur(parsed.certificato.netto_a_pagare),
    protocollo:         meta.protocollo,
    sigla_operatore:    meta.sigla_operatore,
    data_rilascio:      meta.data_rilascio,
    dirigente:          meta.dirigente,
  }

  return { sesso, teo, extra, flat }
}
