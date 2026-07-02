# PAYROLL GANG SUITE — Installazione VPS con aaPanel (Ubuntu 24.04 LTS)

Da VPS vuota ad applicazione in produzione. Tempo stimato: 45–60 min.
Percorso alternativo senza pannello: [INSTALL_VPS_NATIVE.md](INSTALL_VPS_NATIVE.md).

**Scenari:**
- **A — pulita**: DB vuoto, primo admin da creare.
- **B — migrazione** (caso tipico): dati e utenti dalla VPS attuale → tutti i passi A **+** sezione [Migrazione dati](#migrazione-dati-scenario-b). Il `.env` va **copiato**, non rigenerato.

---

## 0. Prerequisiti

- Ubuntu 24.04 LTS, accesso root via SSH
- Dominio gestito su Cloudflare (proxy arancione)
- Installa aaPanel: script ufficiale da https://www.aapanel.com/new/download.html
- Da aaPanel → **App Store**:
  - **Nginx** (ultima stabile)
  - **PostgreSQL** ≥ 15
  - **Node.js Version Manager** → installa Node ≥ 20 LTS (include PM2)

---

## 1. Hardening base (prima di esporre qualsiasi cosa)

### 1a. SSH

```bash
# Copia la tua chiave pubblica (dal PC locale):
#   ssh-copy-id root@<ip-nuova-vps>

# Poi sulla VPS:
cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
MaxAuthTries 3
X11Forwarding no
EOF
systemctl restart ssh
# NON chiudere la sessione corrente finché non verifichi il login da un secondo terminale.
```

### 1b. Pannello aaPanel

Da aaPanel → **Settings** (o **Security**):
1. **Cambia porta pannello** (default 7800 → una porta alta casuale, es. 28417)
2. **Panel SSL** → abilita (certificato self-signed va bene: accesso solo tuo)
3. **Authorized IP** → il tuo IP fisso, se ce l'hai (altrimenti salta)
4. **Security entrance** → imposta un path segreto (es. `/pgs_admin_xyz`)
5. Cambia username/password default del pannello
6. **BasicAuth** aggiuntiva se disponibile

### 1c. Firewall

aaPanel gestisce il firewall dalla sezione **Security**. In alternativa `ufw` da shell:

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow <porta-pannello>/tcp
ufw allow 80,443/tcp
ufw enable
```

**Variante Cloudflare-only** (consigliata — 80/443 raggiungibili solo dagli IP Cloudflare, origine invisibile a scanner):

```bash
ufw delete allow 80,443/tcp
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do
  ufw allow proto tcp from $ip to any port 80,443 comment 'Cloudflare'
done
for ip in $(curl -s https://www.cloudflare.com/ips-v6); do
  ufw allow proto tcp from $ip to any port 80,443 comment 'Cloudflare'
done
```

> Gli IP Cloudflare cambiano raramente; ricontrolla la lista 1–2 volte l'anno.

### 1d. Fail2ban + aggiornamenti automatici

```bash
apt install -y fail2ban unattended-upgrades
cat > /etc/fail2ban/jail.local <<'EOF'
[sshd]
enabled = true
maxretry = 4
bantime  = 1h
EOF
systemctl enable --now fail2ban
dpkg-reconfigure -plow unattended-upgrades   # rispondi Yes
```

### 1e. PostgreSQL solo locale

Verifica (default aaPanel di solito già corretto):

```bash
grep listen_addresses /www/server/pgsql/data/postgresql.conf
# atteso: listen_addresses = 'localhost'  (o '127.0.0.1')
```

Se esposto: correggere e riavviare PostgreSQL dal pannello. **Mai** aprire la 5432 sul firewall.

---

## 2. Clone repository

```bash
cd /www/wwwroot
git clone <repo-url> payroll-gang-suite
cd payroll-gang-suite
```

---

## 3. Database — un solo comando

[server/sql/setup.sql](server/sql/setup.sql) è consolidato e verificato 1:1 contro produzione: ruolo, database, 17 tabelle, indici, privilegi, seed. Idempotente.

```bash
DB_PASS=$(openssl rand -hex 24)
echo "DB_PASSWORD generata: $DB_PASS"   # annotala per il passo 4

su - postgres -c "psql -v app_password=\"$DB_PASS\" -f /www/wwwroot/payroll-gang-suite/server/sql/setup.sql"
```

Output finale atteso: elenco di **17 tabelle**.

> Le migrazioni storiche (`server/src/db/migrations/0001…0009`) sono già incluse — NON eseguirle.

---

## 4. Configurazione `.env`

**Scenario B:** copia il `.env` dalla vecchia VPS (`scp`/SFTP) — contiene `ENCRYPTION_KEY` e chiavi JWT che DEVONO restare identiche. Aggiorna solo `DB_PASSWORD` (quella del passo 3) e, se cambia il dominio, le variabili della sezione [Cambio dominio](#cambio-dominio).

**Scenario A:** genera tutto da zero:

```bash
cd /www/wwwroot/payroll-gang-suite
cp .env.example .env

# Chiavi JWT ES256
openssl ecparam -genkey -name prime256v1 -noout | \
  openssl pkcs8 -topk8 -nocrypt -out /tmp/jwt_private.pem
openssl ec -in /tmp/jwt_private.pem -pubout -out /tmp/jwt_public.pem
echo "JWT_PRIVATE_KEY_BASE64=$(base64 -w 0 /tmp/jwt_private.pem)"
echo "JWT_PUBLIC_KEY_BASE64=$(base64 -w 0 /tmp/jwt_public.pem)"
rm /tmp/jwt_private.pem /tmp/jwt_public.pem

# ENCRYPTION_KEY AES-256 (64 char hex)
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
```

Minimo indispensabile in `.env`: `NODE_ENV=production`, `PORT=3001`, `CLIENT_ORIGIN=https://<dominio>`, blocco `DB_*` (host `localhost`, `DB_SSL=false`), chiavi JWT, `ENCRYPTION_KEY`.
Opzionali: `SMTP_*`, `VITE_TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY`, `CINECA_*`, `CINECA_PROXY_*`.

```bash
chmod 600 .env
```

---

## 5. Install e build

```bash
cd /www/wwwroot/payroll-gang-suite
pm2 stop all 2>/dev/null || true
rm -rf node_modules client/node_modules server/node_modules shared/node_modules
npm install
npm run build:server
npm run build:client
```

> `VITE_TURNSTILE_SITE_KEY` viene inglobata nel bundle client al build: se cambia, rifare `npm run build:client`.

---

## 6. Primo admin (solo Scenario A)

```bash
npm run db:seed
```

QR in `admin-qr.html` → scansiona con Google Authenticator/Authy → **elimina il file** → attiva via `POST /api/v1/auth/activate` o dalla pagina di login.

---

## 7. PM2

`ecosystem.config.cjs`: campo `cwd` → `/www/wwwroot/payroll-gang-suite`.

Da aaPanel → **Node.js Project Manager** → Aggiungi progetto (percorso `/www/wwwroot/payroll-gang-suite`, file di avvio `ecosystem.config.cjs`, Node ≥ 20, porta 3001) → Avvia.

Oppure da shell:

```bash
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup   # esegui il comando stampato (boot automatico)
```

Verifica: `curl http://127.0.0.1:3001/health` → `{"status":"ok",...}`

---

## 8. Nginx + SSL (dietro Cloudflare)

aaPanel → **Siti Web** → Aggiungi sito: dominio, root `/www/wwwroot/payroll-gang-suite/client/dist`, PHP **Nessuno**.

**Configurazione** → sostituisci con [nginx.conf.example](nginx.conf.example) adattando `server_name` e path certificati. Il blocco `set_real_ip_from` (IP Cloudflare) va tenuto.

SSL, due opzioni con Cloudflare proxy attivo:
- **Let's Encrypt** da aaPanel (serve passaggio DNS-only temporaneo o challenge DNS) + Cloudflare SSL mode **Full (strict)**
- **Cloudflare Origin Certificate** (15 anni, generato dal dash CF → SSL/TLS → Origin Server): incolla cert+key in aaPanel → SSL → Other certificate. Più semplice, niente rinnovi. Cloudflare mode **Full (strict)**.

Poi **Forza HTTPS** ✓.

---

## 9. Verifica

```bash
pm2 status
curl http://127.0.0.1:3001/health
curl -sI https://<dominio> | head -3
```

Login browser + prova import XML.

---

## Migrazione dati (Scenario B)

Sulla **vecchia** VPS:

```bash
pg_dump -U payroll_user -d payroll_gang -Fc -f /tmp/payroll_gang.dump
```

Trasferisci dump + `.env` sulla nuova, poi:

```bash
su - postgres -c "pg_restore -d payroll_gang --clean --if-exists --no-owner /tmp/payroll_gang.dump"

# Riallinea privilegi (il dump con --no-owner non porta i GRANT)
su - postgres -c "psql -d payroll_gang -c \"
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO payroll_user;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO payroll_user;
  REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM payroll_user;\""

rm /tmp/payroll_gang.dump
pm2 restart payroll-gang-suite
```

Checklist post-migrazione:
- [ ] `.env` copiato (stessa `ENCRYPTION_KEY` + chiavi JWT) — **non rigenerato**
- [ ] Login utente esistente + TOTP funziona (prova decifratura secret)
- [ ] Un certificato esistente si apre (prova cifratura `cf`/`dati_json`)
- [ ] Bozze e anagrafiche visibili
- [ ] Switch DNS al nuovo IP solo dopo verifica completa (Cloudflare: cambio A record, TTL istantaneo)

---

## Cambio dominio

Se la nuova VPS usa un dominio diverso:

1. **Cloudflare**: aggiungi zona/record A proxied → nuovo IP
2. **Turnstile**: la site key è legata al dominio → dash.cloudflare.com/turnstile → registra il nuovo dominio (o aggiungi hostname al widget esistente) → aggiorna `VITE_TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` in `.env`
3. `.env`: `CLIENT_ORIGIN=https://<nuovo-dominio>`, eventualmente `SMTP_FROM`
4. **Rebuild client** (site key inglobata): `npm run build:client`
5. Nginx: `server_name` + certificato per il nuovo dominio
6. Proxy CINECA: nessun impatto (ha il suo sottodominio dedicato)
7. `pm2 restart payroll-gang-suite`

---

## CINECA — VPS in UE

Nuova VPS in UE ⇒ niente geo-block: chiamate dirette a `prod.csa-ws.cineca.it`.

- Toggle **Impostazioni → Moduli → "Proxy Italia per API CINECA"** su **OFF**
- Tieni comunque `CINECA_PROXY_URL`/`CINECA_PROXY_SECRET` in `.env`: il proxy Caddy su Oracle Milano resta pronto come fallback riattivabile dal toggle senza deploy
- Setup/gestione proxy: [CINECA_PROXY.md](CINECA_PROXY.md)

---

## Cron — cosa replicare dalla vecchia VPS

Censimento VPS attuale (2026-07-02) — 8 cron attivi, quasi tutti interni aaPanel:

| Cron vecchia VPS | Replicare? | Come |
|---|---|---|
| Database di backup [pgsql] | **SÌ** | ricrea da pannello → Cron → Backup database, o cron manuale sotto |
| Sito di backup [ALL] | NO | codice su git; basta backup di `.env` (vedi sotto) |
| SSL Renew Let's Encrypt | auto | aaPanel lo ricrea da solo se usi LE; con Origin CA non serve |
| Website statistics / Nginx firewall scan (btwaf) | auto | interni aaPanel, si ricreano con i plugin |
| RAM GRATUITO (memory cleaner) | NO | cosmetico, inutile |
| Keep live supabase (`149.88.86.56/supabase_keepalive.php`) | ⚠️ altro progetto | appartiene al secondo sito PHP sulla VPS — fuori scope Payroll, decidere a parte |

Backup `.env` (contiene ENCRYPTION_KEY — perderlo = perdere i dati cifrati):

```bash
cp /www/wwwroot/payroll-gang-suite/.env /www/backup/payroll/env_$(date +%Y%m%d)
chmod 600 /www/backup/payroll/env_*
```

Copia periodicamente un backup di DB + `.env` **fuori** dalla VPS (PC locale via scp).

---

## Backup automatico DB (consigliato)

```bash
mkdir -p /www/backup/payroll
cat > /etc/cron.d/payroll-db-backup <<'EOF'
30 2 * * * postgres pg_dump -Fc payroll_gang > /www/backup/payroll/payroll_gang_$(date +\%u).dump
EOF
```

Rotazione settimanale automatica (7 file, uno per giorno). In alternativa: aaPanel → Cron → task backup DB.

---

## Troubleshooting

| Sintomo | Causa/Fix |
|---|---|
| `ETXTBSY` su npm install | `pm2 stop all && pkill -f node`, ripulisci `node_modules`, reinstalla |
| `ECONNREFUSED` al boot | `DB_SSL=true` con Postgres locale senza TLS → `false` |
| Errore Zod env al boot | variabile `.env` mancante/malformata — il log dice quale |
| 502 dal dominio | Node giù (`pm2 status`) o proxy `/api/` mancante |
| 521/522 da Cloudflare | firewall blocca gli IP CF o nginx giù |
| Turnstile fallisce sempre | site key di un altro dominio nel bundle → aggiorna `.env` + rebuild client |
| Admin bloccato (5 OTP errati) | `UPDATE users SET failed_otp_count=0, locked_until=NULL WHERE username='<admin>';` |

## Manutenzione

| Operazione | Comando |
|---|---|
| Aggiornamento codice | `git pull && npm install && npm run build:server && npm run build:client && pm2 restart payroll-gang-suite` |
| Backup manuale DB | `pg_dump -U payroll_user -Fc payroll_gang > backup_$(date +%Y%m%d).dump` |
| Log live | `pm2 logs payroll-gang-suite --lines 100` |
