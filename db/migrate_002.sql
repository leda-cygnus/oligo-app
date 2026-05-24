-- migrate_002: add scale_nmol to synthesis_run
ALTER TABLE synthesis_run ADD COLUMN IF NOT EXISTS scale_nmol INT;
