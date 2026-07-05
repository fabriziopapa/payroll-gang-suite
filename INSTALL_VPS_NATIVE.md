# PAYROLL GANG SUITE — Installazione VPS nativa (Ubuntu 24.04 LTS, senza pannello)

Stack minimale gestito via SSH: nginx + PostgreSQL 16 + Node 22 + PM2, tutto da apt/NodeSource.
Meno superficie d'attacco di aaPanel, nessun pannello da proteggere. Tempo: 45–60 min.
Percorso alternativo con pannello: [INSTALL_VPS_AAPANEL.md](INSTALL_VPS_AAPANEL.md).

**Scenari:** A = pulita · B = migrazione dati (caso tipico — `.env` **copiato**, mai rigenerato).

---

## 1. Utente e hardening SSH

```bash
# Come root, crea utente operativo
adduser deploy
usermod -aG sudo deploy

# Dal PC locale: copia chiave
#   ssh-copy-id deploy@<ip-nuova-vps>

# Hardening sshd
cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
MaxAuthTries 3
X11Forwarding no
AllowUsers deploy
EOF
systemctl restart ssh
# Verifica login deploy da un SECONDO terminale prima di chiudere questo.
```

Da qui in poi: login come `deploy`, comandi privilegiati con `sudo`.

---

## 2. Firewall + fail2ban + aggiornamenti automatici

```bash
sudo apt update && sudo apt install -y ufw fail2ban unattended-upgrades

sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH

# Web SOLO dagli IP Cloudflare (origine invisibile agli scanner)
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do
  sudo ufw allow proto tcp from $ip to any port 80,443 comment 'Cloudflare'
done
for ip in $(curl -s https://www.cloudflare.com/ips-v6); do
  sudo ufw allow proto tcp from $ip to any port 80,443 comment 'Cloudflare'
done
sudo ufw enable

sudo tee /etc/fail2ban/jail.local >/dev/null <<'EOF'
[sshd]
enabled = true
maxretry = 4
bantime  = 1h
EOF
sudo systemctl enable --now fail2ban

sudo dpkg-reconfigure -plow unattended-upgrades   # Yes
```

> Se prima del cutover vuoi testare il sito senza Cloudflare (accesso diretto IP), aggiungi temporaneamente `sudo ufw allow from <tuo-ip> to any port 443`.

---

## 3. Stack: nginx + PostgreSQL + Node + PM2

```bash
sudo apt install -y nginx postgresql postgresql-contrib git

# Node 22 LTS via NodeSource (prod attuale gira su Node 24: entrambe ok, requisito ≥ 20)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

node -v   # >= 20 richiesto
psql --version
```

PostgreSQL 16 di Ubuntu 24.04 ascolta già solo su localhost (default) — verifica:

```bash
sudo -u postgres psql -c "SHOW listen_addresses;"   # atteso: localhost
```

> Nota migrazione: dump da PostgreSQL 15 → restore su 16 è supportato (pg_restore è forward-compatible).

---

## 4. Clone + database

```bash
sudo mkdir -p /srv/payroll-gang-suite
sudo chown deploy:deploy /srv/payroll-gang-suite
git clone <repo-url> /srv/payroll-gang-suite
cd /srv/payroll-gang-suite

# DB: unico comando (setup.sql consolidato — 17 tabelle, idempotente)
DB_PASS=$(openssl rand -hex 24)
echo "DB_PASSWORD generata: $DB_PASS"
sudo -u postgres psql -v app_password="$DB_PASS" -f server/sql/setup.sql
```

Output finale atteso: 17 tabelle. Le migrazioni storiche `server/src/db/migrations/` NON vanno eseguite.

---

## 5. `.env`

