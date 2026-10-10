// ============================================================
// PAYROLL GANG SUITE — Area Emolumenti · piu' provvedimenti per persona
//
// Una persona puo' avere PIU' provvedimenti nella stessa lavorazione:
//   CCCCC del 14/09/2026 concede la maggiorazione di agosto,
//   VVVVV del 01/10/2026 concede settembre e ottobre.
// La riga resta UNA (una matricola, una lettura CSA, un ruolo per mese,
// un TXT) e i provvedimenti stanno DENTRO la riga. Ogni mese scelto
// appartiene a UN SOLO provvedimento: due provvedimenti sullo stesso mese
// vorrebbero dire due righe con la stessa competenza nel CSV, cioe' il
// doppione che l'area esiste per impedire.
//
// Qui c'e' solo logica pura, senza React: e' la parte che decide che cosa
// finisce nel CSV, quindi e' quella che va provata (provvedimentiRiga.test.ts).
// ============================================================

/** Un provvedimento della riga: per ESTREMI (§6.4), mai l'identificativo. */
export interface ProvvRiga {
  /** Stabile dentro la riga: i mesi puntano all'id, non alla posizione. */
  id:     number
  numero: string
  /** ISO AAAA-MM-GG; '' = non ancora indicata. */
  data:   string
}

/** La parte della riga di lavoro che riguarda i provvedimenti. */
export interface StatoProvv {
  /** Sempre almeno uno. Con uno solo la schermata e' quella di sempre. */
  provvedimenti: ProvvRiga[]
  /** Mese scelto "AAAA-MM" -> id del provvedimento che lo concede. */
  provvPerMese:  Record<string, number>
  /** Mesi da aggiungere: e' lo stesso insieme di prima, non cambia forma. */
  mesiScelti:    Set<string>
}

const MESI = ['', 'gen', 'feb', 'mar', 'apr', 'mag', 'giu',
  'lug', 'ago', 'set', 'ott', 'nov', 'dic']

