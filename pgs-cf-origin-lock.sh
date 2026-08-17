#!/usr/bin/env bash
# ============================================================
# PAYROLL GANG SUITE — Blindatura dell'origine (SEC-A5)
#
# Accetta 80/443 in ingresso SOLO dai range IP di Cloudflare. Chiude il
# bypass della CDN (WAF, Turnstile-at-edge, rate limit di CF) e rende non
# falsificabile CF-Connecting-IP, su cui l'app basa audit e rate limiting.
# NON tocca MAI SSH nè le porte dei pannelli: agisce solo su 80/443.
#
# MODALITÀ:
#   bash pgs-cf-origin-lock.sh --check    # SOLO diagnosi: quale firewall è attivo
#   bash pgs-cf-origin-lock.sh            # DRY-RUN: diagnosi + piano, senza applicare
#   bash pgs-cf-origin-lock.sh --apply    # applica + auto-verifica finale
#
# Ambienti (rilevati dallo STATO ATTIVO, non solo "installato"):
#   · cPanel  → CSF (ConfigServer Firewall)
#   · aaPanel → ufw (Ubuntu) o firewalld
#   · generico→ firewalld, altrimenti fallback ruleset nftables
#
# Override:  PGS_FW=csf|ufw|firewalld|nftables   ·   PGS_CF_FILE=/path
#
# FALLBACK: fetch CF (mirror→API→cache→file, poi stop sicuro); trap ERR con
# rollback; SSH mai bloccato; firewall ignoto → genera nft, non applica.
# ============================================================
set -Eeuo pipefail

MODE="dryrun"
case "${1:-}" in
  --apply) MODE="apply" ;;
  --check) MODE="check" ;;
  --install-timer) MODE="timer" ;;
  "" ) MODE="dryrun" ;;
  *) echo "Uso: $0 [--check|--apply|--install-timer]" >&2; exit 2 ;;
esac
PORTS_CSV="${PGS_HTTP_PORTS:-80,443}"
TAG="pgs-cf-origin"
CACHE_DIR="/etc/pgs"; CACHE4="$CACHE_DIR/cf-ips-v4.txt"; CACHE6="$CACHE_DIR/cf-ips-v6.txt"

die(){ echo "ERRORE: $*" >&2; exit 2; }
warn(){ echo "AVVISO: $*" >&2; }
[ "$(id -u)" = "0" ] || die "esegui come root."
trap 'echo "" >&2; echo "INTERROTTO (riga $LINENO): stato del firewall potenzialmente PARZIALE. Rollback nell'\''output, oppure rilancia dopo aver corretto la causa." >&2' ERR
IFS=',' read -r -a PORTS <<< "$PORTS_CSV"

# ── Installazione timer di refresh (systemd): non tocca il firewall ora ─────
if [ "$MODE" = "timer" ]; then
  command -v systemctl >/dev/null 2>&1 || die "systemd assente: impossibile installare il timer."
  SELF="$(readlink -f "$0")"
  FWENV=""; [ -n "${PGS_FW:-}" ] && FWENV="Environment=PGS_FW=${PGS_FW}"
  cat > /etc/systemd/system/${TAG}-refresh.service <<UNIT
[Unit]
Description=PGS origin lock — refresh range Cloudflare
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
${FWENV}
ExecStart=/usr/bin/env bash ${SELF} --apply
UNIT
  cat > /etc/systemd/system/${TAG}-refresh.timer <<UNIT
