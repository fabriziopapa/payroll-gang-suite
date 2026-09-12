#!/usr/bin/env bash
# ============================================================
# PAYROLL GANG SUITE — Installazione del database su macchina nuova
#
# Una sequenza sola, che si ferma al primo errore e finisce dicendo
# esattamente cosa resta da fare a mano. Sostituisce il rito di
# incollare psql a pezzi seguendo INSTALL_VPS_AAPANEL.md, dove ogni
# passo dimenticato diventa un guasto scoperto giorni dopo.
#
# COSA FA
#   1. controlla che .env contenga TUTTE le chiavi indispensabili
#      (una ENCRYPTION_KEY vuota non rompe l'avvio: rompe la prima
#      lettura di un dato cifrato, che e' molto peggio);
#   2. crea ruolo, database e schema con server/sql/setup.sql, che a
#      sua volta applica e verifica server/sql/permessi.sql;
#   3. marca le migrazioni come applicate (setup.sql e' il consolidato
#      e le contiene gia' tutte) con ./pgs-migra.sh baseline;
#   4. verifica il risultato, compresa una connessione REALE con le
#      credenziali dell'applicazione — non con quelle del superutente;
#   5. stampa cio' che non puo' fare al posto tuo: il primo utente.
#
# COSA NON FA. Non installa PostgreSQL, non scrive .env, non genera le
# chiavi, non costruisce il client. Sono scelte, non dimenticanze: un
# installatore che genera segreti da solo e' un installatore che
# nasconde dove sono finiti.
#
# IDEMPOTENTE. Rilanciarlo su un database gia' installato non fa danni:
# setup.sql e permessi.sql sono rieseguibili e la baseline si rifiuta di
# ripetersi.
#
# USO (dalla radice del repository, come root):
#   ./pgs-installa.sh
# ============================================================

set -Eeuo pipefail

RADICE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENVFILE="$RADICE/.env"
SETUP="$RADICE/server/sql/setup.sql"

rosso=$'\033[31m'; verde=$'\033[32m'; giallo=$'\033[33m'; grigio=$'\033[90m'; fine=$'\033[0m'
titolo() { printf '\n%s══ %s ══%s\n' "$grigio" "$*" "$fine"; }
ok()     { printf '%s✓%s %s\n' "$verde"  "$fine" "$*"; }
avviso() { printf '%s!%s %s\n' "$giallo" "$fine" "$*"; }
muori()  { printf '\n%s✗ %s%s\n\n' "$rosso" "$*" "$fine" >&2; exit 1; }

leggi_env() {
  sed -n "s/^$1=//p" "$ENVFILE" | head -n1 | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' -e 's/[[:space:]]*#.*$//'
}

# ------------------------------------------------------------
titolo "1/5  Presupposti"
# ------------------------------------------------------------
[[ -f "$ENVFILE" ]] || muori ".env assente in $RADICE. Copia .env.example e compilalo."
[[ -f "$SETUP"   ]] || muori "server/sql/setup.sql assente: sei nella radice del repository?"
[[ -x "$RADICE/pgs-migra.sh" ]] || muori "pgs-migra.sh assente o non eseguibile (chmod +x)."

# Chiavi senza le quali l'applicazione parte e poi si rompe in esercizio.
mancanti=()
for chiave in DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD \
              JWT_PRIVATE_KEY_BASE64 JWT_PUBLIC_KEY_BASE64 \
              ENCRYPTION_KEY CLIENT_ORIGIN; do
  [[ -n "$(leggi_env "$chiave")" ]] || mancanti+=("$chiave")
