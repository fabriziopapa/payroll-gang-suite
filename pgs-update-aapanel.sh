#!/usr/bin/env bash
# ============================================================
# PAYROLL GANG SUITE — Aggiornamento su server aaPanel (PRODUZIONE)
#
# Un comando: git sync → build FE+BE → permessi www → riavvio PM2
# COME UTENTE www → verifica /health.
#
# ⚠ NON usa MAI `pm2` da root: aaPanel gestisce il progetto col PM2 di
#   `www`; un pm2 da root crea un secondo daemon → due processi litigano
#   sulla porta → loop EADDRINUSE → 502 (incidente 2026-08-17). Qui il
#   riavvio passa da `runuser -u www` sul PM2_HOME di aaPanel.
#
# ⚠ Divergenza git: se la storia remota è stata riscritta (force-push,
#   es. pulizia coautore) il `pull --ff-only` fallisce. Lo script fa un
#   BACKUP (git bundle in /tmp) e poi `reset --hard origin/<ramo>`, così
#   il deploy prosegue da solo. I deploy normali restano fast-forward.
#
# USO (da root, via SSH):
#   bash pgs-update-aapanel.sh
#   PGS_FORCE=1 bash pgs-update-aapanel.sh        # (ricompila comunque)
#   PGS_SKIP_PULL=1 bash pgs-update-aapanel.sh     # non aggiorna il codice
#
# Variabili: PGS_APP_DIR (/www/wwwroot/payroll-gang-suite) · PGS_USER (www)
#            PGS_PORT (3001) · PGS_PM2_HOME (/home/<user>/.pm2)
# ============================================================
set -Eeuo pipefail

APP_DIR="${PGS_APP_DIR:-/www/wwwroot/payroll-gang-suite}"
RUN_USER="${PGS_USER:-www}"
PORT="${PGS_PORT:-3001}"
PM2_HOME_DIR="${PGS_PM2_HOME:-/home/$RUN_USER/.pm2}"

die(){ echo "ERRORE: $*" >&2; exit 2; }
info(){ echo "  $*"; }
[ "$(id -u)" = 0 ] || die "esegui come root (serve chown + runuser)."
trap 'echo "" >&2; echo "INTERROTTO (riga $LINENO): l'\''app può essere rimasta alla versione precedente. Se serve, riavvia dall'\''UI aaPanel." >&2' ERR

command -v git  >/dev/null || die "git non trovato."
command -v node >/dev/null || die "node non trovato."
[ -d "$APP_DIR/.git" ] || die "repository non trovato in $APP_DIR."
GIT(){ git -C "$APP_DIR" -c safe.directory="$APP_DIR" "$@"; }

# PM2 binario reale (evita il symlink) + esecuzione come www sul daemon di aaPanel
PM2_BIN="$(ls -1 /www/server/nodejs/*/bin/pm2 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$PM2_BIN" ] || PM2_BIN="$(command -v pm2 || true)"
pm2_www(){ runuser -u "$RUN_USER" -- env PM2_HOME="$PM2_HOME_DIR" "$PM2_BIN" "$@"; }

echo "== [1/6] Stato =="
VER_PRIMA="$(node -p "require('$APP_DIR/package.json').version" 2>/dev/null || echo '?')"
COMMIT_PRIMA="$(GIT rev-parse --short HEAD 2>/dev/null || echo '?')"
info "App: $APP_DIR (v$VER_PRIMA, $COMMIT_PRIMA) · utente: $RUN_USER · porta: $PORT"
[ -n "$PM2_BIN" ] && info "PM2: $PM2_BIN (PM2_HOME=$PM2_HOME_DIR)" || info "PM2: non trovato — riavvio manuale da UI aaPanel"

echo "== [2/6] Aggiornamento del codice =="
if [ "${PGS_SKIP_PULL:-0}" = 1 ]; then
  info "PGS_SKIP_PULL=1 — compilo l'albero attuale."
else
  # solo file TRACCIATI modificati: i non tracciati (.user.ini, backups/, zip) non ostacolano il pull
  SPORCO="$(GIT status --porcelain --untracked-files=no -- . ':!*.env' 2>/dev/null || true)"
  [ -z "$SPORCO" ] || { printf '%s\n' "$SPORCO" | sed 's/^/    /'; die "modifiche locali non committate: annullale (git checkout -- .) o usa PGS_SKIP_PULL=1."; }
  GIT fetch --quiet origin
  RAMO="$(GIT rev-parse --abbrev-ref HEAD)"
  if GIT pull --ff-only --quiet origin; then
    info "aggiornato in fast-forward ($RAMO)."
  else
    info "storia remota riscritta (force-push): backup in /tmp e allineamento forzato a origin/$RAMO…"
    GIT bundle create "/tmp/pgs-pre-reset-$(date +%Y%m%d-%H%M%S).bundle" --all || true
    GIT reset --hard "origin/$RAMO"
  fi
fi
info "ora su: $(GIT rev-parse --short HEAD) · v$(node -p "require('$APP_DIR/package.json').version" 2>/dev/null || echo '?')"

echo "== [3/6] Sicurezza ecosystem.config.cjs =="
# trappola nota: un 'cwd' segnaposto manda PM2 in 'Script not found'
sed -ri "s#^([[:space:]]*cwd:).*#\1              __dirname,#" "$APP_DIR/ecosystem.config.cjs" 2>/dev/null || true

echo "== [4/6] Dipendenze + build (backend e client) =="
( cd "$APP_DIR" && npm install --no-audit --no-fund && npm run build:server && npm run build:client ) \
  || die "build fallita: NON riavvio (il sito resta sulla versione precedente)."

echo "== [5/6] Permessi utente $RUN_USER =="
# gli errori su .user.ini (immutabili in aaPanel) sono attesi e innocui
chown -R "$RUN_USER:$RUN_USER" "$APP_DIR" 2>/dev/null || true

echo "== [6/6] Riavvio come $RUN_USER (mai root) + verifica /health =="
RESTARTED=0
if [ -n "$PM2_BIN" ]; then
  if pm2_www startOrRestart "$APP_DIR/ecosystem.config.cjs" --env production --update-env >/dev/null 2>&1; then
    pm2_www save >/dev/null 2>&1 || true
    RESTARTED=1
    info "PM2 ($RUN_USER) avviato/riavviato."
  fi
fi
[ "$RESTARTED" = 1 ] || echo "  ATTENZIONE: riavvio automatico non riuscito → riavvia dall'UI aaPanel (Progetto Node.js → payroll_gang_suite → Riavvia)." >&2

OK=0
for _ in 1 2 3 4 5 6; do
  curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && { OK=1; break; }
  sleep 2
done
echo
if [ "$OK" = 1 ]; then
  echo "✓ FATTO — v$(node -p "require('$APP_DIR/package.json').version" 2>/dev/null) attiva. $(curl -s http://127.0.0.1:$PORT/health)"
  echo "  Ricarica il sito con Ctrl+Shift+R."
else
  echo "✗ L'app NON risponde su http://127.0.0.1:$PORT/health." >&2
  echo "  Log:    runuser -u $RUN_USER -- env PM2_HOME=$PM2_HOME_DIR $PM2_BIN logs --lines 40 --nostream" >&2
  echo "  Oppure riavvia dall'UI aaPanel. (Se EADDRINUSE: c'è un doppio processo — NON usare pm2 da root.)" >&2
  exit 1
fi