/** "2026-10-05" -> "05/10/2026". */
function ggmmaaaa(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

/** "2026-08" -> "ago 2026". */
function meseBreve(k: string): string {
  return `${MESI[Number(k.slice(5, 7))] ?? k} ${k.slice(0, 4)}`
}

/** 0 -> A, 1 -> B, ... 25 -> Z, 26 -> AA. Oltre la Z non serve, ma non si rompe. */
export function letteraProvv(i: number): string {
  let n = i
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

export function provvVuoto(id: number, data = ''): ProvvRiga {
  return { id, numero: '', data }
}

/** Primo id libero: gli id non si riusano, cosi' un mese non cambia padrone da solo. */
export function prossimoIdProvv(lista: ProvvRiga[]): number {
  return lista.reduce((m, p) => Math.max(m, p.id), -1) + 1
}

/** Il provvedimento che concede il mese k, oppure null (mese non scelto o senza provvedimento). */
export function provvDelMese(r: StatoProvv, k: string): ProvvRiga | null {
  if (!r.mesiScelti.has(k)) return null
  const id = r.provvPerMese[k]
  if (id === undefined) return null
  return r.provvedimenti.find(p => p.id === id) ?? null
}

/** I mesi scelti di un provvedimento, in ordine. */
export function mesiDelProvv(r: StatoProvv, id: number): string[] {
  return [...r.mesiScelti].filter(k => r.provvPerMese[k] === id).sort()
}

/**
 * Rimette la riga in una forma valida:
 *   - almeno un provvedimento;
 *   - nella mappa solo i mesi scelti, e solo verso provvedimenti che esistono.
 * Un mese scelto senza provvedimento valido va all'unico provvedimento SE ce
 * n'e' uno solo (e' l'unica risposta possibile). Con piu' provvedimenti resta
 * senza: indovinare quale sarebbe sbagliare in silenzio, e `problemiProvv`
 * ferma l'export finche' qualcuno non sceglie.
 */
export function normalizzaProvv<T extends StatoProvv>(r: T): T {
  const provvedimenti = r.provvedimenti.length > 0 ? r.provvedimenti : [provvVuoto(0)]
  const ids   = new Set(provvedimenti.map(p => p.id))
  const unico = provvedimenti.length === 1 ? provvedimenti[0]!.id : null
  const provvPerMese: Record<string, number> = {}
  for (const k of r.mesiScelti) {
    const id = r.provvPerMese[k]
    if (id !== undefined && ids.has(id)) provvPerMese[k] = id
    else if (unico !== null) provvPerMese[k] = unico
  }
  return { ...r, provvedimenti, provvPerMese }
}

/**
 * Provvedimenti di una riga letta da un salvataggio. Difensiva di proposito:
 * il JSON arriva dal database, non dal compilatore.
 *
 * MIGRAZIONE payload v1/v2 -> v3. Prima la riga aveva un solo numero e una
 * sola data, validi per tutti i mesi: diventano l'unico provvedimento, con
 * tutti i mesi scelti assegnati a lui. Si riapre esattamente cio' che si era
 * salvato, e il CSV esce identico.
 */
export function provvDaPayload(
  o: Record<string, unknown>,
  mesiScelti: string[],
): { provvedimenti: ProvvRiga[]; provvPerMese: Record<string, number> } {
  const lista = o['provvedimenti']
  if (Array.isArray(lista) && lista.length > 0) {
    let provvedimenti: ProvvRiga[] = lista.map((x, i) => {
      const p = (x ?? {}) as Record<string, unknown>
      return {
        id:     typeof p['id'] === 'number' && Number.isInteger(p['id']) ? p['id'] : i,
        numero: String(p['numero'] ?? ''),
        data:   String(p['data'] ?? ''),
      }
    })
    let provvPerMese: Record<string, number> = {}
    const m = o['provvPerMese']
    if (m && typeof m === 'object' && !Array.isArray(m)) {
      for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isInteger(v)) provvPerMese[k] = v
      }
    }
    // Id doppi: la mappa non sa piu' a chi puntava. Si rinumera e la si
    // butta: con un provvedimento solo la ricostruisce normalizzaProvv, con
    // piu' d'uno i mesi restano da riassegnare e l'export lo dice.
    if (new Set(provvedimenti.map(p => p.id)).size !== provvedimenti.length) {
      provvedimenti = provvedimenti.map((p, i) => ({ ...p, id: i }))
      provvPerMese  = {}
    }
    return { provvedimenti, provvPerMese }
  }

  return {
    provvedimenti: [{
      id:     0,
      numero: String(o['numeroProvvedimento'] ?? ''),
      data:   String(o['dataProvvedimento'] ?? ''),
    }],
    provvPerMese: Object.fromEntries(mesiScelti.map(k => [k, 0])),
  }
}

export type EsitoMese = 'aggiunto' | 'spostato' | 'tolto' | 'invariato'

/**
 * Clic su un mese con un provvedimento attivo:
 *   - mese libero                     -> si sceglie e va a quel provvedimento;
 *   - mese di un ALTRO provvedimento  -> passa a quello attivo;
 *   - mese gia' di quel provvedimento -> si toglie.
 * Con un provvedimento solo e' esattamente il clic di sempre (scegli/togli).
 * Il controllo "gia' in CSA" resta fuori: e' della pagina.
 */
export function assegnaMese<T extends StatoProvv>(r: T, k: string, provvId: number): { riga: T; esito: EsitoMese } {
  if (!r.provvedimenti.some(p => p.id === provvId)) return { riga: r, esito: 'invariato' }
  const mesiScelti   = new Set(r.mesiScelti)
  const provvPerMese = { ...r.provvPerMese }
  let esito: EsitoMese
  if (!mesiScelti.has(k)) {
    mesiScelti.add(k)
    provvPerMese[k] = provvId
    esito = 'aggiunto'
  } else if (provvPerMese[k] !== provvId) {
    provvPerMese[k] = provvId
    esito = 'spostato'
  } else {
    mesiScelti.delete(k)
    delete provvPerMese[k]
    esito = 'tolto'
  }
  return { riga: { ...r, mesiScelti, provvPerMese }, esito }
}

