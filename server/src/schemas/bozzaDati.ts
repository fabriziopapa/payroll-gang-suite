// ============================================================
// PAYROLL GANG SUITE — Schema Zod per BozzaDati (campo dati JSONB)
// Validazione strutturale server-side: blocca DoS, type mismatch,
// overflow stringhe. No .strict() — strip mode per compat legacy.
// ============================================================

import { z } from 'zod'

const ImportoBudgetItemSchema = z.object({
  id:          z.string().max(50),
  descrizione: z.string().max(500),
  importo:     z.number().finite(),
})

const NominativoSchema = z.object({
  id:              z.string().max(50),
  matricola:       z.string().max(20),
  cognomeNome:     z.string().max(200),
  codFisc:         z.string().max(20).optional(),
  ruolo:           z.string().max(20),
  druolo:          z.string().max(200),
  dettaglioId:     z.string().max(50),
  importoLordo:    z.number().finite(),
  origine:         z.enum(['pdf', 'manuale']),
  ruoloModificato: z.boolean().optional(),
  importoBudget:   z.array(ImportoBudgetItemSchema).max(100).optional(),
})

const DettaglioSchema = z.object({
  id:                          z.string().max(50),
  colore:                      z.string().max(20),
  nomeDescrittivo:             z.string().max(500),
  voce:                        z.string().max(20),
  capitolo:                    z.string().max(20),
  competenzaLiquidazione:      z.string().max(10),
  dataCompetenzaVoce:          z.string().max(10),
  flagScorporo:                z.boolean(),
  tipoScorporo:                z.enum(['standard', 'contoterzi']).optional(),
  riferimentoCedolino:         z.string().max(500),
  identificativoProvvedimento: z.string().max(20),
  tipoProvvedimento:           z.string().max(10),
  numeroProvvedimento:         z.string().max(20),
  dataProvvedimento:           z.string().max(10),
  aliquota:                    z.number().finite(),
  parti:                       z.number().finite(),
  flagAdempimenti:             z.number().finite(),
  idContrattoCSA:              z.string().max(50),
  centroCosto:                 z.string().max(50),
  note:                        z.string().max(2000),
  anagraficheOutdated:         z.boolean().optional(),
  modifiedBy:                  z.string().max(100).optional(),
})

const ComunicazioneSchema = z.object({
  id:          z.string().max(50),
  dettaglioId: z.string().max(50),
  stato:       z.enum(['bozza', 'validata']),
  destinatari: z.array(z.object({
    nome:  z.string().max(200),
    email: z.string().max(200),
  })).max(50),
  oggetto:       z.string().max(500),
  corpo:         z.string().max(20000),
  campiAllegato: z.array(z.string().max(100)).max(50),
  createdAt:     z.string().max(30),
  updatedAt:     z.string().max(30),
})

export const BozzaDatiSchema = z.object({
  nominativi:        z.array(NominativoSchema).max(2000),
  dettagli:          z.array(DettaglioSchema).max(200),
  comunicazioni:     z.array(ComunicazioneSchema).max(100),
  protocolloDisplay: z.string().max(200),
})
