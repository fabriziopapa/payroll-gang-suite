#!/usr/bin/env bash
# ============================================================
# PGS — Installazione standalone su server cPanel/WHM (Ubuntu/AlmaLinux)
#
# Esegue l'intera procedura di INSTALL_CPANEL.md in un solo comando.
# È IDEMPOTENTE: rileva ciò che è già stato fatto e lo salta, quindi può
# essere rilanciato dopo una correzione senza rifare tutto da capo.
#
# Uso:
#   bash cpanel-setup.sh                       (interattivo)
#   PGS_DOMAIN=dominio.tld bash cpanel-setup.sh
#
# NON usare 'source' / '.': va eseguito con bash.
#
# Variabili riconosciute (tutte opzionali tranne PGS_DOMAIN):
#   PGS_USER          utente cPanel proprietario dell'app      (default: pgs)
#   PGS_DOMAIN        dominio servito da Apache                (richiesto)
#   PGS_PORT          porta di loopback dell'applicazione      (default: 3001)
#   PGS_ENCRYPTION_KEY_FILE  file contenente la chiave (preferibile: non finisce
#                       nella cronologia della shell). Es. /root/.pgs_enckey
#   PGS_ENCRYPTION_KEY  chiave AES a 64 hex — DEVE essere quella dell'ambiente
#                       di origine se si clonano i dati; altrimenti CF,
#                       certificati e segreti TOTP saranno illeggibili
#   PGS_SKIP_PKG=1    non installare Node/PostgreSQL (già presenti)
#   PGS_ASSUME_YES=1  nessuna domanda interattiva
#
# Al termine invoca cpanel-check.sh per la verifica indipendente.
# ============================================================

if (return 0 2>/dev/null); then
  printf '\n  Questo script va ESEGUITO, non caricato con source:  bash cpanel-setup.sh\n\n'
  return 1
fi

PGS_USER="${PGS_USER:-pgs}"
PGS_PORT="${PGS_PORT:-3001}"
PGS_DOMAIN="${PGS_DOMAIN:-}"
DB_NAME="${DB_NAME:-payroll_gang}"
DB_ROLE="${DB_ROLE:-payroll_user}"
SERVICE="${SERVICE:-pgs}"
HOME_DIR="/home/$PGS_USER"
APP_DIR="${APP_DIR:-$HOME_DIR/apps/payroll-gang-suite}"
DOCROOT="${DOCROOT:-$HOME_DIR/public_html}"
ENVF="$APP_DIR/.env"

if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_ERR=$'\033[31m'; C_WRN=$'\033[33m'; C_DIM=$'\033[90m'; C_TTL=$'\033[1m'; C_N=$'\033[0m'
else
  C_OK=""; C_ERR=""; C_WRN=""; C_DIM=""; C_TTL=""; C_N=""
fi
fase()  { printf "\n%s══ %s%s\n" "$C_TTL" "$1" "$C_N"; }
ok()    { printf "  %s✔%s %s\n" "$C_OK"  "$C_N" "$1"; }
salta() { printf "  %s·%s %s\n" "$C_DIM" "$C_N" "$1"; }
avv()   { printf "  %s!%s %s\n" "$C_WRN" "$C_N" "$1"; }
die()   { printf "\n  %s✘ %s%s\n\n" "$C_ERR" "$1" "$C_N"; exit 1; }

# chiedi "domanda" [default]   default: s = procedi, n = non procedere.
# Senza terminale vale il default: per le operazioni distruttive e' 'n',
# cosi' un'esecuzione non interattiva non cancella nulla di inatteso.
chiedi() {
  [ "$PGS_ASSUME_YES" = "1" ] && return 0
  DEF="${2:-s}"
  if [ ! -t 0 ] && [ ! -e /dev/tty ]; then
    [ "$DEF" = "s" ] && return 0 || return 1
  fi
  printf "  %s? %s [s/n] %s" "$C_WRN" "$1" "$C_N"
  read -r R </dev/tty 2>/dev/null || { [ "$DEF" = "s" ] && return 0 || return 1; }
  [ -z "$R" ] && { [ "$DEF" = "s" ] && return 0 || return 1; }
  case "$R" in s|S|y|Y|si|SI|yes) return 0 ;; *) return 1 ;; esac
}

