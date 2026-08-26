#!/usr/bin/env bash
# ============================================================
# PAYROLL GANG SUITE — Diagnosi "progetto Node fermato" su aaPanel
#
# SOLA LETTURA: non avvia, non ferma, non riavvia NULLA.
# Serve a capire perche' il pannello (aaPanel 8.x) mostra il progetto
# come "Fermato" e il monitor PM2 vuoto mentre l'app risponde davvero.
#
# USO (da root, via SSH o Terminale aaPanel):
#   bash pgs-aapanel-diag.sh
#
# Variabili: PGS_APP_DIR (/www/wwwroot/payroll-gang-suite)
#            PGS_PORT (3001) · PGS_USER (www) · PGS_APP_NAME (payroll_gang_suite)
# ============================================================
set -u

APP_DIR="${PGS_APP_DIR:-/www/wwwroot/payroll-gang-suite}"
PORT="${PGS_PORT:-3001}"
RUN_USER="${PGS_USER:-www}"
APP_NAME="${PGS_APP_NAME:-payroll_gang_suite}"

hr(){ printf '\n=== %s ===\n' "$*"; }
[ "$(id -u)" = 0 ] || echo "ATTENZIONE: non sei root, alcune sezioni saranno incomplete."

hr "1) Versione pannello e sistema"
for f in /www/server/panel/class/common.py; do :; done
cat /www/server/panel/config/version.pl 2>/dev/null | sed 's/^/  versione pannello: /'
[ -f /www/server/panel/data/userInfo.json ] && echo "  (pannello installato in /www/server/panel)"
uname -a | sed 's/^/  /'
echo "  data: $(date -Is)"

hr "2) Chi ascolta sulla porta $PORT"
if command -v ss >/dev/null; then ss -ltnp "sport = :$PORT" 2>/dev/null | sed 's/^/  /'
else netstat -ltnp 2>/dev/null | grep ":$PORT" | sed 's/^/  /'; fi
LPID="$(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)"
if [ -n "${LPID:-}" ]; then
  echo "  --- processo in ascolto (pid $LPID) ---"
  ps -o pid,ppid,user,lstart,etime,rss,cmd -p "$LPID" 2>/dev/null | sed 's/^/  /'
  PPID_L="$(ps -o ppid= -p "$LPID" 2>/dev/null | tr -d ' ')"
  [ -n "${PPID_L:-}" ] && { echo "  --- padre (pid $PPID_L) = daemon PM2 che lo gestisce ---"
    ps -o pid,user,lstart,cmd -p "$PPID_L" 2>/dev/null | sed 's/^/  /'
    echo "  PM2_HOME del padre:"; tr '\0' '\n' < "/proc/$PPID_L/environ" 2>/dev/null | grep -E '^(PM2_HOME|HOME|USER)=' | sed 's/^/    /'; }
else
  echo "  NESSUN processo in ascolto sulla porta $PORT."
fi

hr "3) Risposta dell'applicazione (locale)"
echo -n "  http://127.0.0.1:$PORT/health -> "
curl -s -o /dev/null -w '%{http_code}\n' --max-time 8 "http://127.0.0.1:$PORT/health" 2>/dev/null || echo "irraggiungibile"

hr "4) Daemon PM2 attivi sulla macchina"
ps -eo pid,user,lstart,cmd 2>/dev/null | grep -E 'PM2 (v[0-9]|God)|PM2\[' | grep -v grep | sed 's/^/  /' || echo "  nessuno"
echo "  --- processi node del progetto ---"
ps -eo pid,user,etime,cmd 2>/dev/null | grep -E 'payroll|server/dist/app\.js' | grep -v grep | sed 's/^/  /' || echo "  nessuno"

