-- migrate_024: allow multiple modifications to share the same synth slot.
-- NHS ester dyes (Cy5, Atto 550, DY-751) all use the same aminomodifier slot
-- on the synthesizer; the unique constraint on (run_id, synth_slot) prevents this.
-- The PK on (run_id, modification_id) already ensures each modification appears once.

ALTER TABLE synthesis_run_mod_map
  DROP CONSTRAINT IF EXISTS synthesis_run_mod_map_run_id_synth_slot_key;
