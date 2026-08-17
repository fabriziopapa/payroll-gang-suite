#!/usr/bin/env bash
# ============================================================
# PAYROLL GANG SUITE — Blindatura dell'origine (SEC-A5)
#
# Accetta 80/443 in ingresso SOLO dai range IP di Cloudflare. Chiude il
# bypass della CDN (WAF, Turnstile-at-edge, rate limit di CF) e rende non
# falsificabile CF-Connecting-IP, su cui l'app basa audit e rate limiting.
#
# NON tocca MAI SSH nè le porte dei pannelli: agisce solo su 80/443.
#
# Ambienti (rilevati in automatico, sovrascrivibili con PGS_FW):
#   · cPanel / AlmaLinux-CloudLinux → csf
#   · aaPanel / Ubuntu             → ufw
#   · generico                     → firewalld
#   · nessuno dei tre              → genera un ruleset nftables + istruzioni
#
# USO (root):
#   bash pgs-cf-origin-lock.sh            # DRY-RUN (stampa il piano)
#   bash pgs-cf-origin-lock.sh --apply    # applica
#   PGS_FW=ufw bash pgs-cf-origin-lock.sh --apply
#   PGS_CF_FILE=/root/cf.txt bash pgs-cf-origin-lock.sh --apply   # range da file
#
# Rieseguibile e idempotente (marcatore 'pgs-cf-origin'). Rilancialo quando
# i range CF cambiano (anche via cron settimanale).
#
# FALLBACK PREVISTI:
#   · fetch CF fallito → prova API, poi cache locale, poi PGS_CF_FILE; se
#     nulla è disponibile ABORTISCE senza toccare il firewall.
#   · errore durante l'applicazione → trap ERR: avvisa e stampa il rollback.
#   · SSH sulla porta bersaglio → ABORTISCE prima di toccare qualsiasi cosa.
#   · firewall non riconosciuto → non forza nulla: scrive un ruleset nft.
# ============================================================
set -Eeuo pipefail

APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
PORTS_CSV="${PGS_HTTP_PORTS:-80,443}"
TAG="pgs-cf-origin"
CACHE_DIR="/etc/pgs"; CACHE4="$CACHE_DIR/cf-ips-v4.txt"; CACHE6="$CACHE_DIR/cf-ips-v6.txt"

die(){ echo "ERRORE: $*" >&2; exit 2; }
warn(){ echo "AVVISO: $*" >&2; }
[ "$(id -u)" = "0" ] || die "esegui come root."
trap 'echo "" >&2; echo "APPLICAZIONE INTERROTTA (riga $LINENO). Lo stato del firewall può essere PARZIALE: esegui il rollback stampato sotto o rilancia dopo aver corretto la causa." >&2' ERR

IFS=',' read -r -a PORTS <<< "$PORTS_CSV"

# ── 0. Fallback SSH: mai bloccare la porta di amministrazione ───────────────
SSH_PORTS="$(grep -rhiE '^[[:space:]]*Port[[:space:]]+[0-9]+' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/ 2>/dev/null | grep -oE '[0-9]+' | sort -u || true)"
[ -z "$SSH_PORTS" ] && SSH_PORTS="22"
for p in "${PORTS[@]}"; do for s in $SSH_PORTS; do
  [ "$p" = "$s" ] && die "la porta bersaglio $p coincide con una porta SSH ($s): interrompo per non chiudere l'accesso."
done; done
echo "[0] SSH su porta/e: $SSH_PORTS — non verrà toccata."

# ── 1. Range Cloudflare: fetch → API → cache → file, con validazione ────────
valid_list(){ [ "$(printf '%s\n' "$1" | grep -c '/' || true)" -ge 5 ]; }
echo "[1] Ottengo i range IP di Cloudflare…"
CF4=""; CF6=""; SRC=""
if [ -n "${PGS_CF_FILE:-}" ] && [ -f "$PGS_CF_FILE" ]; then
  CF4="$(grep -E '^[0-9].*/' "$PGS_CF_FILE" || true)"
  CF6="$(grep -E '^[0-9a-fA-F]*:.*/' "$PGS_CF_FILE" || true)"
  SRC="file $PGS_CF_FILE"
fi
if ! valid_list "$CF4"; then
  CF4="$(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v4 2>/dev/null || true)"
  CF6="$(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v6 2>/dev/null || true)"
  SRC="cloudflare.com"
