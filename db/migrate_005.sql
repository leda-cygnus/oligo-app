-- migrate_005: per-well synthesis results
ALTER TABLE synthesis_run_line
  ADD COLUMN IF NOT EXISTS od_260            NUMERIC(8,3),
  ADD COLUMN IF NOT EXISTS desalted_vol_ul   NUMERIC(8,1),
  ADD COLUMN IF NOT EXISTS result_notes      TEXT;
