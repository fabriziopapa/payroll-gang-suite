-- ============================================================
-- Migration 0025 — Modulo CRAL: telefono, consensi, WhatsApp,
--                  esigenze alimentari, modelli di esportazione
--
-- COSA. Per ogni persona (soci, esterni, familiari), oltre all'email:
--   · telefono       E.164 con il «+» (+393331234567): il formato delle
--                    API di WhatsApp
--   · wa_id          le sole cifre (393331234567): l'identificativo
--                    WhatsApp; di norma le cifre del numero
--   · tel_consenso   consenso (GDPR) all'uso del numero: NO, SI,
--                    REVOCATO; con data, origine e data della revoca
--   · whatsapp       presenza su WhatsApp: SI, NO, NV (non verificato);
--                    con data e fonte della verifica (a mano, da file)
--   · alim_consenso  consenso al trattamento dei dati alimentari (dati
--                    relativi alla salute); senza consenso esigenze e
--                    allergie restano vuote (vincolo)
--   · esigenze       VEGETARIANO, VEGANO, CELIACO, LATTOSIO
--   · allergie       testo libero
-- Lo stesso numero puo' stare su piu' persone (familiari): nessun
-- vincolo di unicita', solo un indice per l'aggancio nelle importazioni.
--
-- PARAMETRI. prefisso_tel: prefisso dato ai numeri scritti senza (39).
-- export_modelli: i modelli di esportazione salvati (colonne e filtri),
-- condivisi fra gli amministratori.
--
-- NON si applica a mano:   ./pgs-migra.sh applica
-- Gira come superutente. Additiva e idempotente.
-- ============================================================

ALTER TABLE cral_soci ADD COLUMN IF NOT EXISTS telefono             VARCHAR(16);
ALTER TABLE cral_soci ADD COLUMN IF NOT EXISTS wa_id                VARCHAR(15);
ALTER TABLE cral_soci ADD COLUMN IF NOT EXISTS tel_consenso         VARCHAR(8)   NOT NULL DEFAULT 'NO';
ALTER TABLE cral_soci ADD COLUMN IF NOT EXISTS tel_consenso_il      DATE;
ALTER TABLE cral_soci ADD COLUMN IF NOT EXISTS tel_consenso_origine VARCHAR(8);
ALTER TABLE cral_soci ADD COLUMN IF NOT EXISTS tel_revocato_il      DATE;
ALTER TABLE cral_soci ADD COLUMN IF NOT EXISTS whatsapp             VARCHAR(2)   NOT NULL DEFAULT 'NV';
ALTER TABLE cral_soci ADD COLUMN IF NOT EXISTS wa_verificato_il     DATE;
ALTER TABLE cral_soci ADD COLUMN IF NOT EXISTS wa_fonte             VARCHAR(4);
ALTER TABLE cral_soci ADD COLUMN IF NOT EXISTS alim_consenso        BOOLEAN      NOT NULL DEFAULT false;
ALTER TABLE cral_soci ADD COLUMN IF NOT EXISTS alim_consenso_il     DATE;
ALTER TABLE cral_soci ADD COLUMN IF NOT EXISTS esigenze             VARCHAR(12)[] NOT NULL DEFAULT '{}';
ALTER TABLE cral_soci ADD COLUMN IF NOT EXISTS allergie             VARCHAR(300) NOT NULL DEFAULT '';

ALTER TABLE cral_soci DROP CONSTRAINT IF EXISTS cral_soci_telefono;
ALTER TABLE cral_soci ADD CONSTRAINT cral_soci_telefono CHECK (
  (telefono IS NULL OR telefono ~ '^\+[1-9][0-9]{6,14}$')
  AND (wa_id IS NULL OR wa_id ~ '^[1-9][0-9]{6,14}$')
  AND tel_consenso IN ('NO', 'SI', 'REVOCATO')
  AND whatsapp IN ('SI', 'NO', 'NV')
  AND (tel_consenso_origine IS NULL OR tel_consenso_origine IN ('CARTACEO', 'ONLINE', 'EMAIL', 'VOCE'))
  AND (wa_fonte IS NULL OR wa_fonte IN ('MANO', 'FILE'))
  -- senza numero non c'e' consenso ne' WhatsApp
  AND (telefono IS NOT NULL OR (wa_id IS NULL AND tel_consenso = 'NO' AND whatsapp = 'NV'))
  AND (tel_consenso <> 'SI' OR tel_consenso_il IS NOT NULL)
  AND (tel_consenso <> 'REVOCATO' OR tel_revocato_il IS NOT NULL));

ALTER TABLE cral_soci DROP CONSTRAINT IF EXISTS cral_soci_alimentari;
ALTER TABLE cral_soci ADD CONSTRAINT cral_soci_alimentari CHECK (
  esigenze <@ ARRAY['VEGETARIANO', 'VEGANO', 'CELIACO', 'LATTOSIO']::varchar[]
  -- senza consenso i dati alimentari non si conservano
  AND (alim_consenso OR (cardinality(esigenze) = 0 AND allergie = '' AND alim_consenso_il IS NULL)));

CREATE INDEX IF NOT EXISTS cral_soci_telefono_i ON cral_soci (telefono) WHERE telefono IS NOT NULL;

ALTER TABLE cral_parametri ADD COLUMN IF NOT EXISTS prefisso_tel   VARCHAR(4) NOT NULL DEFAULT '39';
ALTER TABLE cral_parametri ADD COLUMN IF NOT EXISTS export_modelli JSONB      NOT NULL DEFAULT '[]';
ALTER TABLE cral_parametri DROP CONSTRAINT IF EXISTS cral_parametri_prefisso_tel;
ALTER TABLE cral_parametri ADD CONSTRAINT cral_parametri_prefisso_tel CHECK (prefisso_tel ~ '^[1-9][0-9]{0,3}$');

COMMENT ON COLUMN cral_soci.telefono IS 'Numero in E.164 con il + (formato delle API di WhatsApp). Puo'' ripetersi su piu'' persone.';
COMMENT ON COLUMN cral_soci.wa_id IS 'Identificativo WhatsApp: le sole cifre, senza +.';
COMMENT ON COLUMN cral_soci.tel_consenso IS 'Consenso GDPR all''uso del numero: NO, SI, REVOCATO. Senza SI il numero resta ma non entra nelle liste di contatto.';
COMMENT ON COLUMN cral_soci.alim_consenso IS 'Consenso ai dati alimentari (dati relativi alla salute). Senza, esigenze e allergie restano vuote.';