fi
if ! valid_list "$CF4"; then
  J="$(curl -fsS --max-time 15 https://api.cloudflare.com/client/v4/ips 2>/dev/null || true)"
  CF4="$(printf '%s' "$J" | grep -oE '"[0-9.]+/[0-9]+"' | tr -d '"' || true)"
  CF6="$(printf '%s' "$J" | grep -oE '"[0-9a-fA-F:]+/[0-9]+"' | tr -d '"' || true)"
  SRC="api.cloudflare.com"
fi
if ! valid_list "$CF4" && [ -f "$CACHE4" ]; then
  CF4="$(cat "$CACHE4")"; CF6="$(cat "$CACHE6" 2>/dev/null || true)"; SRC="cache $CACHE4"
  warn "range live non raggiungibili: uso la cache locale (potrebbe essere datata)."
fi
valid_list "$CF4" || die "impossibile ottenere i range CF (fonte tentata: ${SRC:-nessuna}). Nessuna modifica applicata."
echo "    fonte: $SRC · v4: $(printf '%s\n' "$CF4" | grep -c '/') · v6: $(printf '%s\n' "$CF6" | grep -c '/' || echo 0)"
# aggiorna la cache solo con dati freschi e validi
if [ "$APPLY" = "1" ] && [ "$SRC" != "cache $CACHE4" ]; then
  mkdir -p "$CACHE_DIR"; printf '%s\n' "$CF4" > "$CACHE4"; printf '%s\n' "$CF6" > "$CACHE6" || true
fi

# ── 2. Backend ──────────────────────────────────────────────────────────────
FW="${PGS_FW:-}"
if [ -z "$FW" ]; then
  if command -v csf >/dev/null 2>&1 && [ -f /etc/csf/csf.conf ]; then FW=csf
  elif command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi active; then FW=ufw
  elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state 2>/dev/null | grep -q running; then FW=firewalld
  else FW=nftables; fi
fi
echo "[2] Backend: $FW · porte: $PORTS_CSV"
run(){ if [ "$APPLY" = "1" ]; then eval "$@"; else echo "    (dry-run) $*"; fi; }

