-- ============================================================
-- Migration 0002 — FIX C-1 / M-4: token_selector su refresh_tokens
-- Elimina la scansione O(n) con Argon2 su tutti i token attivi.
-- Eseguire una sola volta sul DB di produzione/sviluppo.
-- ============================================================

-- 1. Aggiunge la colonna token_selector (nullable per compatibilità con righe esistenti)
ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS token_selector varchar(16);

-- 2. Revoca esplicitamente TUTTI i token attivi al momento della migrazione.
--    Motivazione (SEC-H03): questa migrazione coincide con il passaggio del fingerprint
--    da SHA256(userAgent|ip) a SHA256(userAgent). I token esistenti hanno un fingerprint
--    nel vecchio formato; al primo refresh produrrebbero un mismatch → errore
--    TOKEN_THEFT_SUSPECTED (fuorviante). È più onesto revocare qui una volta sola:
--    gli utenti vedranno una schermata di login ordinaria anziché un errore allarmante.
--    Questo è il comportamento INTENZIONALE — non un effetto collaterale.
UPDATE refresh_tokens
  SET revoked_at = NOW()
  WHERE revoked_at IS NULL;

-- 2b. Popola token_selector per le righe già revocate (rende NOT NULL possibile).
--     I token revocati al passo 2 non possono più essere usati, ma la colonna
--     deve essere NOT NULL per l'indice UNIQUE — usiamo un placeholder sull'id.
UPDATE refresh_tokens
  SET token_selector = lpad(id::text, 16, '0')
  WHERE token_selector IS NULL;

-- 3. Rende la colonna NOT NULL dopo il backfill
ALTER TABLE refresh_tokens
  ALTER COLUMN token_selector SET NOT NULL;

-- 4. Indice UNIQUE per lookup O(1) senza iterazione Argon2
CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_selector
  ON refresh_tokens (token_selector);

-- 5. Compound index per query userId + expiresAt (pulizia token scaduti, reporting)
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_expires
  ON refresh_tokens (user_id, expires_at);

COMMENT ON COLUMN refresh_tokens.token_selector IS
  'Primi 8 byte del raw token in hex (16 chars). Non segreto — permette lookup O(1) '
  'senza scansione di tutti i token attivi con Argon2. UNIQUE index garantisce '
  'ricerca istantanea. Il token completo viene verificato con Argon2 sul singolo record trovato.';
