-- ============================================================
-- Migration 0007 — PDF Region Editor: vincolo strutturale "1 versione attiva"
-- Audit Gate4 H2: il lock applicativo (.for('update') in createNewVersion,
-- vedi PgPdfRegionTemplatesRepository) chiude la finestra TOCTOU nel flusso
-- normale, ma resta una difesa "soft" — bypassabile da bug futuri, query dirette,
-- migrazioni manuali, ecc. Questo indice unico parziale è la garanzia "hard"
-- a livello DB: rende STRUTTURALMENTE impossibile avere 2+ righe attivo=true
-- nella stessa famiglia, indipendentemente dal codice applicativo.
-- CONCURRENTLY: build a tabella calda senza lock esclusivo (best practice prod).
-- ============================================================

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_pdf_region_one_active_per_family
  ON templati_pdf_region (template_family_id)
  WHERE attivo = true;

COMMENT ON INDEX idx_pdf_region_one_active_per_family IS
  'Vincolo strutturale: massimo 1 riga attivo=true per template_family_id. Audit Gate4 H2 — complementa il lock applicativo in createNewVersion() con garanzia DB-level indipendente dal codice.';