/** Clic sulla lettera sotto il mese: il mese passa al provvedimento successivo (A -> B -> A). */
export function provvSuccessivo<T extends StatoProvv>(r: T, k: string): T {
  if (!r.mesiScelti.has(k) || r.provvedimenti.length < 2) return r
  const i = r.provvedimenti.findIndex(p => p.id === r.provvPerMese[k])
  const prossimo = r.provvedimenti[(i + 1) % r.provvedimenti.length]!
  return { ...r, provvPerMese: { ...r.provvPerMese, [k]: prossimo.id } }
}

/** Toglie i mesi dalla riga (per esempio perche' risultano gia' in CSA). */
export function togliMesi<T extends StatoProvv>(r: T, mesi: Set<string>): T {
  const mesiScelti = new Set([...r.mesiScelti].filter(k => !mesi.has(k)))
  const provvPerMese = Object.fromEntries(
    Object.entries(r.provvPerMese).filter(([k]) => mesiScelti.has(k)),
  )
  return { ...r, mesiScelti, provvPerMese }
}

/** Aggiunge un provvedimento vuoto, da compilare a mano. */
export function nuovoProvv<T extends StatoProvv>(r: T, dataPredefinita = ''): { riga: T; id: number } {
  const id = prossimoIdProvv(r.provvedimenti)
  return { riga: { ...r, provvedimenti: [...r.provvedimenti, provvVuoto(id, dataPredefinita)] }, id }
}

/**
 * Toglie un provvedimento. Solo se ne resta almeno un altro e se non concede
 * nessun mese: toglierlo con dei mesi lascerebbe quei mesi senza estremi, o
 * li sposterebbe su un altro provvedimento senza che nessuno l'abbia deciso.
 */
export function rimuoviProvv<T extends StatoProvv>(r: T, id: number): T {
  if (r.provvedimenti.length < 2) return r
  if (mesiDelProvv(r, id).length > 0) return r
  return { ...r, provvedimenti: r.provvedimenti.filter(p => p.id !== id) }
}

export function aggiornaProvv<T extends StatoProvv>(r: T, id: number, patch: Partial<Omit<ProvvRiga, 'id'>>): T {
  return { ...r, provvedimenti: r.provvedimenti.map(p => (p.id === id ? { ...p, ...patch } : p)) }
}

/**
 * "a tutte" della data predefinita: compila SOLO le date vuote. Prima
 * sovrascriveva la data di ogni riga; con piu' provvedimenti avrebbe
 * cancellato date diverse fra loro, che sono proprio il motivo di averne piu'.
 */
export function completaDate<T extends StatoProvv>(r: T, data: string): T {
  if (!data || r.provvedimenti.every(p => p.data)) return r
  return { ...r, provvedimenti: r.provvedimenti.map(p => (p.data ? p : { ...p, data })) }
}

export type EsitoAccoda =
  | 'aggiunto'      // provvedimento nuovo sulla riga
  | 'completato'    // riempito un provvedimento ancora vuoto, o la sua data
  | 'gia-presente'  // stesso numero (e stessa data, o nessuna data incollata)
  | 'data-diversa'  // stesso numero con un'altra data: si tiene quella che c'era
  | 'senza-numero'  // niente da aggiungere

/**
 * Lo stesso nominativo incollato di nuovo con un altro numero: il numero
 * diventa un provvedimento in piu' della STESSA riga, invece di sparire come
 * "gia' presente". E' il caso per cui questo modulo esiste.
 *
 * `data` e' solo quella incollata ('' se la riga non l'aveva): si confronta
 * quella. `dataPredefinita` serve solo a compilare un provvedimento nuovo,
 * cosi' una riga senza data non sembra "diversa" da una che ce l'ha.
 */