case "$FW" in
  ufw)  # aaPanel / Ubuntu
    echo "[3] ufw: chiudo le aperture generiche su $PORTS_CSV e limito ai range CF"
    for p in "${PORTS[@]}"; do
      run "ufw --force delete allow $p      >/dev/null 2>&1 || true"
      run "ufw --force delete allow ${p}/tcp >/dev/null 2>&1 || true"
    done
    _uf(){ for p in "${PORTS[@]}"; do run "ufw allow proto tcp from $1 to any port $p comment '$TAG' || true"; done; }
    while read -r c; do [ -n "$c" ] && _uf "$c"; done <<< "$CF4"
    while read -r c; do [ -n "$c" ] && _uf "$c"; done <<< "$CF6"
    run "ufw --force reload || true"
    echo "    Verifica default DENY:  ufw status verbose | grep -i 'Default:'"
    ;;
  firewalld)  # generico
    echo "[3] firewalld: rimuovo http/https 'aperti a tutti' e aggiungo rich-rule per CF"
    run "firewall-cmd --permanent --remove-service=http  >/dev/null 2>&1 || true"
    run "firewall-cmd --permanent --remove-service=https >/dev/null 2>&1 || true"
    if [ "$APPLY" = "1" ]; then
      firewall-cmd --permanent --list-rich-rules 2>/dev/null | grep "$TAG" | while read -r r; do
        firewall-cmd --permanent --remove-rich-rule="$r" >/dev/null 2>&1 || true; done
    fi
    _fd(){ for p in "${PORTS[@]}"; do run "firewall-cmd --permanent --add-rich-rule='rule family=\"$2\" source address=\"$1\" port port=\"$p\" protocol=\"tcp\" accept'  # $TAG || true"; done; }
    while read -r c; do [ -n "$c" ] && _fd "$c" ipv4; done <<< "$CF4"
    while read -r c; do [ -n "$c" ] && _fd "$c" ipv6; done <<< "$CF6"
    run "firewall-cmd --reload || true"
    ;;
  csf)  # cPanel
    echo "[3] csf: tolgo $PORTS_CSV da TCP_IN e autorizzo solo i range CF"
    TS="$(date +%Y%m%d-%H%M%S)"
    run "cp -a /etc/csf/csf.conf  /etc/csf/csf.conf.bak-$TS"
    run "cp -a /etc/csf/csf.allow /etc/csf/csf.allow.bak-$TS"
    if [ "$APPLY" = "1" ]; then
      awk -v REMOVE="$PORTS_CSV" '
        BEGIN{ n=split(REMOVE,rm,","); for(i=1;i<=n;i++) drop[rm[i]]=1 }
        /^TCP_IN[ \t]*=/{ match($0,/"[^"]*"/); inner=substr($0,RSTART+1,RLENGTH-2);
          m=split(inner,a,","); out="";
          for(i=1;i<=m;i++){ gsub(/[ \t]/,"",a[i]); if(!(a[i] in drop)) out=(out==""?a[i]:out","a[i]) }
          print "TCP_IN = \"" out "\""; next } {print}
      ' /etc/csf/csf.conf > /etc/csf/csf.conf.tmp && mv /etc/csf/csf.conf.tmp /etc/csf/csf.conf
      # sicurezza: SSH deve restare in TCP_IN
      for s in $SSH_PORTS; do grep -qE "TCP_IN.*\b$s\b" /etc/csf/csf.conf || { cp -a /etc/csf/csf.conf.bak-$TS /etc/csf/csf.conf; die "SSH $s sparito da TCP_IN: ripristinato il backup, nessuna modifica."; }; done
      sed -ri "/# $TAG/d" /etc/csf/csf.allow
    else
      echo "    (dry-run) awk: rimuove $PORTS_CSV da TCP_IN · sed: pulisce righe '$TAG' in csf.allow"
    fi
    _csf(){ for p in "${PORTS[@]}"; do local pr=tcp; case "$1" in *:*) pr=tcp6;; esac
        run "echo '${pr}|in|d=${p}|s=${1} # $TAG' >> /etc/csf/csf.allow"; done; }
    while read -r c; do [ -n "$c" ] && _csf "$c"; done <<< "$CF4"
    while read -r c; do [ -n "$c" ] && _csf "$c"; done <<< "$CF6"
    run "csf -r >/dev/null || true"
    echo "    Backup: /etc/csf/csf.conf.bak-$TS · /etc/csf/csf.allow.bak-$TS"
    ;;
  nftables|*)  # FALLBACK: nessun gestore noto → genero un ruleset, non applico da solo
    OUT="/root/pgs-cf-origin.nft"
    echo "[3] Nessun firewall gestito riconosciuto. Genero un ruleset nftables in $OUT (NON applicato)."
    { echo "#!/usr/sbin/nft -f"
      echo "# PGS $TAG — 80/443 solo da Cloudflare. SSH ($SSH_PORTS) e resto invariati."
      echo "table inet ${TAG//-/_} {"
      echo "  set cf4 { type ipv4_addr; flags interval; elements = { $(printf '%s\n' "$CF4" | grep '/' | paste -sd, || true) } }"
      echo "  set cf6 { type ipv6_addr; flags interval; elements = { $(printf '%s\n' "$CF6" | grep '/' | paste -sd, || true) } }"
      echo "  chain input { type filter hook input priority -10; policy accept;"
      for p in "${PORTS[@]}"; do
        echo "    tcp dport $p ip  saddr @cf4 accept"
        echo "    tcp dport $p ip6 saddr @cf6 accept"
        echo "    tcp dport $p drop"
      done
      echo "  }"
      echo "}"
    } > "$OUT" 2>/dev/null || warn "impossibile scrivere $OUT"
    echo "    Applica a mano dopo revisione:  nft -f $OUT   (rollback: nft delete table inet ${TAG//-/_})"
    [ "$APPLY" = "1" ] && warn "backend non gestito: --apply NON applica nulla in automatico qui, per sicurezza."
    ;;
esac

echo
[ "$APPLY" = "1" ] && echo "[4] APPLICATO ($FW)." || echo "[4] DRY-RUN: niente modificato. Rilancia con --apply."
cat <<TXT
    Collaudo:
      1) l'origine diretta NON deve rispondere:
         curl -k --resolve <DOMINIO>:443:<IP_ORIGINE> https://<DOMINIO>/health   → timeout/errore
      2) via Cloudflare deve funzionare + IP reale:
         PGS_DOMAIN=<DOMINIO> bash pgs-xff-check.sh   → ESITO: OK
    Rollback:
      ufw:        ufw status numbered → ufw delete <n> (regole '$TAG'); riapri se serve: ufw allow 80,443/tcp
      firewalld:  firewall-cmd --permanent --add-service=http --add-service=https; togli le rich-rule '$TAG'; firewall-cmd --reload
      csf:        cp -a /etc/csf/csf.conf.bak-*  /etc/csf/csf.conf ; cp -a /etc/csf/csf.allow.bak-* /etc/csf/csf.allow ; csf -r
      nftables:   nft delete table inet ${TAG//-/_}
TXT
