// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · scheda Guide
// Tracciato record di ogni importazione (T1–T5), con un esempio CSV, il
// modello da scaricare e l'equivalente manuale. In fondo, i lavori da fare.
// ============================================================

import { D, Ico, Pill, avviso, btnPiccoloSec, cardCls, etichettaCls, scarica, useCral, type Scheda } from './ui'

interface Tracciato {
  id: string; titolo: string; dove: string; scheda: Scheda; provvisorio?: boolean; cosa: string
  /** colonna, obbligatoria, formato, esempio, note */
  campi: Array<[string, string, string, string, string]>
  note: string[]; esempio: string
  /** cosa, dove, scheda */
  mano: Array<[string, string, Scheda]>
}

const TRACCIATI: Tracciato[] = [
  {
    id: 'T1', titolo: 'Libro soci CRAL (soci dipendenti e soci esterni)', dove: 'Importazione', scheda: 'import',
    cosa: 'È il foglio «LIBRO SOCI» del file Iscritti CRAL così com\'è: aggiunge i soci nuovi, abbina i dipendenti all\'anagrafica PGS per nominativo, porta il numero di iscrizione come tessera e segnala chi non c\'è più. Ripetuto ogni anno sullo stesso elenco, aggiorna e non duplica.',
    campi: [
      ['(riga di titolo)', 'No', 'Testo libero sopra l\'intestazione', 'AGM 14 09 2026 · QUOTA ASSOCIATIVA 2026', 'L\'intestazione si cerca da sola nelle prime 10 righe: quelle sopra si ignorano. Un\'intestazione ripetuta a metà foglio si salta.'],
      ['ATTIVI', 'No', 'Numero progressivo di riga', '1', 'Si ignora: non è il numero del socio.'],
      ['NOMINATIVO', 'Sì*', 'COGNOME NOME, di solito tutto maiuscolo', 'ROSSI MARIA', 'Si confronta con le anagrafiche PGS (regola di Emolumenti). Tutto maiuscolo, per i nuovi soci esterni il punto dove finisce il cognome va controllato alla validazione.'],
      ['CODICE FISCALE', 'No', '16 caratteri', '—', 'Presente nel file ma NON si usa e NON si salva (GDPR): bastano nominativo e data di nascita.'],
      ['DATA NASCITA', 'No (consigliata)', 'gg/mm/aaaa, aaaammgg (come la stampa versamenti) o data Excel', '07/03/1958', 'Al posto del codice fiscale: decide fra gli omonimi in anagrafica PGS e si salva sulla persona. Se diversa da PGS si segnala.'],
      ['N.ISCR.SOCIO', 'No', 'Numero intero', '42', 'Diventa la tessera nel formato di Parametri (42 → 0042): la tessera viene SEMPRE dal libro soci, la validazione non ne assegna. Numero diverso da PGS: si segnala e, con l\'interruttore, si prende quello del file (il vecchio resta nelle note). Chi rientra ha un numero nuovo.'],
      ['ESTERNI', 'No', 'vuoto · ESTERNO · ATIPICO', 'ESTERNO', 'Vuoto = socio da cercare in anagrafica PGS (trovato: socio dipendente; non trovato: socio esterno da validare). ESTERNO = socio esterno, non si cerca in PGS. ATIPICO = per ora come vuoto, con l\'etichetta «ATIPICO» (significato da confermare).'],
      ['MATRICOLA', 'No', 'Numero, fino a 6 cifre', '090123', 'Non c\'è nel libro soci; se un file la porta (es. la stampa dei versamenti) prevale sul nominativo.'],
      ['SEDE DI CONSEGNA · EMAIL', 'No', 'Testo', 'Sede di Via Acton', 'Non ci sono nel libro soci: la sede dei soci nuovi resta «da indicare» e si assegna nella scheda Sedi; quella dei soci già presenti non cambia.'],
    ],
    note: ['* Serve il NOMINATIVO (o COGNOME + NOME, o la MATRICOLA).', 'Se il file ha più fogli (LIBRO SOCI, TUTTI LIBRO SOCI, STAMPA_VERSAMENTI…) si sceglie quale usare.', 'Soci attivi in PGS che non sono nel file: per ciascuno si decide a mano «Cessato», «Resta attivo» o «È nel file come…» (nome scritto male: si associa la riga giusta, proposta per stesso numero d\'iscrizione o nome simile). Finché non si decide, la conferma è bloccata.', 'Formati .xlsx, .xls, .csv. Le intestazioni si riconoscono anche con nomi simili; altrimenti si scelgono a mano.'],
    esempio: ' ;AGM 14 09 2026;QUOTA ASSOCIATIVA 2026\nATTIVI;NOMINATIVO;CODICE FISCALE;N.ISCR.SOCIO;ESTERNI\n1;ROSSI MARIA;(ignorato);2;\n2;D\'ANGELO MARCO;(ignorato);240;ESTERNO',
    mano: [['Un socio alla volta', 'Soci › Nuova persona (dall\'anagrafica PGS o esterno)', 'soci'], ['La sede di uno o più soci', 'Sedi › cerca e aggiungi, oppure seleziona e «Sposta in…»', 'sedi'], ['Tessera, email, note, cessazione', 'Soci › clic sulla riga', 'soci']],
  },
  {
    id: 'T2', titolo: 'Scelte di un evento (risposte del modulo)', dove: 'Eventi › apri › Importa risposte modulo', scheda: 'iniziative',
    cosa: 'Registra la scelta di ogni socio per un singolo evento (es. il gusto del panettone). Va bene l\'export del modulo online così com\'è.',
    campi: [
      ['MATRICOLA / ID SOCIO / TESSERA', 'No*', 'Matricola PGS, EXT-nnnn o numero di tessera', '090123', 'Primo criterio di aggancio.'],
      ['EMAIL', 'No*', 'Indirizzo email', 'Maria.Rossi@…', 'Secondo criterio, maiuscole ignorate. È la colonna «Indirizzo email» del modulo.'],
      ['NOMINATIVO', 'No*', 'Cognome e nome in qualunque ordine', 'ROSSI MARIA', 'Terzo criterio, con la stessa regola dell\'elenco iscritti.'],
      ['SCELTA (qualsiasi intestazione)', 'Sì', 'Testo uguale a una delle opzioni dell\'evento', 'AL CIOCCOLATO FONDENTE', 'È la prima colonna che non è data/ora, email, nominativo o matricola: per esempio «Panettone».'],
      ['Informazioni cronologiche', 'No', 'Data e ora della risposta', '07/10/2025 12.07.41', 'Si ignora.'],
    ],
    note: ['* Serve almeno uno fra MATRICOLA/ID/TESSERA, EMAIL o NOMINATIVO.', 'Le righe che non si agganciano restano in elenco «non agganciate» e si assegnano a mano a un socio prima di registrare.', 'Una scelta già presente si sovrascrive e diventa di fonte «modulo».'],
    esempio: 'Informazioni cronologiche;Panettone;Indirizzo email;NOMINATIVO\n07/10/2026 12.07.41;AL CIOCCOLATO FONDENTE;maria.rossi@ateneo.example;\n08/10/2026 09.14.02;TRADIZIONALE - CON UVETTA E CANDITI;;BIANCHI GIULIA',
    mano: [['La scelta di un socio', 'Eventi › apri › colonna «Scelta» sulla riga del socio', 'iniziative'], ['Chi non ha scelto', 'Eventi › apri › «Assegna la predefinita…» oppure riga per riga', 'iniziative'], ['La consegna', 'Eventi › apri › colonna «Consegnato»', 'iniziative']],
  },
  {
    id: 'T3', titolo: 'Ordini di un evento a pagamento', dove: 'Eventi › apri › Importa ordini', scheda: 'iniziative',
    cosa: 'Registra gli ordini di un evento a pagamento (es. olio, prodotti della terra, quote di una gita): una riga per persona, una colonna per prodotto con la quantità. È la forma del foglio «ULTIMO ORDINE».',
    campi: [
      ['MATRICOLA / ID SOCIO / TESSERA', 'No*', 'Matricola PGS, EXT-nnnn o numero di tessera', '090123', 'Primo criterio di aggancio.'],
      ['EMAIL', 'No*', 'Indirizzo email', 'maria.rossi@…', 'Secondo criterio.'],
      ['NOMINATIVO', 'No*', 'Cognome e nome in qualunque ordine', 'ROSSI Carla', 'Terzo criterio, stessa regola dell\'elenco iscritti.'],
      ['TIPOLOGIA - PRODOTTO (una colonna per prodotto)', 'Sì', 'Quantità: intero per i prodotti al pezzo, anche decimale per quelli al kg', 'FRANTOIANO - PET DA 1 LT = 2', 'L\'intestazione è «tipologia - prodotto» come nell\'evento; basta il solo prodotto se il nome è unico. Vuoto o 0 = non ordinato. Oltre il massimo a testa la riga va in errore.'],
      ['COGNOME + NOME', 'No*', 'Due colonne di testo', 'ROSSI · MARIA', 'In alternativa a NOMINATIVO (è la forma del foglio delle mele).'],
      ['IMPORTO', 'No', 'Euro', '10', 'Controllo: il totale si calcola da quantità × prezzo. Se nel file è più basso, la differenza si registra come sconto personale (interruttore); se è più alto si segnala nelle note.'],
      ['PAGATO', 'No', 'SI / NO', 'SI', 'Se SI, l\'ordine risulta pagato.'],
      ['NOTE', 'No', 'Testo libero', 'dare 2,50 di resto', 'Nota dell\'ordine, come la colonna NOTE del foglio.'],
    ],
    note: ['* Serve almeno uno fra MATRICOLA/ID/TESSERA, EMAIL o NOMINATIVO.', 'Prezzi e totali NON si importano: si calcolano dai prezzi dei prodotti nell\'evento.', 'File SENZA intestazione (es. mele: cognome | nome | quantità | importo): si indica cosa c\'è in ogni colonna; la riga di totale in fondo, senza nome, si ignora.', 'Un ordine importato sostituisce quello già presente per la stessa persona. Le righe non agganciate si assegnano a mano.', 'Le persone devono essere tra i partecipanti dell\'evento: dei gruppi scelti o aggiunte come singoli.'],
    esempio: 'NOMINATIVO;LECCINO - ALU DA 5 LT;FRANTOIANO - PET DA 1 LT;CASTAGNE;PAGATO;NOTE\nROSSI Carla;;1;;SI;\nROSSI Maria;1;2;1,5;;dare 2,50 di resto\n\n(senza intestazione, come le mele)\nROSSI;MARIA;4;10\nBIANCHI;GIULIA;6;15\n;;10;',
    mano: [['L\'ordine di una persona', 'Eventi › apri › quantità sulla riga della persona', 'iniziative'], ['Pagato, consegnato, note', 'Eventi › apri › colonne a destra', 'iniziative'], ['Un partecipante non socio', 'Eventi › apri › Nuovo partecipante', 'iniziative']],
  },
  {
    id: 'T4', provvisorio: true, titolo: 'Partecipanti di un evento (singoli)', dove: 'Eventi › apri un evento «Singoli» › Importa partecipanti', scheda: 'iniziative',
    cosa: 'Carica la lista dei partecipanti di un evento impostato «Singoli»: una riga per persona. Le persone si cercano in tutta l\'anagrafica CRAL (soci dipendenti, soci esterni, esterni, familiari).',
    campi: [
      ['MATRICOLA / ID', 'No*', 'Matricola PGS, EXT-nnnn, FAM-nnnn o numero di tessera', 'FAM-0001', 'Primo criterio di aggancio.'],
      ['EMAIL', 'No*', 'Indirizzo email', 'maria.rossi@…', 'Secondo criterio.'],
      ['NOMINATIVO', 'No*', 'Cognome e nome in qualunque ordine', 'ROSSI Maria', 'Terzo criterio, stessa regola dell\'anagrafica.'],
    ],
    note: ['* Serve almeno uno dei tre.', 'Chi non si aggancia si assegna a mano a una persona esistente, oppure diventa un nuovo esterno da validare.', 'Chi è già partecipante non viene duplicato.'],
    esempio: 'MATRICOLA / ID;EMAIL;NOMINATIVO\n090123;;\nFAM-0001;;\n;;VERDI Carla',
    mano: [['Un partecipante', 'Eventi › apri › Nuovo partecipante (anche persona nuova)', 'iniziative'], ['Togliere un partecipante', 'Eventi › apri › × accanto al nome', 'iniziative']],
  },
  {
    id: 'T5', provvisorio: true, titolo: 'Iscrizioni a un campo (turni a settimane)', dove: 'Eventi › apri un evento «Turni» › Importa iscrizioni', scheda: 'iniziative',
    cosa: 'Registra le settimane prenotate da ciascun iscritto (di solito i figli dei soci). Le settimane del file si aggiungono a quelle già prenotate: vale anche per gli allungamenti.',
    campi: [
      ['MATRICOLA / ID', 'No*', 'Matricola PGS, EXT-nnnn, FAM-nnnn o tessera', 'FAM-0002', 'Primo criterio di aggancio.'],
      ['NOMINATIVO', 'No*', 'Cognome e nome in qualunque ordine', 'FERRARI Matteo', 'Secondo criterio, stessa regola dell\'anagrafica.'],
      ['RIFERIMENTO', 'No', 'Matricola, ID o nominativo del socio o del dipendente da cui dipende', '090123', 'Decide lo sconto e il gruppo. Vuoto = automatico: per un familiare il suo socio, per un esterno nessuno (quota piena). Serve per i figli di dipendenti non soci.'],
      ['SETTIMANA 1 … SETTIMANA n', 'Sì', 'X (oppure SI, 1, P) nelle settimane prenotate', 'X', 'Intestazione uguale al nome della settimana nell\'evento. Settimane anche non consecutive (es. prima e ultima).'],
      ['VERSATO', 'No', 'Importo in euro', '120,00', 'Si somma a quanto già versato.'],
      ['NOTE', 'No', 'Testo libero', 'allungamento richiesto', ''],
    ],
    note: ['* Serve almeno uno fra MATRICOLA/ID e NOMINATIVO.', 'La quota NON si importa: quota piena dell\'evento, scontata della percentuale se la persona di riferimento è socio (dipendente o esterno) o dipendente non socio, × settimane prenotate o frequentate.', 'Frequentata e Tolta si segnano a mano, settimana per settimana.', 'In un evento «Singoli» chi viene importato entra anche tra i partecipanti.'],
    esempio: 'MATRICOLA / ID;NOMINATIVO;RIFERIMENTO;SETTIMANA 1;SETTIMANA 2;SETTIMANA 3;SETTIMANA 4;SETTIMANA 5;VERSATO;NOTE\nFAM-0002;;;X;X;;;;180,00;\n;COLOMBO Nicolò;;X;;;;X;;prima e ultima\n;ROSSI Chiara;090123;X;X;;;;;figlia di dipendente non socio',
    mano: [['Una settimana', 'Eventi › apri il campo › cella della settimana: Prenotata / Frequentata / Tolta', 'iniziative'], ['Un nuovo iscritto', 'Eventi › apri il campo › Nuovo partecipante', 'iniziative'], ['Il versato', 'Eventi › apri il campo › colonna Versato', 'iniziative']],
  }
]

