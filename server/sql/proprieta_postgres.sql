-- ============================================================
-- PAYROLL GANG SUITE — Proprieta' degli oggetti al superutente
--
-- SOSTITUISCE `owner_payroll_user.sql`, che faceva l'esatto contrario.
-- Quel file nasceva da una premessa che si e' rivelata sbagliata: si era
-- concluso che l'incidente del 2026-09-09 ("must be owner of table")
-- fosse causato dalla proprieta' delle tabelle, e si era passata la
-- proprieta' all'utente applicativo per dargli i diritti DDL. La causa
-- vera era un'altra: lo script di deploy non controllava l'esito del
-- psql e proseguiva su una migrazione fallita. Dare i diritti DDL
-- all'utente con cui si connette il server non era la soluzione, era
-- un allargamento di superficie.
--
-- LA REGOLA DI OGGI: tutti gli oggetti sono del superutente, le
-- migrazioni girano da superutente, `payroll_user` ha solo il DML.
--
-- QUANDO SERVE QUESTO FILE
--   · dopo un ripristino dal pannello aaPanel: il restore gira come
--     `payroll_user` e ricrea le tabelle di sua proprieta', annullando
--     da solo la regola;
--   · dopo una migrazione applicata per errore con l'utente sbagliato
--     (e' cosi' che `emolumenti_lavorazioni` e' rimasta indietro);
--   · quando `permessi.sql` esce in errore alla verifica 3.1.
--
-- SEQUENZE. Quelle nate da una colonna SERIAL/IDENTITY sono "linked"
-- alla tabella: Postgres rifiuta un ALTER SEQUENCE ... OWNER TO
-- separato ("cannot change owner of sequence ... linked to table") e
-- seguono da sole la tabella. Vengono quindi saltate. Le sequenze
-- indipendenti, se ci sono, vengono riassegnate.
--
-- I PERMESSI VANNO RIDATI DOPO, SEMPRE. ALTER ... OWNER TO riscrive la
-- ACL e rimappa sul nuovo proprietario le voci del vecchio: i GRANT a
-- payroll_user concessi *dal* vecchio proprietario vengono riassorbiti
-- e spariscono. Il 2026-09-12 e' costato un 500 su Emolumenti. Per
-- questo il file finisce chiamando `permessi.sql`, e non si limita a
-- consigliarlo.
--
-- USO (come superutente):
--   psql -v ON_ERROR_STOP=1 -U postgres -d payroll_gang \
--        -f server/sql/proprieta_postgres.sql
-- ============================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
  r        record;
  oggetto  text;
  fatti    int := 0;
  saltati  int := 0;
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Serve un superutente: ora sei %.', current_user;
  END IF;

  FOR r IN
    SELECT c.oid, c.relkind, n.nspname AS sch, c.relname AS nome
    FROM   pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE  n.nspname = 'public'
      AND  c.relkind IN ('r','p','S','v','m')
      AND  pg_get_userbyid(c.relowner) <> current_user
      -- sequenze legate a una colonna: seguono la tabella
      AND  NOT (c.relkind = 'S' AND EXISTS (
             SELECT 1 FROM pg_depend d
             WHERE  d.objid   = c.oid
               AND  d.classid = 'pg_class'::regclass
               AND  d.deptype IN ('a','i')))
    ORDER  BY c.relkind, c.relname
  LOOP
    oggetto := CASE r.relkind
                 WHEN 'S' THEN 'SEQUENCE'
                 WHEN 'v' THEN 'VIEW'
                 WHEN 'm' THEN 'MATERIALIZED VIEW'
                 ELSE 'TABLE'
               END;
    -- Ogni oggetto a se': un errore su uno non annulla il lavoro sugli
    -- altri. Il primo tentativo di questo script, mesi fa, si fermo'
    -- alla prima sequenza e rollbacko' l'intero blocco.
    BEGIN
      EXECUTE format('ALTER %s %I.%I OWNER TO %I', oggetto, r.sch, r.nome, current_user);
      fatti := fatti + 1;
    EXCEPTION WHEN OTHERS THEN
      saltati := saltati + 1;
      RAISE NOTICE 'saltato %.%: %', r.sch, r.nome, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Oggetti passati a %: % · saltati: %', current_user, fatti, saltati;
END
$$;

-- OBBLIGATORIO, non opzionale: l'ALTER qui sopra ha riassorbito i GRANT.
\ir permessi.sql
