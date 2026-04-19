# PAYROLL GANG SUITE — Deploy su VPS con aapanel

## Prerequisiti aapanel

Assicurati di avere installati in aapanel:
- **Nginx** (Software Store → Nginx)
- **Node.js** (Software Store → Node.js, versione ≥ 20 LTS)
- **PostgreSQL** (Software Store → PostgreSQL, versione ≥ 15)
- **PM2** (si installa automaticamente con il Node.js Manager)

---

## FIX — Errori npm install (ETXTBSY / workspace)

Se ottieni errori `ETXTBSY` su esbuild o `No workspaces found`:

```bash
# 1. Ferma tutti i processi Node.js (libera i file binari bloccati)
pm2 stop all 2>/dev/null || true
pkill -f node 2>/dev/null || true

# 2. Pulisci completamente node_modules e lock
cd /www/wwwroot/payroll-gang-suite
rm -rf node_modules client/node_modules server/node_modules shared/node_modules
rm -f package-lock.json

# 3. Reinstalla (node_modules freschi, senza lock)
npm install

# 4. Build separati (più affidabile di build unico su VPS)
npm run build:server
npm run build:client
```

---

## 1. PostgreSQL — Setup Database

In aapanel → **Database** → PostgreSQL → **Aggiungi database**:

| Campo | Valore |
|---|---|
| Nome DB | `payroll_gang` |
| Utente | `payroll_user` |
| Password | *(genera una password sicura)* |
| Encoding | `UTF8` |

Oppure via terminale aapanel:
```bash
psql -U postgres -f /www/wwwroot/payroll-gang-suite/server/sql/setup.sql
```

---

## 2. Upload File su VPS

Tramite aapanel **File Manager** o SFTP, carica il progetto in:
```
/www/wwwroot/payroll-gang-suite/
```

Oppure clona da Git:
```bash
cd /www/wwwroot
git clone <repo-url> payroll-gang-suite
```

---

## 3. Configurazione .env

```bash
cd /www/wwwroot/payroll-gang-suite
cp .env.example .env
```

Modifica `.env` con i valori reali. Genera le chiavi:

```bash
# Chiavi JWT ES256
openssl ecparam -genkey -name prime256v1 -noout | \
  openssl pkcs8 -topk8 -nocrypt -out /tmp/jwt_private.pem
openssl ec -in /tmp/jwt_private.pem -pubout -out /tmp/jwt_public.pem
echo "JWT_PRIVATE_KEY_BASE64=$(base64 -w 0 /tmp/jwt_private.pem)"
echo "JWT_PUBLIC_KEY_BASE64=$(base64 -w 0 /tmp/jwt_public.pem)"
rm /tmp/jwt_private.pem /tmp/jwt_public.pem

# ENCRYPTION_KEY AES-256
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
```

Incolla i valori nel `.env`. Poi:
```bash
chmod 600 .env    # solo il proprietario può leggere il file
```

---

## 4. Installa e Build

```bash
cd /www/wwwroot/payroll-gang-suite

# Ferma processi eventualmente già in esecuzione
pm2 stop all 2>/dev/null || true

# Pulizia node_modules (evita ETXTBSY)
rm -rf node_modules client/node_modules server/node_modules shared/node_modules

# Installa dipendenze
npm install

# Build separati
npm run build:server
npm run build:client
```

---

## 5. Crea Primo Utente Admin

```bash
npm run db:seed
```

- Inserisci lo username admin
- Si crea `admin-qr.html` → aprilo nel browser, scansiona il QR con Google Authenticator o Authy
- **Elimina subito `admin-qr.html` dopo la scansione**
- Chiama l'endpoint di attivazione:
  ```
  POST /api/v1/auth/activate
  { "userId": "<id-mostrato>", "token": "<6-cifre-dall-app>" }
  ```

---

## 6. Nginx — Sito Web

In aapanel → **Siti Web** → **Aggiungi sito**:
- Dominio: `payroll.tuodominio.it`
- Root: `/www/wwwroot/payroll-gang-suite/client/dist`
- PHP: **Nessuno**

Poi: **Configurazione** → sostituisci il contenuto con quello di `nginx.conf.example`
(aggiorna il nome dominio).

Poi: **SSL** → **Let's Encrypt** → emetti il certificato → **Forza HTTPS** ✓

---

## 7. Node.js Project Manager

In aapanel → **Node.js** → **Aggiungi progetto**:

| Campo | Valore |
|---|---|
| Percorso progetto | `/www/wwwroot/payroll-gang-suite` |
| File di avvio | `ecosystem.config.cjs` |
| Versione Node.js | `20 LTS` (o superiore) |
| Porta | `3001` |

Clicca **Avvia**.

---

## 8. Verifica

```bash
# Stato PM2
pm2 status

# Log applicazione
pm2 logs payroll-gang-suite --lines 50

# Health check API
curl http://127.0.0.1:3001/health
# → {"status":"ok","version":"26.4.11"}

# Verifica client (deve rispondere con HTML)
curl -s http://127.0.0.1/index.html | head -5
```

---

## Aggiornamento (dopo modifiche al codice)

```bash
cd /www/wwwroot/payroll-gang-suite
git pull
npm install
npm run build:server
npm run build:client
pm2 restart payroll-gang-suite
```

---

## Manutenzione

| Operazione | Comando |
|---|---|
| Riavvio app | `pm2 restart payroll-gang-suite` |
| Log live | `pm2 logs payroll-gang-suite --lines 100` |
| Backup DB | `pg_dump -U payroll_user payroll_gang > backup_$(date +%Y%m%d).sql` |
| Pulizia log PM2 | `pm2 flush` |
