#!/usr/bin/env bash
# ============================================================
# PAYROLL GANG SUITE — Diagnosi degli eventi CRAL a ordine (prodotti e quantita')
#
# COSA FA. Per ogni evento in modalita' «Ordine a pagamento» stampa come
# sono impostati i prodotti (unita' di vendita, contenuto, prezzo, massimo)
# e come sono gli ordini: quante persone, quantita' totali, quali quantita'
# sono state chieste e quante volte, pagati e consegnati, chiavi presenti
# nei dati delle scelte. Serve a progettare le confezioni (sacchi da 1/2 kg).
#
# COSA NON FA. Non scrive nulla (sessione in sola lettura) e non stampa
# persone: niente matricole, nomi, tessere. Solo titoli degli eventi,
# prodotti e numeri. L'esito si puo' incollare in una conversazione.
#
# USO (da root, come gli altri script operativi; uguale in pre-produzione
# e in produzione)
#   bash pgs-diagnosi-ordini.sh
#   bash pgs-diagnosi-ordini.sh OLIO      # solo gli eventi col titolo che contiene OLIO
#
# CONNESSIONE. Come pgs-diagnosi-trasferimento.sh:
#   PGS_PSQL  invocazione di psql   (default: rilevata)
#   PGS_DB    nome del database     (default: DB_NAME di .env, poi payroll_gang)
# ============================================================

set -Euo pipefail

RADICE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILTRO="${1:-}"

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

printf '\n######## DIAGNOSI ORDINI CRAL — %s — database %s — filtro titolo: %s — sola lettura\n' \
  "$(date '+%Y-%m-%d %H:%M')" "$DB" "${FILTRO:-(tutti)}"

