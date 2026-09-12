-- ============================================================
-- PAYROLL GANG SUITE — Permessi dell'utente applicativo
--
-- Fonte unica di verita' sui privilegi di `payroll_user`. Rilanciabile
-- quante volte si vuole, su qualsiasi macchina, in qualsiasi momento:
-- porta il database allo stato voluto e FALLISCE se non ci riesce.
--
-- ------------------------------------------------------------
-- PERCHE' ESISTE (tre incidenti, un unico difetto)
--
-- 2026-09-09  Migrazione 0011 rifiutata con "must be owner of table":
--             lo script di deploy non controllava l'esito e il codice
--             nuovo parti' contro uno schema vecchio.
-- 2026-09-12  Un ALTER TABLE ... OWNER TO ha RIASSORBITO il GRANT dato
--             un istante prima nella stessa transazione: cambiare
--             proprietario riscrive la ACL e rimappa le voci del vecchio
--             proprietario sul nuovo. Emolumenti e' andato in 500.
-- 2026-09-12  `audit_log` risultava modificabile da payroll_user, pur
--             essendoci il REVOKE in setup.sql. Causa dimostrata in
--             laboratorio: ALTER DEFAULT PRIVILEGES riconcede
--             UPDATE/DELETE su ogni tabella CREATA DOPO, quindi su una
--             audit_log ricreata l'immutabilita' spariva da sola.
--
-- Il difetto comune non era l'ordine sbagliato: era che NESSUNO
-- VERIFICAVA LO STATO FINALE. Questo file lo verifica, e se lo stato
-- non e' quello atteso solleva un'eccezione invece di uscire con 0.
-- ------------------------------------------------------------
--
-- DUE REGOLE, da qui in avanti:
--
--   1. payroll_user NON possiede nessun oggetto. Non e' una formalita':
--      senza la proprieta' non puo' fare ALTER ne' DROP sulle tabelle
--      esistenti (verificato: "must be owner of table bozze"), quindi un
--      difetto nel codice server puo' al massimo danneggiare i dati, non
--      portarsi via la struttura.
--
--   2. Le migrazioni girano come SUPERUTENTE, e dopo ogni migrazione
--      si rilancia questo file. E' il prezzo della regola 1, ed e'
--      giusto: una migrazione e' un atto deliberato in SSH, non
--      qualcosa che deve poter fare il processo Node.
--
-- ORDINE OBBLIGATO — non riordinare le sezioni:
--   GRANT a tappeto  →  REVOKE puntuali  →  verifica
-- Il generale sovrascrive il particolare: un REVOKE messo prima di un
-- GRANT ON ALL TABLES non sopravvive. E un GRANT messo prima di un
-- ALTER ... OWNER TO non sopravvive nemmeno lui.
--
-- USO (come superutente, dal database applicativo):
--   psql -v ON_ERROR_STOP=1 -U postgres -d payroll_gang \
--        -f server/sql/permessi.sql
--
-- Su aaPanel:
--   runuser -u postgres -- /www/server/pgsql/bin/psql -v ON_ERROR_STOP=1 \
--     -h 127.0.0.1 -d payroll_gang -f server/sql/permessi.sql
-- ============================================================

\set ON_ERROR_STOP on

-- ------------------------------------------------------------
-- 0 — Presupposti
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payroll_user') THEN
    RAISE EXCEPTION
      'Il ruolo payroll_user non esiste: esegui prima server/sql/setup.sql.';
  END IF;

  -- Chi esegue deve poter concedere su oggetti che non possiede.
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION
      'Questo file va eseguito da un superutente: ora sei %.', current_user;
  END IF;
END
$$;

-- ------------------------------------------------------------
-- 1 — GRANT a tappeto
--
-- current_database() invece del nome scritto a mano: lo stesso file
-- serve produzione, pre-produzione e i database usa-e-getta di prova.
-- ------------------------------------------------------------
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO payroll_user', current_database());
END
$$;

