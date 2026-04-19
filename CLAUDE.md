# CLAUDE.md — Payroll Gang Suite

SPA React + API Fastify per liquidazioni variabili personale universitario (HR Suite).
Monorepo npm workspaces: `client/`, `server/`, `shared/`.
Versione corrente: `26.4.x` (schema `AA.MM.GG`).
Deploy live: https://tuodominio.it

---

## Comandi rapidi

```bash
npm run dev            # Avvia tutto (client :5173 + server :3001)
npm run build          # Build completo client + server
npm run typecheck      # TypeScript check no-emit (entrambi i workspace)
npm run db:migrate     # Applica migrazioni Drizzle
npm run db:seed        # Crea primo utente admin
```

---

## Client — `client/src/`

```
api/
  client.ts            # apiFetch: JWT Authorization header + refresh automatico su 401
  endpoints.ts         # Tutte le interfacce API (BozzaApi, UserApi, …) e funzioni tipizzate

components/
  editor/
    DettaglioCard.tsx        # Card gruppo liquidazione: nominativi, badge modifiedBy, azioni
    DettaglioFormModal.tsx   # Form aggiunta/modifica gruppo (3 tab: Principale, Provvedimento, Avanzato)
    ComunicazioneModal.tsx   # Gestione comunicazione con allegato PDF
  ConfirmDialog.tsx          # Dialog conferma azione distruttiva — USARE SEMPRE (mai window.confirm)
  ToastManager.tsx           # showToast(msg, type) — notifiche globali
  RuoloDisambiguaModal.tsx   # Risoluzione ambiguità ruolo storico (>1 risultato DB)
  ConflittoRuoloModal.tsx    # Conflitto ruolo manuale vs DB storico

pages/
  DashboardPage.tsx    # Lista bozze (filtro: bozze/archiviate/tutte), BozzaCard con badge creatore
  EditorPage.tsx       # Editor principale con auto-save
  AnagrafichePage.tsx  # Import XML DATAPACKET HR
  VociPage.tsx         # Import XML voci di bilancio
  CapitoliPage.tsx     # Import XML capitoli anagrafica
  ImpostazioniPage.tsx # AppSettings (coefficienti scorporo, CSV defaults, rubrica, modelli)
  UtentiPage.tsx       # Admin: gestione utenti, TOTP, ruoli

store/
  useStore.ts          # Zustand + immer. Sezioni: auth, navigazione, editor, dati DB, UI

types/
  index.ts             # DettaglioLiquidazione, Nominativo, Comunicazione, AppSettings, …

utils/
  pdfBuilder.ts        # buildPdfDoc / downloadPdf / buildPdfBase64; buildPdfFilename (sanitize)
  emlBuilder.ts        # buildEml / downloadEml — MIME multipart con PDF base64
  csvBuilder.ts        # buildCsvRows → tracciato HR ufficiale
  biz.ts               # calcolaImportoCSV (scorporo), formatEur

constants/
  csvDefaults.ts       # DEFAULT_CSV_PARAMS, PALETTE_DETTAGLIO (colori round-robin gruppi)
  scorporoCoefficients.ts  # DEFAULT_COEFFICIENTI_SCORPORO per ruolo
```

---

## Server — `server/src/`