export function accodaProvv<T extends StatoProvv>(
  r: T, numero: string, data: string, dataPredefinita = '',
): { riga: T; esito: EsitoAccoda } {
  const n = numero.trim()
  if (!n) return { riga: r, esito: 'senza-numero' }

  const stesso = r.provvedimenti.find(p => p.numero.trim() === n)
  if (stesso) {
    if (!data || stesso.data === data) return { riga: r, esito: 'gia-presente' }
    if (!stesso.data) return { riga: aggiornaProvv(r, stesso.id, { data }), esito: 'completato' }
    return { riga: r, esito: 'data-diversa' }
  }

  // Un provvedimento ancora senza numero (riga aggiunta dalla ricerca, o
  // incollata senza numero) si riempie invece di affiancargliene un altro.
  const vuoto = r.provvedimenti.find(p => !p.numero.trim())
  if (vuoto) {
    return {
      riga:  aggiornaProvv(r, vuoto.id, { numero: n, data: data || vuoto.data || dataPredefinita }),
      esito: 'completato',
    }
  }

  const id = prossimoIdProvv(r.provvedimenti)
  return {
    riga:  { ...r, provvedimenti: [...r.provvedimenti, { id, numero: n, data: data || dataPredefinita }] },
    esito: 'aggiunto',
  }
}

/** Quanto serve dei controlli: la riga con i suoi provvedimenti e chi e'. */
export interface RigaControllo extends StatoProvv {
  nominativo: string
  matricola:  string | null
}

function elenco(xs: string[], max = 6): string {
  return xs.slice(0, max).join(', ') + (xs.length > max ? '…' : '')
}

// ── Stesso numero su piu' persone ─────────────────────────────────────
//
// Di norma e' un refuso (il precedente: 000025996 su due matricole e
// 000025998 mai usato), ma un atto puo' anche coprire piu' dottorandi. Quindi
// e' BLOCCANTE finche' qualcuno non conferma, per QUEL numero e QUELLE
// matricole, che si tratta dello stesso atto. La conferma si salva nella
// lavorazione e resta visibile; decade da sola se cambia l'insieme delle
// matricole o la data. Stesso numero con date diverse non e' confermabile:
// un atto non ha due date.

/** Una conferma "stesso atto": per quali matricole, con quale data, quando. */
export interface ConfermaCondiviso {
  /** Ordinate: e' l'insieme esatto che e' stato confermato. */
  matricole: string[]
  /** Data dell'atto al momento della conferma (ISO, '' se mancava). */
  data:      string
  /** Quando e' stata data, ISO. Solo per mostrarla. */
  il:        string
}

/** Numero di provvedimento -> conferma. Sta nel payload della lavorazione. */
export type ProvvCondivisi = Record<string, ConfermaCondiviso>

/** Un numero che compare su piu' matricole, fra i provvedimenti che concedono mesi. */
export interface NumeroCondiviso {
  numero:    string
  /** Ordinate. */
  matricole: string[]
  persone:   Array<{ matricola: string; nominativo: string }>
  /** Date distinte non vuote, ordinate. Piu' di una = non confermabile. */
  date:      string[]
}

export function numeriCondivisi(righe: RigaControllo[]): NumeroCondiviso[] {
  const per = new Map<string, { persone: Map<string, string>; date: Set<string> }>()
  for (const r of righe) {
    if (r.mesiScelti.size === 0 || !r.matricola) continue
    for (const p of r.provvedimenti) {
      const n = p.numero.trim()
      if (!n || mesiDelProvv(r, p.id).length === 0) continue
      if (!per.has(n)) per.set(n, { persone: new Map(), date: new Set() })
      const x = per.get(n)!
      if (!x.persone.has(r.matricola)) x.persone.set(r.matricola, r.nominativo)
      if (p.data) x.date.add(p.data)
    }
  }
  return [...per.entries()]
    .filter(([, x]) => x.persone.size > 1)
    .map(([numero, x]) => {
      const matricole = [...x.persone.keys()].sort()
      return {
        numero,
        matricole,
        persone: matricole.map(m => ({ matricola: m, nominativo: x.persone.get(m)! })),
        date:    [...x.date].sort(),
      }
    })
    .sort((a, b) => a.numero.localeCompare(b.numero))
}

