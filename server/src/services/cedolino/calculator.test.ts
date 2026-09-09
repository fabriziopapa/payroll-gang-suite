// ============================================================
// Test ricalcolo certificato — campione A (anonimizzato), Mag 2026.
// Banco di prova §3.2: ogni divergenza al centesimo = bug.
// Run: npm run test --workspace=server
// ============================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeCertificato } from './calculator.js'
import type { VoceTeorica, VoceDettaglio, RiepilogoCedolino } from './types.js'

// Fixture anonimizzata: struttura da cedolino reale, nessun dato identificativo
const TEORICHE: VoceTeorica[] = [
  { descrizione: 'Stipendio classe iniziale',          valore: 1332.12, totale: false },
  { descrizione: 'IIS conglobata',                     valore: 531.05,  totale: false },
  { descrizione: 'Differenziale indiv. stipendio',     valore: 333.13,  totale: false },
  { descrizione: 'Differenziale indiv. IIS conglobata', valore: 6.45,   totale: false },
  { descrizione: 'TOTALE',                             valore: 2202.75, totale: true  },
]

const v = (
  sezione: VoceDettaglio['sezione'],
  descrizione: string,
  valore: number,
  arretrato = false,
  conguaglio = false,
  scadenza: string | null = null,
): VoceDettaglio => ({
  sezione, descrizione, valore, numeri_riga: [valore],
  arretrato, conguaglio, scadenza, decorrenza: null,
})

const VOCI: VoceDettaglio[] = [
  v('retribuzioni', 'Retribuzione complessiva 30', 2202.75),
  v('retribuzioni', 'Ind. Vacanza Contrattuale 30', 18.63),
  v('accessorie',   'Indennità accessoria mensile', 111.0, true),
  v('accessorie',   'Lavoro straordinario 22,5', 362.93, true),
  v('contributi',   'Ritenuta Tesoro', 195.48),
  v('contributi',   'Previdenziali CD Ritenuta Tesoro', 41.71, true),
  v('contributi',   'Ritenuta Opera Previden.', 44.43),
  v('contributi',   'Ritenuta Fondo Credito', 7.77),
  v('contributi',   'Ritenuta Fondo Credito', 1.66, true),
  v('fiscali_correnti', 'Ritenute IRPeF I scaglione', 453.95),
  v('fiscali_correnti', 'Tratt.fisc. aliq. mass. (c.a.)', 142.09, true),
  v('fiscali_correnti', 'Detrazioni art.13 c.1 T.U.I.R', -156.43),
  v('fiscali_correnti', 'Ulteriore detrazione L.207/2024', -84.93),
  v('fiscali_conguaglio', 'Cong. addiz. regionale', 86.0, false, true, '30/11/2026'),
  v('fiscali_conguaglio', 'Cong. addiz. comunale', 19.0, false, true, '30/11/2026'),
  v('fiscali_conguaglio', 'Acconto addizionale comunale', 9.0, false, true, '30/11/2026'),
  v('sindacali',    'Trattenuta sindacale', 14.59),
  v('altre_ritenute', 'Quota C.R.A.L. 1', 5.0),
  v('altre_ritenute', 'Cessione V stipendio 1', 264.0, false, false, '31/10/2030'),
  v('altre_ritenute', 'Rimborso prestito (circ.1/Rgs 2011) 1', 120.0, false, false, '31/12/2027'),
]

const RIEPILOGO: RiepilogoCedolino = {
  retribuzioni: 2221.38, accessorie: 473.93, abbattimenti: null, contributi: 291.05,
  fiscali_totali: 468.68, altre_ritenute: 403.59, netto_cedolino: 1531.99,
}

test('campione A — valori al centesimo (§3.2)', () => {
  const c = computeCertificato(TEORICHE, VOCI, RIEPILOGO)
  assert.equal(c.lordo_teorico,          2221.38)
  assert.equal(c.ritenute_fiscali,       326.59)
  assert.equal(c.ritenute_previdenziali, 247.68)
  assert.equal(c.netto_ritenute_legge,   1647.11)
  assert.equal(c.extraerariali_totale,   403.59)
  assert.equal(c.netto_a_pagare,         1243.52)
  assert.equal(c.quinto,                 329.42)
  assert.equal(c.settimo,                235.30)
})

test('extra-erariali — 4 righe (sindacale + CRAL + 2 cessioni)', () => {
  const c = computeCertificato(TEORICHE, VOCI, RIEPILOGO)
  assert.equal(c.extraerariali_righe.length, 4)
  assert.equal(c.extraerariali_righe[2]!.scadenza, '31/10/2030')
})

test('dinamicità — voce ANF assente non rompe; presente entra in altre_ritenute', () => {
  // ANF (Assegno Nucleo Familiare) come voce extra non hardcoded:
  // se compare in altre_ritenute deve sommarsi agli extra-erariali.
  const vociConAnf: VoceDettaglio[] = [
    ...VOCI,
    v('altre_ritenute', 'Quota ANF 1', 50.0),
  ]
  const c = computeCertificato(TEORICHE, vociConAnf, RIEPILOGO)
  // extra passa da 403.59 a 453.59
  assert.equal(c.extraerariali_totale, 453.59)
  // netto a pagare scende di 50: 1243.52 - 50 = 1193.52
  assert.equal(c.netto_a_pagare, 1193.52)
  assert.equal(c.extraerariali_righe.length, 5)
})

