# PGS — Installazione su server cPanel/WHM

Guida completa per installare Payroll Gang Suite su un **server cPanel/WHM con accesso root**
(VPS o dedicato). Ambiente di riferimento: cPanel & WHM su AlmaLinux/CloudLinux o Ubuntu LTS,
EasyApache 4, PostgreSQL nativo, applicazione Node.js gestita da systemd dietro reverse proxy Apache.

Documenti correlati: [`INSTALL_VPS_NATIVE.md`](INSTALL_VPS_NATIVE.md) (VPS senza pannello),
[`INSTALL_VPS_AAPANEL.md`](INSTALL_VPS_AAPANEL.md) (aaPanel), [`CINECA_PROXY.md`](CINECA_PROXY.md).

> **Serve l'accesso root.** Su hosting condiviso cPanel senza root questa guida non è applicabile:
> PGS richiede PostgreSQL, che gli hosting condivisi tipicamente non offrono. Vedi
> [§11 Alternative senza root](#11-alternative-senza-root).

---

## 0. Procedura automatica (consigliata)

L'intera installazione è automatizzata da due script versionati nel repository:

| Script | Ruolo |
|---|---|
| [`cpanel-setup.sh`](cpanel-setup.sh) | **installa**: pacchetti, database, `.env`, build, servizio, proxy |
| [`cpanel-check.sh`](cpanel-check.sh) | **verifica**: sola lettura, non modifica nulla |

Sono due file distinti di proposito: un installatore che si autocertifica non è una
verifica: se sbaglia una scrittura, sbaglia allo stesso modo nel controllarla.
`cpanel-setup.sh` invoca `cpanel-check.sh` al termine, quindi per chi installa resta
un comando solo.

```bash
mkdir -p /home/pgs/apps && cd /home/pgs/apps
git clone https://github.com/fabriziopapa/payroll-gang-suite.git
cd payroll-gang-suite

PGS_DOMAIN=dominio.tld bash cpanel-setup.sh
```

Lo script è **idempotente**: rileva ciò che è già presente e lo salta, quindi si può
rilanciare dopo una correzione senza rifare tutto. In particolare non sovrascrive mai
un `.env` esistente e non rigenera i segreti già presenti — rigenerare `ENCRYPTION_KEY`
renderebbe illeggibili i dati cifrati già in archivio.

Durante l'esecuzione chiede l'`ENCRYPTION_KEY`: se si importeranno dati da un altro
ambiente **deve essere quella di origine**. Lo script ne stampa l'impronta (un hash, mai
la chiave) per poterla confrontare con quella dell'ambiente sorgente.

Variabili riconosciute: `PGS_USER` (default `pgs`), `PGS_DOMAIN`, `PGS_PORT` (3001),
`PGS_ENCRYPTION_KEY`, `PGS_SKIP_PKG=1` per non installare pacchetti, `PGS_ASSUME_YES=1`
per l'esecuzione non interattiva, `PGS_FORCE_NPM=1` e `PGS_FORCE_UNIT=1` per forzare
rispettivamente la reinstallazione delle dipendenze e la riscrittura della unit systemd.

> Entrambi gli script vanno **eseguiti con `bash`**, mai caricati con `source`: contengono
> `exit` e chiuderebbero la shell di login. Vanno inoltre trasferiti come file (via
> `git clone`/`git pull` o `scp`), non incollati nel terminale: un incolla viene
> interpretato riga per riga dalla shell, che eseguirebbe l'`exit` finale chiudendo
> la sessione SSH.

I capitoli seguenti descrivono le stesse operazioni passo per passo, per farle a mano
o per capire cosa fa lo script.

---

## 1. Architettura su cPanel

