-- migrate_013: unified material lots catalog

CREATE TABLE IF NOT EXISTS material_lot (
  id             SERIAL PRIMARY KEY,
  material_type  TEXT NOT NULL CHECK (material_type IN ('amidite', 'reagent', 'cpg')),
  canonical_name TEXT,          -- 'dA','dC','dG','dT' / 'wash','cap_a'… / cpg name / mod canonical
  lot_number     TEXT NOT NULL,
  provider       TEXT,
  description    TEXT,
  mw             NUMERIC(12,4), -- MW of the compound itself (Da)
  fw             NUMERIC(12,4), -- formula weight
  mw_addition    NUMERIC(10,4), -- net MW added to oligo per occurrence (modified amidites)
  received_date  DATE,
  expiry_date    DATE,
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Link reagent lots used in a run to a catalog entry
ALTER TABLE synthesis_run_reagent_lot
  ADD COLUMN IF NOT EXISTS material_lot_id INTEGER REFERENCES material_lot(id);

-- Link CPG per column to a catalog entry
ALTER TABLE synthesis_run_cpg
  ADD COLUMN IF NOT EXISTS material_lot_id INTEGER REFERENCES material_lot(id);

-- Link modification slots in a run to a specific material lot (enables lot-specific mw_addition)
ALTER TABLE synthesis_run_mod_map
  ADD COLUMN IF NOT EXISTS material_lot_id INTEGER REFERENCES material_lot(id);