```
app.ts                 # Entry Fastify: plugin (cors, helmet, cookie, rate-limit), route prefix /api/v1
config/env.ts          # Variabili ambiente validate con Zod (fail-fast al boot)

auth/
  AuthService.ts       # JWT ES256 (sign/verify), refresh token rotante, fingerprint UA+IP
  IAuthModule.ts       # Interface pluggabile per future strategie auth
  modules/TOTPAuthModule.ts  # RFC 6238 TOTP con replay prevention (lastOtpToken)

db/
  schema.ts            # Drizzle ORM: users, bozze, anagrafiche, voci, capitoli, appSettings, auditLog
  connection.ts        # Pool postgres.js
  IRepository.ts       # Interfacce abstract (BozzaRow, UserRow, AnagraficaRow, …)
  repositories/
    PgBozzeRepository.ts      # CRUD bozze; findAll/findById con LEFT JOIN users → createdByUsername
    PgUsersRepository.ts      # CRUD utenti, activation token, TOTP secret
    PgAnagraficheRepository.ts# Upsert anagrafiche HR, ruoloAt (storico a data)
    PgVociRepository.ts       # Voci di bilancio con capitoli annidati
    PgCapitoliAnagRepository.ts
    PgSettingsRepository.ts   # JSONB chiave/valore
    PgAuditRepository.ts      # Append-only audit log

middleware/
  authenticate.ts      # Fastify preHandler: verifica JWT, inietta req.user

routes/
  auth.ts              # POST /login /activate /logout /register; GET /me; POST /:id/regen-qr
  bozze.ts             # GET/POST / ; PUT/DELETE /:id ; POST /:id/archive|restore
  anagrafiche.ts       # GET / ; POST /import ; GET /ruolo-at ; GET /last-import
  voci.ts              # GET / /active ; POST /import ; GET /last-import
  capitoli.ts          # GET / ; POST /import ; GET /last-import
  settings.ts          # GET/PUT /
  users.ts             # Admin: GET / ; PUT /:id/active|admin ; DELETE /:id

services/
  cryptoService.ts     # AES-256-GCM: encryptTotp / decryptTotp
  importService.ts     # Parser XML DATAPACKET HR v2 (anagrafiche) + Lista_voci
  mailerService.ts     # SMTP nodemailer (attivazione utenti)
```

---

## Store Zustand (useStore.ts)

| Sezione | Campi chiave |
|---|---|
| auth | `user` (UserApi), `accessToken`, `bootstrapDone` |
| navigazione | `currentPage` (PageId) |
| editor | `currentBozzaId`, `currentBozzaNome`, `nominativi`, `dettagli`, `comunicazioni`, `isDirty` |
| dati DB | `bozze`, `anagrafiche`, `voci`, `capitoliAnag`, `settings` |
| UI | `isLoading`, `globalError` |

**Actions importanti:**
- `updateDettaglio(id, updates)` — applica updates + setta `modifiedBy = user.username` automaticamente
- `loadBozzaInEditor(bozza)` — deserializza JSONB `dati` → stato editor
- `newLiquidazione()` — reset editor, naviga a 'editor'
- `markSaved(bozzaId)` — resetta `isDirty` dopo salvataggio su DB

---

## Tipi principali

```typescript
// types/index.ts
DettaglioLiquidazione   // Gruppo: voce, capitolo, competenza, nominativi collegati per dettaglioId
                        // Campi extra: modifiedBy? (chi ha modificato per ultimo)
Nominativo              // matricola, cognomeNome, ruolo, importoLordo, ruoloModificato?
Comunicazione           // Email+allegato PDF per un gruppo; campiAllegato[] selezionati
AppSettings             // coefficienti, csvDefaults, tags, rubrica, modelliComunicazione
BozzaDati               // JSONB del campo dati: { nominativi, dettagli, comunicazioni, protocolloDisplay }

// api/endpoints.ts
BozzaApi                // + createdByUsername (da LEFT JOIN users lato server)
UserApi                 // id, username, isAdmin
```

---

## Regole UI

1. **Sempre `ConfirmDialog`** per azioni distruttive — mai `window.confirm()`
2. **`showToast`** per feedback operazioni (success/error)
3. Bozze **attive**: azioni visibili su hover (`opacity-0 group-hover:opacity-100`)
4. Bozze **archiviate**: azioni sempre visibili (Ripristina + Elimina in chiaro)
5. Badge **creatore**: "Tu" (indigo) o "{username}" (violet) su ogni BozzaCard
6. Badge **modificatore gruppo**: `mod. {username}` (slate) nell'header DettaglioCard

