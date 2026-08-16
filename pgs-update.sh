#!/usr/bin/env bash
# ============================================================
# PAYROLL GANG SUITE — Aggiornamento su server cPanel/WHM
#
# Un solo comando per: git pull → npm ci (se serve) → build FE+BE →
# pubblicazione del client nella docroot → riavvio → verifica.
#
# USO (da root, via SSH o WHM → Terminal):
#     bash /home/pgs/apps/payroll-gang-suite/pgs-update.sh
#
# ⚠ NON incollare il contenuto di questo file nel terminale: la shell
#   eseguirebbe le righe una per una. Trasferirlo con `git pull` ed
#   eseguirlo con `bash`.
#
# Variabili d'ambiente riconosciute:
#   PGS_USER            utente di sistema           (default: pgs)
#   PGS_APP_DIR         radice del monorepo         (default: /home/<user>/apps/payroll-gang-suite)
#   PGS_DOCROOT         document root del dominio   (default: /home/<user>/public_html)
#   PGS_SERVICE         unità systemd               (default: pgs)
#   PGS_PORT            porta dell'applicazione     (default: 3001)
#   PGS_FORCE=1         ricompila anche senza nuovi commit
#   PGS_SKIP_PULL=1     non fa git pull (compila l'albero di lavoro attuale)
#   PGS_ALLOW_SCHEMA=1  procede anche se setup.sql è cambiato
#   PGS_KEEP_BACKUPS    quanti backup della docroot conservare (default: 3)
#
# Uscita 0 = aggiornamento completato e applicazione che risponde.
# Qualsiasi altro codice = nulla di irreversibile è stato fatto, oppure
# il messaggio finale indica come tornare indietro.
# ============================================================

set -Eeuo pipefail

# ------------------------------------------------------------
# Configurazione
# ------------------------------------------------------------
PGS_USER="${PGS_USER:-pgs}"
PGS_APP_DIR="${PGS_APP_DIR:-/home/${PGS_USER}/apps/payroll-gang-suite}"
PGS_DOCROOT="${PGS_DOCROOT:-/home/${PGS_USER}/public_html}"
PGS_SERVICE="${PGS_SERVICE:-pgs}"
PGS_PORT="${PGS_PORT:-3001}"
PGS_KEEP_BACKUPS="${PGS_KEEP_BACKUPS:-3}"
BACKUP_DIR="/home/${PGS_USER}/.pgs-docroot-backup"

# File della docroot che NON appartengono al build e non vanno mai cancellati:
#   .htaccess    → CSP, header di sicurezza, fallback SPA
#   .well-known  → validazione AutoSSL (senza, i certificati non si rinnovano)
#   .user.ini    → residuo aaPanel, immutabile su alcune installazioni
RSYNC_EXCLUDES=(--exclude '.htaccess' --exclude '.well-known' --exclude '.user.ini')

# ------------------------------------------------------------
# Output
# ------------------------------------------------------------
if [[ -t 1 ]]; then
  B=$'\033[1m'; R=$'\033[0;31m'; G=$'\033[0;32m'; Y=$'\033[0;33m'; N=$'\033[0m'
else
  B=''; R=''; G=''; Y=''; N=''
fi

