#!/usr/bin/env bash
# ============================================================
# PAYROLL GANG SUITE — Ricerca di job e script orfani, troncati o defunti
#
# SOLA LETTURA: non avvia, non ferma, non cancella, non corregge NULLA.
# Elenca cio' che e' rimasto indietro sul server dopo installazioni,
# riallineamenti e funzioni rimosse:
#   1. processi zombie, daemon PM2 doppi, processi che girano da file cancellati
#   2. unita' systemd e timer che puntano a file inesistenti o falliscono
#   3. righe di cron che chiamano script inesistenti
#   4. script troncati o rovinati (vuoti, NUL, CRLF, sintassi, copie divergenti)
#   5. residui noti di PGS (controllo aggiornamenti rimosso, PM2 di root, dump)
#
# Funziona su cPanel e su aaPanel: cartella e utente dell'applicazione si
# ricavano dal processo in ascolto sulla porta (default 3001).
#
# USO (da root). Root non esegue file scrivibili dall'utente applicativo:
#   install -o root -g root -m 700 <repo>/pgs-orfani.sh /root/pgs-operativo/pgs-orfani.sh
#   bash /root/pgs-operativo/pgs-orfani.sh
#
# Variabili: PGS_PORT (3001) · PGS_APP_DIR · PGS_USER  (per forzare il rilevamento)
# Exit code: 0 = nessun problema grave · 1 = almeno un ✘
# ⚠ NON incollare nel terminale e non usare 'source': eseguirlo con bash.
# ============================================================
set -u
export LC_ALL=C

PORT="${PGS_PORT:-3001}"
N_KO=0; N_WARN=0
hr()   { printf '\n=== %s ===\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; N_WARN=$((N_WARN+1)); }
ko()   { printf '  ✘ %s\n' "$*"; N_KO=$((N_KO+1)); }
info() { printf '    %s\n' "$*"; }

[ "$(id -u)" = 0 ] || warn "Non sei root: alcune sezioni saranno incomplete."
HAS_SYSTEMD=0; command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ] && HAS_SYSTEMD=1

# ------------------------------------------------------------
hr "0) Contesto"
PANNELLO="nessuno"
[ -d /usr/local/cpanel ]   && PANNELLO="cPanel"
[ -d /www/server/panel ]   && PANNELLO="aaPanel"
info "pannello: $PANNELLO · host: $(hostname) · $(date -Is)"

LPID=""
if command -v ss >/dev/null 2>&1; then
  LPID="$(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)"
fi
APP_DIR="${PGS_APP_DIR:-}"
APP_USER="${PGS_USER:-}"
NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -n "$LPID" ]; then
  CWD="$(readlink "/proc/$LPID/cwd" 2>/dev/null || true)"
  [ -z "$APP_USER" ] && APP_USER="$(ps -o user= -p "$LPID" 2>/dev/null | tr -d ' ')"
  [ -z "$NODE_BIN" ] && NODE_BIN="$(readlink "/proc/$LPID/exe" 2>/dev/null || true)"
  if [ -z "$APP_DIR" ] && [ -n "$CWD" ]; then
    D="$CWD"
    while [ "$D" != "/" ] && [ -n "$D" ]; do
      if [ -f "$D/package.json" ] && grep -q '"name": *"payroll-gang-suite"' "$D/package.json" 2>/dev/null; then APP_DIR="$D"; break; fi
      D="$(dirname "$D")"
    done
  fi
fi
if [ -z "$APP_DIR" ]; then
  for D in /www/wwwroot/payroll-gang-suite /home/pgs/apps/payroll-gang-suite; do
    [ -f "$D/package.json" ] && APP_DIR="$D" && break
  done