```text
              Internet
                 │  HTTPS (certificato AutoSSL di cPanel)
                 ▼
      ┌────────────────────────────────────────────┐
      │  Apache (EasyApache 4) — vhost del dominio │
      │                                            │
      │  /            → file statici del client    │
      │                 /home/<utente>/public_html │
      │  /api/        → ProxyPass 127.0.0.1:3001   │
      │  /.well-known → escluso dal proxy (AutoSSL)│
      └───────────────────┬────────────────────────┘
                          │
                          ▼
          Node.js (Fastify) — servizio systemd
          in ascolto SOLO su 127.0.0.1:3001
                          │
                          ▼
          PostgreSQL 17 — in ascolto SOLO su 127.0.0.1:5432
```

Il client React è servito da Apache come sito statico; solo `/api/` raggiunge il processo Node.
È lo stesso schema del deploy nginx (vedi [`nginx.conf.example`](nginx.conf.example)), tradotto
negli strumenti di cPanel.

### 1.1 Perché systemd e non "Setup Node.js App" di cPanel

cPanel offre *Setup Node.js App* (basato su Phusion Passenger). **Per PGS non è la strada
consigliata**, per due motivi concreti:

1. **Caricamento delle variabili d'ambiente.** PGS si avvia con `node --env-file=../.env`:
   è il meccanismo con cui legge `.env`. Passenger invoca direttamente il file di startup e
   *non* applica quel flag, quindi tutte le variabili andrebbero reinserite a mano nella UI del
   pannello — duplicando i segreti in due posti e perdendo l'allineamento con gli altri ambienti.
2. **Ciclo di vita del processo.** PGS registra job periodici e uno shutdown ordinato su SIGTERM
   (`app.ts`). Con systemd il comportamento è identico a quello degli altri ambienti; con Passenger
   dipende dalla sua gestione dei worker.

Se in futuro si volesse comunque usare Passenger, servirebbe una modifica al codice per caricare
`.env` da dentro l'applicazione: è una scelta architetturale, non una configurazione.

---

## 2. Prerequisiti

Verifica il sistema (come root, via SSH):

```bash
cat /etc/os-release                 # AlmaLinux/CloudLinux o Ubuntu?
/usr/local/cpanel/cpanel -V         # versione cPanel & WHM
httpd -v                            # Apache di EasyApache 4
node -v 2>/dev/null || echo "Node non installato"
psql --version 2>/dev/null || echo "PostgreSQL non installato"
```

Serve inoltre:

- un **utente cPanel** dedicato all'applicazione (in questa guida: `pgs`, home `/home/pgs`);
- un **dominio o sottodominio** già assegnato a quell'utente e funzionante in HTTPS;
- il modulo Apache **mod_proxy / mod_proxy_http** attivo in EasyApache 4
  (*WHM → EasyApache 4 → Customize → Apache Modules*).

### 2.1 Node.js

Installa la stessa major usata negli altri ambienti (Node 24 LTS). Su Ubuntu:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
```

Su AlmaLinux/CloudLinux:

```bash
curl -fsSL https://rpm.nodesource.com/setup_24.x | bash -
dnf install -y nodejs
```

```bash
node -v && which node      # annota il percorso: serve nella unit systemd
```

> Su CloudLinux esiste anche `alt-nodejs`, pensato per Passenger. Per questa guida serve il Node
> di sistema, non quello alternativo.

---

## 3. PostgreSQL

PGS parla con PostgreSQL **direttamente in TCP su `127.0.0.1:5432`**, con un utente e una password
propri definiti in `.env`. Non usa l'integrazione PostgreSQL di WHM e non ne ha bisogno:
l'installazione nativa è identica a quella degli altri ambienti PGS, quindi valgono gli stessi
comandi, gli stessi backup e le stesse procedure di ripristino.

### 3.1 Installazione (repository ufficiale PGDG)

Ubuntu:

```bash
apt-get install -y curl ca-certificates
install -d /usr/share/postgresql-common/pgdg
curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo $VERSION_CODENAME)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt-get update && apt-get install -y postgresql-17
```

AlmaLinux/CloudLinux 8/9:

```bash
dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-$(rpm -E %{rhel})-x86_64/pgdg-redhat-repo-latest.noarch.rpm
dnf -qy module disable postgresql
dnf install -y postgresql17-server
/usr/pgsql-17/bin/postgresql-17-setup initdb
systemctl enable --now postgresql-17
```

### 3.2 Ascolto solo su loopback (obbligatorio)

```bash
# individua i file di configurazione attivi
sudo -u postgres psql -c "SHOW config_file;" -c "SHOW hba_file;"
```

In `postgresql.conf`:

```conf
listen_addresses = 'localhost'
port = 5432
```

In `pg_hba.conf` devono esserci solo connessioni locali autenticate con password:

```conf
local   all   postgres            peer
host    all   all   127.0.0.1/32  scram-sha-256
host    all   all   ::1/128       scram-sha-256
```

```bash
systemctl restart postgresql*        # oppure postgresql-17 su EL
ss -lntp | grep 5432                 # deve mostrare SOLO 127.0.0.1:5432 (e ::1)
```

> **Non aprire mai la 5432 verso l'esterno.** Se il server ha CSF/firewall, la porta non va
> aggiunta ad alcuna lista: il traffico è solo su loopback.

### 3.3 Creazione ruolo, database e schema

Il file [`server/sql/setup.sql`](server/sql/setup.sql) crea ruolo, database, tutte le tabelle,
gli indici e i privilegi. È idempotente.

```bash
DB_PASS=$(openssl rand -hex 24); echo "PASSWORD DB: $DB_PASS"    # annotala per il .env

