// Test adapter aggregati → CedolinoParsed. DATI SINTETICI (nessun dato reale).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { liquidatoAggregatiToCedolino } from './liquidatoAggregatiToCedolino.js'
import { computeRiassunto } from '../cedolino/calculator.js'
import type { LiquidatoVoce } from '../verificaLiquidato/types.js'
import type { AnagraficaCedolino } from '../cedolino/types.js'

function riga(p: Partial<LiquidatoVoce> & { voce: string; importoTotale: number }): LiquidatoVoce {
  return {
    flVoce: true, anno: '2099', mese: '01', oggetto: '000000', progrLiquidazione: '001',
    comparto: '1', ruolo: 'ND', matricola: '000000', capitolo: '000100', flagc: '0',
    dataComp: '2099-01-01', progrVoce: '00', dataCompVoce: '2099-01-31', aliquota: 0,
    parti: 0, importo: 0, giaLiquidato: 0, divisa: 'E', ente: '000000', riferimento: null,
    idCompenso: 0, idContrattoCsa: 0, ...p,
  }
}

const anag: AnagraficaCedolino = {
  periodo_retribuzione: 'GENNAIO 2099', matricola: '000000', cognome: 'ROSSI', nome: 'MARIO',
  codice_fiscale: null, data_nascita: null, luogo_nascita: null, inquadramento: null,
  area_profilo: null, ruolo: 'ND', inizio_rapporto: null, anzianita_servizio: null,
  afferenza: null, sede: null,
}

test('adapter: certificato coerente e tabella di verifica che torna', () => {
  const dettaglio: LiquidatoVoce[] = [
    // competenze (sommano al lordo 1000)
    riga({ voce: '00010', importoTotale: 800 }),
    riga({ voce: '01251', importoTotale: 200 }),
    // aggregati
    riga({ voce: '01096', importoTotale: 1000 }),
    riga({ voce: '00991', importoTotale: 100 }),
    riga({ voce: '00816', importoTotale: 10 }),   // addizionale regionale → fiscali
    riga({ voce: '00990', importoTotale: 200 }),
    riga({ voce: '01323', importoTotale: 50 }),    // Abb.TFR → previdenziali
    riga({ voce: '00994', importoTotale: 80 }),
    riga({ voce: '00850', importoTotale: 80 }),    // dettaglio extra (= 00994)
    riga({ voce: '03003', importoTotale: 560 }),   // netto: 1000 -110 -250 -80
  ]
  const { parsed, quadratura } = liquidatoAggregatiToCedolino(dettaglio, { anagrafica: anag })
  const cert = parsed.certificato
  assert.equal(cert.lordo_teorico, 1000)
  assert.equal(cert.ritenute_fiscali, 110)          // 100 + 10 addizionale
  assert.equal(cert.ritenute_previdenziali, 250)    // 200 + 50 Abb.TFR
  assert.equal(cert.extraerariali_totale, 80)
  assert.equal(cert.netto_ritenute_legge, 640)      // 1000 - 110 - 250
  assert.equal(cert.netto_a_pagare, 560)
  assert.equal(quadratura, true)

  // La tabella di verifica ricalcola da voci/riepilogo: deve dare gli stessi numeri.
  const gruppi = computeRiassunto(parsed.voci_teoriche, parsed.voci_dettaglio, parsed.riepilogo_cedolino)
  assert.ok(gruppi.length > 0)
  const nettoLegge = gruppi.flatMap(g => g.righe).find(r => r.voce.toLowerCase().includes('netto ritenute'))
  assert.equal(nettoLegge?.certificato, 640)

  // Il lordo è la somma delle teoriche mostrate nella RETRIBUZIONE.
  const somma = parsed.voci_teoriche.reduce((a, t) => a + (t.valore ?? 0), 0)
  assert.equal(Math.round(somma * 100) / 100, 1000)
})