-- CREATE sullo schema: serve ai RIPRISTINI, non alle migrazioni.
--
-- Il restore del pannello aaPanel e cpanel-restore-dump.sh girano come
-- `payroll_user` e ricreano le tabelle: senza CREATE il ripristino
-- fallisce, e se ne scopre il giorno peggiore.
--
-- Non e' la falla che sembra. Anche con CREATE, payroll_user non puo'
-- toccare le tabelle esistenti — quello dipende dalla PROPRIETA', non
-- da questo permesso (prova del 2026-09-12: DROP TABLE bozze respinto
-- con "must be owner of table bozze"). CREATE gli consente solo di
-- creare oggetti nuovi.
--
-- Inutile provare a togliergliela senza prima spostare lo schema: da
-- PostgreSQL 15 `public` appartiene a `pg_database_owner`, e
-- setup.sql crea il database con OWNER payroll_user — quindi possiede
-- `public` per via implicita e ogni REVOKE resta senza effetto (la
-- verifica 3.6 lo segnala). Renderlo effettivo richiederebbe
-- ALTER SCHEMA public OWNER TO postgres, che e' esattamente cio' che
-- romperebbe i ripristini.
GRANT USAGE, CREATE ON SCHEMA public TO payroll_user;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO payroll_user;
GRANT USAGE, SELECT                 ON ALL SEQUENCES  IN SCHEMA public TO payroll_user;

-- Tabelle e sequenze create in futuro: coperte senza dover ripassare qui.
-- ATTENZIONE: questo e' anche cio' che riconcede UPDATE/DELETE su una
-- tabella ricreata, audit_log compresa. E' il motivo per cui la sezione 2
-- deve venire DOPO, e per cui questo file va rilanciato dopo ogni
-- migrazione che crei o ricrei tabelle.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO payroll_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO payroll_user;

-- ------------------------------------------------------------
-- 2 — REVOKE puntuali (SEMPRE dopo la sezione 1)
-- ------------------------------------------------------------

-- Registro di audit: append-only. L'interfaccia IAuditRepository espone
-- log/findRecent/query e nessun metodo di modifica, quindi togliere
-- UPDATE/DELETE/TRUNCATE non rompe alcun percorso del codice.
-- Regge solo finche' payroll_user NON e' proprietario della tabella:
-- un proprietario puo' sempre riconcedersi tutto. Vedi sezione 3.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = 'audit_log') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM payroll_user;
  END IF;
END
$$;

-- ------------------------------------------------------------
-- 3 — VERIFICA
--
-- Da qui in giu' non si concede piu' niente: si controlla. Se una sola
-- attesa non e' soddisfatta il file esce in errore, cosi' chi lo ha
-- lanciato (o lo script di deploy) se ne accorge subito.
-- ------------------------------------------------------------
DO $$
DECLARE
  elenco text;
