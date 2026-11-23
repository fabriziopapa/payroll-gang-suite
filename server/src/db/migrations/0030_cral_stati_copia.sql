-- ============================================================
-- Migration 0030 — Modulo CRAL: stati degli eventi personalizzabili,
-- copia degli eventi
--
-- STATI. Fino alla 0029 un evento era BOZZA, APERTA o CHIUSA (vincolo
-- CHECK) e le regole stavano solo nel browser. Dalla 26.11.23 gli stati
-- sono una tabella che si gestisce in Parametri: nome, colore, ordine,
-- attivo e una REGOLA, scelta fra sei fisse, che decide cosa si puo' fare
-- (il server la controlla a ogni scrittura):
--   · PREPARAZIONE     scelte, ordini, iscrizioni e pagamenti; niente consegne
--   · RACCOLTA         tutto
--   · RACCOLTA_CHIUSA  niente nuove scelte, ordini o iscrizioni; consegne e pagamenti si'
--   · SOSPESO          niente
--   · CONCLUSO         niente: sola lettura, ma resta fra gli eventi attivi
--   · ANNULLATO        niente: barrato in elenco, fuori dalla scheda della persona
-- I tre stati di prima tengono il loro codice (BOZZA, APERTA, CHIUSA):
-- gli eventi esistenti non cambiano. Se ne aggiungono quattro.
--
-- COPIA. cral_iniziative.copiato_da: l'evento da cui e' stato copiato
-- (si azzera se quello viene cancellato). cral_scelte.fonte accetta
-- 'copia': scelta riportata da un altro evento come punto di partenza.
--
-- NON si applica a mano:   ./pgs-migra.sh applica
-- Gira come superutente. Additiva e idempotente: rilanciarla non cambia nulla.
-- ============================================================

CREATE TABLE IF NOT EXISTS cral_stati_evento (
  id      VARCHAR(10)  PRIMARY KEY CHECK (id ~ '^[A-Z0-9]{1,10}$'),
  nome    VARCHAR(60)  NOT NULL CHECK (char_length(btrim(nome)) > 0),
  colore  CHAR(7)      NOT NULL DEFAULT '#64748B' CHECK (colore ~ '^#[0-9A-Fa-f]{6}$'),
  regola  VARCHAR(16)  NOT NULL CHECK (regola IN ('PREPARAZIONE', 'RACCOLTA', 'RACCOLTA_CHIUSA', 'SOSPESO', 'CONCLUSO', 'ANNULLATO')),
  attivo  BOOLEAN      NOT NULL DEFAULT TRUE,
  ordine  INTEGER      NOT NULL DEFAULT 0
);

INSERT INTO cral_stati_evento (id, nome, colore, regola, ordine) VALUES
  ('BOZZA',     'Bozza',           '#64748B', 'PREPARAZIONE',    1),
  ('APERTA',    'Raccolta aperta', '#16A34A', 'RACCOLTA',        2),
  ('CHIUSA',    'Raccolta chiusa', '#0891B2', 'RACCOLTA_CHIUSA', 3),
  ('CONSEGNA',  'In consegna',     '#7C3AED', 'RACCOLTA_CHIUSA', 4),
  ('SOSPESO',   'Sospeso',         '#D97706', 'SOSPESO',         5),
  ('CONCLUSO',  'Concluso',        '#475569', 'CONCLUSO',        6),
  ('ANNULLATO', 'Annullato',       '#DC2626', 'ANNULLATO',       7)
ON CONFLICT (id) DO NOTHING;

-- lo stato dell'evento diventa un riferimento alla tabella (al posto del CHECK)
ALTER TABLE cral_iniziative ALTER COLUMN stato TYPE VARCHAR(10);
ALTER TABLE cral_iniziative DROP CONSTRAINT IF EXISTS cral_iniziative_stato_check;
ALTER TABLE cral_iniziative DROP CONSTRAINT IF EXISTS cral_iniziative_stato_fkey;
ALTER TABLE cral_iniziative ADD CONSTRAINT cral_iniziative_stato_fkey
  FOREIGN KEY (stato) REFERENCES cral_stati_evento(id) ON UPDATE CASCADE;

ALTER TABLE cral_iniziative ADD COLUMN IF NOT EXISTS copiato_da UUID;
ALTER TABLE cral_iniziative DROP CONSTRAINT IF EXISTS cral_iniziative_copiato_da_fkey;
ALTER TABLE cral_iniziative ADD CONSTRAINT cral_iniziative_copiato_da_fkey
  FOREIGN KEY (copiato_da) REFERENCES cral_iniziative(id) ON DELETE SET NULL;

ALTER TABLE cral_scelte DROP CONSTRAINT IF EXISTS cral_scelte_fonte_check;
ALTER TABLE cral_scelte ADD CONSTRAINT cral_scelte_fonte_check CHECK (fonte IN ('manuale', 'modulo', 'predefinita', 'copia'));

COMMENT ON TABLE cral_stati_evento IS 'Modulo CRAL: stati degli eventi (Parametri). La regola, fra sei fisse, decide cosa si puo'' fare; il server la controlla a ogni scrittura.';
COMMENT ON COLUMN cral_iniziative.copiato_da IS 'Evento da cui questo e'' stato copiato (26.11.23).';