FASE=0
fase()  { FASE=$((FASE + 1)); printf '\n%s[%d/8] %s%s\n' "$B" "$FASE" "$1" "$N"; }
ok()    { printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
info()  { printf '    %s\n' "$1"; }
warn()  { printf '  %s!%s %s\n' "$Y" "$N" "$1"; }
muori() { printf '\n%s✗ %s%s\n\n' "$R" "$1" "$N" >&2; exit "${2:-1}"; }

trap 'muori "Interrotto alla fase $FASE (riga $LINENO). L'\''applicazione potrebbe essere rimasta alla versione precedente: controlla con systemctl status '"$PGS_SERVICE"'." 2' ERR

# Esegue un comando come utente non privilegiato.
# sudo esegue il comando indicato, NON la shell di login: la jailshell di
# cPanel non entra in gioco.
come_pgs() { sudo -H -u "$PGS_USER" "$@"; }

# ------------------------------------------------------------
fase "Controlli preliminari"
# ------------------------------------------------------------
[[ $EUID -eq 0 ]] || muori "Va eseguito come root (serve systemctl). Usa: sudo bash $0"

id -u "$PGS_USER" >/dev/null 2>&1 || muori "L'utente '$PGS_USER' non esiste."
[[ -d "$PGS_APP_DIR/.git" ]]      || muori "'$PGS_APP_DIR' non è un repository git. Imposta PGS_APP_DIR."
[[ -f "$PGS_APP_DIR/.env" ]]      || muori "Manca '$PGS_APP_DIR/.env': l'applicazione non partirebbe."
[[ -d "$PGS_DOCROOT" ]]           || muori "Document root '$PGS_DOCROOT' inesistente. Imposta PGS_DOCROOT."

systemctl cat "$PGS_SERVICE" >/dev/null 2>&1 \
  || muori "Unità systemd '$PGS_SERVICE' non trovata. Imposta PGS_SERVICE."

for cmd in git npm rsync curl tar; do
  command -v "$cmd" >/dev/null 2>&1 || muori "Comando richiesto non trovato: $cmd"
done

# La docroot deve appartenere all'utente: se contiene file di root, Apache
# (mod_ruid2, che serve il dominio come '$PGS_USER') risponderebbe 403.
ESTRANEI=$(find "$PGS_DOCROOT" ! -user "$PGS_USER" -print -quit 2>/dev/null || true)
[[ -z "$ESTRANEI" ]] || warn "In docroot ci sono file non di '$PGS_USER' (es. $ESTRANEI) — verranno riallineati."

VERSIONE_PRIMA=$(come_pgs node -p "require('$PGS_APP_DIR/package.json').version" 2>/dev/null || echo '?')
COMMIT_PRIMA=$(come_pgs git -C "$PGS_APP_DIR" rev-parse HEAD)
ok "Applicazione: $PGS_APP_DIR (v$VERSIONE_PRIMA, ${COMMIT_PRIMA:0:8})"
ok "Docroot: $PGS_DOCROOT · servizio: $PGS_SERVICE · porta: $PGS_PORT"

# ------------------------------------------------------------
fase "Aggiornamento del codice"
# ------------------------------------------------------------
if [[ "${PGS_SKIP_PULL:-0}" == "1" ]]; then
  warn "PGS_SKIP_PULL=1 — salto il git pull, compilo l'albero attuale."
  COMMIT_DOPO="$COMMIT_PRIMA"
else
  SPORCO=$(come_pgs git -C "$PGS_APP_DIR" status --porcelain -- . ':!*.env' || true)
  if [[ -n "$SPORCO" ]]; then
    printf '%s\n' "$SPORCO" | sed 's/^/      /'
    muori "Ci sono modifiche locali non committate: il pull le sovrascriverebbe.
       Committale, oppure annullale con:
         sudo -H -u $PGS_USER git -C $PGS_APP_DIR checkout -- .
       oppure compila così com'è con PGS_SKIP_PULL=1."
  fi

  # --ff-only: se la storia è divergente il pull fallisce invece di creare
  # un commit di merge silenzioso sul server.
  come_pgs git -C "$PGS_APP_DIR" fetch --quiet origin
  come_pgs git -C "$PGS_APP_DIR" pull --ff-only --quiet origin \
    || muori "git pull non fast-forward: la copia sul server è divergente dal remoto.
       Ispeziona con: sudo -H -u $PGS_USER git -C $PGS_APP_DIR log --oneline --graph -10"

  COMMIT_DOPO=$(come_pgs git -C "$PGS_APP_DIR" rev-parse HEAD)
fi

if [[ "$COMMIT_PRIMA" == "$COMMIT_DOPO" && "${PGS_FORCE:-0}" != "1" ]]; then
  printf '\n%s✓ Già aggiornato (%s), nessuna ricompilazione necessaria.%s\n' \
    "$G" "${COMMIT_PRIMA:0:8}" "$N"
  info "Per ricompilare comunque: PGS_FORCE=1 bash $0"
  exit 0
fi

if [[ "$COMMIT_PRIMA" != "$COMMIT_DOPO" ]]; then
  ok "Aggiornato a ${COMMIT_DOPO:0:8}:"
  come_pgs git -C "$PGS_APP_DIR" log --oneline "$COMMIT_PRIMA..$COMMIT_DOPO" | sed 's/^/      /'
else
  ok "Nessun nuovo commit, ricompilazione forzata (PGS_FORCE=1)."
fi

CAMBIATI=$(come_pgs git -C "$PGS_APP_DIR" diff --name-only "$COMMIT_PRIMA" "$COMMIT_DOPO" || true)

# ------------------------------------------------------------
fase "Verifica delle modifiche allo schema del database"
# ------------------------------------------------------------
# Lo schema NON viene applicato da questo script: applicarlo in automatico
# significherebbe modificare dati reali senza che nessuno guardi.
if grep -q '^server/sql/' <<<"$CAMBIATI"; then
  if [[ "${PGS_ALLOW_SCHEMA:-0}" != "1" ]]; then
    muori "server/sql/setup.sql è cambiato: questo aggiornamento tocca lo schema.
       Fai prima un backup del database, applica lo schema a mano, poi rilancia con:
         PGS_ALLOW_SCHEMA=1 bash $0"
  fi
  warn "setup.sql modificato — proseguo su tua richiesta (PGS_ALLOW_SCHEMA=1)."
else
  ok "Nessuna modifica a server/sql/ — nessuna migrazione da applicare."
fi

# ------------------------------------------------------------
fase "Dipendenze npm"
# ------------------------------------------------------------
# npm ci è lento (cancella e reinstalla node_modules): si esegue solo se il
# lockfile è cambiato o se le dipendenze non ci sono.
if grep -q '^package-lock\.json$' <<<"$CAMBIATI" \
   || [[ ! -d "$PGS_APP_DIR/node_modules" ]] \
   || [[ "${PGS_FORCE:-0}" == "1" && ! -d "$PGS_APP_DIR/node_modules" ]]; then
  info "Lockfile modificato o node_modules assente: reinstallo."
  come_pgs sh -c "cd '$PGS_APP_DIR' && npm ci --no-audit --no-fund" \
    || muori "npm ci fallito. Il codice è già aggiornato ma non compilato."
  ok "Dipendenze reinstallate."
else
  ok "Lockfile invariato: nessuna reinstallazione."
fi

# ------------------------------------------------------------
fase "Compilazione backend e frontend"
# ------------------------------------------------------------
# Entrambe come utente '$PGS_USER': da root si lascerebbero file di root
# dentro .git e node_modules (poi 'git pull' fallisce con "index file open
# failed") e gli script postinstall di argon2/esbuild girerebbero da root.
#
# Il client legge le VITE_* dal .env della radice del monorepo (envDir: '../'):
# se hai cambiato una di quelle variabili, il valore entra nel bundle SOLO
# ricompilando — cosa che questo passo fa comunque.
info "Backend (tsc)…"
come_pgs sh -c "cd '$PGS_APP_DIR' && npm run build:server" \
  || muori "Compilazione del backend fallita. L'applicazione gira ancora con la versione precedente."
ok "Backend compilato."

info "Frontend (vite)…"
come_pgs sh -c "cd '$PGS_APP_DIR' && npm run build:client" \
  || muori "Compilazione del frontend fallita. Backend già compilato ma non pubblicato:
       la docroot è ancora quella vecchia, il sito continua a funzionare."
ok "Frontend compilato."

DIST="$PGS_APP_DIR/client/dist"
[[ -s "$DIST/index.html" ]] || muori "'$DIST/index.html' assente o vuoto: build incompleta, non pubblico nulla."
NASSET=$(find "$DIST/assets" -type f 2>/dev/null | wc -l)
[[ "$NASSET" -gt 0 ]]       || muori "'$DIST/assets' è vuoto: build incompleta, non pubblico nulla."
ok "Build verificata: index.html + $NASSET asset."

# ------------------------------------------------------------
fase "Backup della docroot"
# ------------------------------------------------------------
install -d -o "$PGS_USER" -g "$PGS_USER" -m 700 "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVIO="$BACKUP_DIR/public_html-$STAMP.tar.gz"
tar -czf "$ARCHIVIO" -C "$PGS_DOCROOT" . 2>/dev/null
chown "$PGS_USER:$PGS_USER" "$ARCHIVIO"; chmod 600 "$ARCHIVIO"
ok "Salvata in $ARCHIVIO ($(du -h "$ARCHIVIO" | cut -f1))"

# Conserva solo gli ultimi N archivi.
mapfile -t VECCHI < <(ls -1t "$BACKUP_DIR"/public_html-*.tar.gz 2>/dev/null | tail -n +$((PGS_KEEP_BACKUPS + 1)) || true)
if [[ ${#VECCHI[@]} -gt 0 ]]; then
  rm -f "${VECCHI[@]}"
  info "Rimossi ${#VECCHI[@]} backup più vecchi (ne conservo $PGS_KEEP_BACKUPS)."
fi

# ------------------------------------------------------------
fase "Pubblicazione del client nella docroot"
# ------------------------------------------------------------
# --delete rimuove gli asset del build precedente (hanno nomi con hash: senza,
# la docroot cresce a ogni deploy). Gli --exclude sono quindi OBBLIGATORI:
# senza, sparirebbero .htaccess (CSP e fallback SPA) e .well-known (AutoSSL).
come_pgs rsync -a --delete "${RSYNC_EXCLUDES[@]}" "$DIST/" "$PGS_DOCROOT/" \
  || muori "rsync fallito. Ripristina con:
       sudo -H -u $PGS_USER tar -xzf $ARCHIVIO -C $PGS_DOCROOT"

[[ -e "$PGS_DOCROOT/.htaccess" ]] \
  || warn "'.htaccess' non è presente in docroot: senza, mancano CSP, header di sicurezza e fallback SPA."
chown -R "$PGS_USER:$PGS_USER" "$PGS_DOCROOT"
ok "Client pubblicato."

# ------------------------------------------------------------
fase "Riavvio e verifica"
# ------------------------------------------------------------
systemctl restart "$PGS_SERVICE"

# systemd marca il servizio 'active' appena il processo parte, ma Node impiega
# ~1,5 s a mettersi in ascolto: senza attesa la verifica fallirebbe sempre.
SALUTE=''
for _ in $(seq 1 20); do
  sleep 1
  SALUTE=$(curl -fsS --max-time 3 "http://127.0.0.1:${PGS_PORT}/health" 2>/dev/null || true)
  [[ -n "$SALUTE" ]] && break
done

if [[ -z "$SALUTE" ]]; then
  printf '\n%s✗ L'\''applicazione non risponde su 127.0.0.1:%s dopo 20 secondi.%s\n\n' "$R" "$PGS_PORT" "$N" >&2
  journalctl -u "$PGS_SERVICE" -n 30 --no-pager >&2
  cat >&2 <<FINE

Per tornare alla versione precedente:
  sudo -H -u $PGS_USER git -C $PGS_APP_DIR checkout $COMMIT_PRIMA
  sudo -H -u $PGS_USER sh -c "cd $PGS_APP_DIR && npm run build:server && npm run build:client"
  sudo -H -u $PGS_USER tar -xzf $ARCHIVIO -C $PGS_DOCROOT
  systemctl restart $PGS_SERVICE
FINE
  exit 1
fi
ok "Applicazione in ascolto: $SALUTE"

VERSIONE_DOPO=$(come_pgs node -p "require('$PGS_APP_DIR/package.json').version" 2>/dev/null || echo '?')

printf '\n%s✓ Aggiornamento completato%s — v%s → v%s (%s → %s)\n' \
  "$G" "$N" "$VERSIONE_PRIMA" "$VERSIONE_DOPO" "${COMMIT_PRIMA:0:8}" "${COMMIT_DOPO:0:8}"
printf '  Backup della docroot precedente: %s\n' "$ARCHIVIO"
printf '  Da browser, ricarica con Ctrl+Shift+R: gli asset hanno nomi con hash,\n'
printf '  ma index.html può restare in cache.\n\n'