cd /tmp
sudo -u postgres psql -v app_password="$DB_PASS" -f /home/pgs/apps/payroll-gang-suite/server/sql/setup.sql
```

Verifica:

```bash
sudo -u postgres psql -d payroll_gang -c "\dt"      # devono comparire 17 tabelle
sudo -u postgres psql -d payroll_gang -c \
  "SELECT has_table_privilege('payroll_user','audit_log','UPDATE');"   # deve essere false
```

L'ultima verifica è importante: `audit_log` è append-only per costruzione (`REVOKE UPDATE, DELETE,
TRUNCATE`), e questa proprietà va confermata a ogni nuova installazione.

---

## 4. Codice applicativo

> **Regola non negoziabile: il codice NON va sotto `public_html`.** Tutto ciò che sta in
> `/home/<utente>/public_html` è servito da Apache. Il repository contiene `.env`, script e
> sorgenti: pubblicarli significherebbe esporre segreti. Il codice va in una directory **fuori**
> dalla docroot.

```bash
mkdir -p /home/pgs/apps
cd /home/pgs/apps
git clone https://github.com/fabriziopapa/payroll-gang-suite.git
cd payroll-gang-suite

chown -R pgs:pgs /home/pgs/apps/payroll-gang-suite
sudo -H -u pgs npm ci --no-audit --no-fund
```

**Non eseguire npm come root.** L'installazione lancia gli script di post-installazione di
alcuni pacchetti (`argon2`, `esbuild`, `core-js`): come root avrebbero privilegi totali sulla
macchina. In più lascerebbe file di root dentro una directory dell'utente applicativo, e i
`git pull` successivi fallirebbero con *index file open failed: Permission denied*.

`npm ci` attiva anche gli hook git del progetto (script `prepare`), che bloccano il commit
accidentale di codici fiscali e segreti.

---

## 5. Configurazione `.env`

```bash
cp .env.example .env
chmod 600 .env
```

Genera i segreti:

```bash
# Chiavi JWT ES256
openssl ecparam -genkey -name prime256v1 -noout | \
  openssl pkcs8 -topk8 -nocrypt -out /tmp/jwt_priv.pem
openssl ec -in /tmp/jwt_priv.pem -pubout -out /tmp/jwt_pub.pem
echo "JWT_PRIVATE_KEY_BASE64=$(base64 -w 0 /tmp/jwt_priv.pem)"
echo "JWT_PUBLIC_KEY_BASE64=$(base64 -w 0 /tmp/jwt_pub.pem)"
shred -u /tmp/jwt_priv.pem /tmp/jwt_pub.pem

