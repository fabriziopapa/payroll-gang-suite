#!/usr/bin/env bash
# ============================================================
# PGS — Ripristino di un dump PostgreSQL in un ambiente NON di produzione
#
#   bash cpanel-restore-dump.sh /root/pgs_2026-08-15.dump
#
# Esegue, nell'ordine: backup del database attuale, arresto del servizio,
# ripristino, RIALLINEAMENTO DELLO SCHEMA, ripristino dei privilegi,
# riavvio e verifiche.
#
# I due passaggi che si dimenticano sempre, e che questo script fa per te:
#  · rilanciare setup.sql dopo il ripristino — pg_restore ricrea le tabelle
#    secondo lo schema del DUMP, che puo' essere piu' vecchio di quello che
#    il codice si aspetta (es. anagrafiche.cod_fis VARCHAR(16) invece di 255:
#    l'import fallirebbe appena il codice prova a scriverci un CF cifrato);
#  · riapplicare GRANT e soprattutto REVOKE su audit_log, che pg_restore
#    azzera facendo perdere la proprieta' append-only del registro.
#
# NON usare in produzione: sovrascrive il database.
# Vedi INSTALL_CPANEL.md.
# ============================================================

if (return 0 2>/dev/null); then
  printf '\n  Va ESEGUITO, non caricato con source:  bash cpanel-restore-dump.sh <file.dump>\n\n'; return 1
fi

DUMP="${1:-}"
PGS_USER="${PGS_USER:-pgs}"
APP_DIR="${APP_DIR:-/home/$PGS_USER/apps/payroll-gang-suite}"
DB_NAME="${DB_NAME:-payroll_gang}"
DB_ROLE="${DB_ROLE:-payroll_user}"
SERVICE="${SERVICE:-pgs}"

if [ -t 1 ]; then C_OK=$'\033[32m'; C_ERR=$'\033[31m'; C_WRN=$'\033[33m'; C_TTL=$'\033[1m'; C_N=$'\033[0m'
else C_OK=""; C_ERR=""; C_WRN=""; C_TTL=""; C_N=""; fi
fase() { printf "\n%s══ %s%s\n" "$C_TTL" "$1" "$C_N"; }
ok()   { printf "  %s✔%s %s\n" "$C_OK"  "$C_N" "$1"; }
avv()  { printf "  %s!%s %s\n" "$C_WRN" "$C_N" "$1"; }
die()  { printf "\n  %s✘ %s%s\n\n" "$C_ERR" "$1" "$C_N"; exit 1; }

[ "$(id -u)" = "0" ] || die "Serve l'utente root."
[ -n "$DUMP" ] || die "Uso: bash cpanel-restore-dump.sh /percorso/file.dump"
[ -r "$DUMP" ] || die "File non leggibile: $DUMP"
[ -f "$APP_DIR/server/sql/setup.sql" ] || die "setup.sql non trovato in $APP_DIR."

