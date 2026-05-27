-- migrate_025: add material_lot_id to synthesis_run_conjugation for NHS ester MW lookup
ALTER TABLE synthesis_run_conjugation
  ADD COLUMN IF NOT EXISTS material_lot_id INTEGER REFERENCES material_lot(id);
