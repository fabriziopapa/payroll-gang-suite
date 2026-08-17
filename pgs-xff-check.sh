#!/usr/bin/env bash
# ============================================================
# PAYROLL GANG SUITE — Verifica anti-spoofing X-Forwarded-For (SEC-A4)
#
# Dimostra end-to-end se il server accetta un IP falsificato via header
# X-Forwarded-For. Invia login falliti con XFF sentinella (username
# inesistente su TLD .invalid: nessun account reale viene toccato) e
# controlla quale IP e' finito in audit_log.
#
# USO (da root, sul server pre-prod cPanel, via SSH):
#     bash /home/pgs/apps/payroll-gang-suite/pgs-xff-check.sh
#
# Variabili d'ambiente riconosciute:
#   PGS_DOMAIN   dominio pubblico            (default: pre.fabriziopapa.com)
#   PGS_DB_NAME  nome database PostgreSQL    (default: payroll_gang)
#
# Uscita 0 = OK (header ignorato, IP reale). 1 = VULNERABILE. 2 = errore.
# ============================================================
set -Eeuo pipefail

DOMAIN="${PGS_DOMAIN:-pre.fabriziopapa.com}"
DB_NAME="${PGS_DB_NAME:-payroll_gang}"
LOGIN="https://${DOMAIN}/api/v1/auth/login"
SENTINELS=("203.0.113.222" "198.51.100.111")   # TEST-NET-3 / TEST-NET-2 (RFC 5737)

# --- psql: PATH, poi percorsi noti (installazione nativa cPanel) ---
PSQL="$(command -v psql || true)"
if [ -z "$PSQL" ]; then
  for c in /www/server/pgsql/bin/psql /usr/pgsql-*/bin/psql /usr/local/pgsql/bin/psql; do
    [ -x "$c" ] && PSQL="$c" && break
  done
fi
[ -n "$PSQL" ] || { echo "ERRORE: psql non trovato." >&2; exit 2; }

# --- sentinella univoca per questo run ---
STAMP="$(date +%Y%m%d%H%M%S)"
USERNAME="xff-check-${STAMP}@example.invalid"
HASH="$(printf '%s' "$USERNAME" | sha256sum | cut -c1-16)"   # come AuthService.#logFailedLogin
BODY="$(printf '{"username":"%s","token":"000000"}' "$USERNAME")"

echo "Dominio      : $DOMAIN"
echo "Sentinella   : $USERNAME"
echo "usernameHash : $HASH"
echo

echo "== Invio richieste =="
for xff in "${SENTINELS[@]}"; do
  code="$(curl -sS -k -o /dev/null -w '%{http_code}' -X POST "$LOGIN" \
    -H 'Content-Type: application/json' -H "X-Forwarded-For: $xff" -d "$BODY" || echo 000)"
  echo "  XFF=$xff  -> HTTP $code"
done
code="$(curl -sS -k -o /dev/null -w '%{http_code}' -X POST "$LOGIN" \
  -H 'Content-Type: application/json' -d "$BODY" || echo 000)"
echo "  (senza XFF)      -> HTTP $code   <- riferimento: IP reale del chiamante"
echo

sleep 2

echo "== Righe in audit_log (ultimi 5 minuti) =="
ROWS="$(sudo -u postgres "$PSQL" -d "$DB_NAME" -P pager=off -tAF'|' -c \
  "SELECT ip, dettagli->>'reason'
     FROM audit_log
    WHERE azione='LOGIN_FAILED'
      AND dettagli->>'usernameHash'='$HASH'
      AND timestamp > now() - interval '5 minutes'
    ORDER BY timestamp;")"
if [ -z "$ROWS" ]; then
  echo "  nessuna riga trovata (il servizio risponde? il proxy inoltra /api/?)" >&2
  exit 2
fi
echo "$ROWS" | sed 's/^/  ip=/'
echo

# --- verdetto: se un IP sentinella e' stato registrato -> falsificabile ---
FAIL=0
for xff in "${SENTINELS[@]}"; do
  if printf '%s\n' "$ROWS" | awk -F'|' -v ip="$xff" '$1==ip{f=1} END{exit !f}'; then
    echo "  ✗ IP falsificato accettato e registrato: $xff"
    FAIL=1
  fi
done

echo
if [ "$FAIL" -eq 1 ]; then
  echo "ESITO: VULNERABILE — il server crede all'header X-Forwarded-For del client."
  echo "       Verificare trustProxy in server/src/app.ts (deve essere ['127.0.0.1','::1'])."
  exit 1
fi
echo "ESITO: OK — header client ignorato. L'IP registrato e' quello reale del proxy."
exit 0
