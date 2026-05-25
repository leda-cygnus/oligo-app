-- migrate_020: NHS ester delivery tracking and conjugation info

-- Track whether a modification slot uses direct amidite coupling or NHS ester route (AmMC6)
ALTER TABLE synthesis_run_mod_map
  ADD COLUMN IF NOT EXISTS delivery_method TEXT NOT NULL DEFAULT 'amidite'
  CHECK (delivery_method IN ('amidite', 'nhs_ester'));

-- Post-synthesis conjugation info per NHS ester modification in a run
CREATE TABLE IF NOT EXISTS synthesis_run_conjugation (
  run_id             INT  NOT NULL REFERENCES synthesis_run(id) ON DELETE CASCADE,
  modification_name  TEXT NOT NULL,
  reagent_lot        TEXT,
  date_conjugated    DATE,
  operator           TEXT,
  notes              TEXT,
  PRIMARY KEY (run_id, modification_name)
);
