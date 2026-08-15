#!/usr/bin/env bash
# ============================================================
# PGS — Protegge (o libera) un ambiente NON di produzione con
# autenticazione base a livello Apache.
#
#   bash cpanel-preprod-lock.sh on    attiva la password
#   bash cpanel-preprod-lock.sh off   la rimuove
#   bash cpanel-preprod-lock.sh stato mostra la situazione
#
# Variabili: PGS_USER (default pgs), PGS_DOMAIN (richiesto),
#            PGS_AUTH_USER (default pgs)
#
# Da eseguire con bash come root. NON usare in produzione.
# Vedi INSTALL_CPANEL.md e cpanel-basicauth.conf.example.
# ============================================================

if (return 0 2>/dev/null); then
  printf '\n  Va ESEGUITO, non caricato con source:  bash cpanel-preprod-lock.sh on\n\n'; return 1
fi

PGS_USER="${PGS_USER:-pgs}"
PGS_DOMAIN="${PGS_DOMAIN:-}"
PGS_AUTH_USER="${PGS_AUTH_USER:-pgs}"
HTFILE=/etc/pgs/preprod.htpasswd
AZIONE="${1:-}"

if [ -t 1 ]; then C_OK=$'\033[32m'; C_ERR=$'\033[31m'; C_WRN=$'\033[33m'; C_N=$'\033[0m'
else C_OK=""; C_ERR=""; C_WRN=""; C_N=""; fi
ok()  { printf "  %s✔%s %s\n" "$C_OK"  "$C_N" "$1"; }
avv() { printf "  %s!%s %s\n" "$C_WRN" "$C_N" "$1"; }
die() { printf "\n  %s✘ %s%s\n\n" "$C_ERR" "$1" "$C_N"; exit 1; }

[ "$(id -u)" = "0" ] || die "Serve l'utente root."
case "$AZIONE" in on|off|stato) : ;; *) die "Uso: bash cpanel-preprod-lock.sh {on|off|stato}" ;; esac

if [ -z "$PGS_DOMAIN" ]; then
  printf "  Dominio: "; read -r PGS_DOMAIN </dev/tty
  [ -n "$PGS_DOMAIN" ] || die "Dominio necessario."
fi

BASE=/etc/apache2/conf.d/userdata
[ -d /etc/apache2 ] || BASE=/usr/local/apache/conf/userdata
DIR_STD="$BASE/std/2_4/$PGS_USER/$PGS_DOMAIN"
DIR_SSL="$BASE/ssl/2_4/$PGS_USER/$PGS_DOMAIN"

ricarica_apache() {
  /scripts/ensure_vhost_includes --user="$PGS_USER" >/dev/null 2>&1
  if apachectl configtest </dev/null >/dev/null 2>&1; then
    /scripts/rebuildhttpdconf >/dev/null 2>&1
    systemctl restart httpd >/dev/null 2>&1 || /scripts/restartsrv_httpd >/dev/null 2>&1
    ok "Apache ricaricato"
  else
    avv "apachectl configtest segnala errori: Apache NON e' stato riavviato. Eseguirlo a mano."
    return 1
  fi
}

case "$AZIONE" in

  stato)
    if [ -f "$DIR_SSL/pgs-basicauth.conf" ]; then
      ok "Autenticazione base ATTIVA su $PGS_DOMAIN"
      [ -f "$HTFILE" ] && ok "Utenti definiti: $(cut -d: -f1 "$HTFILE" | tr '\n' ' ')" \
                       || avv "Manca il file delle password $HTFILE: nessuno riuscirebbe a entrare"
    else
      avv "Autenticazione base NON attiva su $PGS_DOMAIN"
    fi
    ;;

  on)
    # La password non viene mai scritta su disco in chiaro ne' passata come
    # argomento di un processo: solo il suo hash finisce nel file.
    printf "  Password per l'utente '%s': " "$PGS_AUTH_USER"; read -r -s P1 </dev/tty; echo
    printf "  Ripetila: "; read -r -s P2 </dev/tty; echo
    [ -n "$P1" ] || die "Password vuota."
    [ "$P1" = "$P2" ] || die "Le due password non coincidono."

    command -v openssl >/dev/null 2>&1 || die "openssl non disponibile."
    HASH=$(openssl passwd -apr1 "$P1") || die "Generazione dell'hash fallita."
    unset P1 P2

    mkdir -p /etc/pgs
    printf '%s:%s\n' "$PGS_AUTH_USER" "$HASH" > "$HTFILE"
    chmod 644 "$HTFILE"      # contiene hash, non password; Apache deve leggerlo
    ok "File delle password scritto: $HTFILE"

    SORG="$(dirname "$0")/cpanel-basicauth.conf.example"
    [ -f "$SORG" ] || die "Manca $SORG"
    for D in "$DIR_STD" "$DIR_SSL"; do
      mkdir -p "$D" && sed "s#/etc/pgs/preprod.htpasswd#$HTFILE#" "$SORG" > "$D/pgs-basicauth.conf"
    done
    ok "Include Apache scritti (std e ssl)"

    ricarica_apache && {
      echo
      ok "Ambiente protetto. Il browser chiedera' utente e password prima di mostrare PGS."
      echo "     Utente: $PGS_AUTH_USER"
      echo "     Per rimuovere:  bash cpanel-preprod-lock.sh off"
    }
    ;;

  off)
    rm -f "$DIR_STD/pgs-basicauth.conf" "$DIR_SSL/pgs-basicauth.conf"
    ok "Include rimossi"
    ricarica_apache
    avv "Il file $HTFILE resta sul disco: rimuoverlo con 'rm $HTFILE' se non serve piu'."
    echo
    avv "L'ambiente e' ora raggiungibile da chiunque conosca l'URL: se contiene una"
    avv "copia dei dati reali, gli utenti possono autenticarsi con il loro TOTP."
    ;;
esac