---

## Naming conventions

- **Versione**: `AA.MM.GG` (es. `26.04.19`) — aggiornare in `types/index.ts` (`APP_VERSION`) e `package.json`
- **Colori gruppi**: palette round-robin `PALETTE_DETTAGLIO` — assegnati da `nextDetColor()` nello store
- **ID**: `crypto.randomUUID()` client-side per nominativi e dettagli
- **Filename PDF/EML**: `buildPdfFilename(bozzaNome, gruppoNome)` — strip accenti, chars illegali → `{a}_{b}.pdf`
- **CSS**: TailwindCSS utility-first; slate-900 bg, indigo-600 accent, red-400 danger

---

## API — Schema risposta bozze

`GET /bozze` e mutazioni restituiscono `BozzaApi`:
```json
{
  "id": "uuid",
  "nome": "TFA Sostegno 2025/26",
  "stato": "bozza | archiviata",
  "protocolloDisplay": "0012345/2026 del 10/04/2026",
  "dati": { "nominativi": [], "dettagli": [], "comunicazioni": [], "protocolloDisplay": "" },
  "createdBy": "uuid-utente",
  "createdByUsername": "fpapa",
  "createdAt": "ISO",
  "updatedAt": "ISO"
}
```

`dati` è JSONB — contiene l'intero stato dell'editor serializzato.

---

## Tracciati XML — Formato import

Tutti e tre i file usano il formato **DATAPACKET 2.0**: tag `<ROW />` con i dati come attributi.

**Struttura wrapper obbligatoria:**
```xml
<?xml version="1.0" standalone="yes"?>
<DATAPACKET Version="2.0">
  <METADATA/>
  <ROWDATA>
    <ROW CAMPO1="valore" CAMPO2="valore" ... />
    <ROW CAMPO1="valore" CAMPO2="valore" ... />
  </ROWDATA>
</DATAPACKET>
```

Il parser legge solo i tag `<ROW ... />` e ne estrae gli attributi.
Il campo `RowState` viene ignorato. Valori vuoti (`=""`) vengono trattati come assenti.

---

### 1. Anagrafiche — `Elenchi_del_personale_v2.xml`

**Endpoint:** `POST /api/v1/anagrafiche/import`
**Chiave upsert:** `(MATRICOLA, DECOR_INQ)`

| Campo | Tipo | Obbligatorio | Formato | Note |
|---|---|---|---|---|
| `MATRICOLA` | string | **sì** | es. `"000123"` | Codice dipendente |
| `COGN_NOME` | string | **sì** | `"COGNOME Nome"` | Maiuscolo + Nome |
| `RUOLO` | string | **sì** | descrizione testuale | Mappato su codice breve (vedi sotto) |
| `DECOR_INQ` | string | no | `YYYYMMDD` | Inizio periodo inquadramento; se assente usa data import |
| `FIN_RAP` | string | no | `YYYYMMDD` | Fine rapporto; assente = dipendente attivo |
| `INQUADR` | string | no | testo libero | Qualifica dettagliata (druolo); se assente usa RUOLO |

**Mapping RUOLO → codice breve** (usato internamente e nel CSV HR):

| Valore RUOLO nel file | Codice |
|---|---|
| `Professori Ordinari` | `PO` |
| `Professori Associati` | `PA` |
| `Ricercatori Universitari` | `RU` |
| `Ricercatori Legge 240/10 - t.det.` | `RD` |
| `Ricercatori Legge 240/10 - t.ind.` | `RD` |
| `Personale non docente` | `ND` |
| `NON DOCENTI A TEMPO DET. (TESORO)` | `ND` |
| `Dirigente` | `DI` |
| `Dirigente a contratto` | `DI` |
| qualsiasi altro valore | primi 10 char UPPERCASE |

