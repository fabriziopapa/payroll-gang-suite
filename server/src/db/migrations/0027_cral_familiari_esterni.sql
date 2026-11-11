-- ============================================================
-- Migration 0027 — Modulo CRAL: gruppo «familiari di esterni» negli eventi
--
-- COSA. Dalla 26.11.11.3 un familiare si puo' legare anche a un esterno
-- (campi estivi e non solo). Le persone restano di tipologia FAM: nessuna
-- colonna nuova, i legami gia' lo permettono. Negli eventi per gruppi i
-- familiari si dividono in due:
--   · FAM  familiari dei soci (come prima: gli eventi esistenti non cambiano)
--   · FEX  familiari di esterni (gruppo nuovo, si spunta solo quando serve)
-- Qui si allarga solo il vincolo sui valori ammessi in cral_iniziative.gruppi.
--
-- NON si applica a mano:   ./pgs-migra.sh applica
-- Gira come superutente. Idempotente.
-- ============================================================

ALTER TABLE cral_iniziative DROP CONSTRAINT IF EXISTS cral_iniziative_gruppi_check;
ALTER TABLE cral_iniziative ADD CONSTRAINT cral_iniziative_gruppi_check
  CHECK (gruppi <@ ARRAY['SD', 'SE', 'EST', 'FAM', 'FEX']::text[]);
