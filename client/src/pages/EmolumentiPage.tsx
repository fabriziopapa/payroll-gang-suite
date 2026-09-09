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

import { useEffect, useMemo, useState } from 'react'
import {
  emolumentiApi, vociApi, anagraficheApi,
  type RigaRisoltaApi, type CandidatoApi, type VoceCsaApi, type VoceApi,
  type LavorazioneApi, type AnagraficaApi, type LiquidazioneInfo,
} from '../api/endpoints'
import { ApiError } from '../api/client'
import { showToast } from '../components/ToastManager'
import { ConfirmDialog } from '../components/ConfirmDialog'
// Stesso modale dell'archiviazione delle liquidazioni, importato in SOLA
// LETTURA (vincolo §8.1): l'utente ritrova la maschera che gia' conosce,
// con gli stessi campi e le stesse parole.
import ArchiviaLiquidazioneModal from '../components/ArchiviaLiquidazioneModal'
import { serializeCsv, downloadCsv, lastDayOfMonth } from '../utils/biz'
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
const VERSIONE_PAYLOAD = 1

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
  const [risolvendo, setRisolvendo] = useState(false)

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

  /** "BS settembre 2026": tipo, mese corrente per esteso, anno. */
  function nomeProposto(t: string): string {
    const oggi = new Date()
    const mese = oggi.toLocaleDateString('it-IT', { month: 'long' })
    return `${t || 'Emolumenti'} ${mese} ${oggi.getFullYear()}`
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

  /** Copia una lavorazione, contenuto compreso. Utile per ripetere lo stesso
   *  elenco il mese dopo senza reincollare i nominativi. */
  async function duplica(l: LavorazioneApi) {
    setSalvando(true)
    try {
      const orig = await emolumentiApi.lavorazione(l.id)
      const row  = await emolumentiApi.creaLavorazione({
        nome: `${l.nome} (copia)`,
        ...(l.tipo ? { tipo: l.tipo } : {}),
        dati: orig.dati,
      })
      await caricaElenco()
      showToast(`Creata "${row.nome}".`, 'success')
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
      const area = r.areaConto ?? ''
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
    return out
  }, [righe, tipoProv, voce, modo])

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
        out.push({
          matricola: r.matricola,
          comparto:  '1',
          ruolo:     r.ruolo ?? '',
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
          dataCompetenzaVoce: lastDayOfMonth(`${m}/${y}`),
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
                  <p className="text-xs text-slate-500">
                    {l.tipo ? `${l.tipo} · ` : ''}
                    Modificato {new Date(l.updatedAt).toLocaleDateString('it-IT')}
                    {l.dataLiquidazione ? ` · liquidata ${l.dataLiquidazione}` : ''}
                    {l.idLiquidazioneCsa ? ` · ${l.idLiquidazioneCsa}` : ''}
                  </p>
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

                  <button onClick={() => void duplica(l)} title="Duplica" className={iconaCls}>
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
          </div>

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
                    . Vanno verificate a mano: non sappiamo in quale lista metterle.
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

function BloccoRiga({ r, modo, mesiFinestra, onPatch, onToggleMese, onElimina, anagrafiche }: {
  r:            RigaLavoro
  modo:         ModoValore
  mesiFinestra: string[]
  onPatch:      (patch: Partial<RigaLavoro>) => void
  onToggleMese: (k: string) => void
  onElimina:    () => void
  anagrafiche:  AnagraficaApi[]
}) {
  const anni = [...new Set(mesiFinestra.map(k => k.slice(0, 4)))]

  // Ricerca manuale per le righe che l'automatismo non ha risolto. Parte dal
  // nominativo incollato, ripulito dai token numerici: se l'incollato era
  // sporco, cercarlo tale e quale non troverebbe nulla.
  const [cerca, setCerca] = useState(
    r.nominativo.split(/\s+/).filter(t => !/^\d+$/.test(t)).join(' '),
  )
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
          <span className="font-mono text-sm text-indigo-300 flex items-center gap-1.5">
            {r.matricola}
            {/* Area del conto ignota: finirebbe fuori da tutti i TXT. */}
            {!AREE_TXT_CHIAVI.includes(r.areaConto ?? '') && (
              <span
                title="Nessuna coordinata CSA attiva in anagrafica: resta fuori dai TXT per area"
                className="w-2 h-2 rounded-full bg-red-500 inline-block"
              />
            )}
          </span>
        ) : (
          <span className="text-xs text-amber-400">
            {r.esito === 'ambiguo' ? 'più persone corrispondono' : 'non trovato in anagrafiche'}
          </span>
        )}
        {r.ruolo && <span className="text-xs text-slate-500">{r.ruolo}</span>}

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
                onPatch({ matricola: v ? v.padStart(6, '0') : null })
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
                    esito:        'trovato',
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
