#!/usr/bin/env bash
# ============================================================
# PAYROLL GANG SUITE — aaPanel: riporta l'app sotto il PM2 di `www`
#
# Sintomo: il pannello mostra il progetto "Fermato" e il monitor PM2 vuoto
# mentre il sito risponde. Causa: l'app gira in un SECONDO daemon PM2 avviato
# da root (PM2_HOME=/root/.pm2); il pannello guarda solo /home/www/.pm2.
#
# Questo script: elimina il daemon di root, libera la porta, ripristina i
# permessi e riavvia l'app nel PM2 di `www` — quello che il pannello legge.
# Fermo previsto: pochi secondi.
#
# USO (da root, via SSH):
#   PGS_DRYRUN=1 bash pgs-aapanel-restore-www.sh   # mostra cosa farebbe
#   bash pgs-aapanel-restore-www.sh                # esegue
#
# Variabili: PGS_APP_DIR · PGS_PORT (3001) · PGS_USER (www) · PGS_DRYRUN
# ============================================================
set -Eeuo pipefail

APP_DIR="${PGS_APP_DIR:-/www/wwwroot/payroll-gang-suite}"
PORT="${PGS_PORT:-3001}"
RUN_USER="${PGS_USER:-www}"
PM2_HOME_WWW="/home/$RUN_USER/.pm2"
PM2_HOME_ROOT="/root/.pm2"
DRY="${PGS_DRYRUN:-0}"

die(){ echo "ERRORE: $*" >&2; exit 2; }
info(){ echo "  $*"; }
run(){ if [ "$DRY" = 1 ]; then echo "  [dry-run] $*"; else "$@"; fi; }
[ "$(id -u)" = 0 ] || die "esegui come root."
[ -d "$APP_DIR/.git" ] || die "applicazione non trovata in $APP_DIR."
[ "$DRY" = 1 ] && echo "### MODALITA' DRY-RUN: nessuna modifica ###"

PM2_BIN="$(ls -1 /www/server/nodejs/*/bin/pm2 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$PM2_BIN" ] || PM2_BIN="$(command -v pm2 || true)"
[ -n "$PM2_BIN" ] || die "pm2 non trovato."

echo "== [1/7] Stato attuale =="
LPID="$(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
if [ -n "${LPID:-}" ]; then
  info "porta $PORT tenuta dal pid $LPID (utente: $(ps -o user= -p "$LPID" | tr -d ' '))"
else
  info "porta $PORT libera."
fi
info "daemon PM2 attivi:"; ps -eo pid,user,cmd | grep -E 'PM2 (v[0-9]|God)' | grep -v grep | sed 's/^/    /' || true

echo "== [2/7] Come diventare $RUN_USER su questa macchina =="
SUDO_OK=0; RUNUSER_OK=0
if timeout 20 sudo -u "$RUN_USER" "$PM2_BIN" -v >/dev/null 2>&1; then SUDO_OK=1; fi
if timeout 20 runuser -u "$RUN_USER" -- env PM2_HOME="$PM2_HOME_WWW" "$PM2_BIN" -v >/dev/null 2>&1; then RUNUSER_OK=1; fi
info "sudo -u $RUN_USER   : $([ $SUDO_OK = 1 ] && echo FUNZIONA || echo BLOCCATO)"
info "runuser -u $RUN_USER: $([ $RUNUSER_OK = 1 ] && echo FUNZIONA || echo BLOCCATO)"
[ $SUDO_OK = 0 ] && info "ATTENZIONE: il pulsante 'Inizio' del pannello usa 'sudo -u $RUN_USER' (vedi /www/server/nodejs/vhost/scripts/): se e' bloccato da BT-Security, il pannello non riuscira' ad avviare il progetto finche' quel blocco resta."
[ $RUNUSER_OK = 1 ] || die "nessun modo di eseguire comandi come $RUN_USER: fermo qui, non tocco niente."

