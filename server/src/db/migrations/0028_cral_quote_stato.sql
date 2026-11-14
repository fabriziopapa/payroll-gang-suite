-- ============================================================
-- Migration 0028 — Modulo CRAL: quota dovuta, esente o non dovuta
--
-- COSA. Finora chi era socio in un anno doveva la quota di quell'anno,
-- senza eccezioni a mano: un socio inserito per errore restava fra i
-- tenuti anche dopo la cessazione (quota intera), e l'unico rimedio era
-- eliminarlo. Dalla 26.11.14.3 la quota di un anno ha uno stato:
--   · DOVUTA      il caso normale (e il valore di tutte le righe di oggi)
--   · ESENTE      socio vero che il CRAL decide di non far pagare: resta
--                 nell'elenco dell'anno, non entra nel dovuto
--   · NON_DOVUTA  correzione di un errore: quell'anno non andava contato;
--                 esce dall'elenco e dal dovuto
-- con il motivo scritto da chi lo decide (scheda Quote › «Allinea soci»).
--
-- Vale anno per anno. La persona non cambia stato in anagrafica, e i
-- versamenti gia' registrati restano dove sono. Gli «anni esenti» di chi e'
-- stato eliminato e poi ripristinato (cral_soci.anni_esenti, 0023) restano
-- un'altra cosa e non si toccano.
--
-- NON si applica a mano:   ./pgs-migra.sh applica
-- Gira come superutente. Additiva e idempotente.
-- ============================================================

ALTER TABLE cral_quote ADD COLUMN IF NOT EXISTS stato  VARCHAR(10)  NOT NULL DEFAULT 'DOVUTA';
ALTER TABLE cral_quote ADD COLUMN IF NOT EXISTS motivo VARCHAR(200) NOT NULL DEFAULT '';

ALTER TABLE cral_quote DROP CONSTRAINT IF EXISTS cral_quote_stato;
ALTER TABLE cral_quote ADD CONSTRAINT cral_quote_stato CHECK (stato IN ('DOVUTA', 'ESENTE', 'NON_DOVUTA'));

COMMENT ON COLUMN cral_quote.stato IS 'DOVUTA (normale), ESENTE (socio che non paga: resta in elenco) o NON_DOVUTA (correzione: fuori dall''elenco). Si cambia da Quote > Allinea soci.';
COMMENT ON COLUMN cral_quote.motivo IS 'Perche'' la quota di quell''anno e'' esente o non dovuta. Vuoto quando e'' dovuta.';
