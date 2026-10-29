// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · scheda Guide
// Tracciato record di ogni importazione (T1–T7), con un esempio CSV, il
// modello da scaricare e l'equivalente manuale; l'archivio fra ambienti.
// In fondo, i lavori da fare.
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
    note: ['* Serve il NOMINATIVO (o COGNOME + NOME, o la MATRICOLA).', 'Se il file ha più fogli (LIBRO SOCI, TUTTI LIBRO SOCI, STAMPA_VERSAMENTI…) si sceglie quale usare.', 'Soci attivi in PGS che non sono nel file: per ciascuno si decide a mano «Cessato», «Resta attivo» o «È nel file come…» (nome scritto male: si associa la riga giusta, proposta per stesso numero d\'iscrizione o nome simile). Finché non si decide, la conferma è bloccata.', 'Formati .xlsx, .xls, .csv. Le intestazioni si riconoscono anche con nomi simili; altrimenti si scelgono a mano.', 'Un ex dipendente passato a socio esterno si riconosce dalla sua ex matricola: l\'import aggiorna il socio esterno che c\'è già, non crea un nuovo socio dipendente.', 'Il T1 aggiunge e abbina. Per aggiornare in massa dati di chi c\'è già (sedi, date di nascita, email, tessere, stato) c\'è il T6.'],
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
  },
  {
    id: 'T6', titolo: 'Aggiornamento dati delle persone già presenti', dove: 'Importazione › Aggiornamento dati (T6)', scheda: 'import',
    cosa: 'Aggiorna in massa i dati di soci, esterni e familiari che ci sono già: sede di consegna, data di nascita, email, tessera, note, tipologia, stato. Non crea persone nuove (per quelle c\'è il T1). Il modo più semplice: «Soci › Esporta Excel» (stesse colonne, anche il foglio Familiari), correggi in Excel e ricarica il file. Dalle differenze nasce un lotto: per ogni persona prima → dopo, si accetta o si scarta anche un campo alla volta, e solo allora si applica.',
    campi: [
      ['ID', 'Sì*', 'Matricola, EXT-nnnn o FAM-nnnn', '090123', 'Primo criterio di aggancio.'],
      ['Tessera', 'No*', 'Numero o testo', '42', 'Per agganciare, se manca l\'ID (si sceglie a mano la colonna). Come campo da aggiornare: nuova tessera, controllata contro i doppioni.'],
      ['Cognome + Nome (o Nominativo)', 'No*', 'Testo', 'ROSSI · MARIA', 'Terzo criterio, con la regola di Emolumenti; fra omonimi decide la data di nascita. Non si aggiornano: per chi ha la matricola vengono da PGS.'],
      ['Data di nascita', 'No', 'gg/mm/aaaa, aaaammgg', '07/03/1958', 'Per chi ha la matricola si scrive solo se in PGS manca; se c\'è ed è diversa si segnala e non si sovrascrive.'],
      ['Sede', 'No', 'Codice (CD) o nome della sede', 'ACT', 'Deve esistere. È la colonna «Sede» dell\'export; «Sede (nome)» si ignora.'],
      ['Email · Note', 'No', 'Testo', 'maria.rossi@…', 'Email controllata nel formato.'],
      ['Tipologia', 'No', 'Socio dipendente · Socio esterno · Esterno', 'Esterno', 'Con la matricola: socio dipendente o esterno; senza: socio esterno o esterno. Un socio con familiari non diventa esterno. Il passaggio a socio esterno di un dipendente si fa dalla scheda (nuovo ID).'],
      ['Stato · Data stato', 'No', 'Attivo · Cessato · Eliminato · data gg/mm/aaaa', 'Cessato · 31/12/2026', 'Cessato solo chi è attivo; Eliminato da qualunque stato; Attivo su un eliminato = ripristino. Senza data, oggi. I cambi di stato si confermano uno per uno.'],
    ],
    note: ['* Serve almeno un criterio di aggancio: ID, tessera o nominativo.', 'Cella vuota = il campo non cambia. «-» = svuota il campo.', 'Si applicano solo le colonne spuntate (di default sede, email e note): le altre si accendono a mano.', 'Persone non agganciate: si scelgono a mano o si ignorano. Una persona in più righe: vale la prima.', 'Il lotto resta in «Da validare» finché non è tutto deciso: si può applicare una parte e riprendere più tardi.'],
    esempio: 'ID;Tipologia;Stato;Data stato;Cognome;Nome;Data di nascita;Email;Sede;Tessera;Note\n090123;Socio dipendente;Attivo;;ROSSI;MARIA;;maria.rossi@ateneo.example;ACT;;\nEXT-0004;Socio esterno;Cessato;31/12/2026;BIANCHI;GIULIA;12/05/1961;;CD;0108;\nFAM-0002;;;;FERRARI;MATTEO;;;-;;sede svuotata con il trattino',
    mano: [['Sede di molte persone', 'Soci › seleziona › Sede di consegna › Applica', 'soci'], ['Stato o tipologia di molte persone', 'Soci › seleziona › Cessa / Elimina / Ripristina, Tipologia', 'soci'], ['Una persona', 'Soci › clic sulla riga', 'soci']],
  },  {
    id: 'T7', titolo: 'Quote versate · una riga per socio', dove: 'Importazione › Quote versate (T7)', scheda: 'import',
    cosa: 'Carica, aggiorna e corregge in massa le quote associative versate, in attesa della lettura delle trattenute da CINECA. È la forma di «Quote associative › Esporta Excel»: si esporta l\'anno, si scrivono gli importi e si ricarica. Si registra l\'importo davvero versato: se copre la rata il mese è pagato, se un versamento copre la quota dell\'anno è pagato tutto l\'anno, un importo minore resta registrato e il mese «da completare». Nasce un lotto prima → dopo da validare.',
    campi: [
      ['ID', 'Sì*', 'Matricola o EXT-nnnn', '090123', 'Primo criterio di aggancio (anche l\'ex matricola di chi è passato a socio esterno).'],
      ['Tessera · Cognome · Nome · Data di nascita', 'No*', 'Testo, gg/mm/aaaa', 'ROSSI · MARIA', 'Se manca l\'ID: tessera, poi nominativo (la data di nascita decide fra gli omonimi).'],
      ['Anno', 'No', 'aaaa', '2026', 'Se manca vale l\'anno scelto a video. L\'anno deve essere impostato in Parametri.'],
      ['Modalità', 'No', 'Unica soluzione · Mensile · Trattenuta in busta paga', 'Mensile', 'La trattenuta solo per chi ha la matricola.'],
      ['Gen … Dic', 'No', 'Euro (5 · 5,00 · 4,50) oppure X / SI', '5,00', 'Importo versato nel mese. X = la rata intera. Vuoto = non cambia. Un importo pari alla quota annua paga tutto l\'anno.'],
      ['Unica', 'No', 'Euro oppure X', '60,00', 'Versato in unica soluzione. X = la quota dell\'anno.'],
      ['Pagata il', 'No', 'gg/mm/aaaa', '15/02/2026', 'Data dell\'unica soluzione (da sola vale «Unica = X»).'],
      ['Versato · Saldo', '—', 'Euro', '15,00', 'Solo da leggere nell\'export: all\'import si ignorano.'],
      ['Note', 'No', 'Testo', 'arretrati 2025', 'Nota della quota.'],
    ],
    note: ['* Serve almeno un criterio di aggancio: ID, tessera o nominativo.', 'Le rate già pagate NON si tolgono da file (un «-» si ignora, un importo minore su un mese pagato si segnala e si salta): si tolgono solo a mano, con un clic sul mese in Quote associative.', 'Importo diverso dalla rata: si registra con un avviso e si conferma una per una.', 'Bloccati: chi in quell\'anno non deve la quota (esterni, familiari, eliminati dall\'anno dell\'eliminazione, iscritti dopo), anno non impostato, lo stesso mese con importi diversi nel file.', 'Quando arriveranno le trattenute da CINECA useranno la stessa strada (una riga per versamento) e lo stesso lotto da validare.'],
    esempio: 'ID;Tessera;Cognome;Nome;Data di nascita;Anno;Modalità;Gen;Feb;Mar;Apr;Mag;Giu;Lug;Ago;Set;Ott;Nov;Dic;Unica;Pagata il;Note\n090123;0001;ROSSI;MARIA;;2026;Trattenuta in busta paga;5;5;5;5;5;4,50;;;;;;;;;\nEXT-0004;0108;BIANCHI;GIULIA;;2026;Unica soluzione;;;;;;;;;;;;;60,00;15/02/2026;\n;;FERRARI;MATTEO;02/02/1975;2026;Mensile;X;X;;;;;;;;;;;;;',
    mano: [['Una rata', 'Quote associative › clic sul mese (accende o toglie la rata)', 'quote'], ['L\'unica soluzione', 'Quote associative › casella «pagata il»', 'quote'], ['La trattenuta del mese a tutti', 'Quote associative › Registra la trattenuta del mese', 'quote']],
  },
  {
    id: 'T7-V', titolo: 'Quote versate · una riga per versamento', dove: 'Importazione › Quote versate (T7)', scheda: 'import',
    cosa: 'Stesso tracciato T7 in forma di elenco: una riga per ogni versamento, come gli elenchi delle trattenute in busta paga. Si riconosce dalla colonna «Mese». Più righe dello stesso socio e anno si uniscono in una sola variazione.',
    campi: [
      ['ID · Tessera · Nominativo', 'Sì*', 'Come nella forma per socio', '090123', 'Aggancio del socio.'],
      ['Anno', 'No', 'aaaa', '2026', 'Se manca vale l\'anno scelto a video.'],
      ['Mese', 'Sì', '1–12, nome del mese oppure UNICA', '3', 'UNICA = versamento in unica soluzione.'],
      ['Importo', 'No', 'Euro', '5,00', 'Vuoto = la rata intera (o la quota per UNICA).'],
      ['Data versamento', 'No', 'gg/mm/aaaa', '27/03/2026', 'Si salva come data dell\'unica soluzione.'],
    ],
    note: ['* Serve almeno un criterio di aggancio.', 'Lo stesso mese due volte con importi diversi blocca la variazione: va corretto il file.', 'Stesse regole della forma per socio: si aggiunge, non si toglie; avvisi per importi diversi dalla rata.'],
    esempio: 'MATRICOLA;NOMINATIVO;ANNO;MESE;IMPORTO;DATA VERSAMENTO\n090123;;2026;1;5,00;27/01/2026\n090123;;2026;2;5,00;27/02/2026\n;BIANCHI GIULIA;2026;UNICA;60,00;15/02/2026',
    mano: [['Una rata', 'Quote associative › clic sul mese', 'quote'], ['La trattenuta del mese a tutti', 'Quote associative › Registra la trattenuta del mese', 'quote']],
  },
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
      <section className={`${cardCls} p-5 flex flex-col gap-2 text-sm text-slate-300`}>
        <h3 className="text-white font-semibold">Archivio fra ambienti (produzione ↔ pre-produzione)</h3>
        <ul className="list-disc ml-5 space-y-1 max-w-[80ch] text-slate-400">
          <li><b className="text-slate-200">Esporta</b> (Importazione › Archivio fra ambienti): un file .json con le sezioni scelte, cioè sedi, parametri e tabelle (tipi di evento, tipologie di prodotto, tessera, importi della quota), soci e familiari con lo storico delle tessere, quote, eventi con partecipanti, scelte, carichi e richieste. Nome con ambiente e data. I dati personali viaggiano così come sono: l'export resta nell'audit.</li>
          <li><b className="text-slate-200">Carica</b> nell'altro ambiente: si scelgono le sezioni e il server prepara un lotto da validare in «Da validare». Nulla si cancella: chi c'è qui e non nel file resta, un valore vuoto non svuota, un mese di quota pagato qui resta pagato.</li>
          <li>Gli <b className="text-slate-200">ID restano gli stessi</b>. Se qui un EXT-/FAM- è già di un'altra persona, la riga è un conflitto: accettandola entra con un nuovo ID e quote, scelte e legami la seguono. I contatori EXT-/FAM- e il prossimo numero di tessera si alzano da soli.</li>
          <li>Le <b className="text-slate-200">sedi</b> si ritrovano per codice o per nome. Gli utenti che hanno creato o validato i record si ricollegano per username; chi non c'è resta scritto nelle note.</li>
          <li>Da confermare una per una: cambi di stato, nuovi ID, matricole che qui non sono in anagrafica PGS, possibili doppioni. Bloccate: tessere già usate da altri, ex dipendenti passati a socio esterno in un solo ambiente.</li>
          <li>Il file contiene dati personali: tienilo fuori dalla cartella del repository e cancellalo dopo l'uso.</li>
        </ul>
      </section>
      <section className="rounded-xl border border-sky-800/70 bg-sky-950/10 p-5 flex flex-col gap-2">
        <h3 className="text-white font-semibold">Lavori da fare</h3>
        <ul className="list-disc ml-5 text-sm text-slate-300 space-y-1 max-w-[80ch]">
          <li><b>Confronto quote associative ↔ trattenute in busta paga.</b> Da fare quando saranno individuate le voci stipendiali interessate. Base pronta: il report «Quote associative» e gli importi versati per rata.</li>
          <li>Lettura delle trattenute da CINECA: produrrà righe del T7 (una per versamento) e passerà dallo stesso lotto da validare. Intanto si caricano con il T7.</li>
          <li>Tracciati T4 (partecipanti singoli) e T5 (iscrizioni ai campi): da allineare ai file reali.</li>
          <li>Casi particolari di campi estivi e cinema (settimane annullate, liste d'attesa, rettifiche di magazzino): da analizzare.</li>
        </ul>
      </section>
    </div>
  )
}
