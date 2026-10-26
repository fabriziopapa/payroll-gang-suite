-- ============================================================
-- Migration 0021 — Versamenti enti: rubrica degli enti e modelli mail
--
-- COSA. Due tabelle per il modulo "Versamenti enti" (porting strutturato
-- di GestioneSaldiEnti):
--   · versamenti_modelli  i modelli di messaggio: nome, oggetto, testo con
--                         segnaposto e configurazione degli allegati
--                         (JSON: quali file, colonne, CSV, PDF, nomi file);
--                         uno solo e' il predefinito (indice unico parziale);
--   · versamenti_enti     la rubrica: un ente per riga, con descrizione,
--                         elenco di email, abilitato, modello scelto e
--                         ultimo file in cui e' comparso.
--
-- PERCHE'. La stampa versamenti di CSA si elabora AL VOLO nel browser:
-- nominativi, matricole, codici fiscali, date di nascita e importi non
-- arrivano mai al server. PGS ricorda solo cio' che serve a rifare il
-- lavoro il mese dopo: a chi scrivere e con quale testo.
--
-- REGOLE
--   · un ente mai visto entra ABILITATO, senza email (come nel Java);
--   · `email` e' un elenco: piu' destinatari nel campo A: dell'EML;
--   · `modello_id` vuoto = l'ente usa il modello predefinito; se il
--     modello viene eliminato l'ente torna al predefinito (SET NULL);
--   · un solo modello predefinito, garantito dal database.
--
-- PRIVACY. Nessun dato personale: codici e descrizioni degli enti, i loro
-- indirizzi istituzionali, i testi dei modelli.
--
-- NON si applica a mano:   ./pgs-migra.sh applica
-- Gira come superutente. Additiva e idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS versamenti_modelli (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         VARCHAR(80)   NOT NULL,
  oggetto      VARCHAR(200)  NOT NULL,
  testo        TEXT          NOT NULL CHECK (char_length(testo) BETWEEN 1 AND 8000),
  allegati     JSONB         NOT NULL,
  predefinito  BOOLEAN       NOT NULL DEFAULT FALSE,
  created_by   UUID          REFERENCES users(id) ON DELETE SET NULL,
  updated_by   UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- UN solo predefinito: lo garantisce il database, non il codice.
CREATE UNIQUE INDEX IF NOT EXISTS versamenti_modelli_un_predefinito
  ON versamenti_modelli (predefinito) WHERE predefinito;
CREATE UNIQUE INDEX IF NOT EXISTS versamenti_modelli_nome
  ON versamenti_modelli (lower(nome));

CREATE TABLE IF NOT EXISTS versamenti_enti (
  codice        VARCHAR(20)   PRIMARY KEY CHECK (codice ~ '^[A-Za-z0-9._-]{1,20}$'),
  descrizione   VARCHAR(200)  NOT NULL,
  email         TEXT[]        NOT NULL DEFAULT '{}' CHECK (cardinality(email) <= 20),
  abilitato     BOOLEAN       NOT NULL DEFAULT TRUE,
  modello_id    UUID          REFERENCES versamenti_modelli(id) ON DELETE SET NULL,
  ultimo_file   VARCHAR(200),
  ultimo_visto  DATE,
  created_by    UUID          REFERENCES users(id) ON DELETE SET NULL,
  updated_by    UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON TABLE versamenti_enti IS
  'Rubrica del modulo Versamenti enti: enti della stampa versamenti CSA con email (elenco), abilitazione e modello mail. Nessun dato personale: le righe del CSV si elaborano nel browser e non si salvano.';
COMMENT ON TABLE versamenti_modelli IS
  'Modelli di messaggio del modulo Versamenti enti: oggetto e testo con segnaposto, configurazione degli allegati in JSON. Uno solo predefinito.';

-- Modelli iniziali: solo su tabella vuota, cosi' rilanciarla non duplica
-- e non resuscita un modello eliminato nel frattempo.
INSERT INTO versamenti_modelli (nome, oggetto, testo, allegati, predefinito)
SELECT v.nome, v.oggetto, v.testo, v.allegati::jsonb, v.predefinito
FROM (VALUES
  ('Standard con periodo',
   'Dettagli versamento trattenute mensili -  {DESCRIZIONE_ENTE}',
   E'Spett.le {DESCRIZIONE_ENTE},\n\nin allegato i tabulati di dettaglio del versamento delle trattenute effettuate dalle retribuzioni dei nostri dipendenti {PERIODO} a cura dello scrivente ufficio.\n\n\nCordiali saluti,\n\n\n\n\nUniversità degli Studi di Napoli Parthenope \n Ufficio Stipendi ed Emolumenti al Personale Esterno \n Via Amm. F. Acton, 38 - 80133 Napoli \n +39 081 547 5808 -5881 -5649 -4428 -5816',
   '{"nomeEml":"email_{CODICE_ENTE}","nomeAllegati":"ente_{CODICE_ENTE}","ordine":"mese","csv":{"attivo":true,"sep":";","decimali":"virgola","codifica":"w1252","intestazione":true},"pdf":{"attivo":true,"titolo":"Dettagli per l''ente: {CODICE_ENTE}","orient":"p","subtotali":true,"totale":true},"colonne":[{"k":"NOME","csv":"nome","pdf":"Nominativo","on":true},{"k":"DATA_NASCITA","csv":"data_nascita","pdf":"Data di nascita","on":true},{"k":"MATRICOLA","csv":"matricola","pdf":"Matricola","on":false},{"k":"COD_FISC","csv":"cod_fisc","pdf":"Codice fiscale","on":false},{"k":"MESE","csv":"mese","pdf":"Mese","on":true,"soloMulti":true},{"k":"VOCE","csv":"voce","pdf":"Voce","on":true},{"k":"IMPORTO","csv":"importo","pdf":"Importo","on":true}]}',
   TRUE),
  ('Testo del Java («nel mese scorso»)',
   'Dettagli versamento trattenute mensili -  {DESCRIZIONE_ENTE}',
   E'Spett.le {DESCRIZIONE_ENTE},\n\nin allegato i tabulati di dettaglio del versamento delle trattenute effettuate dalle retribuzioni dei nostri dipendenti nel mese scorso a cura dello scrivente ufficio.\n\n\nCordiali saluti,\n\n\n\n\nUniversità degli Studi di Napoli Parthenope \n Ufficio Stipendi ed Emolumenti al Personale Esterno \n Via Amm. F. Acton, 38 - 80133 Napoli \n +39 081 547 5808 -5881 -5649 -4428 -5816',
   '{"nomeEml":"email_{CODICE_ENTE}","nomeAllegati":"ente_{CODICE_ENTE}","ordine":"mese","csv":{"attivo":true,"sep":";","decimali":"virgola","codifica":"w1252","intestazione":true},"pdf":{"attivo":true,"titolo":"Dettagli per l''ente: {CODICE_ENTE}","orient":"p","subtotali":true,"totale":true},"colonne":[{"k":"NOME","csv":"nome","pdf":"Nominativo","on":true},{"k":"DATA_NASCITA","csv":"data_nascita","pdf":"Data di nascita","on":true},{"k":"MATRICOLA","csv":"matricola","pdf":"Matricola","on":false},{"k":"COD_FISC","csv":"cod_fisc","pdf":"Codice fiscale","on":false},{"k":"MESE","csv":"mese","pdf":"Mese","on":true,"soloMulti":true},{"k":"VOCE","csv":"voce","pdf":"Voce","on":true},{"k":"IMPORTO","csv":"importo","pdf":"Importo","on":true}]}',
   FALSE)
) AS v(nome, oggetto, testo, allegati, predefinito)
WHERE NOT EXISTS (SELECT 1 FROM versamenti_modelli);