# Chiave di cifratura PII (AES-256-GCM) e segreto dei cookie
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('COOKIE_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```

Valori specifici di un'installazione cPanel:

| Variabile | Valore | Nota |
|---|---|---|
| `NODE_ENV` | `production` | abilita HSTS e cookie `secure` |
| `PORT` | `3001` | porta di loopback, deve coincidere col ProxyPass |
| `CLIENT_ORIGIN` | `https://dominio.tld` | **senza slash finale**; usato da CORS, dal controllo Origin e nei link di attivazione via email |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `5432` | |
| `DB_NAME` / `DB_USER` | `payroll_gang` / `payroll_user` | come da `setup.sql` |
| `DB_PASSWORD` | la password generata sopra | |
| `DB_SSL` | `false` | il default è `true`: su loopback va messo esplicitamente a `false`, altrimenti l'avvio fallisce |
| `TOTP_ISSUER` | es. `PGS PreProd` | compare nell'app di autenticazione: distinguere gli ambienti evita che gli utenti confondano i codici |

> **Se stai clonando i dati da un altro ambiente**, `ENCRYPTION_KEY` **deve essere identica**
> a quella dell'ambiente di origine, altrimenti codici fiscali, certificati e segreti TOTP
> risulteranno non decifrabili. `COOKIE_SECRET` e le chiavi JWT possono invece essere nuove:
> il loro cambio invalida solo le sessioni attive.

### 5.1 Servizi esterni

- **Anti-abuso (CAPTCHA)**: è pianificata la migrazione da Cloudflare Turnstile a
  **Friendly Captcha** (proof-of-work, senza cookie né profilazione, trattamento in UE),
  per ridurre il trasferimento di dati personali a terzi. Fino ad allora vale quanto segue.
- **Cloudflare Turnstile**: la site key è vincolata al dominio. Su un dominio nuovo occorre
  aggiungerlo nella configurazione Cloudflare, oppure disattivare la protezione dal toggle in
  *Impostazioni* (admin). Se la secret è presente e il toggle è attivo, la verifica è
  **fail-closed**: senza un token valido il login viene rifiutato.
- **CINECA CSA-WS**: le API sono geo-bloccate fuori dall'UE. Se il server è in Italia le chiamate
  funzionano dirette e il toggle `cinecaUseProxy` va lasciato spento; vedi
  [`CINECA_PROXY.md`](CINECA_PROXY.md) per il caso opposto.
- **SMTP**: senza credenziali il server parte comunque, ma non invia le email con i QR di
  attivazione — l'admin dovrà consegnarli manualmente.

---

## 6. Build

```bash
cd /home/pgs/apps/payroll-gang-suite
npm run build                      # compila server (tsc) e client (vite)
```

Pubblica il client nella docroot del dominio:

```bash
rsync -a --delete client/dist/ /home/pgs/public_html/
chown -R pgs:pgs /home/pgs/public_html
```

> `--delete` rimuove dalla docroot i file non più prodotti dal build. Se nella docroot tieni anche
> file estranei al client (una pagina di cortesia, `.well-known`), escludili con `--exclude` o
> evita `--delete`.

Il file `.htaccess` per la docroot è in [`cpanel-htaccess.example`](cpanel-htaccess.example):
gestisce il routing SPA, blocca i source map e applica gli header di sicurezza alle risposte
statiche (quelle dell'API sono già coperte da helmet lato applicazione).

```bash
cp cpanel-htaccess.example /home/pgs/public_html/.htaccess
chown pgs:pgs /home/pgs/public_html/.htaccess
```

---

## 7. Servizio systemd

Crea `/etc/systemd/system/pgs.service` (adatta `User`, i percorsi e il binario Node):

```ini
[Unit]
Description=Payroll Gang Suite
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=pgs
Group=pgs
WorkingDirectory=/home/pgs/apps/payroll-gang-suite/server
ExecStart=/usr/bin/node --env-file=/home/pgs/apps/payroll-gang-suite/.env dist/app.js
Restart=on-failure
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
chown -R pgs:pgs /home/pgs/apps/payroll-gang-suite
systemctl daemon-reload
systemctl enable --now pgs
systemctl status pgs --no-pager
curl -s http://127.0.0.1:3001/health          # {"status":"ok",...}
journalctl -u pgs -n 50 --no-pager            # log applicativi
```

> In alternativa si può usare PM2 con l'`ecosystem.config.cjs` del repository, per uniformità con
> altri ambienti. In quel caso ricorda che il file versionato contiene un `cwd` segnaposto
> (`/path/to/payroll-gang-suite`) da sostituire con il percorso reale dopo ogni `git pull`.

---

## 8. Reverse proxy Apache

cPanel rigenera i vhost, quindi le personalizzazioni **non** vanno scritte dentro i vhost: vanno
nei file di *include* per utente, che cPanel conserva tra una rigenerazione e l'altra.

```bash
UTENTE=pgs
DOMINIO=dominio.tld

for TIPO in std ssl; do
  mkdir -p /etc/apache2/conf.d/userdata/$TIPO/2_4/$UTENTE/$DOMINIO
  cp /home/pgs/apps/payroll-gang-suite/cpanel-proxy.conf.example \
     /etc/apache2/conf.d/userdata/$TIPO/2_4/$UTENTE/$DOMINIO/pgs-proxy.conf
done

/scripts/ensure_vhost_includes --user=$UTENTE
apachectl configtest            # deve rispondere "Syntax OK"
/scripts/rebuildhttpdconf
systemctl restart httpd
```

> Su alcune versioni il percorso è `/usr/local/apache/conf/userdata/...`: è un collegamento
> alla stessa directory, entrambi vanno bene. Se `configtest` segnala `ProxyPass` sconosciuto,
> mod_proxy non è attivo in EasyApache 4 (vedi §2).

Contenuto (vedi [`cpanel-proxy.conf.example`](cpanel-proxy.conf.example)): l'esclusione di
`/.well-known` **deve precedere** le altre regole, altrimenti il rinnovo automatico dei
certificati AutoSSL viene inoltrato all'applicazione Node e fallisce.

---

## 9. HTTPS

Il certificato è gestito da cPanel: *WHM → Manage AutoSSL* oppure *cPanel → SSL/TLS Status →
Run AutoSSL*. Con `NODE_ENV=production` l'applicazione emette cookie `secure` e header HSTS,
quindi **il sito deve essere raggiungibile in HTTPS** prima del primo login: su HTTP il cookie
di refresh non verrebbe accettato dal browser e la sessione non si manterrebbe.

---

## 10. Primo avvio e verifica

```bash
cd /home/pgs/apps/payroll-gang-suite
sudo -u pgs npm run seed --workspace=server     # crea il primo utente admin e il QR TOTP
```

Il comando genera `admin-qr.html` nella directory corrente: aprilo, inquadra il QR con l'app di
autenticazione, **poi cancella il file** (`shred -u admin-qr.html`).

### 10.1 Verifica automatica

Lo script [`cpanel-check.sh`](cpanel-check.sh) controlla in sola lettura tutto quanto sopra —
sistema, Node, PostgreSQL, schema e privilegi del database, posizione del codice, `.env`,
servizio, proxy Apache, docroot e risposte HTTP — e stampa un riepilogo. Non modifica nulla e
può essere eseguito a qualsiasi punto dell'installazione: i passi non ancora fatti sono
segnalati come "da fare", non come errori.

```bash
bash /home/pgs/apps/payroll-gang-suite/cpanel-check.sh
```

> Eseguirlo con `bash`, **non** con `source` o `.`: lo script rileva comunque il caso e in quella
> modalità non esce mai (l'esito resta in `$PGS_CHECK_EXIT`), ma l'esecuzione normale è quella
> corretta. Se dovesse interrompersi in modo anomalo, `bash -x cpanel-check.sh > /root/check.log 2>&1`
> lascia un registro che sopravvive alla disconnessione.

Se i percorsi non sono quelli predefiniti:

```bash
PGS_USER=pgs APP_DIR=/percorso/app DOCROOT=/percorso/public_html \
  bash cpanel-check.sh
```

Esce con codice `1` se trova qualcosa da correggere, `0` altrimenti.

> Lo script stampa anche l'**impronta** di `ENCRYPTION_KEY` (un hash, mai la chiave). Eseguendolo
> anche sull'ambiente di origine si può verificare che le due chiavi coincidano *prima* di
> clonare i dati: se differiscono, i codici fiscali, i certificati e i segreti TOTP copiati
> risulterebbero illeggibili.

### 10.2 Checklist manuale

- [ ] `curl -s http://127.0.0.1:3001/health` risponde `ok`
- [ ] `https://dominio.tld` mostra l'interfaccia di login
- [ ] `https://dominio.tld/api/v1/auth/me` risponde `401` (proxy attivo e API raggiungibile)
- [ ] login con TOTP completato
- [ ] ricaricando la pagina più volte la sessione resta attiva (rotazione refresh token)
- [ ] dopo il logout, riusare la vecchia sessione restituisce `401`
- [ ] `ss -lntp | grep -E '3001|5432'` mostra solo indirizzi di loopback
- [ ] `curl -I https://dominio.tld/.env` restituisce `404`

---

## 10.3 Ambienti di collaudo che contengono dati reali

Se in un ambiente non di produzione viene caricata una copia dei dati veri, i segreti TOTP
clonati sono **quelli di produzione**: chiunque riceva l'URL e possieda la propria app di
autenticazione può entrare e operare lì, convinto di essere nell'ambiente reale. Il lavoro
finirebbe nel posto sbagliato e la divergenza si scoprirebbe tardi.

Il rimedio è una password a livello Apache davanti all'intero dominio:

```bash
bash cpanel-preprod-lock.sh on      # chiede la password e configura
bash cpanel-preprod-lock.sh stato   # verifica
bash cpanel-preprod-lock.sh off     # rimuove
```

Copre anche `/api`, perché l'autorizzazione è valutata prima dell'inoltro al processo Node,
e il client continua a funzionare: una volta autenticato, il browser allega le credenziali
anche alle chiamate XHR. Resta esclusa `/.well-known`, che deve restare raggiungibile
altrimenti AutoSSL non rinnova i certificati — l'eccezione è già nel file di esempio
[`cpanel-basicauth.conf.example`](cpanel-basicauth.conf.example).

La password non viene mai scritta in chiaro: lo script ne genera l'hash con
`openssl passwd -apr1` e salva solo quello in `/etc/pgs/preprod.htpasswd`.

---

## 11. Alternative senza root

Se il server è un hosting cPanel condiviso senza root: PostgreSQL non è installabile e
*Setup Node.js App* pone i limiti descritti in §1.1. Le opzioni realistiche sono un database
PostgreSQL gestito altrove (con connessione TLS, quindi `DB_SSL=true`), oppure un VPS.
PGS **non** supporta MySQL/MariaDB: la ricerca sulle liquidazioni usa funzioni JSONB di
PostgreSQL e diverse garanzie di concorrenza dipendono da costrutti specifici.

---

## 12. Aggiornamenti

```bash
# Il repository appartiene all'utente applicativo: il pull va fatto come lui.
# Un `git pull` da root su una directory di un altro utente viene rifiutato
# ("detected dubious ownership") ed è una protezione sensata: il progetto
# imposta core.hooksPath, quindi root eseguirebbe hook scrivibili da quell'utente.
sudo -H -u pgs git -C /home/pgs/apps/payroll-gang-suite pull origin main

cd /home/pgs/apps/payroll-gang-suite
sudo -H -u pgs npm ci --no-audit --no-fund   # solo se package-lock.json è cambiato
sudo -H -u pgs npm run build
rsync -a --delete --exclude '.htaccess' client/dist/ /home/pgs/public_html/
chown -R pgs:pgs /home/pgs/public_html /home/pgs/apps/payroll-gang-suite
systemctl restart pgs
```

Controlla sempre le note di rilascio: alcune versioni richiedono di rieseguire `setup.sql`
(idempotente) o uno script di migrazione dati.

**Rollback**: `git reset --hard <commit>` seguito da build, rsync e `systemctl restart pgs`.

---

## 13. Problemi frequenti

| Sintomo | Causa probabile | Verifica / rimedio |
|---|---|---|
| `502 Bad Gateway` su `/api/` | servizio Node fermo | `systemctl status pgs`, `journalctl -u pgs -n 50` |
| L'app non parte, log con errore di configurazione | variabile mancante o non valida in `.env` | il messaggio elenca i campi: la validazione è fail-closed all'avvio |
| L'app non parte, errore di connessione al DB | `DB_SSL=true` su loopback senza TLS | metti `DB_SSL=false` |
| L'app non parte: `{ CINECA_BASE_URL: [ 'Invalid url' ] }` | variabile opzionale presente ma **vuota** | nello schema "opzionale" significa *assente*, non vuota: una riga `CINECA_BASE_URL=` viene validata lo stesso e fallisce. **Commentare** la riga invece di svuotarla. Vale anche per `CINECA_PROXY_URL`, `CINECA_PROXY_SECRET` e `COOKIE_SECRET` |
| Login ok ma al reload risulta disconnesso | sito in HTTP, o `CLIENT_ORIGIN` diverso dal dominio reale | il cookie di refresh è `secure` + `SameSite=Strict` |
| `403 ORIGIN_NOT_ALLOWED` sulle operazioni di scrittura | `CLIENT_ORIGIN` non coincide con l'origine del browser | confronta esattamente schema, host ed eventuale `www` |
| Login rifiutato con `CAPTCHA_FAILED` | dominio non autorizzato in Turnstile | aggiungi il dominio in Cloudflare o disattiva il toggle in Impostazioni |
| Ricaricando una rotta interna arriva `404` | manca il fallback SPA | verifica `.htaccess` in `public_html` |
| AutoSSL non rinnova più | `/.well-known` inoltrato al proxy | l'esclusione deve stare **prima** delle altre regole |
| Le personalizzazioni Apache spariscono | modificato il vhost invece dell'include | usa `conf.d/userdata/...` e `ensure_vhost_includes` |
| `git pull` come utente app: *index file open failed: Permission denied* | qualcosa è stato eseguito come root nella directory (tipicamente `npm ci` o `npm run build`) lasciando file suoi in `.git/` | `chown -R pgs:pgs <dir>` e ripetere. Per non ripresentarsi, npm e build vanno eseguiti come l'utente applicativo: `cpanel-setup.sh` lo fa |
| `git pull` da root: *detected dubious ownership* | dopo il `chown` dell'installazione la directory è dell'utente applicativo | eseguire il pull come quell'utente: `sudo -H -u pgs git -C <dir> pull origin main`. L'eccezione `safe.directory` per root è l'ultima risorsa: con `core.hooksPath` impostato, root eseguirebbe hook scrivibili dall'utente |
| `tsc: command not found` durante il build | `npm ci` interrotto a metà | ripeti `npm ci`; **non** riavviare il servizio in questo stato |

---

## 14. Note di sicurezza

- `.env` in `600` e di proprietà dell'utente applicativo; mai dentro `public_html`, mai committato.
- PostgreSQL e Node in ascolto **solo** su loopback: l'unica porta pubblica è quella di Apache.
- I dump del database contengono dati personali: tenerli fuori dalla docroot, con permessi
  ristretti, e cancellarli dopo l'uso.
- `audit_log` è append-only a livello di database: verificare i privilegi dopo ogni ripristino,
  perché un `pg_restore` può reimpostarli.
- L'applicazione cifra a riposo codici fiscali, certificati e segreti TOTP con `ENCRYPTION_KEY`:
  perdere quella chiave significa perdere l'accesso a quei dati; custodirla come i backup.
- Se l'ambiente non è destinato a uso operativo, dichiararlo esplicitamente e mantenerlo
  `noindex`.