export function GuideTab() {
  const { vaiA } = useCral()
  const copia = (testo: string) => { navigator.clipboard?.writeText(testo).then(() => avviso('Esempio copiato')).catch(() => avviso('Copia non consentita: seleziona il testo a mano.', 'warning')) }
  return (
    <div className="flex flex-col gap-4">
      <div className={`${cardCls} p-5 text-sm text-slate-300 flex flex-col gap-2`}>
        <p className="text-white font-medium">Tutto si fa anche a mano</p>
        <p className="text-slate-400 max-w-[80ch]">Ogni importazione ha il suo tracciato record, qui sotto, e un equivalente manuale. Si creano solo a mano, perché non hanno un file da importare: eventi (strenne, panettoni, colombe, vendite, gite, campi, cinema), opzioni, prodotti con prezzo, settimane e quote dei campi, carichi e richieste di biglietti, tipi, tipologie di prodotto, sedi e quote associative. Il codice fiscale non si raccoglie mai: le persone si distinguono con nominativo e data di nascita.</p>
        <div className="flex flex-wrap gap-2 pt-1">
          {([['Nuova persona', 'soci'], ['Composizione sedi', 'sedi'], ['Nuovo evento', 'iniziative'], ['Quote associative', 'quote'], ['Sedi, tipi e tessera', 'parametri']] as Array<[string, Scheda]>).map(([l, k]) => <button key={l} className={btnPiccoloSec} onClick={() => vaiA(k)}>{l}</button>)}
        </div>
      </div>
      {TRACCIATI.map(t => (
        <section key={t.id} className={`${cardCls} overflow-hidden`}>
          <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-start gap-3">
            <span className="font-mono text-xs px-2 py-1 rounded bg-indigo-600/20 text-indigo-300 border border-indigo-800">{t.id}</span>
            <div className="flex-1 min-w-[220px]"><h3 className="text-white font-semibold">Tracciato record · {t.titolo} {t.provvisorio && <Pill tono="warn" title="Da allineare ai file reali quando arriveranno">provvisorio</Pill>}</h3><p className="text-xs text-slate-500 mt-0.5">Si carica da: {t.dove}</p></div>
            <button className={btnPiccoloSec} onClick={() => vaiA(t.scheda)}>Vai all'importazione</button>
          </div>
          <div className="px-5 py-4 flex flex-col gap-4">
            <p className="text-sm text-slate-300 max-w-[80ch]">{t.cosa}</p>
            <div className="overflow-x-auto rounded-lg border border-slate-800"><table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 bg-slate-900/60"><th className="px-3 py-2 font-semibold">Colonna</th><th className="px-3 py-2 font-semibold">Obbl.</th><th className="px-3 py-2 font-semibold">Formato</th><th className="px-3 py-2 font-semibold">Esempio</th><th className="px-3 py-2 font-semibold">Note</th></tr></thead>
              <tbody className="divide-y divide-slate-800/70 align-top">
                {t.campi.map(([c, o, f, e, n]) => <tr key={c}><td className="px-3 py-2 font-mono text-xs text-slate-100 whitespace-nowrap">{c}</td><td className={`px-3 py-2 text-xs ${o.startsWith('Sì') ? 'text-amber-300' : 'text-slate-500'}`}>{o}</td><td className="px-3 py-2 text-xs text-slate-300">{f}</td><td className="px-3 py-2 font-mono text-xs text-slate-400 whitespace-nowrap">{e}</td><td className="px-3 py-2 text-xs text-slate-400 min-w-[220px]">{n}</td></tr>)}
              </tbody></table></div>
            <ul className="text-xs text-slate-400 list-disc ml-5 space-y-1 max-w-[80ch]">{t.note.map(n => <li key={n}>{n}</li>)}</ul>
            <div className="grid lg:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2 min-w-0"><div className="flex items-center"><span className={etichettaCls + ' flex-1'}>Esempio (CSV)</span>
                <button className={btnPiccoloSec} onClick={() => copia(t.esempio)}><Ico d={D.copy} cls="w-3.5 h-3.5" />Copia</button>
                <button className={btnPiccoloSec + ' ml-1.5'} onClick={() => scarica(`CRAL_${t.id}_modello.csv`, new Blob(['\uFEFF' + t.esempio.replace(/\n/g, '\r\n')], { type: 'text/csv;charset=utf-8' }))}><Ico d={D.download} cls="w-3.5 h-3.5" />Modello</button></div>
                <pre className="text-xs font-mono text-slate-300 bg-slate-950 border border-slate-800 rounded-lg p-3 overflow-x-auto whitespace-pre">{t.esempio}</pre></div>
              <div className="flex flex-col gap-2"><span className={etichettaCls}>Stessa cosa a mano, una alla volta</span>
                <div className="rounded-lg border border-slate-800 divide-y divide-slate-800">
                  {t.mano.map(([cosa, dove, k]) => <button key={cosa} onClick={() => vaiA(k)} className="w-full text-left px-3 py-2.5 hover:bg-slate-800/50 flex items-center gap-3"><span className="text-sm text-slate-100 w-48 shrink-0">{cosa}</span><span className="text-xs text-slate-400 flex-1">{dove}</span><span className="text-indigo-400 text-xs">apri</span></button>)}
                </div></div>
            </div>
          </div>
        </section>))}
      <section className="rounded-xl border border-sky-800/70 bg-sky-950/10 p-5 flex flex-col gap-2">
        <h3 className="text-white font-semibold">Lavori da fare</h3>
        <ul className="list-disc ml-5 text-sm text-slate-300 space-y-1 max-w-[80ch]">
          <li><b>Confronto quote associative ↔ trattenute in busta paga.</b> Da fare quando saranno individuate le voci stipendiali interessate. Base pronta: il report «Quote associative» con mesi pagati e modalità «Trattenuta in busta paga».</li>
          <li>Import delle trattenute dal cedolino al posto della registrazione mese per mese.</li>
          <li>Tracciati T4 (partecipanti singoli) e T5 (iscrizioni ai campi): da allineare ai file reali.</li>
          <li>Casi particolari di campi estivi e cinema (settimane annullate, liste d'attesa, rettifiche di magazzino): da analizzare.</li>
        </ul>
      </section>
    </div>
  )
}