/** Si puo' confermare solo un atto con una data sola (o nessuna, che blocca comunque). */
export function confermabile(c: NumeroCondiviso): boolean {
  return c.date.length <= 1
}

/** La conferma vale se riguarda ESATTAMENTE queste matricole e questa data. */
export function confermaVale(c: NumeroCondiviso, conf: ConfermaCondiviso | undefined): boolean {
  if (!conf || !confermabile(c)) return false
  if ((c.date[0] ?? '') !== conf.data) return false
  if (conf.matricole.length !== c.matricole.length) return false
  const a = [...conf.matricole].sort()
  return a.every((m, i) => m === c.matricole[i])
}

export function nuovaConferma(c: NumeroCondiviso, il = new Date().toISOString()): ConfermaCondiviso {
  return { matricole: [...c.matricole], data: c.date[0] ?? '', il }
}

/**
 * Tiene solo le conferme ancora valide. Una conferma che non combacia piu'
 * (terza persona aggiunta, data cambiata, refuso corretto) si butta: se
 * l'insieme tornasse com'era, deve essere di nuovo una persona a dirlo.
 * Ritorna lo STESSO oggetto se non c'e' niente da togliere.
 */
export function potaConferme(conferme: ProvvCondivisi, condivisi: NumeroCondiviso[]): ProvvCondivisi {
  const perNumero = new Map(condivisi.map(c => [c.numero, c]))
  const tenute = Object.entries(conferme).filter(([n, conf]) => {
    const c = perNumero.get(n)
    return c !== undefined && confermaVale(c, conf)
  })
  return tenute.length === Object.keys(conferme).length ? conferme : Object.fromEntries(tenute)
}

/** Conferme lette da un salvataggio. Difensiva: il JSON arriva dal database. */
export function leggiConferme(x: unknown): ProvvCondivisi {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return {}
  const out: ProvvCondivisi = {}
  for (const [n, v] of Object.entries(x as Record<string, unknown>)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue
    const o = v as Record<string, unknown>
    if (!Array.isArray(o['matricole'])) continue
    out[n] = {
      matricole: (o['matricole'] as unknown[]).map(String),
      data:      typeof o['data'] === 'string' ? o['data'] : '',
      il:        typeof o['il'] === 'string' ? o['il'] : '',
    }
  }
  return out
}

// ── Date dei provvedimenti da verificare ─────────────────────────────────
//
// Una data incollata nel formato mese/giorno (Excel all'americana) passa
// tutti i controlli: e' una data valida, solo sbagliata. "10/05/2026" letto
// come 10 maggio in mezzo a provvedimenti di ottobre e' il caso che ha fatto
// nascere questo controllo. Due segnali, entrambi BLOCCANTI finche' la data
// non si corregge o qualcuno non conferma che e' giusta:
//   - data futura: un provvedimento non puo' essere di domani;
//   - data lontana: piu' di `soglia` giorni dalla mediana delle date della
//     lavorazione (servono almeno tre date per avere un riferimento).
// Se scambiando giorno e mese la data torna vicina alle altre, la si propone.

const GIORNO = 86_400_000

function giorni(iso: string): number | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(t)
  // 2026-02-31 non e' una data: Date.UTC la sposterebbe a marzo.
  if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null
  return Math.round(t / GIORNO)
}

export interface DataAnomala {
  /** matricola|numero|data: la conferma vale per QUESTA data di QUESTO atto. */
  chiave:     string
  matricola:  string
  nominativo: string
  numero:     string
  /** Lettera del provvedimento se la riga ne ha piu' d'uno. */
  lettera:    string | null
  provvId:    number
  data:       string
  motivo:     'futura' | 'lontana'
  /** Distanza in giorni dal riferimento (dalla data di oggi se futura). */
  distanza:   number
  /** Mediana delle date della lavorazione, ISO ('' se non calcolabile). */
  riferimento: string
  /** Giorno e mese scambiati, se cosi' la data torna plausibile. */
  proposta:   string | null
}