[Unit]
Description=PGS origin lock — refresh settimanale dei range Cloudflare
[Timer]
OnCalendar=Mon *-*-* 04:30:00
RandomizedDelaySec=1h
Persistent=true
[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now ${TAG}-refresh.timer
  echo "  ✓ timer installato: ${TAG}-refresh.timer (lun 04:30 ±1h, Persistent=true)"
  systemctl list-timers "${TAG}-refresh.timer" --no-pager 2>/dev/null | head -3
  exit 0
fi

# ── Helper di rilevamento (STATO ATTIVO, non solo presenza) ─────────────────
have(){ command -v "$1" >/dev/null 2>&1; }
csf_installed(){ have csf && [ -f /etc/csf/csf.conf ]; }
csf_active(){ csf_installed || return 1; [ -f /etc/csf/csf.disable ] && return 1
  systemctl is-active --quiet lfd 2>/dev/null || pgrep -x lfd >/dev/null 2>&1 \
    || iptables -nL 2>/dev/null | grep -qE 'LOCALINPUT|ConfigServer'; }
csf_testing(){ grep -E '^TESTING' /etc/csf/csf.conf 2>/dev/null | grep -oE '[01]' | head -1; }
ufw_active(){ have ufw && ufw status 2>/dev/null | grep -qiE '^Status:[[:space:]]*active'; }
firewalld_active(){ have firewall-cmd && { firewall-cmd --state 2>/dev/null | grep -q running || systemctl is-active --quiet firewalld 2>/dev/null; }; }
nft_tables(){ local n=0; have nft && n="$(nft list tables 2>/dev/null | grep -c . || true)"; echo "${n:-0}"; }
ipt_rules(){ local n; n="$(iptables -S INPUT 2>/dev/null | grep -c '^-A' || true)"; echo "${n:-0}"; }
panel(){ [ -d /usr/local/cpanel ] && { echo cPanel; return; }; [ -d /www/server/panel ] && { echo aaPanel; return; }; echo "-"; }

# ── Report: quale firewall governa la macchina ──────────────────────────────
fw_report(){
  echo "== Stato firewall sulla macchina (pannello: $(panel)) =="
  local a
  a="$(csf_active && echo ATTIVO || echo no)"
  printf "  %-11s %-7s installato:%s  TESTING=%s\n" "CSF" "$a" "$(csf_installed && echo si || echo no)" "$(csf_testing || echo -)"
  a="$(ufw_active && echo ATTIVO || echo no)"
  printf "  %-11s %-7s installato:%s  default-in:%s\n" "ufw" "$a" "$(have ufw && echo si || echo no)" "$(ufw status verbose 2>/dev/null | grep -oiE 'deny \(incoming\)|allow \(incoming\)' | head -1 || echo -)"
  a="$(firewalld_active && echo ATTIVO || echo no)"
  printf "  %-11s %-7s installato:%s  zona:%s\n" "firewalld" "$a" "$(have firewall-cmd && echo si || echo no)" "$(firewall-cmd --get-default-zone 2>/dev/null || echo -)"
  printf "  %-11s %-7s tabelle-nft:%s  regole-iptables-INPUT:%s\n" "nft/iptables" "-" "$(nft_tables)" "$(ipt_rules)"
}

# ── Selezione backend (priorità allo stato ATTIVO) ──────────────────────────
detect_fw(){
  if [ -n "${PGS_FW:-}" ]; then echo "$PGS_FW"; return; fi
  local act=()
  csf_active && act+=(csf)
  ufw_active && act+=(ufw)
  firewalld_active && act+=(firewalld)
  if [ "${#act[@]}" -gt 1 ]; then
    warn "più firewall risultano attivi: ${act[*]}. Uso '${act[0]}'. Verifica che non confliggano (imposta PGS_FW per forzare)."
  fi
  if [ "${#act[@]}" -ge 1 ]; then echo "${act[0]}"; return; fi
  # nessun gestore attivo: se ci sono già regole nft/iptables lo dico, ma resto su fallback nft
  echo "nftables"
}

fw_report
FW="$(detect_fw)"
echo "Backend scelto: $FW   (modalità: $MODE · porte: $PORTS_CSV)"
if [ "$MODE" = "check" ]; then
  echo
  case "$FW" in
    csf)  echo "→ All'--apply: rimuove $PORTS_CSV da TCP_IN e mette gli allow CF in csf.allow.";;
    ufw)  echo "→ All'--apply: chiude 80/443 generici e aggiunge allow-from-CF.";;
    firewalld) echo "→ All'--apply: toglie http/https e aggiunge rich-rule CF.";;
    *)    echo "→ Nessun gestore attivo: all'--apply genera solo un ruleset nftables da applicare a mano.";;
  esac
  exit 0
fi

