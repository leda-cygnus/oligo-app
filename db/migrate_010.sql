-- migrate_010: store per-well DMT setting on synthesis_run_line
ALTER TABLE synthesis_run_line ADD COLUMN IF NOT EXISTS dmt TEXT NOT NULL DEFAULT 'DMT OFF';