/** Chiave di conferma di una data -> quando e' stata confermata (ISO). */
export type DateConfermate = Record<string, string>

export function dateAnomale(righe: RigaControllo[], oggi: string, soglia = 60): DataAnomala[] {
  const gOggi = giorni(oggi)
  const candidati: Array<{ r: RigaControllo; p: ProvvRiga; i: number; g: number }> = []
  for (const r of righe) {
    if (r.mesiScelti.size === 0 || !r.matricola) continue
    r.provvedimenti.forEach((p, i) => {
      if (mesiDelProvv(r, p.id).length === 0) return
      const g = giorni(p.data)
      if (g !== null) candidati.push({ r, p, i, g })
    })
  }

  const ord = candidati.map(c => c.g).sort((a, b) => a - b)
  const mediana = ord.length >= 3 ? ord[Math.floor((ord.length - 1) / 2)]! : null
  const iso = (g: number) => new Date(g * GIORNO).toISOString().slice(0, 10)

  const out: DataAnomala[] = []
  for (const { r, p, i, g } of candidati) {
    let motivo: DataAnomala['motivo'] | null = null
    let distanza = 0
    if (gOggi !== null && g > gOggi) { motivo = 'futura'; distanza = g - gOggi }
    else if (mediana !== null && Math.abs(g - mediana) > soglia) { motivo = 'lontana'; distanza = Math.abs(g - mediana) }
    if (!motivo) continue

    // Giorno e mese scambiati: proposta solo se la data scambiata e' valida,
    // non futura e vicina alle altre.
    let proposta: string | null = null
    const [y, m, d] = p.data.split('-') as [string, string, string]
    if (m !== d) {
      const sc = `${y}-${d}-${m}`
      const gs = giorni(sc)
      const vicina = mediana === null || Math.abs(gs! - mediana) <= soglia
      if (gs !== null && (gOggi === null || gs <= gOggi) && vicina) proposta = sc
    }

    out.push({
      chiave:      `${r.matricola}|${p.numero.trim()}|${p.data}`,
      matricola:   r.matricola!,
      nominativo:  r.nominativo,
      numero:      p.numero.trim(),
      lettera:     r.provvedimenti.length > 1 ? letteraProvv(i) : null,
      provvId:     p.id,
      data:        p.data,
      motivo,
      distanza,
      riferimento: mediana !== null ? iso(mediana) : '',
      proposta,
    })
  }
  return out
}

/** Tiene solo le conferme di date ancora anomale. Stesso oggetto se niente cambia. */
export function potaDate(conf: DateConfermate, anomale: DataAnomala[]): DateConfermate {
  const chiavi = new Set(anomale.map(a => a.chiave))
  const tenute = Object.entries(conf).filter(([k]) => chiavi.has(k))
  return tenute.length === Object.keys(conf).length ? conf : Object.fromEntries(tenute)
}

export function leggiDateConfermate(x: unknown): DateConfermate {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return {}
  return Object.fromEntries(
    Object.entries(x as Record<string, unknown>).filter(([, v]) => typeof v === 'string') as Array<[string, string]>,
  )
}

/** Il problema bloccante per le date anomale non ancora confermate. */
export function problemiDate(anomale: DataAnomala[], conf: DateConfermate): string[] {
  const aperte = anomale.filter(a => !conf[a.chiave])
  if (aperte.length === 0) return []
  const descr = aperte.slice(0, 6).map(a => {
    const chi = `${a.nominativo}${a.lettera ? ` (${a.lettera})` : ''} ${a.numero || 'senza numero'} del ${ggmmaaaa(a.data)}`
    const perche = a.motivo === 'futura' ? 'data futura' : `${a.distanza} giorni dalle altre`
    return `${chi} (${perche}${a.proposta ? `, forse ${ggmmaaaa(a.proposta)}?` : ''})`
  })
  return [`Data provvedimento da verificare su ${aperte.length} provvedimento/i: ${descr.join('; ')}` +
    `${aperte.length > 6 ? '…' : ''}. Correggila, o conferma qui sotto che è giusta.`]
}

