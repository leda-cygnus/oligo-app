-- migrate_016: ensure synthesis_run_mod_map exists
-- This table was originally created outside the migration system.
-- Safe to run on any database state.

CREATE TABLE IF NOT EXISTS synthesis_run_mod_map (
  run_id            INT      NOT NULL REFERENCES synthesis_run(id)       ON DELETE CASCADE,
  modification_id   INT      NOT NULL REFERENCES modification_catalog(id),
  synth_slot        SMALLINT NOT NULL CHECK (synth_slot BETWEEN 1 AND 8),
  material_lot_id   INT      REFERENCES material_lot(id),
  PRIMARY KEY (run_id, modification_id)
);