fi
[ -z "$APP_USER" ] && { [ "$PANNELLO" = "aaPanel" ] && APP_USER=www || APP_USER=pgs; }
if [ -n "$APP_DIR" ]; then
  COMMIT="$(git --no-optional-locks -C "$APP_DIR" -c safe.directory="$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo '?')"
  VER="$(grep -m1 '"version"' "$APP_DIR/package.json" 2>/dev/null | sed -E 's/.*"version": *"([^"]+)".*/\1/')"
  info "applicazione: $APP_DIR · utente: $APP_USER · v${VER:-?} ($COMMIT) · pid porta $PORT: ${LPID:-nessuno}"
else
  warn "Cartella dell'applicazione non trovata (nessun processo sulla porta $PORT?). Usare PGS_APP_DIR=…"
fi

# ------------------------------------------------------------
hr "1) Processi: zombie, daemon PM2, file cancellati"
ZOMBIE="$(ps -eo pid=,ppid=,stat=,user=,etime=,comm= 2>/dev/null | awk '$3 ~ /^Z/')"
if [ -n "$ZOMBIE" ]; then
  ko "Processi zombie (defunct) — li deve raccogliere il padre (PPID):"
  printf '%s\n' "$ZOMBIE" | sed 's/^/      /'
else ok "Nessun processo zombie."; fi

PM2D="$(ps -eo pid=,user=,args= 2>/dev/null | grep -E 'PM2 v[0-9.]+: God Daemon' | grep -v grep || true)"
NPM2="$(printf '%s' "$PM2D" | grep -c . || true)"; [ -n "$NPM2" ] || NPM2=0
if [ "$NPM2" -gt 1 ]; then
  ko "$NPM2 daemon PM2 attivi: rischio di doppia istanza sulla porta $PORT (EADDRINUSE)."
  printf '%s\n' "$PM2D" | sed 's/^/      /'
elif [ "$NPM2" -eq 1 ]; then
  U="$(printf '%s' "$PM2D" | awk '{print $2}')"
  if [ "$PANNELLO" = "aaPanel" ] && [ "$U" != "$APP_USER" ]; then
    ko "Il daemon PM2 e' di '$U', non di '$APP_USER': il pannello non lo vede e l'app gira come $U."
  else ok "Un solo daemon PM2 (utente $U)."; fi
else
  info "Nessun daemon PM2 (normale su cPanel/systemd)."
fi

DEL=""
for P in /proc/[0-9]*; do
  PID="${P#/proc/}"
  E="$(readlink "$P/exe" 2>/dev/null || true)"
  C="$(readlink "$P/cwd" 2>/dev/null || true)"
  case "$E$C" in *"(deleted)"*)
    case "$(cat "$P/comm" 2>/dev/null)" in node|bash|sh|PM2*|npm*) DEL="$DEL $PID";; esac ;;
  esac
done
if [ -n "$DEL" ]; then
  warn "Processi che girano da un eseguibile o una cartella cancellati (residui di un deploy):"
  for PID in $DEL; do ps -o pid=,user=,etime=,args= -p "$PID" 2>/dev/null | cut -c1-140 | sed 's/^/      /'; done
else ok "Nessun processo node/bash/PM2 che gira da file cancellati."; fi

# ------------------------------------------------------------
# Controlla un percorso usato da un job; $1 = provenienza, $2 = percorso
controlla_percorso() {
  local da="$1" p="$2"
  case "$p" in *'$'*|*'%'*) return 0;; esac   # variabili e specificatori systemd: non verificabili qui
  [ -e "$p" ] && return 0
  ko "$da → file inesistente: $p"
}