# ── SSH: mai bloccare la porta di amministrazione ───────────────────────────
SSH_PORTS="$(grep -rhiE '^[[:space:]]*Port[[:space:]]+[0-9]+' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/ 2>/dev/null | grep -oE '[0-9]+' | sort -u || true)"
[ -z "$SSH_PORTS" ] && SSH_PORTS="22"
for p in "${PORTS[@]}"; do for s in $SSH_PORTS; do
  [ "$p" = "$s" ] && die "la porta bersaglio $p coincide con SSH ($s): interrompo."
done; done
echo "SSH su porta/e: $SSH_PORTS — non verrà toccata."

# ── Range Cloudflare: file → mirror → API → cache, con validazione ──────────
valid(){ [ "$(printf '%s\n' "$1" | grep -c '/' || true)" -ge 5 ]; }
CF4=""; CF6=""; SRC=""
if [ -n "${PGS_CF_FILE:-}" ] && [ -f "$PGS_CF_FILE" ]; then
  CF4="$(grep -E '^[0-9].*/' "$PGS_CF_FILE" || true)"; CF6="$(grep -E '^[0-9a-fA-F]*:.*/' "$PGS_CF_FILE" || true)"; SRC="file $PGS_CF_FILE"; fi
if ! valid "$CF4"; then CF4="$(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v4 2>/dev/null || true)"; CF6="$(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v6 2>/dev/null || true)"; SRC="cloudflare.com"; fi
if ! valid "$CF4"; then J="$(curl -fsS --max-time 15 https://api.cloudflare.com/client/v4/ips 2>/dev/null || true)"; CF4="$(printf '%s' "$J" | grep -oE '"[0-9.]+/[0-9]+"' | tr -d '"' || true)"; CF6="$(printf '%s' "$J" | grep -oE '"[0-9a-fA-F:]+/[0-9]+"' | tr -d '"' || true)"; SRC="api.cloudflare.com"; fi
if ! valid "$CF4" && [ -f "$CACHE4" ]; then CF4="$(cat "$CACHE4")"; CF6="$(cat "$CACHE6" 2>/dev/null || true)"; SRC="cache"; warn "range live non raggiungibili: uso la cache locale."; fi
valid "$CF4" || die "impossibile ottenere i range CF. Nessuna modifica applicata."
echo "Range CF: fonte=$SRC · v4=$(printf '%s\n' "$CF4"|grep -c '/') · v6=$(printf '%s\n' "$CF6"|grep -c '/'||echo 0)"
if [ "$MODE" = "apply" ] && [ "$SRC" != "cache" ]; then mkdir -p "$CACHE_DIR"; printf '%s\n' "$CF4" > "$CACHE4"; printf '%s\n' "$CF6" > "$CACHE6" || true; fi

run(){ if [ "$MODE" = "apply" ]; then eval "$@"; else echo "  (dry-run) $*"; fi; }