# ------------------------------------------------------------ FASE 1
fase "FASE 1 — Controlli preliminari"

[ "$(id -u)" = "0" ] || die "Serve l'utente root."
[ -d "$APP_DIR" ]    || die "Codice non trovato in $APP_DIR — clonare prima il repository (INSTALL_CPANEL.md §4)."
[ -f "$APP_DIR/server/sql/setup.sql" ] || die "$APP_DIR non sembra il repository PGS."
id "$PGS_USER" >/dev/null 2>&1 || die "Utente di sistema '$PGS_USER' inesistente: creare l'account cPanel."

case "$APP_DIR" in
  "$DOCROOT"|"$DOCROOT"/*) die "Il codice è dentro la docroot ($DOCROOT): sorgenti e .env sarebbero pubblici. Spostarlo." ;;
esac
ok "Codice in $APP_DIR (fuori dalla docroot)"

if command -v apt-get >/dev/null 2>&1; then PKG=apt; elif command -v dnf >/dev/null 2>&1; then PKG=dnf; else die "Né apt né dnf disponibili."; fi
ok "Gestore pacchetti: $PKG"

if command -v httpd >/dev/null 2>&1; then
  if httpd -M </dev/null 2>/dev/null | grep -q proxy_http_module; then
    ok "Apache con mod_proxy_http attivo"
  else
    die "mod_proxy_http non attivo: abilitarlo in WHM → EasyApache 4 → Apache Modules."
  fi
else
  avv "Apache non rilevato: la fase del reverse proxy verrà saltata"
fi

if [ -z "$PGS_DOMAIN" ]; then
  if [ -t 0 ] && [ "$PGS_ASSUME_YES" != "1" ]; then
    printf "  Dominio servito da Apache (vuoto = salta la configurazione del proxy): "
    read -r PGS_DOMAIN </dev/tty
  fi
fi
[ -n "$PGS_DOMAIN" ] && ok "Dominio: $PGS_DOMAIN" || avv "Nessun dominio indicato: proxy e pubblicazione client verranno saltati"

# ------------------------------------------------------------ FASE 2
fase "FASE 2 — Node.js"

NODE_MAJ=0
command -v node >/dev/null 2>&1 && NODE_MAJ=$(node -v | sed 's/^v\([0-9]*\).*/\1/')
if [ "$NODE_MAJ" -ge 24 ] 2>/dev/null; then
  ok "Node $(node -v) già presente"
elif [ "$PGS_SKIP_PKG" = "1" ]; then
  die "Node 24 assente e PGS_SKIP_PKG=1."
else
  if chiedi "Installare Node 24 dal repository NodeSource?"; then
    if [ "$PKG" = apt ]; then
      curl -fsSL https://deb.nodesource.com/setup_24.x | bash - || die "Configurazione repository NodeSource fallita."
      apt-get install -y nodejs || die "Installazione di Node fallita."
    else
      curl -fsSL https://rpm.nodesource.com/setup_24.x | bash - || die "Configurazione repository NodeSource fallita."
      dnf install -y nodejs || die "Installazione di Node fallita."
    fi
    ok "Node $(node -v) installato"
  else
    die "Node 24 è necessario."
  fi
fi

# ------------------------------------------------------------ FASE 3
fase "FASE 3 — PostgreSQL"

PG_MAJ=0
command -v psql >/dev/null 2>&1 && PG_MAJ=$(psql --version | awk '{print $3}' | cut -d. -f1)
if [ "$PG_MAJ" -ge 17 ] 2>/dev/null; then
  ok "PostgreSQL $(psql --version | awk '{print $3}') già presente"
elif [ "$PGS_SKIP_PKG" = "1" ]; then
  die "PostgreSQL 17 assente e PGS_SKIP_PKG=1."
