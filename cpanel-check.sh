#!/usr/bin/env bash
# ============================================================
# PGS — Verifica installazione su server cPanel/WHM
#
# Script di SOLA LETTURA: non modifica nulla, non riavvia nulla,
# non stampa mai il contenuto dei segreti. Eseguibile a qualsiasi
# punto dell'installazione: i passi non ancora eseguiti sono
# segnalati come "da fare", non come errori.
#
# Uso:   bash cpanel-check.sh          <-- NON usare 'source' / '.'
# Opz.:  PGS_USER=pgs APP_DIR=/percorso DOCROOT=/percorso PGS_PORT=3001 bash cpanel-check.sh
#
# Exit code: 0 = nessun problema · 1 = almeno un problema da correggere
# Vedi INSTALL_CPANEL.md
# ============================================================

# --- Protezioni di esecuzione ---------------------------------------------
# Se lo script viene caricato con 'source' / '.', un exit chiuderebbe la shell
# di login (quindi la sessione SSH). Lo rileviamo e in quel caso non usciamo mai.
if (return 0 2>/dev/null); then PGS_SOURCED=1; else PGS_SOURCED=0; fi

if [ "$PGS_SOURCED" = "1" ]; then
  printf '\n  ATTENZIONE: script caricato con "source". Usare invece:  bash %s\n\n' "${BASH_SOURCE[0]:-cpanel-check.sh}"
fi

# NB: nessun 'exec' che rediriga lo stdin. Sarebbe efficace in esecuzione normale,
# ma se il rilevamento del sourcing sbagliasse anche una sola volta chiuderebbe
# l'input della shell di login, terminando la sessione. Lo stdin viene invece
# chiuso comando per comando, dove serve.

PGS_USER="${PGS_USER:-pgs}"
APP_DIR="${APP_DIR:-/home/$PGS_USER/apps/payroll-gang-suite}"
DOCROOT="${DOCROOT:-/home/$PGS_USER/public_html}"
PGS_PORT="${PGS_PORT:-3001}"
DB_NAME="${DB_NAME:-payroll_gang}"
DB_ROLE="${DB_ROLE:-payroll_user}"
SERVICE="${SERVICE:-pgs}"

N_OK=0; N_FAIL=0; N_WARN=0; N_TODO=0
ORIG=""; ORIG_FIRST=""

if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_ERR=$'\033[31m'; C_WRN=$'\033[33m'; C_DIM=$'\033[90m'; C_TTL=$'\033[1m'; C_N=$'\033[0m'
else
  C_OK=""; C_ERR=""; C_WRN=""; C_DIM=""; C_TTL=""; C_N=""
fi

titolo() { printf "\n%s%s%s\n" "$C_TTL" "$1" "$C_N"; }
ok()   { printf "  %s✔%s %s\n" "$C_OK"  "$C_N" "$1"; N_OK=$((N_OK+1)); }
ko()   { printf "  %s✘%s %s\n" "$C_ERR" "$C_N" "$1"; N_FAIL=$((N_FAIL+1)); }
avv()  { printf "  %s!%s %s\n" "$C_WRN" "$C_N" "$1"; N_WARN=$((N_WARN+1)); }
todo() { printf "  %s·%s %s\n" "$C_DIM" "$C_N" "$1"; N_TODO=$((N_TODO+1)); }
info() { printf "    %s%s%s\n" "$C_DIM" "$1" "$C_N"; }

psql_q() { sudo -n -u postgres psql -tAqc "$1" </dev/null 2>/dev/null | tr -d '[:space:]'; }
psql_db() { sudo -n -u postgres psql -d "$DB_NAME" -tAqc "$1" </dev/null 2>/dev/null | tr -d '[:space:]'; }

echo "============================================================"
echo " PGS — verifica installazione cPanel      $(date '+%Y-%m-%d %H:%M:%S')"
echo " host: $(hostname)   utente app: $PGS_USER"
echo "============================================================"

# ------------------------------------------------------------------ 1. Sistema
titolo "1. Sistema"

