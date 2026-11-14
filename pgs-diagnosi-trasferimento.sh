#!/usr/bin/env bash
# ============================================================
# PAYROLL GANG SUITE — Diagnosi per il modulo Esporta / Importa
#
# COSA FA. Legge il database e la configurazione del server e stampa
# SOLO numeri: righe e peso delle tabelle, stato della cifratura dei
# campi protetti, riferimenti senza chiave esterna rimasti orfani,
# contatori, limiti di tempo e di dimensione del proxy.
#
# COSA NON FA. Non scrive nulla nel database (la sessione e' in sola
# lettura: un comando di scrittura verrebbe rifiutato da PostgreSQL) e
# non stampa mai un valore: niente matricole, nomi, codici fiscali,
# indirizzi, domini. L'esito si puo' incollare in una conversazione.
#
# USO (da root, come gli altri script operativi)
#   bash pgs-diagnosi-trasferimento.sh
#
# CONNESSIONE. Come pgs-migra.sh: superutente del database, rilevato.
#   PGS_PSQL  invocazione di psql   (default: rilevata)
#   PGS_DB    nome del database     (default: DB_NAME di .env, poi payroll_gang)
# ============================================================

set -Euo pipefail

RADICE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
titolo() { printf '\n######## %s\n' "$*"; }

# ------------------------------------------------------------
# Connessione
# ------------------------------------------------------------
DB="${PGS_DB:-}"
if [ -z "$DB" ]; then
  for f in "$RADICE/.env" "${PGS_APP_DIR:-/nonexistent}/.env" /www/wwwroot/payroll-gang-suite/.env /home/pgs/apps/payroll-gang-suite/.env; do
    if [ -r "$f" ]; then
      DB="$(grep -E '^DB_NAME=' "$f" | head -1 | cut -d= -f2- | tr -d "\"' \r")"
      [ -n "$DB" ] && break
    fi
  done
fi
DB="${DB:-payroll_gang}"

if [ -n "${PGS_PSQL:-}" ]; then
  # shellcheck disable=SC2206
  PSQL=($PGS_PSQL)
elif [ -x /www/server/pgsql/bin/psql ]; then
  PSQL=(runuser -u postgres -- /www/server/pgsql/bin/psql)
else
  PSQL=(runuser -u postgres -- psql)
fi

titolo "DIAGNOSI TRASFERIMENTO — $(date '+%Y-%m-%d %H:%M') — sola lettura, soli conteggi"

"${PSQL[@]}" -X -q -d "$DB" -v ON_ERROR_STOP=0 -P pager=off -P footer=off <<'SQL'
SET default_transaction_read_only = on;
SET statement_timeout = '120s';
\set cf  '''^[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]$'''
\set cfi '''[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]'''
\set enc '''^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$'''

\echo
\echo ######## 1. PostgreSQL e migrazioni
SELECT current_setting('server_version') AS postgres,
       (SELECT count(*) FROM schema_migrations) AS migrazioni,
       (SELECT max(versione) FROM schema_migrations) AS ultima;
SELECT name AS parametro, setting AS valore, unit AS unita FROM pg_settings
WHERE name IN ('statement_timeout','lock_timeout','idle_in_transaction_session_timeout','max_connections','shared_buffers','work_mem')
ORDER BY 1;