**Scenario B:** copia il `.env` dalla vecchia VPS — `ENCRYPTION_KEY` e chiavi JWT DEVONO restare identiche. Aggiorna solo `DB_PASSWORD` e, se cambia dominio, vedi [Cambio dominio](#cambio-dominio).

**Scenario A:** `cp .env.example .env` e genera chiavi:

```bash
openssl ecparam -genkey -name prime256v1 -noout | \
  openssl pkcs8 -topk8 -nocrypt -out /tmp/jwt_private.pem
openssl ec -in /tmp/jwt_private.pem -pubout -out /tmp/jwt_public.pem
echo "JWT_PRIVATE_KEY_BASE64=$(base64 -w 0 /tmp/jwt_private.pem)"
echo "JWT_PUBLIC_KEY_BASE64=$(base64 -w 0 /tmp/jwt_public.pem)"
rm /tmp/jwt_private.pem /tmp/jwt_public.pem
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
```

Minimo: `NODE_ENV=production`, `PORT=3001`, `CLIENT_ORIGIN=https://<dominio>`, blocco `DB_*` (`localhost`, `DB_SSL=false`), JWT, `ENCRYPTION_KEY`. Opzionali: `SMTP_*`, Turnstile, `CINECA_*`.

```bash
chmod 600 .env
```

---

## 6. Build + PM2

```bash
cd /srv/payroll-gang-suite
npm install
npm run build:server
npm run build:client
```

`ecosystem.config.cjs`: campo `cwd` → `/srv/payroll-gang-suite`.

```bash
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup systemd -u deploy --hp /home/deploy   # esegui il comando sudo stampato

curl http://127.0.0.1:3001/health   # {"status":"ok",...}
```

**Scenario A:** primo admin: `npm run db:seed` → QR in `admin-qr.html` → scansiona → **elimina il file** → attiva.

---

## 7. Nginx

Il file [nginx.conf.example](nginx.conf.example) contiene include specifici aaPanel — NON usarlo tale e quale. Config nativa pulita:

```bash
sudo tee /etc/nginx/sites-available/payroll <<'EOF'
server {
    listen 80;
    listen 443 ssl http2;
    server_name TUODOMINIO.IT;

    root /srv/payroll-gang-suite/client/dist;
    index index.html;

    # ── Cloudflare real IP ───────────────────────────────────
    real_ip_header CF-Connecting-IP;
    real_ip_recursive on;
    set_real_ip_from 173.245.48.0/20;
    set_real_ip_from 103.21.244.0/22;
    set_real_ip_from 103.22.200.0/22;
    set_real_ip_from 103.31.4.0/22;
    set_real_ip_from 141.101.64.0/18;
    set_real_ip_from 108.162.192.0/18;
    set_real_ip_from 190.93.240.0/20;
    set_real_ip_from 188.114.96.0/20;
    set_real_ip_from 197.234.240.0/22;
    set_real_ip_from 198.41.128.0/17;
    set_real_ip_from 162.158.0.0/15;
    set_real_ip_from 104.16.0.0/13;
    set_real_ip_from 104.24.0.0/14;
    set_real_ip_from 172.64.0.0/13;
    set_real_ip_from 131.0.72.0/22;

    # ── SSL (Cloudflare Origin Certificate) ──────────────────
    ssl_certificate     /etc/ssl/cloudflare/origin.pem;
    ssl_certificate_key /etc/ssl/cloudflare/origin.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    # ── Security headers ─────────────────────────────────────
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Frame-Options            "DENY" always;
    add_header X-Content-Type-Options     "nosniff" always;
    add_header Referrer-Policy            "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy         "camera=(), microphone=(), geolocation=()" always;
    add_header Content-Security-Policy    "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; worker-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; object-src 'none'; frame-ancestors 'none'" always;

    # ── API → Node ────────────────────────────────────────────
    location /api/ {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # Blocca source map residui
    location ~* \.map$ { return 403; }

    # File nascosti/sensibili
    location ~ /\.(env|git|htaccess|svn) { return 404; }

    # Cache statici
    location ~* \.(gif|jpg|jpeg|png|bmp|svg|woff2?)$ { expires 30d; access_log off; }
    location ~* \.(js|css)$                          { expires 12h; access_log off; }

    # SPA fallback (React Router)
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

sudo sed -i 's/TUODOMINIO.IT/<tuo-dominio>/' /etc/nginx/sites-available/payroll
sudo ln -s /etc/nginx/sites-available/payroll /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
```

### Certificato (dietro Cloudflare → Origin CA, consigliato)

Dash Cloudflare → **SSL/TLS → Origin Server → Create Certificate** (RSA, 15 anni, hostname `<dominio>` + `*.<dominio>`):

```bash
sudo mkdir -p /etc/ssl/cloudflare
sudo nano /etc/ssl/cloudflare/origin.pem   # incolla il certificato
sudo nano /etc/ssl/cloudflare/origin.key   # incolla la chiave privata
sudo chmod 600 /etc/ssl/cloudflare/origin.key

sudo nginx -t && sudo systemctl reload nginx
```

Cloudflare → SSL/TLS mode: **Full (strict)**. Niente rinnovi per 15 anni.
(Alternativa: `sudo apt install certbot python3-certbot-nginx` + `certbot --nginx` — ma con firewall Cloudflare-only la challenge HTTP passa comunque dal proxy CF, ok.)

---

## 8. Verifica

```bash
pm2 status
curl http://127.0.0.1:3001/health
curl -sI https://<dominio> | head -3    # dopo switch DNS
```

---

## Migrazione dati (Scenario B)

Vecchia VPS:

```bash
pg_dump -U payroll_user -d payroll_gang -Fc -f /tmp/payroll_gang.dump
```

Nuova VPS (dump trasferito in /tmp):

```bash
sudo -u postgres pg_restore -d payroll_gang --clean --if-exists --no-owner /tmp/payroll_gang.dump

sudo -u postgres psql -d payroll_gang -c "
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO payroll_user;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO payroll_user;
  REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM payroll_user;"

rm /tmp/payroll_gang.dump
pm2 restart payroll-gang-suite
```

Checklist:
- [ ] `.env` copiato (stessa `ENCRYPTION_KEY` + JWT) — **non rigenerato**
- [ ] Login + TOTP di utente esistente funziona
- [ ] Un certificato esistente si apre correttamente
- [ ] Bozze/anagrafiche visibili
- [ ] Switch DNS (Cloudflare A record) solo dopo verifica completa

---

## Cambio dominio

1. Cloudflare: zona/record A proxied → nuovo IP
2. Turnstile: site key legata al dominio → registra nuovo dominio su dash.cloudflare.com/turnstile → aggiorna `VITE_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` in `.env`
3. `.env`: `CLIENT_ORIGIN`, eventualmente `SMTP_FROM`
4. **Rebuild client** (`npm run build:client` — site key inglobata nel bundle)
5. Nginx `server_name` + certificato Origin CA per il nuovo dominio
6. Proxy CINECA: nessun impatto
7. `pm2 restart payroll-gang-suite`

---

## CINECA — VPS in UE

Geo-block CINECA colpisce solo IP extra-UE ⇒ da VPS UE chiamate dirette.

- Toggle **Impostazioni → Moduli → Proxy Italia** su **OFF**
- Tieni `CINECA_PROXY_URL`/`CINECA_PROXY_SECRET` in `.env`: proxy Caddy (Oracle Milano) resta fallback riattivabile a runtime
- Dettagli: [CINECA_PROXY.md](CINECA_PROXY.md)

---

## Backup automatico DB

```bash
sudo mkdir -p /srv/backup/payroll
sudo chown postgres:postgres /srv/backup/payroll
sudo tee /etc/cron.d/payroll-db-backup >/dev/null <<'EOF'
30 2 * * * postgres pg_dump -Fc payroll_gang > /srv/backup/payroll/payroll_gang_$(date +\%u).dump
EOF
```

Rotazione automatica su 7 file (uno per giorno della settimana).

---

## Progetto 2 — Keepalive Supabase + storage Cubbit (JuiceFS)

Identico al percorso aaPanel — vedi sezione completa in [INSTALL_VPS_AAPANEL.md](INSTALL_VPS_AAPANEL.md#progetto-2--keepalive-supabase--storage-cubbit-juicefs). Differenze sul percorso nativo:

```bash
sudo apt install -y php8.3-cli php8.3-curl redis-server
# redis: imposta requirepass NUOVA in /etc/redis/redis.conf (bind 127.0.0.1 già default), restart
curl -sSL https://d.juicefs.com/install | sh -
```

Poi identico: `juicefs dump --keep-secret-key` sulla vecchia → copia `/www/wwwroot/<IP_VPS>` + `/www/keepalive_private` (stessi path: hardcoded nello script) → `juicefs load` → systemd unit → cron in `/etc/cron.d/supabase-keepalive`.

**Non servono sulla nuova VPS:** MariaDB (vuoto), Docker/containerd (inutilizzati), vhost nginx del sito 2 (fermato — gira solo il cron CLI).

---

## Troubleshooting

| Sintomo | Causa/Fix |
|---|---|
| `ETXTBSY` npm install | `pm2 stop all && pkill -f node`, pulisci `node_modules`, reinstalla |
| `ECONNREFUSED` boot server | `DB_SSL=true` con PG locale senza TLS → `false` |
| Errore Zod env | variabile `.env` mancante — log indica quale |
| 521/522 Cloudflare | nginx giù o ufw non ha gli IP CF |
| `peer authentication failed` psql | usa `sudo -u postgres psql` oppure connessione TCP con password |
| Turnstile fallisce | site key di altro dominio nel bundle → `.env` + rebuild client |
| Admin bloccato | `UPDATE users SET failed_otp_count=0, locked_until=NULL WHERE username='<admin>';` |

## Manutenzione

| Operazione | Comando |
|---|---|
| Aggiornamento codice | `git pull && npm install && npm run build:server && npm run build:client && pm2 restart payroll-gang-suite` |
| Backup manuale | `sudo -u postgres pg_dump -Fc payroll_gang > backup_$(date +%Y%m%d).dump` |
| Log live | `pm2 logs payroll-gang-suite --lines 100` |