else
  if chiedi "Installare PostgreSQL 17 dal repository ufficiale PGDG?"; then
    if [ "$PKG" = apt ]; then
      apt-get install -y postgresql-common || die "Installazione di postgresql-common fallita."
      /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y || die "Configurazione repository PGDG fallita."
      apt-get install -y postgresql-17 || die "Installazione di PostgreSQL fallita."
    else
      dnf install -y "https://download.postgresql.org/pub/repos/yum/reporpms/EL-$(rpm -E %{rhel})-x86_64/pgdg-redhat-repo-latest.noarch.rpm" || die "Repository PGDG non configurato."
      dnf -qy module disable postgresql
      dnf install -y postgresql17-server || die "Installazione di PostgreSQL fallita."
      /usr/pgsql-17/bin/postgresql-17-setup initdb
      systemctl enable --now postgresql-17
    fi
    ok "PostgreSQL installato"
  else
    die "PostgreSQL 17 è necessario."
  fi
fi

sudo -n -u postgres psql -tAqc "SELECT 1" </dev/null >/dev/null 2>&1 || die "Impossibile connettersi a PostgreSQL come utente 'postgres'."
ok "Connessione locale a PostgreSQL funzionante"

BIND=$(ss -lnt 2>/dev/null | awk '$4 ~ /:5432$/ {print $4}')
if printf '%s\n' "$BIND" | grep -qvE '^(127\.[0-9]+\.[0-9]+\.[0-9]+|\[::1\]):5432$' && [ -n "$BIND" ]; then
  ESP=$(printf '%s\n' "$BIND" | grep -vE '^(127\.[0-9]+\.[0-9]+\.[0-9]+|\[::1\]):5432$')
  [ -n "$ESP" ] && die "PostgreSQL è in ascolto su un indirizzo pubblico ($ESP): correggere listen_addresses prima di proseguire."
fi
printf '%s\n' "$BIND" | grep -qE '^127\.0\.0\.1:5432$' \
  && ok "In ascolto su 127.0.0.1:5432 (solo loopback)" \
  || die "PostgreSQL non è in ascolto su 127.0.0.1:5432: l'applicazione non potrebbe connettersi."

# ------------------------------------------------------------ FASE 4
fase "FASE 4 — Segreti"

# I segreti già presenti in .env NON vengono mai rigenerati: rigenerare
# ENCRYPTION_KEY renderebbe illeggibili i dati cifrati già in archivio.
leggi_env() { [ -f "$ENVF" ] && grep -E "^$1=" "$ENVF" | head -1 | cut -d= -f2- | tr -d '"'"'"' '; }

DB_PASSWORD=$(leggi_env DB_PASSWORD)
ENC_KEY=$(leggi_env ENCRYPTION_KEY)
COOKIE_SECRET=$(leggi_env COOKIE_SECRET)
JWT_PRIV=$(leggi_env JWT_PRIVATE_KEY_BASE64)
JWT_PUB=$(leggi_env JWT_PUBLIC_KEY_BASE64)

if [ -n "$DB_PASSWORD" ]; then ok "Password del database presa dal .env esistente"
else DB_PASSWORD=$(openssl rand -hex 24); ok "Password del database generata"; fi

# Normalizza l'input: gli appunti di Windows aggiungono un ritorno a capo, e
# spesso si incolla l'intera riga "ENCRYPTION_KEY=..." presa dal .env di origine.
# Meglio accettare tutte queste forme che far fallire l'installazione.
pulisci_chiave() {
  printf '%s' "$1" \
    | tr -d '\r\n\t "'"'"' ' \
    | sed 's/^ENCRYPTION_KEY=//' \
    | tr 'A-F' 'a-f'
}
chiave_valida() { printf '%s' "$1" | grep -qE '^[0-9a-f]{64}$'; }

if [ -n "$ENC_KEY" ]; then
  ENC_KEY=$(pulisci_chiave "$ENC_KEY")
  ok "ENCRYPTION_KEY presa dal .env esistente"
elif [ -n "$PGS_ENCRYPTION_KEY_FILE" ] && [ -r "$PGS_ENCRYPTION_KEY_FILE" ]; then
  ENC_KEY=$(pulisci_chiave "$(cat "$PGS_ENCRYPTION_KEY_FILE")")
  ok "ENCRYPTION_KEY letta da $PGS_ENCRYPTION_KEY_FILE"