if [ -r /etc/os-release ]; then
  # letto con grep, non con 'source': sourcing definirebbe variabili nella shell
  OSNAME=$(grep -E '^PRETTY_NAME=' /etc/os-release | cut -d= -f2- | tr -d '"')
  ok "Sistema operativo: ${OSNAME:-sconosciuto}"
else
  avv "Impossibile leggere /etc/os-release"
fi

if [ -x /usr/local/cpanel/cpanel ]; then
  ok "cPanel & WHM: $(/usr/local/cpanel/cpanel -V </dev/null 2>/dev/null)"
else
  avv "cPanel non rilevato: alcune verifiche non saranno significative"
fi

if command -v httpd >/dev/null 2>&1; then
  MODULI=$(httpd -M </dev/null 2>/dev/null)
  if echo "$MODULI" | grep -q "proxy_module" && echo "$MODULI" | grep -q "proxy_http_module"; then
    ok "Apache: mod_proxy e mod_proxy_http attivi"
  else
    ko "Apache: mancano mod_proxy o mod_proxy_http — attivarli in EasyApache 4"
  fi
else
  ko "Apache (httpd) non trovato nel PATH"
fi

if id "$PGS_USER" >/dev/null 2>&1; then
  ok "Utente di sistema '$PGS_USER' presente (home: $(getent passwd "$PGS_USER" | cut -d: -f6))"
else
  ko "Utente '$PGS_USER' inesistente: creare l'account cPanel prima di proseguire"
fi

# ------------------------------------------------------------------ 2. Node
titolo "2. Node.js"

if command -v node >/dev/null 2>&1; then
  NODE_V=$(node -v); NODE_MAJ=$(echo "$NODE_V" | sed 's/^v\([0-9]*\).*/\1/')
  if [ "$NODE_MAJ" -ge 24 ] 2>/dev/null; then
    ok "Node $NODE_V ($(command -v node))"
  else
    avv "Node $NODE_V: gli altri ambienti PGS usano la major 24"
  fi
  command -v npm >/dev/null 2>&1 && ok "npm $(npm -v)" || ko "npm non trovato"
else
  todo "Node non installato — vedi INSTALL_CPANEL.md §2.1"
fi

# ------------------------------------------------------------------ 3. PostgreSQL
titolo "3. PostgreSQL"

PG_PRONTO=0
if command -v psql >/dev/null 2>&1; then
  PG_V=$(psql --version | awk '{print $3}'); PG_MAJ=${PG_V%%.*}
  if [ "$PG_MAJ" -ge 17 ] 2>/dev/null; then
    ok "Client PostgreSQL $PG_V"
  else
    ko "Client PostgreSQL $PG_V: serve la 17 (un dump prodotto da pg_dump 17 non si ripristina su versioni precedenti)"
  fi

  if command -v pg_lsclusters >/dev/null 2>&1; then
    CL=$(pg_lsclusters -h </dev/null 2>/dev/null | awk '$4=="online"{print $1"/"$2" porta "$3}')
    if [ -n "$CL" ]; then ok "Cluster online: $CL"; else ko "Nessun cluster PostgreSQL online (pg_lsclusters)"; fi
  fi

  if sudo -n -u postgres psql -tAqc "SELECT 1" </dev/null >/dev/null 2>&1; then
    ok "Connessione locale come 'postgres' funzionante"
    PG_PRONTO=1
    CONF=$(psql_q "SHOW config_file"); HBA=$(psql_q "SHOW hba_file")
    info "config: $CONF"

    LISTEN=$(psql_q "SHOW listen_addresses")
    case "$LISTEN" in
      localhost|127.0.0.1|"127.0.0.1,::1") ok "listen_addresses = $LISTEN (solo loopback)" ;;
      "*"|0.0.0.0) ko "listen_addresses = $LISTEN — il database è esposto sulla rete: correggere SUBITO" ;;
      *) avv "listen_addresses = $LISTEN — verificare che non includa indirizzi pubblici" ;;
    esac
  else
    ko "Connessione locale come 'postgres' non riuscita"
  fi
