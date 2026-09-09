-- ============================================================
-- Migration 0011 — Area del conto di accredito in anagrafiche
--   area_conto — 'IT' | 'SEPA' | 'EXTRA_UE' | 'NON_NOTO'
--
-- Origine: estrazione SGE (v_ie_ru_sge) arricchita con la coordinata di
-- pagamento CSA corrente — SIAAC.V_IE_AC_CRDPAG_AB_ALL, riga con
-- FL_USO_CSA = 1, non annullata e valida alla data di estrazione.
-- Il valore deriva da CD_NAZIONE_ISO3166_1_A2 (con fallback sui caratteri
-- 5-6 del BIC per i conti extra-UE privi di IBAN).
--
-- PRIVACY: in questa colonna NON deve mai finire un IBAN, nemmeno parziale
-- o mascherato. Solo l'area. L'IBAN non lascia il database sorgente.
--
-- NULL = anagrafica importata prima di questa migrazione, o file XLSX privo
-- della colonna AREA_CONTO. Diverso da 'NON_NOTO', che significa invece
-- "estratto, ma nessuna coordinata CSA attiva".
--
-- Idempotente: IF NOT EXISTS.
-- Applicare a mano:  psql -U payroll_user -d payroll_gang -f 0011_anagrafiche_area_conto.sql
-- ============================================================

ALTER TABLE anagrafiche ADD COLUMN IF NOT EXISTS area_conto VARCHAR(10);

COMMENT ON COLUMN anagrafiche.area_conto IS
  'Area del conto su cui CSA paga: IT | SEPA | EXTRA_UE | NON_NOTO. NULL = non estratto. Mai un IBAN.';
