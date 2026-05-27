-- migrate_026: add 'nhs' to material_type allowed values
-- also expose mw_addition on material_lot for NHS ester conjugate MW lookup

-- Expand the CHECK constraint to include 'nhs'
ALTER TABLE material_lot
  DROP CONSTRAINT IF EXISTS material_lot_material_type_check;
ALTER TABLE material_lot
  ADD CONSTRAINT material_lot_material_type_check
    CHECK (material_type IN ('amidite', 'reagent', 'cpg', 'nhs'));