else
  todo "PostgreSQL non installato — vedi INSTALL_CPANEL.md §3.1"
fi

if command -v ss >/dev/null 2>&1; then
  # Tutto 127.0.0.0/8 e' loopback (su Debian/Ubuntu 127.0.1.1 e' l'indirizzo
  # dell'hostname): esposto verso la rete e' solo cio' che sta fuori da quel range.
  BIND5432=$(ss -lnt 2>/dev/null | awk '$4 ~ /:5432$/ {print $4}')
  PUB=$(printf '%s\n' "$BIND5432" | grep -vE '^(127\.[0-9]+\.[0-9]+\.[0-9]+|\[::1\])' | grep -v '^$')
  if [ -n "$PUB" ]; then
    ko "PostgreSQL in ascolto su indirizzi NON di loopback: $(echo $PUB) — il database e' raggiungibile dalla rete"
  elif [ -n "$BIND5432" ]; then
    ok "Porta 5432 solo su loopback ($(echo $BIND5432))"
  fi

  # Verifica che sia in ascolto proprio su 127.0.0.1: e' l'indirizzo che
  # finira' in DB_HOST. Un bind sul solo 127.0.1.1 farebbe fallire la
  # connessione dell'applicazione con un errore che sembra un bug dell'app.
  if [ -n "$BIND5432" ]; then
    if printf '%s\n' "$BIND5432" | grep -qE '^(127\.0\.0\.1|\*|0\.0\.0\.0):5432$'; then
      ok "In ascolto su 127.0.0.1:5432 (l'indirizzo usato da DB_HOST)"
    else
      ko "NON in ascolto su 127.0.0.1:5432 ma su $(echo $BIND5432): con DB_HOST=127.0.0.1 l'applicazione non si connettera'. Impostare listen_addresses = '127.0.0.1' in postgresql.conf"
    fi
  fi

  PUB_APP=$(ss -lnt 2>/dev/null | awk -v p=":$PGS_PORT\$" '$4 ~ p {print $4}' | grep -vE '^(127\.0\.0\.1|\[::1\])')
  if [ -n "$PUB_APP" ]; then
    ko "L'applicazione è in ascolto su indirizzi non di loopback: $PUB_APP"
  fi
fi

# ------------------------------------------------------------------ 4. Database
titolo "4. Database PGS"

