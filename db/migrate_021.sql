-- migrate_021: material_lot — add product name and CAS number
--
-- `name`       : full vendor/commercial product name (display only)
-- `cas_number` : CAS registry number
--
-- `canonical_name` remains the linking key used to match lots to
-- synthesis run slots (reagents, amidite modifications, CPG).
-- Multiple lots with different names can share the same canonical_name.

ALTER TABLE material_lot
  ADD COLUMN IF NOT EXISTS name        TEXT,
  ADD COLUMN IF NOT EXISTS cas_number  TEXT;
