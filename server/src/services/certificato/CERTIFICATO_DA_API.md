# Certificato stipendiale da API (liquidato) — mappatura voci

Sorgente alternativa al PDF: da `anno/mese/matricola` si recupera
`GET /v1/liquidazioni/liquidato/dettaglio` e si costruisce lo stesso
`CedolinoParsed` che il PDF produce, riusando **invariata** la matematica
`computeCertificato()` e il template DOCX.

Adapter: `liquidatoToCedolino.ts`. L'unico input di dominio è la mappa
`codice voce → { sezione, teorica, descrizione }`, perché l'API dà solo i
codici (il PDF invece ha la sezione "DATI TEORICI" e le ancore di sezione).

> ⚠ **Nessun dato personale in questo file.** Le validazioni sono state fatte
> localmente su cedolini reali, ma qui si documentano solo REGOLE e CODICI VOCE
> (non dati personali). Non inserire nomi, matricole o importi reali in file versionati.

## Schema certificato (dai fogli "Calcolo x certificati", struttura stabile)

RETRIBUZIONE (+): Stipendio, IIS, Assegno nucleo familiare, Assegno aggiuntivo,
Differenziale indiv. Stipendio, Differenziale indiv. IIS, Indennità di posizione E.P.,
Indennità ex DPR 567/87, I.V.C. + Elemento perequativo, Assegno ad personam,
(varianti per grado: Classi e scatti, R.I.A./I.M.A., Ind. accessoria mensile, Buoni pasto docenti).

RITENUTE DI LEGGE (−): Ritenute fiscali (IRPEF), Bonus fiscale DL 66/2014 (+),
Ritenute previdenziali ed assistenziali, Ritenute extraerariali, Abb. T.F.R.,
Addizionale regionale, Addizionale comunale, Acconto addizionale comunale.
→ **NETTO RITENUTE DI LEGGE (=)**

EXTRAERARIALI (−): ADU, CRAL, Trattenuta sindacale, Prestito per delega,
Cessione V (×2), Alimenti, Trattenute deducibili/detraibili, Pignoramenti e sequestri,
Debiti vari (ESCLUSI dal certificato), Valore buoni pasto, Abbonamento bus.
→ **NETTO A PAGARE (=)** ; QUINTO = netto/5 ; SETTIMO = netto/7.

## Motore consigliato: AGGREGATI del liquidato (indipendenti dal ruolo)

Il liquidato espone, oltre alle voci di competenza, alcune **voci aggregate di
cedolino** che sono **indipendenti dal ruolo** (ND, PO, …) e quindi il modo più
robusto di alimentare il certificato:

| codice | significato                         | uso nel certificato         |
|--------|-------------------------------------|-----------------------------|
| 01096  | lordo / imponibile                  | `lordo_teorico`             |
| 00990  | ritenute previdenziali (dipendente) | `ritenute_previdenziali`    |
| 00991  | ritenute fiscali nette              | `ritenute_fiscali`          |
| 00994  | ritenute extraerariali              | `extraerariali_totale`      |
| 03003  | netto in busta corrente             | quadratura di controllo     |

Inglobamenti d'ufficio (identici a `computeCertificato`):
- **fiscali** += addizionali (regionale **00816**, comunale **01797**, acconto comunale **02787**)
- **previdenziali** += **Abb.TFR 01323** (ritenuta TFS/opera di previdenza: 2,5% sull'80% dell'imponibile)
- **extraerariali** = 00994 (componenti tipiche: cessione V 00850, rimborso prestito 04891,
  CRAL 00854, trattenuta sindacale 14386, contributi minori es. 00713)

Le voci di **competenza** dipendono dal ruolo (es. IIS = 01251 per ND, 00055 per PO;
per i professori compaiono 00060 Assegno aggiuntivo e 00012 Classi e scatti; ⚠ 00010 e
00050 valgono entrambe lo stipendio → non sommarle) e servono **solo** per la tabella
RETRIBUZIONE, tramite una mappa ruolo-aware. Il lordo corretto è sempre l'aggregato 01096.

## Selezione delle righe del mese corrente (IMPORTANTE)

Mese corrente = **capitolo principale `000100` E `flagc = '0'`** (equivalente:
`dataCompVoce` nel mese target). Il solo capitolo non basta: gli **arretrati** possono
stare sullo stesso 000100 con `flagc = '1'`. Escludere i capitoli accessori
(es. Master/arretrati, addizionali rateizzate, run secondari a progrLiquidazione diverso).

**Quadratura**: nello scope corrente, `lordo − fiscali − previdenziali − extraerariali`
deve pareggiare la voce **03003** (netto in busta). Il motore `certificatoDaAggregati`
espone questo confronto come flag `quadratura`, così un errore di selezione è evidente.

## Stato validazione (senza dati personali)

Mappatura codici→certificato e regola aggregati **verificate al centesimo in locale**
contro i fogli d'ufficio, su **4 cedolini reali** che coprono i ruoli **ND e PO** e
**4 mensilità** diverse (dati non riportati qui). Esiti confermati:
- gli aggregati 01096/00990/00991/00994 sono role-independent;
- addizionali 00816/01797/02787 → inglobate nelle fiscali (confermate 3 volte);
- Abb.TFR = 01323 (2,5% su 80% imponibile) → inglobato nelle previdenziali (confermato);
- la quadratura `netto calcolato == 03003` regge sul mese corrente 000100/flagc0.

## Nota metodo
La mappa NON contiene valori inventati: solo le voci confermate. Le voci non mappate
vengono **escluse** dal certificato (non sommate), così una mappa incompleta non produce
un importo sbagliato — al più un certificato parziale, evidente in verifica. Il percorso
da API è identico a quello da PDF perché il calcolo è lo stesso (`computeCertificato`).
