# Payroll Gang Suite

[![License](https://img.shields.io/badge/license-Proprietary%20%C2%A9%202026%20Fabrizio%20Papa-ef4444?style=flat-square)](./LICENSE)
[![Version](https://img.shields.io/badge/version-26.07.22-0ea5e9?style=flat-square)]()
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
│       │                        # Capitoli, Certificati, PdfRegionEditor, Impostazioni, Utenti
│       ├── store/               # Stato globale Zustand (useStore.ts)
│       ├── types/               # Interfacce TypeScript + APP_VERSION
│       └── utils/               # CSV / PDF / EML builder, calcoli scorporo (biz.ts)
├── server/                      # API REST Fastify
│   ├── sql/
│   │   └── setup.sql            # ★ Setup DB CONSOLIDATO: unico file per installazione da zero
│   │                            #   (ruolo + database + 17 tabelle + indici + grants + seed)
│   └── src/
│       ├── config/              # env.ts — variabili ambiente validate Zod (fail-fast)
│       ├── auth/                # TOTP (RFC 6238) + JWT ES256 + refresh rotante Argon2id
│       ├── db/
│       │   ├── schema.ts        # ★ Schema Drizzle — fonte di verità del DB
│       │   ├── migrations/      # 0001…0010 — SOLO storico del DB di produzione esistente
│       │   │                    #   (già incluse in setup.sql: NON eseguire su install nuova)
│       │   └── repositories/    # Repository pattern (PgBozze, PgUsers, PgCertificati, …)
│       ├── middleware/          # authenticate.ts (JWT preHandler)
│       ├── routes/              # /api/v1: auth, bozze, anagrafiche, voci, capitoli,
│       │                        # settings, users, certificati, pdf-region, cineca
│       ├── schemas/             # Zod validazione (BozzaDatiSchema, …)
│       └── services/            # cryptoService, importService, mailerService, cinecaService
│           ├── cedolino/        #   parser PDF cedolino + calculator
│           ├── certificato/     #   stampa unione DOCX (+ assets)
│           └── pdfRegion/       #   estrazione via template regioni
├── shared/                      # Tipi condivisi client ↔ server
├── ecosystem.config.cjs         # PM2 (produzione)
├── nginx.conf.example           # Vhost nginx (variante aaPanel)
├── INSTALL_VPS.md               # ★ Indice guide installazione/migrazione VPS
├── INSTALL_VPS_AAPANEL.md       #   Guida completa aaPanel (+ hardening + Progetto 2)
├── INSTALL_VPS_NATIVE.md        #   Guida completa Ubuntu nativa (nginx/PM2/PG da apt)
├── CINECA_PROXY.md              # Setup proxy Italia per CSA-WS (Caddy)
└── DEPLOY_AAPANEL.md            # (legacy — sostituito dalle guide INSTALL_VPS_*)
```

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
- **Import XLSX** — anagrafiche SGE (max 10 MB, import differenziale con hash SHA-256)
- **Export CSV** — tracciato HR ufficiale (header camelCase, `codiceStatoVoce=E`), calcolo scorporo automatico, CSV injection prevention
- **Export TXT Ruoli** — file per ruolo con deduplicazione matricole
- **Comunicazioni** — generazione email con allegato PDF nominale
- **Gestione utenti** — admin panel, TOTP onboarding, ruoli admin/base, lockout anti-brute-force
- **Certificati giuridico-stipendiali** — upload cedolino Cineca (PDF) → parsing dinamico per-sezione → ricalcolo per categoria (verificato al centesimo) → generazione DOCX con stampa unione (segnaposto `{{path}}`, tag genere `[[m|f]]`), protocollo progressivo atomico per anno, template editabili (CRUD)
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

**API** (tutte sotto `/api/v1`, JWT): `POST /certificati/parse` (PDF base64, validazione magic bytes `%PDF`, mai su disco), `POST /certificati` (crea + DOCX), `GET /certificati`, `GET /certificati/:id/docx`, CRUD `/templati-certificato` (scrittura admin).

**Schema DB**: tabelle e seed template inclusi in `server/sql/setup.sql` (consolidato). La migrazione storica `0005_certificati.sql` resta solo come riferimento del DB di produzione esistente.

**Test parser**: il test end-to-end è gated da env (il cedolino contiene PII e non è committato):
```bash
CEDOLINO_SAMPLE="/percorso/Cedolino_....pdf" npm run test --workspace=server
```

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

# 2. Database — UN SOLO comando (setup.sql consolidato: ruolo, DB, 17 tabelle, seed)
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

## Deploy / Installazione VPS

Guide complete (clone → avvio → hardening → migrazione dati): **[`INSTALL_VPS.md`](INSTALL_VPS.md)**

| Percorso | Guida |
|---|---|
| aaPanel (come produzione attuale) | [`INSTALL_VPS_AAPANEL.md`](INSTALL_VPS_AAPANEL.md) |
| Ubuntu 24.04 nativo (senza pannello) | [`INSTALL_VPS_NATIVE.md`](INSTALL_VPS_NATIVE.md) |

Sequenza (dettagli nelle guide): hardening SSH/firewall → clone → `setup.sql` → `.env` → build → seed admin → PM2 → nginx+SSL → verifica. Scenario migrazione: `pg_dump`/`pg_restore` + `.env` originale (stessa `ENCRYPTION_KEY` — obbligatoria per i dati cifrati).

```bash
# Avvio
pm2 start ecosystem.config.cjs --env production

# Aggiornamento
git pull && npm install && npm run build:server && npm run build:client && pm2 restart payroll-gang-suite
```

**Log rotation** — richiede `pm2-logrotate` installato sul server:
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 7
```

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
| `CINECA_PROXY_URL` | Reverse proxy in Italia per CSA-WS (opzionale) — necessario se il server è fuori UE (CINECA geo-blocca gli IP extra-UE). Attivazione runtime dal toggle *Proxy Italia per API CINECA* in Impostazioni → Moduli. Vedi [`CINECA_PROXY.md`](CINECA_PROXY.md) |
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

### 26.07.22
**Feature — Valori per nominativo: importo e/o parti (per gruppo)**
- Nuovi flag di gruppo (modale gruppo → *Avanzato* → «Valori per nominativo»): **Importo** (attivo di default) e **Parti** (disattivo di default). Guardrail: non è possibile disattivarli entrambi. Retrocompatibile — le bozze esistenti restano in sola modalità importo (`flagImporto` undefined = true, `flagParti` undefined = false).
- Solo importo → comportamento invariato. Solo parti → si inserisce/esporta il valore **parti** per nominativo (decimali, es. `0,75`/`12,6`) nella colonna `parti` del CSV HR; la colonna `importo` esce `0`. Entrambi → si inseriscono ed esportano sia importo (scorporo invariato) sia parti.
- Nuovo campo `Nominativo.parti` + `DettaglioLiquidazione.flagImporto/flagParti`; schema Zod server esteso (retrocompatibile, strip-mode).
- Tabella del gruppo: colonne **Importo/Parti** condizionali con editing inline (decimali), ordinamento per parti, totali per gruppo aggiornati. Totali globali (sidebar) escludono l'importo dei gruppi in sola modalità parti.
- Estesi i tre flussi di *Aggiungi nominativo*: inserimento singolo, **Incolla lista** (il numero incollato va a importo o parti secondo i flag; colonna parti editabile in anteprima) e **Copia nominativi** (le parti vengono copiate).

**UI — Input numerici**
- Rimosse le frecce su/giù (spin button) da tutti gli `input[type=number]` dell'app (webkit + firefox), via regola globale in `index.css`. L'input resta numerico.

### 26.07.19
**Feature — Dati di archiviazione liquidazione (data + ID CSA)**
- All'**archiviazione** di una liquidazione si apre il nuovo `ArchiviaLiquidazioneModal` che richiede la **data di liquidazione** (obbligatoria) e l'**ID liquidazione CSA** (facoltativo, es. `1ND001950001220240442801`, integrabile in seguito).
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
- **Guide installazione/migrazione VPS**: [`INSTALL_VPS.md`](INSTALL_VPS.md) (indice) + [`INSTALL_VPS_AAPANEL.md`](INSTALL_VPS_AAPANEL.md) + [`INSTALL_VPS_NATIVE.md`](INSTALL_VPS_NATIVE.md) — hardening avanzato (SSH key-only, ufw Cloudflare-only, fail2ban, unattended-upgrades), scenario migrazione dati (`pg_dump -Fc` + restore + re-grant), checklist cambio dominio (Turnstile site key inglobata nel bundle → rebuild client), censimento cron, sezione Progetto 2 (keepalive Supabase + storage Cubbit/JuiceFS con procedura `juicefs dump --keep-secret-key`/`load` **verificata end-to-end**).



### 26.07.01
**Feature — Proxy Italia per API CINECA (aggiramento geo-block IP extra-UE)**
- CINECA CSA-WS **geo-blocca gli IP fuori UE** (verificato: da IP italiano `200 OK`, da VPS extra-UE TCP timeout su `130.186.10.68:443`). Con il server ospitato fuori UE le route `/cineca/*` andavano tutte in timeout.
- Nuovo **reverse proxy in Italia** opzionale: le chiamate a CSA-WS (autenticazione, recupero CF e familiari) possono passare da un proxy con IP italiano invece che direttamente. `cinecaService.baseUrl()` sceglie proxy/diretto in base a un flag runtime; in modalità proxy aggiunge l'header `X-Proxy-Auth` (secret condiviso) su ogni chiamata.
- **Toggle admin** *Proxy Italia per API CINECA* in Impostazioni → Moduli (chiave `cinecaUseProxy` in `AppSettings`, pattern identico a `turnstileEnabled`/`pdfRegionEditorEnabled`). Applicato **a runtime** senza restart (`applyServerSideSetting` in `routes/settings.ts`, resetta la cache token); rifiutato con `400` se abilitato senza `CINECA_PROXY_URL`/`CINECA_PROXY_SECRET` nel `.env`. Ripristinato al boot da `app_settings`.
- Nuove variabili ambiente opzionali `CINECA_PROXY_URL` / `CINECA_PROXY_SECRET`.
- **Setup proxy documentato** in [`CINECA_PROXY.md`](CINECA_PROXY.md): micro-VPS in Italia (es. Oracle Cloud Milano free tier) con **Caddy** — Caddyfile con match `X-Proxy-Auth`, `header_up -X-Proxy-Auth` (il secret non raggiunge CINECA), TLS Let's Encrypt automatico, nessun log dei body (GDPR: TLS end-to-end su entrambe le tratte, proxy in datacenter UE).

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