if [ "$PG_PRONTO" = "1" ]; then
  if [ "$(psql_q "SELECT 1 FROM pg_roles WHERE rolname='$DB_ROLE'")" = "1" ]; then
    ok "Ruolo applicativo '$DB_ROLE' presente"
  else
    todo "Ruolo '$DB_ROLE' assente — eseguire server/sql/setup.sql (§3.3)"
  fi

  if [ "$(psql_q "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'")" = "1" ]; then
    ok "Database '$DB_NAME' presente"

    NT=$(psql_db "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
    if [ "$NT" = "17" ]; then
      ok "Schema: 17 tabelle (atteso)"
    elif [ -n "$NT" ] && [ "$NT" -gt 0 ] 2>/dev/null; then
      avv "Schema: $NT tabelle invece di 17 — rieseguire setup.sql (è idempotente) o verificare la versione"
    else
      todo "Schema vuoto — eseguire server/sql/setup.sql"
    fi

    if [ -n "$NT" ] && [ "$NT" -gt 0 ] 2>/dev/null; then
      UPD=$(psql_db "SELECT has_table_privilege('$DB_ROLE','audit_log','UPDATE')")
      DEL=$(psql_db "SELECT has_table_privilege('$DB_ROLE','audit_log','DELETE')")
      if [ "$UPD" = "f" ] && [ "$DEL" = "f" ]; then
        ok "audit_log append-only: '$DB_ROLE' non può fare UPDATE né DELETE"
      else
        ko "audit_log MODIFICABILE da '$DB_ROLE' (UPDATE=$UPD DELETE=$DEL) — rieseguire il REVOKE (§3.3)"
      fi

      SEL=$(psql_db "SELECT has_table_privilege('$DB_ROLE','bozze','SELECT')")
      INS=$(psql_db "SELECT has_table_privilege('$DB_ROLE','bozze','INSERT')")
      if [ "$SEL" = "t" ] && [ "$INS" = "t" ]; then
        ok "Privilegi applicativi su 'bozze' corretti (SELECT/INSERT)"
      else
        ko "'$DB_ROLE' non ha i privilegi necessari su 'bozze' — l'applicazione non funzionerà"
      fi

      NA=$(psql_db "SELECT count(*) FROM anagrafiche"); NB=$(psql_db "SELECT count(*) FROM bozze")
      NU=$(psql_db "SELECT count(*) FROM users")
      info "contenuto: utenti=$NU anagrafiche=$NA liquidazioni=$NB"
    fi
  else
    todo "Database '$DB_NAME' assente — eseguire server/sql/setup.sql (§3.3)"
  fi
else
  todo "Verifiche database saltate (PostgreSQL non raggiungibile)"
fi

# ------------------------------------------------------------------ 5. Codice
titolo "5. Codice applicativo"

case "$APP_DIR" in
  "$DOCROOT"/*|"$DOCROOT")
    ko "GRAVE: il codice si trova dentro la docroot ($APP_DIR): sorgenti e .env sono pubblici su Internet" ;;
  *) : ;;
esac

if [ -d "$APP_DIR" ]; then
  ok "Directory applicativa: $APP_DIR"
  case "$APP_DIR" in "$DOCROOT"*) : ;; *) ok "Il codice è fuori dalla docroot" ;; esac

  if [ -d "$APP_DIR/.git" ]; then
    # -c safe.directory vale SOLO per questi due comandi di sola lettura: la
    # directory e' di proprieta' dell'utente applicativo, non di root, e senza
    # questo git rifiuterebbe di leggerla. Nessuna configurazione globale.
    GITRO="git -C $APP_DIR -c safe.directory=$APP_DIR"
    HEAD=$($GITRO log --oneline -1 </dev/null 2>/dev/null)
    DIRTY=$($GITRO status --porcelain </dev/null 2>/dev/null | head -5)
    ok "Repository git presente — HEAD: ${HEAD:-?}"
    [ -n "$DIRTY" ] && avv "Working tree con modifiche locali non committate"
  fi

  VER=$(node -e "try{console.log(require('$APP_DIR/package.json').version)}catch(e){}" 2>/dev/null)
  [ -n "$VER" ] && info "versione dichiarata: $VER"

  [ -d "$APP_DIR/node_modules" ] && ok "node_modules presente" || todo "Dipendenze non installate — 'npm ci' (§4)"
  [ -f "$APP_DIR/server/dist/app.js" ] && ok "Server compilato (server/dist/app.js)" || todo "Server non compilato — 'npm run build' (§6)"
  [ -f "$APP_DIR/client/dist/index.html" ] && ok "Client compilato (client/dist)" || todo "Client non compilato — 'npm run build' (§6)"

  OWN=$(stat -c '%U' "$APP_DIR" 2>/dev/null)
  [ "$OWN" = "$PGS_USER" ] && ok "Proprietario della directory: $OWN" \
    || avv "Directory di proprietà di '$OWN' invece di '$PGS_USER' — il servizio gira come '$PGS_USER'"
else
  todo "Codice non ancora clonato in $APP_DIR (§4)"
fi

# ------------------------------------------------------------------ 6. .env
titolo "6. Configurazione (.env)"

ENVF="$APP_DIR/.env"
if [ -f "$ENVF" ]; then
  ok "File .env presente"

  MODE=$(stat -c '%a' "$ENVF" 2>/dev/null)
  [ "$MODE" = "600" ] && ok "Permessi .env: 600" || ko "Permessi .env: $MODE — devono essere 600 (chmod 600 $ENVF)"

  case "$ENVF" in "$DOCROOT"*) ko "GRAVE: .env dentro la docroot: i segreti sono scaricabili dal web" ;; esac

  MANCANTI=""
  for K in NODE_ENV PORT CLIENT_ORIGIN DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD DB_SSL \
           JWT_PRIVATE_KEY_BASE64 JWT_PUBLIC_KEY_BASE64 ENCRYPTION_KEY; do
    grep -qE "^${K}=.+" "$ENVF" 2>/dev/null || MANCANTI="$MANCANTI $K"
  done
  [ -z "$MANCANTI" ] && ok "Variabili obbligatorie tutte valorizzate" \
    || ko "Variabili mancanti o vuote:$MANCANTI (l'avvio fallirebbe: la validazione è fail-closed)"

  V=$(grep -E "^NODE_ENV=" "$ENVF" | head -1 | cut -d= -f2- | tr -d '"'"'"' ')
  [ "$V" = "production" ] && ok "NODE_ENV=production" || avv "NODE_ENV=$V — in produzione serve 'production' (cookie secure, HSTS)"

  V=$(grep -E "^DB_SSL=" "$ENVF" | head -1 | cut -d= -f2- | tr -d '"'"'"' ')
  [ "$V" = "false" ] && ok "DB_SSL=false (corretto su loopback senza TLS)" \
    || ko "DB_SSL=$V — su connessione loopback senza TLS l'avvio fallisce: impostare false"

  V=$(grep -E "^PORT=" "$ENVF" | head -1 | cut -d= -f2- | tr -d '"'"'"' ')
  [ "$V" = "$PGS_PORT" ] && ok "PORT=$V (coerente con il ProxyPass)" || avv "PORT=$V ma il proxy punta a $PGS_PORT"

  ORIG=$(grep -E "^CLIENT_ORIGIN=" "$ENVF" | head -1 | cut -d= -f2- | tr -d '"'"'"' ')
  if [ -n "$ORIG" ]; then
    # CLIENT_ORIGIN accetta piu' origini separate da virgola: si validano tutte,
    # e la prima e' quella usata nei link di attivazione via email.
    for O in $(printf '%s' "$ORIG" | tr ',' ' '); do
      case "$O" in
        */)        ko "CLIENT_ORIGIN '$O' termina con '/': va scritto senza slash finale, altrimenti il controllo Origin fallisce" ;;
        https://*) ok "CLIENT_ORIGIN: $O" ;;
        http://*)  avv "CLIENT_ORIGIN '$O' in HTTP: in produzione il cookie di refresh e' 'secure' e la sessione non si manterrebbe" ;;
        *)         ko "CLIENT_ORIGIN '$O' non e' un URL valido" ;;
      esac
    done
    ORIG_FIRST=${ORIG%%,*}
  fi

  if grep -qE "^ENCRYPTION_KEY=[0-9a-f]{64}$" "$ENVF"; then
    FP=$(grep -E "^ENCRYPTION_KEY=" "$ENVF" | head -1 | cut -d= -f2- | tr -d '"'"'"' ' | sha256sum | cut -c1-12)
    ok "ENCRYPTION_KEY nel formato corretto (64 hex)"
    info "impronta chiave: $FP  ← eseguendo questo script sull'ambiente di ORIGINE deve risultare identica,"
    info "  altrimenti i dati clonati (CF, certificati, segreti TOTP) saranno illeggibili"
  else
    ko "ENCRYPTION_KEY assente o non valida: servono 64 caratteri esadecimali"
  fi

  grep -qE "^COOKIE_SECRET=.{32,}" "$ENVF" && ok "COOKIE_SECRET impostato (separato dalla chiave di cifratura)" \
    || avv "COOKIE_SECRET assente: verrebbe usata ENCRYPTION_KEY come ripiego"

  if grep -qE "^TURNSTILE_SECRET_KEY=.+" "$ENVF"; then
    avv "Turnstile configurato: il dominio deve essere autorizzato in Cloudflare, altrimenti il login viene rifiutato (fail-closed)"
  fi
