-- migrate_006: multi-stage QC results (crude, purification, MS/CE)
-- Rename existing crude measurement columns
ALTER TABLE synthesis_run_line RENAME COLUMN od_260          TO crude_od_260;
ALTER TABLE synthesis_run_line RENAME COLUMN desalted_vol_ul TO crude_vol_ul;

ALTER TABLE synthesis_run_line
  ADD COLUMN IF NOT EXISTS crude_a260_a280  NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS crude_conc_ng_ul NUMERIC(10,3),

  ADD COLUMN IF NOT EXISTS purif_method     TEXT,
  ADD COLUMN IF NOT EXISTS purif_date       DATE,
  ADD COLUMN IF NOT EXISTS purif_operator   TEXT,
  ADD COLUMN IF NOT EXISTS purif_notes      TEXT,

  ADD COLUMN IF NOT EXISTS purif_od_260     NUMERIC(8,3),
  ADD COLUMN IF NOT EXISTS purif_vol_ul     NUMERIC(8,1),
  ADD COLUMN IF NOT EXISTS purif_a260_a280  NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS purif_conc_ng_ul NUMERIC(10,3),

  ADD COLUMN IF NOT EXISTS ms_done          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ms_pass          BOOLEAN,
  ADD COLUMN IF NOT EXISTS ms_notes         TEXT,

  ADD COLUMN IF NOT EXISTS ce_done          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ce_pass          BOOLEAN,
  ADD COLUMN IF NOT EXISTS ce_notes         TEXT;