hr "5) PM2_HOME presenti e cosa contengono"
for H in /root/.pm2 /home/*/.pm2 /www/server/nodejs/.pm2 /www/wwwroot/.pm2 /www/server/panel/.pm2; do
  [ -d "$H" ] || continue
  OWNER="$(stat -c %U "$H" 2>/dev/null)"
  echo "  - $H (owner: $OWNER)"
  [ -f "$H/pm2.pid" ] && echo "      pm2.pid: $(cat "$H/pm2.pid" 2>/dev/null) (vivo: $(kill -0 "$(cat "$H/pm2.pid" 2>/dev/null)" 2>/dev/null && echo si || echo NO))"
  [ -f "$H/dump.pm2" ] && echo "      dump.pm2: $(grep -o '"name":"[^"]*"' "$H/dump.pm2" 2>/dev/null | tr '\n' ' ')"
  [ -f "$H/pub.sock" ] && echo "      socket: presente"
done

hr "6) Node e PM2 installati (percorsi e versioni)"
ls -1d /www/server/nodejs/*/ 2>/dev/null | sed 's/^/  node: /'
for P in /www/server/nodejs/*/bin/pm2 /usr/local/bin/pm2 /usr/bin/pm2; do
  [ -e "$P" ] || continue
  echo "  pm2: $P -> $(readlink -f "$P") (v$("$P" -v 2>/dev/null | tail -1))"
done
echo "  pm2 nel PATH di root: $(command -v pm2 || echo assente)"

hr "7) Elenco PM2 per ogni utente candidato (sola lettura)"
PM2_BIN="$(ls -1 /www/server/nodejs/*/bin/pm2 2>/dev/null | sort -V | tail -1)"
[ -n "${PM2_BIN:-}" ] || PM2_BIN="$(command -v pm2 || true)"
if [ -n "${PM2_BIN:-}" ]; then
  for U in "$RUN_USER" root; do
    H="$([ "$U" = root ] && echo /root/.pm2 || echo "/home/$U/.pm2")"
    echo "  --- utente $U (PM2_HOME=$H) ---"
    if [ "$U" = root ]; then env PM2_HOME="$H" "$PM2_BIN" list --no-color 2>&1 | sed 's/^/    /'
    else runuser -u "$U" -- env PM2_HOME="$H" "$PM2_BIN" list --no-color 2>&1 | sed 's/^/    /'; fi
  done
else echo "  PM2 non trovato."; fi

hr "8) Come il pannello vede/avvia il progetto"
echo "  --- file generati dal Node project manager ---"
find /www/server/nodejs /www/server/panel/vhost -maxdepth 4 \( -name "*${APP_NAME}*" -o -name '*payroll*' \) 2>/dev/null | sed 's/^/    /' | head -30
for S in /www/server/nodejs/vhost/scripts/"$APP_NAME".sh /www/server/nodejs/vhost/scripts/"$APP_NAME"_start.sh; do
  [ -f "$S" ] && { echo "  --- $S ---"; sed 's/^/    /' "$S"; }
done
echo "  --- record nel database del pannello ---"
python3 - "$APP_NAME" <<'PY' 2>/dev/null | sed 's/^/    /'
import sqlite3, sys, glob
name = sys.argv[1]
for db in glob.glob('/www/server/panel/data/*.db'):
    try: con = sqlite3.connect(db); con.text_factory = str
    except Exception: continue
    try: tables = [r[0] for r in con.execute("select name from sqlite_master where type='table'")]
    except Exception: continue
    for t in tables:
        try: rows = list(con.execute(f"select * from [{t}]"))
        except Exception: continue
        cols = [d[0] for d in con.execute(f"select * from [{t}] limit 1").description] if rows else []
        for r in rows:
            if any('payroll' in str(v).lower() for v in r):
                print(f"{db} :: {t}")
                for c, v in zip(cols, r):
                    s = str(v)
                    print(f"   {c} = {s[:400]}")
                print()
PY

