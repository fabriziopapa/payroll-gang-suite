# Payroll Gang Suite

[![License](https://img.shields.io/badge/license-Proprietary%20%C2%A9%202026%20Fabrizio%20Papa-ef4444?style=flat-square)](./LICENSE)
[![Version](https://img.shields.io/badge/version-26.05.23-0ea5e9?style=flat-square)]()
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
