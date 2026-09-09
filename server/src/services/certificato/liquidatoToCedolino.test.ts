import { test } from 'node:test'
import assert from 'node:assert/strict'
import { liquidatoToCedolino, MAPPA_VERIFICATA } from './liquidatoToCedolino.js'
import type { LiquidatoVoce } from '../verificaLiquidato/types.js'
import type { AnagraficaCedolino } from '../cedolino/types.js'

const V = (o: Partial<LiquidatoVoce>): LiquidatoVoce => ({
  flVoce: true, anno: '2026', mese: '07', oggetto: '000000', progrLiquidazione: '087',
  comparto: '1', ruolo: 'ND', matricola: '000000', capitolo: '000100', flagc: '0',
  dataComp: '2026-07-01', voce: '00000', progrVoce: '00', dataCompVoce: '2026-07-31',
  aliquota: 0, parti: 0, importo: 0, importoTotale: 0, giaLiquidato: 0, divisa: 'E',
  ente: '000000', riferimento: null, idCompenso: 0, idContrattoCsa: 0, ...o,
})

const anagrafica: AnagraficaCedolino = {
  periodo_retribuzione: 'LUGLIO 2026', matricola: '000000', cognome: 'ROSSI', nome: 'MARIO',
  codice_fiscale: null, data_nascita: null, luogo_nascita: null, inquadramento: null,
  area_profilo: null, ruolo: 'ND', inizio_rapporto: null, anzianita_servizio: null,
  afferenza: null, sede: null,
}

test('adapter: competenze fisse verificate + IRPEF in fiscali, riuso computeCertificato', () => {
  const dettaglio = [
    V({ voce: '00010', importoTotale: 1332.12 }),  // STIPENDIO
    V({ voce: '01251', importoTotale: 531.05 }),   // IIS
    V({ voce: '00265', importoTotale: 18.63 }),    // IVC + perequativo
    V({ voce: '10266', importoTotale: 6.45 }),     // Differenziale indiv. IIS
    V({ voce: '00961', importoTotale: 416.54, aliquota: 23 }), // IRPEF
    V({ voce: '04050', importoTotale: 1482.21 }),  // non mappata → esclusa
    V({ voce: '00901', importoTotale: 179.37, flVoce: false }), // derivata → esclusa
  ]
  const ced = liquidatoToCedolino(dettaglio, { anagrafica, mese: '07', mappa: MAPPA_VERIFICATA })

  // teoriche = 4 competenze fisse, lordo = loro somma
  assert.equal(ced.voci_teoriche.length, 4)
  const lordo = 1332.12 + 531.05 + 18.63 + 6.45
  assert.equal(ced.certificato.lordo_teorico, Math.round(lordo * 100) / 100)
  // IRPEF classificata tra le fiscali correnti
  assert.equal(ced.certificato.ritenute_fiscali, 416.54)
  assert.equal(ced.voci_dettaglio.length, 5)
})