\echo
\echo ######## 2. Righe e peso di ogni tabella
SELECT c.relname AS tabella,
       (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I', c.relname), false, true, '')))[1]::text::bigint AS righe,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS peso
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY pg_total_relation_size(c.oid) DESC;

\echo
\echo ######## 3. Peso dei campi JSON (quanto peserebbe una esportazione)
SELECT 'bozze.dati' AS campo, count(*) AS righe, pg_size_pretty(coalesce(sum(length(dati::text)),0)::bigint) AS totale, pg_size_pretty(coalesce(max(length(dati::text)),0)::bigint) AS il_piu_grande FROM bozze
UNION ALL SELECT 'emolumenti_lavorazioni.dati', count(*), pg_size_pretty(coalesce(sum(length(dati::text)),0)::bigint), pg_size_pretty(coalesce(max(length(dati::text)),0)::bigint) FROM emolumenti_lavorazioni
UNION ALL SELECT 'certificati.dati_json', count(*), pg_size_pretty(coalesce(sum(length(dati_json::text)),0)::bigint), pg_size_pretty(coalesce(max(length(dati_json::text)),0)::bigint) FROM certificati
UNION ALL SELECT 'templati_certificato.struttura_json', count(*), pg_size_pretty(coalesce(sum(length(struttura_json::text)),0)::bigint), pg_size_pretty(coalesce(max(length(struttura_json::text)),0)::bigint) FROM templati_certificato
UNION ALL SELECT 'templati_pdf_region.parti_json', count(*), pg_size_pretty(coalesce(sum(length(parti_json::text)),0)::bigint), pg_size_pretty(coalesce(max(length(parti_json::text)),0)::bigint) FROM templati_pdf_region
UNION ALL SELECT 'cral_iniziative.config', count(*), pg_size_pretty(coalesce(sum(length(config::text)),0)::bigint), pg_size_pretty(coalesce(max(length(config::text)),0)::bigint) FROM cral_iniziative
UNION ALL SELECT 'cral_scelte.dati', count(*), pg_size_pretty(coalesce(sum(length(dati::text)),0)::bigint), pg_size_pretty(coalesce(max(length(dati::text)),0)::bigint) FROM cral_scelte
UNION ALL SELECT 'app_settings.valore', count(*), pg_size_pretty(coalesce(sum(length(valore::text)),0)::bigint), pg_size_pretty(coalesce(max(length(valore::text)),0)::bigint) FROM app_settings;

\echo
\echo ######## 4. Cifratura dei campi protetti (IN CHIARO e ALTRO fermerebbero la esportazione)
\echo ######## nota: da qui si vede la FORMA del dato, non se la chiave lo decifra
SELECT campo, stato, count(*) AS righe FROM (
  SELECT 'anagrafiche.cod_fis' AS campo, CASE WHEN cod_fis IS NULL OR cod_fis = '' THEN 'vuoto' WHEN cod_fis ~ :enc THEN 'cifrato' WHEN upper(cod_fis) ~ :cf THEN 'IN CHIARO' ELSE 'ALTRO' END AS stato FROM anagrafiche
  UNION ALL SELECT 'certificati.cf', CASE WHEN cf IS NULL OR cf = '' THEN 'vuoto' WHEN cf ~ :enc THEN 'cifrato' WHEN upper(cf) ~ :cf THEN 'IN CHIARO' ELSE 'ALTRO' END FROM certificati
  UNION ALL SELECT 'certificati.dati_json', CASE WHEN jsonb_typeof(dati_json) = 'object' AND dati_json ? 'enc' THEN 'cifrato' ELSE 'IN CHIARO' END FROM certificati
  UNION ALL SELECT 'familiari_cache.cod_fisc', CASE WHEN cod_fisc ~ :enc THEN 'cifrato' WHEN upper(cod_fisc) ~ :cf THEN 'IN CHIARO' ELSE 'ALTRO' END FROM familiari_cache
  UNION ALL SELECT 'users.totp_secret', CASE WHEN totp_secret ~ :enc THEN 'cifrato' ELSE 'ALTRO' END FROM users
  UNION ALL SELECT 'bozze nominativi.codFisc', CASE WHEN coalesce(e->>'codFisc','') = '' THEN 'vuoto' WHEN e->>'codFisc' LIKE 'PGS05:%' THEN 'cifrato' WHEN upper(e->>'codFisc') ~ :cf THEN 'IN CHIARO' ELSE 'ALTRO' END
    FROM bozze b, jsonb_array_elements(CASE WHEN jsonb_typeof(b.dati->'nominativi') = 'array' THEN b.dati->'nominativi' ELSE '[]'::jsonb END) e
  UNION ALL SELECT 'bozze nominativi.riferimentoCedolino', CASE WHEN coalesce(e->>'riferimentoCedolino','') = '' THEN 'vuoto' WHEN e->>'riferimentoCedolino' LIKE 'PGS05:%' THEN 'cifrato' WHEN upper(e->>'riferimentoCedolino') ~ :cfi THEN 'IN CHIARO' ELSE 'senza codice fiscale' END
    FROM bozze b, jsonb_array_elements(CASE WHEN jsonb_typeof(b.dati->'nominativi') = 'array' THEN b.dati->'nominativi' ELSE '[]'::jsonb END) e
  UNION ALL SELECT 'bozze dettagli.riferimentoCedolino', CASE WHEN coalesce(e->>'riferimentoCedolino','') = '' THEN 'vuoto' WHEN e->>'riferimentoCedolino' LIKE 'PGS05:%' THEN 'cifrato' WHEN upper(e->>'riferimentoCedolino') ~ :cfi THEN 'IN CHIARO' ELSE 'senza codice fiscale' END
    FROM bozze b, jsonb_array_elements(CASE WHEN jsonb_typeof(b.dati->'dettagli') = 'array' THEN b.dati->'dettagli' ELSE '[]'::jsonb END) e
) t GROUP BY campo, stato ORDER BY campo, stato;

\echo
\echo ######## 5. Riferimenti senza chiave esterna: quanti sono orfani gia oggi
WITH nom AS (
  SELECT DISTINCT e->>'matricola' AS v FROM bozze b, jsonb_array_elements(CASE WHEN jsonb_typeof(b.dati->'nominativi') = 'array' THEN b.dati->'nominativi' ELSE '[]'::jsonb END) e WHERE coalesce(e->>'matricola','') <> ''
), det AS (
  SELECT DISTINCT e->>'voce' AS voce, e->>'capitolo' AS capitolo FROM bozze b, jsonb_array_elements(CASE WHEN jsonb_typeof(b.dati->'dettagli') = 'array' THEN b.dati->'dettagli' ELSE '[]'::jsonb END) e
)
SELECT 'bozze: matricole dei nominativi non in anagrafica' AS controllo, count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM anagrafiche a WHERE a.matricola = nom.v)) AS orfani, count(*) AS valori_distinti FROM nom
UNION ALL SELECT 'bozze: voci dei dettagli non in voci', count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM voci v WHERE v.codice = x.voce)), count(*) FROM (SELECT DISTINCT voce FROM det WHERE coalesce(voce,'') <> '') x
UNION ALL SELECT 'bozze: capitoli dei dettagli non in capitoli_anag', count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM capitoli_anag c WHERE c.codice = x.capitolo)), count(*) FROM (SELECT DISTINCT capitolo FROM det WHERE coalesce(capitolo,'') <> '') x
UNION ALL SELECT 'voci_config: codici non in voci', count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM voci v WHERE v.codice = vc.codice)), count(*) FROM voci_config vc
UNION ALL SELECT 'certificati: matricole non in anagrafica', count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM anagrafiche a WHERE a.matricola = x.m)), count(*) FROM (SELECT DISTINCT matricola AS m FROM certificati WHERE coalesce(matricola,'') <> '') x
UNION ALL SELECT 'tipi conto: matricole delle righe non in anagrafica', count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM anagrafiche a WHERE a.matricola = x.m)), count(*) FROM (SELECT DISTINCT matricola AS m FROM emolumenti_tipiconto_righe) x
UNION ALL SELECT 'cral: soci dipendenti con matricola non in anagrafica', count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM anagrafiche a WHERE a.matricola = s.matricola)), count(*) FROM cral_soci s WHERE s.matricola IS NOT NULL
UNION ALL SELECT 'cral: sedi citate dagli eventi non in cral_sedi', count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM cral_sedi s WHERE s.id = x.sede)), count(*) FROM (SELECT DISTINCT unnest(sedi) AS sede FROM cral_iniziative) x;

