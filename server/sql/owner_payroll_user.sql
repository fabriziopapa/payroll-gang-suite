-- ============================================================
-- PAYROLL GANG SUITE — Proprieta' degli oggetti applicativi
--
-- PERCHE'. setup.sql crea le tabelle come `postgres`, quindi il proprietario
-- resta `postgres` mentre l'applicazione si connette come `payroll_user`.
-- payroll_user ha i permessi DML ma NON quelli DDL: ogni migrazione che fa
-- ALTER TABLE viene rifiutata con
--     ERROR: must be owner of table <nome>
-- e — se lo script di deploy non controlla l'esito — il codice nuovo parte
-- comunque contro uno schema vecchio (incidente 2026-09-09, colonna
-- anagrafiche.area_conto).
--
-- COSA FA. Passa a payroll_user la proprieta' di tabelle e viste dello schema
-- public, e gli concede CREATE sullo schema.
--
-- SEQUENZE. Quelle create da una colonna SERIAL/IDENTITY NON si toccano: sono
-- "linked" alla loro tabella e Postgres rifiuta un ALTER SEQUENCE ... OWNER TO
-- separato ("cannot change owner of sequence ... is linked to table ...").
-- Seguono da sole il proprietario della tabella, quindi vengono saltate. Le
-- sequenze indipendenti, se ce ne sono, vengono invece riassegnate.
--
-- OGNI OGGETTO E' A SE'. Un errore su un oggetto non fa fallire tutto il resto:
-- viene segnalato con un NOTICE e lo script prosegue. Il primo tentativo di
-- questo script si fermo' alla prima sequenza e annullo' l'intero blocco.
--
-- NON tocca i GRANT gia' concessi: la proprieta' aggiunge i diritti DDL.
--
-- USO — come superutente `postgres`, UNA VOLTA SOLA:
--   psql -h <DB_HOST> -p <DB_PORT> -U postgres -d payroll_gang \
--        -f server/sql/owner_payroll_user.sql
--
-- Idempotente: rilanciarlo non ha effetti.
-- ============================================================

DO $$
DECLARE
  r        record;
  oggetto  text;
  fatti    int := 0;
  saltati  int := 0;
BEGIN
  FOR r IN
    SELECT c.oid, c.relkind, n.nspname AS sch, c.relname AS nome
    FROM   pg_class c
    JOIN   pg_namespace n ON n.oid = c.relnamespace
    WHERE  n.nspname = 'public'
    AND    c.relkind IN ('r','p','S','v','m')
    AND    pg_get_userbyid(c.relowner) <> 'payroll_user'
    -- sequenze legate a una colonna (SERIAL / IDENTITY): saltate, seguono la tabella
    AND    NOT (c.relkind = 'S' AND EXISTS (
             SELECT 1 FROM pg_depend d
             WHERE  d.objid   = c.oid
             AND    d.classid = 'pg_class'::regclass
             AND    d.deptype IN ('a','i')
           ))
    -- audit_log resta di `postgres`: il REVOKE sull'immutabilita' vale solo
    -- finche' payroll_user NON e' proprietario — un proprietario puo' sempre
    -- riconcedersi UPDATE/DELETE/TRUNCATE. Una migrazione su questa tabella
    -- richiedera' il superutente, ed e' il prezzo giusto da pagare.
    AND    c.relname <> 'audit_log'
    ORDER  BY c.relkind, c.relname
  LOOP
    oggetto := CASE r.relkind
                 WHEN 'S' THEN 'SEQUENCE'
                 WHEN 'v' THEN 'VIEW'
                 WHEN 'm' THEN 'MATERIALIZED VIEW'
                 ELSE 'TABLE'
               END;
    BEGIN
      EXECUTE format('ALTER %s %I.%I OWNER TO payroll_user', oggetto, r.sch, r.nome);
      fatti := fatti + 1;
    EXCEPTION WHEN OTHERS THEN
      saltati := saltati + 1;
      RAISE NOTICE 'saltato %.%: %', r.sch, r.nome, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Oggetti passati a payroll_user: % · saltati: %', fatti, saltati;
END
$$;

-- Serve a payroll_user per creare nuovi oggetti nelle migrazioni future.
GRANT USAGE, CREATE ON SCHEMA public TO payroll_user;

-- Verifica: la colonna "proprietario" deve essere payroll_user ovunque.
SELECT c.relname AS oggetto,
       pg_get_userbyid(c.relowner) AS proprietario
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public'
AND    c.relkind IN ('r','p')
ORDER  BY proprietario, c.relname;