echo "== Applico ($FW) =="
case "$FW" in
  ufw)
    for p in "${PORTS[@]}"; do run "ufw --force delete allow $p >/dev/null 2>&1 || true"; run "ufw --force delete allow ${p}/tcp >/dev/null 2>&1 || true"; done
    _u(){ for p in "${PORTS[@]}"; do run "ufw allow proto tcp from $1 to any port $p comment '$TAG' || true"; done; }
    while read -r c; do [ -n "$c" ] && _u "$c"; done <<< "$CF4"
    while read -r c; do [ -n "$c" ] && _u "$c"; done <<< "$CF6"
    run "ufw --force reload || true"
    ;;
  firewalld)
    run "firewall-cmd --permanent --remove-service=http  >/dev/null 2>&1 || true"
    run "firewall-cmd --permanent --remove-service=https >/dev/null 2>&1 || true"
    if [ "$MODE" = "apply" ]; then firewall-cmd --permanent --list-rich-rules 2>/dev/null | grep "$TAG" | while read -r r; do firewall-cmd --permanent --remove-rich-rule="$r" >/dev/null 2>&1 || true; done; fi
    _f(){ for p in "${PORTS[@]}"; do run "firewall-cmd --permanent --add-rich-rule='rule family=\"$2\" source address=\"$1\" port port=\"$p\" protocol=\"tcp\" accept'  # $TAG || true"; done; }
    while read -r c; do [ -n "$c" ] && _f "$c" ipv4; done <<< "$CF4"
    while read -r c; do [ -n "$c" ] && _f "$c" ipv6; done <<< "$CF6"
    run "firewall-cmd --reload || true"
    ;;
  csf)
    TS="$(date +%Y%m%d-%H%M%S)"
    run "cp -a /etc/csf/csf.conf  /etc/csf/csf.conf.bak-$TS"
    run "cp -a /etc/csf/csf.allow /etc/csf/csf.allow.bak-$TS"
    if [ "$MODE" = "apply" ]; then
      awk -v REMOVE="$PORTS_CSV" 'BEGIN{n=split(REMOVE,rm,",");for(i=1;i<=n;i++)drop[rm[i]]=1}
        /^TCP_IN[ \t]*=/{match($0,/"[^"]*"/);inner=substr($0,RSTART+1,RLENGTH-2);m=split(inner,a,",");out="";
          for(i=1;i<=m;i++){gsub(/[ \t]/,"",a[i]);if(!(a[i] in drop))out=(out==""?a[i]:out","a[i])}print "TCP_IN = \"" out "\"";next}{print}' \
        /etc/csf/csf.conf > /etc/csf/csf.conf.tmp && mv /etc/csf/csf.conf.tmp /etc/csf/csf.conf
      for s in $SSH_PORTS; do grep -qE "TCP_IN.*\b$s\b" /etc/csf/csf.conf || { cp -a /etc/csf/csf.conf.bak-$TS /etc/csf/csf.conf; die "SSH $s sparito da TCP_IN: backup ripristinato."; }; done
      sed -ri "/# $TAG/d" /etc/csf/csf.allow
    else echo "  (dry-run) awk rimuove $PORTS_CSV da TCP_IN · pulizia righe '$TAG' in csf.allow"; fi
    _c(){ for p in "${PORTS[@]}"; do local pr=tcp; case "$1" in *:*) pr=tcp6;; esac; run "echo '${pr}|in|d=${p}|s=${1} # $TAG' >> /etc/csf/csf.allow"; done; }
    while read -r c; do [ -n "$c" ] && _c "$c"; done <<< "$CF4"
    while read -r c; do [ -n "$c" ] && _c "$c"; done <<< "$CF6"
    run "csf -r >/dev/null || true"
    echo "  Backup: /etc/csf/csf.conf.bak-$TS · /etc/csf/csf.allow.bak-$TS"
    ;;
  *)  # nftables grezzo (es. cPanel senza CSF, o ufw senza binario nel PATH):
      # tabella ISOLATA a priorità -10. NON tocca le tabelle di cPanel/ufw
      # (marcate "do not touch"): scarta 80/443 dai non-CF PRIMA che le altre
      # catene li accettino. policy accept + nessuna regola sulle altre porte
      # => SSH ($SSH_PORTS) e pannelli restano gestiti da cPanel/ufw.
    have nft || die "nftables non disponibile e nessun gestore (csf/ufw/firewalld) attivo: configura il firewall a mano."
    NFT_STORE="/etc/pgs/pgs-cf-origin.nft"; T="${TAG//-/_}"
    build_nft(){
      echo "#!/usr/sbin/nft -f"
      echo "add table inet $T"; echo "delete table inet $T"     # idempotente: azzera e ricrea
      echo "table inet $T {"
      echo "  set cf4 { type ipv4_addr; flags interval; elements = { $(printf '%s\n' "$CF4"|grep '/'|paste -sd, || true) } }"
      echo "  set cf6 { type ipv6_addr; flags interval; elements = { $(printf '%s\n' "$CF6"|grep '/'|paste -sd, || true) } }"
      echo "  chain input { type filter hook input priority -10; policy accept;"
      echo "    iif \"lo\" accept"                                   # loopback: mai bloccare i processi locali
      for p in "${PORTS[@]}"; do echo "    tcp dport $p ip  saddr @cf4 accept"; echo "    tcp dport $p ip6 saddr @cf6 accept"; echo "    tcp dport $p drop"; done
      echo "  }"; echo "}"
    }
    if [ "$MODE" = "apply" ]; then
      mkdir -p /etc/pgs; build_nft > "$NFT_STORE"
      nft -c -f "$NFT_STORE" || die "ruleset nft non valido: NON applico."
      nft -f "$NFT_STORE"    || die "applicazione nft fallita (nessuna tabella modificata resta consistente: controlla 'nft list table inet '$T')."
      cat > /etc/systemd/system/${TAG}.service <<UNIT
