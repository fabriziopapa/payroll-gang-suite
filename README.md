# Payroll Gang Suite

[![License](https://img.shields.io/badge/license-Proprietary%20%C2%A9%202026%20Fabrizio%20Papa-ef4444?style=flat-square)](./LICENSE)
[![Version](https://img.shields.io/badge/version-26.09.12-0ea5e9?style=flat-square)]()
[![Status](https://img.shields.io/badge/status-active-22c55e?style=flat-square)]()

[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)]()
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite&logoColor=white)]()
[![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)]()
[![Zustand](https://img.shields.io/badge/Zustand-5-433e38?style=flat-square)]()

[![Node.js](https://img.shields.io/badge/Node.js-20_LTS-339933?style=flat-square&logo=nodedotjs&logoColor=white)]()
[![Fastify](https://img.shields.io/badge/Fastify-5-000000?style=flat-square&logo=fastify&logoColor=white)]()
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-4169E1?style=flat-square&logo=postgresql&logoColor=white)]()
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.40-C5F74F?style=flat-square&logoColor=black)]()
[![npm workspaces](https://img.shields.io/badge/monorepo-npm_workspaces-cb0000?style=flat-square&logo=npm&logoColor=white)]()

[![Auth](https://img.shields.io/badge/Auth-Passwordless_TOTP-7c3aed?style=flat-square&logo=authy&logoColor=white)]()
[![JWT](https://img.shields.io/badge/JWT-ES256-000000?style=flat-square&logo=jsonwebtokens&logoColor=white)]()
[![Argon2](https://img.shields.io/badge/Refresh_Tokens-Argon2id-dc2626?style=flat-square)]()

Applicazione web per la gestione delle liquidazioni variabili del personale universitario.
Interfaccia operativa alternativa al portale HR Suite: genera CSV conformi al tracciato ufficiale,
gestisce comunicazioni ai destinatari e archivia le liquidazioni per ateneo.

---

## Tech Stack

| Layer | Tecnologie |
|---|---|
| Frontend | React 18, Vite, TypeScript, TailwindCSS, Zustand |
| Backend | Node.js 20, Fastify 5, TypeScript, Drizzle ORM |
| Database | PostgreSQL 15+ |
| Auth | Passwordless TOTP (RFC 6238), JWT ES256, refresh token rotanti Argon2id |

---

## Struttura monorepo

```
payroll-gang-suite/
├── client/                      # SPA React/Vite
│   └── src/
│       ├── api/                 # Client API tipizzati (endpoints.ts, client.ts — JWT + auto-refresh)
│       ├── components/          # Componenti React (ConfirmDialog, ToastManager, Layout, …)
│       │   ├── editor/          #   DettaglioCard, DettaglioFormModal, ComunicazioneModal
│       │   └── certificatoTemplate/  # Editor template certificato
│       ├── constants/           # csvDefaults, scorporoCoefficients, palette gruppi
│       ├── hooks/               # useDebounce, usePdfDocument, …
│       ├── pages/               # Dashboard, Editor, Viewer, Ricerca, Anagrafiche, Voci,
│       │                        # Capitoli, Certificati, Emolumenti, PdfRegionEditor,
│       │                        # Impostazioni, Utenti
│       ├── store/               # Stato globale Zustand (useStore.ts)
│       ├── types/               # Interfacce TypeScript + APP_VERSION
│       └── utils/               # CSV / PDF / EML builder, calcoli scorporo (biz.ts)
├── server/                      # API REST Fastify
│   ├── sql/
│   │   ├── owner_payroll_user.sql  # Proprieta' oggetti a payroll_user (migrazioni senza superutente)
│   │   └── setup.sql            # ★ Setup DB CONSOLIDATO: unico file per installazione da zero
│   │                            #   (ruolo + database + 18 tabelle + indici + grants + proprieta + seed)
│   └── src/
│       ├── config/              # env.ts — variabili ambiente validate Zod (fail-fast)
│       ├── auth/                # TOTP (RFC 6238) + JWT ES256 + refresh rotante Argon2id
│       ├── db/
│       │   ├── schema.ts        # ★ Schema Drizzle — fonte di verità del DB
│       │   ├── migrations/      # 0001…0013 — SOLO storico del DB di produzione esistente
│       │   │                    #   (già incluse in setup.sql: NON eseguire su install nuova)
│       │   └── repositories/    # Repository pattern (PgBozze, PgUsers, PgCertificati, …)
│       ├── middleware/          # authenticate.ts (JWT preHandler)
│       ├── routes/              # /api/v1: auth, bozze, anagrafiche, voci, capitoli,
│       │                        # settings, users, certificati, emolumenti,
│       │                        # pdf-region, cineca
│       ├── schemas/             # Zod validazione (BozzaDatiSchema, …)
│       └── services/            # cryptoService, importService, mailerService, cinecaService
│           ├── emolumenti/      #   risoluzione nominativi → matricole (logica pura + test)
│           ├── cedolino/        #   parser PDF cedolino + calculator
│           ├── certificato/     #   stampa unione DOCX (+ assets)
│           └── pdfRegion/       #   estrazione via template regioni
├── shared/                      # Tipi condivisi client ↔ server
├── ecosystem.config.cjs         # Process manager (produzione)
├── .env.example                 # Variabili d'ambiente, documentate una per una
├── .githooks/pre-commit         # Guardrail PII e segreti (CF, matricole, idAb, chiavi)
└── LICENSE
```

> Le guide di installazione, gli script di aggiornamento e i file di
> configurazione dei singoli ambienti non fanno parte del repository: sono il
> runbook di una specifica installazione e restano nella documentazione
> operativa interna.


---

## Funzionalità principali

- **Dashboard** — lista bozze paginate (6 per pagina), bozze attive e archiviate separate, multi-utente con badge creatore
- **Editor** — gruppi di liquidazione, nominativi HR, importi, ruoli storici
  - **Badge importo** — scomposizione dell'importo lordo in voci singole (floating panel), memorizzazione persistente in `importoBudget[]`
  - **Navigazione Excel** — `Enter` su importo passa al nominativo successivo, frecce su/giù disabilitate sul campo numerico
  - **Incolla lista** — parsing intelligente di righe incollate: rileva automaticamente importo in formato italiano (`1.200,00`) o inglese (`1,200.00`), ricerca fuzzy con normalizzazione accenti e fallback per token parziali
- **Viewer** — visualizzazione read-only delle liquidazioni archiviate con export CSV/TXT attivi
- **Ricerca** — ricerca fulltext cross-bozza (per nome o testo libero), report aggregati per matricola / voce / periodo con export CSV; caricamento dati in singola query (no N+1)
- **Import XML** — anagrafiche e voci da file DATAPACKET HR (max 5 MB, max 5.000 righe)
- **Import XLSX** — anagrafiche SGE (max 10 MB, max 10.000 righe, import differenziale con hash SHA-256); include `area_conto` (IT / SEPA / EXTRA_UE / NON_NOTO), che entra nell'hash: senza, un cambio di conto non verrebbe mai aggiornato
- **Export CSV** — tracciato HR ufficiale (header camelCase, `codiceStatoVoce=E`), calcolo scorporo automatico, CSV injection prevention
- **Export TXT Ruoli** — file per ruolo con deduplicazione matricole
- **Comunicazioni** — generazione email con allegato PDF nominale
- **Gestione utenti** — admin panel, TOTP onboarding, ruoli admin/base, lockout anti-brute-force
- **Certificati giuridico-stipendiali** — **doppia sorgente**: (a) upload cedolino Cineca (PDF) → parsing dinamico per-sezione; (b) **Recupera cedolino da API** (anno/mese/matricola) → costruzione dagli aggregati del liquidato CINECA. In entrambi i casi ricalcolo per categoria (verificato al centesimo) → generazione DOCX con stampa unione (segnaposto `{{path}}`, tag genere `[[m|f]]`), protocollo progressivo atomico per anno, template editabili (CRUD)
- **Verifica liquidato** *(admin)* — confronto del liquidato CINECA (`/liquidazioni/liquidato/dettaglio`) con gli invii PGS ricostruiti (join per `matricola|voce|capitolo|dataCompVoce|riferimento`), classificazione NUOVO / CONGUAGLIO / STORNO / RETTIFICA; ogni lettura è auditata
- **Dottorandi e borse (area Emolumenti)** *(admin)* — elenco lavorazioni con bozze/archiviate, caricamento nominativi per incollato o ricerca in anagrafica, lettura di cio' che e' **gia' in CSA** (i mesi presenti non sono selezionabili: la competenza doppia non nasce), abbinamenti d'ufficio tipo→voce→capitolo (DR `09834`/`000601`, BS `09947`/`000706`, BE `09766`/`000602`), export CSV per HR Suite e **TXT matricole divise per area del conto**
- **PDF Region Editor** *(in rollout, kill-switch off)* — strumento admin: disegno regioni di riconoscimento layout direttamente sul cedolino renderizzato (canvas), template versionati e immutabili riusabili per l'estrazione automatica delle voci

---

## Sezione Certificati

Genera certificati a partire dai cedolini Cineca, replicando le regole di calcolo dell'ufficio.

- **Parsing dinamico** (`server/src/services/cedolino/parser.ts`) — estrae testo dal PDF con `pdfjs-dist` (build legacy Node) ricostruendo le righe per coordinate, poi classifica ogni voce per sezione (`Retribuzioni`, `Accessorie`, `Contributi`, `Ritenute fiscali in/da`, `Ritenute sindacali`, `Altre Ritenute`). Nessun elenco fisso di voci: le voci non previste entrano automaticamente nella categoria corretta.
- **Ricalcolo** (`calculator.ts`) — aritmetica `decimal.js` (ROUND_HALF_UP, 2 decimali): ritenute fiscali/previdenziali, netto di legge, extra-erariali, netto a pagare, quinto/settimo. Banco di prova al centesimo nel test.
- **Privacy** — il parser NON estrae IBAN/banca né i codici fiscali del nucleo familiare (non necessari al certificato).
- **Stampa unione + DOCX** (`server/src/services/certificato/`) — template-come-dato (`templati_certificato`), segnaposto e tag genere dedotto dal CF (override manuale da UI), generazione `docx` server-side.
- **Protocollo atomico** — `AAAA/NNN` assegnato in transazione via `certificato_progressivi` (UPSERT `ultimo+1`), nessuna collisione in concorrenza.
- **Audit** — `CERTIFICATO_CREATO/SCARICATO`, `TEMPLATE_*` nell'audit log append-only.

- **Sorgente API (liquidato)** (`liquidatoAggregatiToCedolino.ts` + `certificatoDaAggregati.ts`) — in alternativa al PDF, il cedolino è ricostruito dagli **aggregati** del liquidato CINECA (`01096` lordo, `00990` previdenziali, `00991` fiscali, `00994` extraerariali), **indipendenti dal ruolo**, con inglobamento addizionali (`00816/01797/02787`) nelle fiscali e Abb.TFR (`01323`, 2,5% sull'80% dell'imponibile) nelle previdenziali. Selezione del mese corrente = capitolo `000100` **e** `flagc=0`. Auto-controllo di **quadratura** col netto in busta (voce `03003`) esposto in UI. La matematica del certificato resta `computeCertificato()` (identica al percorso PDF).

**API** (tutte sotto `/api/v1`, JWT): `POST /certificati/parse` (PDF base64, validazione magic bytes `%PDF`, mai su disco), `POST /certificati/da-liquidato` (anno/mese/matricola → CedolinoParsed dagli aggregati, **admin + audit**), `POST /certificati` (crea + DOCX), `GET /certificati`, `GET /certificati/:id/docx`, CRUD `/templati-certificato` (scrittura admin).

**Schema DB**: tabelle e seed template inclusi in `server/sql/setup.sql` (consolidato). La migrazione storica `0005_certificati.sql` resta solo come riferimento del DB di produzione esistente.

**Test parser**: il test end-to-end è gated da env (il cedolino contiene PII e non è committato):
```bash
CEDOLINO_SAMPLE="/percorso/Cedolino_....pdf" npm run test --workspace=server
```

---

## Sezione Verifica liquidato

*(admin)* Riconcilia ciò che l'ateneo ha **inviato** (PGS) con ciò che CINECA ha **liquidato**.

- **Proxy server-side** (`server/src/routes/verificaLiquidato.ts`) verso `GET /v1/liquidazioni/liquidato/dettaglio` — nessuna credenziale CINECA lato client; **solo admin**; ogni lettura logga `CINECA_LIQUIDATO_LOOKUP` nell'audit.
- **Ricostruzione invii** (`services/verificaLiquidato/riconciliazione.ts`) — il liquidato è denormalizzato (voci input + righe derivate contributi/ritenute): si filtra alle voci input, si nettano conguagli tariffa (`flagc 5/6`) e storni, e si ricostruiscono gli invii PGS. Chiave di join: `matricola | voce | capitolo | dataCompVoce | riferimento-normalizzato` (la competenza è `dataCompVoce`, **non** anno/mese di erogazione; `idContrattoCsa` è sempre 0 → inutilizzabile).
- **Encoding-safe** — i `riferimento` arrivano in mojibake: `normRiferimento` applica NFD + rimozione diacritici/non-ASCII prima del confronto.
- **Classi**: NUOVO, CONGUAGLIO_TARIFFA, STORNO, RETTIFICA_ANNULLO, RETTIFICA.

**API** (`/api/v1/verifica-liquidato`, JWT + admin): `GET /dettaglio?anno&mese&matricola` (dettaglio + ricostruzione), `POST /riconcilia` (`{…, righePGS[]}` → abbinamenti value-aware, soli-PGS, soli-CINECA, ambigui).

---

## Sezione Dottorandi e borse (area Emolumenti)

*(admin)* Area separata dalle Liquidazioni: `bozze`, `EditorPage` e i gruppi di liquidazione **non vengono toccati**. Da `utils/biz.ts` si importano `serializeCsv` / `downloadCsv` / `lastDayOfMonth` in **sola lettura**: il tracciato HR resta uno solo.

**Il flusso.** Si incollano i nominativi (o si cercano uno per uno in anagrafica), si legge da CSA che cosa c'e' **gia'** per quella voce, si scelgono i mesi da aggiungere — quelli gia' presenti non sono selezionabili — e si esporta.

- **Caricamento** — scheda *Incolla lista* (`Cognome Nome`, numero provvedimento e, facoltativa, data in `GG/MM/AAAA`; separatori: tabulazione, `;` o spazi) oppure *Manuale*, con ricerca per nominativo o matricola. Il codice fiscale non passa di qui: la rotta `/anagrafiche` non lo espone (SEC-C2). Le righe si aggiungono a piu' riprese e i doppioni per matricola vengono scartati.
- **Risoluzione nominativi** (`services/emolumenti/nominativi.ts`, logica pura con test) — tre grafie per gli apostrofi (`D'Angelo` / `D Angelo` / `DAngelo`), ordine invertito, tier esatto che batte il parziale. **Mai una scelta a indovinare**: con piu' candidati la riga resta ambigua e decide l'operatore, che puo' anche cercare in anagrafica direttamente dalla riga.
- **Abbinamenti d'ufficio** — scegliendo il tipo (o la voce) si compilano voce e capitolo: DR `09834`/`000601` (maggiorazioni, a **parti** = 30), BS `09947`/`000706` (borse non esenti, IRAP, a **importo**), BE `09766`/`000602` (borse esenti, a **importo**). Restano modificabili a mano; se divergono compare un avviso che dice cosa, senza bloccare.
- **Controlli bloccanti prima dell'export** — mesi non selezionati, tipo/voce/data provvedimento mancanti, importo assente o non valido sulle voci a importo, **stesso numero di provvedimento su matricole diverse**, righe con mesi ma CSA mai letto.
- **Export CSV per HR Suite** — stesso tracciato a 24 colonne delle liquidazioni; `dataProvvedimento` in ISO, `dataCompetenzaVoce` in `GG/MM/AAAA`; la colonna inattiva (parti o importo) va a **0**, non vuota.
- **Export TXT matricole per area del conto** — un file per `ITALIA` / `SEPA` / `EXTRA_UE`, oppure Italia + estero, oppure uno solo. Ci finisce **solo chi ha mesi selezionati**; chi non ha una coordinata CSA nota resta fuori, e' segnalato con un pallino rosso sulla riga ed elencato per nome sotto il pulsante — e da li' si puo' assegnargli l'area a mano (vedi *Dettagli anagrafici per riga*).
- **Dettagli anagrafici per riga** — il pulsante con ruolo e area del conto, in testa a ogni persona, apre l'elenco **di tutti i rapporti** che PGS conosce per quella matricola (`GET /emolumenti/storico-ruoli/:matricola`, letto solo quando si apre il pannello). Serve perche' l'elenco ne mostra **uno solo**, quello con la decorrenza piu' alta: per i docenti basta, per dottorandi e borsisti no — sono contratti brevi in catena, e la stessa persona puo' essere stata `DR` fino all'anno scorso ed essere `BS` adesso. Da li' si sceglie il ruolo giusto per il mese liquidato, e si assegna a mano l'area del conto a chi in anagrafica non ce l'ha. Le due scelte restano **nella lavorazione** (`ruoloScelto`, `areaContoScelta`), sono marcate *a mano* in interfaccia e **non tornano in anagrafica**: quella si corregge solo re-importando da SGE. Il ruolo scelto e' quello che finisce nel CSV.
- **Lavorazioni salvate** (`emolumenti_lavorazioni`) — nome, stato bozza/archiviata, data di liquidazione e ID liquidazione CSA all'archiviazione (**stesso modale delle liquidazioni**). Il payload JSONB conserva l'input **e lo snapshot di cio' che CSA mostrava**: riaprendo si rivede lo stesso quadro senza rileggere, e premendo di nuovo *Leggi da CSA* si vede cosa e' cambiato. Ciclo di vita (apri, duplica, archivia, riapri, elimina) governato **solo dall'elenco**; l'eliminazione e' ammessa sulle sole bozze, e il vincolo sta nel repository, non nell'interfaccia.

**Sicurezza**: tutte le rotte `/api/v1/emolumenti` sono admin + audit **awaited**, letture comprese — il payload contiene nominativi, matricole e importi.

**Schema DB**: `emolumenti_lavorazioni` e `anagrafiche.area_conto` sono in `server/sql/setup.sql` (consolidato). Le migrazioni `0011`, `0012`, `0013` restano come riferimento del DB di produzione esistente.

---

## Sezione PDF Region Editor

*(in rollout — dietro kill-switch, non ancora attivo in produzione)*

Strumento admin per costruire **template di riconoscimento layout** dei cedolini: l'operatore disegna le regioni (anagrafica, voci) direttamente sul PDF renderizzato; il sistema le salva come template-come-dato riusabile dal parser per l'estrazione automatica.

- **Disegno regioni su canvas** (`PdfRegionEditorPage.tsx` + hook `usePdfDocument`) — render PDF via `pdfjs-dist` (canvas, pagina lazy/code-split: niente nel bundle principale finché un admin non apre lo strumento), coordinate salvate in **percentuale** — mai bytes/binary del PDF persistiti
- **Template versionati e immutabili** (tabella `templati_pdf_region`) — ogni modifica = nuova riga (versione+1) auto-attivata, predecessore disattivato in transazione (mai `UPDATE` in-place sui campi geometrici); `template_family_id` = lineage stabile fra versioni, indipendente dal nome (sopravvive a rinomina)
- **Vincolo "1 versione attiva per famiglia"** garantito a doppio livello — lock applicativo (`SELECT ... FOR UPDATE` su tutte le righe della famiglia, ordine deterministico per `id`: serializza i `PUT` concorrenti senza deadlock) **+** indice unico parziale DB-level `idx_pdf_region_one_active_per_family` (migrazione `0007`, garanzia strutturale indipendente dal codice applicativo)
- **Preview/estrazione** (`POST /:id/extract`) — testa il template su un PDF caricato senza persistere nulla; stesso hardening anti-abuso di `/certificati/parse` (validazione magic bytes `%PDF`, cap dimensione, mai scritto su disco)
- **Kill-switch** — `pdfRegionEditorEnabled` in `AppSettings` (default `false`), toggle admin in Impostazioni → Moduli; voce di navigazione e route nascoste finché disattivato (pattern identico a `turnstileEnabled`)
- **Accesso** — lista template in sola lettura per tutti (`pdf-region-templates`); editor di disegno regioni riservato agli admin (`pdf-region-editor`, route guard `user?.isAdmin`)

**API** (tutte sotto `/api/v1/pdf-region-templates`, JWT): `GET /` (lista, `?all=true` per includere versioni storiche), `GET /:id`, `POST /` (nuova famiglia), `PUT /:id` (nuova versione), `DELETE /:id` (admin, header `X-Confirm-Delete` — se elimini la versione attiva riattiva automaticamente quella restante con numero più alto, mai famiglie orfane), `POST /:id/extract` (preview, nessuna persistenza).

**Schema DB**: tabella, indici (incluso l'unico parziale "1 versione attiva per famiglia") e seed inclusi in `server/sql/setup.sql` (consolidato). Le migrazioni storiche `0006`/`0007` restano come riferimento del DB di produzione (nota: la `0007` usava `CREATE UNIQUE INDEX CONCURRENTLY`, da eseguire fuori transazione — irrilevante su installazione nuova).

**Nginx (deploy)**: il rendering PDF carica un Web Worker da `pdfjs-dist` — la CSP servita da Nginx per la SPA deve includere `worker-src 'self';` (assente di default, va aggiunta manualmente alla direttiva `Content-Security-Policy` nel vhost — il CSP di `@fastify/helmet` lato server **non** governa gli asset statici serviti da Nginx).

---

## Setup sviluppo (da zero al `dev` in 5 passi)

**Prerequisiti:** Node.js ≥ 20, PostgreSQL ≥ 15

```bash
# 1. Clone + dipendenze (tutti i workspaces)
git clone <repo-url> payroll-gang-suite && cd payroll-gang-suite
npm install

# 2. Database — UN SOLO comando (setup.sql consolidato: ruolo, DB, 18 tabelle, seed)
psql -U postgres -v app_password='<password-sicura>' -f server/sql/setup.sql

# 3. Configura ambiente
cp .env.example .env
# compila: DB_PASSWORD (quella del passo 2), chiavi JWT, ENCRYPTION_KEY
# → generazione chiavi: sezione sotto. DB_SSL=false in locale.

# 4. Primo utente admin (genera admin-qr.html → scansiona → elimina il file)
npm run db:seed

# 5. Avvia (client :5173 + server :3001)
npm run dev
```

> Le migrazioni in `server/src/db/migrations/` sono **storico** del DB di produzione:
> già incluse in `setup.sql`, NON vanno eseguite su un'installazione nuova.
> Verificato colonna per colonna: le migrazioni `0001`–`0013` sono tutte dentro
> `setup.sql`, quindi **un fork parte operativo con quel solo comando**.
>
> `setup.sql` assegna anche la **proprietà** degli oggetti a `payroll_user`.
> Senza, le tabelle resterebbero di `postgres` e la prima migrazione con un
> `ALTER TABLE` verrebbe rifiutata con *must be owner of table*. Unica eccezione
> `audit_log`, che resta del superutente: il `REVOKE` sulla sua immutabilità vale
> solo finché l'applicazione non ne è proprietaria.
> (`npm run db:migrate` è deprecato: drizzle-kit non è configurato — il flusso è `setup.sql`.)

### Generazione chiavi

```bash
# JWT ES256 — chiave privata
openssl ecparam -genkey -name prime256v1 -noout | \
  openssl pkcs8 -topk8 -nocrypt -out /tmp/jwt_priv.pem
echo "JWT_PRIVATE_KEY_BASE64=$(base64 -w 0 /tmp/jwt_priv.pem)"

# JWT ES256 — chiave pubblica
openssl ec -in /tmp/jwt_priv.pem -pubout | base64 -w 0
# → JWT_PUBLIC_KEY_BASE64

# ENCRYPTION_KEY AES-256 (32 byte hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

rm /tmp/jwt_priv.pem
```

---

## Build produzione

```bash
npm run build           # Build client + server → dist/
npm run build:server    # Solo server
npm run build:client    # Solo client
npm run typecheck       # TypeScript check (no emit)
```

---

## Deploy

L'applicazione gira dietro reverse proxy, con PostgreSQL e un process manager
Node. **Le guide di installazione, gli script di aggiornamento e la
configurazione dei singoli ambienti non fanno parte di questo repository**:
sono il runbook di una specifica installazione e vivono nella documentazione
operativa interna. Chi vuole eseguire il progetto trova tutto il necessario in
*Setup sviluppo* e in `.env.example`.

---


## Variabili Ambiente

Copiare `.env.example` → `.env`. Valori obbligatori:

| Variabile | Descrizione |
|---|---|
| `DB_HOST/PORT/NAME/USER/PASSWORD` | Connessione PostgreSQL |
| `DB_SSL` | `true` in produzione (default), `false` per dev locale senza TLS |
| `DB_POOL_MAX` | Numero massimo connessioni pool (default 10) |
| `JWT_PRIVATE_KEY_BASE64` | Chiave privata ES256 (Base64) |
| `JWT_PUBLIC_KEY_BASE64` | Chiave pubblica ES256 (Base64) |
| `JWT_ACCESS_EXPIRES` | Scadenza access token (default `15m`) |
| `JWT_REFRESH_EXPIRES` | Scadenza refresh token (default `7d`) |
| `ENCRYPTION_KEY` | 32 byte hex — AES-256-GCM per TOTP secret e cache CF familiari |
| `CLIENT_ORIGIN` | URL frontend, virgola-separati per multi-origine (CORS) |
| `SMTP_HOST/PORT/USER/PASS` | Credenziali server email (opzionale) |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile (opzionale) |
| `CINECA_BASE_URL/TENANT/USER/PASSWORD` | Integrazione CINECA CSA-WS (opzionale — le route `/cineca/*` rispondono `503` se assenti) |
| `CINECA_GROUPS` | Gruppi richiesti nel token CSA-WS (default `familiari,sge`) |
| `PARENTELA_FIGLIO` | Codice `rapportoParentela` per figlio/figlia (default `FG`) |
| `CINECA_PROXY_URL` | Reverse proxy in Italia per CSA-WS (opzionale) — necessario se il server è fuori UE (CINECA geo-blocca gli IP extra-UE). Attivazione runtime dal toggle *Proxy Italia per API CINECA* in Impostazioni → Moduli. Il setup del proxy e' nella documentazione operativa interna. |
| `CINECA_PROXY_SECRET` | Secret condiviso (≥32 char) inviato al proxy come header `X-Proxy-Auth` |

---

## Sicurezza

- Auth passwordless: TOTP (RFC 6238) + JWT ES256 asimmetrico
- Replay OTP prevenuto con `claimOtpToken()` — UPDATE atomico su DB (no race condition)
- Brute-force TOTP: lockout 15 min dopo 5 tentativi, contatore incrementato atomicamente
- Refresh token: Argon2id hash (32 MB, timeCost 2), selector O(1) per lookup, rotazione ad ogni uso
- Cookie: `HttpOnly` + `Secure` + `SameSite=Strict`
- TOTP secret cifrati a riposo con AES-256-GCM
- Rate limiting globale (100 req/60s) + auth (5 req/300s)
- Audit log append-only per login, CRUD bozze, import, settings, gestione utenti
- Validazione strutturale JSONB `dati` bozze con `BozzaDatiSchema` (Zod) lato server
- Whitelist chiavi `app_settings` — rifiuta chiavi non consentite (SEC-H04)
- MIME injection prevention su corpo email (strip `\r`)
- CSV injection prevention su export ricerca (neutralizzazione `=`, `+`, `-`, `@`)
- `clearAuth` resetta tutti i campi PII dallo store client al logout/scadenza token

---

## Changelog

> Convenzione versioni: gli aggiornamenti di **sicurezza** usano il suffisso **`.S`** (es. `26.08.08.S`) per distinguerli dai rilasci funzionali.

### 26.09.12
**Emolumenti: chi ha creato e chi ha salvato per ultimo**
- **`updated_by` su `emolumenti_lavorazioni`** (migrazione **0014**, additiva e idempotente). `created_by` c'era dalla 0012 e diceva chi aveva creato; mancava il rovescio — a chi chiedere quando una lavorazione non torna. Con piu' persone sullo stesso elenco e' la domanda che si fa piu' spesso.
- **L'elenco mostra entrambi.** Prima riga: *«Modificato 12/09/2026 da fabrizio.papa»*; seconda: *«Creata da … il …»*. Dello username si mostra la parte prima della @ — il dominio, identico su ogni riga, sarebbe solo rumore — e l'indirizzo intero resta nel suggerimento.
- **Perche' una colonna e non l'audit.** Il dato ci sarebbe gia' in `audit_log`: le rotte delle lavorazioni registrano **ogni** operazione, letture comprese. Ma l'audit serve a ricostruire cosa e' successo, non a far funzionare l'interfaccia: legando l'elenco alla sua ritenzione, il giorno che lo si sfoltisce l'informazione sparisce da schermo. Tenerli separati e' il motivo per cui l'audit puo' essere archiviato senza rompere niente.
- **Dettagli di implementazione.** Due `leftJoin` sulla stessa tabella `users` con alias distinti (`autore`, `modificatore`) — `left` e non `inner` perche' un utente cancellato azzera il riferimento (`ON DELETE SET NULL`) e la lavorazione deve comunque comparire. `updatedBy` si scrive **accanto** a `updatedAt` in `update`/`archivia`/`riapri`: chi e quando sono lo stesso fatto, separarli significa vederli divergere prima o poi. Alla creazione vale il creatore, che non e' un'ipotesi: ha salvato adesso.
- I due `*Username` sono **facoltativi** nei tipi: li risolve solo l'elenco, le altre risposte restituiscono la riga come sta in tabella. Dichiararli obbligatori sarebbe promettere un dato che in quei casi non c'e'.
- Le lavorazioni create prima della 0014 restano senza *modificato da* e **non le riempiamo con il creatore**: sarebbe un'ipotesi, non un fatto. Si popolano da se' al primo salvataggio.

### 26.09.11.5
**Il campo competenza non si lasciava scrivere — e le azioni ora stanno anche in fondo**

*Correzione di un difetto introdotto dalla 26.09.11.4 e sfuggito alla prova: la maschera funzionava, il campo no.*

- **`maxLength={7}` era la causa.** `03/2005` e' esattamente sette caratteri: quando la selezione non era attiva — cursore posizionato a mano, o selezione collassata — il browser **rifiutava ogni tasto senza far partire `onChange`**, e il campo sembrava morto. Peggio: impediva anche al controllo sulle sei cifre di segnalare l'errore, perche' l'ottavo carattere non arrivava mai al gestore. Il messaggio *«Troppe cifre»* esisteva ed era codice irraggiungibile. A limitare ci pensa gia' `onCompetenzaChange`: l'attributo e' stato tolto.
- **Selezione spostata da `mouseup` a `mousedown`.** Il caret il browser lo piazza al mousedown, quindi intercettare il mouseup significa correggere una selezione gia' collassata, con esito dipendente dal timing. Annullando il comportamento predefinito e facendo focus + select a mano, il caret non viene piazzato affatto e non c'e' niente da correggere. Il secondo click, a campo gia' attivo, passa liscio e posiziona il cursore dove si vuole. Non era questa la causa del blocco — e' irrobustimento.
- **`Comprimi tutti` e `Salva bozza` anche nella barra in fondo**, accanto a *Esporta CSV* e nello stesso ordine dell'intestazione. Con molti gruppi il fondo pagina e' lontano dalla cima, e risalire solo per salvare e' la parte fastidiosa. Sono le **stesse funzioni** dell'header passate come props: nessuna logica duplicata, quindi i due punti non possono divergere — compreso il *Salva* disabilitato quando non c'e' niente da salvare.

### 26.09.11.4
**Competenza (MM/YYYY): maschera in digitazione, e niente anni inventati**
- **Il difetto.** Il campo accettava qualsiasi cosa: `07/22026` restava li' e l'errore arrivava solo al salvataggio, dopo aver compilato tutto il resto.
- **Ora si ragiona sulle sole cifre.** `072026`, `07/2026` e `07 2026` sono lo stesso numero: la barra la mette il campo. Si digitano sei cifre di fila e compare `07/2026`; chi scrive gia' la barra ottiene lo stesso risultato senza doppioni. Funziona anche in cancellazione — `07/` che torna a `07` non lascia la barra appiccicata.
- **Oltre le sei cifre il campo non tronca in silenzio**: si svuota, mostra il motivo (*«Troppe cifre: la competenza e' MM/YYYY, sei cifre in tutto»*) e riporta il cursore in testa, pronto per riscrivere. Troncare avrebbe prodotto un anno plausibile ma inventato — peggio di un errore visibile.
- **Entrando nel campo si seleziona tutto**, con il mouse come con Tab: la prima cifra digitata sostituisce quello che c'era, invece di infilarsi dentro il valore esistente.
- **`Data competenza voce` non e' stata toccata**: resta calcolata dall'effetto che la allinea all'ultimo giorno del mese quando la competenza e' completa, e resta sovrascrivibile a mano.
- Vale sia in **modifica** sia in **nuovo gruppo**: `DettaglioFormModal` e' lo stesso componente, con `existing` valorizzato o no.

### 26.09.11.3
**Il salvataggio della liquidazione cadeva dopo aver accettato il ruolo dal DB**
- **Sintomo.** Dopo *Aggiorna Ruolo*, scegliendo *«Usa ruolo storico dal DB»* nella modale dei conflitti, il salvataggio rispondeva `400 validation_error` e **l'intera bozza non si salvava** — 57 nominativi persi per cinque righe.
- **Causa.** In `DettaglioCard` il ramo che applica il ruolo del DB scriveva `druolo: item.druoloDb ?? undefined`. In `anagrafiche` il campo `druolo` e' **sempre NULL** (l'import SGE non porta la descrizione del ruolo), quindi `druoloDb` e' null, `?? undefined` lo rende `undefined` e `JSON.stringify` **elimina la chiave**. Lato server `NominativoSchema` vuole `druolo` come stringa obbligatoria: chiave assente, validazione fallita, PUT respinta. `RuoloDisambiguaModal`, che fa la stessa identica cosa, usava gia' `?? ''` — il difetto era in un ramo solo, ed e' il motivo per cui *«Ruolo ambiguo»* funzionava e *«Ruolo diverso dal dato storico»* no.
- **Correzione, su due livelli.** `?? ''` al posto di `?? undefined`, cosi' il dato che parte e' giusto; e `druolo` reso `.optional().default('')` in `BozzaDatiSchema`, perche' un campo puramente descrittivo e sempre nullo non deve poter bloccare il salvataggio di una bozza intera — ne' oggi, ne' da un client piu' vecchio.
- Nessuna migrazione: `druolo` non entra nel CSV per HR ed e' solo di visualizzazione.

### 26.09.11.2
**Anagrafiche: da quale query nasce il file, e gli errori d'import si possono leggere**
- **La query e' scritta a schermo.** Sotto l'intestazione della pagina: il file va prodotto sempre con **`RU_TAB`** — *«Tabella ru verifica tipo iban @papa»* — in Esse3 → Elaborazioni query. Non e' un promemoria di cortesia: un'estrazione fatta con una query diversa si importa **senza errori** e fa rispondere a PGS il ruolo sbagliato, che e' esattamente il difetto da cui e' partito tutto il lavoro del 10-11 settembre.
- **Gli errori si scaricano.** Il referto diceva *"15 errori"* e finiva li': quali righe, e perche', non si poteva sapere. Ora il riquadro diventa ambra, elenca i primi cinque e offre **Scarica gli errori (N)**, un CSV `riga;messaggio` in Windows-1252 come gli altri export — si apre in Excel senza procedura d'importazione.
- Il riquadro dice anche cosa comporta un errore: la riga **non e' stata importata**, e in caso di chiave duplicata (stessa matricola, stessa decorrenza) in anagrafica ne resta **una sola**. Nessun cambiamento lato server: gli errori arrivavano gia' al client con numero di riga e messaggio, semplicemente venivano contati e buttati via.

### 26.09.11.1
**L'area del conto si assegnava gia', ma non si trovava**
- Il pallino rosso *conto ignoto* diceva che qualcosa non andava, non che li' si rimediava: chi non ha una coordinata CSA nota resta fuori da tutti i TXT e non si puo' liquidare, e la strada per sbloccarlo era la seconda sezione di un pannello che si apre da un'etichetta. Ora il chip porta scritto **assegna**, il suggerimento del pulsante dice cosa comporta (*"resta fuori da tutti i TXT: apri e assegnala"*), e aprendo il pannello su una riga senza conto la sezione **Area del conto** viene mostrata **per prima**, sopra l'elenco dei rapporti.
- L'ordine e' dato con `order` su un contenitore flex, non duplicando il JSX: di ciascun blocco esiste una versione sola. Il comando *chiudi* e' salito in testa al pannello, perche' un comando che si sposta insieme ai blocchi non si ritrova.
- Nessun cambiamento di comportamento: la scelta manuale valeva gia' quanto l'anagrafica in `areaDi()` e nei TXT, e continua a non toccare l'anagrafica.

### 26.09.11
**Storico dei ruoli e scelta manuale nell'area Emolumenti**
- **Perche' serve.** L'elenco mostra un ruolo solo, quello con la decorrenza piu' alta. Per i docenti basta; per dottorandi e borsisti no, perche' i ruoli **si sovrappongono davvero**: la stessa persona puo' avere una borsa e un dottorato attivi nello stesso mese, e in CSA sono due rapporti distinti. Su questa popolazione nessuna risoluzione automatica "ruolo alla data" puo' funzionare — decide l'operatore.
- **`GET /api/v1/emolumenti/storico-ruoli/:matricola`** e la versione in blocco **`POST /api/v1/emolumenti/storico-ruoli`** — la storia anagrafica completa di una matricola via `findByMatricola`, admin + audit come il resto dell'area, **senza codice fiscale**. Nessun metodo nuovo nei repository.
- **Pannello dettagli per riga.** Il pulsante con ruolo e area del conto apre l'elenco dei rapporti con le date, e da li' si sceglie. La scelta resta **nella lavorazione** (`ruoloScelto`, `areaContoScelta`), e' marcata *a mano* in interfaccia e **non torna in anagrafica** — quella si corregge solo re-importando da SGE. Il ruolo scelto e' quello che finisce nel CSV.
- **L'ambiguita' si vede senza cercarla.** Si calcola sui **mesi selezionati** e all'ultimo giorno del mese, che e' la data che finisce nel CSV come `dataCompetenzaVoce`: se piu' di un rapporto e' aperto a quella data la riga lo dichiara in testa, e ogni rapporto mostra quali mesi copre. Segnalato anche il caso opposto — un mese selezionato che nessun rapporto copre, dove il CSV porterebbe un ruolo che l'anagrafica non conferma.
- **Area del conto assegnabile a mano** per chi in anagrafica non ce l'ha e resterebbe fuori da tutti i TXT.

**Guardrail PII — controllo a volume nel pre-commit**
- Il controllo sulle matricole guardava il **contesto**: segnalava solo quando sulla stessa riga compariva la parola "matricola". Ma un **elenco** di dati parole di contesto non ne ha, e un file di riconciliazione con 4.797 matricole vere passava con **zero** righe intercettate. Aggiunta una seconda rete sulla **quantita'**: oltre 20 valori distinti a sei cifre che iniziano per zero il commit si blocca a prescindere dal contesto. Calibrata sul repository — ogni file legittimo del progetto sta a 0.
- `.gitignore`: i file di diagnostica e bonifica dell'anagrafica (`DIAGNOSI_*`, `VERIFICHE_*`, `VERIFICA_*`, `RICONCILIA_*`) seguono gli altri interni dell'ateneo.

### 26.09.09
**Area Emolumenti (dottorandi e borse) + area del conto in anagrafiche**
- **Da dove viene il paese del conto.** CSA-WS non lo espone: in 47 pagine di documentazione l'unico riferimento bancario e' nel body di `POST /carriere`, deprecato e in scrittura. Il dato sta sull'Oracle di ateneo, in `SIAAC_UNIPARTH_PROD.V_IE_AC_CRDPAG_AB_ALL`, chiavato su `ID_AB` — la stessa chiave che PGS gia' risolve — con **`CD_NAZIONE_ISO3166_1_A2`**: il paese come colonna a se', due lettere. La colonna `IBAN` esiste nella vista e **non viene mai selezionata**.
- **La coordinata giusta si riconosce da tre campi**: `FL_USO_CSA = 1` (il conto con cui CSA paga, non quello dei rimborsi), `DT_ANNULLAMENTO` nulla, e `DT_INIZIO_VAL`/`DT_FINE_VAL` che comprendono oggi. Verificato sui dati reali: il filtro lascia **sempre una sola** coordinata per persona, mai due. Scartata `LIQUIDATO_TESTATE` (che pure ha `NAZ_IBAN`): e' uno storico di pagamenti gia' fatti, e fra l'ultima liquidazione e la prossima l'IBAN puo' essere cambiato — proprio sulla popolazione che interessa, i dottorandi che rientrano dall'estero.
- **`anagrafiche.area_conto`** VARCHAR(10) — `IT` | `SEPA` | `EXTRA_UE` | `NON_NOTO`, NULL se non estratto (migrazione **0011**). Colonna **Conto** in Anagrafiche, con ricerca per area. La query di estrazione, che tocca l'Oracle dell'ateneo, e' documentazione interna e non fa parte di questo repository.
- **`area_conto` entra nell'hash dell'import differenziale**: senza, un cambio di conto lascerebbe l'hash invariato, l'upsert salterebbe la riga e l'area resterebbe quella vecchia **per sempre**. L'upsert usa pero' `COALESCE`, cosi' un file del vecchio formato non azzera l'area gia' acquisita. Al primo import dopo l'aggiornamento tutte le righe risultano "aggiornate": e' una volta sola.
- **Ruolo `BE` incluso nell'estrazione**, ma limitato ad attivi e cessati da meno di 3 anni. Con il solo filtro "attivi" una cessazione BE (circa 490 l'anno) non sarebbe mai arrivata a PGS e la persona sarebbe rimasta attiva a tempo indeterminato. `MAX_IMPORT_ROWS` da 5.000 a 10.000.
- **Nuova area *Dottorandi e borse*** — elenco lavorazioni con contatori e filtri, caricamento per incollato o ricerca, lettura di cio' che e' gia' in CSA, controlli bloccanti, export CSV per HR Suite e **TXT matricole per area del conto**. Vedi la sezione dedicata sopra.
- **Lavorazioni salvabili** (`emolumenti_lavorazioni`, migrazioni **0012** e **0013**) — tabella **separata da `bozze`**: l'area Liquidazioni non e' stata toccata. Archiviazione con data di liquidazione e ID liquidazione CSA, tramite lo **stesso `ArchiviaLiquidazioneModal`** delle liquidazioni, importato in sola lettura.
- **`setup.sql` è di nuovo davvero consolidato**: le migrazioni `0011`, `0012` e `0013` sono state riportate dentro, ed è stata verificata colonna per colonna la presenza di tutte le `0001`–`0013`. Aggiunta anche l'assegnazione della **proprietà** degli oggetti a `payroll_user`, cosi' che un'installazione da zero — o un fork — non erediti il problema del *must be owner*. `audit_log` resta di `postgres` di proposito.
- **`server/sql/owner_payroll_user.sql`** — passa a `payroll_user` la proprieta' degli oggetti dello schema `public`. `setup.sql` crea le tabelle come `postgres`, quindi ogni `ALTER TABLE` di una migrazione veniva rifiutato con *must be owner of table*; e siccome lo script di deploy non controllava l'esito del `psql`, il codice nuovo e' partito una volta contro uno schema vecchio. Lo script salta le sequenze legate a una tabella (seguono da sole) e gestisce ogni oggetto singolarmente: un errore non fa piu' cadere l'intero blocco.
- **Fix**: il parser dell'incollato staccava la data ma poi non riconosceva piu' il numero di provvedimento, che finiva dentro il nominativo (`"Rossi Mario 900008"` → nessuna corrispondenza). Ora la tokenizzazione e' piatta e si sfoglia dalla coda: data, numero, il resto e' il nome.
- **Fix**: `package-lock.json` non veniva allineato al bump di versione, quindi `npm install` sul server lo riscriveva a ogni deploy e l'albero di lavoro restava sporco. Le versioni si alzano con `npm version <x> --workspaces --include-workspace-root --no-git-tag-version`, che aggiorna anche il lockfile.

### 26.09.08
**Provvedimento: identificativo e estremi mutuamente esclusivi (CSV HR + form gruppo)**
- **Nuovo modulo `client/src/utils/provvedimento.ts`** — unica fonte di verita' della regola: `provvedimentoMode()` decide quale blocco e' attivo, `normalizeProvvedimento()` restituisce la quadrupla da salvare/esportare azzerando il blocco inattivo. Le stringhe di soli zeri (`000000000`, `000`) sono i placeholder storici dei default e valgono come campo vuoto. Se per dati storici risultassero valorizzati entrambi i blocchi, **vince l'identificativo**.
- **Export CSV HR (`utils/biz.ts`)** — prima venivano sempre scritti `identificativoProvvedimento` e `dataProvvedimento` con `tipoProvvedimento`/`numeroProvvedimento` forzati a stringa vuota. Ora si esporta un solo blocco: con l'identificativo → `000025994;;;;`, con gli estremi → `;029;900006;2026-09-02;`, senza nulla → `;;;;`.
- **Form gruppo liquidazione (`DettaglioFormModal`, tab Provvedimento)** — mutua esclusione anche in GUI, sia in **nuovo inserimento** sia in **modifica**: valorizzando l'ID Provvedimento i tre campi Tipo/Numero/Data si disabilitano e si svuotano, e viceversa. Per cambiare blocco basta svuotare il campo valorizzato. Riga di stato sotto i campi che dichiara cosa finira' nel CSV.
- **"Espandi tutti" / "Comprimi tutti" anche in bozza** (`EditorPage`), com'era gia' nell'archivio: un solo pulsante nell'header che alterna in base allo stato corrente. Il collasso dei gruppi passa da stato interno di `DettaglioCard` a stato **controllato dal padre** (props `collapsed` / `onSetCollapsed`), stessa impostazione di `ViewerPage`. Un gruppo appena creato nasce espanso.
- **`ecosystem.config.cjs`**: commento spostato sopra la riga `cwd:` invece che in coda. Alcuni pannelli di gestione riscrivono quella riga e cancellano il commento in coda, lasciando l'albero di lavoro sporco e bloccando il `pull --ff-only` del deploy.
- **ID Provvedimento completato a 9 cifre**: si digita solo il numero (`25994`) e all'uscita dal campo — comunque al salvataggio — diventa `000025994` (`padIdentificativoProvvedimento`). Le stringhe di soli zeri restano equivalenti a "nessun identificativo".
- **Tipo Provvedimento precompilato a `029`** all'inserimento del Numero Provvedimento (default configurabile in Impostazioni; `DEFAULT_CSV_PARAMS.tipoProvvedimento` passa da `000` a `029`). I nuovi gruppi nascono senza dati provvedimento: `useStore.addDettaglio` non pre-riempie piu' `identificativoProvvedimento` con `000000000` ne' il tipo dal default.

### 26.08.17.S
**Sicurezza — provenienza dell'IP client e chiusura dell'origine**
- Corretta la determinazione dell'IP del chiamante usato per audit e rate limiting: la catena dei proxy non e' piu' considerata attendibile end-to-end. Il dettaglio tecnico e le verifiche sono nella documentazione operativa interna.
- Origine chiusa ai soli range della CDN, avviso all'avvio se la protezione anti-bot non risulta configurata in produzione, normalizzazione dei fine riga a LF.
- **Nessuna migrazione.** Gli IP registrati in `audit_log` **prima** di questa versione restano non attendibili: va tenuto presente per qualsiasi uso forense.


### 26.08.16
**Indipendenza dal database, terzo ambiente di esecuzione, avviso aggiornamenti**
- **Blocco A — accessi diretti al database chiusi (`e78a348`)**: le query che vivevano in `routes/`, `services/`, `middleware/` e `auth/` sono state spostate nel persistence layer dietro interfacce (`IRefreshTokensRepository`, `IJwtBlocklistRepository`, `IImportLogRepository`). Il vincolo e' ora verificato da un test di architettura che fallisce se un modulo sopra il persistence layer importa l'ORM o esegue SQL grezzo. Nessuna migrazione, comportamento invariato.
- **Terzo ambiente di esecuzione supportato**: reverse proxy Apache, PostgreSQL nativo, servizio systemd. Guide e script di installazione nella documentazione operativa interna.
- **Aggiornamento in un comando**: pull fast-forward, build, pubblicazione con backup rotativo, riavvio e verifica su `/health`. Si arresta se lo schema e' cambiato: le migrazioni non vengono mai applicate in automatico. Lo script vive nella documentazione operativa interna.
- **Avviso aggiornamenti in Impostazioni (solo admin)**: un timer di sistema confronta il commit installato con il remoto e scrive un file di stato; l'applicazione **legge** quel file e mostra cosa manca. Nessun pulsante che aggiorna: sarebbe esecuzione di codice arbitrario per chi ottiene un token amministratore.
- **Confinamento del servizio (`pgs-hardening.conf.example`)**: drop-in systemd con filesystem in sola lettura, nessuna capability, `/proc` e kernel schermati.
- **Correzione**: `seed.ts` scartava il token di attivazione restituito da `registerUser`, rendendo impossibile attivare il primo amministratore su un'installazione pulita. Ora stampa il link.

### 26.08.08.S
**Sicurezza — hardening a seguito dell'audit del 2026-08-07**
- **CF anagrafiche cifrato a riposo (F-1)**: `anagrafiche.cod_fis` ora è cifrato AES-256-GCM come gli altri store CF (era l'unico in chiaro). Cifratura in scrittura, decifratura trasparente in lettura (con fallback per le righe pre-cifratura), colonna portata a `VARCHAR(255)`. **Richiede una migrazione DB** (`ALTER TABLE anagrafiche ALTER COLUMN cod_fis TYPE VARCHAR(255)`) **prima** del deploy, poi lo script idempotente `server/src/db/encrypt-anagrafiche-cf-backfill.ts` per lo storico. L'import differenziale (hash sul plaintext) resta invariato.
- **Audit accessi PII non più best-effort (F-3)**: i lookup CF/liquidato CINECA scrivono l'audit in modo sincrono e fail-closed — se la registrazione fallisce, i dati personali non vengono restituiti senza traccia.
- **Audit del ciclo di vita delle liquidazioni (F-7)**: creazione, modifica, archiviazione, ripristino ed eliminazione delle bozze ora sono tracciate (`BOZZA_*`), senza mai registrare CF o importi nei dettagli.
- **Dipendenza `pdfjs-dist` server aggiornata a 6.2.108 (F-5)**: chiude GHSA-hq66 (esecuzione JS all'apertura di PDF ostili) sull'estrazione lato server.
- **Export CSV — anti formula/DDE injection (F-10)**: i campi di testo che iniziano con `= + - @` vengono neutralizzati (apostrofo) per proteggere le postazioni HR; gli importi numerici restano invariati.
- **Guardrail pre-commit attivo di default (F-11)**: uno script `prepare` imposta `core.hooksPath` al primo `npm install`, così il blocco anti-CF/segreti è attivo su ogni clone.

### 26.07.26
**Feature — Certificato da API (liquidato) + Verifica liquidato**
- **Certificati, seconda sorgente**: oltre all'upload PDF, nuovo pulsante **«Recupera cedolino» da API** (anno/mese/matricola) che costruisce il cedolino dagli **aggregati** del liquidato CINECA — `01096` lordo, `00990` previdenziali, `00991` fiscali, `00994` extraerariali — **indipendenti dal ruolo** (ND/PO). Inglobamento addizionali (`00816/01797/02787`) nelle fiscali e Abb.TFR (`01323`, 2,5% sull'80% dell'imponibile) nelle previdenziali; selezione mese corrente = capitolo `000100` **e** `flagc=0`. Badge di **quadratura** col netto in busta (voce `03003`). La matematica resta `computeCertificato()` — identica al percorso PDF (validato al centesimo su 4 cedolini reali, ruoli ND+PO). Nuovo endpoint `POST /api/v1/certificati/da-liquidato` (admin + audit).
- **Nuova sezione «Verifica liquidato»** *(admin)*: riconcilia il liquidato CINECA con gli invii PGS ricostruiti (join `matricola|voce|capitolo|dataCompVoce|riferimento`, netting conguagli/storni, encoding-safe), classi NUOVO/CONGUAGLIO/STORNO/RETTIFICA. Endpoint `GET /api/v1/verifica-liquidato/dettaglio` e `POST /riconcilia`, entrambi admin + audit (`CINECA_LIQUIDATO_LOOKUP`).
- **Note**: adapter `liquidatoAggregatiToCedolino.ts` + motore `certificatoDaAggregati.ts` con test (dati sintetici); nessun dato personale nei file versionati.

### 26.07.23
**Fix — Ricerca liquidazioni (Dashboard + Ricerca)**
- Il full-text ora include anche il **nome della liquidazione** (prima cercava solo dentro i campi dei gruppi: digitando testo presente solo nel titolo — es. «ore» o un numero di protocollo — spariva tutto).
- Aggiunta **ricerca mirata per singolo campo**, attivabile dal pulsante «Ricerca mirata»/«Mirata»: titolo gruppo, voce, capitolo, ID provvedimento, centro di costo, note — combinabili in AND tra loro, con il full-text e con il range data competenza. Stesso comportamento in Dashboard e nella pagina Ricerca.
- **Ricerca Dashboard spostata lato server**: nuovo endpoint `GET /api/v1/bozze/search` che filtra sul JSONB `dati.dettagli` in Postgres (`jsonb_array_elements` + ILIKE su campi, range su `dataCompetenzaVoce`, full-text token AND su nome liquidazione + campi gruppo) e ritorna **solo i riepiloghi** — nessun trasferimento del JSONB al client, Dashboard sempre leggera. Rispetta l'ownership (utente non admin: solo le proprie). Segnaletica di caricamento con **skeleton** durante la ricerca. Risolto il precedente blocco su «Caricamento gruppi…». Anche la pagina **Ricerca** ora filtra lato server (endpoint `/bozze/search?withData=true` → `searchFull`, che ritorna le liquidazioni corrispondenti CON `dati`, CF decifrati): il DB restringe alle sole liquidazioni che matchano (full-text esteso anche a matricola/cognome/ruolo dei nominativi), il client raffina le righe e costruisce tabella/report/export sul set restituito. Senza criteri ritorna tutto (vista completa invariata). Skeleton di caricamento sia in Dashboard sia in Ricerca.

### 26.07.22
**Feature — Valori per nominativo: importo e/o parti (per gruppo)**
- Nuovi flag di gruppo (modale gruppo → *Avanzato* → «Valori per nominativo»): **Importo** (attivo di default) e **Parti** (disattivo di default). Guardrail: non è possibile disattivarli entrambi. Retrocompatibile — le bozze esistenti restano in sola modalità importo (`flagImporto` undefined = true, `flagParti` undefined = false).
- Solo importo → comportamento invariato. Solo parti → si inserisce/esporta il valore **parti** per nominativo (decimali, es. `0,75`/`12,6`) nella colonna `parti` del CSV HR; la colonna `importo` esce `0`. Entrambi → si inseriscono ed esportano sia importo (scorporo invariato) sia parti.
- Nuovo campo `Nominativo.parti` + `DettaglioLiquidazione.flagImporto/flagParti`; schema Zod server esteso (retrocompatibile, strip-mode).
- Tabella del gruppo: colonne **Importo/Parti** condizionali con editing inline (decimali), ordinamento per parti, totali per gruppo aggiornati. Totali globali (sidebar) escludono l'importo dei gruppi in sola modalità parti.
- Estesi i tre flussi di *Aggiungi nominativo*: inserimento singolo, **Incolla lista** (il numero incollato va a importo o parti secondo i flag; colonna parti editabile in anteprima) e **Copia nominativi** (le parti vengono copiate).

**Feature — Ricerca gruppi liquidazione (Dashboard + Ricerca)**
- Nuovo campo di ricerca in **Dashboard** e nella pagina **Ricerca**: testo libero (token AND, insensibile a maiuscole/accenti) su titolo gruppo, voce, capitolo, ID provvedimento, centro di costo, note; più filtro **range su data competenza voce**. Logica condivisa in `utils/groupSearch.ts`, client-side memoizzata (istantanea alla scala del dato). In Dashboard i `dati` dei gruppi (JSONB) vengono caricati in modo **lazy** solo alla prima ricerca, così l'apertura resta leggera come prima (FIX H-1 preservato).

**Feature — Sezione Audit (solo admin)**
- Nuova pagina **Audit** (voce di menu visibile solo agli amministratori) per leggere il registro `audit_log` senza interrogare il DB: azioni tradotte in italiano con codice colore, `dettagli` JSON decodificati in frasi leggibili, colonna utente (join username), entità, IP e timestamp locale. Click su una riga → dettagli grezzi (JSON) + User-Agent.
- Filtri: ricerca libera (utente/entità/IP), azione, intervallo di date; paginazione server-side. Nuovo endpoint **admin-only** `GET /api/v1/audit` (+ `/azioni`), `PgAuditRepository.query()` con join utenti. Sola lettura: la tabella resta append-only.

**UI — Input numerici**
- Rimosse le frecce su/giù (spin button) da tutti gli `input[type=number]` dell'app (webkit + firefox), via regola globale in `index.css`. L'input resta numerico.

### 26.07.19
**Feature — Dati di archiviazione liquidazione (data + ID CSA)**
- All'**archiviazione** di una liquidazione si apre il nuovo `ArchiviaLiquidazioneModal` che richiede la **data di liquidazione** (obbligatoria) e l'**ID liquidazione CSA** (facoltativo, es. `1ND999999001220240442801`, integrabile in seguito).
- Nuove colonne `bozze.data_liquidazione` (DATE) e `bozze.id_liquidazione_csa` (VARCHAR(40)) — consolidate in [`server/sql/setup.sql`](server/sql/setup.sql) (colonne nel `CREATE TABLE` + `ALTER TABLE … ADD COLUMN IF NOT EXISTS` idempotenti per i DB pre-esistenti); la migrazione storica è `0010_liquidazione_archivio.sql`.
- `POST /bozze/:id/archive` ora valida il body con Zod (`dataLiquidazione` ISO `YYYY-MM-DD` obbligatoria, `idLiquidazioneCsa` max 40 char); nuovo endpoint `PATCH /bozze/:id/liquidazione-info` per aggiornare i dati su una liquidazione **già archiviata** (stesso modal in modalità *modifica* dal Viewer, icona matita nell'header).
- Dati visibili ovunque: **card Dashboard** (riga "Liquidata … " + ID CSA), **header Viewer**, **Ricerca** (nuova colonna *Data liq.* con tooltip ID CSA, campi inclusi nella ricerca fulltext e nell'export CSV).
- Il ripristino di un'archiviata **conserva** data/ID: alla ri-archiviazione il modal è precompilato.

### 26.07.09
**Feature — Scelta figlio WE con età alla data (cedolino/CINECA)**
- Il *Recupera CF* delle voci **WE** ora rispetta il flag *scelta automatica figlio* della `voci_config`: **ON** = figlio più giovane (comportamento invariato); **OFF** = **picker per gruppo** (`ScegliFigliBulkModal`) che elenca i figli con **età calcolata a una data as-of**, con scelta per singolo nominativo.
- Nuovo campo `DettaglioLiquidazione.dataRiferimentoFigli` (solo voci WE, default `dataCompetenzaVoce`): pilota il calcolo dell'età; l'età nel picker si **ricalcola live** al cambio data. Helper `etaAllaData` in `biz.ts`, età mostrata anche nel dropdown figli dell'inserimento singolo.
- **Hotfix picker**: il modale bulk non dipende più dal nuovo endpoint `POST /cineca/figli-bulk` (che rispondeva `404` in produzione) — usa `familiari` per matricola come l'inserimento singolo. Aggiunto tasto **Ricarica** per ripetere la chiamata CSA-WS.

**Fix — Import XLSX SGE**
- `importAnagraficheXlsx`: validazione della **MATRICOLA prima della normalizzazione**. Il vecchio `String(Number(raw)).padStart(6,'0')` su una cella non numerica (testo / errore di battitura) scriveva silenziosamente una matricola spazzatura `"000NaN"` a DB invece di segnalare l'errore. Il nuovo `normalizeMatricola()` accetta solo interi ≥ 0 / stringhe di sole cifre, altrimenti la riga finisce in `errors[]` con messaggio esplicito.

**Fix — Export CSV**
- `serializeCsv` / creazione blob: terminatore di riga **LF** invece di CRLF e **rimozione del BOM** `﻿` dal blob CSV — output allineato al tracciato HR atteso.

**Refactor / hardening**
- Rimosso **dead code** da `cryptoService`: le funzioni inutilizzate `generateSecureToken` e `fingerprintRequest` (la generazione/fingerprinting dei refresh token è gestita interamente da `AuthService`).
- `vociConfigs` esposto nello stato dello store Zustand (`useStore`) — accesso centralizzato lato editor.
- Allineato a 3 anni il commento del filtro di rilevanza in `NominativoFormModal`.

**Config / DevOps**
- [`.env.example`](.env.example) riconciliato con lo schema Zod (`config/env.ts`): aggiunta `REFRESH_RATE_LIMIT_MAX` (mancante) e nuova sezione **"Generazione chiavi sicure"** con i comandi per ogni segreto (`ENCRYPTION_KEY`/`COOKIE_SECRET` via `openssl rand -hex 32`, coppia JWT ES256, `DB_PASSWORD`, `CINECA_PROXY_SECRET`) e distinzione fra chiavi da generare e segreti forniti da terzi. Tutti i valori di esempio sono anonimizzati (nessun dato reale nel repo).

### 26.07.02
**Infrastruttura — consolidamento DB + guide migrazione VPS**
- **`server/sql/setup.sql` consolidato**: unico file idempotente per installazione su DB vuoto (ruolo via `psql -v app_password=…`, database, tutte le 17 tabelle, indici, grants least-privilege, seed template certificato). **Verificato 1:1 contro il DB di produzione** (colonne, tipi, FK, indici — inclusi `idx_anag_hash`, `idx_voci_active_range`, `idx_voci_illimitata` mai censiti prima in SQL). Rimossi i 5 file SQL obsoleti in `server/sql/`; la vecchia sezione "Indici DB aggiuntivi post-setup" di questo README è ora inclusa nel setup.
- **Fix DB produzione**: revocato `TRUNCATE` su `audit_log` a `payroll_user` (immutabilità completa); ripulite chiavi `app_settings` morte (`coefficienti_scorporo`, `csv_defaults` — il seed usava chiavi snake_case mai lette dall'app); droppata `anagrafiche_backup_pre_sge` (leftover import SGE).



### 26.07.01
**Feature — Proxy Italia per API CINECA (aggiramento geo-block IP extra-UE)**
- CINECA CSA-WS **geo-blocca gli IP fuori UE** (verificato: da IP italiano `200 OK`, da VPS extra-UE TCP timeout su `130.186.10.68:443`). Con il server ospitato fuori UE le route `/cineca/*` andavano tutte in timeout.
- Nuovo **reverse proxy in Italia** opzionale: le chiamate a CSA-WS (autenticazione, recupero CF e familiari) possono passare da un proxy con IP italiano invece che direttamente. `cinecaService.baseUrl()` sceglie proxy/diretto in base a un flag runtime; in modalità proxy aggiunge l'header `X-Proxy-Auth` (secret condiviso) su ogni chiamata.
- **Toggle admin** *Proxy Italia per API CINECA* in Impostazioni → Moduli (chiave `cinecaUseProxy` in `AppSettings`, pattern identico a `turnstileEnabled`/`pdfRegionEditorEnabled`). Applicato **a runtime** senza restart (`applyServerSideSetting` in `routes/settings.ts`, resetta la cache token); rifiutato con `400` se abilitato senza `CINECA_PROXY_URL`/`CINECA_PROXY_SECRET` nel `.env`. Ripristinato al boot da `app_settings`.
- Nuove variabili ambiente opzionali `CINECA_PROXY_URL` / `CINECA_PROXY_SECRET`.
- **Proxy Italia per CSA-WS**: CINECA geo-blocca gli IP extra-UE, quindi un server fuori dall'Unione richiede un reverse proxy in Italia. L'applicazione lo usa solo se configurato, autenticandosi con un secret che non viene inoltrato a valle. Requisiti di riservatezza: TLS end-to-end su entrambe le tratte, nessun log dei body, proxy in datacenter UE. La configurazione concreta e' nella documentazione operativa interna.

### 26.06.23
**Feature — Integrazione CINECA CSA-WS + riferimento cedolino per-nominativo (WD/WE)**
- Nuovo **proxy server-side CINECA CSA-WS** (`server/src/services/cinecaService.ts`): autenticazione JWT con cache token, recupero codici fiscali dipendenti e familiari (figli) per costruire il campo *riferimento cedolino* nel formato `WD@<anno><CF>@` (CF dipendente) / `WE@<anno><CF_figlio>@` (CF figlio più giovane, `rapportoParentela=FG`). Doc tenant: `prod.csa-ws.cineca.it/{tenant}`.
- **Config voci** (`voci_config`, tabella separata dall'import XML → sopravvive ai reimport): per ogni voce HR si impostano a mano *parti*, *tipo scorporo* e il *tag riferimento cedolino* (`TL` testo libero / `WD` CF dipendente / `WE` CF figlio + flag "scelta automatica figlio"). Pre-compila il gruppo liquidazione alla selezione della voce. UI: ingranaggio per riga in *Voci HR* (`VoceConfigModal`).
- **Riferimento per-nominativo**: il campo passa da unico-per-gruppo a per-nominativo (`Nominativo.riferimentoCedolino`, vince sul gruppo nel CSV). Sotto-riga discreta sotto ogni nominativo che mostra il riferimento se diverso dal gruppo; se mancante su voce WD/WE → **inserimento CF a mano inline** (proprio o del figlio).
- **Tasti sul gruppo liquidazione**: *Recupera CF* (solo voci WD/WE — recupero da CINECA dei soli nominativi senza riferimento, con **barra di avanzamento** annullabile) e *CSV HR del solo gruppo* selezionato.
- Migrazione `0008_cineca_riferimento.sql` (tabelle `voci_config` + `familiari_cache`).

**Performance / economia di scala — endpoint bulk (eliminazione fan-out HTTP)**
- **Aggiorna Ruolo**: da **N richieste** (1 per nominativo, che su gruppi grandi saturava il rate-limit 100/60s) a **1 sola query** `POST /anagrafiche/ruolo-at-bulk` (`matricola IN (...)`, dedup server-side). `PgAnagraficheRepository.findRuoloAtBulk`.
- **Recupero CF**: endpoint bulk `POST /cineca/cf-bulk` (WD, query locale SGE — 1 chiamata) e `POST /cineca/figli-giovane-bulk` (WE) con **cache-first** (TTL 7gg su `familiari_cache`) + **concorrenza limitata** verso CSA-WS, invece del loop sequenziale che mandava la richiesta in timeout.
- `vociConfigs` centralizzato nello store Zustand — eliminati i fetch ridondanti ad ogni apertura dei modal editor.

**Fix**
- *Aggiungi nominativo → Copia nominativi*: la lista bozze non includeva il campo `dati` (FIX H-1) → gruppi e nominativi non mostrati/copiabili. Ora carica `GET /bozze/all-with-data`.
- `setErrorHandler`: il `429` del rate-limit veniva mascherato da `500` (forzava `reply.code(500)` ignorando `statusCode`) e finiva negli error log. Ora rispetta lo `statusCode` 4xx (429 resta 429).

**Security — hardening (post review multi-agente sicurezza + efficienza)**
- **Autorizzazione PII**: tutte le route `/cineca/*` (CF dipendenti/figli) richiedono ora `requireAdmin` + **audit log** (`CINECA_CF_LOOKUP`) di ogni lookup. `/voci-config` scrittura solo admin. *(Nota: il recupero CF e il lookup figli diventano admin-only.)*
- **Cache familiari cifrata + retention**: `familiari_cache.cod_fisc` (PII, anche di minori) cifrato a riposo con AES-256-GCM (`cryptoService`) + **purge periodico** (righe > 30 giorni, ogni 6h, pattern jwt_blocklist). Migrazione `0009_familiari_cf_encrypted.sql` (allarga `cod_fisc` a `varchar(255)`).
- **Anti-hang / anti-amplificazione**: `AbortSignal.timeout(8s)` su tutte le `fetch` verso CSA-WS; bulk figli con concorrenza limitata e cap ridotto (500 → 200).
- **No message-leak**: il ramo 4xx di `setErrorHandler` non rimanda più `error.message` grezzo (poteva contenere path/matricola/PII), solo il codice d'errore; errori CINECA mappati a codice generico.

### 26.06.06
**Feature — PDF Region Editor** *(in rollout, kill-switch off — non ancora attivo in produzione)*
- Nuovo strumento admin: disegno su canvas delle regioni di riconoscimento layout direttamente sul cedolino renderizzato (`pdfjs-dist`, pagina lazy/code-split), per costruire template riusabili dal parser cedolino — coordinate salvate solo in percentuale, mai bytes/binary del PDF
- Template versionati e immutabili (`templati_pdf_region`) — ogni modifica = nuova riga auto-attivata, predecessore disattivato in transazione, `template_family_id` = lineage stabile indipendente dal nome
- Kill-switch `pdfRegionEditorEnabled` in `AppSettings` (default `false`) — pattern identico a `turnstileEnabled` (tipo → default store → merge bootstrap → guard nav/route → toggle admin in Impostazioni → Moduli)
- API `POST /:id/extract` — preview/test del template su un PDF caricato, nessuna persistenza, stesso hardening anti-abuso di `/certificati/parse`
- Migrazioni `0006_pdf_region_templates.sql` + `0007_pdf_region_one_active.sql`
- Nuova dipendenza client: `pdfjs-dist` (canvas rendering — code-split dedicato)

**Hardening — audit Gate4 pre-merge** (race condition, vincoli DB, error handling)
- **Race condition** `createNewVersion()`: `SELECT MAX(versione)` + `INSERT` non atomici sotto isolamento READ COMMITTED (default `postgres.js`) — due `PUT` concorrenti potevano leggere lo stesso MAX e collidere sull'unique `(templateFamilyId, versione)`. Fix: lock `SELECT ... FOR UPDATE` su tutte le righe della famiglia ordinate per `id` (ordine di lock deterministico → nessun deadlock 40P01 fra transazioni concorrenti), MAX ricalcolato lato applicazione dal set bloccato (Postgres rifiuta `FOR UPDATE` combinato con funzioni di aggregazione)
- **Vincolo strutturale "1 versione attiva per famiglia"**: indice unico parziale `idx_pdf_region_one_active_per_family ON templati_pdf_region(template_family_id) WHERE attivo = true` — garanzia DB-level indipendente dal codice applicativo, complementare (non sostitutiva) al lock sopra
- **`setErrorHandler` globale Fastify**: uno `ZodError` non gestito risaliva al default handler con status 500, esponendo la struttura interna dello schema di validazione nella risposta — ora normalizzato a `400 { error: 'VALIDATION_ERROR', issues: [...] }`, i 500 reali restano generici (`{ error: 'INTERNAL_SERVER_ERROR' }`, dettagli solo nei log server)
- **Cap esplicito sul base64 PDF**: `.max(12 MB)` aggiunto allo schema Zod (`pdfRegionTemplates.ts` + mirror `certificati.ts`) — esplicita a livello di contratto/validazione lo stesso limite già imposto dal `bodyLimit` di route (difesa in profondità, schema auto-documentato)
- **`DELETE /:id` su versione attiva**: prima lasciava la famiglia orfana (zero righe `attivo = true`). Fix: in transazione (stesso ordine di lock della race condition sopra — niente deadlock incrociato) riattiva automaticamente la versione restante con il numero più alto, se esiste

### 26.06.02
**Feature — Sezione Certificati**
- Nuova sezione **Certificati giuridico-stipendiali**: upload cedolino Cineca (PDF) → parsing dinamico per-sezione → ricalcolo per categoria (decimal.js, ROUND_HALF_UP) → generazione DOCX con stampa unione (segnaposto `{{path}}`, tag genere `[[m|f]]` dedotto dal CF con override manuale)
- Parser cedolino in TypeScript (`pdfjs-dist` legacy build, ricostruzione righe per coordinate) — verificato al centesimo sul cedolino reale (fiscali 326,59 · previdenziali 247,68 · netto di legge 1.647,11 · netto a pagare 1.243,52 · quinto 329,42 · settimo 235,30)
- Template-come-dato con CRUD (`templati_certificato`), regole di matching voci configurabili (no hardcoding)
- Protocollo progressivo `AAAA/NNN` **atomico** per anno solare (UPSERT in transazione su `certificato_progressivi`)
- API: `POST /certificati/parse`, `POST /certificati`, `GET /certificati`, `GET /certificati/:id/docx`, CRUD `/templati-certificato` (scrittura admin) — tutte JWT, audit log integrato (`CERTIFICATO_CREATO/SCARICATO`, `TEMPLATE_*`)
- Migrazione `0005_certificati.sql` (3 tabelle + seed template default)
- Nuove dipendenze server: `decimal.js`, `pdfjs-dist`, `docx`

**Security — hardening input non fidato (PDF caricato dall'utente)**
- **ReDoS eliminato**: regex importi `NUM` con quantificatore limitato `{0,8}` invece di `*` — backtracking quadratico azzerato (riga 100k: ~60s → ~21ms), match importi validi invariato
- **Anti-DoS estrazione PDF**: cap su pagine (40), frammenti testo (60k), righe/pagina (4k), lunghezza riga (2k); `pdfjs` con `useSystemFonts:false`, `disableFontFace:true`, `isEvalSupported:false`, `useWorkerFetch:false`
- **Prototype-chain traversal bloccato**: risoluzione segnaposto/`src` via `getByPath()` con blocklist `__proto__`/`prototype`/`constructor` + accesso solo a proprietà proprie (segnaposto `{{__proto__…}}` → stringa vuota)
- **Boundary JSON validato**: `POST /certificati` valida `parsed` con schema Zod stretto (numeri finiti, lunghezze stringa e array limitate, strip chiavi extra) invece di `z.unknown()` — niente più dati cedolino forgiabili o non-finiti nel DOCX/DB
- **Privacy (opzione A)**: il parser NON estrae IBAN/banca né i codici fiscali del nucleo familiare
- Upload PDF: validazione **magic bytes** `%PDF-` (non falsificabile come il Content-Type) + cap dimensione 8 MB, mai scritto su disco
- Sanitizzazione control-char su tutte le celle del DOCX

**Hotfix**
- Rigenerazione DOCX (`GET /certificati/:id/docx`) restituiva 500 `parsed.voci_teoriche is not iterable`: il transform `postgres.camel` camelizzava ricorsivamente le chiavi del JSONB in lettura (`voci_teoriche`→`vociTeoriche`). Fix: `PgCertificatiRepository` legge `dati_json::text` (tipo text, ignorato dal transform) + `JSON.parse` manuale → chiavi snake_case preservate. Sistema record esistenti e futuri senza rigenerazione.
- Eliminazione certificati: `DELETE /certificati/:id` (admin, header `X-Confirm-Delete`, audit `CERTIFICATO_ELIMINATO`). Rimozione definitiva + **risincronizzazione del progressivo** dell'anno a `MAX(progressivo)` rimanente (o 0) in transazione: cancellando gli ultimi N il contatore scala di N; cancellando in mezzo non si riusano numeri (no collisione su unique `anno,progressivo`). UI: bottone "Elimina" per riga (solo admin) + `ConfirmDialog`.

### 26.05.30
**Auth / UX resiliente**
- Fix HTTP 429 su bootstrap: il rate limit non causa più redirect alla login (la sessione resta valida)
- `/auth/refresh` restituisce anche `user` — eliminata la chiamata extra a `/auth/me` nel bootstrap (1 richiesta invece di 2)
- `/auth/me` spostato fuori dal rate limit auth stretto (resta sotto il solo global RL 100/60s — ha già un JWT valido)
- `/auth/refresh`: rate limit dedicato generoso (`REFRESH_RATE_LIMIT_MAX`, default 30/5min) separato dal budget stretto di `/login` — pochi F5 non causano più 429 → logout apparente. È cookie-gated con token 256-bit, il limite stretto non aggiungeva sicurezza
- Bootstrap classificato per status: 429 → **schermata di avviso dedicata** (mai login) con countdown + retry automatico (cap 5) e bottone "Riprova ora"; 5xx → toast errore; nessun logout silenzioso
- `fetch` raw del bootstrap: 429/5xx intercettati su `res.status` (raw fetch non lancia su 4xx/5xx) + cleanup timer su unmount
- `ApiError`: nuovo campo `retryAfterSec` da header `Retry-After` per le chiamate `apiFetch`

**Security**
- Patch dipendenze non-breaking: `fastify` 5.8.4 → 5.8.5 (Content-Type body schema validation bypass, HIGH), `fast-uri` 3.1.1 → 3.1.2 (path traversal via percent-encoded dot segments, HIGH)
- Audit produzione (`npm audit --omit=dev`): 7 → 5 vulnerabilità, 2 HIGH eliminate

### 26.05.23
**Security**
- `claimOtpToken()`: replay TOTP prevenuto con UPDATE atomico invece di SELECT+UPDATE (race condition eliminata)
- `incrementFailedOtp()`: lockout brute-force TOTP con CASE WHEN atomico nel singolo UPDATE
- Fix URL attivazione utente: usa `CLIENT_ORIGIN[0]` invece di array serializzato
- `BozzaDatiSchema`: validazione Zod strutturale su JSONB `dati` bozze (POST e PUT)
- `clearAuth`: reset completo di tutti i campi PII nello store (comunicazioni, anagrafiche, voci, settings, viewerBozza)
- MIME injection prevention in `emlBuilder.ts` (strip `\r` da corpo email)
- CSV injection prevention in export ricerca (escapeCsvCell con neutralizzazione formule)
- Rimosso check ridondante `Buffer.byteLength` su route XML (bodyLimit per-route già sufficiente)
- Rimosso `Object.freeze(Object.prototype)` — rompe SheetJS e librerie terze
- Audit log su PUT `/settings` (singolo e batch) — tracciabilità modifiche coefficienti

**Performance**
- `GET /bozze/all-with-data`: endpoint dedicato per RicercaPage — 1 query DB invece di 1+N (eliminato pattern N+1)
- `PgAnagraficheRepository.findAll()`: `DISTINCT ON` lato PostgreSQL — dedup server-side, −33% trasferimento dati
- `useDebounce` hook: filtro fulltext RicercaPage ricalcolato 200ms dopo l'ultimo keystroke
- `PgAnagraficheRepository.upsertMany()`: rilevamento insert/update con `(created_at = updated_at)` — atomico
- `PgVociRepository.upsertMany()`: stessa correzione sul returning `wasInserted`
- `PgCapitoliAnagRepository.upsertMany()`: stessa correzione sul returning `wasInserted`
- Argon2id refresh token: `memoryCost` 64 MB → 32 MB, `timeCost` 3 → 2, `parallelism` 4 → 1 (OWASP-compliant, −75% RAM picco)
- Indici PostgreSQL: `idx_voci_active_range(data_in, data_fin)` e `idx_voci_illimitata` (partial index)

**Infrastructure**
- `pm2-logrotate`: rotazione log PM2 a 20 MB / 7 giorni
- `z.string().date()` su parametro `data` in route anagrafiche (validazione formato ISO strict)

### 26.05.10
- Import differenziale XLSX SGE (hash SHA-256 per record)
- Storico ruoli: `findRuoloAt()` con gestione periodi sovrapposti
- `anag_import_log`: tracciamento import XLSX con contatori inseriti/aggiornati/invariati

---

## Licenza

Proprietaria — tutti i diritti riservati. Codice pubblicato a solo scopo
dimostrativo e di portfolio: è consentita la visualizzazione e la
valutazione tecnica in locale; sono vietati uso commerciale, modifica,
redistribuzione, erogazione come servizio e training di sistemi AI senza
autorizzazione scritta. Testo completo (IT vincolante + EN): [LICENSE](LICENSE).
