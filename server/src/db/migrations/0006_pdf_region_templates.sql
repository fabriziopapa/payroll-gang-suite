-- ============================================================
-- Migration 0006 — PDF Region Editor: template di riconoscimento layout
-- 1 tabella versionata: templati_pdf_region
-- + seed: secondo template certificato "slim" (Strada C — solo aggregati cert.*)
-- Idempotente: IF NOT EXISTS / ON CONFLICT DO NOTHING.
-- ============================================================

-- ── Templati PDF Region (template-come-dato, VERSIONATI E IMMUTABILI) ──
-- Ogni riga = UNA versione immutabile. Modifiche → nuova riga (versione+1),
-- auto-attivata, predecessore disattivato in transazione (mai UPDATE
-- in-place sui campi geometrici). template_family_id = lineage stabile
-- fra versioni, indipendente da nome/id (refinement Gate 2 — evita
-- rottura del lineage se l'admin rinomina il template a nuova versione).
CREATE TABLE IF NOT EXISTS templati_pdf_region (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_family_id       uuid NOT NULL DEFAULT gen_random_uuid(),
  nome                     varchar(200) NOT NULL,
  nota                     text,
  versione                 integer      NOT NULL DEFAULT 1,
  versione_label           varchar(8)   NOT NULL,
  attivo                   boolean      NOT NULL DEFAULT true,
  page_geometry_json       jsonb        NOT NULL,
  parti_json               jsonb        NOT NULL,
  certificato_template_id  uuid         NOT NULL REFERENCES templati_certificato(id),
  created_by               uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at               timestamptz  NOT NULL DEFAULT now(),
  updated_at               timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_templati_pdf_region_family_versione
  ON templati_pdf_region (template_family_id, versione);
CREATE INDEX IF NOT EXISTS idx_templati_pdf_region_attivo     ON templati_pdf_region (attivo);
CREATE INDEX IF NOT EXISTS idx_templati_pdf_region_family     ON templati_pdf_region (template_family_id);
CREATE INDEX IF NOT EXISTS idx_templati_pdf_region_created_by ON templati_pdf_region (created_by);

COMMENT ON COLUMN templati_pdf_region.template_family_id IS
  'Lineage stabile fra versioni — indipendente da nome (che può cambiare). Refinement Gate 2.';
COMMENT ON COLUMN templati_pdf_region.versione IS
  'Contatore interno per unicità/ordinamento — mai esposto come label.';
COMMENT ON COLUMN templati_pdf_region.versione_label IS
  'Formato AA.MM.GG (mirror APP_VERSION) — puramente cosmetico/audit.';
COMMENT ON COLUMN templati_pdf_region.page_geometry_json IS
  'PageGeometry[]: pageIndex/widthPt/heightPt/rotation. Letto ::text (pattern struttura_json/dati_json).';
COMMENT ON COLUMN templati_pdf_region.parti_json IS
  'ParteTemplate[]: discriminated union ParteAnagrafica | ParteVoce. Solo coordinate % — MAI bytes/binary PDF.';
COMMENT ON COLUMN templati_pdf_region.certificato_template_id IS
  'FK fissata a CREAZIONE — lega permanentemente layout↔forma certificato. Mai modificabile dopo (Gate 1, Q6).';

-- ============================================================
-- SEED — secondo template certificato "slim" (Strada C)
-- Per layout dove la scomposizione teo.* (stipendio/IIS/IVC/differenziali)
-- non è ricostruibile dalle regioni disegnate: fallback solo aggregati cert.*
-- UUID fisso per ON CONFLICT idempotente — stesso pattern del seed 0005.
-- ============================================================
INSERT INTO templati_certificato (id, nome, struttura_json, attivo)
VALUES (
  '00000000-0000-0000-0000-0000000c0002',
  'Certificato semplificato (aggregati)',
  '{
    "tabellaEmolumenti": [
      { "voce": "Retribuzioni lorde",     "segno": "(+)", "src": "cert.lordo_teorico" },
      { "voce": "Ritenute fiscali",       "segno": "(-)", "src": "cert.ritenute_fiscali" },
      { "voce": "Ritenute previdenziali", "segno": "(-)", "src": "cert.ritenute_previdenziali" },
      { "voce": "Importo al netto delle ritenute di legge", "segno": "(=)", "src": "cert.netto_ritenute_legge", "bold": true }
    ]
  }'::jsonb,
  true
)
ON CONFLICT (id) DO NOTHING;