[Unit]
Description=PGS origin lock — 80/443 solo da Cloudflare
After=nftables.service network-pre.target
[Service]
Type=oneshot
ExecStart=/usr/sbin/nft -f ${NFT_STORE}
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
UNIT
      { systemctl daemon-reload 2>/dev/null && systemctl enable ${TAG}.service >/dev/null 2>&1 \
        && echo "  persistenza: systemd ${TAG}.service abilitato (ricarica al boot)"; } \
        || warn "systemd non disponibile: rendi persistente a mano il ruleset $NFT_STORE."
      echo "  ruleset applicato e salvato in $NFT_STORE"
    else
      build_nft > /tmp/pgs-cf-origin.preview.nft 2>/dev/null || true
      echo "  (dry-run) applicherei la tabella isolata 'inet $T' (priorità -10, drop non-CF su $PORTS_CSV) + unit systemd ${TAG}.service"
      echo "  anteprima: /tmp/pgs-cf-origin.preview.nft   (validala con: nft -c -f /tmp/pgs-cf-origin.preview.nft)"
    fi
    ;;
esac

# ── Auto-verifica post-apply: le regole sono davvero in vigore? ─────────────
if [ "$MODE" = "apply" ]; then
  echo "== Verifica applicazione =="
  ok=1
  case "$FW" in
    ufw)  n="$(ufw status 2>/dev/null | grep -c "$TAG" || true)"; echo "  regole ufw '$TAG': $n"; [ "$n" -ge 2 ] || ok=0;;
    firewalld) n="$(firewall-cmd --list-rich-rules 2>/dev/null | grep -c "$TAG" || true)"; s="$(firewall-cmd --list-services 2>/dev/null)"; echo "  rich-rule '$TAG': $n · servizi: $s"; { [ "$n" -ge 2 ] && ! echo "$s" | grep -qw http; } || ok=0;;
    csf)  n="$(grep -c "# $TAG" /etc/csf/csf.allow 2>/dev/null || true)"; t="$(grep -E '^TCP_IN' /etc/csf/csf.conf)"; echo "  allow CF in csf.allow: $n"; echo "  $t"; { [ "$n" -ge 2 ] && ! echo "$t" | grep -qE '\b80\b|\b443\b'; } || ok=0;;
    *)    n="$(nft list table inet ${TAG//-/_} 2>/dev/null | grep -c 'drop' || true)"; echo "  regole drop nft: ${n:-0}"; [ "${n:-0}" -ge 1 ] || ok=0;;
  esac
  [ "$ok" = "1" ] && echo "  ✓ regole in vigore" || warn "le regole attese NON risultano tutte presenti: controlla sopra."
fi

echo
[ "$MODE" = "apply" ] && echo "FATTO ($FW)." || echo "DRY-RUN: nulla modificato. Rilancia con --apply."
cat <<TXT
  Collaudo esterno:
    origine diretta (deve fallire):  curl -k --resolve <DOM>:443:<IP> https://<DOM>/health
    via Cloudflare (deve dare OK):   PGS_DOMAIN=<DOM> bash pgs-xff-check.sh
  Rollback:
    ufw:       ufw status numbered → ufw delete <n> (regole '$TAG'); riapri: ufw allow 80,443/tcp
    firewalld: firewall-cmd --permanent --add-service=http --add-service=https; togli rich-rule '$TAG'; firewall-cmd --reload
    csf:       cp -a /etc/csf/csf.conf.bak-* /etc/csf/csf.conf; cp -a /etc/csf/csf.allow.bak-* /etc/csf/csf.allow; csf -r
    nftables:  nft delete table inet ${TAG//-/_}; systemctl disable --now ${TAG}.service 2>/dev/null; rm -f /etc/systemd/system/${TAG}.service
TXT
