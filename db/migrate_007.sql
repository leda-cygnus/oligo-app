-- migrate_007: amidite lot MW library + per-well calc fields
CREATE TABLE IF NOT EXISTS amidite_lot (
  id              SERIAL PRIMARY KEY,
  canonical_name  TEXT NOT NULL,
  lot_number      TEXT NOT NULL,
  mw_contribution NUMERIC(10,4) NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(canonical_name, lot_number)
);

-- Pre-populate standard nucleotide defaults
INSERT INTO amidite_lot (canonical_name, lot_number, mw_contribution, notes) VALUES
  ('dA', 'standard', 313.21, 'Standard dA residue MW'),
  ('dC', 'standard', 289.18, 'Standard dC residue MW'),
  ('dG', 'standard', 329.21, 'Standard dG residue MW'),
  ('dT', 'standard', 304.19, 'Standard dT residue MW'),
  ('rA', 'standard', 329.21, 'Standard rA residue MW'),
  ('rC', 'standard', 305.18, 'Standard rC residue MW'),
  ('rG', 'standard', 345.21, 'Standard rG residue MW'),
  ('rU', 'standard', 306.17, 'Standard rU residue MW')
ON CONFLICT DO NOTHING;

ALTER TABLE synthesis_run_line
  ADD COLUMN IF NOT EXISTS calc_ext_coeff NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS calc_mw        NUMERIC(12,4);
