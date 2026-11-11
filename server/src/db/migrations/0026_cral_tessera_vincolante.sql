-- ============================================================
-- Migration 0026 — Modulo CRAL: formato della tessera obbligatorio
--
-- COSA. Un interruttore nei parametri della tessera. Acceso, anche le
-- tessere scritte a mano (scheda della persona, validazione) e quelle
-- che arrivano dai file (T1, T6) devono rispettare il formato scelto
-- (es. 4 cifre: 175 diventa 0175, «A12» si rifiuta). Spento, tutto come
-- prima: per questo parte spento.
--
-- Le tessere gia' assegnate non si toccano: il controllo vale solo per
-- una tessera che cambia. Il ripristino da archivio non lo applica.
--
-- NON si applica a mano:   ./pgs-migra.sh applica
-- Gira come superutente. Additiva e idempotente.
-- ============================================================

ALTER TABLE cral_parametri ADD COLUMN IF NOT EXISTS tessera_vincolante BOOLEAN NOT NULL DEFAULT false;