/**
 * Controlli BLOCCANTI sui provvedimenti, solo sulle righe con mesi scelti
 * (quelle che finiscono nel CSV). Sostituiscono i tre controlli di prima
 * (numero mancante, data mancante, numero su piu' matricole), che ora valgono
 * per OGNI provvedimento, e ne aggiungono tre:
 *   - un provvedimento senza mesi, se la riga ne ha piu' d'uno: quasi
 *     certamente un'assegnazione dimenticata;
 *   - lo stesso numero due volte sulla stessa persona;
 *   - un mese scelto senza provvedimento (solo da salvataggi rovinati).
 */
export function problemiProvv(righe: RigaControllo[], conferme: ProvvCondivisi = {}): string[] {
  const senzaNumero: string[] = []
  const senzaData:   string[] = []
  const senzaMesi:   string[] = []
  const ripetuti:    string[] = []
  const orfani:      string[] = []

  for (const r of righe) {
    if (r.mesiScelti.size === 0) continue
    const multi = r.provvedimenti.length > 1
    const visti = new Set<string>()

    r.provvedimenti.forEach((p, i) => {
      const chi = multi ? `${r.nominativo} (${letteraProvv(i)})` : r.nominativo
      if (mesiDelProvv(r, p.id).length === 0) {
        if (multi) senzaMesi.push(chi)
        return
      }
      const n = p.numero.trim()
      if (!n) senzaNumero.push(chi)
      if (!p.data) senzaData.push(chi)
      if (!n) return
      if (visti.has(n)) ripetuti.push(`${r.nominativo} (${n})`)
      visti.add(n)
    })

    const senza = [...r.mesiScelti].sort().filter(k => !provvDelMese(r, k))
    if (senza.length > 0) orfani.push(`${r.nominativo} · ${senza.map(meseBreve).join(', ')}`)
  }

  const out: string[] = []
  if (senzaData.length > 0) {
    out.push(`Data provvedimento mancante su ${senzaData.length} provvedimento/i: ${elenco(senzaData)}.`)
  }
  if (senzaNumero.length > 0) {
    out.push(`Numero provvedimento mancante su ${senzaNumero.length} provvedimento/i: ${elenco(senzaNumero)}.`)
  }
  if (senzaMesi.length > 0) {
    out.push(`Provvedimento senza mesi: ${elenco(senzaMesi)}. Assegnagli i suoi mesi o toglilo.`)
  }
  if (orfani.length > 0) {
    out.push(`Mesi senza provvedimento: ${elenco(orfani)}. Clicca la lettera del provvedimento giusto, poi il mese.`)
  }
  if (ripetuti.length > 0) {
    out.push(`Stesso numero di provvedimento ripetuto sulla stessa persona: ${elenco(ripetuti)}.`)
  }
  // Stesso numero su matricole diverse: errore, salvo conferma esplicita che
  // e' lo stesso atto (vedi sopra). Con date diverse non c'e' conferma che tenga.
  for (const c of numeriCondivisi(righe)) {
    if (!confermabile(c)) {
      out.push(`Numero provvedimento ${c.numero} usato su più matricole con date diverse ` +
        `(${c.date.map(ggmmaaaa).join(' / ')}): ${c.matricole.join(', ')}. ` +
        `Lo stesso atto non può avere due date: correggi il numero o la data.`)
    } else if (!confermaVale(c, conferme[c.numero])) {
      out.push(`Numero provvedimento ${c.numero} usato su più matricole: ${c.matricole.join(', ')}. ` +
        `Se è un refuso correggilo; se è davvero lo stesso atto, confermalo qui sotto.`)
    }
  }
  return out
}
