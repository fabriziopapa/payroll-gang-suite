// ============================================================
// PAYROLL GANG SUITE — Area Emolumenti · Dottorandi e borse
//
// Il ciclo di lavoro dell'ufficio, in un posto solo:
//   1. si incolla da Excel "Cognome Nome<TAB>numero provvedimento";
//   2. i nomi diventano matricole contro l'anagrafica (mai per indovinare:
//      se i candidati sono due si chiede);
//   3. si legge da CSA che cosa c'e' GIA' per quella voce;
//   4. si scelgono i mesi da AGGIUNGERE — quelli gia' in CSA non sono
//      selezionabili, cosi' la riga doppia non nasce;
//   5. si scarica il CSV per HR Suite, dopo i controlli bloccanti.
//
// Cfr. il piano dell'area Emolumenti (documentazione interna) — §5.4 (flusso), §6.1 (controlli),
// §6.3 (centro di costo per riga), §6.4 (provvedimento per estremi).
//
// Vincolo §8.1: l'area Liquidazioni non si tocca. Da `biz.ts` si importano
// serializeCsv/downloadCsv/lastDayOfMonth in SOLA LETTURA: il tracciato HR
// resta uno solo, ma qui non si modifica nulla di quel codice.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  emolumentiApi, vociApi, anagraficheApi,
  type RigaRisoltaApi, type CandidatoApi, type VoceCsaApi, type VoceApi,
  type LavorazioneApi, type AnagraficaApi, type LiquidazioneInfo,
  type StoricoRuoloApi,
} from '../api/endpoints'
import { ApiError } from '../api/client'
import { showToast } from '../components/ToastManager'
import { ConfirmDialog } from '../components/ConfirmDialog'
// Stesso modale dell'archiviazione delle liquidazioni, importato in SOLA
// LETTURA (vincolo §8.1): l'utente ritrova la maschera che gia' conosce,
// con gli stessi campi e le stesse parole.
import ArchiviaLiquidazioneModal from '../components/ArchiviaLiquidazioneModal'
import ModaleContiCsa, { type ParametriContiCsa } from '../components/ModaleContiCsa'
import { serializeCsv, downloadCsv, lastDayOfMonth } from '../utils/biz'
import { nomeOppureTe } from '../utils/utente'
import { useStore } from '../store/useStore'
import { TIPO_PROVVEDIMENTO_DEFAULT } from '../utils/provvedimento'
import type { CsvExportRow } from '../types'

const VOCE_DEFAULT     = '09834'
const CAPITOLO_DEFAULT = '000601'

/**
 * Le voci con cui lavora l'area Emolumenti. Qui stanno il CODICE e la MODALITA'
 * — due scelte d'ufficio. Le DESCRIZIONI no: si leggono dall'anagrafica voci di
 * PGS, cosi' restano allineate agli import invece di sclerotizzarsi in una
 * costante che nessuno aggiorna. Voce non ancora importata → si mostra il solo
 * codice, senza inventare nulla.
 *
 * La modalita' decide quale delle due colonne del tracciato porta il valore:
 *   - 'parti'   → parti = 30 (mese commerciale), importo = 0. E' la 09834.
 *   - 'importo' → parti = 0, importo = quello della borsa, mese per mese.
 * L'altra colonna va comunque a **0**, non vuota: e' la convenzione che HR
 * accetta gia' oggi (cfr. buildCsvRows in biz.ts).
 */
type ModoValore = 'parti' | 'importo'

const VOCI_EMOLUMENTI: Array<{ codice: string; modo: ModoValore }> = [
  { codice: '09834', modo: 'parti'   },
  { codice: '09947', modo: 'importo' },
  { codice: '09766', modo: 'importo' },
]

const CODICI_EMOLUMENTI = VOCI_EMOLUMENTI.map(v => v.codice)

/**
 * Sigla del centro di costo per lo spazio stretto sotto il mese: la parte prima
 * del primo underscore, che nei codici d'ateneo e' il progetto
 * (`DING620_PROGETTO_TRACE_...` → `DING620`). Il valore intero resta nel tooltip.
 * Gli zeri di riempimento non sono un centro di costo: si trattano come vuoto.
 */
function siglaCentroDiCosto(v: string | null): string | null {
  const t = (v ?? '').trim()
  if (!t || /^0+$/.test(t)) return null
  return (t.split('_')[0] || t).slice(0, 10)
}

/** Numero → stringa italiana per il campo di input ("1353,58"), senza migliaia. */
function importoInput(n: number): string {
  return String(n).replace('.', ',')
}

/** "1.353,58" o "1353.58" → 1353.58. Stringa non numerica → null. */
function parseImporto(v: string): number | null {
  const t = v.trim()
  if (!t) return null
  // Italiano: il punto separa le migliaia, la virgola i decimali.
  const n = Number(t.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
/**
 * Aree del conto per cui si produce un TXT di matricole. L'ordine e' quello dei
 * file scaricati. 'NON_NOTO' e null NON sono qui di proposito: chi non ha una
 * coordinata CSA nota resta fuori dai file e viene elencato a schermo, perche'
 * finire nella lista sbagliata e' peggio che non finire in nessuna lista.
 */
const AREE_TXT = [
  { chiave: 'IT',       nomeFile: 'ITALIA'   },
  { chiave: 'SEPA',     nomeFile: 'SEPA'     },
  { chiave: 'EXTRA_UE', nomeFile: 'EXTRA_UE' },
] as const
const AREE_TXT_CHIAVI: readonly string[] = AREE_TXT.map(a => a.chiave)

/** Come spezzare i TXT. Tre file distinti e' il default perche' e' la
 *  divisione piu' richiesta, e perche' accorpare dopo si puo' sempre. */
const RAGGRUPPAMENTI = [
  { chiave: 'separati',   etichetta: '3 distinti' },
  { chiave: 'ita-estero', etichetta: 'Italia + estero' },
  { chiave: 'unico',      etichetta: 'Uno solo' },
] as const

/**
 * Abbinamenti d'ufficio: scegliendo il tipo, voce e capitolo si compilano da
 * soli. Restano modificabili — i casi eccezionali esistono — ma se divergono
 * l'interfaccia lo dice, cosi' una svista non passa inosservata.
 */
const TIPI_EMOLUMENTO = [
  { tipo: 'DR', etichetta: 'DR · maggiorazioni',            voce: '09834', capitolo: '000601' },
  { tipo: 'BS', etichetta: 'BS · borse non esenti (IRAP)',  voce: '09947', capitolo: '000706' },
  { tipo: 'BE', etichetta: 'BE · borse esenti',             voce: '09766', capitolo: '000602' },
] as const

type TipoEmolumento = typeof TIPI_EMOLUMENTO[number]['tipo']

const MAX_RIGHE        = 200
/** Le parti della maggiorazione sono sempre 30: mese commerciale, non giorni
 *  effettivi (verificato — cfr. piano §5.2.2 punto 3). */
const PARTI_MESE = 30

const MESI_BREVI = ['', 'gen', 'feb', 'mar', 'apr', 'mag', 'giu',
  'lug', 'ago', 'set', 'ott', 'nov', 'dic']
const MESI_LUNGHI = ['', 'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']

/** Chiave di competenza: "AAAA-MM". */
function chiaveMese(anno: number, mese: number): string {
  return `${anno}-${String(mese).padStart(2, '0')}`
}

function etichettaMese(k: string): string {
  const [y, m] = k.split('-')
  return `${MESI_LUNGHI[Number(m)]} ${y}`
}


// ── Stato di lavoro ──────────────────────────────────────────

/**
 * Versione del payload salvato. Se un giorno la forma di RigaLavoro cambia,
 * questo numero permette di riconoscere i salvataggi vecchi e convertirli
 * invece di aprirli sbagliati in silenzio.
 */
const VERSIONE_PAYLOAD = 2

interface RigaLavoro {
  /** Stabile per tutta la sessione: l'ordine dell'incollato non cambia. */
  id:                  number
  nominativo:          string
  numeroProvvedimento: string
  esito:               RigaRisoltaApi['esito']
  matricola:           string | null
  nomeCompleto:        string | null
  ruolo:               string | null
  candidati:           CandidatoApi[]
  /** Competenze gia' presenti in CSA ("AAAA-MM"). */
  mesiInCsa:           Set<string>
  /** Che cosa vale ogni competenza gia' in CSA: serve a mostrarla sotto il mese
   *  e a proporre l'importo del mese precedente quando se ne aggiunge uno. */
  csaPerMese:          Record<string, { parti: number | null; importo: number | null; centroDiCosto: string | null }>
  csaLetto:            boolean
  csaErrore:           string | null
  /** Proposto dall'ultima voce CSA, poi modificabile riga per riga (§6.3). */
  centroDiCosto:       string
  /** Competenze che l'operatore vuole aggiungere. */
  mesiScelti:          Set<string>
  /** Data del provvedimento — per persona, non per gruppo. ISO AAAA-MM-GG. */
  dataProvvedimento:   string
  /** Solo per le voci a importo: quanto vale la borsa, mese per mese. */
  importi:             Record<string, string>
  /** Area del conto su cui CSA paga, dall'anagrafica: 'IT' | 'SEPA' |
   *  'EXTRA_UE' | 'NON_NOTO' | null. Serve solo a dividere i TXT delle
   *  matricole: non e' un IBAN, non entra nel CSV per HR. */
  areaConto:           string | null
  /**
   * Paese dell'IBAN da cui `areaConto` e' stata calcolata, fotografato
   * quando la riga e' nata (o riverificata). Si salva con la lavorazione:
   * riaprendola si vede su che conto era la persona ALLORA, non oggi.
   * null nei salvataggi anteriori al campo e quando l'anagrafica non ce l'ha.
   */
  nazIban:             string | null
  /**
   * L'ultima "Verifica conti da CSA" su questa riga: che cosa dicevano le
   * testate della liquidazione letta. Resta salvata anche quando in CSA la
   * liquidazione (per esempio quella "a mazza secca") viene cancellata.
   * null = mai verificata.
   */
  contoCsa:            ContoCsaRiga | null
  /**
   * Ruolo scelto a mano dall'operatore, PER MESE: "AAAA-MM" -> codice ruolo.
   *
   * E' per mese e non per riga perche' il ruolo stesso lo e'. Una persona che
   * a maggio era DR e a ottobre e' PA non ha "un" ruolo nella lavorazione: ne
   * ha due, uno per mese. Una scelta unica per riga li appiattirebbe su tutti
   * i mesi -- che e' esattamente il difetto corretto il 2026-09-23.
   *
   * Tenuto SEPARATO da `ruolo` apposta: cosi' si vede sempre che cosa dice
   * l'anagrafica e che cosa ha deciso una persona. Mese assente = nessuna
   * scelta, vale il ruolo calcolato alla data di competenza di quel mese.
   *
   * Resta nella lavorazione e non torna in anagrafica: quella si corregge
   * solo re-importando da SGE, che e' la sua unica sorgente.
   */
  ruoliScelti:         Record<string, string>
  /**
   * Area del conto assegnata a mano, per chi in anagrafica non ce l'ha e
   * finirebbe fuori da tutti i TXT. Stessa logica di `ruoloScelto`: e' un
   * dato inserito da una persona, e si vede che lo e'.
   */
  areaContoScelta:     string | null
}

/**
 * Ultimo giorno del mese "AAAA-MM", in ISO.
 * E' la data che finisce nel CSV come `dataCompetenzaVoce`, quindi e' quella
 * su cui va letto il ruolo: chiedersi "che ruolo aveva a agosto" significa
 * chiedersi che ruolo aveva il 31 agosto.
 */
function ultimoGiornoIso(k: string): string {
  // Delega a lastDayOfMonth (utils/biz): era riscritta qui identica, e due
  // copie della stessa regola sono due posti dove correggerla.
  const [y, m] = k.split('-')
  return y && m ? lastDayOfMonth(`${m}/${y}`) : ''
}

/** Questo rapporto copre quella data? ISO AAAA-MM-GG. */
function copreData(s: StoricoRuoloApi, iso: string): boolean {
  if (!iso) return false
  return s.decorInq <= iso && (s.finRap == null || s.finRap >= iso)
}

/**
 * La data di competenza del mese "AAAA-MM".
 *
 * Di norma l'ultimo giorno del mese -- e' la data che il CSV porta nella
 * colonna dataCompetenzaVoce, quindi e' quella su cui il ruolo va letto. Ma
 * l'operatore puo' spostarla (mappa `date`, comune a tutta la lavorazione):
 * serve quando un rapporto finisce a meta' mese e al 31 la persona risulta
 * gia' con quello nuovo.
 *
 * UNA SOLA FUNZIONE per la colonna del CSV e per la risoluzione del ruolo:
 * finche' la chiamano entrambe, non possono divergere.
 */
function dataCompetenzaDi(k: string, date: Record<string, string>): string {
  return date[k] || ultimoGiornoIso(k)
}

/** I ruoli distinti attivi a quella data, secondo lo storico. */
function ruoliA(storico: StoricoRuoloApi[], iso: string): string[] {
  return [...new Set(storico.filter(s => copreData(s, iso)).map(s => s.ruolo))]
}

/** Questo rapporto copre la competenza di quel mese? */
function copreMese(s: StoricoRuoloApi, k: string, date: Record<string, string> = {}): boolean {
  return copreData(s, dataCompetenzaDi(k, date))
}

/**
 * I mesi selezionati su cui la persona risulta avere PIU' DI UN ruolo.
 *
 * Non e' un caso limite: su dottorandi e borsisti i ruoli si sovrappongono per
 * davvero — la stessa persona puo' avere una borsa e un dottorato attivi nello
 * stesso mese, e in CSA sono due rapporti distinti. Il programma non sceglie
 * al posto dell'operatore: lo dice e basta.
 */
function mesiAmbigui(
  storico: StoricoRuoloApi[], mesi: Set<string>, date: Record<string, string> = {},
): Array<{ mese: string; ruoli: string[] }> {
  const out: Array<{ mese: string; ruoli: string[] }> = []
  for (const k of [...mesi].sort()) {
    const ruoli = ruoliA(storico, dataCompetenzaDi(k, date))
    if (ruoli.length > 1) out.push({ mese: k, ruoli })
  }
  return out
}

/** Mesi selezionati che NESSUN rapporto copre: la persona a quella data non
 *  risulta in servizio, e il CSV porterebbe un ruolo che l'anagrafica smentisce. */
function mesiScoperti(
  storico: StoricoRuoloApi[], mesi: Set<string>, date: Record<string, string> = {},
): string[] {
  return [...mesi].sort().filter(k => !storico.some(s => copreMese(s, k, date)))
}

/**
 * Il ruolo che vale davvero PER QUEL MESE, in ordine di precedenza:
 *   1. la scelta dell'operatore per quel mese
 *   2. il ruolo univoco alla data di competenza del mese, secondo lo storico
 *   3. null se alla quella data i ruoli sono due o piu' (tocca all'operatore)
 *      oppure se non ce n'e' nessuno (persona non in servizio a quella data)
 *   4. `r.ruolo` -- il ripiego, valido solo finche' lo storico non e' arrivato
 *
 * Il punto 4 e' il residuo di risolvi-nominativi, che il ruolo lo prende da
 * findAll(): l'ultimo per decorrenza, senza guardare nessuna data. Va bene per
 * riempire la colonna mentre si lavora, non per decidere che cosa si paga --
 * per questo perde contro lo storico appena arriva.
 */
function ruoloDi(
  r: RigaLavoro, k: string,
  date: Record<string, string>,
  storico: StoricoRuoloApi[] | undefined,
): string | null {
  const scelto = r.ruoliScelti[k]
  if (scelto) return scelto
  if (!storico || storico.length === 0) return r.ruolo
  const ruoli = ruoliA(storico, dataCompetenzaDi(k, date))
  return ruoli.length === 1 ? ruoli[0]! : null
}

/**
 * L'area del conto secondo lo storico: quella del rapporto piu' recente che
 * ce l'ha. Serve alla riverifica -- l'area salvata sulla riga viene da
 * risolvi-nominativi, cioe' da una fotografia presa quando i nomi sono stati
 * incollati, e nel frattempo un import SGE puo' averla cambiata.
 */
function areaDaStorico(storico: StoricoRuoloApi[] | undefined): { area: string; naz: string | null } | null {
  if (!storico) return null
  for (const s of [...storico].sort((a, b) => b.decorInq.localeCompare(a.decorInq))) {
    if (s.areaConto) return { area: s.areaConto, naz: s.nazIban ?? null }
  }
  return null
}

/** Un'area che dice davvero dove si paga (non "ignoto"). */
function areaNota(a: string | null): boolean {
  return a !== null && a !== 'NON_NOTO'
}

/** Esito della verifica da CSA su una riga (vedi RigaLavoro.contoCsa). */
interface ContoCsaRiga {
  /** Liquidazione letta, 'AAAA-MM'. */
  mese:        string
  /** Progressivo chiesto, o null = tutte le liquidazioni del mese. */
  progressivo: string | null
  /** Quando, ISO. */
  letto:       string
  /**
   *  'confermato'           la riga ha il conto che dice CSA
   *  'diverso'              CSA dice altro e la differenza non e' (ancora) applicata
   *  'non-in-liquidazione'  nessuna testata per questa matricola
   *  'da-chiarire'          testate presenti ma non classificabili (vedi motivo)
   */
  esito:       'confermato' | 'diverso' | 'non-in-liquidazione' | 'da-chiarire'
  naz:         string | null
  area:        string | null
  motivo:      string | null
  progressivi: string | null
}

function leggiContoCsa(x: unknown): ContoCsaRiga | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const esiti = ['confermato', 'diverso', 'non-in-liquidazione', 'da-chiarire'] as const
  const esito = esiti.find(e => e === o['esito'])
  if (!esito || typeof o['mese'] !== 'string') return null
  const str = (k: string) => (typeof o[k] === 'string' ? o[k] as string : null)
  return {
    mese: o['mese'] as string, progressivo: str('progressivo'), letto: str('letto') ?? '',
    esito, naz: str('naz'), area: str('area'), motivo: str('motivo'), progressivi: str('progressivi'),
  }
}

const MESI_LIQUIDAZIONE = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
] as const

