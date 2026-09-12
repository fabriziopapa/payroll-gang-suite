#!/usr/bin/env bash
# ============================================================
# PAYROLL GANG SUITE — Applicatore di migrazioni
#
# PERCHE'. Fino a oggi le migrazioni si applicavano a mano, incollando
# un psql in SSH, e da nessuna parte era scritto QUALI fossero state
# applicate: lo sapeva solo chi le aveva lanciate, su due macchine
# diverse. Il 2026-09-09 una migrazione fu dimenticata; il 2026-09-12
# una fallii' e il deploy proseguii' comunque, mandando in produzione
# codice nuovo su schema vecchio. Nessuna delle due cose e' possibile
# con un registro e un codice d'uscita.
#
# COSA GARANTISCE
#   · ordine: i file si applicano in ordine di numero, mai a salti;
#   · una volta sola: quelle registrate non si ripetono;
#   · atomicita': migrazione e registrazione nella STESSA transazione,
#     quindi non esiste lo stato "applicata ma non registrata";
#   · immutabilita': un file modificato dopo essere stato applicato
#     ferma tutto, invece di far divergere in silenzio due macchine;
#   · arresto: exit != 0 alla prima che fallisce, cosi' il deploy si
#     ferma invece di proseguire;
#   · permessi: dopo ogni applicazione rilancia server/sql/permessi.sql,
#     perche' ALTER DEFAULT PRIVILEGES riconcede UPDATE/DELETE sulle
#     tabelle create o ricreate (dimostrato: e' cosi' che audit_log
#     aveva perso l'immutabilita').
#
# SUPERUTENTE. Le migrazioni girano come superutente del database, non
# come `payroll_user`: dal 2026-09-12 l'utente dell'applicazione non
# possiede piu' nessun oggetto, quindi un ALTER TABLE fatto con lui
# viene rifiutato con "must be owner of table". Vedi permessi.sql.
#
# USO
#   ./pgs-migra.sh                 # stato: applicate e da applicare
#   ./pgs-migra.sh applica         # applica le mancanti + permessi.sql
#   ./pgs-migra.sh baseline        # marca le presenti come applicate,
#                                  #   senza eseguirle (installazione nuova:
#                                  #   setup.sql le contiene gia' tutte)
#   ./pgs-migra.sh permessi        # solo permessi.sql + verifica
#
# CONNESSIONE. Letta da .env alla radice (DB_HOST/DB_PORT/DB_NAME) e
# sovrascrivibile:
#   PGS_PSQL  invocazione di psql   (default: rilevata; su aaPanel
#             `runuser -u postgres -- /www/server/pgsql/bin/psql`)
#   PGS_CONN  argomenti di connessione (default: da .env)
# ============================================================

set -Eeuo pipefail

RADICE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRAZIONI="$RADICE/server/src/db/migrations"
PERMESSI="$RADICE/server/sql/permessi.sql"
ENVFILE="$RADICE/.env"

rosso=$'\033[31m'; verde=$'\033[32m'; giallo=$'\033[33m'; grigio=$'\033[90m'; fine=$'\033[0m'
ok()      { printf '%s✓%s %s\n' "$verde"  "$fine" "$*"; }
avviso()  { printf '%s!%s %s\n' "$giallo" "$fine" "$*"; }
nota()    { printf '%s  %s%s\n' "$grigio" "$*" "$fine"; }
muori()   { printf '%s✗ %s%s\n' "$rosso" "$*" "$fine" >&2; exit 1; }

# ------------------------------------------------------------
# Connessione
# ------------------------------------------------------------
# .env NON e' sourceable: contiene valori con spazi non quotati
# (SMTP_FROM=Payroll Gang Suite <info@...>). Si legge una chiave alla volta.
leggi_env() {
  [[ -f "$ENVFILE" ]] || return 0
  sed -n "s/^$1=//p" "$ENVFILE" | head -n1 | tr -d '\r' | sed -e 's/^"//' -e 's/"$//'
}

if [[ -n "${PGS_PSQL:-}" ]]; then
  read -r -a PSQL <<< "$PGS_PSQL"
elif [[ -x /www/server/pgsql/bin/psql ]] && id postgres >/dev/null 2>&1 && [[ $(id -u) -eq 0 ]]; then
  # aaPanel: psql sta fuori dal PATH e BT-Security vieta `sudo -u`.
  PSQL=(runuser -u postgres -- /www/server/pgsql/bin/psql)
elif id postgres >/dev/null 2>&1 && [[ $(id -u) -eq 0 ]] && command -v psql >/dev/null 2>&1; then
  PSQL=(runuser -u postgres -- psql)
elif command -v psql >/dev/null 2>&1; then
  PSQL=(psql)
else
  muori "psql non trovato. Imposta PGS_PSQL con l'invocazione corretta."
fi