\echo
\echo ######## 6. Righe senza autore (creato da vuoto): informativo
SELECT 'bozze' AS tabella, count(*) FILTER (WHERE created_by IS NULL) AS senza_autore, count(*) AS righe FROM bozze
UNION ALL SELECT 'emolumenti_lavorazioni', count(*) FILTER (WHERE created_by IS NULL), count(*) FROM emolumenti_lavorazioni
UNION ALL SELECT 'certificati', count(*) FILTER (WHERE created_by IS NULL), count(*) FROM certificati
UNION ALL SELECT 'cral_soci', count(*) FILTER (WHERE creato_da IS NULL), count(*) FROM cral_soci;

\echo
\echo ######## 7. Contatori: devono essere almeno pari al massimo usato
SELECT 'certificati ' || c.anno AS contatore, p.ultimo AS valore, max(c.progressivo) AS massimo_usato,
       CASE WHEN p.ultimo IS NOT NULL AND p.ultimo >= max(c.progressivo) THEN 'ok' ELSE 'DA GUARDARE' END AS esito
FROM certificati c LEFT JOIN certificato_progressivi p USING (anno) GROUP BY c.anno, p.ultimo
UNION ALL SELECT 'cral esterni (EXT)', p.ext_prossimo, m.n, CASE WHEN p.ext_prossimo > m.n THEN 'ok' ELSE 'DA GUARDARE' END
  FROM cral_parametri p, (SELECT coalesce(max(substring(id FROM 5)::int), 0) AS n FROM cral_soci WHERE id LIKE 'EXT-%') m