# Estrae da una riga di comando i percorsi assoluti degli eseguibili/script:
# il comando e, se e' un interprete (bash, node, python…), lo script che esegue.
# Salta le assegnazioni iniziali (VAR=valore), `env`, `nohup`, `exec` e le opzioni.
percorsi_comando() {
  # toglie le redirezioni (> file, >> file, 2>&1) e separa sui connettori di shell
  printf '%s\n' "$1" \
    | sed -E 's/[0-9]*>>?[[:space:]]*&?[^[:space:]]+//g; s/<[[:space:]]*[^[:space:]]+//g' \
    | tr ';|&()' '\n\n\n\n\n' \
    | while read -r -a W; do
        local i=0 n=${#W[@]} c b
        while [ "$i" -lt "$n" ]; do
          c="${W[$i]}"; c="${c#[-@:+!]}"; c="${c#[-@:+!]}"
          case "$c" in
            [A-Za-z_]*=*|env|*/env|nohup|*/nohup|exec|-*) i=$((i+1)); continue ;;
          esac
          break
        done
        [ "$i" -lt "$n" ] || continue
        case "$c" in /*) printf '%s\n' "$c";; esac
        case "${c##*/}" in
          bash|sh|node|python|python3|php|perl)
            i=$((i+1))
            while [ "$i" -lt "$n" ]; do
              b="${W[$i]}"
              case "$b" in -*) i=$((i+1)); continue;; /*) printf '%s\n' "$b";; esac
              break
            done ;;
        esac
      done
}

hr "2) systemd: unita' e timer"
KO_PRIMA_DEI_JOB=$N_KO
if [ "$HAS_SYSTEMD" = 1 ]; then
  FAILED="$(systemctl --failed --no-legend --plain 2>/dev/null | awk '{print $1}')"
  if [ -n "$FAILED" ]; then
    ko "Unita' in stato failed:"; printf '%s\n' "$FAILED" | sed 's/^/      /'
  else ok "Nessuna unita' in stato failed."; fi

  N_UNIT=0
  for F in /etc/systemd/system/*.service /etc/systemd/system/*.timer; do
    [ -f "$F" ] || continue
    [ -L "$F" ] && continue
    U="$(basename "$F")"; N_UNIT=$((N_UNIT+1))
    if [ "${U##*.}" = timer ]; then
      S="$(systemctl show -p Unit --value "$U" 2>/dev/null)"; [ -n "$S" ] || S="${U%.timer}.service"
      if ! systemctl cat "$S" >/dev/null 2>&1; then ko "$U attiva $S, che non esiste."; continue; fi
      EN="$(systemctl is-enabled "$U" 2>/dev/null || true)"
      R="$(systemctl show -p Result --value "$S" 2>/dev/null)"
      ST="$(systemctl show -p ExecMainStatus --value "$S" 2>/dev/null)"
      LAST="$(systemctl show -p LastTriggerUSec --value "$U" 2>/dev/null)"
      if [ -n "$R" ] && [ "$R" != success ]; then
        ko "$U ($EN): l'ultima esecuzione di $S e' fallita (Result=$R, exit=$ST, ultima: ${LAST:-mai})."
      else ok "$U ($EN) → $S, ultima: ${LAST:-mai}"; fi
      continue
    fi
    # .service: percorsi di Exec*, WorkingDirectory, EnvironmentFile (unita' + drop-in)
    while IFS= read -r L; do
      K="${L%%=*}"; V="${L#*=}"
      case "$K" in
        ExecStart|ExecStartPre|ExecStartPost|ExecStop|ExecStopPost|ExecReload)
          for P in $(percorsi_comando "$V"); do controlla_percorso "$U ($K)" "$P"; done ;;
        WorkingDirectory) V="${V#-}"; case "$V" in /*) controlla_percorso "$U (WorkingDirectory)" "$V";; esac ;;
        EnvironmentFile) case "$V" in -*) ;; /*) controlla_percorso "$U (EnvironmentFile)" "$V";; esac ;;
      esac
    done < <(systemctl cat "$U" 2>/dev/null | grep -E '^(Exec[A-Za-z]*|WorkingDirectory|EnvironmentFile)=')
  done
  info "unita' personalizzate esaminate in /etc/systemd/system: $N_UNIT"
  for L in $(find /etc/systemd/system -maxdepth 2 -xtype l 2>/dev/null); do
    ko "Collegamento rotto in systemd: $L → $(readlink "$L")"
  done
else
  info "systemd non disponibile: sezione saltata."
fi

# ------------------------------------------------------------
hr "3) cron"
N_CRON=0
cron_righe() {   # $1 = provenienza, $2 = 1 se il formato ha il campo utente
  local da="$1" conutente="$2" riga cmd
  while IFS= read -r riga; do
    case "$riga" in ''|'#'*) continue;; esac
    printf '%s' "$riga" | grep -qE '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=' && continue
    if printf '%s' "$riga" | grep -qE '^[[:space:]]*@'; then
      cmd="$(printf '%s' "$riga" | awk -v u="$conutente" '{ $1=""; if (u==1) $2=""; print }')"
    else
      cmd="$(printf '%s' "$riga" | awk -v u="$conutente" '{ for(i=1;i<=5+u;i++) $i=""; print }')"
    fi
    N_CRON=$((N_CRON+1))
    for P in $(percorsi_comando "$cmd"); do
      controlla_percorso "cron $da" "$P"
      [ -f "$P" ] && SCRIPT_DA_CRON="$SCRIPT_DA_CRON $P"
    done
  done
}
SCRIPT_DA_CRON=""
[ -f /etc/crontab ] && cron_righe /etc/crontab 1 < /etc/crontab
for F in /etc/cron.d/*; do [ -f "$F" ] && cron_righe "$F" 1 < "$F"; done
for U in root "$APP_USER" postgres www pgs; do
  id "$U" >/dev/null 2>&1 || continue
  case " ${VISTI:-} " in *" $U "*) continue;; esac; VISTI="${VISTI:-} $U"
  T="$(crontab -l -u "$U" 2>/dev/null || true)"
  [ -n "$T" ] && cron_righe "crontab di $U" 0 <<< "$T"
done
for D in /etc/cron.hourly /etc/cron.daily /etc/cron.weekly /etc/cron.monthly; do
  for F in "$D"/*; do [ -f "$F" ] && SCRIPT_DA_CRON="$SCRIPT_DA_CRON $F"; done
done
info "righe di cron esaminate: $N_CRON"
[ "$N_KO" -eq "$KO_PRIMA_DEI_JOB" ] && ok "Nessuna riga di cron o unita' systemd punta a file inesistenti."

# ------------------------------------------------------------
hr "4) Script: troncati, rovinati, copie divergenti"
esamina_script() {   # $1 = file
  local f="$1" prima
  [ -f "$f" ] || return 0
  if [ ! -s "$f" ]; then ko "$f: file VUOTO."; return 0; fi
  if grep -qaP '\x00' "$f" 2>/dev/null; then ko "$f: contiene byte NUL (scrittura interrotta o file corrotto)."; return 0; fi
  prima="$(head -c 2 "$f")"
  # file binari (eseguibili) non sono script: si salta il resto
  if ! grep -qaI . "$f" 2>/dev/null; then return 0; fi
  if grep -q $'\r' "$f" 2>/dev/null; then ko "$f: fine riga CRLF (bad interpreter: /bin/bash^M)."; fi
  if [ "$prima" != '#!' ]; then
    case "$f" in *.sh) warn "$f: manca la riga #! iniziale.";; esac
  fi
  if head -1 "$f" | grep -qE 'bash|/sh' || case "$f" in *.sh) true;; *) false;; esac; then
    local errf; errf="$(mktemp)"
    if ! bash -n "$f" 2>"$errf"; then
      ko "$f: errore di sintassi — spesso un file TRONCATO: $(head -1 "$errf" | cut -c1-120)"
    fi
    rm -f "$errf"
  fi
  [ -n "$(tail -c 1 "$f")" ] && warn "$f: l'ultima riga non termina con a capo (possibile troncamento)."
  return 0
}

ELENCO=""
[ -d /root/pgs-operativo ] && for F in /root/pgs-operativo/*; do [ -f "$F" ] && ELENCO="$ELENCO $F"; done
[ -n "$APP_DIR" ] && for F in "$APP_DIR"/*.sh; do [ -f "$F" ] && ELENCO="$ELENCO $F"; done
for F in /usr/local/bin/pgs*; do [ -e "$F" ] && ELENCO="$ELENCO $(readlink -f "$F" 2>/dev/null || echo "$F")"; done
ELENCO="$ELENCO $SCRIPT_DA_CRON"
N_SCR=0
for F in $(printf '%s\n' $ELENCO | sort -u); do N_SCR=$((N_SCR+1)); esamina_script "$F"; done
info "script esaminati: $N_SCR"

for L in $(find /usr/local/bin /root/pgs-operativo -maxdepth 1 -xtype l 2>/dev/null); do
  ko "Collegamento rotto: $L → $(readlink "$L")"
done

# Copie di root (/root/pgs-operativo) rispetto alla versione dell'applicazione
if [ -d /root/pgs-operativo ] && [ -n "$APP_DIR" ]; then
  for F in /root/pgs-operativo/*.sh; do
    [ -f "$F" ] || continue
    B="$(basename "$F")"
    if git --no-optional-locks -C "$APP_DIR" -c safe.directory="$APP_DIR" ls-files --error-unmatch "$B" >/dev/null 2>&1; then
      H_REPO="$(git --no-optional-locks -C "$APP_DIR" -c safe.directory="$APP_DIR" show "HEAD:$B" 2>/dev/null | sha256sum | cut -c1-12)"
      H_COPIA="$(sha256sum < "$F" | cut -c1-12)"
      if [ "$H_REPO" != "$H_COPIA" ]; then
        warn "$F diverge dalla versione nel repository ($H_COPIA ≠ $H_REPO): riallineare con install -o root -g root -m 700 $APP_DIR/$B $F"
      else ok "$B: copia di root identica al repository."; fi
    elif [ -f "$APP_DIR/$B" ] && ! cmp -s "$F" "$APP_DIR/$B"; then
      warn "$B: la copia in /root/pgs-operativo e quella nella cartella dell'app sono diverse (quale e' quella giusta?)."
    fi
  done
fi

# ------------------------------------------------------------
hr "5) Residui noti di PGS"
# 5a. Controllo aggiornamenti, rimosso nella 26.10.19.1
R=0
if [ "$HAS_SYSTEMD" = 1 ] && systemctl cat pgs-update-check.timer >/dev/null 2>&1; then
  ko "Timer pgs-update-check ancora installato (funzione rimossa nella 26.10.19.1)."; R=1; fi
for F in /etc/systemd/system/pgs-update-check.service /etc/systemd/system/pgs-update-check.timer /var/lib/pgs/update-status.json; do
  [ -e "$F" ] && { ko "Residuo del controllo aggiornamenti: $F"; R=1; }
done
[ -n "$APP_DIR" ] && [ -e "$APP_DIR/pgs-update-check.sh" ] && { warn "Residuo: $APP_DIR/pgs-update-check.sh"; R=1; }
if [ -n "$APP_DIR" ] && [ -f "$APP_DIR/.env" ]; then
  C="$(grep -c '^UPDATE_STATUS_FILE=' "$APP_DIR/.env" 2>/dev/null || true)"; [ -n "$C" ] || C=0
  [ "$C" -gt 0 ] && { warn "UPDATE_STATUS_FILE ancora nel .env (innocua, da togliere)."; R=1; }
fi
[ "$R" = 0 ] && ok "Nessun residuo del controllo aggiornamenti."

# 5b. PM2 (aaPanel): avvio di root, elenco salvato con percorsi inesistenti
if [ "$PANNELLO" = "aaPanel" ]; then
  if [ "$HAS_SYSTEMD" = 1 ] && systemctl cat pm2-root.service >/dev/null 2>&1; then
    ko "pm2-root.service presente: al riavvio farebbe rinascere l'app nel PM2 di root."
  else ok "Nessun pm2-root.service."; fi
  for H in "/home/$APP_USER/.pm2" /root/.pm2; do
    DUMP="$H/dump.pm2"; [ -f "$DUMP" ] || continue
    if [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ]; then
      "$NODE_BIN" -e '
        const fs=require("fs"); let d=[];
        try { d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")) } catch(e){ console.log("KO|dump illeggibile: "+e.message); process.exit(0) }
        if (!Array.isArray(d) || d.length===0) { console.log("INFO|vuoto"); process.exit(0) }
        for (const p of d) {
          const n=p.name||"?";
          for (const k of ["pm_exec_path","pm_cwd"]) if (p[k] && !fs.existsSync(p[k])) console.log("KO|"+n+": "+k+" inesistente: "+p[k]);
          console.log("INFO|"+n+" ("+(p.pm_exec_path||"?")+")");
        }' "$DUMP" 2>/dev/null | while IFS='|' read -r T M; do
          case "$T" in KO) printf '  ✘ %s: %s\n' "$DUMP" "$M";; *) printf '    %s: %s\n' "$DUMP" "$M";; esac
        done
      # il ciclo gira in una subshell: i ✘ qui sopra non entrano nel conteggio
      if "$NODE_BIN" -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.exit(d.some(p=>["pm_exec_path","pm_cwd"].some(k=>p[k]&&!fs.existsSync(p[k])))?1:0)' "$DUMP" 2>/dev/null; then :; else N_KO=$((N_KO+1)); fi
      if [ "$H" = /root/.pm2 ] && [ "$(stat -c %s "$DUMP" 2>/dev/null || echo 0)" -gt 10 ]; then
        warn "Il PM2 di root ha un elenco salvato non vuoto ($DUMP): l'unico PM2 legittimo e' quello di $APP_USER."
      fi
    fi
  done
fi

# 5c. Dump del database lasciati in giro (contengono dati personali)
DUMPS="$(find /root /tmp /var/tmp ${APP_DIR:+"$APP_DIR"} -maxdepth 2 -type f \( -name '*.dump' -o -name '*.sql.gz' -o -name 'pgs_*.sql' \) 2>/dev/null)"
if [ -n "$DUMPS" ]; then
  warn "Dump del database presenti (dati personali: shred -u quando non servono piu'):"
  for F in $DUMPS; do info "  $(stat -c '%A %U %s byte %y' "$F" 2>/dev/null | cut -c1-60)  $F"; done
else ok "Nessun dump del database in /root, /tmp, /var/tmp o nella cartella dell'app."; fi
[ -n "$APP_DIR" ] && for F in "$APP_DIR"/.env.bak*; do [ -e "$F" ] && warn "Copia del .env con segreti: $F (shred -u se non serve)"; done

# 5d. Albero di lavoro: modifiche ai file tracciati bloccano il deploy
if [ -n "$APP_DIR" ]; then
  SP="$(git --no-optional-locks -C "$APP_DIR" -c safe.directory="$APP_DIR" status --porcelain --untracked-files=no 2>/dev/null)"
  if [ -n "$SP" ]; then
    warn "File tracciati modificati sul server (il prossimo deploy si fermera'):"
    printf '%s\n' "$SP" | sed 's/^/      /'
  else ok "Albero di lavoro pulito (file tracciati)."; fi
fi

# ------------------------------------------------------------
hr "Riepilogo"
printf '  ✘ problemi: %s   ! avvisi: %s\n' "$N_KO" "$N_WARN"
printf '  Nulla e'"'"' stato modificato: lo script e'"'"' di sola lettura.\n'
[ "$N_KO" -eq 0 ]
