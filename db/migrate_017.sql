-- migrate_017: store machine-ready (substituted) sequence on each run line
-- synth_sequence is annotated_sequence with /ModName/ tokens replaced by the
-- synthesiser slot number assigned in synthesis_run_mod_map.
-- NULL for runs created before this migration (client falls back to live substitution).

ALTER TABLE synthesis_run_line
  ADD COLUMN IF NOT EXISTS synth_sequence TEXT;
