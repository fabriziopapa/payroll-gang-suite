#!/usr/bin/env bash
# ============================================================
# PAYROLL GANG SUITE — Controllo aggiornamenti (sola lettura)
#
# Confronta il commit installato con quello sul remoto e scrive un file di
# stato che l'applicazione legge per mostrare l'avviso agli amministratori.
#
# NON aggiorna nulla: fa `git fetch`, che scarica i riferimenti senza toccare
# l'albero di lavoro. L'aggiornamento vero resta `pgs-update`, da terminale.
#
# USO:
#     bash pgs-update-check.sh              # esegue un controllo
#     bash pgs-update-check.sh --install    # installa timer systemd (ogni 6h)
#     bash pgs-update-check.sh --uninstall  # rimuove timer e file di stato
#
# ⚠ NON incollare questo file nel terminale: contiene `exit`. Trasferirlo con
#   `git pull` ed eseguirlo con `bash`.
#
# Variabili d'ambiente:
#   PGS_USER          utente proprietario del repository   (default: pgs)
#   PGS_APP_DIR       radice del monorepo
#   PGS_STATUS_FILE   file di stato  (default: /var/lib/pgs/update-status.json)
#   PGS_BRANCH        ramo da confrontare                  (default: main)
# ============================================================

set -Eeuo pipefail

PGS_USER="${PGS_USER:-pgs}"
PGS_APP_DIR="${PGS_APP_DIR:-/home/${PGS_USER}/apps/payroll-gang-suite}"
PGS_STATUS_FILE="${PGS_STATUS_FILE:-/var/lib/pgs/update-status.json}"
PGS_BRANCH="${PGS_BRANCH:-main}"

UNIT_SERVICE=/etc/systemd/system/pgs-update-check.service
UNIT_TIMER=/etc/systemd/system/pgs-update-check.timer

muori() { printf '✗ %s\n' "$1" >&2; exit "${2:-1}"; }

come_pgs() { sudo -H -u "$PGS_USER" "$@"; }

# ------------------------------------------------------------
# --install / --uninstall
# ------------------------------------------------------------
installa_timer() {
  [[ $EUID -eq 0 ]] || muori "L'installazione del timer richiede root."

  cat > "$UNIT_SERVICE" <<EOF
[Unit]
Description=PGS - controllo disponibilita aggiornamenti (sola lettura)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment=PGS_USER=$PGS_USER
Environment=PGS_APP_DIR=$PGS_APP_DIR
Environment=PGS_STATUS_FILE=$PGS_STATUS_FILE
Environment=PGS_BRANCH=$PGS_BRANCH
ExecStart=/bin/bash $PGS_APP_DIR/pgs-update-check.sh
EOF

  cat > "$UNIT_TIMER" <<'EOF'
[Unit]
Description=PGS - controllo aggiornamenti ogni 6 ore

[Timer]
OnBootSec=10min
OnUnitActiveSec=6h
# Sfasa l'esecuzione fino a 30 minuti: piu' server dello stesso proprietario
# non interrogano GitHub tutti nello stesso istante.
RandomizedDelaySec=30min
Persistent=true

[Install]
WantedBy=timers.target
EOF

  systemctl daemon-reload
  systemctl enable --now pgs-update-check.timer
  printf '✓ Timer installato. Prossima esecuzione:\n'
  systemctl list-timers pgs-update-check.timer --no-pager | sed -n '1,2p'
  printf '\nEseguo subito un primo controllo…\n\n'
}

disinstalla_timer() {
  [[ $EUID -eq 0 ]] || muori "La rimozione del timer richiede root."
  systemctl disable --now pgs-update-check.timer 2>/dev/null || true
  rm -f "$UNIT_TIMER" "$UNIT_SERVICE" "$PGS_STATUS_FILE"
  systemctl daemon-reload
  printf '✓ Timer e file di stato rimossi. Il pannello mostrera "non configurato".\n'
  exit 0
}

case "${1:-}" in
  --install)   installa_timer ;;
  --uninstall) disinstalla_timer ;;
  '')          ;;
  *)           muori "Argomento non riconosciuto: $1 (usa --install o --uninstall)" ;;
esac