/** Testata di una lavorazione senza il mese di liquidazione (per la duplica). */
function senzaMeseLiquidazione(testata: unknown): unknown {
  if (!testata || typeof testata !== 'object' || Array.isArray(testata)) return testata
  const { meseLiquidazione: _via, ...resto } = testata as Record<string, unknown>
  return resto
}

/** '2026-10' -> '10/2026' */
function meseBreve(k: string): string {
  const [a, m] = k.split('-')
  return a && m ? `${m}/${a}` : k
}

/**
 * Una voce della coda di riverifica: qualcosa che il programma NON decide da
 * solo. Due famiglie, entrambe volute:
 *   - 'ruolo': a quella data i rapporti sono due o piu', oppure ce n'e' uno
 *     solo ma l'operatore ne aveva scelto un altro a mano
 *   - 'area':  l'anagrafica propone un'area diversa da quella assegnata a mano,
 *              oppure toglierebbe un'area nota (IT/SEPA/EXTRA_UE -> NON_NOTO):
 *              perdere il conto di una riga gia' lavorata si conferma, non
 *              succede da solo
 * Il caso semplice -- un ruolo solo e nessuna scelta a mano -- non entra in
 * coda: si aggiorna da se', in silenzio, ed e' la maggioranza.
 */
type VoceRiverifica =
  | { tipo: 'ruolo'; chiave: string; rigaId: number; nominativo: string; matricola: string
      mese: string; opzioni: StoricoRuoloApi[]; attuale: string | null; aMano: boolean }
  | { tipo: 'area'; chiave: string; rigaId: number; nominativo: string; matricola: string
      proposta: string | null; nazProposta: string | null; attuale: string | null; aMano: boolean }
  | { tipo: 'csa'; chiave: string; rigaId: number; nominativo: string; matricola: string
      proposta: string; nazProposta: string; attuale: string | null; attualeNaz: string | null
      aMano: boolean; meseCsa: string }

/** L'area del conto che vale davvero. Stessa precedenza. */
function areaDi(r: RigaLavoro): string | null {
  return r.areaContoScelta ?? r.areaConto
}

/**
 * I Set non sopravvivono a JSON.stringify: diventano `{}`. Qui e nella
 * funzione gemella si convertono in array e viceversa. Salviamo anche
 * `csaPerMese` — lo snapshot di cio' che CSA mostrava — cosi' riaprendo si
 * rivede lo stesso quadro senza rileggere CSA, e premendo "Leggi da CSA" si
 * vede cosa e' cambiato nel frattempo.
 */
function serializzaRighe(righe: RigaLavoro[]): unknown[] {
  return righe.map(r => ({
    ...r,
    mesiInCsa:  [...r.mesiInCsa],
    mesiScelti: [...r.mesiScelti],
  }))
}

/** Ricostruisce le righe da un payload salvato. Difensiva di proposito: il
 *  JSON arriva dal database, non dal compilatore. */
function deserializzaRighe(v: unknown): RigaLavoro[] {
  if (!Array.isArray(v)) return []
  return v.map((x, i) => {
    const o = (x ?? {}) as Record<string, unknown>
    const arr = (k: string) => Array.isArray(o[k]) ? (o[k] as unknown[]).map(String) : []
    return {
      id:                  typeof o['id'] === 'number' ? o['id'] : i,
      nominativo:          String(o['nominativo'] ?? ''),
      numeroProvvedimento: String(o['numeroProvvedimento'] ?? ''),
      esito:               (o['esito'] as RigaLavoro['esito']) ?? 'non-trovato',
      matricola:           (o['matricola'] as string | null) ?? null,
      nomeCompleto:        (o['nomeCompleto'] as string | null) ?? null,
      ruolo:               (o['ruolo'] as string | null) ?? null,
      candidati:           Array.isArray(o['candidati']) ? o['candidati'] as CandidatoApi[] : [],
      mesiInCsa:           new Set(arr('mesiInCsa')),
      csaPerMese:          (o['csaPerMese'] as RigaLavoro['csaPerMese']) ?? {},
      csaLetto:            o['csaLetto'] === true,
      csaErrore:           (o['csaErrore'] as string | null) ?? null,
      centroDiCosto:       String(o['centroDiCosto'] ?? ''),
      mesiScelti:          new Set(arr('mesiScelti')),
      dataProvvedimento:   String(o['dataProvvedimento'] ?? ''),
      importi:             (o['importi'] as Record<string, string>) ?? {},
      areaConto:           (o['areaConto'] as string | null) ?? null,
      nazIban:             (o['nazIban'] as string | null) ?? null,
      contoCsa:            leggiContoCsa(o['contoCsa']),
      // Salvataggi anteriori alle scelte manuali: assenti = nessuna scelta,
      // e la riga si comporta esattamente come prima.
      //
      // MIGRAZIONE payload v1 -> v2. Nella v1 la scelta era UNA per riga e
      // valeva su tutti i mesi. Qui la si riscrive mese per mese sui mesi che
      // quella riga aveva scelto: la bozza riaperta mostra esattamente quello
      // che mostrava prima, e da li' in poi ogni mese e' correggibile da solo.
      // Non si perde nulla e non si inventa nulla: l'operatore quella scelta
      // l'aveva fatta davvero, su quei mesi.
      ruoliScelti:         (() => {
        const m = o['ruoliScelti']
        if (m && typeof m === 'object' && !Array.isArray(m)) {
          return Object.fromEntries(
            Object.entries(m as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
          )
        }
        const vecchio = o['ruoloScelto']
        if (typeof vecchio === 'string' && vecchio) {
          return Object.fromEntries(arr('mesiScelti').map(k => [k, vecchio]))
        }
        return {}
      })(),
      areaContoScelta:     (o['areaContoScelta'] as string | null) ?? null,
    }
  })
}

/** "04/09/2026" o "2026-09-04" → ISO, oppure null se non e' una data. */
function dataIso(t: string): string | null {
  const it = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (it) return `${it[3]}-${it[2]!.padStart(2, '0')}-${it[1]!.padStart(2, '0')}`
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null
}

/**
 * "Cognome Nome<TAB>numero[<TAB>data]" → righe. Tollera tab, ; o 2+ spazi, e
 * anche i soli spazi singoli ("Rossi Mario 900008 04/09/2026"), che e'
 * come esce da certi copia-incolla.
 *
 * L'ordine di riconoscimento e' dalla coda: prima la data, poi il numero, e
 * quel che resta e' il nome. Cosi' un cognome che contiene cifre non manda
 * all'aria la riga.
 */
function parseIncollato(raw: string): Array<{ nominativo: string; numeroProvvedimento: string; dataProvvedimento: string }> {
  return raw.split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      // Tokenizzazione piatta: tab, punto e virgola e QUALSIASI spazio valgono
      // tutti come separatore. Un tentativo precedente teneva insieme i campi
      // separati da spazi singoli e si rompeva su "Nome Cognome 900008  data":
      // tolta la data restava un unico campo con dentro nome E numero, e il
      // numero finiva nel nominativo.
      let campi = l.split(/[\t;]|\s+/).map(x => x.trim()).filter(Boolean)

      // Si sfoglia dalla coda: prima la data, poi il numero, il resto e' il nome.
      let dataProvvedimento = ''
      if (campi.length >= 2) {
        const iso = dataIso(campi[campi.length - 1]!)
        if (iso) { dataProvvedimento = iso; campi = campi.slice(0, -1) }
      }

      let numeroProvvedimento = ''
      if (campi.length >= 2 && /^\d{3,}$/.test(campi[campi.length - 1]!)) {
        numeroProvvedimento = campi[campi.length - 1]!
        campi = campi.slice(0, -1)
      }

      return { nominativo: campi.join(' ').trim() || l, numeroProvvedimento, dataProvvedimento }
    })
}