elif [ -n "$PGS_ENCRYPTION_KEY" ]; then
  ENC_KEY=$(pulisci_chiave "$PGS_ENCRYPTION_KEY")
  ok "ENCRYPTION_KEY presa dall'ambiente"
else
  if [ -t 0 ] && [ "$PGS_ASSUME_YES" != "1" ]; then
    echo
    echo "  ENCRYPTION_KEY cifra a riposo codici fiscali, certificati e segreti TOTP."
    echo "  Se importerai dati da un altro ambiente DEVE essere identica a quella di origine,"
    echo "  altrimenti quei dati risulteranno illeggibili."
    echo "  Si puo' incollare la sola chiave o l'intera riga 'ENCRYPTION_KEY=...' del .env."
    # Un incolla copiato dallo scrollback di un terminale puo' contenere un
    # ritorno a capo nel punto in cui la riga era andata a capo: 'read' si
    # ferma li' e il resto resta nel buffer. Accumuliamo finche' non abbiamo
    # 64 caratteri esadecimali, cosi' il frammento successivo viene riunito
    # da solo senza che l'utente debba fare nulla.
    ENC_KEY=""; LETTURE=0
    while [ "$LETTURE" -lt 8 ]; do
      if [ -z "$ENC_KEY" ]; then
        printf "  Chiave (64 hex) — INVIO per generarne una nuova: "
      else
        printf "  ...continuo a leggere (%s/64 caratteri) " "$(printf '%s' "$ENC_KEY" | wc -c)"
      fi
      read -r -s RISPOSTA </dev/tty; echo
      LETTURE=$((LETTURE+1))
      PEZZO=$(pulisci_chiave "$RISPOSTA")
      # INVIO su input vuoto al primo giro = genera una chiave nuova
      [ -z "$PEZZO" ] && [ -z "$ENC_KEY" ] && break
      ENC_KEY="$ENC_KEY$PEZZO"
      chiave_valida "$ENC_KEY" && break
      LUNG=$(printf '%s' "$ENC_KEY" | wc -c)
      if [ "$LUNG" -ge 64 ]; then
        avv "Ricevuti $LUNG caratteri: non e' una chiave valida (64 esadecimali). Ricomincio."
        ENC_KEY=""
      fi
    done
    chiave_valida "$ENC_KEY" || ENC_KEY=""
  fi
  if [ -z "$ENC_KEY" ]; then
    ENC_KEY=$(openssl rand -hex 32)
    avv "Generata una chiave NUOVA: i dati cifrati provenienti da altri ambienti non saranno decifrabili"
  fi
fi
chiave_valida "$ENC_KEY" || die "ENCRYPTION_KEY non valida: servono 64 caratteri esadecimali (ricevuti $(printf '%s' "$ENC_KEY" | wc -c))."
ok "Impronta ENCRYPTION_KEY: $(printf '%s\n' "$ENC_KEY" | sha256sum | cut -c1-12)  (deve coincidere con quella dell'ambiente di origine)"

[ -n "$COOKIE_SECRET" ] || COOKIE_SECRET=$(openssl rand -hex 32)

if [ -z "$JWT_PRIV" ] || [ -z "$JWT_PUB" ]; then
  T=$(mktemp -d)   # mktemp -d crea gia' con permessi 700
  openssl ecparam -genkey -name prime256v1 -noout 2>/dev/null | openssl pkcs8 -topk8 -nocrypt -out "$T/p.pem" 2>/dev/null || die "Generazione della chiave JWT fallita."
  openssl ec -in "$T/p.pem" -pubout -out "$T/u.pem" 2>/dev/null
  JWT_PRIV=$(base64 -w 0 "$T/p.pem"); JWT_PUB=$(base64 -w 0 "$T/u.pem")
  shred -u "$T/p.pem" "$T/u.pem" 2>/dev/null; rmdir "$T"
  ok "Chiavi JWT ES256 generate"
else
  ok "Chiavi JWT prese dal .env esistente"
fi

# ------------------------------------------------------------ FASE 5
fase "FASE 5 — Database e schema"