hr "9) Log recenti"
for L in /www/server/nodejs/vhost/logs/"$APP_NAME".log /www/server/nodejs/vhost/logs/"$APP_NAME"_error.log "$APP_DIR/logs/pm2-err.log" "$APP_DIR/logs/pm2-out.log"; do
  [ -f "$L" ] || continue
  echo "  --- ultime 25 righe di $L ---"; tail -n 25 "$L" 2>/dev/null | sed 's/^/    /'
done
echo "  --- log errori pannello (ultime 30) ---"
tail -n 30 /www/server/panel/logs/error.log 2>/dev/null | sed 's/^/    /'

hr "10) Stato del repository"
git -C "$APP_DIR" -c safe.directory="$APP_DIR" --no-optional-locks log -1 --format='  commit %h  %ad  %s' --date=short 2>/dev/null
node -p "'  versione package.json: ' + require('$APP_DIR/package.json').version" 2>/dev/null
ls -ld "$APP_DIR" "$APP_DIR/server/dist/app.js" 2>/dev/null | sed 's/^/  /'

hr "11) Tracce della Riparazione di sicurezza aaPanel (one-click)"
echo "  --- utente $RUN_USER: shell, lock, scadenza ---"
getent passwd "$RUN_USER" | sed 's/^/    /'
passwd -S "$RUN_USER" 2>/dev/null | sed 's/^/    /'
chage -l "$RUN_USER" 2>/dev/null | sed 's/^/    /'
echo "  (shell nologin e' NORMALE e voluto; contano lock 'L' e date di scadenza passate)"

echo "  --- home e PM2_HOME: permessi ---"
ls -ld "/home/$RUN_USER" "/home/$RUN_USER/.pm2" 2>/dev/null | sed 's/^/    /'

echo "  --- opzioni di mount (noexec/nosuid rompono npm e i socket PM2) ---"
findmnt -no TARGET,OPTIONS /tmp /home /var /dev/shm 2>/dev/null | sed 's/^/    /'

echo "  --- umask di sistema ---"
grep -rhs -E '^\s*(umask|UMASK)' /etc/profile /etc/login.defs /etc/bashrc /etc/profile.d/*.sh 2>/dev/null | sed 's/^/    /'

echo "  --- PAM / restrizioni di accesso (runuser passa da PAM) ---"
grep -vE '^\s*(#|$)' /etc/security/access.conf 2>/dev/null | sed 's/^/    access.conf: /'
grep -nE 'pam_(wheel|access|succeed_if|nologin)' /etc/pam.d/su /etc/pam.d/runuser /etc/pam.d/runuser-l 2>/dev/null | sed 's/^/    /'
grep -vE '^\s*(#|$)' /etc/security/limits.conf 2>/dev/null | grep -i core | sed 's/^/    limits: /'

echo "  --- sysctl applicati di recente ---"
ls -l /etc/sysctl.conf /etc/sysctl.d/ 2>/dev/null | sed 's/^/    /'
sysctl fs.suid_dumpable kernel.core_pattern fs.protected_hardlinks 2>/dev/null | sed 's/^/    /'

echo "  --- file di /etc modificati negli ultimi 20 giorni (cosa ha toccato la riparazione) ---"
find /etc -xdev -type f -mtime -20 -printf '%TY-%Tm-%Td %TH:%TM  %p\n' 2>/dev/null | sort | tail -60 | sed 's/^/    /'

echo "  --- log del plugin di sicurezza / riparazione ---"
for L in /www/server/panel/logs/risk.log /www/server/panel/plugin/*security*/logs/*.log /www/server/panel/data/risk_*.json; do
  [ -e "$L" ] || continue; echo "    --- $L ---"; tail -n 20 "$L" 2>/dev/null | sed 's/^/      /'
done
find /www/server/panel -maxdepth 3 -iname '*risk*' -o -maxdepth 3 -iname '*repair*' 2>/dev/null | head -15 | sed 's/^/    /'

echo
echo "=== FINE DIAGNOSI — nessuna modifica effettuata ==="