UNION ALL SELECT 'cral familiari (FAM)', p.fam_prossimo, m.n, CASE WHEN p.fam_prossimo > m.n THEN 'ok' ELSE 'DA GUARDARE' END
  FROM cral_parametri p, (SELECT coalesce(max(substring(id FROM 5)::int), 0) AS n FROM cral_soci WHERE id LIKE 'FAM-%') m
ORDER BY 1;

\echo
\echo ######## 8. Utenti, lotti in corso, impostazioni (solo numeri e nomi delle chiavi)
SELECT count(*) AS utenti, count(*) FILTER (WHERE is_active) AS attivi, count(*) FILTER (WHERE is_active AND is_admin) AS admin_attivi,
       count(*) FILTER (WHERE NOT totp_verified) AS totp_non_verificato, count(*) FILTER (WHERE locked_until > now()) AS bloccati_ora FROM users;
SELECT stato, count(*) AS lotti_cral FROM cral_lotti GROUP BY stato ORDER BY 1;
SELECT chiave, pg_size_pretty(length(valore::text)::bigint) AS peso FROM app_settings ORDER BY 1;
SQL

# ------------------------------------------------------------
# Server: limiti di tempo e di dimensione davanti all'applicazione
# ------------------------------------------------------------
titolo "9. Proxy: tempi massimi e dimensione massima delle richieste (valore e quante volte compare)"
if command -v nginx >/dev/null 2>&1 || [ -x /www/server/nginx/sbin/nginx ]; then
  NGINX="$(command -v nginx || echo /www/server/nginx/sbin/nginx)"
  echo "nginx:"
  "$NGINX" -T 2>/dev/null | grep -E '^\s*(client_max_body_size|client_body_timeout|proxy_read_timeout|proxy_send_timeout|proxy_connect_timeout|send_timeout)\b' \
    | sed -E 's/^\s+//' | sort | uniq -c || true
else
  echo "nginx: non presente"
fi
APACHE_DIRS=()
for d in /etc/apache2 /usr/local/apache/conf /etc/httpd; do [ -d "$d" ] && APACHE_DIRS+=("$d"); done
if [ "${#APACHE_DIRS[@]}" -gt 0 ]; then
  echo "apache (anche ModSecurity):"
  grep -rhsE '^\s*(ProxyTimeout|TimeOut|Timeout|LimitRequestBody|SecRequestBodyLimit|SecRequestBodyNoFilesLimit|SecRequestBodyInMemoryLimit)\b' "${APACHE_DIRS[@]}" \
    | sed -E 's/^\s+//' | sort | uniq -c || true
else
  echo "apache: non presente"
fi

titolo "10. Memoria della macchina e del processo Node"
free -m 2>/dev/null | sed -n '1,2p' || true
ps -eo rss=,comm= 2>/dev/null | awk '$2 ~ /^node/ { n++; s += $1 } END { printf "processi node: %d, memoria in uso: %d MB\n", n, s / 1024 }' || true
if command -v systemctl >/dev/null 2>&1 && systemctl cat pgs >/dev/null 2>&1; then
  systemctl show pgs -p MemoryMax -p MemoryHigh -p TimeoutStopUSec 2>/dev/null || true
fi
grep -hsE 'max_memory_restart|kill_timeout' "$RADICE/ecosystem.config.cjs" /www/wwwroot/payroll-gang-suite/ecosystem.config.cjs 2>/dev/null | sed -E 's/^\s+//' | sort -u || true

titolo "FINE — nulla e' stato modificato"
