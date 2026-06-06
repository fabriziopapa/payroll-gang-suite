# Payroll Gang Suite

[![License](https://img.shields.io/badge/license-Proprietary%20%C2%A9%202026%20Fabrizio%20Papa-ef4444?style=flat-square)](./LICENSE)
[![Version](https://img.shields.io/badge/version-26.06.06-0ea5e9?style=flat-square)]()
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
├── client/          # SPA React/Vite
│   └── src/
│       ├── api/         # Client API tipizzati (endpoints.ts, client.ts)
│       ├── components/  # Componenti React (BudgetPanel, Layout, …)
│       ├── hooks/       # Hook personalizzati (useDebounce)
│       ├── pages/       # Dashboard, Editor, Viewer, Ricerca, Anagrafiche, …
│       ├── store/       # Stato globale Zustand
│       ├── types/       # Interfacce TypeScript condivise
│       └── utils/       # CSV / PDF / EML builder, calcoli scorporo
├── server/          # API REST Fastify
│   └── src/
│       ├── auth/        # TOTP + JWT ES256 + refresh rotante Argon2id
│       ├── db/          # Schema Drizzle + Repository pattern
│       ├── middleware/  # Autenticazione JWT
│       ├── routes/      # Endpoint REST versionate /api/v1
│       ├── schemas/     # Zod schemas validazione (BozzaDatiSchema)
│       └── services/    # Business logic (crypto, import XML/XLSX, mailer)
└── shared/          # Tipi condivisi client ↔ server
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

**Migrazione**: `server/src/db/migrations/0005_certificati.sql` (3 tabelle + seed template di default). Applicare con `psql "$DATABASE_URL" -f server/src/db/migrations/0005_certificati.sql`.

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

**Migrazioni**: `0006_pdf_region_templates.sql` (tabella + seed template "slim") e `0007_pdf_region_one_active.sql` (indice unico parziale — usa `CREATE UNIQUE INDEX CONCURRENTLY`, va eseguito **fuori da una transazione**: incollare lo statement da solo in Adminer/psql, non wrappato in `BEGIN`/`COMMIT`).

**Nginx (deploy)**: il rendering PDF carica un Web Worker da `pdfjs-dist` — la CSP servita da Nginx per la SPA deve includere `worker-src 'self';` (assente di default, va aggiunta manualmente alla direttiva `Content-Security-Policy` nel vhost — il CSP di `@fastify/helmet` lato server **non** governa gli asset statici serviti da Nginx).

---

## Setup sviluppo

**Prerequisiti:** Node.js ≥ 20, PostgreSQL ≥ 15

```bash
# 1. Installa dipendenze (tutti i workspaces)
npm install

# 2. Configura ambiente
cp .env.example .env
# Edita .env — vedi sezione Variabili Ambiente

# 3. Migrazione DB
npm run db:migrate

# 4. Avvia (client :5173 + server :3001)
npm run dev
```

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

## Deploy (VPS — aaPanel + PM2)

Vedere [`DEPLOY_AAPANEL.md`](DEPLOY_AAPANEL.md) per procedura completa.

```bash
# Avvio
pm2 start ecosystem.config.cjs

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
| `ENCRYPTION_KEY` | 32 byte hex — AES-256-GCM per TOTP secret |
| `CLIENT_ORIGIN` | URL frontend, virgola-separati per multi-origine (CORS) |
| `SMTP_HOST/PORT/USER/PASS` | Credenziali server email (opzionale) |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile (opzionale) |

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

## Indici DB aggiuntivi (post-setup)

Da eseguire una volta sul database di produzione dopo il deploy iniziale:

```sql
-- Ottimizza findActive() su voci di bilancio
CREATE INDEX IF NOT EXISTS idx_voci_active_range
  ON voci(data_in, data_fin);

CREATE INDEX IF NOT EXISTS idx_voci_illimitata
  ON voci(codice, data_in)
  WHERE data_fin = '22220202';
```

---

## Changelog

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

Privato — uso interno.
