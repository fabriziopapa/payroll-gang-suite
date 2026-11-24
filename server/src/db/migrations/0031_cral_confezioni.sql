-- ============================================================
-- Migration 0031 — Modulo CRAL: confezioni dei prodotti a ordine
--
-- Un prodotto venduto al kg, al litro o al pezzo puo' avere dei formati
-- di confezione (es. castagne in sacchi da 1 e da 2 kg). PGS propone a
-- ogni persona il numero minimo di confezioni; si corregge a mano.
--
-- Qui c'e' solo l'elenco dei TIPI di confezione (Sacco, Pacco, Latta…),
-- che si gestisce in Parametri come le tipologie di prodotto. I formati
-- (tipo + quanto contiene) stanno nella config JSON dell'evento
-- (cral_iniziative.config.prodotti[].confezioni) e la scelta a mano
-- della persona nei suoi dati (cral_scelte.dati.conf): JSON validato dal
-- server (lib/cral.ts), nessuna colonna nuova.
--
-- NON si applica a mano:   ./pgs-migra.sh applica
-- Gira come superutente. Additiva e idempotente: rilanciarla non cambia nulla.
-- ============================================================

CREATE TABLE IF NOT EXISTS cral_confezioni (
  id      VARCHAR(10)  PRIMARY KEY CHECK (id ~ '^[A-Z0-9]{1,10}$'),
  nome    VARCHAR(60)  NOT NULL CHECK (char_length(btrim(nome)) > 0),
  attiva  BOOLEAN      NOT NULL DEFAULT TRUE,
  ordine  INTEGER      NOT NULL DEFAULT 0
);

INSERT INTO cral_confezioni (id, nome, ordine) VALUES
  ('SAC', 'Sacco',     1),
  ('PAC', 'Pacco',     2),
  ('LAT', 'Latta',     3),
  ('CAR', 'Cartone',   4),
  ('BOT', 'Bottiglia', 5),
  ('VAS', 'Vaschetta', 6)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE cral_confezioni IS 'Modulo CRAL: tipi di confezione (Parametri). I formati dei prodotti stanno in cral_iniziative.config, la scelta a mano in cral_scelte.dati.conf (26.11.25).';