else
  todo "File .env non presente in $APP_DIR (§5)"
fi

# ------------------------------------------------------------------ 7. Servizio
titolo "7. Servizio applicativo"

if systemctl list-unit-files </dev/null 2>/dev/null | grep -q "^${SERVICE}.service"; then
  systemctl is-enabled --quiet "$SERVICE" </dev/null 2>/dev/null && ok "Servizio '$SERVICE' abilitato all'avvio" \
    || avv "Servizio '$SERVICE' non abilitato: non ripartirebbe dopo un riavvio (systemctl enable $SERVICE)"

  if systemctl is-active --quiet "$SERVICE" </dev/null 2>/dev/null; then
    ok "Servizio '$SERVICE' attivo"
    RUNAS=$(systemctl show -p User --value "$SERVICE" </dev/null 2>/dev/null)
    [ "$RUNAS" = "$PGS_USER" ] && ok "Eseguito come utente '$RUNAS'" || avv "Eseguito come '$RUNAS' invece di '$PGS_USER'"

    if command -v curl >/dev/null 2>&1; then
      H=$(curl -s -m 5 "http://127.0.0.1:$PGS_PORT/health" 2>/dev/null)
      echo "$H" | grep -q '"status":"ok"' && ok "Health check locale: risposta ok" \
        || ko "Health check locale fallito su 127.0.0.1:$PGS_PORT — controllare: journalctl -u $SERVICE -n 50"
    fi
  else
    ko "Servizio '$SERVICE' non attivo — journalctl -u $SERVICE -n 50"
  fi
