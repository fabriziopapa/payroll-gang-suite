// ============================================================
// PAYROLL GANG SUITE — Mock Data per sviluppo e test
// Agente DATA — Fase 0
// ============================================================

import type {
  DettaglioLiquidazione,
  Nominativo,
  Bozza,
  AppSettings,
  DatiPDF,
} from '../types';
import { DEFAULT_COEFFICIENTI_SCORPORO } from '../constants/scorporoCoefficients';
import { DEFAULT_CSV_PARAMS, TAG_BUILTIN } from '../constants/csvDefaults';

// ------------------------------------------------------------
// MOCK: Dettagli Liquidazione
// ------------------------------------------------------------

export const MOCK_DETTAGLI: DettaglioLiquidazione[] = [
  {
    id: 'DET-001',
    colore: '#16A34A',
    nomeDescrittivo: 'TFA Sostegno Nov 2026',

    voce: '00068',
    capitolo: '004665',

    competenzaLiquidazione: '11/2026',
    dataCompetenzaVoce: '2026-11-30',

    flagScorporo: true,

    riferimentoCedolino: 'TL@TFA SOSTEGNO 2023 2024@',

    identificativoProvvedimento: '001234500',
    tipoProvvedimento: '000',
    numeroProvvedimento: '',
    dataProvvedimento: '10/04/2026',

    aliquota: 0,
    parti: 0,
    flagAdempimenti: 0,
    idContrattoCSA: '',

    centroCosto: '000000',
    note: '',
  },
  {
    id: 'DET-002',
    colore: '#2563EB',
    nomeDescrittivo: 'Arretrati Dicembre 2025',

    voce: '00022',
    capitolo: '000100',

    competenzaLiquidazione: '12/2025',
    dataCompetenzaVoce: '2025-12-31',

    flagScorporo: false,

    riferimentoCedolino: '',

    identificativoProvvedimento: '000000000',
    tipoProvvedimento: '000',
    numeroProvvedimento: '',
    dataProvvedimento: '10/04/2026',

    aliquota: 0,
    parti: 0,
    flagAdempimenti: 0,
    idContrattoCSA: '',

    centroCosto: '000000',
    note: 'Conguaglio arretrati dicembre 2025',
  },
];

// ------------------------------------------------------------
// MOCK: Nominativi
// Fonte: dati fittizi ispirati alla struttura XML HR
// ------------------------------------------------------------

export const MOCK_NOMINATIVI: Nominativo[] = [
  {
    id: 'NOM-001',
    matricola: 'MATR01',
    cognomeNome: 'ROSSI Mario',
    codFisc: 'RSSMRA80A01F839Z',
    ruolo: 'PA',
    druolo: 'Professori Associati',
    dettaglioId: 'DET-001',
    importoLordo: 2682.84,
    origine: 'pdf',
  },
  {
    id: 'NOM-002',
    matricola: 'MATR45',
    cognomeNome: 'BIANCHI Giulia',
    codFisc: 'BNCGLI85M41F839X',
    ruolo: 'RU',
    druolo: 'Ricercatori universitari',
    dettaglioId: 'DET-001',
    importoLordo: -101.45,
    origine: 'pdf',
  },
  {
    id: 'NOM-003',
    matricola: 'MATR87',
    cognomeNome: 'VERDI Luca',
    codFisc: 'VRDLCU77R15F839W',
    ruolo: 'ND',
    druolo: 'Personale non docente',
    dettaglioId: 'DET-002',
    importoLordo: 890.00,
    origine: 'manuale',
  },
];

// ------------------------------------------------------------
// MOCK: Risposta PDF (simulazione OCR)
// 🚧 FUNZIONALITÀ IN BOZZA – disponibile per test
//    L'estrazione reale da PDF richiede integrazione OCR.
//    Questo mock valida il flusso di importazione.
// ------------------------------------------------------------

export const MOCK_RISPOSTA_PDF: DatiPDF = {
  protocolloDisplay: '0012345/2026 del 10/04/2026',
  nominativi: [
    {
      cognomeNome: 'ROSSI Mario',
      matricola: 'MATR01',
      ruolo: 'PA',
      importoLordo: 2682.84,
    },
    {
      cognomeNome: 'BIANCHI Giulia',
      matricola: 'MATR45',
      ruolo: 'RU',
      importoLordo: -101.45,
    },
  ],
};

// ------------------------------------------------------------
// MOCK: Voci e Capitoli (estratti dall'XML Lista_voci)
// ------------------------------------------------------------

export const MOCK_VOCI = [
  {
    codice: '00068',
    descrizione: 'Fondo di Incentivazione',
    dataIn: '19900101',
    dataFin: '22220202',
    tipo: 'L.',
    capitoli: [
      { codice: '004665', descrizione: 'Fondo incentivazione ricerca' },
    ],
  },
  {
    codice: '00022',
    descrizione: 'Retribuzione individuale anz.',
    dataIn: '19800101',
    dataFin: '22220202',
    tipo: 'AN',
    capitoli: [
      { codice: '000100', descrizione: 'Stipendio personale universitario' },
    ],
  },
  {
    codice: '00089',
    descrizione: "Festivita' soppresse",
    dataIn: '19900101',
    dataFin: '22220202',
    tipo: 'HR',
    capitoli: [
      { codice: '000100', descrizione: 'Stipendio personale universitario' },
    ],
  },
];

// ------------------------------------------------------------
// MOCK: Impostazioni App (stato iniziale)
// ------------------------------------------------------------

export const MOCK_APP_SETTINGS: AppSettings = {
  coefficienti:         { ...DEFAULT_COEFFICIENTI_SCORPORO },
  csvDefaults:          { ...DEFAULT_CSV_PARAMS },
  tags:                 TAG_BUILTIN.map((prefisso) => ({ prefisso, builtin: true })),
  rubrica:              [],
  modelliComunicazione: [],
};

// ------------------------------------------------------------
// MOCK: Bozza di esempio
// ------------------------------------------------------------

export const MOCK_BOZZA: Bozza = {
  id: 'BOZZA-001',
  nome: 'Bozza #1',
  dataCreazione: '2026-04-11T10:00:00.000Z',
  dataUltimaModifica: '2026-04-11T10:30:00.000Z',
  stato: 'bozza',
  protocolloDisplay: '0012345/2026 del 10/04/2026',
  liquidazioni: MOCK_DETTAGLI,
  nominativi: MOCK_NOMINATIVI,
};