export default function EmolumentiPage() {
  const annoCorrente = new Date().getFullYear()
  /** Serve solo a scrivere «te» invece del proprio nome nell'elenco. */
  const utenteId = useStore(s => s.user?.id ?? null)

  // Passo 1
  const [raw, setRaw] = useState('')
  // Passo 2 — provvedimento (§6.4: solo estremi, mai l'identificativo a 9 cifre)
  const [tipoProv, setTipoProv] = useState(TIPO_PROVVEDIMENTO_DEFAULT)
  const [dataProv, setDataProv] = useState('')
  // Parametri voce
  const [voce, setVoce]         = useState(VOCE_DEFAULT)
  const [voceManuale, setVoceManuale] = useState(false)
  const [modoManuale, setModoManuale] = useState<ModoValore>('parti')
  const [anagVoci, setAnagVoci] = useState<VoceApi[]>([])
  const [capitolo, setCapitolo] = useState(CAPITOLO_DEFAULT)
  const [annoDa, setAnnoDa]     = useState(String(annoCorrente))
  const [annoA, setAnnoA]       = useState(String(annoCorrente))

  const [righe, setRighe]       = useState<RigaLavoro[] | null>(null)
  /** Mese "AAAA-MM" -> data di competenza ISO, solo per i mesi spostati a mano.
   *  Mese assente = ultimo giorno del mese, che e' il default di sempre. */
  const [dateCompetenza, setDateCompetenza] = useState<Record<string, string>>({})
  /**
   * Il mese della liquidazione a cui la lavorazione si riferisce, 'AAAA-MM'
   * ('' = non ancora indicato). NON e' una data di competenza: quelle sono
   * per mese aggiunto e vanno nel CSV. Questo e' il mese in cui si paga:
   * propone anno e mese a "Verifica conti da CSA" e al nome della
   * lavorazione. La data esatta si scrive all'archiviazione.
   */
  const [meseLiq, setMeseLiq] = useState('')   // '01'..'12' o ''
  const [annoLiq, setAnnoLiq] = useState('')   // 'AAAA' o in scrittura
  const meseLiquidazione = meseLiq && /^\d{4}$/.test(annoLiq) ? `${annoLiq}-${meseLiq}` : ''
  function setMeseLiquidazione(v: string) {
    const ok = /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
    setAnnoLiq(ok ? v.slice(0, 4) : '')
    setMeseLiq(ok ? v.slice(5, 7) : '')
  }
  /** Coda delle cose da confermare dopo una riverifica. Vuota = niente da chiedere. */
  const [daConfermare, setDaConfermare] = useState<VoceRiverifica[]>([])
  const [riverificando, setRiverificando] = useState(false)
  const [contiCsaAperto, setContiCsaAperto] = useState(false)
  const [leggendoConti,  setLeggendoConti]  = useState(false)
  const [risolvendo, setRisolvendo] = useState(false)

  /** Storia dei ruoli per matricola, caricata in blocco. Non entra nel payload
   *  salvato: e' un dato d'anagrafica, si rilegge quando serve. */
  const [storici, setStorici] = useState<Record<string, StoricoRuoloApi[]>>({})
  /** Matricole gia' richieste, per non ripetere la chiamata a ogni render. */
  const storiciChiesti = useRef<Set<string>>(new Set())

  // ── Caricamento nominativi ─────────────────────────────────────────────
  const [tipoEmol, setTipoEmol]   = useState<TipoEmolumento | ''>('')
  const [modoCarico, setModoCarico] = useState<'incolla' | 'cerca'>('incolla')
  const [anagrafiche, setAnagrafiche] = useState<AnagraficaApi[]>([])
  const [cerca, setCerca] = useState('')

  /** Come spezzare i TXT delle matricole. Tre file distinti e' il default:
   *  e' la divisione che la banca chiede piu' spesso, e accorpare si puo'
   *  sempre, separare dopo no. */
  const [raggrupTxt, setRaggrupTxt] =
    useState<typeof RAGGRUPPAMENTI[number]['chiave']>('separati')
  const [leggendo, setLeggendo]     = useState(false)

  // ── Lavorazione salvata ────────────────────────────────────────────────
  const [lavorazioneId, setLavorazioneId]   = useState<string | null>(null)
  const [nomeLavorazione, setNomeLavorazione] = useState('')
  const [statoLavorazione, setStatoLavorazione] = useState<'bozza' | 'archiviata'>('bozza')
  const [dataLiquidazione, setDataLiquidazione] = useState<string | null>(null)
  const [elenco, setElenco]         = useState<LavorazioneApi[]>([])
  const [salvando, setSalvando]     = useState(false)
  const [idLiqCsa, setIdLiqCsa] = useState<string | null>(null)
  /** Lavorazione per cui e' aperto il modale di archiviazione. */
  const [archiviaTarget, setArchiviaTarget] = useState<LavorazioneApi | null>(null)

  // Elenco (come la Dashboard delle liquidazioni) oppure lavorazione aperta.
  const [vista, setVista]           = useState<'elenco' | 'editor'>('elenco')
  const [filtroLav, setFiltroLav]   = useState<'bozza' | 'archiviata' | 'tutte'>('bozza')
  const [cercaLav, setCercaLav]     = useState('')
  const [eliminaId, setEliminaId]   = useState<string | null>(null)

  // Anagrafica completa per la ricerca singola. La lista non porta il codice
  // fiscale (lo toglie la rotta, SEC-C2), quindi qui si cerca per nominativo e
  // matricola: sono sufficienti, e nessun CF passa di qui.
  useEffect(() => {
    anagraficheApi.list()
      .then(setAnagrafiche)
      .catch(() => { /* si lavora lo stesso: resta l'incollato */ })
  }, [])

  // Descrizioni dall'anagrafica voci. Se la chiamata fallisce non e' un errore
  // da mostrare: la tendina resta con i soli codici e il campo manuale funziona.
  useEffect(() => {
    vociApi.active()
      .then(v => setAnagVoci(v))
      .catch(() => { /* tendina senza descrizioni: si lavora lo stesso */ })
  }, [])

  /** Voci proposte in tendina, con la descrizione quando l'anagrafica ce l'ha. */
  const opzioniVoce = useMemo(() => VOCI_EMOLUMENTI.map(v => {
    const trovata = anagVoci.find(a => a.codice === v.codice)
    return { ...v, descrizione: trovata?.descrizione?.trim() || null }
  }), [anagVoci])

  /** Parti o importo: dalla voce scelta, oppure dall'interruttore in manuale. */
  const modo: ModoValore =
    VOCI_EMOLUMENTI.find(v => v.codice === voce.trim())?.modo ?? modoManuale

  /** Le matricole risolte, come chiave stabile per l'effetto qui sotto. */
  const matricoleRisolte = useMemo(
    () => [...new Set((righe ?? []).map(r => r.matricola).filter(Boolean) as string[])]
            .sort().join(','),
    [righe],
  )

  // Storia dei ruoli in blocco: una chiamata per le matricole nuove, mai due
  // volte per la stessa. Se fallisce non si blocca niente — il pannello dei
  // dettagli sa comunque leggersi la sua matricola da solo.
  useEffect(() => {
    const lista    = matricoleRisolte ? matricoleRisolte.split(',') : []
    const mancanti = lista.filter(m => !storiciChiesti.current.has(m))
    if (mancanti.length === 0) return
    mancanti.forEach(m => storiciChiesti.current.add(m))
    let vivo = true
    emolumentiApi.storicoRuoliBulk(mancanti)
      .then(x => { if (vivo) setStorici(s => ({ ...s, ...x.storici })) })
      .catch(() => { mancanti.forEach(m => storiciChiesti.current.delete(m)) })
    return () => { vivo = false }
  }, [matricoleRisolte])

  /**
   * Riverifica: rilegge l'anagrafica e rimette in discussione ruoli e aree.
   *
   * Perche' un pulsante e non un aggiornamento continuo. Una lavorazione si
   * apre e si chiude nel giro di giorni, e in mezzo puo' esserci un import
   * SGE: il ruolo di una persona cambia, oppure la sua area del conto compare
   * dove prima non c'era. Ricaricare da soli ogni volta cancellerebbe pero'
   * scelte che una persona ha fatto apposta. Quindi si rilegge quando lo
   * chiedi tu, e cio' che non e' ovvio te lo si domanda invece di deciderlo.
   *
   * Si applica da se' solo il caso non ambiguo E non toccato a mano. Tutto il
   * resto -- piu' rapporti alla data, oppure una scelta manuale che ora non
   * coincide piu' -- finisce nella coda di conferma.
   */
  async function riverifica() {
    const mats = [...new Set((righe ?? []).map(r => r.matricola).filter(Boolean) as string[])]
    if (mats.length === 0) { showToast('Non c’è ancora nessuna matricola da riverificare.', 'warning'); return }

    setRiverificando(true)
    try {
      // Si scavalca la cache: e' proprio il punto del pulsante.
      const { storici: freschi } = await emolumentiApi.storicoRuoliBulk(mats)
      mats.forEach(m => storiciChiesti.current.add(m))
      setStorici(prev => ({ ...prev, ...freschi }))

      const coda: VoceRiverifica[] = []
      const auto: Array<{ id: number; patch: Partial<RigaLavoro> }> = []

      for (const r of righe ?? []) {
        if (!r.matricola) continue
        const st = freschi[r.matricola]
        if (!st || st.length === 0) continue

        // ── ruoli, mese per mese
        const nuoviScelti: Record<string, string> = { ...r.ruoliScelti }
        let cambiato = false
        for (const k of [...r.mesiScelti].sort()) {
          const iso    = dataCompetenzaDi(k, dateCompetenza)
          const ruoli  = ruoliA(st, iso)
          const aMano  = r.ruoliScelti[k]
          if (ruoli.length === 1 && !aMano) {
            // Caso ovvio: non si chiede niente, il calcolo lo fa gia' ruoloDi.
            continue
          }
          if (ruoli.length === 1 && aMano && aMano === ruoli[0]) {
            // La scelta a mano coincide con l'anagrafica: non serve piu'.
            delete nuoviScelti[k]; cambiato = true
            continue
          }
          if (ruoli.length === 0) continue   // non in servizio: lo dice gia' `problemi`
          coda.push({
            tipo: 'ruolo', chiave: `${r.id}|${k}`, rigaId: r.id,
            nominativo: r.nominativo, matricola: r.matricola, mese: k,
            opzioni: st.filter(x => copreData(x, iso)),
            attuale: aMano ?? null, aMano: Boolean(aMano),
          })
        }
        if (cambiato) auto.push({ id: r.id, patch: { ruoliScelti: nuoviScelti } })

        // ── area del conto
        const prop     = areaDaStorico(st)
        const proposta = prop?.area ?? null
        if (r.areaContoScelta) {
          if (proposta && proposta !== r.areaContoScelta) {
            coda.push({
              tipo: 'area', chiave: `${r.id}|area`, rigaId: r.id,
              nominativo: r.nominativo, matricola: r.matricola,
              proposta, nazProposta: prop?.naz ?? null, attuale: r.areaContoScelta, aMano: true,
            })
          }
        } else if (proposta && proposta !== r.areaConto) {
          // Un conto CONFERMATO da CSA vale piu' della stima dall'anagrafica:
          // se l'anagrafica ora dice altro, si chiede, non si sovrascrive.
          if ((areaNota(r.areaConto) && !areaNota(proposta)) || r.contoCsa?.esito === 'confermato') {
            // Una riga che aveva un conto e ora lo perderebbe: si chiede.
            // E' anche la rete per l'intervallo fra il rilascio e il primo
            // import con NAZ_IBAN, quando le nazioni sono ancora vuote.
            coda.push({
              tipo: 'area', chiave: `${r.id}|area`, rigaId: r.id,
              nominativo: r.nominativo, matricola: r.matricola,
              proposta, nazProposta: prop?.naz ?? null, attuale: r.areaConto, aMano: false,
            })
          } else {
            auto.push({ id: r.id, patch: { areaConto: proposta, nazIban: prop?.naz ?? null } })
          }
        } else if (proposta && prop?.naz && prop.naz !== r.nazIban) {
          // Stessa area, nazione nuova o prima assente (LT -> BE, o salvataggi
          // anteriori al campo): si aggiorna la fotografia, l'area non cambia.
          auto.push({ id: r.id, patch: { nazIban: prop.naz } })
        }
      }

      for (const a of auto) aggiorna(a.id, a.patch)
      setDaConfermare(coda)
      showToast(
        coda.length === 0
          ? `Riverificate ${mats.length} matricole: nulla da decidere.`
          : `Riverificate ${mats.length} matricole: ${coda.length} da confermare.`,
        coda.length === 0 ? 'success' : 'warning',
      )
    } catch (err) {
      showToast(messaggioErrore(err), 'error')
    } finally {
      setRiverificando(false)
    }
  }

  /**
   * "Verifica conti da CSA": legge le testate della liquidazione indicata e
   * confronta, riga per riga, il conto su cui CSA ha pagato con quello che
   * la riga ha (dall'anagrafica o scelto a mano).
   *
   * Regola decisa dall'autore: OGNI differenza si conferma. Si applica da
   * se' solo l'esito, mai un cambio: dove CSA coincide la riga viene marcata
   * "confermato", dove non c'e' testata "non in liquidazione", dove le
   * testate non bastano "da chiarire" con il motivo. Area e nazione della
   * riga cambiano solo con un si' nella coda.
   */
  async function verificaContiDaCsa(p: ParametriContiCsa) {
    const conMatricola = (righe ?? []).filter(r => r.matricola)
    const mats = [...new Set(conMatricola.map(r => r.matricola as string))]
    if (mats.length === 0) { showToast('Nessuna matricola da verificare.', 'warning'); return }

    setLeggendoConti(true)
    try {
      const esito = await emolumentiApi.contiDaCsa({
        anno: p.anno, mese: p.mese, ruoli: p.ruoli, matricole: mats,
        ...(p.progrLiquidazione ? { progrLiquidazione: p.progrLiquidazione } : {}),
      })
      const meseCsa = `${p.anno}-${String(p.mese).padStart(2, '0')}`
      const letto   = new Date().toISOString()
      const perMat  = new Map(esito.conti.map(c => [c.matricola, c]))
      const base    = { mese: meseCsa, progressivo: p.progrLiquidazione ?? null, letto }

      const coda: VoceRiverifica[] = []
      let confermati = 0, assenti = 0, daChiarire = 0
      for (const r of conMatricola) {
        const c = perMat.get(r.matricola as string)
        if (!c) {
          assenti++
          aggiorna(r.id, { contoCsa: { ...base, esito: 'non-in-liquidazione', naz: null, area: null, motivo: null, progressivi: null } })
          continue
        }
        if (!c.area || !c.nazIban) {
          daChiarire++
          aggiorna(r.id, { contoCsa: { ...base, esito: 'da-chiarire', naz: null, area: null, motivo: c.motivo, progressivi: c.progressivi } })
          continue
        }
        const conto = { ...base, naz: c.nazIban, area: c.area, motivo: null, progressivi: c.progressivi }
        if (areaDi(r) === c.area && r.nazIban === c.nazIban) {
          confermati++
          aggiorna(r.id, { contoCsa: { ...conto, esito: 'confermato' } })
          continue
        }
        aggiorna(r.id, { contoCsa: { ...conto, esito: 'diverso' } })
        coda.push({
          tipo: 'csa', chiave: `${r.id}|csa`, rigaId: r.id,
          nominativo: r.nominativo, matricola: r.matricola as string,
          proposta: c.area, nazProposta: c.nazIban,
          attuale: areaDi(r), attualeNaz: r.nazIban,
          aMano: Boolean(r.areaContoScelta), meseCsa,
        })
      }

      setContiCsaAperto(false)
      setDaConfermare(coda)
      showToast(
        `CSA ${meseBreve(meseCsa)}: ${esito.testateLiquide} testate liquidate su ${esito.testateLette}. ` +
        `${confermati} confermati, ${coda.length} diversi da confermare, ` +
        `${daChiarire} da chiarire, ${assenti} non in liquidazione.`,
        coda.length + daChiarire > 0 ? 'warning' : 'success',
      )
    } catch (err) {
      showToast(messaggioErrore(err), 'error')
    } finally {
      setLeggendoConti(false)
    }
  }

  /** I ruoli presenti nelle righe: quelli dell'anagrafica e quelli scelti a mano. */
  const ruoliRighe = useMemo(() => {
    const s = new Set<string>()
    for (const r of righe ?? []) {
      if (r.ruolo) s.add(r.ruolo)
      for (const v of Object.values(r.ruoliScelti)) if (v) s.add(v)
    }
    return [...s].filter(x => /^[A-Z0-9]{2}$/.test(x)).sort()
  }, [righe])

  const incollate = useMemo(() => parseIncollato(raw), [raw])
  const troppe    = incollate.length > MAX_RIGHE

  /** Mesi proponibili: tutti quelli dell'intervallo scelto. */
  const mesiFinestra = useMemo(() => {
    const da = Number(annoDa), a = Number(annoA)
    if (!Number.isFinite(da) || !Number.isFinite(a)) return []
    const [lo, hi] = da <= a ? [da, a] : [a, da]
    const out: string[] = []
    for (let y = lo; y <= hi; y++) for (let m = 1; m <= 12; m++) out.push(chiaveMese(y, m))
    return out
  }, [annoDa, annoA])

  // ── Passo 1: risoluzione dei nominativi ──────────────────
  /** Il tipo detta voce e capitolo. Restano modificabili: vedi avvisoAbbinamento. */
  function applicaTipo(t: TipoEmolumento | '') {
    setTipoEmol(t)
    const ab = TIPI_EMOLUMENTO.find(x => x.tipo === t)
    if (!ab) return
    setVoceManuale(false)
    setVoce(ab.voce)
    setCapitolo(ab.capitolo)

    // Nome proposto solo se il campo e' ancora vuoto: quello scritto a mano
    // non si sovrascrive da solo. Per rigenerarlo c'e' il pulsante apposta.
    if (!nomeLavorazione.trim()) setNomeLavorazione(nomeProposto(ab.tipo))
  }

  /** "BS ottobre 2026": tipo, mese della liquidazione (o corrente) per esteso, anno. */
  function nomeProposto(t: string): string {
    const rif  = meseLiquidazione ? new Date(`${meseLiquidazione}-01T12:00:00`) : new Date()
    const mese = rif.toLocaleDateString('it-IT', { month: 'long' })
    return `${t || 'Emolumenti'} ${mese} ${rif.getFullYear()}`
  }

  /**
   * Scegliere una voce porta con se' il capitolo abbinato, e allinea il tipo
   * mostrato in alto. Il capitolo resta un campo normale: chi deve metterne
   * un altro lo scrive, e l'avviso qui sotto glielo ricorda.
   */
  function scegliVoce(codice: string) {
    setVoce(codice)
    const ab = TIPI_EMOLUMENTO.find(x => x.voce === codice)
    if (!ab) return
    setCapitolo(ab.capitolo)
    setTipoEmol(ab.tipo)
  }

  /** Voce o capitolo diversi da quelli previsti per il tipo scelto. Non blocca:
   *  i casi eccezionali esistono, ma una svista non deve passare inosservata. */
  const avvisoAbbinamento = useMemo(() => {
    const ab = TIPI_EMOLUMENTO.find(x => x.tipo === tipoEmol)
    if (!ab) return null
    const diff: string[] = []
    if (voce.trim()     !== ab.voce)     diff.push(`voce ${voce.trim() || '(vuota)'} invece di ${ab.voce}`)
    if (capitolo.trim() !== ab.capitolo) diff.push(`capitolo ${capitolo.trim() || '(vuoto)'} invece di ${ab.capitolo}`)
    return diff.length > 0 ? `${ab.tipo}: ${diff.join(' · ')}.` : null
  }, [tipoEmol, voce, capitolo])

  /** Primo id libero: le righe si aggiungono a piu' riprese, gli id non si riusano. */
  function prossimoId(cur: RigaLavoro[]): number {
    return cur.reduce((m, r) => Math.max(m, r.id), -1) + 1
  }

  function rigaVuota(id: number, base: Partial<RigaLavoro>): RigaLavoro {
    return {
      id,
      nominativo:          '',
      numeroProvvedimento: '',
      esito:               'non-trovato',
      matricola:           null,
      nomeCompleto:        null,
      ruolo:               null,
      candidati:           [],
      mesiInCsa:           new Set<string>(),
      csaPerMese:          {},
      csaLetto:            false,
      csaErrore:           null,
      centroDiCosto:       '',
      mesiScelti:          new Set<string>(),
      dataProvvedimento:   dataProv,
      importi:             {},
      areaConto:           null,
      nazIban:             null,
      contoCsa:            null,
      ruoliScelti:         {},
      areaContoScelta:     null,
      ...base,
    }
  }

  async function risolvi() {
    if (incollate.length === 0) { showToast('Incolla almeno un nominativo.', 'error'); return }
    if (troppe) { showToast(`Massimo ${MAX_RIGHE} righe per volta.`, 'error'); return }

    setRisolvendo(true)
    try {
      // La rotta vuole solo nominativo e numero: la data terza colonna e' roba
      // nostra, la riagganciamo per indice sulla risposta (l'ordine e' quello).
      const { risultati } = await emolumentiApi.risolviNominativi(
        incollate.map(({ nominativo, numeroProvvedimento }) => ({ nominativo, numeroProvvedimento })),
      )

      setRighe(prev => {
        const cur = prev ?? []
        const gia = new Set(cur.map(r => r.matricola).filter(Boolean) as string[])
        let id = prossimoId(cur)
        const nuove: RigaLavoro[] = []

        risultati.forEach((r, i) => {
          // Chi c'e' gia' non si duplica: l'area si carica a piu' riprese.
          if (r.matricola && gia.has(r.matricola)) return
          if (r.matricola) gia.add(r.matricola)
          nuove.push(rigaVuota(id++, {
            nominativo:          r.nominativo,
            numeroProvvedimento: r.numeroProvvedimento ?? '',
            esito:               r.esito,
            matricola:           r.matricola,
            nomeCompleto:        r.nomeCompleto,
            ruolo:               r.ruolo,
            candidati:           r.candidati,
            dataProvvedimento:   incollate[i]?.dataProvvedimento || dataProv,
            areaConto:           r.areaConto,
            nazIban:             r.nazIban,
          }))
        })

        const scartate = risultati.length - nuove.length
        if (scartate > 0) showToast(`${scartate} già presenti: non duplicate.`, 'warning')
        return [...cur, ...nuove]
      })
      setRaw('')
    } catch (err) {
      showToast(messaggioErrore(err), 'error')
    } finally {
      setRisolvendo(false)
    }
  }

  /** Aggiunge una persona pescata dalla ricerca singola. */
  function aggiungiDaAnagrafica(a: AnagraficaApi) {
    setRighe(prev => {
      const cur = prev ?? []
      if (cur.some(r => r.matricola === a.matricola)) {
        showToast(`${a.cognNome} è già nell'elenco.`, 'warning')
        return cur
      }
      return [...cur, rigaVuota(prossimoId(cur), {
        nominativo:   a.cognNome,
        nomeCompleto: a.cognNome,
        esito:        'trovato',
        matricola:    a.matricola,
        ruolo:        a.ruolo,
        areaConto:    a.areaConto ?? null,
        nazIban:      a.nazIban ?? null,
      })]
    })
    setCerca('')
  }

  /** Toglie una riga inserita per errore. Solo dalla schermata: a database
   *  non c'e' nulla finche' non si salva. */
  function eliminaRiga(id: number) {
    setRighe(prev => (prev ?? []).filter(r => r.id !== id))
  }

  /** Risultati della ricerca singola — nominativo o matricola, primi 12. */
  const risultatiRicerca = useMemo(() => {
    const q = cerca.trim().toLowerCase()
    if (q.length < 2) return []
    const gia = new Set((righe ?? []).map(r => r.matricola).filter(Boolean) as string[])
    return anagrafiche
      .filter(a => !gia.has(a.matricola))
      .filter(a =>
        a.matricola.includes(q) ||
        (a.cognNome ?? '').toLowerCase().includes(q))
      .slice(0, 12)
  }, [cerca, anagrafiche, righe])

  // ── Passo 2: lettura di quello che c'e' gia' in CSA ──────
  async function leggiCsa() {
    if (!righe) return
    const matricole = [...new Set(righe.map(r => r.matricola).filter((m): m is string => !!m))]
    if (matricole.length === 0) { showToast('Nessuna matricola risolta da leggere.', 'error'); return }

    setLeggendo(true)
    try {
      const res = await emolumentiApi.csaVoci({
        matricole,
        codiceVoce: voce.trim(),
        annoDa: Number(annoDa),
        annoA:  Number(annoA),
      })
      const perMatricola = new Map(res.risultati.map(r => [r.matricola, r]))
      setRighe(prev => prev!.map(r => {
        if (!r.matricola) return r
        const res1 = perMatricola.get(r.matricola)
        if (!res1) return r
        const mesi = new Set<string>()
        const perMese: RigaLavoro['csaPerMese'] = {}
        for (const v of res1.voci) {
          if (v.anno == null || v.mese == null) continue
          const k = chiaveMese(v.anno, v.mese)
          mesi.add(k)
          // Piu' voci sullo stesso mese non dovrebbero esistere (e' proprio
          // l'errore che l'area previene): se capita, vince l'ultima letta.
          perMese[k] = { parti: v.parti, importo: v.importo, centroDiCosto: v.codiceCentroDiCosto }
        }
        return {
          ...r,
          mesiInCsa:     mesi,
          csaPerMese:    perMese,
          csaLetto:      true,
          csaErrore:     res1.errore ?? (res1.anagrafica ? null : 'idAb assente in anagrafiche'),
          centroDiCosto: r.centroDiCosto || centroDiCostoProposto(res1.voci),
          // Un mese scelto che nel frattempo risulta gia' in CSA va tolto,
          // altrimenti resterebbe selezionato e finirebbe nel CSV.
          mesiScelti:    new Set([...r.mesiScelti].filter(k => !mesi.has(k))),
        }
      }))
    } catch (err) {
      showToast(messaggioErrore(err), 'error')
    } finally {
      setLeggendo(false)
    }
  }

  // ── Modifiche riga ───────────────────────────────────────
  function aggiorna(id: number, patch: Partial<RigaLavoro>) {
    setRighe(prev => prev!.map(r => (r.id === id ? { ...r, ...patch } : r)))
  }

  function toggleMese(id: number, k: string) {
    setRighe(prev => prev!.map(r => {
      if (r.id !== id) return r
      if (r.mesiInCsa.has(k)) return r          // gia' in CSA: non selezionabile

      const next = new Set(r.mesiScelti)
      if (next.has(k)) { next.delete(k); return { ...r, mesiScelti: next } }

      next.add(k)
      // Voce a importo: si propone quello del mese precedente — digitato o gia'
      // in CSA, il primo che si trova andando a ritroso. La borsa e' quasi
      // sempre la stessa, ma il campo resta modificabile.
      if (modo === 'importo' && !(r.importi[k] ?? '').trim()) {
        const eredita = importoMesePrecedente(r, k)
        if (eredita) return { ...r, mesiScelti: next, importi: { ...r.importi, [k]: eredita } }
      }
      return { ...r, mesiScelti: next }
    }))
  }

  // ── Controlli bloccanti (§6.1) ───────────────────────────
  // ── Lavorazioni: salva, riapri, archivia ──────────────────────────────
  async function caricaElenco() {
    try {
      const { lavorazioni } = await emolumentiApi.lavorazioni()
      setElenco(lavorazioni)
    } catch (err) {
      showToast(messaggioErrore(err), 'error')
    }
  }

  useEffect(() => { void caricaElenco() }, [])

  /** Tutto cio' che serve a ricostruire la schermata. */
  function payload(): Record<string, unknown> {
    return {
      versione:  VERSIONE_PAYLOAD,
      salvatoIl: new Date().toISOString(),
      testata: {
        voce, voceManuale, modoManuale, capitolo, tipoProv, dataProv, annoDa, annoA,
        // Mese "AAAA-MM" -> data di competenza ISO. Solo i mesi spostati a mano:
        // per gli altri vale l'ultimo giorno, calcolato al volo. Sta in testata
        // e non sulla riga perche' e' la competenza della VOCE, non della
        // persona: al 31 ottobre ci sono tutti.
        dateCompetenza,
        meseLiquidazione,
      },
      righe: serializzaRighe(righe ?? []),
    }
  }

  async function salva(comeNuova = false) {
    const nome = nomeLavorazione.trim()
    if (!nome) { showToast('Dai un nome alla lavorazione prima di salvarla.', 'error'); return }
    if (!righe || righe.length === 0) { showToast('Non c’è niente da salvare.', 'error'); return }

    setSalvando(true)
    try {
      if (lavorazioneId && !comeNuova) {
        const row = await emolumentiApi.aggiornaLavorazione(lavorazioneId, { nome, dati: payload() })
        setStatoLavorazione(row.stato === 'archiviata' ? 'archiviata' : 'bozza')
        showToast('Lavorazione salvata.', 'success')
      } else {
        const row = await emolumentiApi.creaLavorazione({ nome, dati: payload() })
        setLavorazioneId(row.id)
        setStatoLavorazione('bozza')
        setDataLiquidazione(null)
        showToast('Lavorazione creata.', 'success')
      }
      await caricaElenco()
    } catch (err) {
      // Il nome duplicato non e' un errore tecnico: e' l'ufficio che sta per
      // creare due "Emolumenti DR 1" indistinguibili.
      showToast(
        err instanceof ApiError && err.status === 409
          ? 'Esiste già una lavorazione con questo nome.'
          : messaggioErrore(err),
        'error',
      )
    } finally {
      setSalvando(false)
    }
  }

  async function apri(id: string) {
    setSalvando(true)
    try {
      const row  = await emolumentiApi.lavorazione(id)
      const dati = (row.dati ?? {}) as Record<string, unknown>
      const t    = (dati['testata'] ?? {}) as Record<string, unknown>

      if (dati['versione'] !== VERSIONE_PAYLOAD) {
        showToast('Salvataggio di una versione diversa: controlla i dati prima di esportare.', 'warning')
      }

      if (typeof t['voce']       === 'string') setVoce(t['voce'])
      if (typeof t['capitolo']   === 'string') setCapitolo(t['capitolo'])
      if (typeof t['tipoProv']   === 'string') setTipoProv(t['tipoProv'])
      if (typeof t['dataProv']   === 'string') setDataProv(t['dataProv'])
      if (typeof t['annoDa']     === 'string') setAnnoDa(t['annoDa'])
      if (typeof t['annoA']      === 'string') setAnnoA(t['annoA'])
      if (typeof t['voceManuale'] === 'boolean') setVoceManuale(t['voceManuale'])
      if (t['modoManuale'] === 'parti' || t['modoManuale'] === 'importo') setModoManuale(t['modoManuale'])
      // Assente nei salvataggi v1: mappa vuota = ultimo giorno del mese ovunque,
      // cioe' esattamente la data che quei salvataggi gia' portavano nel CSV.
      setDateCompetenza(
        t['dateCompetenza'] && typeof t['dateCompetenza'] === 'object' && !Array.isArray(t['dateCompetenza'])
          ? Object.fromEntries(
              Object.entries(t['dateCompetenza'] as Record<string, unknown>)
                .filter(([, v]) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v as string))
                .map(([k, v]) => [k, v as string]),
            )
          : {},
      )

      setMeseLiquidazione(
        typeof t['meseLiquidazione'] === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(t['meseLiquidazione'])
          ? t['meseLiquidazione'] : '',
      )

      setRighe(deserializzaRighe(dati['righe']))
      setLavorazioneId(row.id)
      setNomeLavorazione(row.nome)
      setStatoLavorazione(row.stato === 'archiviata' ? 'archiviata' : 'bozza')
      setDataLiquidazione(row.dataLiquidazione)
      setIdLiqCsa(row.idLiquidazioneCsa)
      setArchiviaTarget(null)
      showToast(`Aperta "${row.nome}".`, 'success')
    } catch (err) {
      showToast(messaggioErrore(err), 'error')
    } finally {
      setSalvando(false)
    }
  }

  /**
   * Archivia. Se la lavorazione e' quella aperta si salva PRIMA: archiviare
   * uno stato non salvato congelerebbe una versione diversa da quella a
   * schermo. Dall'elenco non serve, li' e' gia' quella a database.
   */
  async function archiviaLavorazione(id: string, info: LiquidazioneInfo) {
    if (id === lavorazioneId && nomeLavorazione.trim()) {
      await emolumentiApi.aggiornaLavorazione(id, {
        nome: nomeLavorazione.trim(), dati: payload(),
      })
    }
    const row = await emolumentiApi.archiviaLavorazione(id, info)
    if (id === lavorazioneId) {
      setStatoLavorazione('archiviata')
      setDataLiquidazione(row.dataLiquidazione)
      setIdLiqCsa(row.idLiquidazioneCsa)
    }
    setArchiviaTarget(null)
    await caricaElenco()
    showToast('Lavorazione archiviata.', 'success')
  }

  async function riapri(id: string) {
    try {
      await emolumentiApi.riapriLavorazione(id)
      if (id === lavorazioneId) setStatoLavorazione('bozza')
      await caricaElenco()
      showToast('Lavorazione riaperta.', 'success')
    } catch (err) {
      showToast(messaggioErrore(err), 'error')
    }
  }

  /** Svuota la schermata senza toccare nulla a database. */
  function nuova() {
    setLavorazioneId(null)
    setNomeLavorazione('')
    setStatoLavorazione('bozza')
    setDataLiquidazione(null)
    setMeseLiquidazione('')
    setRighe(null)
    setRaw('')
    setTipoEmol('')
    setArchiviaTarget(null)
  }

  function nuovoEmolumento() {
    nuova()
    setVista('editor')
  }

  async function apriInEditor(id: string) {
    await apri(id)
    setVista('editor')
  }

  /**
   * Copia una lavorazione: SOLO la testata, MAI le persone.
   *
   * Fino alla 26.09.20 copiava anche l'elenco dei nominativi, per "ripetere lo
   * stesso elenco il mese dopo". Due ragioni per non farlo piu':
   *   - si riparte da un elenco che sembra verificato e non lo e'. Mesi gia' in
   *     CSA, ruoli, aree del conto: tutto fotografato al mese scorso. Basta non
   *     ripremere "Leggi cosa c'e' in CSA" per caricare una competenza doppia.
   *   - la copia porta con se' nomi e matricole di persone che in quella nuova
   *     lavorazione potrebbero non entrarci affatto.
   * Restano voce, capitolo, tipo e data del provvedimento, anni: cioe' tutto
   * quello che si riscriverebbe identico. I nominativi si reincollano, ed e'
   * il passo in cui si guarda chi c'e'.
   */
  async function duplica(l: LavorazioneApi) {
    setSalvando(true)
    try {
      const orig  = await emolumentiApi.lavorazione(l.id)
      const dati  = (orig.dati ?? {}) as Record<string, unknown>
      const row   = await emolumentiApi.creaLavorazione({
        nome: `${l.nome} (copia)`,
        ...(l.tipo ? { tipo: l.tipo } : {}),
        // Il mese di liquidazione NON si copia: la copia serve per il mese
        // dopo, e un mese riportato da quello prima sembra giusto e non lo e'.
        dati: { ...dati, righe: [], testata: senzaMeseLiquidazione(dati['testata']) },
      })
      await caricaElenco()
      showToast(`Creata "${row.nome}" — testata copiata, nominativi da incollare.`, 'success')
    } catch (err) {
      showToast(
        err instanceof ApiError && err.status === 409
          ? 'Esiste già una copia con questo nome: rinomina l’originale o la copia.'
          : messaggioErrore(err),
        'error',
      )
    } finally {
      setSalvando(false)
    }
  }

  async function eliminaLav(id: string) {
    try {
      await emolumentiApi.eliminaLavorazione(id)
      if (lavorazioneId === id) nuova()
      await caricaElenco()
      showToast('Lavorazione eliminata.', 'success')
    } catch (err) {
      showToast(messaggioErrore(err), 'error')
    } finally {
      setEliminaId(null)
    }
  }

  const nBozze      = elenco.filter(l => l.stato === 'bozza').length
  const nArchiviate = elenco.filter(l => l.stato === 'archiviata').length

  const elencoFiltrato = useMemo(() => {
    const q = cercaLav.trim().toLowerCase()
    return elenco
      .filter(l => filtroLav === 'tutte' || l.stato === filtroLav)
      .filter(l => !q || l.nome.toLowerCase().includes(q) || (l.tipo ?? '').toLowerCase().includes(q))
  }, [elenco, filtroLav, cercaLav])

  // ── TXT delle matricole per area del conto ────────────────────────────
  // Ci finisce SOLO chi ha almeno un mese selezionato: il file dice a chi
  // stiamo pagando qualcosa adesso, non chi abbiamo cercato.
  const perAreaTxt = useMemo(() => {
    const out: Record<string, string[]> = {}
    const fuori: RigaLavoro[] = []
    for (const r of righe ?? []) {
      if (r.mesiScelti.size === 0 || !r.matricola) continue
      // areaDi(): l'assegnazione fatta a mano vale quanto quella d'anagrafica.
      // Chi non ha ne' l'una ne' l'altra resta fuori, come prima.
      const area = areaDi(r) ?? ''
      if (AREE_TXT_CHIAVI.includes(area)) {
        (out[area] ??= []).push(r.matricola)
      } else {
        fuori.push(r)
      }
    }
    // Una persona compare una volta sola anche con piu' mesi selezionati.
    for (const k of Object.keys(out)) out[k] = [...new Set(out[k]!)]
    return { out, fuori }
  }, [righe])

  const nMatricoleTxt = useMemo(
    () => Object.values(perAreaTxt.out).reduce((n, v) => n + v.length, 0),
    [perAreaTxt],
  )

  /** I file da produrre, secondo il raggruppamento scelto. Un file senza
   *  matricole non viene creato: meglio nessun file che un file vuoto. */
  const fileTxt = useMemo(() => {
    const g = (k: string) => perAreaTxt.out[k] ?? []
    const comp = (nome: string, chiavi: string[]) => ({
      nome,
      matricole: [...new Set(chiavi.flatMap(g))],
    })

    const lista =
      raggrupTxt === 'unico'
        ? [comp('TUTTE', ['IT', 'SEPA', 'EXTRA_UE'])]
        : raggrupTxt === 'ita-estero'
          ? [comp('ITALIA', ['IT']), comp('ESTERO', ['SEPA', 'EXTRA_UE'])]
          : AREE_TXT.map(a => comp(a.nomeFile, [a.chiave]))

    return lista.filter(x => x.matricole.length > 0)
  }, [perAreaTxt, raggrupTxt])

  function scaricaMatricoleTxt() {
    if (fileTxt.length === 0) { showToast('Nessuna matricola con area del conto nota.', 'error'); return }
    const oggi = new Date().toISOString().slice(0, 10).replace(/-/g, '')

    // Download sfalsati: il browser ne blocca alcuni se partono tutti insieme
    // (stessa accortezza dei TXT per ruolo delle Liquidazioni).
    fileTxt.forEach((x, i) => {
      setTimeout(() => {
        const blob = new Blob([x.matricole.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' })
        const url  = URL.createObjectURL(blob)
        const el   = Object.assign(document.createElement('a'), {
          href: url, download: `matricole_${voce.trim() || 'emolumenti'}_${x.nome}_${oggi}.txt`,
        })
        el.click()
        URL.revokeObjectURL(url)
      }, i * 150)
    })
    showToast(`${fileTxt.length} file scaricati · ${nMatricoleTxt} matricole.`, 'success')
  }

  const problemi = useMemo(() => {
    if (!righe) return []
    const out: string[] = []
    const conMesi = righe.filter(r => r.mesiScelti.size > 0)

    if (conMesi.length === 0) out.push('Nessun mese selezionato: non c’è niente da esportare.')
    if (!tipoProv.trim()) out.push('Manca il tipo di provvedimento.')
    if (!voce.trim()) out.push('Manca il codice voce.')

    const senzaData = conMesi.filter(r => !r.dataProvvedimento)
    if (senzaData.length > 0) {
      out.push(`Data provvedimento mancante su ${senzaData.length} riga/e: ${senzaData.map(r => r.nominativo).join(', ')}.`)
    }

    // Voce a importo: ogni mese scelto deve avere il suo valore. Zero o testo
    // non sono un importo: meglio fermarsi che spedire una riga da 0 euro.
    if (modo === 'importo') {
      const cattivi: string[] = []
      for (const r of conMesi) {
        for (const k of r.mesiScelti) {
          const v = parseImporto(r.importi[k] ?? '')
          if (v === null || v <= 0) cattivi.push(`${r.nominativo} · ${etichettaMese(k)}`)
        }
      }
      if (cattivi.length > 0) {
        out.push(`Importo mancante o non valido su ${cattivi.length} mese/i: ${cattivi.slice(0, 5).join('; ')}${cattivi.length > 5 ? '…' : ''}.`)
      }
    }

    const senzaNumero = conMesi.filter(r => !r.numeroProvvedimento.trim())
    if (senzaNumero.length > 0) {
      out.push(`Numero provvedimento mancante su ${senzaNumero.length} riga/e: ${senzaNumero.map(r => r.nominativo).join(', ')}.`)
    }

    // Stesso numero su matricole diverse: nel CSV di luglio ogni dottorando
    // aveva il suo. Finche' l'ufficio non dice il contrario (§10.4), e' errore.
    const perNumero = new Map<string, Set<string>>()
    for (const r of conMesi) {
      const n = r.numeroProvvedimento.trim()
      if (!n || !r.matricola) continue
      if (!perNumero.has(n)) perNumero.set(n, new Set())
      perNumero.get(n)!.add(r.matricola)
    }
    for (const [n, ms] of perNumero) {
      if (ms.size > 1) out.push(`Numero provvedimento ${n} usato su più matricole: ${[...ms].join(', ')}.`)
    }

    const nonLetti = conMesi.filter(r => !r.csaLetto)
    if (nonLetti.length > 0) {
      out.push(`Non hai ancora letto CSA per ${nonLetti.length} riga/e con mesi selezionati: potresti ricaricare una competenza già presente.`)
    }

    // Ruolo non risolto su un mese: due rapporti attivi a quella data e nessuna
    // scelta dell'operatore, oppure nessun rapporto. Prima di questo controllo
    // quella riga usciva con la colonna ruolo VUOTA, senza che nessuno lo
    // dicesse: il CSV partiva e l'errore si scopriva a valle. Adesso ferma
    // l'export, ed e' il motivo per cui la scelta manuale esiste.
    const senzaRuolo: string[] = []
    for (const r of conMesi) {
      if (!r.matricola) continue
      const st = storici[r.matricola]
      if (!st) continue   // storico non ancora arrivato: vale il ripiego
      for (const k of [...r.mesiScelti].sort()) {
        if (!ruoloDi(r, k, dateCompetenza, st)) {
          const n = ruoliA(st, dataCompetenzaDi(k, dateCompetenza)).length
          senzaRuolo.push(`${r.nominativo} · ${etichettaMese(k)} (${n === 0 ? 'non in servizio' : 'ruoli: ' + ruoliA(st, dataCompetenzaDi(k, dateCompetenza)).join('/')})`)
        }
      }
    }
    if (senzaRuolo.length > 0) {
      out.push(`Ruolo da scegliere su ${senzaRuolo.length} mese/i: ${senzaRuolo.slice(0, 5).join('; ')}${senzaRuolo.length > 5 ? '…' : ''}.`)
    }
    return out
  }, [righe, tipoProv, voce, modo, storici, dateCompetenza])

  /** I mesi che almeno una riga ha selezionato: quelli che avranno una data. */
  const mesiInUso = useMemo(() => {
    const st = new Set<string>()
    for (const r of righe ?? []) if (r.matricola) for (const k of r.mesiScelti) st.add(k)
    return [...st].sort()
  }, [righe])

  const nRigheCsv = useMemo(
    () => (righe ?? []).reduce((n, r) => n + (r.matricola ? r.mesiScelti.size : 0), 0),
    [righe],
  )

  // ── Esportazione ─────────────────────────────────────────
  function esporta() {
    if (!righe || problemi.length > 0) return
    const out: CsvExportRow[] = []
    for (const r of righe) {
      if (!r.matricola) continue
      for (const k of [...r.mesiScelti].sort()) {
        const [y, m] = k.split('-') as [string, string]
        // UNA data per questo mese, usata due volte qui sotto: nella colonna
        // dataCompetenzaVoce e per decidere il ruolo. Prima la colonna la
        // calcolava lastDayOfMonth e il ruolo non guardava nessuna data: il
        // CSV poteva dichiarare una competenza di ottobre con il ruolo di
        // maggio. Adesso la fonte e' la stessa e non possono discordare.
        const dataComp = dataCompetenzaDi(k, dateCompetenza)
        out.push({
          matricola: r.matricola,
          comparto:  '1',
          // Il ruolo del tracciato e' quello che vale a QUELLA data: la scelta
          // dell'operatore per quel mese, altrimenti quello dello storico.
          ruolo:     ruoloDi(r, k, dateCompetenza, storici[r.matricola]) ?? '',
          codiceVoce: voce.trim(),
          // §6.4: nell'area Emolumenti si usa SOLO la forma per estremi.
          identificativoProvvedimento: '',
          tipoProvvedimento:   tipoProv.trim(),
          numeroProvvedimento: r.numeroProvvedimento.trim(),
          // ISO in uscita: la colonna dataProvvedimento vuole AAAA-MM-GG,
          // mentre dataCompetenzaVoce esce GG/MM/AAAA da serializeCsv. Le due
          // colonne hanno formati diversi ed e' corretto cosi' (§6.4 punto 3).
          dataProvvedimento: r.dataProvvedimento,
          annoCompetenzaLiquidazione: y,
          meseCompetenzaLiquidazione: m,
          dataCompetenzaVoce: dataComp,
          codiceStatoVoce: 'E',
          aliquota: 0,
          // La colonna inattiva va a 0, non vuota: e' la convenzione HR gia'
          // in uso nell'export delle liquidazioni.
          parti:   modo === 'parti'   ? PARTI_MESE : 0,
          importo: modo === 'importo' ? (parseImporto(r.importi[k] ?? '') ?? 0) : 0,
          codiceDivisa: 'E',
          codiceEnte:   '000000',
          codiceCapitolo: capitolo.trim(),
          codiceCentroDiCosto: r.centroDiCosto.trim(),
          riferimento: '',
          codiceRiferimentoVoce: '',
          flagAdempimenti: 0,
          idContrattoCSA: '',
          nota: '',
        })
      }
    }
    const oggi = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    downloadCsv(serializeCsv(out), `emolumenti_${voce.trim()}_${oggi}.csv`)
    showToast(`${out.length} righe esportate.`, 'success')
  }

  // ── Render ───────────────────────────────────────────────
  const risolte   = righe?.filter(r => r.esito === 'trovato' || r.matricola).length ?? 0
  const daSistemare = righe?.filter(r => !r.matricola).length ?? 0

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">

      <header>
        <h1 className="text-xl font-semibold text-white">Dottorandi e borse</h1>
        <p className="text-sm text-slate-400 mt-1">
          Si incollano i nominativi con il numero di provvedimento, si guarda che cosa è
          già in CSA, e si aggiungono i mesi mancanti. I mesi già presenti non sono
          selezionabili: la competenza doppia non può nascere.
        </p>
      </header>

      {vista === 'elenco' ? (
        <>
          {/* ── Elenco delle lavorazioni ─────────────────── */}
          <div className="flex items-center justify-end">
            <button onClick={nuovoEmolumento} className={btnPrimario + ' flex items-center gap-2'}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Nuovo emolumento
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Bozze attive</p>
              <p className="text-3xl font-semibold text-indigo-400 mt-1">{nBozze}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Archiviate</p>
              <p className="text-3xl font-semibold text-slate-200 mt-1">{nArchiviate}</p>
            </div>
          </div>

          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500"
                 fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
            </svg>
            <input
              value={cercaLav}
              onChange={e => setCercaLav(e.target.value)}
              placeholder="Cerca per nome o tipo…"
              className={inputCls + ' pl-9'}
            />
          </div>

          <div className="flex gap-2">
            {([
              { k: 'bozza',      label: 'Bozze' },
              { k: 'archiviata', label: 'Archiviate' },
              { k: 'tutte',      label: 'Tutte' },
            ] as const).map(t => (
              <button
                key={t.k}
                onClick={() => setFiltroLav(t.k)}
                className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${
                  filtroLav === t.k
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {elencoFiltrato.length === 0 && (
              <p className="text-sm text-slate-500 px-1">
                {elenco.length === 0
                  ? 'Nessuna lavorazione salvata. Comincia da «Nuovo emolumento».'
                  : 'Nessun risultato con questo filtro.'}
              </p>
            )}

            {elencoFiltrato.map(l => (
              <div
                key={l.id}
                className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3
                           flex flex-wrap items-center gap-3"
              >
                <span className="w-9 h-9 rounded-lg bg-indigo-950/60 text-indigo-300
                                 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </span>

                <div className="min-w-0">
                  <button
                    onClick={() => void apriInEditor(l.id)}
                    className="text-sm text-white hover:text-indigo-300 transition text-left truncate block"
                  >
                    {l.nome}
                  </button>
                  <p
                    className="text-xs text-slate-500"
                    title={l.updatedByUsername ?? undefined}
                  >
                    {l.tipo ? `${l.tipo} · ` : ''}
                    Modificato {new Date(l.updatedAt).toLocaleDateString('it-IT')}
                    {nomeOppureTe(l.updatedByUsername, l.updatedBy, utenteId)
                      ? ` da ${nomeOppureTe(l.updatedByUsername, l.updatedBy, utenteId)}`
                      : ''}
                    {l.dataLiquidazione ? ` · liquidata ${l.dataLiquidazione}` : ''}
                    {l.idLiquidazioneCsa ? ` · ${l.idLiquidazioneCsa}` : ''}
                  </p>
                  {/* Riga a parte: la creazione e' un fatto di contorno e non
                      deve rubare spazio a chi ha toccato la lavorazione per
                      ultimo, che e' l'informazione che si cerca. Assente se
                      l'utente e' stato cancellato (il join da' NULL). */}
                  {nomeOppureTe(l.createdByUsername, l.createdBy, utenteId) && (
                    <p className="text-xs text-slate-600" title={l.createdByUsername ?? undefined}>
                      Creata da {nomeOppureTe(l.createdByUsername, l.createdBy, utenteId)}
                      {' il '}{new Date(l.createdAt).toLocaleDateString('it-IT')}
                    </p>
                  )}
                </div>

                <span className={`ml-auto text-xs px-2.5 py-0.5 rounded-full border ${
                  l.stato === 'archiviata'
                    ? 'border-slate-700 text-slate-400'
                    : 'border-indigo-700 text-indigo-300'
                }`}>
                  {l.stato === 'archiviata' ? 'Archiviata' : 'Bozza'}
                </span>

                <div className="flex items-center gap-1">
                  <button onClick={() => void apriInEditor(l.id)} title="Apri" className={iconaCls}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>

                  <button onClick={() => void duplica(l)} title="Duplica la testata (senza i nominativi)" className={iconaCls}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>

                  {l.stato === 'bozza' && (
                    <button
                      onClick={() => setArchiviaTarget(l)}
                      title="Archivia"
                      className={iconaCls}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                      </svg>
                    </button>
                  )}

                  {l.stato === 'archiviata' && (
                    <button onClick={() => void riapri(l.id)} title="Riapri" className={iconaCls}>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  )}

                  {l.stato === 'bozza' && (
                    <button
                      onClick={() => setEliminaId(l.id)}
                      title="Elimina"
                      className={iconaCls + ' hover:text-red-400 hover:bg-red-950/40'}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>

              </div>
            ))}
          </div>

          <ConfirmDialog
            open={eliminaId !== null}
            title="Eliminare la lavorazione?"
            message="Il contenuto salvato viene perso e non è recuperabile. I dati già caricati in CSA non vengono toccati."
            danger
            confirmLabel="Elimina"
            onConfirm={() => { if (eliminaId) void eliminaLav(eliminaId) }}
            onCancel={() => setEliminaId(null)}
          />
        </>
      ) : (
        <>
          {/* Percorso in cima alla pagina, fuori dalla card: e' un'indicazione
              di dove ci si trova, non un comando della lavorazione. */}
          <nav className="flex items-center gap-2 text-sm min-w-0 -mt-2">
            <button
              onClick={() => { setVista('elenco'); void caricaElenco() }}
              className="text-slate-400 hover:text-slate-100 transition"
            >
              Dottorandi e borse
            </button>
            <span className="text-slate-700">/</span>
            <span className="text-slate-200 truncate">
              {nomeLavorazione.trim() || 'Nuovo emolumento'}
            </span>
            {lavorazioneId && (
              <span className={`text-xs px-2.5 py-0.5 rounded-full border shrink-0 ${
                statoLavorazione === 'archiviata'
                  ? 'border-slate-700 text-slate-400'
                  : 'border-indigo-700 text-indigo-300'
              }`}>
                {statoLavorazione === 'archiviata'
                  ? `Archiviata${dataLiquidazione ? ` · ${dataLiquidazione}` : ''}${idLiqCsa ? ` · ${idLiqCsa}` : ''}`
                  : 'Bozza'}
              </span>
            )}
          </nav>

          {/* ── Barra della lavorazione aperta ───────────── */}
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <input
                value={nomeLavorazione}
                onChange={e => setNomeLavorazione(e.target.value)}
                placeholder="BS settembre 2026"
                className={inputCls + ' flex-1 min-w-[16rem]'}
              />
              <button
                onClick={() => setNomeLavorazione(nomeProposto(tipoEmol))}
                title="Tipo di caricamento, mese corrente per esteso e anno"
                className={btnSecondario + ' shrink-0'}
              >
                Genera nome
              </button>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <button
                  onClick={esporta}
                  disabled={problemi.length > 0 || nRigheCsv === 0}
                  title={problemi.length > 0 ? 'Ci sono controlli da risolvere nel passo 3' : 'Scarica il CSV per HR Suite'}
                  className={btnAzione}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  CSV per HR
                </button>
                <button
                  onClick={scaricaMatricoleTxt}
                  disabled={nMatricoleTxt === 0}
                  title="Matricole divise per area del conto"
                  className={btnAzione}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  TXT matricole
                  {nMatricoleTxt > 0 && <span className="opacity-70">({nMatricoleTxt})</span>}
                </button>
                <button onClick={() => void salva(false)} disabled={salvando || !righe} className={btnPrimario}>
                  Salva
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-400">Liquidazione di</span>
              <select
                value={meseLiq}
                onChange={e => {
                  setMeseLiq(e.target.value)
                  if (e.target.value && !annoLiq) setAnnoLiq(String(new Date().getFullYear()))
                }}
                disabled={statoLavorazione === 'archiviata'}
                className={inputCls + ' w-40'}
              >
                <option value="">— mese —</option>
                {MESI_LIQUIDAZIONE.map((nome, i) => (
                  <option key={nome} value={String(i + 1).padStart(2, '0')}>{nome}</option>
                ))}
              </select>
              <input
                value={annoLiq}
                onChange={e => setAnnoLiq(e.target.value.replace(/\D/g, '').slice(0, 4))}
                disabled={statoLavorazione === 'archiviata'}
                inputMode="numeric"
                placeholder="anno"
                className={inputCls + ' w-24 font-mono'}
              />
              <span className="text-xs text-slate-500">
                Il mese in cui si paga: lo usano «Verifica conti da CSA» e «Genera nome». La data
                esatta si scrive all’archiviazione. Le date di competenza dei mesi aggiunti restano
                quelle di «Data di competenza», una per mese.
              </span>
            </div>

            <p className="text-xs text-slate-500">
              Il salvataggio conserva anche ciò che CSA mostrava in questo momento: riaprendo si
              rivede lo stesso quadro senza attendere la rilettura. Per sapere che cosa è cambiato
              da allora, basta premere di nuovo «Leggi da CSA».
            </p>
          </section>

      {/* ── 1. Caricamento nominativi ───────────────────── */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <h2 className="text-sm font-semibold text-slate-200">1 · Chi liquidare</h2>

          {/* Il tipo detta voce e capitolo: si sceglie una volta, all'inizio. */}
          <div className="flex flex-wrap gap-2 ml-auto">
            {TIPI_EMOLUMENTO.map(t => (
              <button
                key={t.tipo}
                onClick={() => applicaTipo(tipoEmol === t.tipo ? '' : t.tipo)}
                title={`voce ${t.voce} · capitolo ${t.capitolo}`}
                className={`px-3 py-1.5 rounded-lg text-xs transition-colors border ${
                  tipoEmol === t.tipo
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {t.etichetta}
              </button>
            ))}
          </div>
        </div>

        {tipoEmol && (
          <p className="text-xs text-slate-500">
            Voce e capitolo compilati: <span className="font-mono text-slate-400">{voce}</span> ·{' '}
            <span className="font-mono text-slate-400">{capitolo}</span>. Restano modificabili nel passo 2.
          </p>
        )}

        {/* Stesse schede, stesse parole e stesso ordine del modale
            "Aggiungi nominativo" delle liquidazioni: chi lo conosce ritrova
            i suoi appigli. Qui si parte da "Incolla lista" perche' e' il
            punto di ingresso naturale di quest'area. */}
        <div className="flex gap-2">
          <button
            onClick={() => setModoCarico('cerca')}
            className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
              modoCarico === 'cerca' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Manuale
          </button>
          <button
            onClick={() => setModoCarico('incolla')}
            className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
              modoCarico === 'incolla' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Incolla lista
          </button>
        </div>

        {modoCarico === 'incolla' ? (
          <>
            <textarea
              value={raw}
              onChange={e => setRaw(e.target.value)}
              rows={6}
              placeholder={'Una riga per persona:\nRossi Mario\t900008\t04/09/2026\n\nLa data è facoltativa. Vanno bene tabulazione, punto e virgola o spazi.'}
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700
                         text-slate-100 text-sm font-mono placeholder:font-sans
                         placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
            />
            <div className="flex items-center gap-4 flex-wrap">
              <p className={`text-xs ${troppe ? 'text-red-400' : 'text-slate-500'}`}>
                {incollate.length === 0
                  ? 'Nominativo, numero di provvedimento e — se c’è — data del provvedimento.'
                  : `${incollate.length} righe${
                      incollate.filter(i => i.dataProvvedimento).length > 0
                        ? `, ${incollate.filter(i => i.dataProvvedimento).length} con data`
                        : ''
                    }${troppe ? ` — massimo ${MAX_RIGHE}` : ''}.`}
              </p>
              <button
                onClick={risolvi}
                disabled={risolvendo || incollate.length === 0 || troppe}
                className="ml-auto px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white
                           text-sm font-medium transition-colors disabled:opacity-40"
              >
                {risolvendo ? 'Ricerca in anagrafiche…' : 'Aggiungi all’elenco'}
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <label className="block">
              <span className="block text-xs font-medium text-slate-400 mb-1.5">
                Cerca nominativo o matricola
                {anagrafiche.length > 0 && (
                  <span className="text-slate-600"> ({anagrafiche.length} record)</span>
                )}
              </span>
              <input
                value={cerca}
                onChange={e => setCerca(e.target.value)}
                placeholder="es. Papa Fabrizio  oppure  000123"
                className={inputCls}
              />
            </label>
            {cerca.trim().length >= 2 && (
              <div className="rounded-lg border border-slate-800 divide-y divide-slate-800 max-h-64 overflow-auto">
                {risultatiRicerca.length === 0 && (
                  <p className="p-3 text-sm text-slate-500">
                    Nessun risultato — o è già nell’elenco qui sotto.
                  </p>
                )}
                {risultatiRicerca.map(a => (
                  <button
                    key={a.matricola}
                    onClick={() => aggiungiDaAnagrafica(a)}
                    className="w-full text-left px-3 py-2 hover:bg-slate-800/50 transition
                               flex items-baseline gap-3"
                  >
                    <span className="font-mono text-xs text-indigo-300">{a.matricola}</span>
                    <span className="text-sm text-slate-100">{a.cognNome}</span>
                    <span className="text-xs text-slate-500">{a.ruolo}</span>
                    {a.areaConto && (
                      <span className="ml-auto text-xs font-mono text-slate-500">{a.areaConto}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-slate-500">
              La ricerca è per nominativo o matricola. Il codice fiscale non passa da qui: l’elenco
              delle anagrafiche non lo espone, ed è giusto così.
            </p>
          </div>
        )}
      </section>

      {righe && (
        <>
          {/* ── 2. Provvedimento e voce ─────────────────── */}
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-200">2 · Provvedimento e voce</h2>
            {avvisoAbbinamento && (
              <p className="text-xs text-amber-400">
                Diverso dall’abbinamento previsto — {avvisoAbbinamento} Se è voluto, procedi pure.
              </p>
            )}
            <div className="flex flex-wrap gap-4 items-end">
              <Campo label="Tipo" larghezza="w-24">
                <input value={tipoProv} onChange={e => setTipoProv(e.target.value)} className={inputCls} />
              </Campo>
              <Campo label="Data provvedimento (predefinita)" larghezza="w-64">
                <div className="flex gap-2">
                  <input type="date" value={dataProv} onChange={e => setDataProv(e.target.value)} className={inputCls} />
                  <button
                    onClick={() => setRighe(prev => prev!.map(r => ({ ...r, dataProvvedimento: dataProv })))}
                    disabled={!dataProv}
                    title="Riporta questa data su tutte le righe"
                    className="px-2 rounded-lg border border-slate-700 text-slate-400 text-sm
                               hover:text-white hover:border-slate-600 disabled:opacity-40"
                  >a tutte</button>
                </div>
              </Campo>
              <Campo label="Codice voce" larghezza={voceManuale ? 'w-72' : 'w-80'}>
                {voceManuale ? (
                  <div className="flex gap-2">
                    <input
                      value={voce}
                      onChange={e => setVoce(e.target.value)}
                      placeholder="codice"
                      className={inputCls}
                      autoFocus
                    />
                    <select
                      value={modoManuale}
                      onChange={e => setModoManuale(e.target.value as ModoValore)}
                      title="Quale colonna porta il valore"
                      className="px-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-300 text-sm"
                    >
                      <option value="parti">parti</option>
                      <option value="importo">importo</option>
                    </select>
                    <button
                      onClick={() => { setVoceManuale(false); setVoce(VOCE_DEFAULT) }}
                      title="Torna all'elenco"
                      className="px-2 rounded-lg border border-slate-700 text-slate-400
                                 hover:text-white hover:border-slate-600 text-sm"
                    >elenco</button>
                  </div>
                ) : (
                  <select
                    value={CODICI_EMOLUMENTI.includes(voce) ? voce : '__altro__'}
                    onChange={e => {
                      if (e.target.value === '__altro__') { setVoceManuale(true); setVoce('') }
                      else scegliVoce(e.target.value)
                    }}
                    className={inputCls}
                  >
                    {opzioniVoce.map(o => (
                      <option key={o.codice} value={o.codice}>
                        {o.descrizione ? `${o.codice} — ${o.descrizione}` : o.codice}
                      </option>
                    ))}
                    <option value="__altro__">Altra voce (codice a mano)…</option>
                  </select>
                )}
              </Campo>
              <Campo label="Capitolo" larghezza="w-32">
                <input value={capitolo} onChange={e => setCapitolo(e.target.value)} className={inputCls} />
              </Campo>
              <Campo label="Dall'anno" larghezza="w-28">
                <input type="number" value={annoDa} onChange={e => setAnnoDa(e.target.value)} className={inputCls} />
              </Campo>
              <Campo label="All'anno" larghezza="w-28">
                <input type="number" value={annoA} onChange={e => setAnnoA(e.target.value)} className={inputCls} />
              </Campo>
              <button
                onClick={leggiCsa}
                disabled={leggendo || risolte === 0}
                className="px-5 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white
                           text-sm font-medium transition-colors disabled:opacity-40"
              >
                {leggendo ? 'Lettura da CSA…' : 'Leggi cosa c’è in CSA'}
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Numero e data del provvedimento si impostano <strong className="text-slate-400">per
              persona</strong>: la data qui sopra è solo il valore predefinito. Il tipo resta
              modificabile — 029 è la scelta d’ufficio, non una regola del tracciato.
              {' '}Questa voce si liquida {modo === 'parti'
                ? <strong className="text-slate-400">a parti (30 fisse, mese commerciale)</strong>
                : <strong className="text-slate-400">a importo: si scrive sotto ogni mese</strong>}.
              {leggendo && <span className="text-amber-300/80"> CSA risponde in circa otto secondi
                per persona, sei alla volta: su un elenco lungo ci vuole qualche minuto.</span>}
            </p>
          </section>

          {/* ── 3. Righe ────────────────────────────────── */}
          <div className="flex items-baseline gap-3 flex-wrap text-sm">
            <p className="text-slate-400">
              <strong className="text-slate-200">{risolte}</strong> matricole risolte
              {daSistemare > 0 && <span className="text-amber-400"> · {daSistemare} da sistemare</span>}
              {nRigheCsv > 0 && <span className="text-slate-300"> · {nRigheCsv} righe da esportare</span>}
            </p>
            <button
              onClick={riverifica}
              disabled={riverificando || risolte === 0}
              title="Rilegge l’anagrafica e rimette in discussione ruoli e aree del conto"
              className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                         bg-slate-800 text-slate-200 border border-slate-700
                         hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {riverificando ? 'Riverifica in corso…' : 'Aggiorna ruoli e conti'}
            </button>
            <button
              onClick={() => setContiCsaAperto(true)}
              disabled={leggendoConti || risolte === 0}
              title="Legge le testate di una liquidazione CSA e confronta il conto su cui CSA ha pagato"
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                         bg-slate-800 text-slate-200 border border-slate-700
                         hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {leggendoConti ? 'Lettura da CSA…' : 'Verifica conti da CSA'}
            </button>
          </div>

          {contiCsaAperto && (
            <ModaleContiCsa
              ruoli={ruoliRighe}
              dataLiquidazione={meseLiquidazione ? `${meseLiquidazione}-01` : dataLiquidazione}
              leggendo={leggendoConti}
              onConferma={verificaContiDaCsa}
              onChiudi={() => setContiCsaAperto(false)}
            />
          )}

          {daConfermare.length > 0 && (
            <ModaleRiverifica
              voci={daConfermare}
              dateCompetenza={dateCompetenza}
              onApplica={(v, valore) => {
                const r = (righe ?? []).find(x => x.id === v.rigaId)
                if (!r) return
                if (v.tipo === 'ruolo') {
                  if (valore) aggiorna(r.id, { ruoliScelti: { ...r.ruoliScelti, [v.mese]: valore } })
                } else {
                  // Si segue l'anagrafica: via la scelta a mano (se c'era) e
                  // si prende la sua area CON la sua nazione. Prima si
                  // toglieva solo la scelta e la riga ricadeva sull'area
                  // salvata a suo tempo, non su quella proposta.
                  // Il segno lasciato da CSA segue: confermato se si e' presa
                  // la sua proposta, "diverso" se si e' presa quella
                  // dell'anagrafica sopra un conto che CSA aveva confermato.
                  const esitoCsa = v.tipo === 'csa' ? 'confermato' as const
                    : r.contoCsa?.esito === 'confermato' && r.contoCsa.area !== v.proposta ? 'diverso' as const
                    : null
                  aggiorna(r.id, {
                    areaContoScelta: null, areaConto: v.proposta, nazIban: v.nazProposta,
                    ...(esitoCsa && r.contoCsa ? { contoCsa: { ...r.contoCsa, esito: esitoCsa } } : {}),
                  })
                }
              }}
              onChiudi={() => setDaConfermare([])}
            />
          )}

          {righe.map(r => (
            <BloccoRiga
              key={r.id}
              r={r}
              modo={modo}
              mesiFinestra={mesiFinestra}
              onPatch={patch => aggiorna(r.id, patch)}
              onToggleMese={k => toggleMese(r.id, k)}
              onElimina={() => eliminaRiga(r.id)}
              anagrafiche={anagrafiche}
              storico={r.matricola ? storici[r.matricola] : undefined}
              dateCompetenza={dateCompetenza}
            />
          ))}

          {/* ── 4. Esportazione ─────────────────────────── */}
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-200">3 · Esportazione</h2>
            {problemi.length > 0 ? (
              <ul className="space-y-1.5">
                {problemi.map((p, i) => (
                  <li key={i} className="text-sm text-amber-300/90 flex gap-2">
                    <span className="text-amber-500">•</span>{p}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">
                Nessun problema rilevato. {nRigheCsv} righe pronte.
              </p>
            )}
            {mesiInUso.length > 0 && (
              <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 space-y-2">
                <p className="text-xs font-medium text-slate-400">Data di competenza</p>
                <p className="text-xs text-slate-500">
                  Va nella colonna <span className="font-mono">dataCompetenzaVoce</span> del CSV
                  ed è la data a cui viene letto il ruolo di ogni persona. Di norma l’ultimo
                  giorno del mese; spostala se un rapporto finisce prima e a fine mese
                  risulterebbe già quello nuovo. Vale per tutte le righe che hanno quel mese.
                </p>
                <div className="flex flex-wrap gap-3">
                  {mesiInUso.map(k => {
                    const val    = dataCompetenzaDi(k, dateCompetenza)
                    const spostata = Boolean(dateCompetenza[k])
                    return (
                      <label key={k} className="flex items-center gap-2 text-xs">
                        <span className={`w-24 ${spostata ? 'text-amber-300' : 'text-slate-400'}`}>
                          {etichettaMese(k)}
                        </span>
                        <input
                          type="date"
                          value={val}
                          onChange={e => setDateCompetenza(prev => {
                            const v = e.target.value
                            const next = { ...prev }
                            // Rimettere l'ultimo giorno del mese non e' una scelta:
                            // e' tornare al default, e il salvataggio non deve
                            // portarsi dietro una riga che non dice nulla.
                            if (!v || v === ultimoGiornoIso(k)) delete next[k]
                            else next[k] = v
                            return next
                          })}
                          className="px-2 py-1 rounded bg-slate-950 border border-slate-700
                                     text-slate-100 text-xs font-mono focus:outline-none
                                     focus:border-indigo-500"
                        />
                        {spostata && (
                          <button
                            onClick={() => setDateCompetenza(prev => {
                              const next = { ...prev }; delete next[k]; return next
                            })}
                            className="text-slate-500 hover:text-slate-300 underline decoration-dotted"
                          >
                            fine mese
                          </button>
                        )}
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={esporta}
                disabled={problemi.length > 0 || nRigheCsv === 0}
                className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white
                           text-sm font-medium transition-colors disabled:opacity-40
                           disabled:cursor-not-allowed"
              >
                Scarica CSV per HR Suite
              </button>

              {/* Il TXT non dipende dai controlli del CSV: dice a chi stiamo
                  pagando qualcosa, non come. Basta una matricola con area nota. */}
              <button
                onClick={scaricaMatricoleTxt}
                disabled={nMatricoleTxt === 0}
                title="Matricole divise per area del conto"
                className="px-5 py-2 rounded-lg text-sm font-medium transition-colors
                           bg-slate-800 text-slate-200 border border-slate-700
                           hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Scarica TXT matricole
                {nMatricoleTxt > 0 && <span className="text-slate-400"> ({nMatricoleTxt})</span>}
              </button>

              {/* Stesso Salva della barra in alto: chi arriva in fondo non
                  deve risalire per mettere al sicuro il lavoro. */}
              <button
                onClick={() => void salva(false)}
                disabled={salvando || !righe}
                className="px-5 py-2 rounded-lg text-sm font-medium transition-colors
                           bg-indigo-600 hover:bg-indigo-500 text-white
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Salva
              </button>
            </div>

            {/* Come spezzare i file. Si sceglie PRIMA di scaricare, perche'
                accorpare dopo si puo', separare no. */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">File:</span>
              {RAGGRUPPAMENTI.map(g => (
                <button
                  key={g.chiave}
                  onClick={() => setRaggrupTxt(g.chiave)}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-colors border ${
                    raggrupTxt === g.chiave
                      ? 'bg-slate-700 border-slate-600 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {g.etichetta}
                </button>
              ))}
              {fileTxt.length > 0 && (
                <span className="text-xs text-slate-500">
                  → {fileTxt.map(x => `${x.nome} (${x.matricole.length})`).join('  ·  ')}
                </span>
              )}
            </div>

            {(nMatricoleTxt > 0 || perAreaTxt.fuori.length > 0) && (
              <div className="mt-3 space-y-1 text-xs">
                {nMatricoleTxt > 0 && (
                  <p className="text-slate-400">
                    {AREE_TXT
                      .filter(a => (perAreaTxt.out[a.chiave]?.length ?? 0) > 0)
                      .map(a => `${a.nomeFile}: ${perAreaTxt.out[a.chiave]!.length}`)
                      .join('  ·  ')}
                  </p>
                )}
                {perAreaTxt.fuori.length > 0 && (
                  <p className="text-amber-400">
                    {perAreaTxt.fuori.length} matricola/e esclusa/e dai TXT — nessuna coordinata
                    CSA attiva in anagrafica:{' '}
                    {perAreaTxt.fuori
                      .map(r => `${r.nomeCompleto ?? r.nominativo} (${r.matricola})`)
                      .join(', ')}
                    . Non sappiamo in quale lista metterle: apri i dettagli della riga
                    (il pulsante con ruolo e conto) per assegnare l’area a mano.
                  </p>
                )}
              </div>
            )}
          </section>
        </>
      )}
        </>
      )}
      {archiviaTarget && (
        <ArchiviaLiquidazioneModal
          mode="archivia"
          nome={archiviaTarget.nome}
          initialData={{
            dataLiquidazione:  archiviaTarget.dataLiquidazione,
            idLiquidazioneCsa: archiviaTarget.idLiquidazioneCsa,
          }}
          onConfirm={async info => {
            try { await archiviaLavorazione(archiviaTarget.id, info) }
            catch (err) { showToast(messaggioErrore(err), 'error') }
          }}
          onClose={() => setArchiviaTarget(null)}
        />
      )}
    </div>
  )
}

// ── Componenti ────────────────────────────────────────────────

const btnPrimario =
  'px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm ' +
  'font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

const btnAzione =
  'px-3 py-1.5 rounded-lg text-sm border transition-colors flex items-center gap-1.5 ' +
  'bg-emerald-950/40 border-emerald-900/60 text-emerald-300 hover:bg-emerald-900/40 ' +
  'disabled:opacity-30 disabled:cursor-not-allowed'

const iconaCls =
  'p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors'

const btnSecondario =
  'px-4 py-2 rounded-lg bg-slate-800 text-slate-200 border border-slate-700 ' +
  'text-sm hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

const inputCls =
  'w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 ' +
  'text-sm focus:outline-none focus:border-indigo-500'

function Campo({ label, larghezza, children }: {
  label: string; larghezza: string; children: React.ReactNode
}) {
  return (
    <div className={larghezza}>
      <label className="block text-xs font-medium text-slate-400 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

/** "2026-06-03" → "03/06/2026". Vuoto o malformato → trattino. */
function gg(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—'
  const [y, m, d] = iso.split('-') as [string, string, string]
  return `${d}/${m}/${y}`
}

/**
 * Dettagli anagrafici di una persona: tutti i rapporti che PGS conosce per
 * quella matricola, piu' l'area del conto usata per dividere i TXT.
 *
 * Perche' serve. L'elenco mostra UN ruolo solo, quello con la decorrenza piu'
 * alta. Per i docenti basta: un ruolo dura anni. Per dottorandi e borsisti no —
 * sono contratti brevi in catena, e la stessa persona puo' essere stata DR fino
 * all'anno scorso ed essere BS adesso. Se il mese che si sta liquidando cade
 * nel periodo precedente, il ruolo giusto e' l'altro. Qui si vedono le date e
 * si decide, invece di scoprirlo dal CSV rifiutato.
 *
 * Niente di quel che si sceglie qui torna in anagrafica: resta nella
 * lavorazione, e si vede che e' stato deciso a mano. L'anagrafica si corregge
 * solo re-importando da SGE, che ne e' l'unica sorgente.
 */

/**
 * Il segno lasciato da "Verifica conti da CSA" sulla riga. Piccolo, perche'
 * sta nell'intestazione; il dettaglio (progressivi, motivo) e' nel title e
 * nel pannello dei dettagli anagrafici.
 */
function SegnoCsa({ c }: { c: ContoCsaRiga }) {
  const m = meseBreve(c.mese)
  const [testo, colore, spiega] =
      c.esito === 'confermato'          ? [`CSA ✓ ${m}`, 'text-emerald-400', `Conto confermato dalla liquidazione CSA di ${m}${c.progressivi ? ` (progressivi ${c.progressivi})` : ''}`]
    : c.esito === 'diverso'             ? [`CSA ≠ ${m}`, 'text-amber-300',   `CSA ha pagato su ${c.area ?? '?'} · ${c.naz ?? '?'} nella liquidazione di ${m}: la riga ha un altro conto`]
    : c.esito === 'da-chiarire'         ? [`CSA ? ${m}`, 'text-amber-300',   `Liquidazione CSA di ${m}: da chiarire (${c.motivo ?? 'motivo non indicato'})`]
    :                                     [`non in liq. ${m}`, 'text-slate-500', `Nessuna testata per questa matricola nella liquidazione CSA di ${m}`]
  return (
    <>
      <span className="text-slate-700">|</span>
      <span className={`font-mono ${colore}`} title={spiega}>{testo}</span>
    </>
  )
}

/**
 * La coda delle cose da confermare dopo "Aggiorna ruoli e conti".
 *
 * Una alla volta, come la modale dei ruoli in Liquidazioni: una domanda per
 * schermata si risponde, un elenco di venti si chiude e basta. "Lascia com'e'"
 * e' una risposta legittima e non cambia niente -- una scelta fatta a mano
 * resta valida finche' non e' chi l'ha fatta a cambiarla.
 */
function ModaleRiverifica({ voci, dateCompetenza, onApplica, onChiudi }: {
  voci:           VoceRiverifica[]
  dateCompetenza: Record<string, string>
  onApplica:      (v: VoceRiverifica, valore: string | null) => void
  onChiudi:       () => void
}) {
  const [i, setI] = useState(0)
  const v = voci[i]
  if (!v) return null

  function avanti() {
    if (i >= voci.length - 1) onChiudi()
    else setI(n => n + 1)
  }
  function scegli(valore: string | null) {
    onApplica(v!, valore)
    avanti()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
         role="dialog" aria-modal="true">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl">

        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <h2 className="text-white font-semibold">
              {v.tipo === 'ruolo' ? 'Quale ruolo per questo mese?'
                : v.tipo === 'csa' ? 'Conto su cui CSA ha pagato' : 'Area del conto cambiata'}
            </h2>
            <p className="text-slate-500 text-xs mt-0.5">{i + 1} di {voci.length}</p>
          </div>
          <button onClick={onChiudi} aria-label="Chiudi"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            ✕
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-800">
          <p className="text-white font-medium">{v.nominativo}</p>
          <p className="text-slate-400 text-sm font-mono mt-0.5">
            {v.matricola}
            {v.tipo === 'ruolo' && (
              <span className="text-slate-500">
                {' · '}{etichettaMese(v.mese)} · competenza {gg(dataCompetenzaDi(v.mese, dateCompetenza))}
              </span>
            )}
          </p>
        </div>

        <div className="px-5 py-4 space-y-2">
          {v.tipo === 'ruolo' ? (
            <>
              <p className="text-slate-400 text-xs mb-3">
                {v.aMano
                  ? <>Avevi scelto <span className="font-mono text-amber-300">{v.attuale}</span> a
                     mano. A questa data l’anagrafica ora dà{' '}
                     {v.opzioni.length > 1 ? 'più rapporti' : 'un rapporto diverso'}.</>
                  : <>A questa data risultano {v.opzioni.length} rapporti: il programma non sceglie
                     al posto tuo.</>}
              </p>
              {v.opzioni.map((o, k) => (
                <button key={`${o.ruolo}-${o.decorInq}-${k}`} onClick={() => scegli(o.ruolo)}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border
                                    text-left transition ${o.ruolo === v.attuale
                          ? 'bg-slate-800 border-amber-700/70'
                          : 'bg-slate-800 hover:bg-slate-700 border-slate-700 hover:border-indigo-600'}`}>
                  <span className="text-xs px-2 py-1 rounded bg-slate-700 text-slate-200
                                   font-mono font-medium shrink-0">{o.ruolo}</span>
                  <div className="flex-1 min-w-0">
                    {o.druolo && <p className="text-white text-sm truncate">{o.druolo}</p>}
                    <p className="text-slate-500 text-xs mt-0.5">
                      {gg(o.decorInq)} → {o.finRap ? gg(o.finRap) : 'aperto'}
                    </p>
                  </div>
                  {o.ruolo === v.attuale && <span className="text-amber-400/80 text-xs">scelto ora</span>}
                </button>
              ))}
            </>
          ) : (
            <>
              {v.tipo === 'csa' ? (
                <p className="text-slate-400 text-xs mb-3">
                  In questa lavorazione:{' '}
                  {v.attuale
                    ? <span className="font-mono text-amber-300">{v.attuale}{v.attualeNaz ? ` · ${v.attualeNaz}` : ''}</span>
                    : <span className="text-amber-300">nessuna area</span>}
                  {v.aMano && <span className="text-amber-500/70"> (a mano)</span>}.
                  {' '}Nella liquidazione CSA di {meseBreve(v.meseCsa)} ha pagato su{' '}
                  <span className="font-mono text-slate-200">{v.proposta} · {v.nazProposta}</span>.
                </p>
              ) : (
                <p className="text-slate-400 text-xs mb-3">
                  {v.aMano
                    ? <>Avevi assegnato <span className="font-mono text-amber-300">{v.attuale}</span> a mano.</>
                    : <>In questa lavorazione la riga ha <span className="font-mono text-amber-300">{v.attuale}</span>.</>}
                  {' '}L’anagrafica ora dice <span className="font-mono text-slate-200">{v.proposta}</span>
                  {v.nazProposta && <> (nazione <span className="font-mono">{v.nazProposta}</span>)</>}.
                </p>
              )}
              <button onClick={() => scegli(null)}
                      className="w-full px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700
                                 border border-slate-700 hover:border-indigo-600 text-left text-sm
                                 text-slate-200 transition">
                Usa <span className="font-mono">{v.proposta}</span>{' '}
                {v.tipo === 'csa' ? 'da CSA' : 'dall’anagrafica'}
                <span className="block text-slate-500 text-xs mt-0.5">
                  {v.tipo === 'csa'
                    ? `area e nazione della riga diventano quelle pagate da CSA${v.aMano ? ', e la scelta a mano si toglie' : ''}`
                    : v.aMano
                      ? 'toglie la scelta manuale: da qui in poi segue l’anagrafica'
                      : 'la riga perde l’area che aveva: “Lascia com’è” la conserva'}
                </span>
              </button>
            </>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-slate-800">
          <button onClick={avanti} className="text-slate-500 hover:text-slate-300 text-sm">
            Lascia com’è
          </button>
          <button onClick={onChiudi} className="text-slate-400 hover:text-slate-200 text-sm">
            Chiudi la coda
          </button>
        </div>
      </div>
    </div>
  )
}

function DettagliAnagrafici({ r, storico, ambigui, scoperti, dateCompetenza, onPatch, onChiudi }: {
  r:        RigaLavoro
  /** Storia gia' caricata in blocco dalla pagina. */
  storico?: StoricoRuoloApi[]
  /** Mese -> data di competenza, per sapere a che data leggere il ruolo. */
  dateCompetenza: Record<string, string>
  ambigui:  Array<{ mese: string; ruoli: string[] }>
  scoperti: string[]
  onPatch:  (patch: Partial<RigaLavoro>) => void
  onChiudi: () => void
}) {
  /** Se il caricamento in blocco non e' arrivato — o e' fallito — il pannello
   *  se la legge da solo: aprirlo deve funzionare comunque. */
  const [caricato, setCaricato] = useState<StoricoRuoloApi[] | null>(null)
  const [errore,   setErrore]   = useState<string | null>(null)
  const matricola = r.matricola
  const righe     = storico ?? caricato

  useEffect(() => {
    if (!matricola || storico) return
    let vivo = true
    emolumentiApi.storicoRuoli(matricola)
      .then(x => { if (vivo) setCaricato(x.storico) })
      .catch(err => { if (vivo) setErrore(messaggioErrore(err)) })
    return () => { vivo = false }
  }, [matricola, storico])

  /** Ruoli distinti trovati: se sono piu' d'uno la scelta non e' scontata. */
  const ruoliDistinti = new Set((righe ?? []).map(s => s.ruolo))

  /** Senza area del conto la persona resta fuori da TUTTI i TXT e non si puo'
   *  liquidare: in quel caso e' quella la cosa da sistemare, e la sua sezione
   *  va mostrata per prima. L'ordine e' dato con `order` invece di duplicare
   *  il JSX, cosi' esiste una sola versione di ciascun blocco. */
  const contoIgnoto = !AREE_TXT_CHIAVI.includes(areaDi(r) ?? '')

  return (
    <div className="px-5 py-4 bg-slate-950/60 border-b border-slate-800 flex flex-col gap-4">

      {/* Chiudi in testa al pannello: i due blocchi sotto si scambiano di
          posto, e un comando che si sposta con loro non si trova piu'. */}
      <div className="flex items-baseline">
        <p className="text-xs font-medium text-slate-400">Dettagli anagrafici</p>
        <button onClick={onChiudi} className="ml-auto text-xs text-slate-500 hover:text-slate-300">
          chiudi
        </button>
      </div>

      {/* ── L'ambiguità, per prima: è la cosa da decidere ──── */}
      {ambigui.length > 0 && (
        <div className="rounded-lg border border-amber-800/70 bg-amber-950/30 px-3 py-2">
          <p className="text-xs text-amber-200 font-medium mb-1">
            Su {ambigui.length === 1 ? 'un mese' : `${ambigui.length} mesi`} questa
            persona risulta avere più di un ruolo. Sceglilo tu.
          </p>
          <ul className="text-xs text-amber-300/90 space-y-0.5">
            {ambigui.map(a => (
              <li key={a.mese}>
                <span className="font-mono">{etichettaMese(a.mese)}</span>
                {' → '}
                <span className="font-mono">{a.ruoli.join(' oppure ')}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-amber-500/70 mt-1">
            Su borse e dottorati capita davvero: gli stessi mesi possono avere una
            borsa e un dottorato attivi insieme, e in CSA sono due rapporti distinti.
          </p>
        </div>
      )}

      {scoperti.length > 0 && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/25 px-3 py-2">
          <p className="text-xs text-red-300">
            Nessun rapporto in anagrafica copre{' '}
            <span className="font-mono">{scoperti.map(etichettaMese).join(', ')}</span>.
            Il CSV porterebbe un ruolo che l’anagrafica non conferma: controlla in CSA
            prima di esportare.
          </p>
          <p className="text-xs text-red-300/70 mt-1">
            Se il ruolo è certo, cliccalo qui sotto: vale per quei mesi ed è segnato «a mano».
            In alternativa sposta la «Data di competenza» del mese dentro un rapporto.
          </p>
        </div>
      )}

      {/* ── Ruoli ─────────────────────────────────────────── */}
      <div style={{ order: contoIgnoto ? 2 : 1 }}>
        <div className="flex items-baseline gap-3 mb-2">
          <p className="text-xs font-medium text-slate-400">Rapporti in anagrafica</p>
          {righe == null && !errore && (
            <p className="text-xs text-slate-500">lettura…</p>
          )}
          {righe != null && (
            <p className="text-xs text-slate-500">
              {righe.length} rapporto/i · {ruoliDistinti.size} ruolo/i distinto/i
            </p>
          )}
        </div>

        {errore && <p className="text-xs text-red-400">{errore}</p>}

        {righe != null && righe.length === 0 && (
          <p className="text-xs text-amber-400">
            Nessun rapporto in anagrafica per questa matricola: l’import SGE non la contiene.
          </p>
        )}

        {righe != null && righe.length > 0 && (
          <div className="rounded-lg border border-slate-800 divide-y divide-slate-800 overflow-hidden">
            {righe.map((s, i) => {
              // Quali dei mesi selezionati questo rapporto copre davvero.
              // E' l'informazione che rende la scelta possibile invece che
              // un confronto di date fatto a occhio -- ed e' anche l'insieme
              // di mesi su cui il clic ha effetto: si sceglie un rapporto, e
              // vale dove quel rapporto c'e'. Mai sui mesi che non copre.
              const coperti = [...r.mesiScelti].sort().filter(k => copreMese(s, k, dateCompetenza))
              // I mesi che NESSUN rapporto copre (per esempio un DR finito il
              // 18 con competenza al 30): li' il ruolo non si ricava, e deve
              // poterlo decidere l'operatore. Il clic vale anche su quelli;
              // l'avviso rosso resta, e il ruolo e' marcato "a mano".
              const applicabili = [...new Set([...coperti, ...scoperti])].sort()
              const attivo  = applicabili.length > 0
                && applicabili.every(k => ruoloDi(r, k, dateCompetenza, storico) === s.ruolo)
              return (
                <button
                  key={`${s.ruolo}-${s.decorInq}-${i}`}
                  onClick={() => onPatch({
                    ruoliScelti: {
                      ...r.ruoliScelti,
                      ...Object.fromEntries(applicabili.map(k => [k, s.ruolo])),
                    },
                  })}
                  disabled={applicabili.length === 0}
                  title={r.mesiScelti.size === 0
                    ? 'Seleziona prima i mesi da aggiungere: il ruolo si sceglie mese per mese'
                    : applicabili.length === 0
                      ? 'Questo rapporto non copre nessuno dei mesi selezionati'
                      : `Usa ${s.ruolo} per ${applicabili.map(etichettaMese).join(', ')}`
                        + (applicabili.length > coperti.length ? ' (anche dove nessun rapporto copre la data)' : '')}
                  className={`w-full text-left px-3 py-2 text-xs flex items-baseline gap-3 transition-colors ${
                    attivo ? 'bg-slate-800/70' : 'hover:bg-slate-800/40'
                  }`}
                >
                  <span className={`font-mono w-10 ${attivo ? 'text-indigo-300' : 'text-slate-300'}`}>
                    {s.ruolo}
                  </span>
                  <span className="text-slate-400 font-mono">
                    {gg(s.decorInq)} → {s.finRap ? gg(s.finRap) : 'aperto'}
                  </span>
                  {s.druolo && <span className="text-slate-500 truncate">{s.druolo}</span>}
                  {coperti.length > 0 && (
                    <span className="text-emerald-400/90 whitespace-nowrap">
                      copre {coperti.map(etichettaMese).join(', ')}
                    </span>
                  )}
                  {s.areaConto && (
                    <span className="ml-auto font-mono text-slate-600">{s.areaConto}</span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {[...r.mesiScelti].sort().map(k => {
            const ru     = ruoloDi(r, k, dateCompetenza, storico)
            const aMano  = Boolean(r.ruoliScelti[k])
            return (
              <span key={k} className="text-slate-500">
                {etichettaMese(k)}:{' '}
                <span className={`font-mono ${ru ? (aMano ? 'text-amber-300' : 'text-slate-300') : 'text-red-400'}`}>
                  {ru ?? 'da scegliere'}
                </span>
                {aMano && <span className="text-amber-500/70"> a mano</span>}
              </span>
            )
          })}
          {Object.keys(r.ruoliScelti).length > 0 && (
            <button
              onClick={() => onPatch({ ruoliScelti: {} })}
              className="text-slate-400 hover:text-slate-200 underline decoration-dotted"
            >
              togli le scelte a mano
            </button>
          )}
        </div>
      </div>

      {/* ── Area del conto ────────────────────────────────── */}
      <div style={{ order: contoIgnoto ? 1 : 2 }}>
        <p className="text-xs font-medium text-slate-400 mb-1">Area del conto (per i TXT)</p>
        <p className="text-xs text-slate-500 mb-2">
          {r.areaConto
            ? <>Sulla riga: <span className="font-mono text-slate-300">{r.areaConto}</span>
                {r.nazIban && <> (nazione <span className="font-mono text-slate-300">{r.nazIban}</span>)</>}
                {r.areaConto === 'NON_NOTO' && ' — nessuna nazione del conto: nessuna coordinata CSA attiva, oppure la persona non era nell’ultimo import con NAZ_IBAN.'}</>
            : <>Nessuna area su questa riga: quando la riga è stata caricata l’anagrafica non la dava.</>}
        </p>
        {r.contoCsa && (
          <p className="text-xs text-slate-500 mb-2">
            Liquidazione CSA di {meseBreve(r.contoCsa.mese)}
            {r.contoCsa.progressivo ? ` (progressivo ${r.contoCsa.progressivo})` : ''}:{' '}
            {r.contoCsa.esito === 'non-in-liquidazione'
              ? 'nessuna testata per questa matricola.'
              : r.contoCsa.esito === 'da-chiarire'
                ? <span className="text-amber-300">da chiarire — {r.contoCsa.motivo}.</span>
                : <>
                    pagata su <span className="font-mono text-slate-300">{r.contoCsa.area} · {r.contoCsa.naz}</span>
                    {r.contoCsa.esito === 'confermato'
                      ? <span className="text-emerald-400"> — confermato</span>
                      : <span className="text-amber-300"> — diverso da quello della riga, non applicato</span>}.
                  </>}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {AREE_TXT.map(a => {
            const attiva = areaDi(r) === a.chiave
            return (
              <button
                key={a.chiave}
                onClick={() => onPatch({ areaContoScelta: a.chiave })}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                  attiva
                    ? 'bg-slate-700 border-slate-600 text-white'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {a.nomeFile}
              </button>
            )
          })}
          {r.areaContoScelta && (
            <button
              onClick={() => onPatch({ areaContoScelta: null })}
              className="text-xs text-slate-400 hover:text-slate-200 underline decoration-dotted"
            >
              togli la scelta
            </button>
          )}
          <span className="text-xs text-amber-500/80">
            Assegnata a mano vale solo per questa lavorazione: non corregge l’anagrafica.
          </span>
        </div>
      </div>
    </div>
  )
}

function BloccoRiga({ r, modo, mesiFinestra, onPatch, onToggleMese, onElimina, anagrafiche, storico, dateCompetenza }: {
  r:            RigaLavoro
  dateCompetenza: Record<string, string>
  modo:         ModoValore
  mesiFinestra: string[]
  onPatch:      (patch: Partial<RigaLavoro>) => void
  onToggleMese: (k: string) => void
  onElimina:    () => void
  anagrafiche:  AnagraficaApi[]
  /** Storia dei ruoli della matricola, se gia' caricata in blocco. */
  storico?:     StoricoRuoloApi[]
}) {
  const anni = [...new Set(mesiFinestra.map(k => k.slice(0, 4)))]

  // Ricerca manuale per le righe che l'automatismo non ha risolto. Parte dal
  // nominativo incollato, ripulito dai token numerici: se l'incollato era
  // sporco, cercarlo tale e quale non troverebbe nulla.
  const [cerca, setCerca] = useState(
    r.nominativo.split(/\s+/).filter(t => !/^\d+$/.test(t)).join(' '),
  )

  /** Pannello dei dettagli anagrafici: chiuso finche' non serve. */
  const [dettagli, setDettagli] = useState(false)

  // Ambiguita' e scoperture sui mesi SELEZIONATI, cioe' su quelli che
  // finiranno davvero nel CSV. Si calcolano solo se lo storico e' gia' in
  // memoria; il pannello, quando lo si apre, se lo carica comunque da solo.
  const ambigui = useMemo(
    () => (storico ? mesiAmbigui(storico, r.mesiScelti, dateCompetenza) : []),
    [storico, r.mesiScelti, dateCompetenza],
  )
  const scoperti = useMemo(
    () => (storico ? mesiScoperti(storico, r.mesiScelti, dateCompetenza) : []),
    [storico, r.mesiScelti, dateCompetenza],
  )
  /** I ruoli mese per mese, come finiranno nel CSV. */
  const ruoliPerMese = useMemo(
    () => [...r.mesiScelti].sort().map(k => ({ mese: k, ruolo: ruoloDi(r, k, dateCompetenza, storico) })),
    [r, dateCompetenza, storico],
  )
  /**
   * C'e' da decidere finche' resta un mese senza ruolo. Non basta piu' "e'
   * ambiguo e non ha scelto": con la scelta per mese si puo' aver deciso
   * agosto e non settembre, e la riga va segnalata lo stesso.
   */
  const daDecidere = ruoliPerMese.some(x => x.ruolo === null)
  /** Mesi scoperti su cui l'operatore non ha ancora scelto a mano. */
  const scopertiSenzaScelta = useMemo(
    () => scoperti.filter(k => !r.ruoliScelti[k]),
    [scoperti, r.ruoliScelti],
  )
  /** I ruoli distinti fra i mesi scelti: se sono due, il badge lo dice. */
  const ruoliDistinti = useMemo(
    () => [...new Set(ruoliPerMese.map(x => x.ruolo).filter(Boolean) as string[])],
    [ruoliPerMese],
  )
  const qualcheScelta = Object.keys(r.ruoliScelti).length > 0
  const suggeriti = useMemo(() => {
    const q = cerca.trim().toLowerCase()
    if (q.length < 2 || r.matricola) return []
    return anagrafiche
      .filter(a => a.matricola.includes(q) || (a.cognNome ?? '').toLowerCase().includes(q))
      .slice(0, 8)
  }, [cerca, anagrafiche, r.matricola])

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <header className="px-5 py-3 border-b border-slate-800 flex items-center gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm text-white truncate">
            {r.nomeCompleto ?? r.nominativo}
          </p>
          {r.nomeCompleto && r.nomeCompleto !== r.nominativo && (
            <p className="text-xs text-slate-500 truncate">incollato: {r.nominativo}</p>
          )}
        </div>

        {r.matricola ? (
          <span className="font-mono text-sm text-indigo-300">{r.matricola}</span>
        ) : (
          <span className="text-xs text-amber-400">
            {r.esito === 'ambiguo' ? 'più persone corrispondono' : 'non trovato in anagrafiche'}
          </span>
        )}

        {/* Ruolo e area del conto: non piu' due etichette morte ma il modo per
            aprire i dettagli anagrafici e correggerli. Il pallino rosso
            sull'area vuol dire "resta fuori da tutti i TXT". */}
        {r.matricola && (
          <button
            onClick={() => setDettagli(d => !d)}
            title={daDecidere
              ? 'Su qualche mese il ruolo non si ricava da solo (più rapporti, o nessuno alla data): apri e scegli'
              : !AREE_TXT_CHIAVI.includes(areaDi(r) ?? '')
                ? 'Senza area del conto resta fuori da tutti i TXT: apri e assegnala'
                : 'Ruoli di questa matricola, e area del conto per i TXT'}
            className={`px-2 py-1 rounded-lg border text-xs flex items-center gap-2 transition-colors ${
              daDecidere
                ? 'bg-amber-950/40 border-amber-800/70 text-amber-200 hover:border-amber-700'
                : dettagli
                  ? 'bg-slate-800 border-slate-600 text-slate-200'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            {/* Un ruolo solo -> si mostra. Due o piu' -> si dice quanti, perche'
                "PA" da solo mentre meta' dei mesi sono DR e' una bugia. */}
            <span className={qualcheScelta ? 'text-amber-300' : ''}>
              {r.mesiScelti.size === 0
                ? 'scegli i mesi'
                : ruoliDistinti.length === 0
                ? 'ruolo da scegliere'
                : ruoliDistinti.length === 1
                  ? ruoliDistinti[0]
                  : `${ruoliDistinti.join('/')} per mese`}
            </span>
            {qualcheScelta && <span className="text-amber-500/70">a mano</span>}
            <span className="text-slate-700">|</span>
            {AREE_TXT_CHIAVI.includes(areaDi(r) ?? '') ? (
              <span className={`font-mono ${r.areaContoScelta ? 'text-amber-300' : 'text-slate-500'}`}>
                {areaDi(r)}
                {r.areaContoScelta && <span className="ml-1 text-amber-500/70">a mano</span>}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-red-400">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                conto ignoto
                <span className="text-red-300/70 underline decoration-dotted">assegna</span>
              </span>
            )}
            {r.contoCsa && <SegnoCsa c={r.contoCsa} />}
            {daDecidere && (
              <>
                <span className="text-amber-700">|</span>
                <span className="font-medium">
                  {/* Due cause diverse per un mese senza ruolo: piu' rapporti
                      (ambiguo) o nessun rapporto alla data (scoperto). Si dice
                      quale, e quanti: "ambiguo su 0 mesi" non vuol dire nulla. */}
                  {[
                    ambigui.length > 0
                      ? (ambigui.length === 1 ? 'ruolo ambiguo su 1 mese' : `ruolo ambiguo su ${ambigui.length} mesi`)
                      : null,
                    scopertiSenzaScelta.length > 0
                      ? (scopertiSenzaScelta.length === 1
                          ? '1 mese senza rapporto'
                          : `${scopertiSenzaScelta.length} mesi senza rapporto`)
                      : null,
                  ].filter(Boolean).join(' · ') || 'ruolo da scegliere'}
                </span>
              </>
            )}
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onElimina}
            title="Togli questa persona dall’elenco"
            className="px-2 py-1 rounded text-slate-500 hover:text-red-400
                       hover:bg-red-950/40 transition-colors text-sm"
          >
            ✕
          </button>
          <label className="text-xs text-slate-500">n. provv.</label>
          <input
            value={r.numeroProvvedimento}
            onChange={e => onPatch({ numeroProvvedimento: e.target.value })}
            className="w-28 px-2 py-1 rounded bg-slate-950 border border-slate-700
                       text-slate-100 text-sm font-mono focus:outline-none focus:border-indigo-500"
          />
          <label className="text-xs text-slate-500">del</label>
          <input
            type="date"
            value={r.dataProvvedimento}
            onChange={e => onPatch({ dataProvvedimento: e.target.value })}
            className="w-36 px-2 py-1 rounded bg-slate-950 border border-slate-700
                       text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
          />
        </div>
      </header>

      {dettagli && r.matricola && (
        <DettagliAnagrafici
          r={r} storico={storico} ambigui={ambigui} scoperti={scoperti}
          dateCompetenza={dateCompetenza}
          onPatch={onPatch} onChiudi={() => setDettagli(false)}
        />
      )}

      {/* Nome ambiguo: sceglie l'operatore, mai il programma */}
      {r.esito === 'ambiguo' && !r.matricola && (
        <div className="px-5 py-3 bg-amber-950/20 border-b border-slate-800">
          <p className="text-xs text-amber-300/90 mb-2">
            Scegli la persona giusta: il nome incollato corrisponde a {r.candidati.length} anagrafiche.
          </p>
          <div className="flex flex-wrap gap-2">
            {r.candidati.map(c => (
              <button
                key={c.matricola}
                onClick={() => onPatch({
                  matricola: c.matricola, nomeCompleto: c.nomeCompleto, ruolo: c.ruolo,
                  // Cambia la persona: le scelte fatte a mano sulla precedente
                  // non la seguono.
                  ruoliScelti: {}, areaContoScelta: null,
                })}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700
                           text-sm text-slate-200 transition-colors"
              >
                <span className="font-mono text-indigo-300 mr-2">{c.matricola}</span>
                {c.nomeCompleto}
              </button>
            ))}
          </div>
        </div>
      )}

      {!r.matricola && (
        <div className="px-5 py-3 bg-amber-950/20 border-b border-slate-800 space-y-2">
          <p className="text-xs text-amber-300/90">
            {r.esito === 'ambiguo'
              ? 'Nessuno dei candidati è quello giusto? Cerca in anagrafiche:'
              : 'Nessuna corrispondenza automatica. Cerca in anagrafiche:'}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={cerca}
              onChange={e => setCerca(e.target.value)}
              placeholder="Cognome, nome o matricola"
              className="flex-1 min-w-[14rem] px-2 py-1 rounded bg-slate-950 border border-slate-700
                         text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
            />
            <span className="text-xs text-slate-500">oppure matricola a mano</span>
            <input
              placeholder="090027"
              onChange={e => {
                const v = e.target.value.trim()
                onPatch({
                  matricola: v ? v.padStart(6, '0') : null,
                  ruoliScelti: {}, areaContoScelta: null,
                })
              }}
              className="w-28 px-2 py-1 rounded bg-slate-950 border border-slate-700
                         text-slate-100 text-sm font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>

          {suggeriti.length > 0 && (
            <div className="rounded-lg border border-slate-800 divide-y divide-slate-800 max-h-56 overflow-auto">
              {suggeriti.map(a => (
                <button
                  key={a.matricola}
                  onClick={() => onPatch({
                    matricola:    a.matricola,
                    nomeCompleto: a.cognNome,
                    ruolo:        a.ruolo,
                    areaConto:    a.areaConto ?? null,
                    nazIban:      a.nazIban ?? null,
                    esito:        'trovato',
                    ruoliScelti:  {},
                    areaContoScelta: null,
                  })}
                  className="w-full text-left px-3 py-2 hover:bg-slate-800/50 transition
                             flex items-baseline gap-3"
                >
                  <span className="font-mono text-xs text-indigo-300">{a.matricola}</span>
                  <span className="text-sm text-slate-100">{a.cognNome}</span>
                  <span className="text-xs text-slate-500">{a.ruolo}</span>
                  {a.areaConto && (
                    <span className="ml-auto text-xs font-mono text-slate-500">{a.areaConto}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {cerca.trim().length >= 2 && suggeriti.length === 0 && (
            <p className="text-xs text-slate-500">Nessun risultato in anagrafiche.</p>
          )}
        </div>
      )}

      {r.csaErrore && (
        <p className="px-5 py-2 text-xs text-red-400 border-b border-slate-800">{r.csaErrore}</p>
      )}

      {r.matricola && (
        <div className="px-5 py-4 space-y-4">
          {/* Mesi */}
          <div>
            <div className="flex items-baseline gap-3 mb-2">
              <p className="text-xs font-medium text-slate-400">Mesi da aggiungere</p>
              {!r.csaLetto && (
                <p className="text-xs text-amber-400">CSA non ancora letto per questa persona</p>
              )}
              {r.csaLetto && (
                <p className="text-xs text-slate-500">
                  {r.mesiInCsa.size} già in CSA, non selezionabili
                </p>
              )}
            </div>
            {anni.map(anno => (
              <div key={anno} className="flex items-start gap-1.5 flex-wrap mb-2">
                <span className="w-10 pt-1.5 text-xs text-slate-500 font-mono">{anno}</span>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
                  const k = chiaveMese(Number(anno), m)
                  const inCsa  = r.mesiInCsa.has(k)
                  const scelto = r.mesiScelti.has(k)
                  return (
                    <div key={k} className="flex flex-col items-stretch gap-0.5">
                      <button
                        onClick={() => onToggleMese(k)}
                        disabled={inCsa}
                        title={inCsa ? `${etichettaMese(k)}: già presente in CSA` : etichettaMese(k)}
                        className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                          inCsa
                            ? 'bg-slate-800/60 text-slate-600 line-through cursor-not-allowed'
                            : scelto
                              ? 'bg-emerald-600/30 text-emerald-300 ring-1 ring-emerald-500/40'
                              : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
                        }`}
                      >
                        {MESI_BREVI[m]}
                      </button>
                      {/* Mese gia' in CSA: si mostra quanto vale, in sola lettura.
                          Serve a vedere lo storico degli importi mentre si
                          compilano i mesi nuovi. */}
                      {inCsa && (
                        <>
                          <span
                            title={`${etichettaMese(k)} — già in CSA`}
                            className="w-[4.5rem] px-1 text-[11px] text-right font-mono
                                       text-slate-500 truncate"
                          >
                            {modo === 'importo'
                              ? (r.csaPerMese[k]?.importo != null ? importoInput(r.csaPerMese[k]!.importo!) : '—')
                              : (r.csaPerMese[k]?.parti ?? '—')}
                          </span>
                          {/* Centro di costo di quel mese, in sigla: cambia nel tempo
                              (§6.3) e vederlo qui evita di andarlo a cercare. */}
                          {siglaCentroDiCosto(r.csaPerMese[k]?.centroDiCosto ?? null) && (
                            <span
                              title={r.csaPerMese[k]!.centroDiCosto!}
                              className="w-[4.5rem] px-1 text-[10px] text-right font-mono
                                         text-slate-600 truncate"
                            >
                              {siglaCentroDiCosto(r.csaPerMese[k]!.centroDiCosto)}
                            </span>
                          )}
                        </>
                      )}

                      {/* Voce a importo: quanto vale la borsa quel mese. */}
                      {modo === 'importo' && scelto && !inCsa && (
                        <input
                          value={r.importi[k] ?? ''}
                          onChange={e => onPatch({ importi: { ...r.importi, [k]: e.target.value } })}
                          placeholder="importo"
                          title={`Importo della borsa — ${etichettaMese(k)}`}
                          className="w-[4.5rem] px-1 py-0.5 rounded bg-slate-950 border border-slate-700
                                     text-slate-100 text-[11px] text-right font-mono
                                     placeholder:font-sans placeholder:text-slate-600
                                     focus:outline-none focus:border-indigo-500"
                        />
                      )}
                    </div>
                  )
                })}
                {/* Ricopia il primo importo scritto sugli altri mesi scelti dell'anno:
                    la borsa e' quasi sempre uguale, ma resta modificabile mese per mese. */}
                {modo === 'importo' && (
                  <button
                    onClick={() => {
                      const mesiAnno = [...r.mesiScelti].filter(k => k.startsWith(anno)).sort()
                      const primo = mesiAnno.map(k => r.importi[k]).find(v => v && v.trim())
                      if (!primo) return
                      const next = { ...r.importi }
                      for (const k of mesiAnno) next[k] = primo
                      onPatch({ importi: next })
                    }}
                    title="Ricopia il primo importo su tutti i mesi scelti dell’anno"
                    className="mt-0.5 px-2 py-1 rounded text-xs text-slate-500
                               hover:text-white hover:bg-slate-800 transition-colors"
                  >= a tutti</button>
                )}
              </div>
            ))}
          </div>

          {/* Centro di costo — per riga, non per gruppo (§6.3) */}
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-slate-400 shrink-0">Centro di costo</label>
            <input
              value={r.centroDiCosto}
              onChange={e => onPatch({ centroDiCosto: e.target.value })}
              placeholder="vuoto = nessuno"
              className="flex-1 px-3 py-1.5 rounded bg-slate-950 border border-slate-700
                         text-slate-100 text-sm font-mono placeholder:font-sans
                         placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * Importo del mese precedente: si va a ritroso fino a due anni e si prende il
 * primo valore disponibile, dando la precedenza a quello digitato dall'operatore
 * su quello letto da CSA. Stringa vuota se non c'e' niente da cui ereditare.
 */
function importoMesePrecedente(r: RigaLavoro, k: string): string {
  let y = Number(k.slice(0, 4))
  let m = Number(k.slice(5, 7))
  for (let i = 0; i < 24; i++) {
    m -= 1
    if (m === 0) { m = 12; y -= 1 }
    const kk = chiaveMese(y, m)
    const digitato = (r.importi[kk] ?? '').trim()
    if (digitato) return digitato
    const daCsa = r.csaPerMese[kk]?.importo
    if (daCsa != null) return importoInput(daCsa)
  }
  return ''
}

/** Centro di costo proposto: quello della competenza CSA più recente. */
function centroDiCostoProposto(voci: VoceCsaApi[]): string {
  const conCdc = voci
    .filter(v => v.codiceCentroDiCosto && !/^0+$/.test(v.codiceCentroDiCosto))
    .sort((a, b) => (b.dataCompetenzaVoce ?? '').localeCompare(a.dataCompetenzaVoce ?? ''))
  return conCdc[0]?.codiceCentroDiCosto ?? ''
}

// ── Errori ────────────────────────────────────────────────────

function messaggioErrore(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.message === 'CINECA_NON_CONFIGURATO') {
      return 'Integrazione CINECA non configurata su questo server.'
    }
    if (err.message === 'CINECA_UNREACHABLE') {
      return 'CSA-WS non raggiungibile. Se il server è fuori dall’Italia, controlla che il proxy sia attivo in Impostazioni.'
    }
    if (err.message === 'CINECA_API_ERROR') {
      return 'CSA-WS ha risposto con un errore. Riprova fra poco.'
    }
  }
  return 'Operazione fallita.'
}