echo "== [3/7] Rimozione del daemon PM2 di root =="
pm2_root(){ env PM2_HOME="$PM2_HOME_ROOT" "$PM2_BIN" "$@"; }
if [ -S "$PM2_HOME_ROOT/pub.sock" ] || [ -f "$PM2_HOME_ROOT/pm2.pid" ]; then
  info "processi nel PM2 di root:"; pm2_root list --no-color 2>/dev/null | sed 's/^/    /' || true
  systemctl is-enabled pm2-root >/dev/null 2>&1 && { info "disattivo l'avvio automatico pm2-root…"; run env PM2_HOME="$PM2_HOME_ROOT" "$PM2_BIN" unstartup systemd || true; }
  run env PM2_HOME="$PM2_HOME_ROOT" "$PM2_BIN" delete all || true
  run env PM2_HOME="$PM2_HOME_ROOT" "$PM2_BIN" save --force || true
  run env PM2_HOME="$PM2_HOME_ROOT" "$PM2_BIN" kill || true
  info "daemon di root eliminato."
else
  info "nessun daemon PM2 di root: niente da fare."
fi

echo "== [4/7] Attesa che la porta $PORT si liberi =="
if [ "$DRY" = 1 ]; then info "[dry-run] salto l'attesa."; else
  for i in $(seq 1 20); do
    LPID="$(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
    [ -z "${LPID:-}" ] && break
    sleep 1
  done
  LPID="$(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
  [ -z "${LPID:-}" ] || { ps -o pid,user,cmd -p "$LPID" | sed 's/^/    /'; die "la porta $PORT e' ancora occupata dal pid $LPID: NON avvio una seconda istanza."; }
  info "porta $PORT libera."
fi

echo "== [5/7] Permessi (l'esecuzione come root puo' aver lasciato file suoi) =="
run chown -R "$RUN_USER:$RUN_USER" "$APP_DIR" 2>/dev/null || info "alcuni file non modificabili (es. .user.ini immutabile): normale."
run mkdir -p "$APP_DIR/logs"
run chown -R "$RUN_USER:$RUN_USER" "$APP_DIR/logs" 2>/dev/null || true

echo "== [6/7] Avvio nel PM2 di $RUN_USER (quello che legge il pannello) =="
pm2_www(){ runuser -u "$RUN_USER" -- env PM2_HOME="$PM2_HOME_WWW" "$PM2_BIN" "$@"; }
run runuser -u "$RUN_USER" -- env PM2_HOME="$PM2_HOME_WWW" "$PM2_BIN" startOrRestart "$APP_DIR/ecosystem.config.cjs" --env production
run runuser -u "$RUN_USER" -- env PM2_HOME="$PM2_HOME_WWW" "$PM2_BIN" save
info "salvato: al riavvio della macchina l'app riparte da questo elenco."

echo "== [7/7] Verifica =="
if [ "$DRY" = 1 ]; then echo "  [dry-run] nessuna verifica da fare."; else
  sleep 4
  pm2_www list --no-color 2>&1 | sed 's/^/    /'
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$PORT/health" || echo 000)"
  info "http://127.0.0.1:$PORT/health -> $CODE"
  RUNAS="$(ps -o user= -p "$(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)" 2>/dev/null | tr -d ' ' || true)"
  info "l'applicazione ora gira come: ${RUNAS:-?} (atteso: $RUN_USER)"
  [ "$CODE" = 200 ] || die "l'app non risponde: controlla $APP_DIR/logs/pm2-err.log"
fi

echo
echo "=== FATTO ==="
echo "Ora nel pannello (Progetto Node.js) il progetto deve risultare in esecuzione."
echo "Attiva anche 'Avvio automatico' nella configurazione del progetto."
echo "Se il pulsante 'Inizio' del pannello continua a fallire, la causa e' 'sudo -u $RUN_USER'"
echo "bloccato da BT-Security (vedi passo 2): in quel caso usa 'Riavvia' o pgs-update-aapanel.sh."
