-- ============================================================
-- Migration 0024 — Modulo CRAL: importo versato per ogni rata
--
-- COSA. Fino alla 0023 di ogni mese si sapeva solo «pagato sì/no» e il
-- versato era la somma delle rate teoriche. Dal tracciato T7 (quote
-- versate, e domani le trattenute lette da CINECA) si registra l'importo
-- davvero versato:
--   · importi[1..12]  centesimi versati per ogni mese (0 = nulla)
--   · versato_unica   centesimi versati in un'unica soluzione
-- Il mese resta «pagato» (mesi[k]) quando l'importo copre la rata, o
-- quando un solo versamento copre la quota dell'anno. Il versato e' la
-- somma reale: importi + versato_unica.
--
-- PREGRESSO. Come contava il versato fino alla 0023: le rate mensili o in
-- trattenuta pagate prendono la rata teorica dell'anno (l'ultima prende i
-- centesimi di resto), l'unica soluzione pagata la quota dell'anno. Cosi'
-- il versato di ogni socio resta quello di prima. Si tocca solo chi non ha
-- importi: rilanciarla non cambia nulla.
--
-- LOTTI. Nuova provenienza 'T7' (tracciato delle quote versate).
--
-- NON si applica a mano:   ./pgs-migra.sh applica
-- Gira come superutente. Additiva e idempotente.
-- ============================================================

ALTER TABLE cral_quote ADD COLUMN IF NOT EXISTS importi INTEGER[] NOT NULL
  DEFAULT ARRAY[0,0,0,0,0,0,0,0,0,0,0,0];
ALTER TABLE cral_quote ADD COLUMN IF NOT EXISTS versato_unica INTEGER;

ALTER TABLE cral_quote DROP CONSTRAINT IF EXISTS cral_quote_importi;
ALTER TABLE cral_quote ADD CONSTRAINT cral_quote_importi
  CHECK (cardinality(importi) = 12 AND 0 <= ALL(importi) AND (versato_unica IS NULL OR versato_unica >= 0));

UPDATE cral_quote q SET importi = ARRAY(
    SELECT CASE WHEN q.mesi[k] THEN (CASE WHEN k = 12 THEN a.importo_cent - 11 * (a.importo_cent / 12) ELSE a.importo_cent / 12 END) ELSE 0 END
    FROM generate_series(1, 12) AS k ORDER BY k)
  FROM cral_quote_anno a
  WHERE a.anno = q.anno AND q.modo <> 'UNICA' AND true = ANY(q.mesi) AND q.importi = ARRAY[0,0,0,0,0,0,0,0,0,0,0,0];

UPDATE cral_quote q SET versato_unica = a.importo_cent
  FROM cral_quote_anno a
  WHERE a.anno = q.anno AND q.modo = 'UNICA' AND q.pagata_il IS NOT NULL AND q.versato_unica IS NULL;

ALTER TABLE cral_lotti DROP CONSTRAINT IF EXISTS cral_lotti_origine_check;
ALTER TABLE cral_lotti ADD CONSTRAINT cral_lotti_origine_check CHECK (origine IN ('T6', 'T7', 'ARCHIVIO'));

COMMENT ON COLUMN cral_quote.importi IS 'Centesimi versati per ogni mese (0 = nulla). Il mese e'' pagato (mesi) quando l''importo copre la rata.';
COMMENT ON COLUMN cral_quote.versato_unica IS 'Centesimi versati in un''unica soluzione.';
