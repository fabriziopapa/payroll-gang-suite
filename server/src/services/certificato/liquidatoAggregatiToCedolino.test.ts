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