"${PSQL[@]}" -X -q -d "$DB" -v ON_ERROR_STOP=0 -v filtro="$FILTRO" -P pager=off -P footer=off <<'SQL'
SET statement_timeout = '120s';
-- viste temporanee della sola sessione (spariscono all'uscita), poi tutto in sola lettura
CREATE TEMP VIEW ev AS
  SELECT i.* FROM cral_iniziative i
  WHERE i.modalita = 'ORDINE' AND i.titolo ILIKE '%' || :'filtro' || '%';

CREATE TEMP VIEW prod AS
  SELECT ev.id AS ini, ev.titolo, n AS ordine, p
  FROM ev CROSS JOIN LATERAL jsonb_array_elements(coalesce(ev.config->'prodotti', '[]'::jsonb)) WITH ORDINALITY AS x(p, n);

CREATE TEMP VIEW qta AS
  SELECT prod.ini, prod.titolo, prod.ordine, prod.p, s.dati,
         (s.dati->'q'->>(prod.p->>'id'))::numeric AS q
  FROM prod JOIN cral_scelte s ON s.iniziativa_id = prod.ini AND s.dati->'q' ? (prod.p->>'id');

SET default_transaction_read_only = on;

\echo
\echo ######## 1. Eventi a ordine
SELECT ev.titolo, ev.data, ev.scadenza, ev.stato, ev.archiviata,
       jsonb_array_length(coalesce(ev.config->'prodotti', '[]'::jsonb)) AS prodotti,
       (SELECT count(*) FROM cral_scelte s WHERE s.iniziativa_id = ev.id) AS scelte,
       (SELECT count(*) FROM cral_scelte s WHERE s.iniziativa_id = ev.id AND s.dati->'q' IS NOT NULL AND s.dati->'q' <> '{}'::jsonb) AS con_ordine
FROM ev ORDER BY ev.data, ev.titolo;

\echo
\echo ######## 2. Prodotti: come sono impostati
SELECT prod.titolo, prod.ordine AS n,
       prod.p->>'id'          AS prod_id,
       prod.p->>'tipologia'   AS tipologia,
       prod.p->>'nome'        AS nome,
       round((prod.p->>'prezzo')::numeric / 100, 2) AS prezzo_eur,
       prod.p->>'unita'       AS unita,
       prod.p->>'contenuto'   AS contenuto,
       prod.p->>'contenutoUm' AS um,
       prod.p->>'max'         AS max_a_testa,
       CASE WHEN prod.p ? 'confezioni' THEN prod.p->>'confezioni' ELSE '' END AS confezioni
FROM prod ORDER BY prod.titolo, prod.ordine;

\echo
\echo ######## 3. Prodotti: ordini e totali
SELECT prod.titolo, prod.ordine AS n, prod.p->>'nome' AS nome, prod.p->>'unita' AS unita,
       count(qta.q)                                   AS ordini,
       coalesce(sum(qta.q), 0)                        AS quantita_tot,
       CASE WHEN prod.p->>'contenuto' IS NOT NULL
            THEN coalesce(sum(qta.q), 0) * (prod.p->>'contenuto')::numeric || ' ' || coalesce(prod.p->>'contenutoUm', '') END AS contenuto_tot,
       round(coalesce(sum(qta.q * (prod.p->>'prezzo')::numeric), 0) / 100, 2) AS importo_eur,
       count(*) FILTER (WHERE qta.q % 1 <> 0)         AS non_intere,
       max(qta.q)                                     AS massima
FROM prod LEFT JOIN qta ON qta.ini = prod.ini AND qta.p->>'id' = prod.p->>'id'
GROUP BY prod.titolo, prod.ordine, prod.p
ORDER BY prod.titolo, prod.ordine;

\echo
\echo ######## 4. Quantita chieste: valore e quante persone (per vedere quali si compongono in confezioni)
SELECT titolo, ordine AS n, p->>'nome' AS nome, q AS quantita, count(*) AS persone
FROM qta GROUP BY titolo, ordine, p->>'nome', q
ORDER BY titolo, ordine, q;

\echo
\echo ######## 5. Stato degli ordini per evento
SELECT ev.titolo,
       count(*) FILTER (WHERE s.dati->'q' IS NOT NULL AND s.dati->'q' <> '{}'::jsonb) AS con_ordine,
       count(*) FILTER (WHERE (s.dati->>'pagato')::boolean)     AS pagati,
       count(*) FILTER (WHERE (s.dati->>'consegnato')::boolean) AS consegnati,
       count(*) FILTER (WHERE s.dati ? 'versato')               AS con_versato,
       count(*) FILTER (WHERE s.dati ? 'scontoPers')            AS con_sconto_pers,
       count(*) FILTER (WHERE s.dati ? 'luogo')                 AS con_sede_consegna,
       count(*) FILTER (WHERE coalesce(s.dati->>'note', '') <> '') AS con_note
FROM ev JOIN cral_scelte s ON s.iniziativa_id = ev.id
GROUP BY ev.titolo ORDER BY ev.titolo;

\echo
\echo ######## 6. Chiavi presenti nei dati delle scelte (fonte = come e nata la scelta)
SELECT ev.titolo, k AS chiave, s.fonte, count(*) AS volte
FROM ev JOIN cral_scelte s ON s.iniziativa_id = ev.id
CROSS JOIN LATERAL jsonb_object_keys(s.dati) k
GROUP BY ev.titolo, k, s.fonte ORDER BY ev.titolo, k, s.fonte;

\echo
\echo ######## 7. Quantita riferite a prodotti che l evento non ha piu (dovrebbe essere vuoto)
SELECT ev.titolo, k AS prod_id, count(*) AS scelte
FROM ev JOIN cral_scelte s ON s.iniziativa_id = ev.id
CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(s.dati->'q') = 'object' THEN s.dati->'q' ELSE '{}'::jsonb END) k
WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(ev.config->'prodotti', '[]'::jsonb)) p WHERE p->>'id' = k)
GROUP BY ev.titolo, k ORDER BY 1, 2;
SQL

printf '\n######## FINE — nulla e%s stato modificato\n' "'"