# ------------------------------------------------------------
# Controllo
# ------------------------------------------------------------
[[ -d "$PGS_APP_DIR/.git" ]] || muori "'$PGS_APP_DIR' non è un repository git."
command -v node >/dev/null 2>&1 || muori "node non trovato: serve per generare il file di stato."

# `git fetch` aggiorna solo i riferimenti remoti: non tocca l'albero di lavoro,
# non cambia il commit installato, non compila niente.
if ! come_pgs git -C "$PGS_APP_DIR" fetch --quiet origin "$PGS_BRANCH" 2>/dev/null; then
  ERRORE="Impossibile contattare il remoto (rete o credenziali git)."
else
  ERRORE=''
fi

LOCALE=$(come_pgs git -C "$PGS_APP_DIR" rev-parse HEAD)
REMOTO=$(come_pgs git -C "$PGS_APP_DIR" rev-parse "origin/$PGS_BRANCH" 2>/dev/null || echo "$LOCALE")
MANCANTI=$(come_pgs git -C "$PGS_APP_DIR" rev-list --count "HEAD..origin/$PGS_BRANCH" 2>/dev/null || echo 0)

VER_LOCALE=$(come_pgs node -p "require('$PGS_APP_DIR/package.json').version" 2>/dev/null || echo '')
VER_REMOTA=$(come_pgs git -C "$PGS_APP_DIR" show "origin/$PGS_BRANCH:package.json" 2>/dev/null \
             | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(JSON.parse(d).version??"")}catch{process.stdout.write("")}})' \
             || echo '')

# Elenco dei commit mancanti, al massimo 20. Separatore \x1f: non può comparire
# in un messaggio di commit, quindi il parsing non si rompe con apici o accenti.
ELENCO=$(come_pgs git -C "$PGS_APP_DIR" log --max-count=20 \
           --format='%H%x1f%s%x1f%cI' "HEAD..origin/$PGS_BRANCH" 2>/dev/null || true)

# Il JSON lo costruisce node: l'escaping di virgolette, accenti e a capi nei
# messaggi di commit non è un problema da risolvere con printf.
install -d -m 755 "$(dirname "$PGS_STATUS_FILE")"
TMP=$(mktemp "${PGS_STATUS_FILE}.XXXXXX")

ELENCO="$ELENCO" ERRORE="$ERRORE" \
LOCALE="$LOCALE" REMOTO="$REMOTO" MANCANTI="$MANCANTI" \
VER_LOCALE="$VER_LOCALE" VER_REMOTA="$VER_REMOTA" BRANCH="$PGS_BRANCH" \
node -e '
const e = process.env
const commits = (e.ELENCO || "").split("\n").filter(Boolean).map(r => {
  const [hash, messaggio, data] = r.split("\u001f")
  return { hash, messaggio, data }
})
const out = {
  versione:            1,
  ultimoControllo:     new Date().toISOString(),
  ramo:                e.BRANCH,
  commitInstallato:    e.LOCALE,
  commitDisponibile:   e.REMOTO,
  versioneInstallata:  e.VER_LOCALE || null,
  versioneDisponibile: e.VER_REMOTA || null,
  commitMancanti:      Number(e.MANCANTI) || 0,
  commits,
  errore:              e.ERRORE || null,
}
process.stdout.write(JSON.stringify(out, null, 2) + "\n")
' > "$TMP"

# Leggibile dall'utente applicativo, scrivibile solo da root.
chown "root:$PGS_USER" "$TMP" 2>/dev/null || chown ":$PGS_USER" "$TMP" 2>/dev/null || true
chmod 640 "$TMP"
mv -f "$TMP" "$PGS_STATUS_FILE"      # sostituzione atomica: l'app non legge mai un file a metà

if [[ -n "$ERRORE" ]]; then
  printf '! %s\n' "$ERRORE"
  printf '  Stato scritto comunque in %s (con il campo "errore" valorizzato).\n' "$PGS_STATUS_FILE"
  exit 0
fi

if [[ "$MANCANTI" -gt 0 ]]; then
  printf '● Aggiornamento disponibile: %s commit (%s → %s)\n' \
    "$MANCANTI" "${LOCALE:0:8}" "${REMOTO:0:8}"
  printf '  Per aggiornare:  pgs-update\n'
else
  printf '✓ Già aggiornato (%s)\n' "${LOCALE:0:8}"
fi
printf '  Stato: %s\n' "$PGS_STATUS_FILE"