else
  todo "Unit systemd '$SERVICE.service' non creata (§7)"
fi

# ------------------------------------------------------------------ 8. Apache
titolo "8. Reverse proxy Apache"

DOMINIO="${DOMINIO:-}"
if [ -z "$DOMINIO" ] && [ -n "$ORIG_FIRST" ]; then
  DOMINIO=$(echo "$ORIG_FIRST" | sed -E 's#^https?://##; s#/.*##; s#:[0-9]+$##')
fi

if [ -n "$DOMINIO" ]; then
  info "dominio: $DOMINIO"
  TROVATI=0
  for TIPO in std ssl; do
    D="/etc/apache2/conf.d/userdata/$TIPO/2_4/$PGS_USER/$DOMINIO"
    F=$(ls "$D"/*.conf 2>/dev/null | head -1)
    if [ -n "$F" ]; then
      TROVATI=$((TROVATI+1))
      if grep -q "ProxyPass.*$PGS_PORT" "$F"; then
        ok "Include $TIPO presente con ProxyPass verso la porta $PGS_PORT"
      else
        ko "Include $TIPO presente ma senza ProxyPass verso $PGS_PORT: $F"
      fi
      L_WK=$(grep -n "well-known" "$F" | head -1 | cut -d: -f1)
      L_API=$(grep -n "ProxyPass */api" "$F" | head -1 | cut -d: -f1)
      if [ -n "$L_WK" ] && [ -n "$L_API" ]; then
        [ "$L_WK" -lt "$L_API" ] && ok "Esclusione /.well-known precede il proxy (AutoSSL protetto) [$TIPO]" \
          || ko "L'esclusione /.well-known viene DOPO il proxy [$TIPO]: il rinnovo dei certificati fallirà"
      elif [ -z "$L_WK" ]; then
        ko "Manca l'esclusione di /.well-known in $F: AutoSSL non riuscirà a rinnovare"
      fi
    else
      todo "Include Apache $TIPO non presente per $DOMINIO (§8)"
    fi
  done

  if [ "$TROVATI" -gt 0 ] && command -v apachectl >/dev/null 2>&1; then
    apachectl configtest </dev/null >/dev/null 2>&1 && ok "Configurazione Apache valida (configtest)" \
      || ko "apachectl configtest segnala errori — eseguirlo a mano per il dettaglio"
  fi
else
  todo "Dominio non determinabile (manca CLIENT_ORIGIN): verifiche Apache saltate"
fi

# ------------------------------------------------------------------ 9. Docroot
titolo "9. Docroot pubblica"

if [ -d "$DOCROOT" ]; then
  [ -f "$DOCROOT/index.html" ] && ok "index.html presente nella docroot" || todo "Client non ancora pubblicato in $DOCROOT (§6)"
  [ -f "$DOCROOT/.htaccess" ] && ok ".htaccess presente" || todo ".htaccess non presente: il refresh sulle rotte interne darebbe 404 (§6)"

  ESPOSTI=$(find "$DOCROOT" -maxdepth 2 \
      \( -name '.env' -o -name '*.dump' -o -name '*.sql' -o -name '*.bak' -o -name '*.pem' -o -name '*.key' \
         -o -name 'ecosystem.config.cjs' -o -name 'admin-qr.html' \) 2>/dev/null | head -10)
  if [ -n "$ESPOSTI" ]; then
    ko "GRAVE: file sensibili raggiungibili dal web nella docroot:"
    echo "$ESPOSTI" | while read -r f; do info "$f"; done
  else
    ok "Nessun file sensibile trovato nella docroot"
  fi

  for D in node_modules server .git; do
    [ -e "$DOCROOT/$D" ] && ko "GRAVE: '$D' presente nella docroot: va rimosso (il codice non va sotto public_html)"
  done
else
  avv "Docroot $DOCROOT inesistente"
fi

DUMPS=$(find "/home/$PGS_USER" -maxdepth 3 \( -name '*.dump' -o -name '*.sql.gz' \) 2>/dev/null | head -5)
[ -n "$DUMPS" ] && avv "Dump di database nella home dell'utente (contengono dati personali): valutare spostamento in /root e cancellazione dopo l'uso"

# ------------------------------------------------------------------ 10. HTTP
titolo "10. Verifiche HTTP end-to-end"

if [ -n "$DOMINIO" ] && command -v curl >/dev/null 2>&1; then
  COD=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "https://$DOMINIO/" 2>/dev/null)
  case "$COD" in
    200) ok "https://$DOMINIO/ risponde 200" ;;
    000) ko "https://$DOMINIO/ irraggiungibile (DNS, firewall o certificato)" ;;
    *)   avv "https://$DOMINIO/ risponde $COD" ;;
  esac

  COD=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "https://$DOMINIO/api/v1/auth/me" 2>/dev/null)
  case "$COD" in
    401) ok "L'API risponde 401 senza token: proxy attivo e autenticazione applicata" ;;
    404) ko "L'API risponde 404: il ProxyPass non è attivo (o Apache non è stato ricaricato)" ;;
    502|503) ko "L'API risponde $COD: il proxy c'è ma il servizio Node non risponde" ;;
    000) todo "API non raggiungibile dall'esterno" ;;
    *)   avv "L'API risponde $COD (atteso 401)" ;;
  esac

  COD=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "https://$DOMINIO/.env" 2>/dev/null)
  case "$COD" in
    200) ko "GRAVE: https://$DOMINIO/.env è scaricabile" ;;
    403|404) ok "/.env non accessibile dal web ($COD)" ;;
  esac