done
if [[ ${#mancanti[@]} -gt 0 ]]; then
  muori "in .env mancano o sono vuote: ${mancanti[*]}
  ENCRYPTION_KEY e le chiavi JWT non si possono rigenerare dopo: la
  prima cifra i dati a riposo, le seconde firmano i token. Generale
  ADESSO e conservale, poi rilancia."
fi
ok ".env completo"

DB_NAME=$(leggi_env DB_NAME)
DB_USER=$(leggi_env DB_USER)
DB_HOST=$(leggi_env DB_HOST)
DB_PORT=$(leggi_env DB_PORT)
DB_PASSWORD=$(leggi_env DB_PASSWORD)   # non viene mai stampata

# psql da superutente (crea ruolo e database) e psql da client (prova
# la connessione applicativa). Su aaPanel il binario sta fuori dal PATH
# e BT-Security vieta `sudo -u`: si usa runuser.
if [[ -n "${PGS_PSQL:-}" ]]; then
  read -r -a SUPER <<< "$PGS_PSQL"; CLIENT=(psql)
elif [[ -x /www/server/pgsql/bin/psql ]] && id postgres >/dev/null 2>&1; then
  SUPER=(runuser -u postgres -- /www/server/pgsql/bin/psql)
  CLIENT=(/www/server/pgsql/bin/psql)
elif id postgres >/dev/null 2>&1 && command -v psql >/dev/null 2>&1 && [[ $(id -u) -eq 0 ]]; then
  SUPER=(runuser -u postgres -- psql); CLIENT=(psql)
elif command -v psql >/dev/null 2>&1; then
  SUPER=(psql); CLIENT=(psql)
else
  muori "psql non trovato. Installa PostgreSQL, o imposta PGS_PSQL."
fi

"${SUPER[@]}" -X -q -w -tAc 'SELECT 1' >/dev/null 2>&1 \
  || muori "non riesco a collegarmi come superutente con: ${SUPER[*]}"
ok "superutente raggiungibile"

# ------------------------------------------------------------
titolo "2/5  Schema, ruolo, database, permessi"
# ------------------------------------------------------------
# La password dell'utente applicativo arriva da .env e finisce solo
# dentro psql: non viene mai scritta a video ne' nella cronologia.
(cd "$RADICE/server/sql" && "${SUPER[@]}" -X -q -w -v ON_ERROR_STOP=1 \
   -v app_password="$DB_PASSWORD" -f setup.sql) \
  || muori "setup.sql fallito. Niente e' stato dato per buono: leggi l'errore qui sopra."
ok "setup.sql applicato (permessi inclusi e verificati)"

# ------------------------------------------------------------
titolo "3/5  Registro delle migrazioni"
# ------------------------------------------------------------
gia=$("${SUPER[@]}" -X -q -w -tA -d "$DB_NAME" \
  -c "SELECT count(*) FROM schema_migrations" 2>/dev/null || echo 0)
if [[ "$gia" == "0" ]]; then
  "$RADICE/pgs-migra.sh" baseline || muori "baseline delle migrazioni fallita."
else
  avviso "registro gia' popolato ($gia voci): applico le eventuali mancanti"
  "$RADICE/pgs-migra.sh" applica || muori "applicazione delle migrazioni fallita."
fi

# ------------------------------------------------------------
titolo "4/5  Verifica"
# ------------------------------------------------------------
chiedi() { "${SUPER[@]}" -X -q -w -tA -d "$DB_NAME" -c "$1"; }

tabelle=$(chiedi "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
[[ "$tabelle" -ge 18 ]] || muori "solo $tabelle tabelle in public: ne attendevo almeno 18."
ok "$tabelle tabelle nello schema public"

possedute=$(chiedi "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname='public' AND pg_get_userbyid(c.relowner)='$DB_USER'")
[[ "$possedute" == "0" ]] || muori "$DB_USER possiede $possedute oggetti: esegui server/sql/proprieta_postgres.sql."
ok "$DB_USER non possiede alcun oggetto"

registrate=$(chiedi "SELECT count(*) FROM schema_migrations")
sul_disco=$(find "$RADICE/server/src/db/migrations" -maxdepth 1 -name '[0-9]*.sql' | wc -l)
[[ "$registrate" == "$sul_disco" ]] \
  || muori "registro incoerente: $registrate registrate, $sul_disco file sul disco."
ok "$registrate migrazioni registrate, quante i file"

# La prova che conta: connessione con le credenziali VERE
# dell'applicazione, non con quelle del superutente. Qui si scoprono
# host sbagliato, pg_hba che non ammette md5, password diversa da quella
# creata da setup.sql.
PGPASSWORD="$DB_PASSWORD" "${CLIENT[@]}" -X -q -w -tA \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -c "SELECT count(*) FROM users" >/dev/null 2>&1 \
  || muori "$DB_USER non riesce a collegarsi a $DB_NAME su $DB_HOST:$DB_PORT.
  Controlla pg_hba.conf (serve md5/scram per questo host) e DB_PASSWORD."
ok "$DB_USER si collega e legge davvero"

# ------------------------------------------------------------
titolo "5/5  Cosa resta a te"
# ------------------------------------------------------------
utenti=$(chiedi "SELECT count(*) FROM users")
cat <<FINE

Database pronto.

$( [[ "$utenti" == "0" ]] && cat <<'PRIMO'
  ▸ PRIMO UTENTE — senza questo non si entra:
        npm ci
        npm run build
        npm run seed --workspace=server

    Il seed stampa UNA SOLA VOLTA il link di attivazione (valido 24 ore)
    e la chiave di backup TOTP: il token e' salvato solo come hash, se lo
    perdi l'account non si attiva piu'. Scrive anche server/admin-qr.html:
    scansiona il QR, poi cancellalo con `shred -u`.
PRIMO
)
$( [[ "$utenti" != "0" ]] && printf '  ▸ Utenti presenti: %s — il seed non serve.\n' "$utenti" )
  ▸ Avvio: pm2 startOrRestart ecosystem.config.cjs --env production
  ▸ Manutenzione:
        ./pgs-migra.sh stato       stato dello schema
        ./pgs-migra.sh applica     dopo ogni git pull che porti migrazioni
        ./pgs-migra.sh permessi    dopo un ripristino dal pannello

FINE