**Esempio ROW valida:**
```xml
<ROW MATRICOLA="000123" COGN_NOME="ROSSI Mario"
     RUOLO="Professori Associati" INQUADR="Prof. Associato L.240"
     DECOR_INQ="20200901" FIN_RAP="" />
```

---

### 2. Voci di bilancio — `Lista_voci_*.xml`

**Endpoint:** `POST /api/v1/voci/import`
**Chiave upsert:** `(codice, DATA_IN)` — una voce può avere più periodi

| Campo | Tipo | Obbligatorio | Formato | Note |
|---|---|---|---|---|
| `COD_DESCR` | string | **sì** | `"NNNNN - Descrizione"` | Codice e descrizione separati da ` - ` |
| `DATA_IN` | string | no | `YYYYMMDD` | Inizio validità; default `19000101` |
| `DATA_FIN` | string | no | `YYYYMMDD` | Fine validità; `22220202` = illimitata |
| `COD_CAP` | string | no | es. `"004665"` | Codice capitolo associato |
| `DESCR_CAP` | string | no | testo | Descrizione del capitolo |
| `TIPO` | string | no | es. `"S"` | Tipo voce |
| `PERSONALE` | string | no | es. `"D"` | Categoria personale |
| `IMMISSIONE` | string | no | testo | Modalità immissione |
| `CONGUAGLIO` | string | no | testo | Tipo conguaglio |

**Nota:** ogni voce può generare più `ROW` con lo stesso `COD_DESCR` ma diverso `COD_CAP` — il parser le aggrega in una voce con lista capitoli.

**Esempio ROW valida:**
```xml
<ROW COD_DESCR="00068 - Fondo di Incentivazione"
     DATA_IN="20090101" DATA_FIN="22220202"
     COD_CAP="004665" DESCR_CAP="Fondo incentivazione docenti"
     TIPO="S" />
```

---

### 3. Capitoli anagrafica — `Capitoli_STAMPA.xml` / `Capitoli_Locali_STAMPA.xml`

**Endpoint:** `POST /api/v1/capitoli/import` (body: `{ xml, sorgente: "standard"|"locali" }`)
**Chiave upsert:** `(CAPITOLO, sorgente)`

| Campo | Tipo | Obbligatorio | Formato | Note |
|---|---|---|---|---|
| `CAPITOLO` | string | **sì** | es. `"004665"` | Codice capitolo |
| `DESCR` | string | no | testo | Descrizione estesa |
| `BREVE` | string | no | testo | Descrizione breve |
| `TIPO_LIQ` | string | no | `"S"` / `"P"` / … | Tipo liquidazione |
| `F_CAPITOLO` | string | no | char | Flag capitolo |
| `DATA_INS` | string | no | data testo | Data inserimento |
| `DATA_MOD` | string | no | data testo | Data ultima modifica |
| `OPERATORE` | string | no | testo | Operatore che ha modificato |

**Esempio ROW valida:**
```xml
<ROW CAPITOLO="004665" DESCR="Fondo incentivazione docenti"
     BREVE="F.Incent." TIPO_LIQ="S" />
```

---

## Deploy

- **VPS**: aaPanel + Nginx + PM2 + PostgreSQL 15
- **Client**: Nginx serve `client/dist/` — SPA con fallback `try_files $uri /index.html`
- **Server**: PM2 `node --env-file=../.env dist/app.js` su porta 3001
- **Proxy**: Nginx `/api/` → `http://127.0.0.1:3001`
- **SSL**: Let's Encrypt via aaPanel
- Procedura completa: `DEPLOY_AAPANEL.md`

---

## Note sicurezza

- **Mai committare `.env`** — già in `.gitignore`
- **`admin-qr.html`** generato da `npm run db:seed` — eliminare subito dopo scansione QR
- File XML/CSV HR contengono dati personali dipendenti — mai committare (in `.gitignore`)
- Chiavi JWT e `ENCRYPTION_KEY` in `.env` — ruotare se compromesse