else
  todo "Verifiche HTTP saltate (dominio non noto o curl assente)"
fi

# ------------------------------------------------------------------ Riepilogo
echo
echo "============================================================"
printf " %sOK: %d%s   %sda correggere: %d%s   %savvisi: %d%s   %sda fare: %d%s\n" \
  "$C_OK" "$N_OK" "$C_N" "$C_ERR" "$N_FAIL" "$C_N" "$C_WRN" "$N_WARN" "$C_N" "$C_DIM" "$N_TODO" "$C_N"
echo "============================================================"

if [ "$N_FAIL" -gt 0 ]; then
  echo " Ci sono $N_FAIL punti da correggere prima di proseguire."
  PGS_CHECK_EXIT=1
elif [ "$N_TODO" -gt 0 ]; then
  echo " Nessun problema. Restano $N_TODO passi dell'installazione da completare."
  PGS_CHECK_EXIT=0
else
  echo " Installazione completa e coerente."
  PGS_CHECK_EXIT=0
fi

# Se lo script e' stato caricato con 'source', un exit chiuderebbe la sessione:
# in quel caso l'esito resta in $PGS_CHECK_EXIT e non si esce.
if [ "$PGS_SOURCED" = "0" ]; then
  exit "$PGS_CHECK_EXIT"
fi