test('PINO maggio (dati reali anonimizzati per struttura): addizionali inglobate, netto 1243.52', () => {
  // Sottoinsieme rappresentativo del payload reale 000311 maggio 2026.
  const C100 = { capitolo: '000100', flagc: '0' } as const
  const C103 = { capitolo: '000103', flagc: '0' } as const
  const dettaglio: LiquidatoVoce[] = [
    // capitolo 000100 flagc 0 — aggregati + competenze + extra
    riga({ ...C100, voce: '01096', importoTotale: 2221.38 }),
    riga({ ...C100, voce: '00990', importoTotale: 247.68 }),
    riga({ ...C100, voce: '00991', importoTotale: 212.59 }),
    riga({ ...C100, voce: '00994', importoTotale: 403.59 }),
    riga({ ...C100, voce: '03003', importoTotale: 1357.52 }),
    riga({ ...C100, voce: '00010', importoTotale: 1332.12 }),
    riga({ ...C100, voce: '01251', importoTotale: 531.05 }),
    riga({ ...C100, voce: '10265', importoTotale: 333.13 }),
    riga({ ...C100, voce: '10266', importoTotale: 6.45 }),
    riga({ ...C100, voce: '00265', importoTotale: 18.63 }),
    riga({ ...C100, voce: '14386', importoTotale: 14.59 }),
    riga({ ...C100, voce: '04891', importoTotale: 120, riferimento: 'DF@31/12/2027@' }),
    riga({ ...C100, voce: '00854', importoTotale: 5 }),
    riga({ ...C100, voce: '00850', importoTotale: 264, riferimento: 'DF@31/10/2030@' }),
    // capitolo 000103 flagc 0 — addizionali (inglobate) + netto negativo
    riga({ ...C103, voce: '00816', importoTotale: 86 }),
    riga({ ...C103, voce: '01797', importoTotale: 19 }),
    riga({ ...C103, voce: '02787', importoTotale: 9 }),
    riga({ ...C103, voce: '03003', importoTotale: -114 }),
    // RUMORE da escludere: doppione competenze su 001277 + arretrati (flagc 1)
    riga({ capitolo: '001277', flagc: '0', voce: '00010', importoTotale: 1332.12 }),
    riga({ capitolo: '002296', flagc: '1', voce: '03003', importoTotale: 67.56 }),
    riga({ capitolo: '000204', flagc: '1', voce: '03003', importoTotale: 220.91 }),
  ]
  const { parsed, quadratura } = liquidatoAggregatiToCedolino(dettaglio, { anagrafica: anag })
  const c = parsed.certificato
  assert.equal(c.lordo_teorico, 2221.38)              // 01096, non raddoppiato da 001277
  assert.equal(c.ritenute_fiscali, 326.59)            // 212.59 + addizionali 114
  assert.equal(c.ritenute_previdenziali, 247.68)
  assert.equal(c.extraerariali_totale, 403.59)
  assert.equal(c.netto_ritenute_legge, 1647.11)
  assert.equal(c.netto_a_pagare, 1243.52)             // = ufficio DOCX
  assert.equal(quadratura, true)                       // 1357.52 − 114 = 1243.52
  // RETRIBUZIONE: competenze sommano al lordo, nessuna riga "Altre competenze".
  const somma = parsed.voci_teoriche.reduce((a, t) => a + (t.valore ?? 0), 0)
  assert.equal(Math.round(somma * 100) / 100, 2221.38)
  assert.equal(parsed.voci_teoriche.some(t => /altre competenze/i.test(t.descrizione)), false)
})

test('PINO luglio: run conguaglio 087 sullo stesso 000100/flagc0 NON raddoppia le competenze', () => {
  const R7  = { progrLiquidazione: '007', capitolo: '000100', flagc: '0' } as const  // ordinaria
  const R7b = { progrLiquidazione: '007', capitolo: '000103', flagc: '0' } as const  // addizionali
  const R87 = { progrLiquidazione: '087', capitolo: '000100', flagc: '0' } as const  // CONGUAGLIO (da escludere)
  const dettaglio: LiquidatoVoce[] = [
    // run ordinaria 007 su 000100
    riga({ ...R7, voce: '01096', importoTotale: 2221.38 }),
    riga({ ...R7, voce: '00990', importoTotale: 247.68 }),
    riga({ ...R7, voce: '00991', importoTotale: 216.43 }),
    riga({ ...R7, voce: '00994', importoTotale: 403.59 }),
    riga({ ...R7, voce: '03003', importoTotale: 1353.68 }),
    riga({ ...R7, voce: '00010', importoTotale: 1332.12 }),
    riga({ ...R7, voce: '01251', importoTotale: 531.05 }),
    riga({ ...R7, voce: '10265', importoTotale: 333.13 }),
    riga({ ...R7, voce: '10266', importoTotale: 6.45 }),
    riga({ ...R7, voce: '00265', importoTotale: 18.63 }),
    // addizionali run 007 su 000103
    riga({ ...R7b, voce: '00816', importoTotale: 86 }),
    riga({ ...R7b, voce: '01797', importoTotale: 19 }),
    riga({ ...R7b, voce: '02787', importoTotale: 9 }),
    riga({ ...R7b, voce: '03003', importoTotale: -114 }),
    // CONGUAGLIO run 087 sullo STESSO 000100/flagc0 → deve essere ESCLUSO
    riga({ ...R87, voce: '01096', importoTotale: 68.19 }),
    riga({ ...R87, voce: '00010', importoTotale: 1418.94 }),
    riga({ ...R87, voce: '03003', importoTotale: 59.46 }),
    riga({ ...R87, voce: '00991', importoTotale: 38.62 }),
  ]
  const { parsed, quadratura } = liquidatoAggregatiToCedolino(dettaglio, { anagrafica: anag })
  const c = parsed.certificato
  assert.equal(c.lordo_teorico, 2221.38)         // solo run 007, non 2289.57
  assert.equal(c.ritenute_fiscali, 330.43)       // 216.43 + 114
  assert.equal(c.ritenute_previdenziali, 247.68)
  assert.equal(c.extraerariali_totale, 403.59)
  assert.equal(c.netto_a_pagare, 1239.68)        // 1353.68 − 114
  assert.equal(quadratura, true)
  // Stipendio 1332.12 una sola volta (non 2751.06); competenze = lordo, no "Altre competenze".
  const somma = parsed.voci_teoriche.reduce((a, t) => a + (t.valore ?? 0), 0)
  assert.equal(Math.round(somma * 100) / 100, 2221.38)
  assert.equal(parsed.voci_teoriche.some(t => /altre competenze/i.test(t.descrizione)), false)
})