# Host e porta di .env servono all'APPLICAZIONE, che si collega come
# payroll_user. Qui si entra come SUPERUTENTE, e su TCP pg_hba di norma
# gli chiede una password che nessuno script deve conoscere: la via
# naturale e' il socket locale con autenticazione peer.
# Non si puo' nemmeno imporre il socket a priori: su aaPanel il cluster
# ascolta su 127.0.0.1 in trust e il socket puo' stare altrove. Quindi si
# provano le alternative in ordine e si tiene la prima che risponde.
# `-w` e' obbligatorio: senza, un prompt di password appenderebbe il
# deploy in attesa di un invio che nessuno digitera' mai.
CONN=()
prova_conn() { "${PSQL[@]}" "$@" -X -q -w -tAc 'SELECT 1' >/dev/null 2>&1; }

if [[ -n "${PGS_CONN:-}" ]]; then
  read -r -a CONN <<< "$PGS_CONN"
  prova_conn "${CONN[@]}" || muori "PGS_CONN non porta a un database raggiungibile: ${CONN[*]}"
else
  nome=$(leggi_env DB_NAME); [[ -n "$nome" ]] || nome=payroll_gang
  host=$(leggi_env DB_HOST); porta=$(leggi_env DB_PORT)
  tentativi=("-d|$nome")
  if [[ -n "$host" ]]; then
    if [[ -n "$porta" ]]; then tentativi+=("-d|$nome|-h|$host|-p|$porta")
    else                       tentativi+=("-d|$nome|-h|$host"); fi
  fi
  for t in "${tentativi[@]}"; do
    IFS='|' read -r -a candidato <<< "$t"
    if prova_conn "${candidato[@]}"; then CONN=("${candidato[@]}"); break; fi
  done
  [[ ${#CONN[@]} -gt 0 ]] || muori "non riesco a collegarmi a '$nome' come superutente.
  Provato: socket locale e ${host:-nessun host}:${porta:-5432}.
  Imposta PGS_CONN con gli argomenti giusti, per esempio:
    PGS_CONN='-d $nome -h 127.0.0.1 -p 5432' ./pgs-migra.sh stato"
fi

# Tutto passa da stdin, mai da -f su un percorso: con `runuser -u postgres`
# il file dovrebbe essere leggibile da postgres, e nelle cartelle del
# deploy (www:www) non sempre lo e'.
esegui_sql() { "${PSQL[@]}" "${CONN[@]}" -X -q -w -v ON_ERROR_STOP=1 "$@"; }
scalare()    { "${PSQL[@]}" "${CONN[@]}" -X -q -w -t -A -v ON_ERROR_STOP=1 -c "$1"; }

# ------------------------------------------------------------
# Registro
# ------------------------------------------------------------
assicura_registro() {
  esegui_sql <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  versione     text        PRIMARY KEY,
  nome_file    text        NOT NULL,
  checksum     text        NOT NULL,
  applicata_il timestamptz NOT NULL DEFAULT now(),
  applicata_da text        NOT NULL DEFAULT current_user,
  durata_ms    integer
);

COMMENT ON TABLE schema_migrations IS
  'Registro delle migrazioni applicate. Scritto solo da pgs-migra.sh; l''applicazione non lo legge ne'' lo scrive (non e'' in schema.ts).';
SQL
}

versione_di() { local b; b=$(basename "$1"); printf '%s' "${b%%_*}"; }
checksum_di() { sha256sum "$1" | cut -d' ' -f1; }

elenco_file() {
  [[ -d "$MIGRAZIONI" ]] || muori "cartella migrazioni assente: $MIGRAZIONI"
  local trovati=()
  while IFS= read -r f; do trovati+=("$f"); done < <(find "$MIGRAZIONI" -maxdepth 1 -name '[0-9]*.sql' | sort)
  [[ ${#trovati[@]} -gt 0 ]] || muori "nessuna migrazione in $MIGRAZIONI"
  printf '%s\n' "${trovati[@]}"
}

# Stampa lo stato e valorizza DA_APPLICARE.
DA_APPLICARE=()
calcola_stato() {
  DA_APPLICARE=()
  local f ver sum registrato
  while IFS= read -r f; do
    ver=$(versione_di "$f"); sum=$(checksum_di "$f")
    registrato=$(scalare "SELECT checksum FROM schema_migrations WHERE versione = '$ver';")
    if [[ -z "$registrato" ]]; then
      DA_APPLICARE+=("$f")
      printf '  %s da applicare%s  %s\n' "$giallo" "$fine" "$(basename "$f")"
    elif [[ "$registrato" == "$sum" ]]; then
      printf '  %s applicata   %s  %s\n' "$verde" "$fine" "$(basename "$f")"
    else
      printf '  %s MODIFICATA  %s  %s\n' "$rosso" "$fine" "$(basename "$f")"
      muori "$(basename "$f") e' stata modificata DOPO essere stata applicata.
  Registrato: $registrato
  Sul disco:  $sum
  Una migrazione applicata e' storia, non codice: non si riscrive. Scrivi
  una migrazione nuova che porti lo schema dove serve. Se il file era
  stato corretto prima di arrivare in produzione altrove, allinea il
  registro a mano dopo aver verificato che i due schemi coincidano."
    fi
  done < <(elenco_file)
}

applica_permessi() {
  [[ -f "$PERMESSI" ]] || muori "manca $PERMESSI"
  esegui_sql < "$PERMESSI" >/dev/null
  ok "permessi riallineati e verificati"
}

# ------------------------------------------------------------
# Comandi
# ------------------------------------------------------------
comando=${1:-stato}

case "$comando" in

  stato)
    assicura_registro
    printf '\nMigrazioni in %s\n\n' "$MIGRAZIONI"
    calcola_stato
    printf '\n'
    if [[ ${#DA_APPLICARE[@]} -eq 0 ]]; then
      ok "schema allineato: nessuna migrazione da applicare"
    else
      avviso "${#DA_APPLICARE[@]} da applicare — lancia: ./pgs-migra.sh applica"
    fi
    ;;

  applica)
    assicura_registro
    printf '\nMigrazioni in %s\n\n' "$MIGRAZIONI"
    calcola_stato
    printf '\n'

    if [[ ${#DA_APPLICARE[@]} -eq 0 ]]; then
      ok "niente da applicare"
      applica_permessi
      exit 0
    fi

    for f in "${DA_APPLICARE[@]}"; do
      base=$(basename "$f"); ver=$(versione_di "$f"); sum=$(checksum_di "$f")
      printf '→ %s\n' "$base"
      inizio=$(date +%s%3N)

      # Alcune istruzioni non possono stare in una transazione
      # (CREATE INDEX CONCURRENTLY, ALTER TYPE ... ADD VALUE su versioni
      # vecchie). Chi ne scrive una mette in testa al file il marcatore
      #   -- pgs:senza-transazione
      # e accetta che, se fallisce a metà, va ripulita a mano.
      if grep -qi '^-- *pgs:senza-transazione' "$f"; then
        avviso "$base dichiara di non poter girare in transazione"
        esegui_sql < "$f"
        durata=$(( $(date +%s%3N) - inizio ))
        esegui_sql -c "INSERT INTO schema_migrations (versione, nome_file, checksum, durata_ms)
                       VALUES ('$ver', '$base', '$sum', $durata);"
      else
        durata_segnaposto=0
        # Migrazione e registrazione nella stessa transazione: o passano
        # entrambe, o non e' passato niente.
        { cat "$f"
          printf "\nINSERT INTO schema_migrations (versione, nome_file, checksum, durata_ms) VALUES ('%s','%s','%s',%s);\n" \
                 "$ver" "$base" "$sum" "$durata_segnaposto"
        } | esegui_sql --single-transaction
        durata=$(( $(date +%s%3N) - inizio ))
        esegui_sql -c "UPDATE schema_migrations SET durata_ms = $durata WHERE versione = '$ver';"
      fi

      ok "$base applicata (${durata} ms)"
    done

    printf '\n'
    applica_permessi
    printf '\n'
    ok "schema allineato"
    ;;

  baseline)
    # Installazione nuova: setup.sql e' il consolidato dello schema e
    # contiene GIA' il contenuto di tutte le migrazioni presenti. Qui si
    # registrano come applicate senza eseguirle, altrimenti al primo
    # `applica` si ripeterebbero su uno schema che le ha gia'.
    assicura_registro
    presenti=$(scalare "SELECT count(*) FROM schema_migrations;")
    if [[ "$presenti" != "0" && "${2:-}" != "--forza" ]]; then
      muori "il registro contiene gia' $presenti migrazioni.
  La baseline si fa una volta sola, su un database appena creato.
  Se sai cosa stai facendo: ./pgs-migra.sh baseline --forza"
    fi
    n=0
    while IFS= read -r f; do
      base=$(basename "$f"); ver=$(versione_di "$f"); sum=$(checksum_di "$f")
      esegui_sql -c "INSERT INTO schema_migrations (versione, nome_file, checksum, durata_ms)
                     VALUES ('$ver', '$base', '$sum', 0)
                     ON CONFLICT (versione) DO UPDATE
                       SET checksum = EXCLUDED.checksum, nome_file = EXCLUDED.nome_file;"
      n=$((n+1))
    done < <(elenco_file)
    ok "$n migrazioni marcate come applicate (contenute in setup.sql)"
    applica_permessi
    ;;

  permessi)
    applica_permessi
    ;;

  *)
    muori "comando non riconosciuto: $comando
  Usa: stato | applica | baseline | permessi"
    ;;
esac
