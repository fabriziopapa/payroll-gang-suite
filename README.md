# Payroll Gang Suite

[![License](https://img.shields.io/badge/license-Proprietary%20%C2%A9%202026%20Fabrizio%20Papa-ef4444?style=flat-square)](./LICENSE)
[![Version](https://img.shields.io/badge/version-26.05.08-0ea5e9?style=flat-square)]()
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
| Auth | Passwordless TOTP (RFC 6238), JWT ES256, refresh token rotanti Argon2 |

---

## Struttura monorepo

```
payroll-gang-suite/
├── client/          # SPA React/Vite
│   └── src/
│       ├── api/         # Client API tipizzati
│       ├── components/  # Componenti React (BudgetPanel, Layout, …)
│       ├── pages/       # Dashboard, Editor, Viewer, Ricerca, Anagrafiche, …
│       ├── store/       # Stato globale Zustand
│       ├── types/       # Interfacce TypeScript condivise (ImportoBudgetItem, …)
│       └── utils/       # CSV / PDF / EML builder, calcoli scorporo
├── server/          # API REST Fastify
│   └── src/
│       ├── auth/        # TOTP + JWT ES256 + refresh rotante
│       ├── db/          # Schema Drizzle + Repository pattern
│       ├── middleware/  # Autenticazione JWT
│       ├── routes/      # Endpoint REST
│       └── services/    # Business logic (crypto, import XML, mailer)
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
- **Ricerca** — ricerca fulltext cross-bozza (per nome o testo libero), report aggregati per matricola / voce / periodo con export CSV
- **Import XML** — anagrafiche e voci da file DATAPACKET HR
- **Export CSV** — tracciato HR ufficiale (header camelCase, `codiceStatoVoce=E`, `numeroProvvedimento` e `tipoProvvedimento` sempre vuoti), calcolo scorporo automatico
- **Export TXT Ruoli** — file per ruolo con deduplicazione matricole (disponibile sia sul singolo gruppo che globale su tutta la bozza)
- **Comunicazioni** — generazione email con allegato PDF nominale
- **Gestione utenti** — admin panel, TOTP onboarding, ruoli admin/base

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

---

## Variabili Ambiente

Copiare `.env.example` → `.env`. Valori obbligatori:

| Variabile | Descrizione |
|---|---|
| `DB_HOST/PORT/NAME/USER/PASSWORD` | Connessione PostgreSQL |
| `JWT_PRIVATE_KEY_BASE64` | Chiave privata ES256 (Base64) |
| `JWT_PUBLIC_KEY_BASE64` | Chiave pubblica ES256 (Base64) |
| `ENCRYPTION_KEY` | 32 byte hex — AES-256-GCM per TOTP secret |
| `SMTP_HOST/PORT/USER/PASS` | Credenziali server email |
| `CLIENT_ORIGIN` | URL frontend (CORS) |

---

## Sicurezza

- Auth passwordless: TOTP (RFC 6238) + JWT ES256 asimmetrico
- Refresh token: hash Argon2id, rotante, fingerprint UA+IP per theft detection
- Cookie: `HttpOnly` + `Secure` + `SameSite=Strict`
- TOTP secret cifrati a riposo con AES-256-GCM
- Replay OTP prevenuto con `lastOtpToken`
- Rate limiting: 5 tentativi / 5 min su endpoint auth
- Audit log append-only (REVOKE UPDATE/DELETE a livello DB)

---

## Licenza

Privato — uso interno.