BEGIN
  ----------------------------------------------------------------
  -- 3.1  payroll_user non deve possedere nulla.
  --
  -- Il confronto e' con "diverso da payroll_user" e non con "uguale a
  -- postgres": il superutente non si chiama postgres su ogni macchina
  -- (in pre-produzione cPanel ha un altro nome), mentre l'invariante da
  -- difendere e' sempre lo stesso — l'utente dell'applicazione non
  -- possiede la struttura.
  ----------------------------------------------------------------
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO elenco
  FROM   pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE  n.nspname = 'public'
    AND  c.relkind IN ('r','p','v','m','S')
    AND  pg_get_userbyid(c.relowner) = 'payroll_user';

  IF elenco IS NOT NULL THEN
    RAISE EXCEPTION
      'payroll_user e'' proprietario di: %. Esegui server/sql/proprieta_postgres.sql.',
      elenco;
  END IF;

  ----------------------------------------------------------------
  -- 3.2  Lettura e scrittura su tutte le tabelle.
  ----------------------------------------------------------------
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO elenco
  FROM   pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE  n.nspname = 'public' AND c.relkind IN ('r','p')
    AND  NOT (has_table_privilege('payroll_user', c.oid, 'SELECT')
         AND  has_table_privilege('payroll_user', c.oid, 'INSERT'));

  IF elenco IS NOT NULL THEN
    RAISE EXCEPTION 'payroll_user non puo'' leggere o inserire su: %.', elenco;
  END IF;

  ----------------------------------------------------------------
  -- 3.3  Modifica e cancellazione su tutte, TRANNE audit_log.
  ----------------------------------------------------------------
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO elenco
  FROM   pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE  n.nspname = 'public' AND c.relkind IN ('r','p')
    AND  c.relname <> 'audit_log'
    AND  NOT (has_table_privilege('payroll_user', c.oid, 'UPDATE')
         AND  has_table_privilege('payroll_user', c.oid, 'DELETE'));

  IF elenco IS NOT NULL THEN
    RAISE EXCEPTION 'payroll_user non puo'' aggiornare o cancellare su: %.', elenco;
  END IF;

  ----------------------------------------------------------------
  -- 3.4  audit_log immutabile.
  ----------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = 'audit_log') THEN

    IF NOT has_table_privilege('payroll_user', 'audit_log', 'INSERT') THEN
      RAISE EXCEPTION 'payroll_user non puo'' scrivere in audit_log: l''audit si fermerebbe.';
    END IF;

    IF has_table_privilege('payroll_user', 'audit_log', 'UPDATE')
    OR has_table_privilege('payroll_user', 'audit_log', 'DELETE')
    OR has_table_privilege('payroll_user', 'audit_log', 'TRUNCATE') THEN
      RAISE EXCEPTION
        'audit_log e'' modificabile da payroll_user: immutabilita'' violata.';
    END IF;
  END IF;

  ----------------------------------------------------------------
  -- 3.5  Sequenze: senza USAGE il primo INSERT muore con
  --      "permission denied for sequence".
  ----------------------------------------------------------------
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO elenco
  FROM   pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE  n.nspname = 'public' AND c.relkind = 'S'
    AND  NOT (has_sequence_privilege('payroll_user', c.oid, 'USAGE')
         AND  has_sequence_privilege('payroll_user', c.oid, 'SELECT'));

  IF elenco IS NOT NULL THEN
    RAISE EXCEPTION 'payroll_user non puo'' usare le sequenze: %.', elenco;
  END IF;

  ----------------------------------------------------------------
  -- 3.6  Nessun privilegio di troppo.
  ----------------------------------------------------------------
  -- CREATE sullo schema: segnalato, non bloccante. E' voluto (serve ai
  -- ripristini) e per di piu' inevitabile finche' payroll_user possiede
  -- il database. Resta a video perche' chi legge sappia com'e' questa
  -- macchina, senza dover interrogare pg_namespace.
  IF has_schema_privilege('payroll_user', 'public', 'CREATE') THEN
    IF (SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = 'public')
       = 'pg_database_owner'
       AND (SELECT datdba::regrole::text FROM pg_database WHERE datname = current_database())
       = 'payroll_user' THEN
      RAISE NOTICE
        'payroll_user ha CREATE su public perche'' possiede il database (schema di pg_database_owner). Non puo'' comunque alterare o cancellare le tabelle esistenti.';
    ELSE
      RAISE NOTICE
        'payroll_user ha CREATE su public (concesso: serve ai ripristini). Non puo'' comunque alterare o cancellare le tabelle esistenti.';
    END IF;
  END IF;

  IF (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls
      FROM pg_roles WHERE rolname = 'payroll_user') THEN
    RAISE EXCEPTION
      'payroll_user ha attributi di ruolo che non deve avere (super/createdb/createrole/bypassrls).';
  END IF;

  RAISE NOTICE 'Permessi verificati: payroll_user ha il DML, non possiede nulla, audit_log immutabile.';
END
$$;

-- Riepilogo leggibile, per chi guarda l'output.
SELECT c.relname                                               AS tabella,
       pg_get_userbyid(c.relowner)                             AS proprietario,
       has_table_privilege('payroll_user', c.oid, 'SELECT')    AS sel,
       has_table_privilege('payroll_user', c.oid, 'INSERT')    AS ins,
       has_table_privilege('payroll_user', c.oid, 'UPDATE')    AS upd,
       has_table_privilege('payroll_user', c.oid, 'DELETE')    AS del
FROM   pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public' AND c.relkind IN ('r','p')
ORDER  BY c.relname;