ESISTE=$(sudo -n -u postgres psql -tAqc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" </dev/null 2>/dev/null | tr -d '[:space:]')
sudo -n -u postgres psql -v app_password="$DB_PASSWORD" -f "$APP_DIR/server/sql/setup.sql" </dev/null >/tmp/pgs_setup_sql.log 2>&1 \
  || { avv "Output in /tmp/pgs_setup_sql.log"; die "Esecuzione di setup.sql fallita."; }
[ "$ESISTE" = "1" ] && ok "Schema riallineato (setup.sql è idempotente)" || ok "Database e schema creati"

# Se il ruolo esisteva già, setup.sql non ne cambia la password: la riallineo
# a quella che finirà nel .env, altrimenti l'applicazione non si connetterebbe.
# La password passa da stdin, non dalla riga di comando: in argv sarebbe
# visibile a chiunque esegua 'ps' mentre lo script gira.
printf "ALTER ROLE %s WITH PASSWORD '%s';\n" "$DB_ROLE" "$DB_PASSWORD" \
  | sudo -n -u postgres psql -q >/dev/null 2>&1 \
  && ok "Password del ruolo '$DB_ROLE' allineata al .env"

NT=$(sudo -n -u postgres psql -d "$DB_NAME" -tAqc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" </dev/null 2>/dev/null | tr -d '[:space:]')
[ "$NT" = "17" ] && ok "17 tabelle presenti" || avv "Tabelle trovate: $NT (attese 17)"

sudo -n -u postgres psql -d "$DB_NAME" </dev/null >/dev/null 2>&1 <<SQL
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO $DB_ROLE;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO $DB_ROLE;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM $DB_ROLE;
SQL
ok "Privilegi applicativi riapplicati (audit_log resta append-only)"

# ------------------------------------------------------------ FASE 6
fase "FASE 6 — Dipendenze"

cd "$APP_DIR" || die "Impossibile entrare in $APP_DIR"
if [ -d node_modules ] && [ "$PGS_FORCE_NPM" != "1" ]; then
  salta "node_modules già presente (PGS_FORCE_NPM=1 per reinstallare)"
else
  npm ci --no-audit --no-fund || die "npm ci fallito: NON avviare il servizio in questo stato (node_modules incompleto)."
  ok "Dipendenze installate"
fi

# ------------------------------------------------------------ FASE 7
fase "FASE 7 — File .env"

if [ -f "$ENVF" ]; then
  salta ".env già presente: non viene sovrascritto"
else
  ORIGIN="https://$PGS_DOMAIN"; [ -z "$PGS_DOMAIN" ] && ORIGIN="https://esempio.tld"
  # umask confinato in una subshell: se restasse attivo, i file prodotti dal
  # build e copiati nella docroot nascerebbero illeggibili da Apache (403).
  ( umask 077
  cat > "$ENVF" <<ENVEOF
# PGS — configurazione ambiente (generata da cpanel-setup.sh)
NODE_ENV=production
PORT=$PGS_PORT
CLIENT_ORIGIN=$ORIGIN

DB_DRIVER=postgres
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=$DB_NAME
DB_USER=$DB_ROLE
DB_PASSWORD=$DB_PASSWORD
# Connessione su loopback senza TLS: deve restare false
DB_SSL=false
DB_POOL_MAX=10
DB_POOL_IDLE_TIMEOUT=30000
DB_CONNECTION_TIMEOUT=5000

JWT_PRIVATE_KEY_BASE64=$JWT_PRIV
JWT_PUBLIC_KEY_BASE64=$JWT_PUB
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d

ENCRYPTION_KEY=$ENC_KEY
COOKIE_SECRET=$COOKIE_SECRET

TOTP_ISSUER=PGS
TOTP_WINDOW=1

RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000
AUTH_RATE_LIMIT_MAX=5
AUTH_RATE_LIMIT_WINDOW_MS=300000
REFRESH_RATE_LIMIT_MAX=30

# Anti-abuso sul login. Attualmente Cloudflare Turnstile; e' pianificata la
# migrazione a Friendly Captcha (proof-of-work, senza cookie ne' profilazione,
# trattamento in UE) per ridurre il trasferimento di dati a terzi.
# Cloudflare Turnstile — lasciare VUOTE per disattivare la verifica CAPTCHA.
# Se si valorizza la secret, il dominio va autorizzato in Cloudflare: la
# verifica è fail-closed e un dominio non autorizzato impedisce ogni login.
# La site key finisce nel bundle del client: cambiandola serve un nuovo build.
#VITE_TURNSTILE_SITE_KEY=
#TURNSTILE_SECRET_KEY=

# ATTENZIONE alle variabili opzionali: nello schema di validazione "opzionale"
# significa ASSENTE, non vuota. Una variabile presente con valore vuoto viene
# validata lo stesso e fa fallire l'avvio (es. CINECA_BASE_URL= => "Invalid url").
# Per disattivare un modulo, lasciare la riga COMMENTATA.

# SMTP (opzionale) — senza, i QR di attivazione vanno consegnati a mano
#SMTP_HOST=smtp.esempio.it
#SMTP_USER=
#SMTP_PASS=
#SMTP_FROM=PGS <noreply@esempio.it>
SMTP_PORT=587
SMTP_SECURE=false

# CINECA CSA-WS (opzionale) — vedi CINECA_PROXY.md se il server è fuori UE
#CINECA_BASE_URL=https://prod.csa-ws.cineca.it
#CINECA_TENANT=
#CINECA_USER=
#CINECA_PASSWORD=
CINECA_GROUPS=familiari,sge
PARENTELA_FIGLIO=FG
ENVEOF
  )
  ok ".env creato"
fi
chmod 600 "$ENVF"; chown "$PGS_USER":"$PGS_USER" "$ENVF"
ok "Permessi .env: 600, proprietario $PGS_USER"

# ------------------------------------------------------------ FASE 8
fase "FASE 8 — Compilazione"

npm run build || die "Build fallito."
[ -f "$APP_DIR/server/dist/app.js" ]      || die "Build del server non prodotto."
[ -f "$APP_DIR/client/dist/index.html" ]  || die "Build del client non prodotto."
ok "Server e client compilati"

# ------------------------------------------------------------ FASE 9
fase "FASE 9 — Pubblicazione del client"

if [ -n "$PGS_DOMAIN" ] && [ -d "$DOCROOT" ]; then
  if [ -f "$DOCROOT/index.html" ] && ! [ -f "$DOCROOT/.pgs-published" ] && ! chiedi "La docroot contiene già un sito: sostituirlo con il client PGS?" n; then
    salta "Pubblicazione saltata su richiesta"
  else
    rsync -a --delete --exclude '.htaccess' --exclude '.well-known' --exclude '.user.ini' --exclude '.pgs-published' \
      "$APP_DIR/client/dist/" "$DOCROOT/" || die "Copia del client nella docroot fallita."
    [ -f "$DOCROOT/.htaccess" ] || cp "$APP_DIR/cpanel-htaccess.example" "$DOCROOT/.htaccess"
    touch "$DOCROOT/.pgs-published"
    chown -R "$PGS_USER":"$PGS_USER" "$DOCROOT"
    ok "Client pubblicato in $DOCROOT"
  fi
else
  salta "Nessun dominio o docroot assente: pubblicazione saltata"
fi

# ------------------------------------------------------------ FASE 10
fase "FASE 10 — Servizio systemd"

NODE_BIN=$(command -v node)
UNIT=/etc/systemd/system/$SERVICE.service
if [ -f "$UNIT" ] && [ "$PGS_FORCE_UNIT" != "1" ]; then
  salta "$UNIT già presente (PGS_FORCE_UNIT=1 per riscriverla)"
else
  cat > "$UNIT" <<UNITEOF
[Unit]
Description=Payroll Gang Suite
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=$PGS_USER
Group=$PGS_USER
WorkingDirectory=$APP_DIR/server
ExecStart=$NODE_BIN --env-file=$ENVF dist/app.js
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
UNITEOF
  ok "Unit systemd scritta"
fi

chown -R "$PGS_USER":"$PGS_USER" "$APP_DIR"
ok "Proprietà di $APP_DIR assegnata a $PGS_USER"

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"
sleep 3
if systemctl is-active --quiet "$SERVICE"; then
  ok "Servizio '$SERVICE' attivo"
else
  journalctl -u "$SERVICE" -n 20 --no-pager
  die "Il servizio non parte: sopra le ultime righe di log."
fi

for _ in 1 2 3 4 5; do
  curl -s -m 3 "http://127.0.0.1:$PGS_PORT/health" 2>/dev/null | grep -q '"status":"ok"' && break
  sleep 2
done
curl -s -m 3 "http://127.0.0.1:$PGS_PORT/health" 2>/dev/null | grep -q '"status":"ok"' \
  && ok "Health check locale superato" \
  || avv "Health check non risponde: journalctl -u $SERVICE -n 50"

# ------------------------------------------------------------ FASE 11
fase "FASE 11 — Reverse proxy Apache"

if [ -n "$PGS_DOMAIN" ] && command -v httpd >/dev/null 2>&1; then
  N=0
  BASE=/etc/apache2/conf.d/userdata
  [ -d /etc/apache2 ] || BASE=/usr/local/apache/conf/userdata
  for TIPO in std ssl; do
    D="$BASE/$TIPO/2_4/$PGS_USER/$PGS_DOMAIN"
    mkdir -p "$D" || continue
    sed "s#127\.0\.0\.1:3001#127.0.0.1:$PGS_PORT#g" "$APP_DIR/cpanel-proxy.conf.example" > "$D/pgs-proxy.conf"
    N=$((N+1))
  done
  ok "Include Apache scritti ($N)"

  /scripts/ensure_vhost_includes --user="$PGS_USER" >/dev/null 2>&1
  if apachectl configtest </dev/null >/dev/null 2>&1; then
    ok "Configurazione Apache valida"
    /scripts/rebuildhttpdconf >/dev/null 2>&1
    systemctl restart httpd >/dev/null 2>&1 || /scripts/restartsrv_httpd >/dev/null 2>&1
    ok "Apache ricaricato"
  else
    avv "apachectl configtest segnala errori: eseguirlo a mano. Apache NON è stato riavviato."
  fi
else
  salta "Nessun dominio o Apache assente: proxy saltato"
fi

# ------------------------------------------------------------ FASE 12
fase "FASE 12 — Primo utente"

NU=$(sudo -n -u postgres psql -d "$DB_NAME" -tAqc "SELECT count(*) FROM users" </dev/null 2>/dev/null | tr -d '[:space:]')
if [ -z "$NU" ]; then
  avv "Impossibile contare gli utenti (tabella assente?): verificare lo schema"
elif [ "$NU" = "0" ]; then
  echo "  Nessun utente presente. Per creare il primo amministratore:"
  echo "      cd $APP_DIR && sudo -u $PGS_USER npm run seed --workspace=server"
  echo "  Genera admin-qr.html con il QR TOTP: dopo averlo inquadrato, CANCELLARLO"
  echo "  (shred -u admin-qr.html)."
  echo "  Se invece importerai i dati da un altro ambiente, salta questo passo:"
  echo "  gli utenti arrivano col ripristino."
else
  ok "Utenti già presenti nel database: $NU"
fi

# ------------------------------------------------------------ Verifica
fase "VERIFICA INDIPENDENTE"
echo
if [ -x "$APP_DIR/cpanel-check.sh" ] || [ -f "$APP_DIR/cpanel-check.sh" ]; then
  PGS_USER="$PGS_USER" APP_DIR="$APP_DIR" DOCROOT="$DOCROOT" PGS_PORT="$PGS_PORT" \
    bash "$APP_DIR/cpanel-check.sh"
  ESITO=$?
else
  avv "cpanel-check.sh non trovato: verifica manuale"
  ESITO=0
fi

echo
echo "Installazione completata. Ricordare:"
echo "  · il certificato HTTPS va emesso da cPanel (AutoSSL) prima del primo accesso:"
echo "    con NODE_ENV=production il cookie di sessione è 'secure' e su HTTP non verrebbe accettato;"
echo "  · CLIENT_ORIGIN in .env deve corrispondere esattamente al dominio usato dal browser;"
echo "  · dopo ogni modifica del .env: systemctl restart $SERVICE (e nuovo build del client"
echo "    se sono cambiate variabili VITE_*)."
exit $ESITO
