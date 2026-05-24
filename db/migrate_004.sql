-- migrate_004: reagent lots and CPG tracking per synthesis run

CREATE TABLE IF NOT EXISTS synthesis_run_reagent_lot (
  run_id        INT  NOT NULL REFERENCES synthesis_run(id) ON DELETE CASCADE,
  reagent_type  TEXT NOT NULL,
  lot_number    TEXT,
  solvent_lot   TEXT,          -- amidites only
  date_replaced DATE,
  replaced_by   TEXT,
  PRIMARY KEY (run_id, reagent_type)
);

CREATE TABLE IF NOT EXISTS synthesis_run_cpg (
  run_id        INT      NOT NULL REFERENCES synthesis_run(id) ON DELETE CASCADE,
  column_number SMALLINT NOT NULL CHECK (column_number BETWEEN 1 AND 12),
  lot_number    TEXT,
  PRIMARY KEY (run_id, column_number)
);