// ── Campione B (anonimizzato), Mag 2026 (ND con Abb.TFR) ───────────────────
// Verifica regola Excel: Abb.TFR DPCM 20.12.99/L.335/95 inglobato nelle
// ritenute previdenziali del certificato.
const TEORICHE_TFR: VoceTeorica[] = [
  { descrizione: 'Stipendio classe iniziale', valore: 1247.82, totale: false },
  { descrizione: 'IIS conglobata',            valore: 527.75,  totale: false },
  { descrizione: 'TOTALE',                    valore: 1775.57, totale: true  },
]

const VOCI_TFR: VoceDettaglio[] = [
  v('retribuzioni', 'Retribuzione complessiva 30', 1775.57),
  v('retribuzioni', 'Ind. Vacanza Contrattuale 30', 17.76),
  v('accessorie',   'Indennità accessoria mensile', 102.0, true),
  v('accessorie',   'Lavoro straordinario 17,5', 257.95, true),
  v('abbattimenti', 'Abb.TFR Dpcm . . L./', 35.87),
  v('contributi',   'Ritenuta Tesoro', 157.81),
  v('contributi',   'Ritenuta Tesoro', 31.68, true),
  v('contributi',   'Ritenuta Fondo Credito', 6.28),
  v('contributi',   'Ritenuta Fondo Credito', 1.26, true),
  v('fiscali_correnti', 'Ritenute IRPeF I scaglione', 366.48),
  v('fiscali_correnti', 'Tratt.fisc. aliq. mass. (c.a.)', 75.21, true),
  v('fiscali_correnti', 'Detrazioni art.13 c.1 T.U.I.R', -198.37),
  v('fiscali_correnti', 'Ulteriore detrazione L.207/2024', -84.93),
  v('fiscali_conguaglio', 'Cong. addiz. regionale', 29.0, false, true, '30/11/2026'),
  v('fiscali_conguaglio', 'Cong. addiz. comunale', 14.0, false, true, '30/11/2026'),
  v('fiscali_conguaglio', 'Acconto addizionale comunale', 5.0, false, true, '30/11/2026'),
  v('altre_ritenute', 'Quota C.R.A.L. 1', 5.0),
  v('altre_ritenute', 'Trattenute per abbonamento bus/treno', 25.0, false, false, '28/02/2027'),
]

const RIEPILOGO_TFR: RiepilogoCedolino = {
  retribuzioni: 1793.33, accessorie: 359.95, abbattimenti: 35.87, contributi: 197.03,
  fiscali_totali: 206.39, altre_ritenute: 30.0, netto_cedolino: 1683.99,
}

test('campione B — Abb.TFR inglobato nelle previdenziali (Excel ufficio)', () => {
  const c = computeCertificato(TEORICHE_TFR, VOCI_TFR, RIEPILOGO_TFR)
  assert.equal(c.lordo_teorico,          1793.33)
  assert.equal(c.ritenute_fiscali,        131.18) // 83,18 correnti + 48 addizionali
  assert.equal(c.ritenute_previdenziali,  199.96) // 164,09 contributi + 35,87 Abb.TFR
  assert.equal(c.netto_ritenute_legge,   1462.19)
  assert.equal(c.extraerariali_totale,     30.00)
  assert.equal(c.netto_a_pagare,         1432.19)
  assert.equal(c.quinto,                  292.44)
  assert.equal(c.settimo,                 208.88)
})

test('campione B — riassunto verifica: gruppi e inglobamenti', async () => {
  const { computeRiassunto } = await import('./calculator.js')
  const g = computeRiassunto(TEORICHE_TFR, VOCI_TFR, RIEPILOGO_TFR)
  const byTitolo = Object.fromEntries(g.map(x => [x.titolo, x.righe]))

  const legge = byTitolo['RITENUTE DI LEGGE']!
  const prev  = legge.find(r => r.voce.startsWith('Ritenute previdenziali'))!
  assert.equal(prev.cedolino, 164.09)
  assert.equal(prev.certificato, 199.96)
  const tfr = legge.find(r => r.voce.startsWith('Abb. T.F.R.'))!
  assert.equal(tfr.cedolino, 35.87)
  assert.equal(tfr.certificato, 0)

  // addizionali esposte a cedolino ma inglobate (0) nel certificato
  assert.equal(byTitolo['ADDIZIONALI']!.length, 3)
  assert.ok(byTitolo['ADDIZIONALI']!.every(r => r.certificato === 0))

  assert.equal(byTitolo['NETTO A PAGARE']![0]!.certificato, 1432.19)
})

test('senza abbattimenti il calcolo resta invariato (campione A)', () => {
  // Il campione A non ha Abb.TFR: la nuova sezione non deve alterare i valori storici.
  const c = computeCertificato(TEORICHE, VOCI, RIEPILOGO)
  assert.equal(c.ritenute_previdenziali, 247.68)
})

test('debiti vari esclusi dagli extra-erariali', () => {
  const vociConDebiti: VoceDettaglio[] = [
    ...VOCI,
    v('altre_ritenute', 'Debiti vari 1', 99.0),
  ]
  const c = computeCertificato(TEORICHE, vociConDebiti, RIEPILOGO)
  // "debiti vari" escluso → extra invariato
  assert.equal(c.extraerariali_totale, 403.59)
  assert.equal(c.netto_a_pagare, 1243.52)
})