case "$DUMP" in
  /home/*/public_html/*) die "Il dump si trova nella docroot: e' scaricabile dal web. Spostalo in /root." ;;
esac

fase "1 — Situazione attuale"
CONTA() { sudo -n -u postgres psql -d "$DB_NAME" -tAqc "$1" </dev/null 2>/dev/null | tr -d '[:space:]'; }
PRIMA_U=$(CONTA "SELECT count(*) FROM users")
PRIMA_A=$(CONTA "SELECT count(*) FROM anagrafiche")
PRIMA_B=$(CONTA "SELECT count(*) FROM bozze")
ok "Database '$DB_NAME': utenti=${PRIMA_U:-?} anagrafiche=${PRIMA_A:-?} liquidazioni=${PRIMA_B:-?}"
ok "Dump da ripristinare: $DUMP ($(du -h "$DUMP" | cut -f1))"
avv "Il contenuto attuale verra' SOSTITUITO."

if [ -t 0 ] && [ "$PGS_ASSUME_YES" != "1" ]; then
  printf "  %s? Procedo? [s/n] %s" "$C_WRN" "$C_N"
  read -r R </dev/tty
  case "$R" in s|S|y|Y|si|SI) : ;; *) die "Annullato." ;; esac
fi

fase "2 — Backup del database attuale"
BK="/root/pgs_pre_restore_$(date +%Y%m%d_%H%M%S).dump"
if sudo -n -u postgres pg_dump -Fc --no-owner --no-privileges -d "$DB_NAME" -f "$BK" </dev/null 2>/dev/null; then
  chmod 600 "$BK"; ok "Backup salvato: $BK"
else
  avv "Backup non riuscito (database vuoto o appena creato): si prosegue"
fi

fase "3 — Arresto del servizio"
systemctl stop "$SERVICE" 2>/dev/null && ok "Servizio '$SERVICE' fermato" || avv "Servizio non attivo"

fase "4 — Ripristino"

# L'utente 'postgres' non puo' leggere dentro /root (permessi 700): il dump va
# messo in una directory che possa attraversare. Ne creiamo una temporanea di
# sua proprieta' e con permessi 700, cosi' i dati personali non diventano
# leggibili da altri utenti del sistema.
STAGE=$(mktemp -d /tmp/pgs-restore-XXXXXX) || die "Impossibile creare la directory temporanea."
cp "$DUMP" "$STAGE/dump.pgc" || die "Copia del dump fallita."
chown -R postgres:postgres "$STAGE"
chmod 700 "$STAGE"; chmod 600 "$STAGE/dump.pgc"
ok "Dump reso accessibile a postgres in $STAGE"

sudo -n -u postgres pg_restore --clean --if-exists --no-owner -d "$DB_NAME" "$STAGE/dump.pgc" \
  </dev/null >/tmp/pgs_restore.log 2>&1
ESITO_RESTORE=$?

shred -u "$STAGE/dump.pgc" 2>/dev/null || rm -f "$STAGE/dump.pgc"
rmdir "$STAGE" 2>/dev/null

NERR=$(grep -c "^pg_restore: error" /tmp/pgs_restore.log 2>/dev/null || echo 0)
if [ "$ESITO_RESTORE" -ne 0 ] && [ "$NERR" -gt 0 ]; then
  echo
  sed -n '1,10p' /tmp/pgs_restore.log | sed 's/^/      /'
  echo
fi
# I DROP di oggetti inesistenti sono normali con --clean su un database nuovo:
# l'esito vero si giudica dai dati (fase 7), non dal codice di uscita.
[ "$NERR" -gt 0 ] && avv "$NERR righe di errore in /tmp/pgs_restore.log"
ok "pg_restore eseguito (codice $ESITO_RESTORE)"

fase "5 — Riallineamento dello schema"
DB_PASS=$(grep -E '^DB_PASSWORD=' "$APP_DIR/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"' ')
[ -n "$DB_PASS" ] || die "DB_PASSWORD non leggibile da $APP_DIR/.env"
sudo -n -u postgres psql -v app_password="$DB_PASS" -f "$APP_DIR/server/sql/setup.sql" \
  </dev/null >/tmp/pgs_setup_after_restore.log 2>&1 \
  || die "setup.sql fallito — vedi /tmp/pgs_setup_after_restore.log"
ok "Schema riallineato alla versione attesa dal codice"

printf "ALTER ROLE %s WITH PASSWORD '%s';\n" "$DB_ROLE" "$DB_PASS" \
  | sudo -n -u postgres psql -q >/dev/null 2>&1 \
  && ok "Password del ruolo riallineata al .env (il dump puo' portarne un'altra)"

fase "6 — Privilegi"
sudo -n -u postgres psql -d "$DB_NAME" </dev/null >/dev/null 2>&1 <<SQL
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO $DB_ROLE;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO $DB_ROLE;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM $DB_ROLE;
SQL
UPD=$(CONTA "SELECT has_table_privilege('$DB_ROLE','audit_log','UPDATE')")
[ "$UPD" = "f" ] && ok "audit_log append-only ripristinato" || die "audit_log risulta ancora modificabile da $DB_ROLE."

fase "7 — Verifiche"
COL=$(sudo -n -u postgres psql -d "$DB_NAME" -tAqc \
  "SELECT character_maximum_length FROM information_schema.columns WHERE table_name='anagrafiche' AND column_name='cod_fis'" </dev/null 2>/dev/null | tr -d '[:space:]')
[ "$COL" = "255" ] && ok "anagrafiche.cod_fis: VARCHAR(255) (il codice puo' scriverci il CF cifrato)" \
                   || avv "anagrafiche.cod_fis: lunghezza $COL — attesa 255. Verificare setup.sql."

DOPO_U=$(CONTA "SELECT count(*) FROM users")
DOPO_A=$(CONTA "SELECT count(*) FROM anagrafiche")
DOPO_B=$(CONTA "SELECT count(*) FROM bozze")
ok "Contenuto ripristinato: utenti=${DOPO_U:-?} anagrafiche=${DOPO_A:-?} liquidazioni=${DOPO_B:-?}"

# Un dump di dimensioni reali che lascia i conteggi identici significa che non
# e' stato importato nulla: e' il caso in cui l'errore passerebbe inosservato.
DIM=$(stat -c %s "$DUMP" 2>/dev/null || echo 0)
if [ "$DOPO_U" = "$PRIMA_U" ] && [ "$DOPO_A" = "$PRIMA_A" ] && [ "$DOPO_B" = "$PRIMA_B" ] && [ "$DIM" -gt 51200 ]; then
  echo
  sed -n '1,10p' /tmp/pgs_restore.log | sed 's/^/      /'
  echo
  systemctl start "$SERVICE" 2>/dev/null
  die "I conteggi sono identici a prima: il ripristino NON ha importato nulla. Sopra le prime righe del log."
fi
ORF=$(CONTA "SELECT count(*) FROM bozze b LEFT JOIN users u ON u.id=b.created_by WHERE b.created_by IS NOT NULL AND u.id IS NULL")
[ "$ORF" = "0" ] && ok "Nessun riferimento orfano tra liquidazioni e utenti" || avv "Liquidazioni con autore inesistente: $ORF"

fase "8 — Riavvio"
systemctl start "$SERVICE"
sleep 3
systemctl is-active --quiet "$SERVICE" && ok "Servizio '$SERVICE' attivo" \
  || { journalctl -u "$SERVICE" -n 20 --no-pager; die "Il servizio non riparte."; }
curl -s -m 5 http://127.0.0.1:3001/health 2>/dev/null | grep -q '"status":"ok"' \
  && ok "Health check superato" || avv "Health check non risponde: journalctl -u $SERVICE -n 50"

echo
echo "${C_TTL}Da fare adesso:${C_N}"
echo "  1. Accedi con un'utenza REALE proveniente dal dump: e' l'unica prova che"
echo "     ENCRYPTION_KEY coincide con quella dell'ambiente di origine. Se il TOTP"
echo "     non viene accettato, la chiave e' diversa: NON rigenerare nulla,"
echo "     ricontrollare il .env dell'origine."
echo "  2. Apri una liquidazione con codici fiscali nei tag e genera un certificato:"
echo "     verifica che i dati cifrati siano leggibili."
echo "  3. Cancella il dump, contiene dati personali:  shred -u $DUMP"
echo "  4. Il backup pre-ripristino resta in $BK (cancellalo quando non serve)."
